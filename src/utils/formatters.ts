// Shared utility helpers — formatting, sanitization, date helpers

import type { LogType } from '../types';
import { LOG_COLOR_MAP } from '../constants';

/** Maps a log type to its Tailwind colour class */
export function getLogColor(type: LogType): string {
  return LOG_COLOR_MAP[type] ?? 'text-white/60';
}

/** Sanitises a SKU string for use as a filename/key */
export function sanitizeSku(sku: string): string {
  return sku.trim().replace(/[^a-zA-Z0-9_\-]/g, '_');
}

/** Returns a concise timestamp string (HH:MM:SS) */
export function nowTimestamp(): string {
  return new Date().toLocaleTimeString('en-GB', { hour12: false });
}

/** Truncates a string to maxLen with an ellipsis */
export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return `${str.slice(0, maxLen - 1)}…`;
}

/** Safely extracts the first value that is a non-empty string from an object */
export function firstStringOf(obj: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

/** Formats a number of bytes as a human-readable size string */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
