// Zod validation schemas for all API request bodies

import { z } from 'zod';

export const ScrapeRequestSchema = z.object({
  url: z.string().url('Invalid URL'),
  selector: z.string().optional(),
  extractWithGroq: z.boolean().optional(),
  enableScreenshot: z.boolean().optional(),
  strategy: z
    .enum(['default', 'GroqExtractionStrategy', 'JsonLdExtractionStrategy', 'WholeCaptureStrategy'])
    .optional(),
  deepScroll: z.boolean().optional(),
  secondaryTarget: z
    .object({
      url: z.string().url('Invalid URL'),
      selector: z.string().optional(),
      strategy: z.string().optional(),
    })
    .optional(),
});

export const DiscoverRequestSchema = z.object({
  url: z.string().url('Invalid URL'),
  linkSelector: z.string().optional(),
});

export const AnalyzeRequestSchema = z.object({
  url: z.string().url('Invalid URL'),
  deepScroll: z.boolean().optional(),
});

export const ImageExtractRequestSchema = z.object({
  sku: z.string().min(1, 'SKU required'),
  url: z.string().url('Invalid URL'),
  screenshotEnabled: z.boolean().optional(),
});

export const SKUIndexRequestSchema = z.object({
  data: z.array(z.record(z.any())).min(1, 'At least one SKU required'),
});

export const SettingsRequestSchema = z.object({
  groqApiKey: z.string().optional(),
  schemas: z.record(z.any()).optional(),
  selectors: z.record(z.any()).optional(),
});

export const LoginRequestSchema = z.object({
  email: z.string().email('Valid email is required'),
});

export const AllowlistUpsertRequestSchema = z.object({
  email: z.string().email('Valid email is required'),
  role: z.enum(['admin', 'user']),
});

export type ScrapeRequest = z.infer<typeof ScrapeRequestSchema>;
export type DiscoverRequest = z.infer<typeof DiscoverRequestSchema>;
export type AnalyzeRequest = z.infer<typeof AnalyzeRequestSchema>;
export type ImageExtractRequest = z.infer<typeof ImageExtractRequestSchema>;
export type SKUIndexRequest = z.infer<typeof SKUIndexRequestSchema>;
export type SettingsRequest = z.infer<typeof SettingsRequestSchema>;
export type LoginRequest = z.infer<typeof LoginRequestSchema>;
export type AllowlistUpsertRequest = z.infer<typeof AllowlistUpsertRequestSchema>;

/** Pagination query-string schema. Used with z.parse(req.query). */
export const PageParamsSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  search: z.string().max(200).optional(),
  status: z.enum(['pending', 'ready', 'completed', 'all']).default('all'),
});

export type PageParams = z.infer<typeof PageParamsSchema>;

// ── v2 schemas (strict limits, idempotency key) ───────────────────────────────

/** Safe idempotency key: alphanumeric + hyphen/underscore, max 128 chars. */
const IdempotencyKeySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9_-]+$/, 'Idempotency key must be alphanumeric with hyphens or underscores')
  .optional();

export const V2ScrapeRequestSchema = z.object({
  url: z.string().url('Invalid URL').max(2048),
  selector: z.string().max(500).optional(),
  extractWithGroq: z.boolean().optional(),
  enableScreenshot: z.boolean().optional(),
  strategy: z
    .enum(['default', 'GroqExtractionStrategy', 'JsonLdExtractionStrategy', 'WholeCaptureStrategy'])
    .optional(),
  deepScroll: z.boolean().optional(),
  sku: z.string().min(1).max(100).optional(),
  secondaryTarget: z
    .object({
      url: z.string().url('Invalid URL').max(2048),
      selector: z.string().max(500).optional(),
      strategy: z.string().max(50).optional(),
    })
    .optional(),
  idempotencyKey: IdempotencyKeySchema,
});

export const V2DiscoverRequestSchema = z.object({
  url: z.string().url('Invalid URL').max(2048),
  linkSelector: z.string().max(500).optional(),
  idempotencyKey: IdempotencyKeySchema,
});

export const V2MappingRequestSchema = z.object({
  sku: z.string().min(1).max(100),
  attributeSetName: z.string().max(200).optional(),
  aiModel: z.string().max(100).optional(),
  idempotencyKey: IdempotencyKeySchema,
});

export const V2ExportRequestSchema = z.object({
  format: z.enum(['xls', 'xlsx']).default('xls'),
  /** Optional explicit SKU filter. Omit to export all outputs. */
  skus: z.array(z.string().min(1).max(100)).max(1000).optional(),
  idempotencyKey: IdempotencyKeySchema,
});

export const V2ImageExtractRequestSchema = z.object({
  sku: z.string().min(1).max(100),
  url: z.string().url('Invalid URL').max(2048),
  screenshotEnabled: z.boolean().optional(),
  idempotencyKey: IdempotencyKeySchema,
});

export type V2ScrapeRequest = z.infer<typeof V2ScrapeRequestSchema>;
export type V2DiscoverRequest = z.infer<typeof V2DiscoverRequestSchema>;
export type V2MappingRequest = z.infer<typeof V2MappingRequestSchema>;
export type V2ExportRequest = z.infer<typeof V2ExportRequestSchema>;
export type V2ImageExtractRequest = z.infer<typeof V2ImageExtractRequestSchema>;
