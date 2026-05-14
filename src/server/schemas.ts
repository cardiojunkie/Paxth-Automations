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

export type ScrapeRequest = z.infer<typeof ScrapeRequestSchema>;
export type DiscoverRequest = z.infer<typeof DiscoverRequestSchema>;
export type AnalyzeRequest = z.infer<typeof AnalyzeRequestSchema>;
export type ImageExtractRequest = z.infer<typeof ImageExtractRequestSchema>;
export type SKUIndexRequest = z.infer<typeof SKUIndexRequestSchema>;
export type SettingsRequest = z.infer<typeof SettingsRequestSchema>;

/** Pagination query-string schema. Used with z.parse(req.query). */
export const PageParamsSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  search: z.string().max(200).optional(),
  status: z.enum(['pending', 'ready', 'completed', 'all']).default('all'),
});

export type PageParams = z.infer<typeof PageParamsSchema>;
