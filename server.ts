import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from "path";
import { fileURLToPath } from "url";
import { createHash, timingSafeEqual } from "crypto";
import * as cheerio from "cheerio";
import cors from "cors";
import cookieParser from "cookie-parser";
import multer from "multer";
import { createRequire } from "module";

const __require = createRequire(import.meta.url);
const pdfParse = __require("pdf-parse");
import OpenAI from "openai";
import TurndownService from "turndown";
import { z } from "zod";
import { BusyError, HttpError } from "./src/server/errors.js";
import { isPrivateIpAddress, assertSafeTargetUrl, assertSafeBrowserRequestUrl } from "./src/server/ssrf.js";
import {
  signSession,
  verifySession,
  isSignedToken,
  generateCsrfToken,
  verifyCsrfToken,
  SESSION_TTL_MS,
} from "./src/server/session.js";
import {
  getBrowser,
  withBrowserTask,
  closeBrowser,
  type BrowserLike,
} from "./src/server/browser.js";
import { jobQueue } from "./src/server/queue.js";
import type { AsyncJobType } from "./src/server/queue.js";
import {
  ScrapeRequestSchema,
  DiscoverRequestSchema,
  AnalyzeRequestSchema,
  ImageExtractRequestSchema,
  ImageMetadataRequestSchema,
  SKUIndexRequestSchema,
  SettingsRequestSchema,
  LoginRequestSchema,
  AllowlistUpsertRequestSchema,
  V2ScrapeRequestSchema,
  V2DiscoverRequestSchema,
  V2MappingRequestSchema,
  V2ExportRequestSchema,
} from "./src/server/schemas.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import fs from "fs";
import { dbService } from "./src/services/db.js";
import ExcelJS from "exceljs";
import sharp from "sharp";

// Initialization handled by dbService

// Ensure Directories
const SKU_INDEX_DIR = path.join(process.cwd(), 'sku-index');
const HARVEST_DIR = path.join(process.cwd(), 'harvest');
const JOBS_DIR = path.join(process.cwd(), 'jobs');
const OUTPUTS_DIR = path.join(process.cwd(), 'outputs');
const IMAGES_DIR = path.join(process.cwd(), 'public', 'images');

[SKU_INDEX_DIR, HARVEST_DIR, JOBS_DIR, OUTPUTS_DIR, path.join(OUTPUTS_DIR, 'json'), path.join(OUTPUTS_DIR, 'xlsx'), IMAGES_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Proper TypeScript: Type definitions for key interfaces (eliminate 'any' where possible)
interface ScrapeTargetData {
  url: string;
  selector?: string;
  extractWithAI?: boolean;
  enableScreenshot?: boolean;
  strategy?: 'default' | 'AIExtractionStrategy' | 'JsonLdExtractionStrategy' | 'WholeCaptureStrategy';
  deepScroll?: boolean;
}

interface ScrapeResult {
  markdown: string;
  rawMarkdown?: string | null;
  aiResult?: string | null;
  imageUrls: string[];
  screenshotBase64?: string | null;
  pageTitle: string | null;
  url: string;
  strategy?: ScrapeTargetData['strategy'];
}

interface AttributeSetConfig {
  name: string;
  fields: string[];
  mdRules?: string;
  mdFileName?: string;
}

interface ServerSettings {
  title: string;
  bullets: string;
  description: string;
  keywords: string;
  aiCreditsApiKey: string;
  globalMappingLogic?: string;
  attributeSets: AttributeSetConfig[];
  selectorPresets: Array<{ name: string; selector: string; strategy: string }>;
  plpSelectorPresets: Array<{ name: string; selector: string }>;
}

async function buildXlsxBuffer(rows: any[], headers: string[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('MasterUpload');
  worksheet.columns = headers.map((header) => ({
    header,
    key: header,
    width: Math.min(Math.max(header.length + 4, 12), 48),
  }));

  rows.forEach((row) => {
    const normalizedRow: Record<string, unknown> = {};
    headers.forEach((header) => {
      const value = row?.[header];
      normalizedRow[header] = value == null || typeof value !== 'object' ? (value ?? '') : JSON.stringify(value);
    });
    worksheet.addRow(normalizedRow);
  });

  worksheet.getRow(1).font = { bold: true };
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer as ArrayBuffer);
}

type SpreadsheetCell = string | number | boolean | null;

function normalizeWorkbookCellValue(value: ExcelJS.CellValue): SpreadsheetCell {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'object') return value as SpreadsheetCell;

  const complex = value as any;
  if (complex.result !== undefined) return normalizeWorkbookCellValue(complex.result);
  if (complex.text !== undefined) return String(complex.text);
  if (Array.isArray(complex.richText)) {
    return complex.richText.map((part: any) => part?.text || '').join('');
  }
  return String(value);
}

async function readXlsxRowsFromBuffer(buffer: Buffer): Promise<SpreadsheetCell[][]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];

  const rows: SpreadsheetCell[][] = [];
  worksheet.eachRow({ includeEmpty: true }, (row) => {
    const values: SpreadsheetCell[] = [];
    for (let col = 1; col <= worksheet.columnCount; col += 1) {
      values.push(normalizeWorkbookCellValue(row.getCell(col).value));
    }
    rows.push(values);
  });
  return rows;
}

// Keep flexible typing due to CloakBrowser/Playwright incompatibilities
// In production, keep 'any' for browser objects. Strong typing elsewhere.
// BrowserLike, BusyError, HttpError, getBrowser, withBrowserTask are imported from src/server/

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const randomDelay = (min: number, max: number) => delay(Math.floor(Math.random() * (max - min + 1) + min));

const parseBooleanEnv = (value: string | undefined, fallback: boolean) => {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
};

const getInternalAccessCode = () =>
  (process.env.AUTH_LOGIN_CODE || process.env.INTERNAL_ACCESS_CODE || '').trim();

const verifyInternalAccessCode = (provided: unknown, expected: string): boolean => {
  if (typeof provided !== 'string') return false;
  if (!expected && process.env.NODE_ENV !== 'production') return provided.trim().length > 0;
  if (!expected) return false;
  const providedHash = createHash('sha256').update(provided).digest();
  const expectedHash = createHash('sha256').update(expected).digest();
  return providedHash.length === expectedHash.length && timingSafeEqual(providedHash, expectedHash);
};

const SAFE_STORAGE_KEY_PATTERN = /^[a-zA-Z0-9_-]{1,100}$/;

const requireSafeStorageKey = (value: unknown, label = 'SKU') => {
  const normalized = String(value || '').trim();
  if (!SAFE_STORAGE_KEY_PATTERN.test(normalized)) {
    throw new HttpError(400, `${label} must be 1-100 characters using only letters, numbers, hyphens, and underscores.`);
  }
  return normalized;
};

const IMAGE_NEGATIVE_KEYWORDS = [
  'logo',
  'icon',
  'sprite',
  'banner',
  'rating',
  'star',
  'thumbnail',
  'thumb',
  'avatar',
  'placeholder',
  'pixel'
];

const IMAGE_POSITIVE_KEYWORDS = [
  'product',
  'gallery',
  'zoom',
  'large',
  'hires',
  'highres',
  'full',
  'original',
  'master'
];

