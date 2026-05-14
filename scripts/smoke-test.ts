#!/usr/bin/env tsx
/**
 * Production smoke test — run after deploy or in CI to verify the server is healthy.
 * Usage:
 *   BASE_URL=http://localhost:3000 ADMIN_KEY=secret tsx scripts/smoke-test.ts
 *
 * Exit code 0 = all checks passed
 * Exit code 1 = one or more checks failed
 */

const BASE_URL = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const ADMIN_KEY = process.env.ADMIN_KEY || '';

let passed = 0;
let failed = 0;

async function check(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓  ${label}`);
    passed++;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ✗  ${label} — ${msg}`);
    failed++;
  }
}

async function get(path: string, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, { headers });
}

async function run(): Promise<void> {
  console.log(`\nSmoke test → ${BASE_URL}\n`);

  await check('GET /api/health returns 200 with {status:"ok"}', async () => {
    const res = await get('/api/health');
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    const body = await res.json() as Record<string, unknown>;
    if (body.status !== 'ok') throw new Error(`Unexpected body: ${JSON.stringify(body)}`);
  });

  await check('GET /api/admin/status returns 200 (no auth required)', async () => {
    const res = await get('/api/admin/status');
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    const body = await res.json() as Record<string, unknown>;
    if (typeof body.adminConfigured !== 'boolean') throw new Error('Missing adminConfigured field');
  });

  await check('GET /api/sku/index without auth returns 403', async () => {
    const res = await get('/api/sku/index');
    if (res.status !== 403) throw new Error(`Expected 403, got HTTP ${res.status}`);
  });

  if (ADMIN_KEY) {
    await check('GET /api/sku/index with valid ADMIN_KEY returns 200', async () => {
      const res = await get('/api/sku/index', { 'x-admin-key': ADMIN_KEY });
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    });

    await check('GET /api/settings with valid ADMIN_KEY returns 200', async () => {
      const res = await get('/api/settings', { 'x-admin-key': ADMIN_KEY });
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    });
  } else {
    console.log('  -  Skipping authenticated checks (ADMIN_KEY not set)');
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Smoke test runner error:', err);
  process.exit(1);
});
