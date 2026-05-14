// Shared type definitions used across frontend modules

export type LogType = 'system' | 'debug' | 'success' | 'action' | 'network' | 'wait' | 'skill' | 'error';

export interface LogEntry {
  type: LogType;
  message: string;
  timestamp: string;
}

export type ExtractionStrategy =
  | 'LLMExtractionStrategy'
  | 'GroqExtractionStrategy'
  | 'JsonLdExtractionStrategy'
  | 'WholeCaptureStrategy';

export type ScrapeMode = 'single' | 'batch' | 'deep';

export interface FirestoreHealth {
  mode: string;
  connected: boolean;
  projectId?: string | null;
  databaseId?: string | null;
  authSource?: string | null;
  initError?: string | null;
}

export type UserRole = 'admin' | 'user';

export interface AuthUser {
  email: string;
  role: UserRole;
}

export interface AuthMeResponse {
  authenticated: boolean;
  user: AuthUser;
}

export interface AllowlistUser {
  email: string;
  role: UserRole;
  addedAt?: string | null;
}

export interface SelectorPreset {
  name: string;
  selector: string;
  strategy: string;
}

export interface PlpPreset {
  name: string;
  selector: string;
}

export interface AttributeSet {
  name: string;
  fields: string[];
  mdRules?: string;
  mdFileName?: string;
}

export interface AppSettings {
  title: string;
  bullets: string;
  description: string;
  keywords: string;
  groqApiKey: string;
  attributeSets: AttributeSet[];
  selectorPresets: SelectorPreset[];
  plpSelectorPresets: PlpPreset[];
}

export interface SkuRecord {
  sku?: string;
  SKU?: string;
  brand?: string;
  Brand?: string;
  ean?: string;
  shipping_weight?: string;
  product_type?: string;
  attribute_set?: string;
  Attribute_Set?: string;
  base_code?: string;
  sap_data?: string;
  pdf_text?: string;
  title?: string;
  Name?: string;
  category?: string;
  [key: string]: unknown;
}

export interface HarvestFile {
  name: string;
  size: number;
  mtime: Date | string;
}

export interface Job {
  sku: string;
  /** Lifecycle status. 'queued'/'running' are transient states for in-flight queue jobs. */
  status: 'ready' | 'completed' | 'pending' | 'queued' | 'running' | 'failed';
  title?: string;
  attribute_set?: string;
  Attribute_Set?: string;
  schema?: string;
  Schema?: string;
  harvestFile?: string;
  hasPdf?: boolean;
  hasSapData?: boolean;
}

// ── Pagination ───────────────────────────────────────────────────────────────

export interface PageParams {
  /** Opaque cursor from a previous response's `nextCursor` field. */
  cursor?: string;
  /** Max items to return. Default 50, max 200. */
  limit?: number;
  /** Case-insensitive substring match on sku / title. */
  search?: string;
  /** Filter by lifecycle status. Defaults to 'all'. */
  statusFilter?: 'pending' | 'ready' | 'completed' | 'all';
}

export interface PaginatedResponse<T> {
  items: T[];
  /** Pass as `cursor` to fetch the next page. Null when on the last page. */
  nextCursor: string | null;
  hasMore: boolean;
  /** Approximate total count — may not be exact in all backends. */
  total?: number;
}

// ── Async job queue ──────────────────────────────────────────────────────────

export type AsyncJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'retrying';
export type AsyncJobType = 'scrape' | 'discover' | 'inspect' | 'analyze' | 'run_job' | 'export_xlsx';

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

export interface EnqueueResponse {
  jobId: string;
  status: 'queued';
  queuePosition?: number;
}

export interface ExtractedImage {
  sku: string;
  originalUrl: string;
  imagePath: string;
  screenshotPath?: string;
}

export interface DiscoveredLink {
  href: string;
  text: string;
}

export interface ScrapeResponse {
  text: string;
  groqResult?: string | null;
  imageUrls?: string[];
  screenshot?: string | null;
  title?: string | null;
  secondary?: {
    text: string;
    groqResult?: string | null;
    title?: string | null;
    strategy?: string;
  } | null;
}

export interface AnalyzeResponse {
  selectors: string;
  strategy: ExtractionStrategy;
  reasoning: string;
  screenshot?: string | null;
}

export interface DiscoverResponse {
  links: DiscoveredLink[];
}

// ── v2 API types ──────────────────────────────────────────────────────────────

/**
 * Stable error codes returned by all v2 endpoints.
 * Callers should switch on these codes rather than HTTP status or message text.
 */
export type V2ErrorCode =
  | 'unauthenticated'
  | 'forbidden'
  | 'csrf_invalid'
  | 'validation_failed'
  | 'rate_limited'
  | 'queue_overloaded'
  | 'not_found'
  | 'conflict'
  | 'upstream_timeout'
  | 'internal_error';

export interface V2ApiError {
  code: V2ErrorCode;
  message: string;
  /** True when the client may safely retry the request after a short back-off. */
  retryable: boolean;
  details?: unknown;
}

/** Standard error envelope returned by all v2 endpoints on failure. */
export interface V2ErrorResponse {
  error: V2ApiError;
  requestId?: string;
}

/**
 * 202 Accepted response from any endpoint that enqueues an async job.
 * Clients should poll `statusUrl` until `status` is 'completed' or 'failed'.
 */
export interface V2JobEnvelope {
  jobId: string;
  status: 'queued';
  acceptedAt: string;
  statusUrl: string;
  cancelUrl: string;
}

/** Full job detail returned by GET /api/v2/jobs/:jobId */
export interface V2JobDetail {
  id: string;
  type: AsyncJobType;
  status: AsyncJobStatus;
  retryCount: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  result?: unknown;
  error: string | null;
}

/** Session info included in login/me responses when signed sessions are active. */
export interface V2SessionInfo {
  id: string;
  expiresAt: string;
}

/** Response body from POST /api/auth/login when SESSION_SECRET is configured. */
export interface V2LoginResponse {
  success: true;
  user: AuthUser;
  /** Only present when signed sessions are active (SESSION_SECRET is set). */
  session?: V2SessionInfo;
  /** CSRF token to include as X-CSRF-Token header on subsequent state-changing requests. */
  csrfToken?: string;
}

/** Response body from GET /api/v2/auth/me */
export interface V2MeResponse {
  authenticated: true;
  user: AuthUser;
  /** Only present when signed sessions are active. */
  session?: V2SessionInfo;
}

/** Returned by PUT /api/v2/skus/:sku and PATCH /api/v2/skus/:sku */
export interface V2SkuVersion {
  sku: string;
  /** Monotonically increasing version counter. Use as _ifVersion in PATCH requests. */
  version: number;
  updatedAt: string;
}

/** Queue depth stats returned by GET /api/v2/jobs */
export interface V2QueueStats {
  queued: number;
  active: number;
  total: number;
  maxConcurrency: number;
}
