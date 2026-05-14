// Browser lifecycle management — CloakBrowser (primary) + Playwright (fallback)
// Keeps browser singleton state and concurrent task limiting.

import { launch } from 'cloakbrowser';
import { chromium as playwrightChromium } from 'playwright';
import { BusyError } from './errors.js';

// Keep flexible typing due to CloakBrowser/Playwright API incompatibilities
export interface BrowserLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  newContext(opts?: Record<string, unknown>): Promise<any>;
  close(): Promise<void>;
  isConnected?(): boolean;
}

let browser: BrowserLike | null = null;
let browserEngine: 'cloakbrowser' | 'playwright' | null = null;
let activeBrowserTasks = 0;
const MAX_CONCURRENT_BROWSER_TASKS = Number(process.env.MAX_CONCURRENT_BROWSER_TASKS || 2);

const LAUNCH_ARGS = [
  '--disable-http2', // Fix for ERR_HTTP2_PROTOCOL_ERROR on sites like Noon
  '--window-size=1920,1080',
  '--disable-extensions',
  '--mute-audio',
];

export async function getBrowser(): Promise<BrowserLike> {
  // Check if browser is still connected
  if (browser && typeof browser.isConnected === 'function' && !browser.isConnected()) {
    console.log(`[BROWSER] ${browserEngine || 'browser'} instance disconnected, cleaning up...`);
    try {
      await browser.close();
    } catch (_e) {}
    browser = null;
    browserEngine = null;
  }

  if (!browser) {
    try {
      console.log('[BROWSER] Launching CloakBrowser stealth Chromium...');
      browser = await launch({ headless: true, args: LAUNCH_ARGS });
      browserEngine = 'cloakbrowser';
      console.log('[BROWSER] Browser engine active: CloakBrowser');
    } catch (cloakErr: unknown) {
      const msg = cloakErr instanceof Error ? cloakErr.message : 'unknown error';
      console.warn(`[BROWSER] CloakBrowser launch failed: ${msg}`);
      console.warn('[BROWSER] Falling back to stock Playwright Chromium...');
      browser = await playwrightChromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled',
          ...LAUNCH_ARGS,
        ],
      });
      browserEngine = 'playwright';
      console.log('[BROWSER] Browser engine active: Playwright fallback');
    }
  }

  return browser;
}

export async function withBrowserTask<T>(task: () => Promise<T>): Promise<T> {
  if (activeBrowserTasks >= MAX_CONCURRENT_BROWSER_TASKS) {
    throw new BusyError('Server is busy. Please retry in a moment.');
  }

  activeBrowserTasks += 1;
  try {
    return await task();
  } finally {
    activeBrowserTasks = Math.max(0, activeBrowserTasks - 1);
  }
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    try {
      await browser.close();
    } catch (e) {
      console.error('[BROWSER] Error while closing browser:', e);
    }
    browser = null;
    browserEngine = null;
  }
}

export function getBrowserEngine(): 'cloakbrowser' | 'playwright' | null {
  return browserEngine;
}
