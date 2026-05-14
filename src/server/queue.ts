/**
 * In-process job queue with bounded concurrency, automatic retries,
 * and synchronous wait support.
 *
 * Replaces the old binary semaphore (withBrowserTask) with a proper queue
 * so concurrent requests are held and processed in order rather than
 * immediately rejected with 503.
 */

import { randomUUID } from 'node:crypto';
import { BusyError } from './errors.js';

export type AsyncJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'retrying';
export type AsyncJobType =
  | 'scrape'
  | 'discover'
  | 'inspect'
  | 'analyze'
  | 'run_job'
  | 'export_xlsx';

export interface AsyncJob {
  id: string;
  type: AsyncJobType;
  status: AsyncJobStatus;
  payload: Record<string, unknown>;
  result?: unknown;
  error?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  retryCount: number;
  durationMs?: number;
}

type JobHandler = (payload: Record<string, unknown>) => Promise<unknown>;

const MAX_RETRIES = 3;
const MAX_STORED_JOBS = 1000; // oldest completed/failed jobs purged beyond this
/** Reject new enqueues beyond this depth to prevent unbounded memory growth. */
const MAX_QUEUE_DEPTH = 200;

export class InProcessQueue {
  private readonly pendingQueue: string[] = [];
  private readonly jobs = new Map<string, AsyncJob>();
  private readonly handlers = new Map<string, JobHandler>();
  private activeCount = 0;
  readonly maxConcurrency: number;
  private readonly cleanupTimer: ReturnType<typeof setInterval>;

  constructor(maxConcurrency = 4) {
    this.maxConcurrency = maxConcurrency;
    this.cleanupTimer = setInterval(() => this.cleanup(), 5 * 60_000);
  }

  /** Register an async handler for a job type. Must be called before any jobs of that type are enqueued. */
  registerHandler(type: AsyncJobType, handler: JobHandler): void {
    this.handlers.set(type, handler);
  }

  /** Enqueue a job. Returns the job record immediately with status='queued'. Throws BusyError if the pending queue is full. */
  enqueue(type: AsyncJobType, payload: Record<string, unknown>): AsyncJob {
    if (this.pendingQueue.length >= MAX_QUEUE_DEPTH) {
      throw new BusyError(
        `Queue is at capacity (${MAX_QUEUE_DEPTH} pending jobs). Please retry shortly.`,
      );
    }
    const id = randomUUID();
    const job: AsyncJob = {
      id,
      type,
      status: 'queued',
      payload,
      createdAt: new Date().toISOString(),
      retryCount: 0,
    };
    this.jobs.set(id, job);
    this.pendingQueue.push(id);
    // Use setImmediate so the caller can capture jobId before execution starts
    setImmediate(() => this.tick());
    return job;
  }

  /** Get the current state of a job by ID. */
  getJob(id: string): AsyncJob | undefined {
    return this.jobs.get(id);
  }

  /** Summary stats for the /api/queue/stats endpoint. */
  getStats(): { queued: number; active: number; total: number; maxConcurrency: number } {
    return {
      queued: this.pendingQueue.length,
      active: this.activeCount,
      total: this.jobs.size,
      maxConcurrency: this.maxConcurrency,
    };
  }

  /**
   * Wait for a job to reach a terminal state (completed or failed).
   * Polls every 250 ms. Throws on timeout.
   * Keeping the HTTP request open while waiting is safe in Node.js event loop —
   * the loop continues processing other requests and queue ticks.
   */
  async waitForJob(id: string, timeoutMs: number): Promise<AsyncJob> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const job = this.jobs.get(id);
      if (!job) throw new Error(`Queue job not found: ${id}`);
      if (job.status === 'completed' || job.status === 'failed') return job;
      await new Promise<void>(resolve => setTimeout(resolve, 250));
    }
    // Do NOT mutate job state here — the worker may still be running and will reach a
    // terminal state on its own. The HTTP caller simply timed out waiting; they can
    // poll GET /api/v2/jobs/:id to get the eventual result.
    throw new Error('Job timed out waiting for completion');
  }

  /**
   * Cancel a job that is still in the pending queue (not yet running).
   * Returns true if the job was cancelled.
   * Returns false if the job is already running, terminal, or not found.
   * Running jobs cannot be interrupted — they must complete or fail on their own.
   */
  cancelJob(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;
    if (job.status !== 'queued' && job.status !== 'retrying') return false;
    const idx = this.pendingQueue.indexOf(id);
    if (idx === -1) return false; // status is queued but not in pending list — inconsistent state, leave it
    this.pendingQueue.splice(idx, 1);
    job.status = 'failed';
    job.error = 'Cancelled by user';
    job.completedAt = new Date().toISOString();
    return true;
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private tick(): void {
    while (this.activeCount < this.maxConcurrency && this.pendingQueue.length > 0) {
      const id = this.pendingQueue.shift()!;
      const job = this.jobs.get(id);
      if (!job || job.status !== 'queued') continue;
      void this.run(job);
    }
  }

  private async run(job: AsyncJob): Promise<void> {
    const handler = this.handlers.get(job.type);
    if (!handler) {
      job.status = 'failed';
      job.error = `No handler registered for job type: ${job.type}`;
      job.completedAt = new Date().toISOString();
      return;
    }

    this.activeCount++;
    job.status = 'running';
    job.startedAt = new Date().toISOString();

    try {
      job.result = await handler(job.payload);
      job.status = 'completed';
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (job.retryCount < MAX_RETRIES) {
        job.retryCount++;
        job.status = 'retrying';
        // Use longer backoff for transient HTTP errors (502/503/504/timeout/ECONNRESET)
      const isTransient = /502|503|504|timeout|ECONNRESET|ETIMEDOUT/i.test(msg);
      const backoffMs = isTransient
        ? [5_000, 15_000, 30_000][Math.min(job.retryCount - 1, 2)]
        : Math.pow(2, job.retryCount) * 500;
        setTimeout(() => {
          job.status = 'queued';
          this.pendingQueue.push(job.id);
          this.tick();
        }, backoffMs);
      } else {
        job.status = 'failed';
        job.error = msg;
      }
    } finally {
      job.completedAt = new Date().toISOString();
      if (job.startedAt) {
        job.durationMs = Date.parse(job.completedAt) - Date.parse(job.startedAt);
      }
      this.activeCount = Math.max(0, this.activeCount - 1);
      this.tick();
    }
  }

  private cleanup(): void {
    const terminal = [...this.jobs.entries()]
      .filter(([, j]) => j.status === 'completed' || j.status === 'failed')
      .sort(([, a], [, b]) => (a.completedAt ?? '') < (b.completedAt ?? '') ? -1 : 1);
    if (terminal.length > MAX_STORED_JOBS) {
      terminal.slice(0, terminal.length - MAX_STORED_JOBS).forEach(([id]) => this.jobs.delete(id));
    }
  }

  destroy(): void {
    clearInterval(this.cleanupTimer);
  }
}

/** Singleton queue — shared across the whole server process. */
export const jobQueue = new InProcessQueue(
  Number(process.env.QUEUE_CONCURRENCY || 4),
);