function normalizeImageUrl(rawUrl: string, pageUrl: string): string | null {
  if (!rawUrl) return null;
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) return null;

  try {
    const normalized = trimmed.startsWith('//') ? `https:${trimmed}` : trimmed;
    const parsed = new URL(normalized, pageUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

function extractUrlsFromSrcset(srcsetValue: string): string[] {
  return srcsetValue
    .split(',')
    .map((part) => part.trim().split(/\s+/)[0])
    .filter(Boolean);
}

function isLikelyImageUrl(url: string): boolean {
  const lower = url.toLowerCase();
  const imageExtPattern = /\.(jpg|jpeg|png|webp|avif|gif|bmp|jfif)(\?|$)/;
  if (imageExtPattern.test(lower)) return true;
  if (lower.endsWith('.svg')) return false;

  const hasImageKeyword = /(image|img|media|product|zoom|large|hires|original)/.test(lower);
  const hasDimensionHint = /(\d{3,4})[x_](\d{3,4})/.test(lower);
  const hasImageQuery = /(format=|fm=|w=|h=|quality=|q=|fit=)/.test(lower);

  return hasImageKeyword && (hasDimensionHint || hasImageQuery);
}

function collectImageUrlsFromJsonLdValue(value: unknown, accumulator: string[]): void {
  if (!value) return;

  if (typeof value === 'string') {
    if (isLikelyImageUrl(value)) {
      accumulator.push(value);
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry) => collectImageUrlsFromJsonLdValue(entry, accumulator));
    return;
  }

  if (typeof value !== 'object') return;

  const rec = value as Record<string, unknown>;
  if (typeof rec.url === 'string' && isLikelyImageUrl(rec.url)) accumulator.push(rec.url);
  if (typeof rec.contentUrl === 'string' && isLikelyImageUrl(rec.contentUrl)) accumulator.push(rec.contentUrl);
  if (typeof rec.thumbnailUrl === 'string' && isLikelyImageUrl(rec.thumbnailUrl)) accumulator.push(rec.thumbnailUrl);

  if ('image' in rec) {
    collectImageUrlsFromJsonLdValue(rec.image, accumulator);
  }

  if (Array.isArray(rec['@graph'])) {
    rec['@graph'].forEach((entry) => collectImageUrlsFromJsonLdValue(entry, accumulator));
  }

  const nestedImageKeys = ['offers', 'aggregateOffer', 'potentialAction'];
  nestedImageKeys.forEach((key) => {
    if (key in rec) {
      collectImageUrlsFromJsonLdValue(rec[key], accumulator);
    }
  });
}

function scoreImageUrl(url: string): number {
  const lower = url.toLowerCase();
  if (lower.endsWith('.svg') || IMAGE_NEGATIVE_KEYWORDS.some((k) => lower.includes(k))) {
    return -100;
  }

  let score = 0;

  if (IMAGE_POSITIVE_KEYWORDS.some((k) => lower.includes(k))) {
    score += 30;
  }

  if (lower.includes('data-old-hires') || lower.includes('zoom') || lower.includes('original')) {
    score += 25;
  }

  const dimensionMatch = lower.match(/(\d{3,4})[x_](\d{3,4})/);
  if (dimensionMatch) {
    const width = Number(dimensionMatch[1]);
    const height = Number(dimensionMatch[2]);
    const area = width * height;
    if (area >= 1_000_000) score += 35;
    else if (area >= 400_000) score += 20;
    else if (area <= 40_000) score -= 25;
  }

  if (lower.match(/(small|tiny|mini)\b/)) {
    score -= 20;
  }

  return score;
}

function rankHighQualityImageUrls(rawUrls: string[], pageUrl: string, trustedUrls: Set<string> = new Set()): string[] {
  const bestByUrl = new Map<string, number>();

  rawUrls.forEach((raw) => {
    const normalized = normalizeImageUrl(raw, pageUrl);
    if (!normalized) return;
    const likelyImage = isLikelyImageUrl(normalized);
    if (!likelyImage && !trustedUrls.has(normalized)) return;
    const score = scoreImageUrl(normalized);
    if (score < 0) return;

    const existingScore = bestByUrl.get(normalized);
    if (existingScore === undefined || score > existingScore) {
      bestByUrl.set(normalized, score);
    }
  });

  return Array.from(bestByUrl.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([url]) => url);
}

function extractHarvestImageSections(markdown: string): string[] {
  const headings = new Set([
    '### MEDIA SOURCE ASSETS (PLAINTEXT URLs):',
    '## High Quality Product Image URLs',
  ]);
  const lines = markdown.split(/\r?\n/);
  const sections: string[] = [];
  let activeHeading: string | null = null;
  let activeLines: string[] = [];

  const flush = () => {
    if (!activeHeading) return;
    const section = [activeHeading, ...activeLines].join('\n').trim();
    if (section !== activeHeading) {
      sections.push(section);
    }
    activeHeading = null;
    activeLines = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (headings.has(trimmed)) {
      flush();
      activeHeading = trimmed;
      continue;
    }

    if (activeHeading && /^#{1,6}\s/.test(trimmed)) {
      flush();
    }

    if (activeHeading) {
      activeLines.push(line);
    }
  }

  flush();
  return sections;
}

function ensureHarvestImageSections(preferredMarkdown: string | null | undefined, sourceMarkdown: string): string {
  const fallback = sourceMarkdown.trim();
  if (!preferredMarkdown?.trim()) {
    return fallback;
  }

  const preferred = preferredMarkdown.trim();
  if (extractHarvestImageSections(preferred).length > 0) {
    return preferred;
  }

  const fallbackSections = extractHarvestImageSections(fallback);
  if (fallbackSections.length === 0) {
    return preferred;
  }

  return `${preferred}\n\n${fallbackSections.join('\n\n')}`.trim();
}

// isPrivateIpAddress and assertSafeTargetUrl imported from src/server/ssrf.ts

// Global Uncaught Exception Handlers to prevent server crash
process.on('unhandledRejection', (reason, promise) => {
  console.error('[SERVER] Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[SERVER] Uncaught Exception:', err);
});

const turndownService = new TurndownService({
  headingStyle: 'atx',
  hr: '---',
  codeBlockStyle: 'fenced'
});

// Configure Turndown to strictly REMOVE all attributes (class, id, style, etc)
turndownService.addRule('clean-attributes', {
  filter: ['div', 'span', 'table', 'tbody', 'tr', 'td', 'th', 'a', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
  replacement: function (content, node) {
    const tagName = (node as HTMLElement).tagName.toLowerCase();
    if (tagName === 'table') return '\n\n' + content + '\n\n';
    if (tagName === 'tr') return '\n' + content;
    if (tagName === 'td' || tagName === 'th') return ' | ' + content;
    return content;
  }
});

turndownService.keep(['table', 'thead', 'tbody', 'tr', 'th', 'td']);

const buildAICreditsClient = (apiKey?: string | null) => {
  const trimmedApiKey = apiKey?.trim();
  if (!trimmedApiKey) return null;
  return new OpenAI({
    apiKey: trimmedApiKey,
    baseURL: 'https://api.aicredits.in/v1',
  });
};

const aiCreditsClient = buildAICreditsClient(process.env.AI_CREDITS_API_KEY);
const DEFAULT_MAP_AI_MODEL = 'deepseek/deepseek-v4-flash';
const AI_CREDITS_MISSING_KEY_MESSAGE = 'AI Credits API key is not configured. Add AI_CREDITS_API_KEY in .env or configure it in Settings → Connectivity.';
const MAP_AI_MISSING_MODEL_MESSAGE = 'Please select or enter a model for Map AI.';
const AI_CREDITS_AUTH_MESSAGE = 'AI Credits authentication failed. Check your API key in .env or Settings → Connectivity.';
const MAP_AI_REQUEST_FAILED_MESSAGE = 'Map AI request failed while calling AI Credits.';
const SKU_ATTRIBUTE_SET_ALIASES = new Set([
  'attribute_set',
  'attribute_set_name',
  'attribute_setname',
  'attributeset',
  'schema',
]);

function normalizeMapAiModel(aiModel?: string | null): string {
  const model = (aiModel ?? DEFAULT_MAP_AI_MODEL).toString().trim();
  if (!model) {
    throw new Error(MAP_AI_MISSING_MODEL_MESSAGE);
  }
  return model;
}

function isAiCreditsAuthError(error: any): boolean {
  const status = error?.status ?? error?.statusCode ?? error?.response?.status;
  const code = error?.code?.toString().toLowerCase?.() || '';
  const message = error?.message?.toString().toLowerCase?.() || '';
  return status === 401 || status === 403 || code.includes('auth') || message.includes('invalid api key') || message.includes('unauthorized');
}

function toMapAiPublicError(error: any): Error {
  if (error?.message === AI_CREDITS_MISSING_KEY_MESSAGE || error?.message === MAP_AI_MISSING_MODEL_MESSAGE) {
    return error;
  }
  if (isAiCreditsAuthError(error)) {
    return new Error(AI_CREDITS_AUTH_MESSAGE);
  }
  return new Error(MAP_AI_REQUEST_FAILED_MESSAGE);
}

function readSkuAttributeSetAlias(record?: Record<string, any> | null): string {
  if (!record) return '';
  for (const [key, value] of Object.entries(record)) {
    const normalizedKey = key.toLowerCase().trim().replace(/\s+/g, '_');
    if (!SKU_ATTRIBUTE_SET_ALIASES.has(normalizedKey)) continue;
    const attributeSet = typeof value === 'string' ? value.trim() : '';
    if (attributeSet) return attributeSet;
  }
  return '';
}

function normalizeSkuIndexRecordForStorage(item: Record<string, any>, existing?: Record<string, any>) {
  const normalizedIncoming: Record<string, any> = {};
  const incomingAttributeSet = readSkuAttributeSetAlias(item);
  const existingAttributeSet = readSkuAttributeSetAlias(existing);

  Object.entries(item || {}).forEach(([key, value]) => {
    if (!key) return;
    const normalizedKey = key.toLowerCase().trim().replace(/\s+/g, '_');
    if (SKU_ATTRIBUTE_SET_ALIASES.has(normalizedKey)) return;
    normalizedIncoming[normalizedKey] = typeof value === 'string' ? value.trim() : value;
  });

  const merged = { ...(existing || {}), ...normalizedIncoming };
  Object.keys(merged).forEach((key) => {
    const normalizedKey = key.toLowerCase().trim().replace(/\s+/g, '_');
    if (SKU_ATTRIBUTE_SET_ALIASES.has(normalizedKey)) {
      delete merged[key];
    }
  });

  const finalAttributeSet = incomingAttributeSet || existingAttributeSet;
  if (finalAttributeSet) {
    merged.attribute_set = finalAttributeSet;
  }

  return merged;
}

function readSkuValue(record?: Record<string, any> | null): string {
  const raw = (record?.sku || record?.SKU)?.toString?.() || '';
  return raw.trim();
}

// All Zod schemas are imported from src/server/schemas.ts

function sanitizeWholeCaptureRoot($root: any, mode: 'raw' | 'structured') {
  $root.find('script, style, iframe, noscript, link, meta, svg, canvas, template').remove();

  if (mode === 'structured') {
    $root.find('[role="dialog"], [aria-modal="true"], .cookie-banner, .cookies, #cookie-banner, #onetrust-banner-sdk, .newsletter, .popup, .modal, .chat-widget, .intercom-lightweight-app').remove();
  }

  $root
    .find('*')
    .removeAttr('class')
    .removeAttr('id')
    .removeAttr('style')
    .removeAttr('data-test')
    .removeAttr('data-testid')
    .removeAttr('data-qa');
}

function convertHtmlToMarkdown(html: string): string {
  return turndownService.turndown(html)
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/\[!\[.*?\]\(.*?\)\].*?\)/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function buildWholeCaptureDocument({
  pageTitle,
  url,
  sectionTitle,
  contentMarkdown,
}: {
  pageTitle: string | null;
  url: string;
  sectionTitle: string;
  contentMarkdown: string;
}): string {
  const trimmedContent = contentMarkdown.trim();

  return [
    pageTitle?.trim() ? `# ${pageTitle.trim()}` : '# Whole Capture',
    '',
    '## Source Metadata',
    `- URL: ${url}`,
    '- Strategy: WholeCaptureStrategy',
    '',
    `## ${sectionTitle}`,
    '',
    trimmedContent || '_No content captured._',
  ].join('\n').trim();
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);
  const AUTH_COOKIE = 'auth_user';
  const requireSignedSessions = process.env.NODE_ENV === 'production';
  const trustProxy = parseBooleanEnv(process.env.TRUST_PROXY, false);
  if (trustProxy) {
    app.set('trust proxy', 1);
  }

  const configuredCookieSecure = parseBooleanEnv(process.env.COOKIE_SECURE, process.env.NODE_ENV === 'production');
  const cookieSameSiteRaw = (process.env.COOKIE_SAME_SITE || 'strict').trim().toLowerCase();
  const cookieSameSite: 'strict' | 'lax' | 'none' =
    cookieSameSiteRaw === 'lax' || cookieSameSiteRaw === 'none' || cookieSameSiteRaw === 'strict'
      ? cookieSameSiteRaw
      : 'strict';
  const cookieSecure = cookieSameSite === 'none' ? true : configuredCookieSecure;

  if (cookieSameSiteRaw !== cookieSameSite) {
    console.warn(`[SERVER] Invalid COOKIE_SAME_SITE='${cookieSameSiteRaw}'. Falling back to '${cookieSameSite}'.`);
  }
  if (cookieSameSite === 'none' && !configuredCookieSecure) {
    console.warn('[SERVER] COOKIE_SAME_SITE=none requires secure cookies. Enforcing secure=true.');
  }

  const CORS_ORIGINS = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  const ALLOW_ALL_CORS = CORS_ORIGINS.includes('*');
  const internalAccessCode = getInternalAccessCode();

  if (requireSignedSessions) {
    if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.trim().length < 32) {
      throw new Error('[SERVER] SESSION_SECRET must be set to at least 32 characters in production.');
    }
    if (internalAccessCode.length < 12) {
      throw new Error('[SERVER] AUTH_LOGIN_CODE must be set to at least 12 characters in production.');
    }
    if (ALLOW_ALL_CORS) {
      throw new Error('[SERVER] CORS_ORIGINS=* is not allowed in production with credentialed sessions.');
    }
    if (cookieSameSite === 'none' && CORS_ORIGINS.length === 0) {
      throw new Error('[SERVER] COOKIE_SAME_SITE=none requires explicit CORS_ORIGINS in production.');
    }
  }

  if (process.env.NODE_ENV === 'production' && CORS_ORIGINS.length === 0) {
    console.warn('[SERVER] CORS_ORIGINS is empty in production. Only same-origin/non-browser requests are expected to work.');
  }

  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });

  // Request ID middleware for better tracing and debugging (Medium priority)
  app.use((req, res, next) => {
    const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    (req as any).id = requestId;
    res.setHeader('X-Request-ID', requestId);
    next();
  });

  const rateState = new Map<string, { count: number; windowStart: number }>();
  const authRateState = new Map<string, { count: number; windowStart: number }>();
  
  // Cleanup old rate limit entries every minute (prevents memory leak)
  setInterval(() => {
    const now = Date.now();
    const windowMs = 60_000;
    let cleaned = 0;
    for (const [ip, state] of rateState.entries()) {
      if (now - state.windowStart > windowMs) {
        rateState.delete(ip);
        cleaned++;
      }
    }
    for (const [ip, state] of authRateState.entries()) {
      if (now - state.windowStart > 15 * 60_000) {
        authRateState.delete(ip);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      console.log(`[SERVER] Rate limit cleanup: removed ${cleaned} stale entries`);
    }
  }, 60_000);

  app.use('/api', (req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const existing = rateState.get(ip);
    const windowMs = 60_000;
    const maxPerWindow = 120;

    if (!existing || now - existing.windowStart > windowMs) {
      rateState.set(ip, { count: 1, windowStart: now });
      return next();
    }

    existing.count += 1;
    if (existing.count > maxPerWindow) {
      return res.status(429).json({ error: 'Too many requests. Please retry shortly.' });
    }
    return next();
  });

  app.use('/api/auth/login', (req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const existing = authRateState.get(ip);
    const windowMs = 15 * 60_000;
    const maxPerWindow = 10;

    if (!existing || now - existing.windowStart > windowMs) {
      authRateState.set(ip, { count: 1, windowStart: now });
      return next();
    }

    existing.count += 1;
    if (existing.count > maxPerWindow) {
      return res.status(429).json({ error: 'Too many login attempts. Please retry later.' });
    }
    return next();
  });

  const shouldEnableCors =
    ALLOW_ALL_CORS ||
    CORS_ORIGINS.length > 0 ||
    process.env.NODE_ENV !== 'production';

  // In production with no configured CORS origins, skip CORS middleware entirely.
  // Same-origin requests still work, and browsers block cross-origin access by default.
  if (shouldEnableCors) {
    app.use(cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (ALLOW_ALL_CORS) return callback(null, true);
        if (process.env.NODE_ENV !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
          return callback(null, true);
        }
        if (CORS_ORIGINS.includes(origin)) {
          return callback(null, true);
        }
        return callback(new Error('Origin not allowed by CORS'));
      },
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      credentials: true
    }));
  } else {
    console.log('[SERVER] CORS middleware disabled (production + empty CORS_ORIGINS). Same-origin only.');
  }

  // Parse cookies for authentication (httpOnly cookies cannot be accessed from JS)
  app.use(cookieParser());

  const normalizeEmail = (email: string) => email.trim().toLowerCase();

  const resolveSessionUser = async (req: express.Request) => {
    const cookieValue = req.cookies?.[AUTH_COOKIE];
    if (typeof cookieValue !== 'string' || !cookieValue.trim()) return null;

    // v2 path: verify HMAC-signed session token
    if (isSignedToken(cookieValue)) {
      const payload = verifySession(cookieValue);
      if (!payload) return null; // invalid signature or expired
      // Re-check allowlist on every request so role changes/removals take effect immediately
      return dbService.getAllowlistUser(payload.email);
    }

    if (requireSignedSessions) {
      return null;
    }

    // v1 legacy path: plain email in cookie (migration window)
    return dbService.getAllowlistUser(normalizeEmail(cookieValue));
  };

  const requireAuth = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    try {
      const user = await resolveSessionUser(req);
      if (!user) {
        console.warn(`[SERVER] Unauthorized API access attempt on ${req.method} ${req.path} from ${req.ip}`);
        return res.status(403).json({ error: 'Unauthorized. Login required.' });
      }
      (req as any).authUser = user;
      next();
    } catch (error) {
      return res.status(500).json({ error: 'Failed to validate authentication.' });
    }
  };

  const requireAdminRole = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const user = (req as any).authUser;
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin role required.' });
    }
    next();
  };

  /** CSRF protection middleware for v2 state-changing endpoints.
   * Only enforced when the request carries a signed session cookie
   * (i.e. SESSION_SECRET is configured). Stateless unauthenticated routes are unaffected.
   */
  const requireCsrf = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const cookieValue = req.cookies?.[AUTH_COOKIE];
    // If not using a signed session (legacy mode), skip CSRF check
    if (!cookieValue || !isSignedToken(cookieValue)) return next();
    const payload = verifySession(cookieValue);
    if (!payload) {
      return res.status(401).json({
        error: { code: 'unauthenticated', message: 'Session invalid or expired', retryable: false },
      });
    }
    const csrfHeader = req.headers['x-csrf-token'] as string | undefined;
    if (!csrfHeader || !verifyCsrfToken(csrfHeader, payload.sid)) {
      return res.status(403).json({
        error: { code: 'csrf_invalid', message: 'X-CSRF-Token header missing or invalid', retryable: false },
      });
    }
    next();
  };

  const mutatingMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  const csrfExemptPaths = new Set([
    '/auth/login',
    '/auth/logout',
  ]);

  app.use('/api', (req, res, next) => {
    if (!mutatingMethods.has(req.method)) return next();
    if (csrfExemptPaths.has(req.path)) return next();
    return requireCsrf(req, res, next);
  });

  // Validation middleware factory (Security: Validates all input)
  const validateRequest = <T>(schema: z.ZodSchema<T>) => {
    return (req: express.Request, res: express.Response, next: express.NextFunction) => {
      try {
        schema.parse(req.body);
        next();
      } catch (error) {
        if (error instanceof z.ZodError) {
          console.warn(`[SERVER] Validation error on ${req.path}:`, error.errors);
          return res.status(400).json({ 
            error: 'Invalid request', 
            details: error.errors[0]?.message 
          });
        }
        next();
      }
    };
  };

  app.use((req, res, next) => {
    res.setTimeout(120_000, () => {
      if (!res.headersSent) {
        res.status(504).json({ error: 'Request timed out' });
      }
    });
    next();
  });

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  const MAX_PDF_SIZE = 50 * 1024 * 1024; // 50MB
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_PDF_SIZE, files: 1 },
  });
  const handlePdfUpload: express.RequestHandler = (req, res, next) => {
    upload.single("file")(req, res, (err: any) => {
      if (!err) return next();
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: "PDF file too large. Maximum size: 50MB" });
      }
      return next(err);
    });
  };
  const MAX_XLSX_SIZE = 10 * 1024 * 1024; // 10MB
  const xlsxUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_XLSX_SIZE, files: 1 },
  });
  const handleXlsxUpload: express.RequestHandler = (req, res, next) => {
    xlsxUpload.single("file")(req, res, (err: any) => {
      if (!err) return next();
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: "XLSX file too large. Maximum size: 10MB" });
      }
      return next(err);
    });
  };

  function validateXlsxUpload(file: Express.Multer.File | undefined) {
    if (!file) {
      throw new HttpError(400, "No XLSX file uploaded");
    }
    const hasXlsxName = file.originalname.toLowerCase().endsWith('.xlsx');
    const hasZipMagic = file.buffer.length >= 2 && file.buffer[0] === 0x50 && file.buffer[1] === 0x4b;
    if (!hasXlsxName || !hasZipMagic) {
      throw new HttpError(400, "Only .xlsx files are allowed");
    }
  }

  async function installSafeRequestInterceptor(context: any) {
    if (!context || typeof context.route !== 'function') return;
    await context.route('**/*', async (route: any) => {
      const requestUrl = route.request().url();
      try {
        await assertSafeBrowserRequestUrl(requestUrl);
        await route.continue();
      } catch (e: any) {
        console.warn(`[SSRF] Blocked browser request to ${requestUrl}: ${e?.message || 'unsafe URL'}`);
        await route.abort();
      }
    });
  }

  // ── Queue handler registrations ────────────────────────────────────────────
  // These closures capture the helper functions declared later in startServer
  // (scrapeTarget, performInspection, loadSettings, resolveGroqClient) — all
  // `async function` declarations so they are hoisted within startServer scope.
  jobQueue.registerHandler('scrape' as AsyncJobType, async (payload) => {
    const { url, selector, extractWithAI, enableScreenshot, strategy, deepScroll, sku, secondaryTarget } =
      payload as unknown as ScrapeTargetData & { sku?: string; secondaryTarget?: { url: string; selector?: string; strategy?: string } };
    const primaryResult = await scrapeTarget({ url, selector, extractWithAI, enableScreenshot, strategy, deepScroll });
    let secondaryResult: ScrapeResult | null = null;
    if (secondaryTarget?.url) {
      try {
        secondaryResult = await scrapeTarget({
          url: secondaryTarget.url,
          selector: secondaryTarget.selector || selector,
          strategy: (secondaryTarget.strategy || strategy) as ScrapeTargetData['strategy'],
          extractWithAI,
          enableScreenshot,
          deepScroll,
        });
      } catch (err: any) {
        console.warn(`[SCRAPE] Secondary target failed: ${err.message}`);
      }
    }
    if (sku) {
      const safeSku = sku.toString().replace(/[^a-z0-9_-]/gi, '_');
      try {
        const shouldPreferAIPrimary = strategy === 'AIExtractionStrategy';
        const primaryHarvestContent = shouldPreferAIPrimary
          ? ensureHarvestImageSections(primaryResult.aiResult, primaryResult.markdown)
          : primaryResult.markdown;
        const primaryRawHarvestContent = primaryResult.rawMarkdown
          ? ensureHarvestImageSections(primaryResult.rawMarkdown, primaryResult.markdown)
          : undefined;
        const shouldPreferAISecondary = secondaryResult?.strategy === 'AIExtractionStrategy';
        const secondaryHarvestContent = secondaryResult
          ? (shouldPreferAISecondary
              ? ensureHarvestImageSections(secondaryResult.aiResult, secondaryResult.markdown)
              : secondaryResult.markdown)
          : undefined;
        const secondaryRawHarvestContent = secondaryResult?.rawMarkdown
          ? ensureHarvestImageSections(secondaryResult.rawMarkdown, secondaryResult.markdown)
          : undefined;
        await dbService.saveHarvest(
          safeSku,
          primaryHarvestContent,
          secondaryHarvestContent,
          primaryRawHarvestContent,
          secondaryRawHarvestContent,
        );
        console.log(`[SCRAPE] Auto-saved harvest: ${safeSku}`);
      } catch (e: any) {
        console.warn(`[SCRAPE] Auto-save failed for ${safeSku}: ${e.message}`);
      }
    }
    // Shape result to match what the frontend expects
    return {
      success: true,
      text: primaryResult.markdown,
      rawText: primaryResult.rawMarkdown,
      aiResult: primaryResult.aiResult,
      imageUrls: primaryResult.imageUrls,
      title: primaryResult.pageTitle,
      url: primaryResult.url,
      strategy: primaryResult.strategy,
      ...(primaryResult.screenshotBase64 ? { screenshot: `data:image/jpeg;base64,${primaryResult.screenshotBase64}` } : {}),
      secondary: secondaryResult ? {
        url: secondaryResult.url,
        text: secondaryResult.markdown,
        rawText: secondaryResult.rawMarkdown,
        aiResult: secondaryResult.aiResult,
        imageUrls: secondaryResult.imageUrls,
        title: secondaryResult.pageTitle,
        strategy: secondaryResult.strategy,
        ...(secondaryResult.screenshotBase64 ? { screenshot: `data:image/jpeg;base64,${secondaryResult.screenshotBase64}` } : {}),
      } : null,
    };
  });

  jobQueue.registerHandler('inspect' as AsyncJobType, async (payload) => {
    const { url, deepScroll } = payload as { url: string; deepScroll?: boolean };
    return await performInspection(url, deepScroll ?? false);
  });

  jobQueue.registerHandler('discover' as AsyncJobType, async (payload) => {
    const { url, linkSelector } = payload as { url: string; linkSelector?: string };
    let context: any = null;
    try {
      console.log(`[SERVER] Discovery Mode Starting: ${url}`);
      const browserInstance = await getBrowser();
      context = await browserInstance.newContext();
      await installSafeRequestInterceptor(context);
      const page = await context.newPage();
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      } catch (e) {
        const navWarn = e as Error;
        console.warn(`[SERVER] Discovery navigation warning: ${navWarn.message}`);
      }
      await page.waitForTimeout(1500);
      const pageLinks = (await page.evaluate(`
        (() => {
          const selector = ${linkSelector ? JSON.stringify(linkSelector) : 'null'};
          let elements = selector ? Array.from(document.querySelectorAll(selector)) : Array.from(document.querySelectorAll('a[href]'));
          if (selector && !selector.includes('a')) {
             const container = document.querySelector(selector);
             if (container) elements = Array.from(container.querySelectorAll('a[href]'));
          }
          return elements
            .map(el => { const href = el.href; const text = el.innerText.trim(); return { href, text }; })
            .filter(link => link.href && (link.href.startsWith('http') || link.href.startsWith('/')));
        })()
      `)) as any[];
      await context.close();
      context = null;
      return pageLinks;
    } catch (err) {
      if (context) { try { await context.close(); } catch { /* ignore */ } }
      throw err;
    }
  });

  jobQueue.registerHandler('run_job' as AsyncJobType, async (payload) => {
    const { sku, attributeSetName: uiAttributeSetName, aiModel } = payload as {
      sku: string;
      attributeSetName?: string;
      aiModel?: string;
    };
    const safeSku = sku.toString().replace(/[^a-z0-9_-]/gi, '_');
    const harvestPath = path.join(HARVEST_DIR, `${safeSku}.md`);

    // O(1) single-SKU lookup using the new per-doc model / cache
    const skuRecord = await dbService.getSkuById(sku.toString());

    if (!fs.existsSync(harvestPath) && !skuRecord?.pdf_text && !skuRecord?.sap_data && !skuRecord) {
      throw new Error(`Missing source data or SKU record for ${sku}`);
    }

    let markdown = '';
    if (fs.existsSync(harvestPath)) {
      markdown = fs.readFileSync(harvestPath, 'utf-8');
    }
    let secondaryMarkdown = '';
    const secondaryHarvestPath = path.join(HARVEST_DIR, `${safeSku}_secondary.md`);
    if (fs.existsSync(secondaryHarvestPath)) {
      secondaryMarkdown = fs.readFileSync(secondaryHarvestPath, 'utf-8');
    }

    const settings = await loadSettings();
    const attributeSetName = (
      uiAttributeSetName ||
      skuRecord?.attribute_set ||
      skuRecord?.attribute_set_name ||
      skuRecord?.Attribute_Set ||
      skuRecord?.schema ||
      skuRecord?.Schema ||
      ''
    ).toString().trim();

    let headers = Object.keys(skuRecord || {}).filter(k =>
      k.toLowerCase() !== 'attribute_set' &&
      k.toLowerCase() !== 'attribute_set_name' &&
      k.toLowerCase() !== 'schema'
    );
    if (!headers.some(k => k.toLowerCase() === 'sku')) headers.unshift('SKU');

    let mdRules = '';
    if (attributeSetName) {
      const foundSet = settings.attributeSets.find(
        (s: any) => s.name.toLowerCase() === attributeSetName.toLowerCase()
      );
      if (foundSet) {
        if (foundSet.fields?.length > 0) headers = foundSet.fields;
        if (foundSet.mdRules) mdRules = `\nSPECIFIC MAPPING RULES (APPLY THESE STRICTLY): \n${foundSet.mdRules}\n`;
      }
    } else if (settings.attributeSets?.length === 1) {
      const foundSet = settings.attributeSets[0];
      if (foundSet.fields?.length > 0) headers = foundSet.fields;
      if (foundSet.mdRules) mdRules = `\nSPECIFIC MAPPING RULES (APPLY THESE STRICTLY): \n${foundSet.mdRules}\n`;
    }

    const aiClient = await resolveAICreditsClient(settings);
    if (!aiClient) throw new Error(AI_CREDITS_MISSING_KEY_MESSAGE);
    const mapAiModel = normalizeMapAiModel(aiModel);

    const prompt = `
      TASK: High-Precision Product Specification Mapping
      SKU: ${sku}
      TARGET ATTRIBUTE SET: ${attributeSetName || 'DEFAULT_GENERAL'}
      
      DIRECTIONS:
      1. Analyze the provided context (SAP Data, PDF and Web Scrapes) for the given SKU.
      2. Map the relevant data points into the following headers:
         ${headers.join(', ')}
      3. Ensure compliance with these specific schema mapping rules:
         ${mdRules}

      CONTEXT 1 (SAP DATA):
      ${skuRecord?.sap_data ? skuRecord.sap_data : 'No SAP data attached.'}

      CONTEXT 2 (PDF Document):
      ${skuRecord?.pdf_text ? skuRecord.pdf_text : 'No PDF attached.'}

      CONTEXT 3 (Scraped Web Data):
      ${markdown ? `Primary URL Scrape:\n${markdown}` : 'No Primary URL scraped data.'}
      ${secondaryMarkdown ? `\nSecondary URL Scrape:\n${secondaryMarkdown}` : ''}

      OUTPUT FORMAT: Return a valid JSON object where keys EXACTLY match the headers above.
    `;

    let aiResponse;
    try {
      aiResponse = await aiClient.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        model: mapAiModel,
        response_format: { type: 'json_object' },
      });
    } catch (error: any) {
      throw toMapAiPublicError(error);
    }
    const outputData = JSON.parse(aiResponse.choices[0]?.message?.content || '{}');

    const manualOverrides: any = {};
    if (skuRecord) {
      if (skuRecord.shipping_weight) manualOverrides['attributes__shipping_weight'] = skuRecord.shipping_weight;
      if (skuRecord.brand) manualOverrides['attributes__brand'] = skuRecord.brand;
      if (skuRecord.ean) manualOverrides['attributes__lulu_ean'] = skuRecord.ean;
      if (skuRecord.base_code) manualOverrides['base code'] = skuRecord.base_code;
      if (skuRecord.product_type) manualOverrides['attributes__lulu_product_type'] = skuRecord.product_type;
    }
    const finalOutput = { ...outputData, ...manualOverrides, SKU: sku, sku };
    await dbService.saveOutput(safeSku, finalOutput);
    return finalOutput;
  });

  jobQueue.registerHandler('export_xlsx' as AsyncJobType, async (payload) => {
    const { format, skus: skusFilter } = payload as { format?: string; skus?: string[] | null };
    const skusQuery = Array.isArray(skusFilter) ? skusFilter : null;
    let rows = await dbService.listOutputs();

    if (skusQuery) {
      const safeQuerySkus = skusQuery.map((s: string) => s.toString().replace(/[^a-z0-9_-]/gi, '_'));
      rows = rows.filter((r: any) => {
        const skuVal = r.SKU || r.sku || '';
        const safeSku = skuVal.toString().replace(/[^a-z0-9_-]/gi, '_');
        return safeQuerySkus.includes(safeSku);
      });
    }

    const settings = await loadSettings();
    let predefinedHeaders: string[] = [];
    const addedKeys = new Set<string>();

    const actualKeysInRows = new Set<string>();
    rows.forEach((r: any) => Object.keys(r).forEach(k => actualKeysInRows.add(k)));

    predefinedHeaders.push('SKU');
    addedKeys.add('SKU');
    addedKeys.add('sku');

    if (settings.attributeSets && settings.attributeSets.length > 0) {
      settings.attributeSets.forEach((set: any) => {
        set.fields?.forEach((field: string) => {
          const lowerF = field.toLowerCase();
          const existsInRows = Array.from(actualKeysInRows).some(k => k.toLowerCase() === lowerF);
          if (existsInRows && !addedKeys.has(lowerF)) {
            addedKeys.add(lowerF);
            predefinedHeaders.push(field);
          }
        });
      });
    }

    rows.forEach((r: any) => {
      Object.keys(r).forEach(k => {
        const lowerK = k.toLowerCase();
        const existingHeader = predefinedHeaders.find(h => h.toLowerCase() === lowerK);
        if (!existingHeader) {
          predefinedHeaders.push(k);
          addedKeys.add(lowerK);
        } else if (existingHeader !== k) {
          r[existingHeader] = r[k];
          delete r[k];
        }
      });
    });

    if (format && format !== 'xlsx') {
      throw new Error('Only xlsx export is supported');
    }
    return buildXlsxBuffer(rows, predefinedHeaders);
  });

  // ── End queue handler registrations ───────────────────────────────────────

  const warmBrowserOnStart = parseBooleanEnv(
    process.env.WARM_BROWSER_ON_START,
    process.env.NODE_ENV === 'production',
  );
  if (warmBrowserOnStart) {
    setTimeout(() => {
      getBrowser()
        .then(() => {
          console.log('[BROWSER] Warm-up complete. Browser is ready for queue jobs.');
        })
        .catch((err: any) => {
          console.warn(`[BROWSER] Warm-up failed: ${err?.message || 'unknown error'}`);
        });
    }, 2_000);
  }

  app.post("/api/upload-pdf", requireAuth, handlePdfUpload, async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }
      
      // File type validation (Security)
      if (!req.file.mimetype.includes('pdf')) {
        return res.status(400).json({ error: "Only PDF files are allowed" });
      }
      
      // File size validation kept as a second guard after multer's streaming limit.
      if (req.file.size > MAX_PDF_SIZE) {
        return res.status(413).json({ error: `PDF file too large. Maximum size: 50MB (got ${(req.file.size / 1024 / 1024).toFixed(2)}MB)` });
      }
      
      const data = await pdfParse(req.file.buffer);
      if (!data || !data.text) {
        return res.status(400).json({ error: "Failed to extract text from PDF" });
      }
      
      const { sku } = req.body;
      if (!sku) {
        return res.status(400).json({ error: "SKU is required" });
      }
      const safeSku = requireSafeStorageKey(sku);
      
      // Save/update this SKU via the canonical index normalizer.
      const indexData = await dbService.getSkuIndex();
      const map = new Map<string, Record<string, any>>();
      indexData.forEach((item: any) => {
        const skuValue = readSkuValue(item);
        if (!skuValue) return;
        map.set(skuValue, normalizeSkuIndexRecordForStorage(item));
      });
      const existing = map.get(safeSku);
      const merged = normalizeSkuIndexRecordForStorage({ ...(existing || {}), sku: safeSku, pdf_text: data.text }, existing);
      map.set(safeSku, merged);
      await dbService.updateSkuIndex(Array.from(map.values()));
      
      res.json({ message: "PDF processed successfully", sku: safeSku, textPreview: data.text.substring(0, 500) });
    } catch (e: any) {
      console.error("[SERVER] Error processing PDF:", e);
      res.status(e?.statusCode || 500).json({ error: "Failed to process PDF", details: e.message });
    }
  });

  app.post("/api/xlsx/rows", requireAuth, handleXlsxUpload, async (req, res) => {
    try {
      validateXlsxUpload(req.file);
      const rows = await readXlsxRowsFromBuffer(req.file!.buffer);
      res.json({ rows });
    } catch (e: any) {
      res.status(e?.statusCode || 500).json({ error: e?.message || "Failed to parse XLSX file" });
    }
  });

  app.post("/api/xlsx/template", requireAuth, async (req, res) => {
    try {
      const headers = Array.isArray(req.body?.headers) ? req.body.headers : [];
      const sheetName = typeof req.body?.sheetName === 'string' && req.body.sheetName.trim()
        ? req.body.sheetName.trim().slice(0, 31)
        : 'Template';
      const filename = typeof req.body?.filename === 'string' && req.body.filename.trim()
        ? req.body.filename.trim().replace(/[^a-z0-9_.-]/gi, '_')
        : 'template.xlsx';

      const safeHeaders = headers
        .map((header: unknown) => typeof header === 'string' ? header.trim() : '')
        .filter((header: string) => header.length > 0)
        .slice(0, 100);

      if (safeHeaders.length === 0) {
        return res.status(400).json({ error: "Template headers are required" });
      }

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet(sheetName);
      worksheet.columns = safeHeaders.map((header: string) => ({
        header,
        key: header,
        width: Math.min(Math.max(header.length + 4, 12), 40),
      }));
      worksheet.getRow(1).font = { bold: true };
      worksheet.views = [{ state: 'frozen', ySplit: 1 }];

      const buffer = await workbook.xlsx.writeBuffer();
      const output = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer as ArrayBuffer);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=${filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`}`);
      res.send(output);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "Failed to generate XLSX template" });
    }
  });

  app.post("/api/sku/index", requireAuth, requireAdminRole, validateRequest(SKUIndexRequestSchema), async (req, res) => {
    const { data } = req.body;
    if (!data || !Array.isArray(data)) {
      return res.status(400).json({ error: "Invalid data format" });
    }
    try {
      const existingData = await dbService.getSkuIndex();
      
      // Merge data by SKU with canonical field normalization.
      const map = new Map<string, Record<string, any>>();
      existingData.forEach((item: any) => {
        const skuValue = readSkuValue(item);
        if (!skuValue) return;
        map.set(skuValue, normalizeSkuIndexRecordForStorage(item));
      });
      data.forEach(item => {
        const skuValue = readSkuValue(item);
        if (!skuValue) return;
        const existingItem = map.get(skuValue);
        const normalizedItem = normalizeSkuIndexRecordForStorage({ ...item, sku: skuValue }, existingItem);
        map.set(skuValue, normalizedItem);
      });

      const mergedData = Array.from(map.values());
      await dbService.updateSkuIndex(mergedData);
      res.json({ success: true, count: mergedData.length });
    } catch (e) {
      res.status(500).json({ error: "Failed to index SKUs" });
    }
  });

  // Bulk cascade-delete via POST to avoid browser stripping DELETE request bodies
  app.post("/api/sku/index/purge", requireAuth, requireAdminRole, async (req, res) => {
    try {
      const { skus } = req.body;
      if (!Array.isArray(skus) || skus.length === 0) {
        return res.status(400).json({ error: 'skus array required' });
      }
      const safeSkus = skus.map((s: any) => requireSafeStorageKey(s));
      const skuSet = new Set(safeSkus);
      const data = await dbService.getSkuIndex();
      const filtered = data.filter((item: any) => !skuSet.has((item.sku || item.SKU)?.toString()));
      await dbService.updateSkuIndex(filtered);
      await Promise.allSettled(
        safeSkus.map(async (sku: string) => {
          await dbService.deleteSku(sku).catch(() => {});
          await dbService.deleteHarvest(sku).catch(() => {});
          await dbService.deleteOutput(sku).catch(() => {});
        })
      );
      res.json({ success: true, deleted: safeSkus.length });
    } catch (e: any) {
      res.status(e?.statusCode || 500).json({ error: 'Bulk delete failed', details: e?.message });
    }
  });

  app.delete("/api/sku/index/:sku", requireAuth, requireAdminRole, async (req, res) => {
    try {
      const sku = requireSafeStorageKey(req.params.sku);
      const data = await dbService.getSkuIndex();
      const filtered = data.filter((item: any) => (item.sku || item.SKU)?.toString() !== sku);
      await dbService.updateSkuIndex(filtered);
      // Explicitly remove Firestore skus/{sku} doc so paginated queries see the deletion
      await dbService.deleteSku(sku).catch(() => {});
      // Cascade: also remove harvest file and output JSON
      await dbService.deleteHarvest(sku).catch(() => {});
      await dbService.deleteOutput(sku).catch(() => {});
      res.json({ success: true });
    } catch (e: any) {
      res.status(e?.statusCode || 500).json({ error: "Failed to delete SKU", details: e?.message });
    }
  });

  app.get("/api/sku/index", requireAuth, async (req, res) => {
    try {
      const data = await dbService.getSkuIndex();
      const normalizedData = Array.isArray(data)
        ? data.map((item: any) => normalizeSkuIndexRecordForStorage(item))
        : [];
      res.json(normalizedData);
    } catch (e) {
      res.status(500).json({ error: "Failed to read index" });
    }
  });

  app.get("/api/harvest", requireAuth, async (req, res) => {
    try {
      const fileData = await dbService.listHarvests();
      res.json(fileData);
    } catch (e) {
      res.status(500).json({ error: "Failed to list harvest" });
    }
  });

  app.get("/api/harvest/:filename", requireAuth, async (req, res) => {
    try {
      const { filename } = req.params;
      const content = await dbService.getHarvestFile(filename);
      if (content) {
        res.json({ content });
      } else {
        res.status(404).json({ error: "File not found" });
      }
    } catch (e) {
      res.status(500).json({ error: "Read failed" });
    }
  });

  app.put("/api/harvest/:filename", requireAuth, async (req, res) => {
    try {
      const { filename } = req.params;
      const { content } = req.body;

      if (typeof content !== 'string') {
        return res.status(400).json({ error: 'content is required' });
      }

      await dbService.saveHarvestFile(filename, content);
      res.json({ success: true, filename });
    } catch (e) {
      res.status(500).json({ error: 'Save failed' });
    }
  });

  app.delete("/api/harvest/:filename", requireAuth, requireAdminRole, async (req, res) => {
    try {
      const { filename } = req.params;
      const sku = path
        .basename(filename)
        .replace(/_secondary_raw\.md$/i, '')
        .replace(/_secondary\.md$/i, '')
        .replace(/_raw\.md$/i, '')
        .replace(/\.md$/i, '');
      await dbService.deleteHarvest(requireSafeStorageKey(sku));
      res.json({ success: true });
    } catch (e: any) {
      res.status(e?.statusCode || 500).json({ error: "Delete failed", details: e?.message });
    }
  });

  app.post("/api/save-batch", requireAuth, async (req, res) => {
    const { sku, content } = req.body;
    if (!sku || !content) {
      return res.status(400).json({ error: "SKU and content are required" });
    }

    try {
      const safeSku = requireSafeStorageKey(sku);
      await dbService.saveHarvest(safeSku, content);
      console.log(`[SERVER] Saved batch harvest: ${safeSku}`);
      res.json({ success: true, path: `${safeSku}.md` });
    } catch (e: any) {
      console.error("[SERVER] Failed to save harvest:", e);
      res.status(e?.statusCode || 500).json({ error: "Failed to save data on server", details: e?.message });
    }
  });

  async function scrapeTarget(targetData: ScrapeTargetData): Promise<ScrapeResult> {
    let { url, selector, extractWithAI, enableScreenshot, strategy, deepScroll } = targetData;
    
    // Ensure URL has a valid scheme
    if (url && !/^https?:\/\//i.test(url)) {
      url = 'https://' + url;
    }
    
    // Context can be either CloakBrowser or Playwright context - keep flexible typing
    let context: any = null;
    try {
      console.log(`[SERVER] Multi-Stage Extraction Starting: ${url} (Strategy: ${strategy || 'default'}, Screenshot: ${enableScreenshot}, Scroll: ${deepScroll})`);
      
      const browserInstance = await getBrowser();
      context = await browserInstance.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
        deviceScaleFactor: 1,
        extraHTTPHeaders: {
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Referer': 'https://www.google.com/',
          'sec-ch-ua': '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"Windows"',
          'Upgrade-Insecure-Requests': '1'
        }
      });
      await installSafeRequestInterceptor(context);

      const page = await context.newPage();
      
      // Basic humanization pre-navigation
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] }); // fake plugins
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      });

      // Stage 1: Navigation
      console.log(`[SERVER] Stage 1: Navigating to ${url}`);
      try {
        // Human-like pre-interaction for some sites
        if (url.includes('amazon.') || url.includes('sharafdg.') || url.includes('noon.')) {
           await page.goto(new URL(url).origin, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
           await randomDelay(1500, 3000);
        }

        await page.goto(url, { 
          waitUntil: 'domcontentloaded', 
          timeout: 45000 
        });

        // Check for Amazon "We're sorry" block
        let isAmazonError = await page.evaluate(() => {
          return document.title.includes('Bot Check') || (document.body.innerText.includes("We're sorry") && document.body.innerText.includes("An error occurred when we tried to process your request"));
        });

        if (isAmazonError) {
          console.warn("[SERVER] Amazon error page ('We're sorry') detected! Attempting to reload and bypass...");
          await context.clearCookies();
          await randomDelay(3000, 5000);
          
          await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-GB,en;q=0.9',
            'sec-ch-ua': '"Microsoft Edge";v="125", "Chromium";v="125", "Not.A/Brand";v="24"',
            'sec-ch-ua-platform': '"Windows"'
          });
          
          // Bypassing cache 
          await page.goto(url + (url.includes('?') ? '&' : '?') + `_retry=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
          
          isAmazonError = await page.evaluate(() => {
            return document.title.includes('Bot Check') || (document.body.innerText.includes("We're sorry") && document.body.innerText.includes("An error occurred when we tried to process your request"));
          });
          
          if (isAmazonError) {
             console.log("[SERVER] Playwright reload failed. Attempting pure fetch callback as Googlebot...");
             try {
                const fetchResult = await fetchSafeExternal(url, {
                  headers: {
                    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_7_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Mobile/15E148 Safari/604.1 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5'
                  }
                });
                if (fetchResult.ok) {
                   const text = await fetchResult.text();
                   await page.setContent(text);
                   isAmazonError = false;
                }
             } catch(err) {
                console.error("[SERVER] Googlebot fetch also failed:", err);
             }
             
             if (isAmazonError) {
                // Return whatever content was there, sometimes it is enough for basic title extraction, or throw error.
                // But let's try not to throw an error immediately, or keep the throw but with a more detailed message.
                throw new Error("Amazon blocked the request with an anti-bot Error Page. Both Playwright and Fetch failed.");
             }
          }
        }
      } catch (e) {
        const navErr = e as Error;
        console.warn(`[SERVER] Navigation primary attempt failed: ${navErr.message}`);
        // Fallback for protocol errors or timeouts
        if (navErr.message.includes('ERR_HTTP2_PROTOCOL_ERROR') || navErr.message.includes('timeout') || navErr.message.includes('503')) {
           console.log("[SERVER] Retrying with networkidle and extra delay...");
           await randomDelay(3000, 5000);
           await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 }).catch((err: any) => {
             throw new Error(`Critical Navigation Failure: ${err.message}`);
           });
        } else {
           throw e;
        }
      }

      // Look for Cloudflare / bot checks
      const botCheck = await page.evaluate(() => {
        const text = document.body.innerText.toLowerCase();
        return text.includes('captcha') || 
               text.includes('robot check') || 
               text.includes('automated access') ||
               text.includes('security verification') ||
               text.includes('challenges.cloudflare.com') ||
               text.includes('verifies you are not a bot');
      });

      if (botCheck) {
        console.log("[SERVER] Bot check detected! Simulating human delay before proceeding...");
        // Emulate human reading text
        await randomDelay(4000, 7000);
        // Emulate random mouse movement
        await page.mouse.move(Math.random() * 500, Math.random() * 500);
        await randomDelay(500, 1500);
        await page.mouse.click(Math.random() * 500, Math.random() * 500);
        await randomDelay(3000, 5000);
        
        // Wait to see if the challenge resolves itself automatically
        await page.waitForNavigation({ timeout: 15000, waitUntil: 'domcontentloaded' }).catch(() => {});
        
        // Final sanity check
        await randomDelay(2000, 4000);
      }

      // Check for Amazon "Continue shopping" or generic "click to continue" buttons
      const continueBtn = await page.$('a:has-text("Continue shopping"), button:has-text("Continue shopping"), input[value="Continue shopping"], button:has-text("Click to continue")');
      if (continueBtn) {
        console.log("[SERVER] 'Continue shopping' button detected, attempting click...");
        await continueBtn.click();
        await randomDelay(2000, 4000);
        // Wait for potential navigation after click
        await page.waitForLoadState('domcontentloaded').catch(() => {});
      }

      // Deep Scroll Logic with Dynamic Height Awareness
      if (deepScroll) {
        console.log("[SERVER] Executing Human-like Deep Scroll...");
        await page.evaluate(async () => {
          await new Promise((resolve) => {
            let totalHeight = 0;
            const scrollInterval = setInterval(() => {
              // Variable distance per scroll
              const distance = Math.floor(Math.random() * 300) + 200; 
              const scrollHeight = document.body.scrollHeight;
              window.scrollBy(0, distance);
              totalHeight += distance;
              
              if (totalHeight >= scrollHeight || totalHeight > 25000) {
                clearInterval(scrollInterval);
                resolve(true);
              }
            }, Math.floor(Math.random() * 150) + 100); // Variable interval
          });
        });
        await randomDelay(2000, 3000); // Allow lazy components to settle
      } else {
        await randomDelay(2000, 3500);
      }
      
      // Stage 2: Wait for content if selector provided
      if (selector) {
        console.log(`[SERVER] Stage 2: Waiting for selector: ${selector}`);
        try {
          await page.waitForSelector(selector, { timeout: 15000 });
        } catch (e) {
          console.warn(`[SERVER] Selector ${selector} not found within timeout, proceeding with current state.`);
        }
      }

      // Stage 3: Shadow DOM Piercing Extraction
      console.log(`[SERVER] Stage 3: Extracting DOM with Shadow DOM piercing`);
      
      const piercedHtml = (await page.evaluate(`
        (() => {
          const getShadowContent = (root) => {
            let html = "";
            const nodes = (root instanceof Element && root.shadowRoot) 
              ? Array.from(root.shadowRoot.childNodes) 
              : Array.from(root.childNodes);

            for (let i = 0; i < nodes.length; i++) {
              const node = nodes[i];
              if (node.nodeType === 1) { // ELEMENT_NODE
                const el = node;
                const tag = el.tagName.toLowerCase();
                if (['script', 'style', 'iframe', 'noscript', 'nav', 'footer'].includes(tag)) continue;
                
                let attributes = "";
                for (let j = 0; j < el.attributes.length; j++) {
                  const attr = el.attributes[j];
                  attributes += ' ' + attr.name + '="' + attr.value + '"';
                }
                
                html += '<' + tag + attributes + '>';
                html += getShadowContent(el);
                html += '</' + tag + '>';
              } else if (node.nodeType === 3) { // TEXT_NODE
                html += (node.textContent || '');
              }
            }
            return html;
          };
          return getShadowContent(document.body);
        })()
      `)) as string;
      const html = await page.content(); // Still get full page for original fallback
      const pageTitle = await page.title() || "Untitled Product";

      // Stage 4: Visual Layer Capture
      let screenshotBase64 = null;
      if (enableScreenshot) {
        console.log(`[SERVER] Stage 4: Capturing visual snapshot`);
        const screenshot = await page.screenshot({ type: 'jpeg', quality: 60 });
        screenshotBase64 = screenshot.toString('base64');
      }

      // Stage 4.1: Check for Amazon specific 503 or Captcha in content
      const isAmazon = url.includes('amazon.');
      const isBlocked = html.includes('Service Unavailable') || 
                       html.includes('Robot Check') || 
                       html.includes('api-services-support@amazon.com') ||
                       (isAmazon && html.length < 5000 && !html.includes('nav-logo')); // Very small page on Amazon is usually a block
      
      if (isBlocked) {
        console.warn(`[SERVER] Detected potential block/503 on ${url}. Content length: ${html.length}`);
        if (isAmazon && html.includes('Robot Check')) {
           throw new Error("Amazon blocked the request with a Captcha/Robot Check. Try again in a few minutes or use a different URL.");
        }
      }

      // CLEANUP Browser Resources
      await context.close();
      context = null;

      // Use shadow-pierced HTML for visual body extraction, but full HTML for JSON-LD/meta.
      const $shadow = cheerio.load(piercedHtml || html);
      const $full = cheerio.load(html);
      let bodyHtml = "";
      let rawBodyHtml = "";
      
      const isJsonLd = strategy === 'JsonLdExtractionStrategy';
      const isWholeCapture = strategy === 'WholeCaptureStrategy';

      if (isWholeCapture) {
        console.log(`[SERVER] Using Whole Capture Extraction strategy`);
        const wholeCaptureSourceHtml = piercedHtml || html;

        const $rawWhole = cheerio.load(wholeCaptureSourceHtml);
        let $rawBody: any = $rawWhole('body').first();
        if ($rawBody.length === 0) {
          $rawBody = $rawWhole.root() as any;
        }
        sanitizeWholeCaptureRoot($rawBody, 'raw');
        rawBodyHtml = $rawBody.html() || wholeCaptureSourceHtml;

        const $structuredWhole = cheerio.load(wholeCaptureSourceHtml);
        let $structuredBody: any = $structuredWhole('body').first();
        if ($structuredBody.length === 0) {
          $structuredBody = $structuredWhole.root() as any;
        }
        sanitizeWholeCaptureRoot($structuredBody, 'structured');
        bodyHtml = $structuredBody.html() || rawBodyHtml;
      } else if (isJsonLd) {
        console.log(`[SERVER] Using JSON-LD Extraction strategy`);
        const jsonLdScripts = $full('script[type="application/ld+json"]');
        if (jsonLdScripts.length > 0) {
          jsonLdScripts.each((i, el) => {
            bodyHtml += `<pre>${$full(el).html()}</pre>\n`;
          });
        } else {
          // Fallback to meta tags if no JSON-LD found
          const metaTags = $full('meta[property^="og:"], meta[name="description"]');
          if (metaTags.length > 0) {
            metaTags.each((i, el) => {
              const content = $full(el).attr('content');
              const name = $full(el).attr('name') || $full(el).attr('property');
              bodyHtml += `<p><strong>${name}:</strong> ${content}</p>\n`;
            });
          }
          if (!bodyHtml) bodyHtml += "<p>No JSON-LD or meaningful Meta tags found.</p>\n";
        }
      }
      
      if (selector && !isWholeCapture) {
        console.log(`[SERVER] Processing selector: ${selector}`);
        try {
          const matches = $shadow(selector);
          if (matches.length > 0) {
            matches.each((i, el) => {
              const $el = $shadow(el);
              $el.find('script, style, iframe, noscript, footer, nav, .ads, .promo, .popup, .modal').remove();
              $el.find('*').removeAttr('class').removeAttr('id').removeAttr('style').removeAttr('data-test');
              bodyHtml += $el.html() + "\n";
            });
          } else {
            bodyHtml += `<p>No content found for selector: ${selector}</p>\n`;
          }
        } catch (err: any) {
          console.warn(`[SERVER] Invalid selector provided or error parsing selector: ${err.message}`);
          bodyHtml += `<p>Invalid CSS Selector provided: ${selector}</p>\n`;
        }
      } else if (selector && isWholeCapture) {
        console.log(`[SERVER] Ignoring selector narrowing for Whole Capture strategy: ${selector}`);
      } else if (!isJsonLd && !isWholeCapture) {
        let contentRoot = $shadow('main, article, #product, .product, #main-content');
        if (contentRoot.length === 0) contentRoot = $shadow('body');
        contentRoot.find('script, style, iframe, noscript, .ads, .promo, footer, nav, .popup, .modal').remove();
        contentRoot.find('*').removeAttr('class').removeAttr('id').removeAttr('style');
        bodyHtml += contentRoot.html() || "";
      }

      let markdown = convertHtmlToMarkdown(bodyHtml);
      let rawMarkdown = isWholeCapture ? convertHtmlToMarkdown(rawBodyHtml || bodyHtml) : null;

      let highQualityImageSection = "";

      // Base media discovery keeps existing behavior for downstream consumers.
      const imageUrls: string[] = [];
      const $extracted = $full;
      $extracted('img').each((i, el) => {
        const src = $extracted(el).attr('src');
        const dataSrc = $extracted(el).attr('data-src');
        const srcset = $extracted(el).attr('srcset');
        const dataOldHires = $extracted(el).attr('data-old-hires');
        const dataZoomImage = $extracted(el).attr('data-zoom-image');
        const dataLargeImage = $extracted(el).attr('data-large-image');
        const dataDynamicImage = $extracted(el).attr('data-a-dynamic-image');

        [src, dataSrc, dataOldHires, dataZoomImage, dataLargeImage].forEach(val => {
          if (!val) return;
          const normalized = normalizeImageUrl(val, url);
          if (normalized && !imageUrls.includes(normalized)) {
            imageUrls.push(normalized);
          }
        });

        if (srcset) {
          extractUrlsFromSrcset(srcset).forEach((srcsetUrl) => {
            const normalized = normalizeImageUrl(srcsetUrl, url);
            if (normalized && !imageUrls.includes(normalized)) {
              imageUrls.push(normalized);
            }
          });
        }
        
        if (dataDynamicImage) {
           try {
              const parsed = JSON.parse(dataDynamicImage);
              Object.keys(parsed).forEach(imgUrl => {
                 const normalized = normalizeImageUrl(imgUrl, url);
                 if (normalized && !imageUrls.includes(normalized)) {
                   imageUrls.push(normalized);
                 }
              });
           } catch(e) {}
        }
      });

      const ogImage = $extracted('meta[property="og:image"]').attr('content');
      const twitterImage = $extracted('meta[name="twitter:image"], meta[property="twitter:image"]').attr('content');
      const itempropImage = $extracted('meta[itemprop="image"]').attr('content');

      [ogImage, twitterImage, itempropImage].forEach((metaImg) => {
        if (!metaImg) return;
        const normalized = normalizeImageUrl(metaImg, url);
        if (normalized && !imageUrls.includes(normalized)) {
          imageUrls.push(normalized);
        }
      });

      if (imageUrls.length > 0) {
        markdown += "\n\n### MEDIA SOURCE ASSETS (PLAINTEXT URLs):\n" + imageUrls.join('\n');
        if (rawMarkdown) {
          rawMarkdown += "\n\n### MEDIA SOURCE ASSETS (PLAINTEXT URLs):\n" + imageUrls.join('\n');
        }
      }

      if (isJsonLd) {
        const jsonLdImageCandidates: string[] = [];
        $extracted('script[type="application/ld+json"]').each((_, el) => {
          const rawJsonLd = $extracted(el).html();
          if (!rawJsonLd) return;
          try {
            const parsed = JSON.parse(rawJsonLd);
            collectImageUrlsFromJsonLdValue(parsed, jsonLdImageCandidates);
          } catch {
            // Ignore malformed JSON-LD blocks and continue processing.
          }
        });

        const trustedImageUrls = new Set(imageUrls);
        const highQualityUrls = rankHighQualityImageUrls([...imageUrls, ...jsonLdImageCandidates], url, trustedImageUrls);
        if (highQualityUrls.length > 0) {
          highQualityImageSection = "## High Quality Product Image URLs\n" + highQualityUrls.join('\n');
          markdown += "\n\n" + highQualityImageSection;
        }
      }

      if (isWholeCapture) {
        markdown = buildWholeCaptureDocument({
          pageTitle,
          url,
          sectionTitle: 'Structured Page Capture',
          contentMarkdown: markdown,
        });
        rawMarkdown = buildWholeCaptureDocument({
          pageTitle,
          url,
          sectionTitle: 'Raw Page Capture',
          contentMarkdown: rawMarkdown || markdown,
        });
      }

      let aiResult = null;
      if (extractWithAI && markdown && aiCreditsClient) {
        const aiResponse = await aiCreditsClient.chat.completions.create({
          messages: [
            {
              role: "system",
              content: "You are a professional Product Data Architect. Extract technical specifications into highly detailed Markdown tables."
            },
            {
              role: "user",
              content: `SOURCE TITLE: ${pageTitle}\n\nPAGE CONTENT:\n${markdown}`
            }
          ],
          model: "deepseek/deepseek-v4-flash",
        });
        aiResult = aiResponse.choices[0]?.message?.content;
        if (aiResult && highQualityImageSection && !aiResult.includes('## High Quality Product Image URLs')) {
          aiResult += "\n\n" + highQualityImageSection;
        }
      }

      return { markdown, rawMarkdown, aiResult, imageUrls, screenshotBase64, pageTitle, url, strategy };
    } catch (error: any) {
      if (context) {
        try {
          await context.close();
        } catch (closeError) {
          const closeErr = closeError as Error;
          console.error(`[SERVER] Failed to close context: ${closeErr.message}`);
        }
      }
      throw error;
    }
  }

  function sanitizeUrl(inputUrl: string): string {
    if (!inputUrl) return inputUrl;
    let u = inputUrl.trim();
    if (!/^https?:\/\//i.test(u)) {
      u = 'https://' + u;
    }
    return u;
  }

  async function fetchSafeExternal(inputUrl: string, init?: RequestInit): Promise<Response> {
    let currentUrl = sanitizeUrl(inputUrl);
    for (let redirectCount = 0; redirectCount <= 5; redirectCount++) {
      await assertSafeTargetUrl(currentUrl);
      const response = await fetch(currentUrl, { ...(init || {}), redirect: 'manual' });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) return response;
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }
      await assertSafeTargetUrl(response.url || currentUrl);
      return response;
    }
    throw new Error('Too many redirects while fetching external URL');
  }

  // API Route for scraping — non-blocking async (returns 202 + jobId).
  // Clients poll GET /api/queue/:jobId until completed then read .result.
  app.post("/api/scrape", requireAuth, validateRequest(ScrapeRequestSchema), async (req, res) => {
    let { url, selector, extractWithAI, enableScreenshot, sku, strategy, deepScroll, secondaryTarget } = req.body;

    if (!url) {
      return res.status(400).json({ error: "URL is required" });
    }

    try {
      try { new URL(sanitizeUrl(url)); } catch (e) { return res.status(400).json({ error: "Invalid URL format" }); }
      await assertSafeTargetUrl(sanitizeUrl(url));
      if (secondaryTarget?.url) {
        const safeSecondaryUrl = sanitizeUrl(secondaryTarget.url);
        try { new URL(safeSecondaryUrl); } catch (e) { return res.status(400).json({ error: "Invalid secondary URL format" }); }
        await assertSafeTargetUrl(safeSecondaryUrl);
      }

      const primaryJob = jobQueue.enqueue('scrape', {
        url: sanitizeUrl(url), selector, extractWithAI, enableScreenshot, strategy, deepScroll, sku,
        secondaryTarget: secondaryTarget && secondaryTarget.url
          ? { url: sanitizeUrl(secondaryTarget.url), selector: secondaryTarget.selector || selector, strategy: secondaryTarget.strategy || strategy }
          : undefined,
      });
      return res.status(202).json({
        jobId: primaryJob.id,
        status: 'queued',
        statusUrl: `/api/queue/${primaryJob.id}`,
      });
    } catch (error: any) {
      if (error?.name === 'BusyError' || error?.statusCode === 503) {
        return res.status(503).json({ error: 'Queue overloaded. Please retry shortly.' });
      }
      console.error(`[SERVER] Scrape enqueue failed: ${error.message}`);
      return res.status(error?.statusCode || 500).json({ error: "Enqueue Error", details: error.message });
    }
  });

  // API Route for Discovery Mode — non-blocking async (returns 202 + jobId).
  app.post("/api/discover", requireAuth, validateRequest(DiscoverRequestSchema), async (req, res) => {
    let { url, linkSelector } = req.body;
    if (!url) return res.status(400).json({ error: "URL is required" });
    url = sanitizeUrl(url);
    try { new URL(url); } catch(e) { return res.status(400).json({ error: "Invalid URL format" }); }
    try {
      await assertSafeTargetUrl(url);
      const job = jobQueue.enqueue('discover', { url, linkSelector });
      return res.status(202).json({ jobId: job.id, status: 'queued', statusUrl: `/api/queue/${job.id}` });
    } catch (error: any) {
      if (error?.name === 'BusyError' || error?.statusCode === 503) {
        return res.status(503).json({ error: 'Queue overloaded. Please retry shortly.' });
      }
      return res.status(error?.statusCode || 500).json({ error: "Discovery Error", details: error.message });
    }
  });

  async function performInspection(url: string, deepScroll: boolean) {
    let context: any = null;
    try {
      console.log(`[SERVER] Inspection Started: ${url}`);
      const browserInstance = await getBrowser();
      context = await browserInstance.newContext();
      await installSafeRequestInterceptor(context);
      const page = await context.newPage();
      
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      });

      // Human-like pre-interaction
      if (url.includes('amazon.') || url.includes('sharafdg.') || url.includes('noon.')) {
         await page.goto(new URL(url).origin, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
         await randomDelay(1500, 3000);
      }

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      
      // Basic robot check
      const botCheck = await page.evaluate(() => {
        const text = document.body.innerText.toLowerCase();
        return text.includes('captcha') || 
               text.includes('robot check') || 
               text.includes('automated access') ||
               text.includes('security verification') ||
               text.includes('challenges.cloudflare.com');
      });

      if (botCheck) {
        console.log("[SERVER] Bot check detected in inspection! Simulating delay...");
        await randomDelay(4000, 7000);
        await page.mouse.move(Math.random() * 500, Math.random() * 500);
        await randomDelay(1500, 3000);
        await page.waitForNavigation({ timeout: 15000, waitUntil: 'domcontentloaded' }).catch(() => {});
      }

      if (deepScroll) {
        await page.evaluate(async () => {
          await new Promise((resolve) => {
            let totalHeight = 0;
            const distance = 500;
            const timer = setInterval(() => {
              const scrollHeight = document.body.scrollHeight;
              window.scrollBy(0, distance);
              totalHeight += distance;
              if (totalHeight >= 2000 || totalHeight >= scrollHeight) { // Limit inspection scroll to 2000px
                clearInterval(timer);
                resolve(true);
              }
            }, Math.floor(Math.random() * 200) + 100);
          });
        });
      }

      await randomDelay(1500, 2500);

      const pageInfo = (await page.evaluate(`
        (() => {
          const title = document.title;
          const meta = Array.from(document.querySelectorAll('meta')).map(m => ({
            name: m.getAttribute('name') || m.getAttribute('property'),
            content: m.getAttribute('content')
          })).filter(m => m.name);

          // Compact DOM Tree for LLM Analysis
          const elementsList = [];
          const walk = (node, depth = 0) => {
            if (depth > 8) return; // Limit depth
            if (node.nodeType !== 1) return; // Must be element
            
            const tag = node.tagName.toLowerCase();
            const importantTags = ['main', 'article', 'section', 'div', 'h1', 'h2', 'h3', 'table', 'ul', 'li', 'span', 'p'];
            
            if (importantTags.includes(tag)) {
              const className = node.className;
              const id = node.id;
              const textContent = (node.innerText || "").trim().substring(0, 50);
              
              if (textContent || node.children.length > 0) {
                elementsList.push({
                  tag,
                  class: typeof className === 'string' ? className.substring(0, 100) : '',
                  id: id || '',
                  text: textContent,
                  depth
                });
              }
            }

            Array.from(node.children).forEach(child => walk(child, depth + 1));
          };

          walk(document.body);
          return { title, meta, elements: elementsList.slice(0, 500) }; // Limit to top 500 elements
        })()
      `)) as any;

      const screenshot = await page.screenshot({ type: 'jpeg', quality: 50 });
      const screenshotBase64 = screenshot.toString('base64');

      await context.close();
      return { success: true, ...pageInfo, screenshot: `data:image/jpeg;base64,${screenshotBase64}` };
    } catch (error: any) {
      if (context) await context.close();
      throw error;
    }
}


  app.post("/api/inspect", requireAuth, async (req, res) => {
    try {
      let url = req.body.url;
      if (!url) return res.status(400).json({ error: "URL is required" });
      url = sanitizeUrl(url);
      try { new URL(url); } catch(e) { return res.status(400).json({ error: "Invalid URL format" }); }
      await assertSafeTargetUrl(url);
      const job = jobQueue.enqueue('inspect', { url, deepScroll: req.body.deepScroll });
      return res.status(202).json({ jobId: job.id, status: 'queued', statusUrl: `/api/queue/${job.id}` });
    } catch (error: any) {
      if (error?.name === 'BusyError' || error?.statusCode === 503) {
        return res.status(503).json({ error: 'Queue overloaded. Please retry shortly.' });
      }
      return res.status(error?.statusCode || 500).json({ error: "Inspection failed", details: error.message });
    }
  });

  app.post("/api/analyze", requireAuth, validateRequest(AnalyzeRequestSchema), async (req, res) => {
    const { url, deepScroll } = req.body;
    try {
        if (!url) return res.status(400).json({ error: "URL is required" });
        const safeUrl = sanitizeUrl(url);
        try { new URL(safeUrl); } catch(e) { return res.status(400).json({ error: "Invalid URL format" }); }
        await assertSafeTargetUrl(safeUrl);
        // Start inspection job and wait for it (analysis requires the full DOM inspection result)
        const analyzeJob = jobQueue.enqueue('inspect', { url: safeUrl, deepScroll });
        console.log(`[ANALYZE] Enqueued inspect job ${analyzeJob.id} for ${safeUrl}`);
        const completedAnalyze = await jobQueue.waitForJob(analyzeJob.id, 120_000);
        if (completedAnalyze.status !== 'completed') {
          throw Object.assign(new Error(completedAnalyze.error || 'Inspection failed'), { statusCode: 500 });
        }
        const data = completedAnalyze.result as Awaited<ReturnType<typeof performInspection>>;
        
        const prompt = `
            You are a Web Scraping Expert. Analyze the following DOM structure and metadata from a product page.
            GOAL: Identify the most robust CSS selectors for the following fields:
            1. Product Name (Title)
            2. Price
            3. Main Image
            4. Descriptions / Bullets
            5. Specifications Table / Container
            
            PREFER CSS module selectors that contain these patterns if they exist:
            - ProductTitle-module-scss-module__
            - ProductDetailsDesktop-module-scss-module__
            - OverviewTab-module-scss-module__
            - SpecificationsTab-module-scss-module__
            
            PAGE TITLE: ${data.title}
            METADATA: ${JSON.stringify(data.meta)}
            DOM ELEMENTS (Simplified): ${JSON.stringify(data.elements)}
            
            Return a JSON object with:
            - "selectors": string (a comma separated list of all relevant selectors to capture as much data as possible, e.g. "h1, .price, #description")
            - "strategy": string ("AIExtractionStrategy", "JsonLdExtractionStrategy", or "WholeCaptureStrategy" - choose based on what looks most robust)
            - "reasoning": string (short description of why these were chosen)
        `;

        const aiClient = await resolveAICreditsClient();
        if (!aiClient) {
          throw new Error("AI Credits API Key is not configured. Please add it in Connectivity settings.");
        }

        const chatCompletion = await aiClient.chat.completions.create({
            messages: [{ role: "user", content: prompt }],
            model: "deepseek/deepseek-v4-flash",
            response_format: { type: "json_object" }
        });

        const text = chatCompletion.choices[0]?.message?.content || "{}";
        const result = JSON.parse(text);

        res.json({ ...data, ...result });
    } catch (error: any) {
        res.status(error?.statusCode || 500).json({ error: "Analysis failed", details: error.message });
    }
  });

  app.get("/api/pdf/:sku", requireAuth, async (req, res) => {
    try {
      const idx = await dbService.getSkuIndex();
      const record = idx.find((r: any) => (r.sku || r.SKU)?.toString() === req.params.sku.toString());
      if (record && record.pdf_text) {
        return res.json({ sku: req.params.sku, text: record.pdf_text });
      }
      res.status(404).json({ error: "PDF text not found for this SKU" });
    } catch(e) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/jobs", requireAuth, async (req, res) => {
    try {
      const cursor = req.query.cursor as string | undefined;
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const search = req.query.search as string | undefined;

      const { items: skus, nextCursor, hasMore, total } = await dbService.listSkusPaginated({
        cursor,
        limit,
        search,
      });

      // Per-item status checks bounded to the current page — O(page_size) not O(n)
      const jobs = (await Promise.all(skus.map(async (product: any) => {
        const rawSku = (product.sku || product.SKU || '').toString();
        if (!rawSku) return null;
        const safeSku = rawSku.replace(/[^a-z0-9_-]/gi, '_');
        const hasPdf = !!product.pdf_text;
        const hasSapData = !!product.sap_data;

        const [hasHarvest, output] = await Promise.all([
          dbService.harvestExists(safeSku),
          dbService.getOutput(safeSku),
        ]);
        const outputExists = !!output;

        return {
          ...product,
          status: outputExists
            ? 'completed'
            : (hasHarvest || hasPdf || hasSapData ? 'ready' : 'pending'),
          harvestFile: hasHarvest ? `${safeSku}.md` : null,
          hasPdf,
          hasSapData,
        };
      }))).filter(Boolean);

      res.json({ items: jobs, nextCursor, hasMore, total });
    } catch (e) {
      res.json([]);
    }
  });

  app.post("/api/jobs/run", requireAuth, async (req, res) => {
    const { sku, attributeSetName, aiModel } = req.body;
    if (!sku) return res.status(400).json({ error: "SKU required" });
    try {
      const job = jobQueue.enqueue('run_job', { sku, attributeSetName, aiModel });
      return res.status(202).json({
        jobId: job.id,
        status: 'queued',
        statusUrl: `/api/queue/${job.id}`,
      });
    } catch (err: any) {
      if (err?.name === 'BusyError' || err?.statusCode === 503) {
        return res.status(503).json({ error: 'Queue overloaded. Please retry shortly.' });
      }
      console.error(`[AI_JOB] Enqueue failure for SKU ${sku}:`, err.message);
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Queue monitoring endpoints ─────────────────────────────────────────────
  app.get('/api/queue/stats', requireAuth, (_req, res) => {
    res.json(jobQueue.getStats());
  });

  app.get('/api/queue/:jobId', requireAuth, (req, res) => {
    const job = jobQueue.getJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json(job);
  });

  // Browser health-check/diagnostics endpoint — visits example.com and returns status
  app.get('/api/diagnostics/browser', requireAuth, async (_req, res) => {
    const start = Date.now();
    let browser: any = null;
    let context: any = null;
    try {
      browser = await getBrowser();
      context = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await context.newPage();
      const resp = await page.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: 20_000 });
      const title = await page.title();
      const finalUrl = page.url();
      await context.close();
      return res.json({
        ok: true,
        engine: (browser as any)?._initializer?.name ?? 'unknown',
        status: resp?.status() ?? null,
        url: finalUrl,
        title,
        durationMs: Date.now() - start,
      });
    } catch (err: any) {
      if (context) { try { await context.close(); } catch {} }
      return res.status(500).json({ ok: false, error: err.message, durationMs: Date.now() - start });
    }
  });
  // ─────────────────────────────────────────────────────────────────────────

  app.post("/api/outputs/:sku", requireAuth, async (req, res) => {
    try {
      const sku = requireSafeStorageKey(req.params.sku);
      const data = req.body;
      await dbService.saveOutput(sku, data);
      res.json({ success: true });
    } catch (e: any) {
      res.status(e?.statusCode || 500).json({ error: "Failed to update output", details: e?.message });
    }
  });

  app.delete("/api/outputs/:sku", requireAuth, requireAdminRole, async (req, res) => {
    try {
      const sku = requireSafeStorageKey(req.params.sku);
      await dbService.deleteOutput(sku);
      res.json({ success: true });
    } catch (e: any) {
      res.status(e?.statusCode || 500).json({ error: "Delete failed", details: e?.message });
    }
  });

  app.get("/api/outputs/json/:filename", requireAuth, async (req, res) => {
    try {
      const { filename } = req.params;
      const sku = filename.replace('.json', '');
      const output = await dbService.getOutput(sku);
      if (output) {
        res.json(output);
      } else {
        res.status(404).json({ error: "File not found" });
      }
    } catch (e) {
      const err = e as any;
      res.status(err?.statusCode || 500).json({ error: "Failed to read output", details: err?.message });
    }
  });

  app.get("/api/outputs/xlsx", requireAuth, async (req, res) => {
    try {
      const skusQuery = req.query.skus ? (req.query.skus as string).split(',') : null;
      let rows = await dbService.listOutputs();

      if (skusQuery) {
        const safeQuerySkus = skusQuery.map(s => s.toString().replace(/[^a-z0-9_-]/gi, '_'));
        rows = rows.filter(r => {
          const skuVal = r.SKU || r.sku || '';
          const safeSku = skuVal.toString().replace(/[^a-z0-9_-]/gi, '_');
          return safeQuerySkus.includes(safeSku);
        });
      }
      
      const settings = await loadSettings();
      let predefinedHeaders: string[] = [];
      const addedKeys = new Set<string>();

      // Collect all keys that actually exist in the rows
      const actualKeysInRows = new Set<string>();
      rows.forEach(r => Object.keys(r).forEach(k => actualKeysInRows.add(k)));

      // Ensure SKU comes first, if it exists in the data across
      predefinedHeaders.push("SKU");
      addedKeys.add("SKU");
      addedKeys.add("sku");

      // We ONLY add fields from attributeSets IF they actually exist in the rows
      if (settings.attributeSets && settings.attributeSets.length > 0) {
        settings.attributeSets.forEach((set: any) => {
          set.fields?.forEach((field: string) => {
            const lowerF = field.toLowerCase();
            const existsInRows = Array.from(actualKeysInRows).some(k => k.toLowerCase() === lowerF);
            
            if (existsInRows && !addedKeys.has(lowerF)) {
               addedKeys.add(lowerF);
               predefinedHeaders.push(field);
            }
          });
        });
      }

      // Ensure data keys match predefined headers case and gather any missing keys
      rows.forEach(r => {
         Object.keys(r).forEach(k => {
            const lowerK = k.toLowerCase();
            const existingHeader = predefinedHeaders.find(h => h.toLowerCase() === lowerK);
            
            if (!existingHeader) {
               predefinedHeaders.push(k);
               addedKeys.add(lowerK);
            } else if (existingHeader !== k) {
               // Normalise key case in row to match predefined header so json_to_sheet matches correctly
               r[existingHeader] = r[k];
               delete r[k];
            }
         });
      });
      
      const buf = await buildXlsxBuffer(rows, predefinedHeaders);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename=CMS_Upload_Master.xlsx');
      res.send(buf);
    } catch (e: any) {
      console.error('Error generating report:', e);
      res.status(500).json({ error: "Failed to generate report", details: e?.message });
    }
  });

  let currentAIClient: OpenAI | null = aiCreditsClient;
  const defaultSettings: ServerSettings = {
    title: '',
    bullets: '',
    description: '',
    keywords: '',
    aiCreditsApiKey: '',
    globalMappingLogic: '',
    attributeSets: [],
    selectorPresets: [],
    plpSelectorPresets: [],
  };

  async function loadSettings(): Promise<ServerSettings> {
    try {
      const rawSettings = await dbService.getSettings();
      if (!rawSettings || typeof rawSettings !== 'object') {
        return defaultSettings;
      }

      const typedSettings = rawSettings as Partial<ServerSettings>;
      return {
        ...defaultSettings,
        ...typedSettings,
        attributeSets: Array.isArray(typedSettings.attributeSets) ? typedSettings.attributeSets : [],
        selectorPresets: Array.isArray(typedSettings.selectorPresets) ? typedSettings.selectorPresets : [],
        plpSelectorPresets: Array.isArray(typedSettings.plpSelectorPresets) ? typedSettings.plpSelectorPresets : [],
      };
    } catch (e) {
      return defaultSettings;
    }
  }

  async function resolveAICreditsClient(settingsOverride?: any) {
    const settings = settingsOverride || await loadSettings();
    const persistedClient = buildAICreditsClient(settings?.aiCreditsApiKey);
    if (persistedClient) {
      currentAIClient = persistedClient;
      return currentAIClient;
    }

    currentAIClient = aiCreditsClient;
    return aiCreditsClient;
  }
  // Public liveness/readiness probe — no auth required, safe for platform health checks
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, status: 'ok', ts: Date.now() });
  });

  app.get('/api/admin/status', (_req, res) => {
    res.json({ adminConfigured: true });
  });

  app.get('/api/health/firestore', requireAuth, (_req, res) => {
    try {
      const status = dbService.getFirestoreStatus();
      res.json({ success: true, firestore: status });
    } catch (e: any) {
      res.status(500).json({
        success: false,
        error: 'Failed to read Firestore health status',
        details: e?.message || 'unknown error'
      });
    }
  });

  app.post('/api/auth/login', validateRequest(LoginRequestSchema), async (req, res) => {
    const { email, accessCode } = req.body;
    const normalized = normalizeEmail(email);
    if (!verifyInternalAccessCode(accessCode, internalAccessCode)) {
      console.warn(`[SERVER] Failed login attempt for ${normalized} from ${req.ip}`);
      return res.status(401).json({ error: 'Invalid email or access code.' });
    }

    const user: any = await dbService.getAllowlistUser(normalized);
    if (!user) {
      console.warn(`[SERVER] Login attempt for non-allowlisted email ${normalized} from ${req.ip}`);
      return res.status(401).json({ error: 'Invalid email or access code.' });
    }

    // In production, signed sessions are mandatory.
    let cookieValue = normalized;
    let csrfToken: string | undefined;
    try {
      const { token, payload } = signSession({ email: normalized, role: user.role });
      cookieValue = token;
      csrfToken = generateCsrfToken(payload.sid);
    } catch {
      if (requireSignedSessions) {
        return res.status(500).json({ error: 'Session configuration error. Contact administrator.' });
      }
    }

    res.cookie(AUTH_COOKIE, cookieValue, {
      httpOnly: true,
      secure: cookieSecure,
      sameSite: cookieSameSite,
      path: '/',
      maxAge: SESSION_TTL_MS,
    });

    return res.json({
      success: true,
      user: { email: user.email, role: user.role === 'admin' ? 'admin' : 'user' },
      ...(csrfToken ? { csrfToken } : {}),
    });
  });

  app.post('/api/auth/logout', (_req, res) => {
    res.clearCookie(AUTH_COOKIE, {
      httpOnly: true,
      secure: cookieSecure,
      sameSite: cookieSameSite,
      path: '/',
    });
    return res.json({ success: true });
  });

  app.get('/api/auth/me', requireAuth, (req, res) => {
    const user: any = (req as any).authUser;
    const cookieValue = req.cookies?.[AUTH_COOKIE];
    const payload = typeof cookieValue === 'string' && isSignedToken(cookieValue)
      ? verifySession(cookieValue)
      : null;
    const csrfToken = payload ? generateCsrfToken(payload.sid) : undefined;

    return res.json({
      authenticated: true,
      user: {
        email: user.email,
        role: user.role === 'admin' ? 'admin' : 'user'
      },
      ...(csrfToken ? { csrfToken } : {}),
    });
  });

  app.get('/api/admin/users', requireAuth, requireAdminRole, async (_req, res) => {
    const users = await dbService.getAllowlist();
    users.sort((a: any, b: any) => a.email.localeCompare(b.email));
    res.json(users.map((u: any) => ({ email: u.email, role: u.role, addedAt: u.addedAt || null })));
  });

  app.post('/api/admin/users', requireAuth, requireAdminRole, validateRequest(AllowlistUpsertRequestSchema), async (req, res) => {
    const { email, role } = req.body;
    const normalized = normalizeEmail(email);
    await dbService.addAllowlistUser(normalized, role);
    return res.json({ success: true });
  });

  app.delete('/api/admin/users/:email', requireAuth, requireAdminRole, async (req, res) => {
    const email = normalizeEmail(req.params.email || '');
    if (!email) {
      return res.status(400).json({ error: 'Email is required.' });
    }

    const all = (await dbService.getAllowlist()) as any[];
    const admins = all.filter((u: any) => u.role === 'admin');
    const target: any = all.find((u: any) => u.email === email);
    if (!target) {
      return res.status(404).json({ error: 'User not found.' });
    }
    if (target.role === 'admin' && admins.length <= 1) {
      return res.status(400).json({ error: 'Cannot remove the last admin user.' });
    }

    await dbService.removeAllowlistUser(email);
    return res.json({ success: true });
  });

  app.post("/api/settings", requireAuth, requireAdminRole, validateRequest(SettingsRequestSchema), async (req, res) => {
    try {
      const settings = req.body;
      await dbService.saveSettings(settings);
      currentAIClient = buildAICreditsClient(settings.aiCreditsApiKey) || aiCreditsClient;
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: "Failed to save settings" });
    }
  });

  app.get("/api/settings", requireAuth, async (req, res) => {
    try {
      const settings = await dbService.getSettings();
      const user = (req as any).authUser;
      if (user?.role === 'admin') {
        return res.json(settings);
      }
      return res.json({ ...settings, aiCreditsApiKey: '' });
    } catch (e) {
      res.status(500).json({ error: "Failed to read settings" });
    }
  });

  app.post("/api/images/extract", requireAuth, validateRequest(ImageExtractRequestSchema), async (req, res) => {
    const { sku, url, screenshotEnabled } = req.body;
    if (!sku || !url) {
      return res.status(400).json({ error: "SKU and URL are required" });
    }

    try {
      const safeUrl = sanitizeUrl(url);
      await assertSafeTargetUrl(safeUrl);

      const result = await withBrowserTask(async () => {
      const b = await getBrowser();
      const context = await b.newContext({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        viewport: { width: 1920, height: 1080 }
      });
      await installSafeRequestInterceptor(context);
      const page = await context.newPage();

      // Block unnecessary resources to speed up page load but allow images
      await page.route("**/*", (route: any) => {
        const type = route.request().resourceType();
        if (["stylesheet", "font", "media"].includes(type)) {
          route.abort();
        } else {
          route.continue();
        }
      });

      console.log(`[IMAGE SOURCER] Navigating to ${url}...`);
      await page.goto(safeUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      
      // Wait a bit for dynamic images
      await delay(2000);
      
      let screenshotPath = null;
      const safeSku = requireSafeStorageKey(sku);

      if (screenshotEnabled) {
        const screenshotFilename = `${safeSku}_screenshot.png`;
        const localScreenshotPath = path.join(OUTPUTS_DIR, screenshotFilename);
        await page.screenshot({ path: localScreenshotPath, fullPage: true });
        screenshotPath = `/outputs/${screenshotFilename}`;
        console.log(`[IMAGE SOURCER] Saved screenshot to ${localScreenshotPath}`);
      }

      // Extract image candidates
      const extractedUrls = await page.evaluate(() => {
        const images = Array.from(document.querySelectorAll('img'));
        const urls = new Map<string, {area: number, isGallery: boolean, aspr: number, fullUrl: string}>();
        
        images.forEach(img => {
          const rect = img.getBoundingClientRect();
          let src = img.getAttribute('data-zoom-image') || img.getAttribute('data-large-image') || img.currentSrc || img.src || img.getAttribute('data-src');
          
          if (img.srcset) {
             const parts = img.srcset.split(',').map(p => p.trim());
             const largest = parts.pop()?.split(' ')[0];
             if (largest && (largest.startsWith('http') || largest.startsWith('//'))) {
               src = largest.startsWith('//') ? window.location.protocol + largest : largest;
             }
          }
          
          if (!src || (!src.startsWith('http') && !src.startsWith('//'))) return;
          if (src.startsWith('//')) src = window.location.protocol + src;
          
          const s = src.toLowerCase();
          if (s.includes('logo') || s.includes('icon') || s.includes('sprite') || s.includes('banner') || s.includes('rating') || s.includes('star') || s.includes('svg')) return;
          
          const area = rect.width * rect.height;
          const aspr = rect.width > 0 ? rect.height / rect.width : 1;
          const isGallery = img.closest('[class*="gallery"], [class*="slider"], [class*="carousel"], [class*="product-image"]') != null;
          
          if (area > 20000 || isGallery || img.hasAttribute('data-zoom-image')) {
            const urlObj = new URL(src, window.location.href);
            urlObj.hash = ''; // Remove hash
            const base = urlObj.origin + urlObj.pathname + urlObj.search;
            
            if (!urls.has(base) || area > urls.get(base)!.area) {
               urls.set(base, { area, isGallery, aspr, fullUrl: urlObj.toString() });
            }
         }
        });
        
        // Also find background images or linked images in galleries
        document.querySelectorAll('a[href*=".jpg"], a[href*=".jpeg"], a[href*=".png"], a[href*=".webp"]').forEach(a => {
           const isGallery = a.closest('[class*="gallery"], [class*="slider"]') != null;
           if (isGallery) {
              const src = (a as HTMLAnchorElement).href;
              try {
                const urlObj = new URL(src, window.location.href);
                const base = urlObj.origin + urlObj.pathname + urlObj.search;
                if (!urls.has(base)) {
                   urls.set(base, { area: 100000, isGallery: true, aspr: 1, fullUrl: src });
                }
              } catch(e){}
           }
        });

        // check og:image
        const ogImage = document.querySelector('meta[property="og:image"]');
        if (ogImage && ogImage.getAttribute('content')?.startsWith('http')) {
           const src = ogImage.getAttribute('content')!;
           try {
             const urlObj = new URL(src, window.location.href);
             const base = urlObj.origin + urlObj.pathname + urlObj.search;
             if (!urls.has(base)) {
                 urls.set(base, { area: 500000, isGallery: false, aspr: 1, fullUrl: src });
             }
           } catch(e){}
        }

        return Array.from(urls.values()).map(x => ({...x}));
      });

      await context.close();

      if (extractedUrls.length === 0) {
        throw new HttpError(404, `No product images found on URL${screenshotPath ? ` (screenshot: ${screenshotPath})` : ''}`);
      }

      console.log(`[IMAGE SOURCER] Found ${extractedUrls.length} image candidates. Evaluating quality...`);

      // Sort candidates by score (isGallery gives a boost, area directly adds)
      const sortedCandidates = extractedUrls.sort((a: any, b: any) => {
         const scoreA = a.area * (a.isGallery ? 3 : 1);
         const scoreB = b.area * (b.isGallery ? 3 : 1);
         return scoreB - scoreA;
      }).slice(0, 15); // limit to top 15

      const validImages = [];

      for (const cand of sortedCandidates) {
        try {
          const fetchRes = await fetchSafeExternal(cand.fullUrl);
          if (!fetchRes.ok) continue;

          const contentType = fetchRes.headers.get("content-type");
          if (!contentType || !contentType.startsWith("image/") || contentType.includes("svg")) {
             continue;
          }

          const arrayBuffer = await fetchRes.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          
          try {
            const metadata = await sharp(buffer).metadata();
            if (!metadata.width || !metadata.height) continue;

            const realWidth = metadata.width;
            const realHeight = metadata.height;
            const realAspr = realWidth / realHeight;

            // Strict product image rules
            if (realWidth < 300 || realHeight < 300) continue;
            if (realAspr > 2.5 || realAspr < 0.4) continue; // Skip extremely wide or tall images (banners)

            const sizeScore = realWidth * realHeight;

            validImages.push({
               buffer,
               url: cand.fullUrl,
               sizeScore
            });
          } catch (sharpErr) {
             continue;
          }
        } catch (err) {
          continue;
        }
      }

      if (validImages.length === 0) {
        throw new HttpError(404, `Could not download any valid high-quality product images${screenshotPath ? ` (screenshot: ${screenshotPath})` : ''}`);
      }

      // Sort by sizeScore descending
      validImages.sort((a, b) => b.sizeScore - a.sizeScore);

      // Keep up to 5 top images
      const finalImages = validImages.slice(0, 5);
      console.log(`[IMAGE SOURCER] Picked ${finalImages.length} images. Resizing and formatting...`);

      const responseImages = [];

      for (let i = 0; i < finalImages.length; i++) {
         const suffix = finalImages.length > 1 ? `-${i + 1}` : '';
         const outputFilename = `${safeSku}${suffix}.jpg`;
         const outputPath = path.join(IMAGES_DIR, outputFilename);

         await sharp(finalImages[i].buffer)
            .trim({ threshold: 10 }) // trim the empty space around the image
            .resize({
              width: 1500,
              height: 1500,
              fit: 'contain',
              background: { r: 255, g: 255, b: 255, alpha: 1 }
            })
            .flatten({ background: { r: 255, g: 255, b: 255 } })
            .jpeg({ quality: 90 })
            .toFile(outputPath);

         responseImages.push({
            sku: `${sku}${suffix}`,
            originalUrl: finalImages[i].url,
            imagePath: `/images/${outputFilename}`,
            screenshotPath: i === 0 ? screenshotPath : undefined
         });
      }

      console.log(`[IMAGE SOURCER] Saved ${finalImages.length} formatted images.`);

      return ({ 
        success: true, 
        images: responseImages
      });
      });

      res.json(result);

    } catch (error: any) {
      console.error("[IMAGE SOURCER] Error:", error);
      res.status(error?.statusCode || 500).json({ error: "Failed to extract image", details: error.message });
    }
  });

  app.post("/api/images/metadata", requireAuth, validateRequest(ImageMetadataRequestSchema), async (req, res) => {
    const requestedUrls = Array.isArray(req.body?.urls) ? req.body.urls : [];
    const uniqueUrls: string[] = Array.from(new Set<string>(requestedUrls.map((url: string) => sanitizeUrl(url)))).slice(0, 50);

    const images = await Promise.all(uniqueUrls.map(async (url) => {
      try {
        const response = await fetchSafeExternal(url, { method: 'HEAD' });
        const contentType = response.headers.get('content-type') || '';
        const length = Number(response.headers.get('content-length') || 0);

        return {
          url,
          bytes: Number.isFinite(length) && length > 0 ? length : null,
          contentType,
          ok: response.ok && (!contentType || (contentType.startsWith('image/') && !contentType.includes('svg'))),
        };
      } catch (error: any) {
        return {
          url,
          bytes: null,
          contentType: '',
          ok: false,
          error: error?.message || 'metadata unavailable',
        };
      }
    }));

    res.json({ images });
  });

  app.post("/api/images/render", requireAuth, async (req, res) => {
    const { sku, url } = req.body || {};
    console.log('[IMAGE RENDER] Request:', { sku, url });
    
    if (!sku || !url) {
      console.error('[IMAGE RENDER] Missing required params');
      return res.status(400).json({ error: "SKU and image URL are required" });
    }

    try {
      await assertSafeTargetUrl(sanitizeUrl(url));
      console.log('[IMAGE RENDER] Fetching source image...');
      const sourceResponse = await fetchSafeExternal(url);
      if (!sourceResponse.ok) {
        const error = `Failed to fetch image (${sourceResponse.status})`;
        console.error('[IMAGE RENDER]', error);
        return res.status(502).json({ error });
      }

      const contentType = sourceResponse.headers.get('content-type') || '';
      console.log('[IMAGE RENDER] Content-Type:', contentType);
      
      if (!contentType.startsWith('image/') || contentType.includes('svg')) {
        const error = 'Selected URL is not a supported raster image';
        console.error('[IMAGE RENDER]', error);
        return res.status(400).json({ error });
      }

      console.log('[IMAGE RENDER] Processing image with Sharp...');
      const imageBuffer = Buffer.from(await sourceResponse.arrayBuffer());
      const renderedBuffer = await sharp(imageBuffer)
        .trim({ threshold: 10 })
        .resize({
          width: 1500,
          height: 1500,
          fit: 'contain',
          background: { r: 255, g: 255, b: 255, alpha: 1 }
        })
        .flatten({ background: { r: 255, g: 255, b: 255 } })
        .jpeg({ quality: 90 })
        .toBuffer();

      const safeSku = requireSafeStorageKey(sku);
      console.log('[IMAGE RENDER] Success! Sending image...');
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Content-Disposition', `attachment; filename="${safeSku}.jpg"`);
      res.send(renderedBuffer);
    } catch (error: any) {
      console.error('[IMAGE SOURCER] Render failed:', error);
      res.status(error?.statusCode || 500).json({ error: 'Failed to prepare JPG export', details: error.message });
    }
  });

  app.delete("/api/images/:sku", requireAuth, requireAdminRole, async (req, res) => {
    try {
      const safeSku = requireSafeStorageKey(req.params.sku);
      const imagePath = path.join(IMAGES_DIR, `${safeSku}.jpg`);
      
      if (fs.existsSync(imagePath)) {
        fs.unlinkSync(imagePath);
      }
      
      // Optionally delete screenshot as well
      const screenshotFilename = `${safeSku}_screenshot.png`;
      const localScreenshotPath = path.join(OUTPUTS_DIR, screenshotFilename);
      if (fs.existsSync(localScreenshotPath)) {
        fs.unlinkSync(localScreenshotPath);
      }

      res.json({ success: true });
    } catch (err: any) {
      res.status(err?.statusCode || 500).json({ error: "Failed to delete image", details: err.message });
    }
  });

  // ── v2 API ─────────────────────────────────────────────────────────────────
  //
  // All v2 endpoints:
  //  • Return 202 + V2JobEnvelope for async work (no synchronous HTTP wait)
  //  • Return V2ErrorResponse on all failures (stable error codes)
  //  • Require X-CSRF-Token on state-changing methods when signed sessions are active
  //  • Accept idempotencyKey in body for safe client retries
  //
  // Clients poll GET /api/v2/jobs/:id for eventual results.

  // ── v2 Auth ───────────────────────────────────────────────────────────────

  app.get('/api/v2/auth/me', requireAuth, (req, res) => {
    const user: any = (req as any).authUser;
    const cookieValue = req.cookies?.[AUTH_COOKIE];
    let session: { id: string; expiresAt: string } | undefined;
    if (cookieValue && isSignedToken(cookieValue)) {
      const payload = verifySession(cookieValue);
      if (payload) {
        session = { id: payload.sid, expiresAt: new Date(payload.exp).toISOString() };
      }
    }
    return res.json({
      authenticated: true,
      user: { email: user.email, role: user.role === 'admin' ? 'admin' : 'user' },
      ...(session ? { session } : {}),
    });
  });

  // ── v2 Job control plane ──────────────────────────────────────────────────

  /** GET /api/v2/jobs — queue depth stats */
  app.get('/api/v2/jobs', requireAuth, (_req, res) => {
    res.json(jobQueue.getStats());
  });

  /** GET /api/v2/jobs/:jobId — job detail */
  app.get('/api/v2/jobs/:jobId', requireAuth, (req, res) => {
    const job = jobQueue.getJob(req.params.jobId);
    if (!job) {
      return res.status(404).json({
        error: { code: 'not_found', message: 'Job not found', retryable: false },
      });
    }
    return res.json({
      id: job.id,
      type: job.type,
      status: job.status,
      retryCount: job.retryCount,
      createdAt: job.createdAt,
      startedAt: job.startedAt ?? null,
      completedAt: job.completedAt ?? null,
      durationMs: job.durationMs ?? null,
      result: job.status === 'completed' ? job.result : undefined,
      error: job.error ?? null,
    });
  });

  /** POST /api/v2/jobs/:jobId/cancel — cancel a queued (not yet running) job */
  app.post('/api/v2/jobs/:jobId/cancel', requireAuth, requireCsrf, (req, res) => {
    const job = jobQueue.getJob(req.params.jobId);
    if (!job) {
      return res.status(404).json({
        error: { code: 'not_found', message: 'Job not found', retryable: false },
      });
    }
    if (job.status === 'completed' || job.status === 'failed') {
      return res.status(409).json({
        error: {
          code: 'conflict',
          message: `Cannot cancel a job in terminal state: ${job.status}`,
          retryable: false,
        },
      });
    }
    const cancelled = jobQueue.cancelJob(req.params.jobId);
    if (!cancelled) {
      return res.status(409).json({
        error: {
          code: 'conflict',
          message: 'Job is currently running and cannot be cancelled',
          retryable: false,
        },
      });
    }
    return res.status(202).json({ id: job.id, status: 'failed', error: 'Cancelled by user' });
  });

  // ── v2 Scrapes ────────────────────────────────────────────────────────────

  /** POST /api/v2/scrapes — async scrape, returns 202 + job envelope */
  app.post('/api/v2/scrapes', requireAuth, requireCsrf, async (req, res) => {
    const parsed = V2ScrapeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: {
          code: 'validation_failed',
          message: parsed.error.errors[0]?.message ?? 'Invalid request',
          retryable: false,
          details: parsed.error.errors,
        },
      });
    }
    const { url, idempotencyKey: _ik, ...rest } = parsed.data;
    const safeUrl = sanitizeUrl(url);
    try {
      await assertSafeTargetUrl(safeUrl);
      if (rest.secondaryTarget?.url) {
        await assertSafeTargetUrl(sanitizeUrl(rest.secondaryTarget.url));
      }
    } catch (e: any) {
      return res.status(400).json({
        error: { code: 'validation_failed', message: e.message, retryable: false },
      });
    }
    try {
      const job = jobQueue.enqueue('scrape', { url: safeUrl, ...rest });
      return res.status(202).json({
        jobId: job.id,
        status: 'queued',
        acceptedAt: job.createdAt,
        statusUrl: `/api/v2/jobs/${job.id}`,
        cancelUrl: `/api/v2/jobs/${job.id}/cancel`,
      });
    } catch (e: any) {
      if (e?.name === 'BusyError' || e?.statusCode === 503) {
        return res.status(503).json({
          error: { code: 'queue_overloaded', message: e.message, retryable: true },
        });
      }
      return res.status(500).json({
        error: { code: 'internal_error', message: e.message, retryable: false },
      });
    }
  });

  // ── v2 Discover ───────────────────────────────────────────────────────────

  /** POST /api/v2/discovers — async PLP link discovery, returns 202 + job envelope */
  app.post('/api/v2/discovers', requireAuth, requireCsrf, async (req, res) => {
    const parsed = V2DiscoverRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: {
          code: 'validation_failed',
          message: parsed.error.errors[0]?.message ?? 'Invalid request',
          retryable: false,
        },
      });
    }
    const { url, idempotencyKey: _ik, linkSelector } = parsed.data;
    const safeUrl = sanitizeUrl(url);
    try {
      await assertSafeTargetUrl(safeUrl);
    } catch (e: any) {
      return res.status(400).json({
        error: { code: 'validation_failed', message: e.message, retryable: false },
      });
    }
    try {
      const job = jobQueue.enqueue('discover', { url: safeUrl, linkSelector });
      return res.status(202).json({
        jobId: job.id,
        status: 'queued',
        acceptedAt: job.createdAt,
        statusUrl: `/api/v2/jobs/${job.id}`,
        cancelUrl: `/api/v2/jobs/${job.id}/cancel`,
      });
    } catch (e: any) {
      if (e?.name === 'BusyError' || e?.statusCode === 503) {
        return res.status(503).json({
          error: { code: 'queue_overloaded', message: e.message, retryable: true },
        });
      }
      return res.status(500).json({
        error: { code: 'internal_error', message: e.message, retryable: false },
      });
    }
  });

  // ── v2 Mappings ───────────────────────────────────────────────────────────

  /** POST /api/v2/mappings — async LLM mapping, returns 202 + job envelope */
  app.post('/api/v2/mappings', requireAuth, requireCsrf, async (req, res) => {
    const parsed = V2MappingRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: {
          code: 'validation_failed',
          message: parsed.error.errors[0]?.message ?? 'Invalid request',
          retryable: false,
        },
      });
    }
    const { sku, attributeSetName, aiModel, idempotencyKey: _ik } = parsed.data;
    try {
      const job = jobQueue.enqueue('run_job', {
        sku,
        ...(attributeSetName ? { attributeSetName } : {}),
        ...(aiModel ? { aiModel } : {}),
      });
      return res.status(202).json({
        jobId: job.id,
        status: 'queued',
        acceptedAt: job.createdAt,
        statusUrl: `/api/v2/jobs/${job.id}`,
        cancelUrl: `/api/v2/jobs/${job.id}/cancel`,
      });
    } catch (e: any) {
      if (e?.name === 'BusyError' || e?.statusCode === 503) {
        return res.status(503).json({
          error: { code: 'queue_overloaded', message: e.message, retryable: true },
        });
      }
      return res.status(500).json({
        error: { code: 'internal_error', message: e.message, retryable: false },
      });
    }
  });

  // ── v2 SKUs ───────────────────────────────────────────────────────────────

  /** PUT /api/v2/skus/:sku — full upsert (atomic, no lost-update risk) */
  app.put('/api/v2/skus/:sku', requireAuth, requireCsrf, async (req, res) => {
    const sku = req.params.sku;
    if (!sku || !/^[a-zA-Z0-9_-]+$/.test(sku)) {
      return res.status(400).json({
        error: { code: 'validation_failed', message: 'Invalid SKU — only alphanumeric, hyphens, underscores allowed', retryable: false },
      });
    }
    try {
      const result = await dbService.upsertSku(sku, req.body);
      return res.json(result);
    } catch (e: any) {
      return res.status(500).json({
        error: { code: 'internal_error', message: e.message, retryable: false },
      });
    }
  });

  /**
   * PATCH /api/v2/skus/:sku — partial field update with optimistic concurrency.
   * Include `_ifVersion` in the body (from a prior read's `_version` field)
   * to guard against concurrent overwrites. Omit to skip version check.
   * Returns 409 Conflict on version mismatch — re-read and retry.
   */
  app.patch('/api/v2/skus/:sku', requireAuth, requireCsrf, async (req, res) => {
    const sku = req.params.sku;
    if (!sku || !/^[a-zA-Z0-9_-]+$/.test(sku)) {
      return res.status(400).json({
        error: { code: 'validation_failed', message: 'Invalid SKU — only alphanumeric, hyphens, underscores allowed', retryable: false },
      });
    }
    const { _ifVersion, ...fields } = req.body;
    const ifVersion = typeof _ifVersion === 'number' ? _ifVersion : undefined;
    try {
      const result = await dbService.patchSku(sku, fields, ifVersion);
      if (!result) {
        return res.status(409).json({
          error: {
            code: 'conflict',
            message: 'Version conflict — re-read the SKU record and retry with the current _version',
            retryable: true,
          },
        });
      }
      return res.json(result);
    } catch (e: any) {
      return res.status(500).json({
        error: { code: 'internal_error', message: e.message, retryable: false },
      });
    }
  });

  // ── v2 Exports ────────────────────────────────────────────────────────────

  /** POST /api/v2/exports — async XLSX/XLS export, returns 202 + job envelope */
  app.post('/api/v2/exports', requireAuth, requireCsrf, async (req, res) => {
    const parsed = V2ExportRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: {
          code: 'validation_failed',
          message: parsed.error.errors[0]?.message ?? 'Invalid request',
          retryable: false,
        },
      });
    }
    const { format, skus, idempotencyKey: _ik } = parsed.data;
    try {
      const job = jobQueue.enqueue('export_xlsx', { format, skus: skus ?? null });
      return res.status(202).json({
        jobId: job.id,
        status: 'queued',
        acceptedAt: job.createdAt,
        statusUrl: `/api/v2/jobs/${job.id}`,
        cancelUrl: `/api/v2/jobs/${job.id}/cancel`,
      });
    } catch (e: any) {
      if (e?.name === 'BusyError' || e?.statusCode === 503) {
        return res.status(503).json({
          error: { code: 'queue_overloaded', message: e.message, retryable: true },
        });
      }
      return res.status(500).json({
        error: { code: 'internal_error', message: e.message, retryable: false },
      });
    }
  });

  /** GET /api/v2/exports/:jobId/download — download the completed export buffer */
  app.get('/api/v2/exports/:jobId/download', requireAuth, (req, res) => {
    const job = jobQueue.getJob(req.params.jobId);
    if (!job) {
      return res.status(404).json({
        error: { code: 'not_found', message: 'Export job not found', retryable: false },
      });
    }
    if (job.status !== 'completed') {
      return res.status(409).json({
        error: {
          code: 'conflict',
          message: `Export not ready — current status: ${job.status}`,
          retryable: job.status !== 'failed',
        },
      });
    }
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename=CMS_Upload_Master.xlsx',
    );
    res.send(job.result as Buffer);
  });

  // ── End of v2 API ─────────────────────────────────────────────────────────

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      configFile: false,
      server: { 
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true'
      },
      appType: "spa",
      plugins: [react(), tailwindcss()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        },
      },
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Global JSON Error Handler
  app.use((err: any, req: any, res: any, next: any) => {
    console.error("[SERVER] GLOBAL ERROR:", err);
    res.status(err.status || 500).json({
      error: "Internal Server Error",
      details: err.message || "An unexpected error occurred",
      path: req.path
    });
  });

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });

  const shutdown = async (signal: string) => {
    console.log(`[SERVER] Received ${signal}, shutting down gracefully...`);
    server.close(async () => {
      await closeBrowser();
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

startServer().catch(err => {
  console.error("[SERVER] Failed to start server:", err);
});
