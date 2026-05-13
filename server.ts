import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import dns from "node:dns/promises";
import net from "node:net";
import * as cheerio from "cheerio";
import cors from "cors";
import multer from "multer";
import { createRequire } from "module";
const __require = createRequire(import.meta.url);
const pdfParse = __require("pdf-parse");
import Groq from "groq-sdk";
import TurndownService from "turndown";
import { launch } from "cloakbrowser";
import { chromium as playwrightChromium } from "playwright";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import fs from "fs";
import { dbService } from "./src/services/db.js";
import * as XLSX from "xlsx";
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

type BrowserLike = any;

let browser: BrowserLike | null = null;
let browserEngine: 'cloakbrowser' | 'playwright' | null = null;
let activeBrowserTasks = 0;
const MAX_CONCURRENT_BROWSER_TASKS = Number(process.env.MAX_CONCURRENT_BROWSER_TASKS || 2);

class BusyError extends Error {
  statusCode: number;
  constructor(message: string) {
    super(message);
    this.statusCode = 503;
  }
}

class HttpError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const randomDelay = (min: number, max: number) => delay(Math.floor(Math.random() * (max - min + 1) + min));

const isPrivateIpAddress = (host: string): boolean => {
  const ipVersion = net.isIP(host);
  if (ipVersion === 4) {
    const parts = host.split('.').map(Number);
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 0) return true;
    return false;
  }

  if (ipVersion === 6) {
    const normalized = host.toLowerCase();
    if (normalized === '::1') return true;
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
    if (normalized.startsWith('fe80')) return true;
    return false;
  }

  return false;
};

const assertSafeTargetUrl = async (inputUrl: string) => {
  const parsed = new URL(inputUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http/https URLs are allowed');
  }

  const host = parsed.hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
    throw new Error('Localhost targets are not allowed');
  }

  if (net.isIP(host) && isPrivateIpAddress(host)) {
    throw new Error('Private network targets are not allowed');
  }

  try {
    const records = await dns.lookup(host, { all: true });
    if (records.some((record) => isPrivateIpAddress(record.address))) {
      throw new Error('Resolved target points to a private network address');
    }
  } catch (e: any) {
    if (e?.message?.includes('private network')) {
      throw e;
    }
    console.warn(`[SERVER] DNS lookup warning for ${host}: ${e?.message || 'lookup failed'}`);
  }
};

const withBrowserTask = async <T>(task: () => Promise<T>) => {
  if (activeBrowserTasks >= MAX_CONCURRENT_BROWSER_TASKS) {
    throw new BusyError('Server is busy. Please retry in a moment.');
  }

  activeBrowserTasks += 1;
  try {
    return await task();
  } finally {
    activeBrowserTasks = Math.max(0, activeBrowserTasks - 1);
  }
};

async function getBrowser() {
  if (browser && !browser.isConnected()) {
    console.log(`[SERVER] ${browserEngine || 'browser'} instance disconnected, cleaning up...`);
    try {
      await browser.close();
    } catch (e) {}
    browser = null;
    browserEngine = null;
  }

  if (!browser) {
    const launchArgs = [
      "--disable-http2", // Fix for ERR_HTTP2_PROTOCOL_ERROR on sites like Noon
      "--window-size=1920,1080",
      "--disable-extensions",
      "--mute-audio"
    ];

    try {
      console.log("[SERVER] Launching CloakBrowser stealth Chromium...");
      browser = await launch({
        headless: true,
        args: launchArgs
      });
      browserEngine = 'cloakbrowser';
      console.log("[SERVER] Browser engine active: CloakBrowser");
    } catch (cloakErr: any) {
      console.warn(`[SERVER] CloakBrowser launch failed: ${cloakErr?.message || 'unknown error'}`);
      console.warn("[SERVER] Falling back to stock Playwright Chromium...");
      browser = await playwrightChromium.launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-blink-features=AutomationControlled",
          ...launchArgs
        ]
      });
      browserEngine = 'playwright';
      console.log("[SERVER] Browser engine active: Playwright fallback");
    }
  }
  return browser;
}

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

const buildGroqClient = (apiKey?: string | null) => {
  const trimmedApiKey = apiKey?.trim();
  return trimmedApiKey ? new Groq({ apiKey: trimmedApiKey }) : null;
};

const groq = buildGroqClient(process.env.GROQ_API_KEY);

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);
  const ADMIN_KEY = (process.env.ADMIN_KEY || '').trim();
  const CORS_ORIGINS = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });

  const rateState = new Map<string, { count: number; windowStart: number }>();
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

  app.use(cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (process.env.NODE_ENV !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
        return callback(null, true);
      }
      if (CORS_ORIGINS.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error('Origin not allowed by CORS'));
    },
    methods: ['GET', 'POST', 'DELETE'],
    credentials: false
  }));

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

  const upload = multer({ storage: multer.memoryStorage() });

  app.post("/api/upload-pdf", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }
      const data = await pdfParse(req.file.buffer);
      if (!data || !data.text) {
        return res.status(400).json({ error: "Failed to extract text from PDF" });
      }
      
      const { sku } = req.body;
      if (!sku) {
        return res.status(400).json({ error: "SKU is required" });
      }
      
      // Save it to the index
      const indexData = await dbService.getSkuIndex();
      const existing = indexData.find((item: any) => (item.sku || item.SKU)?.toString() === sku.toString());
      if (existing) {
        existing.pdf_text = data.text;
      } else {
        indexData.push({ sku, pdf_text: data.text });
      }
      await dbService.updateSkuIndex(indexData);
      
      res.json({ message: "PDF processed successfully", sku, textPreview: data.text.substring(0, 500) });
    } catch (e: any) {
      console.error("[SERVER] Error processing PDF:", e);
      res.status(500).json({ error: "Failed to process PDF", details: e.message });
    }
  });

  app.post("/api/sku/index", async (req, res) => {
    const { data } = req.body;
    if (!data || !Array.isArray(data)) {
      return res.status(400).json({ error: "Invalid data format" });
    }
    try {
      const existingData = await dbService.getSkuIndex();
      
      // Merge data by SKU, preferring new data for same SKU
      const map = new Map();
      existingData.forEach((item: any) => {
        const skuValue = (item.sku || item.SKU)?.toString();
        if (skuValue) map.set(skuValue, item);
      });
      data.forEach(item => {
        const skuValue = (item.sku || item.SKU)?.toString();
        if (skuValue) map.set(skuValue, item);
      });

      const mergedData = Array.from(map.values());
      await dbService.updateSkuIndex(mergedData);
      res.json({ success: true, count: mergedData.length });
    } catch (e) {
      res.status(500).json({ error: "Failed to index SKUs" });
    }
  });

  app.delete("/api/sku/index/:sku", async (req, res) => {
    try {
      const { sku } = req.params;
      const data = await dbService.getSkuIndex();
      const filtered = data.filter((item: any) => (item.sku || item.SKU)?.toString() !== sku);
      await dbService.updateSkuIndex(filtered);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: "Failed to delete SKU" });
    }
  });

  app.get("/api/sku/index", async (req, res) => {
    try {
      const data = await dbService.getSkuIndex();
      res.json(data);
    } catch (e) {
      res.status(500).json({ error: "Failed to read index" });
    }
  });

  app.get("/api/harvest", async (req, res) => {
    try {
      const fileData = await dbService.listHarvests();
      res.json(fileData);
    } catch (e) {
      res.status(500).json({ error: "Failed to list harvest" });
    }
  });

  app.get("/api/harvest/:filename", async (req, res) => {
    try {
      const { filename } = req.params;
      const sku = filename.replace('.md', '');
      const content = await dbService.getHarvest(sku);
      if (content) {
        res.json({ content });
      } else {
        res.status(404).json({ error: "File not found" });
      }
    } catch (e) {
      res.status(500).json({ error: "Read failed" });
    }
  });

  app.delete("/api/harvest/:filename", async (req, res) => {
    try {
      const { filename } = req.params;
      const sku = filename.replace('.md', '');
      await dbService.deleteHarvest(sku);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: "Delete failed" });
    }
  });

  app.post("/api/save-batch", async (req, res) => {
    const { sku, content } = req.body;
    if (!sku || !content) {
      return res.status(400).json({ error: "SKU and content are required" });
    }

    try {
      // Basic filename sanitization
      const safeSku = sku.toString().replace(/[^a-z0-9_-]/gi, '_');
      await dbService.saveHarvest(safeSku, content);
      console.log(`[SERVER] Saved batch harvest: ${safeSku}`);
      res.json({ success: true, path: `${safeSku}.md` });
    } catch (e) {
      console.error("[SERVER] Failed to save harvest:", e);
      res.status(500).json({ error: "Failed to save data on server" });
    }
  });

  async function scrapeTarget(targetData: any) {
    let { url, selector, extractWithGroq, enableScreenshot, strategy, deepScroll } = targetData;
    
    // Ensure URL has a valid scheme
    if (url && !/^https?:\/\//i.test(url)) {
      url = 'https://' + url;
    }
    
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
                const fetchResult = await fetch(url, {
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

      // Use piercedHtml if available as it includes Shadow DOM content
      const $ = cheerio.load(piercedHtml || html);
      let bodyHtml = "";
      
      const isJsonLd = strategy === 'JsonLdExtractionStrategy';
      const isWholeCapture = strategy === 'WholeCaptureStrategy';

      if (isWholeCapture) {
        console.log(`[SERVER] Using Whole Capture Extraction strategy`);
        // Start from body
        let $body = $('body');
        
        // Strip common noise elements
        $body.find('script, style, iframe, noscript, link, meta, style, svg').remove();
        $body.find('header, footer, nav, .footer, .header, .navbar, .menu, #header, #footer').remove();
        $body.find('.related-products, .recommendations, .similar-products, .also-bought').remove();
        $body.find('.price, .pricing, .discount, .compare-at-price, .currency').remove();
        $body.find('.ads, .promo, .popup, .modal, .cookie-banner, .newsletter').remove();
        
        // Remove most common irrelevant links / buttons but keep structural data
        $body.find('a[href="#"], button:contains("Add to Cart"), button:contains("Buy Now")').remove();

        // Strip attributes for cleaner markdown
        $body.find('*').removeAttr('class').removeAttr('id').removeAttr('style').removeAttr('data-test');
        
        bodyHtml += $body.html() || "";
      } else if (isJsonLd) {
        console.log(`[SERVER] Using JSON-LD Extraction strategy`);
        const jsonLdScripts = $('script[type="application/ld+json"]');
        if (jsonLdScripts.length > 0) {
          jsonLdScripts.each((i, el) => {
            bodyHtml += `<pre>${$(el).html()}</pre>\n`;
          });
        } else {
          // Fallback to meta tags if no JSON-LD found
          const metaTags = $('meta[property^="og:"], meta[name="description"]');
          if (metaTags.length > 0) {
            metaTags.each((i, el) => {
              const content = $(el).attr('content');
              const name = $(el).attr('name') || $(el).attr('property');
              bodyHtml += `<p><strong>${name}:</strong> ${content}</p>\n`;
            });
          }
          if (!bodyHtml) bodyHtml += "<p>No JSON-LD or meaningful Meta tags found.</p>\n";
        }
      }
      
      if (selector) {
        console.log(`[SERVER] Processing selector: ${selector}`);
        try {
          const matches = $(selector);
          if (matches.length > 0) {
            matches.each((i, el) => {
              const $el = $(el);
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
      } else if (!isJsonLd && !isWholeCapture) {
        let contentRoot = $('main, article, #product, .product, #main-content');
        if (contentRoot.length === 0) contentRoot = $('body');
        contentRoot.find('script, style, iframe, noscript, .ads, .promo, footer, nav, .popup, .modal').remove();
        contentRoot.find('*').removeAttr('class').removeAttr('id').removeAttr('style');
        bodyHtml += contentRoot.html() || "";
      }

      let markdown = turndownService.turndown(bodyHtml)
        .replace(/!\[.*?\]\(.*?\)/g, '') 
        .replace(/\[!\[.*?\]\(.*?\)\].*?\)/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      // Improved Image Extraction Logic
      const imageUrls: string[] = [];
      const $extracted = cheerio.load(bodyHtml);
      $extracted('img').each((i, el) => {
        const src = $extracted(el).attr('src');
        const dataSrc = $extracted(el).attr('data-src');
        const srcset = $extracted(el).attr('srcset');
        const dataOldHires = $extracted(el).attr('data-old-hires');
        const dataDynamicImage = $extracted(el).attr('data-a-dynamic-image');

        [src, dataSrc, srcset, dataOldHires].forEach(val => {
          if (!val) return;
          const parts = val.split(',').map(p => p.trim().split(' ')[0]);
          parts.forEach(imgUrl => {
            if (!imgUrl || imgUrl.startsWith('data:')) return;
            if (imgUrl.startsWith('//')) imgUrl = 'https:' + imgUrl;
            else if (imgUrl.startsWith('/')) {
              try {
                const urlObj = new URL(url);
                imgUrl = urlObj.origin + imgUrl;
              } catch(e) {}
            }
            if (!imageUrls.includes(imgUrl)) imageUrls.push(imgUrl);
          });
        });
        
        if (dataDynamicImage) {
           try {
              const parsed = JSON.parse(dataDynamicImage);
              Object.keys(parsed).forEach(imgUrl => {
                 if (!imgUrl || imgUrl.startsWith('data:')) return;
                 if (imgUrl.startsWith('//')) imgUrl = 'https:' + imgUrl;
                 if (!imageUrls.includes(imgUrl)) imageUrls.push(imgUrl);
              });
           } catch(e) {}
        }
      });

      if (imageUrls.length > 0) {
        markdown += "\n\n### MEDIA SOURCE ASSETS (PLAINTEXT URLs):\n" + imageUrls.join('\n');
      }

      let groqResult = null;
      if (extractWithGroq && markdown && groq) {
        const groqResponse = await groq.chat.completions.create({
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
          model: "llama-3.3-70b-versatile",
        });
        groqResult = groqResponse.choices[0]?.message?.content;
      }

      return { markdown, groqResult, imageUrls, screenshotBase64, pageTitle, url };
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

  // API Route for scraping and optional Groq extraction
  app.post("/api/scrape", async (req, res) => {
    let { url, selector, extractWithGroq, enableScreenshot, sku, strategy, deepScroll, secondaryTarget } = req.body;

    if (!url) {
      return res.status(400).json({ error: "URL is required" });
    }

    try {
      try { new URL(sanitizeUrl(url)); } catch (e) { return res.status(400).json({ error: "Invalid URL format" }); }
      await assertSafeTargetUrl(sanitizeUrl(url));

      const primaryResult = await withBrowserTask(() => scrapeTarget({ url: sanitizeUrl(url), selector, extractWithGroq, enableScreenshot, strategy, deepScroll }));
      let secondaryResult = null;
      
      if (secondaryTarget && secondaryTarget.url) {
        await assertSafeTargetUrl(sanitizeUrl(secondaryTarget.url));
        secondaryResult = await withBrowserTask(() => scrapeTarget({
          url: sanitizeUrl(secondaryTarget.url),
          selector: secondaryTarget.selector || selector,
          strategy: secondaryTarget.strategy || strategy,
          extractWithGroq,
          enableScreenshot: enableScreenshot,
          deepScroll: deepScroll
        }));
      }

      if (sku) {
        const safeSku = sku.toString().replace(/[^a-z0-9_-]/gi, '_');
        await dbService.saveHarvest(
          safeSku, 
          primaryResult.groqResult || primaryResult.markdown,
          secondaryResult ? (secondaryResult.groqResult || secondaryResult.markdown) : undefined
        );
        console.log(`[SERVER] Auto-saved harvest to Firestore: ${safeSku} (with secondary data: ${!!secondaryResult})`);
      }

      res.json({
        url,
        success: true,
        text: primaryResult.markdown,
        groqResult: primaryResult.groqResult,
        imageUrls: primaryResult.imageUrls,
        ...(primaryResult.screenshotBase64 ? { screenshot: `data:image/jpeg;base64,${primaryResult.screenshotBase64}` } : {}),
        title: primaryResult.pageTitle,
        secondary: secondaryResult ? {
          url: secondaryResult.url,
          text: secondaryResult.markdown,
          groqResult: secondaryResult.groqResult,
          imageUrls: secondaryResult.imageUrls,
          ...(secondaryResult.screenshotBase64 ? { screenshot: `data:image/jpeg;base64,${secondaryResult.screenshotBase64}` } : {}),
          title: secondaryResult.pageTitle
        } : null
      });
    } catch (error: any) {
      console.error(`[SERVER] Extraction failed: ${error.message}`);
      res.status(error?.statusCode || 500).json({ 
        error: "Extraction Error", 
        details: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  });

  // API Route for Discovery Mode (Deep Crawl)
  app.post("/api/discover", async (req, res) => {
    let { url, linkSelector } = req.body;
    if (!url) return res.status(400).json({ error: "URL is required" });
    
    url = sanitizeUrl(url);
    try { new URL(url); } catch(e) { return res.status(400).json({ error: "Invalid URL format" }); }
    await assertSafeTargetUrl(url);

    let context: any = null;
    try {
      const links = await withBrowserTask(async () => {
        console.log(`[SERVER] Discovery Mode Starting: ${url}`);
        const browserInstance = await getBrowser();
        context = await browserInstance.newContext();
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
          // If they provided a container selector, search inside it
          if (selector && !selector.includes('a')) {
             const container = document.querySelector(selector);
             if (container) elements = Array.from(container.querySelectorAll('a[href]'));
          }

          return elements
            .map(el => {
              const href = el.href;
              const text = el.innerText.trim();
              return { href, text };
            })
            .filter(link => link.href && (link.href.startsWith('http') || link.href.startsWith('/')));
        })()
      `)) as any[];
        await context.close();
        context = null;
        return pageLinks;
      });

      // Normalize links
      const urlObj = new URL(url);
      const normalizedLinks = links.map(link => {
        if (link.href.startsWith('/')) {
           link.href = urlObj.origin + link.href;
        }
        return link;
      }).filter((v, i, a) => a.findIndex(t => t.href === v.href) === i); // Deduplicate

      res.json({ success: true, links: normalizedLinks });
    } catch (error: any) {
      if (context) {
        try {
          await context.close();
        } catch (closeError) {
          const closeErr = closeError as Error;
          console.error(`[SERVER] Failed to close discovery context: ${closeErr.message}`);
        }
      }
      res.status(error?.statusCode || 500).json({ error: "Discovery Error", details: error.message });
    }
  });

  async function performInspection(url: string, deepScroll: boolean) {
    let context: any = null;
    try {
      console.log(`[SERVER] Inspection Started: ${url}`);
      const browserInstance = await getBrowser();
      context = await browserInstance.newContext();
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


  app.post("/api/inspect", async (req, res) => {
    try {
        let url = req.body.url;
        if (!url) return res.status(400).json({ error: "URL is required" });
        url = sanitizeUrl(url);
        try { new URL(url); } catch(e) { return res.status(400).json({ error: "Invalid URL format" }); }
        await assertSafeTargetUrl(url);
        
        res.json(await withBrowserTask(() => performInspection(url, req.body.deepScroll)));
    } catch (error: any) {
        res.status(error?.statusCode || 500).json({ error: "Inspection failed", details: error.message });
    }
  });

  app.post("/api/analyze", async (req, res) => {
    const { url, deepScroll } = req.body;
    try {
        if (!url) return res.status(400).json({ error: "URL is required" });
        const safeUrl = sanitizeUrl(url);
        try { new URL(safeUrl); } catch(e) { return res.status(400).json({ error: "Invalid URL format" }); }
        await assertSafeTargetUrl(safeUrl);
        const data = await withBrowserTask(() => performInspection(safeUrl, deepScroll));
        
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
            - "strategy": string ("GroqExtractionStrategy", "JsonLdExtractionStrategy", or "WholeCaptureStrategy" - choose based on what looks most robust)
            - "reasoning": string (short description of why these were chosen)
        `;

        const groqClient = await resolveGroqClient();
        if (!groqClient) {
          throw new Error("Groq API Key is not configured. Please add it in Connectivity settings.");
        }

        const chatCompletion = await groqClient.chat.completions.create({
            messages: [{ role: "user", content: prompt }],
            model: "llama-3.3-70b-versatile",
            response_format: { type: "json_object" }
        });

        const text = chatCompletion.choices[0]?.message?.content || "{}";
        const result = JSON.parse(text);

        res.json({ ...data, ...result });
    } catch (error: any) {
        res.status(error?.statusCode || 500).json({ error: "Analysis failed", details: error.message });
    }
  });

  app.get("/api/pdf/:sku", async (req, res) => {
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

  app.get("/api/jobs", async (req, res) => {
    try {
      const skus = await dbService.getSkuIndex();
      const harvests = (await dbService.listHarvests()).map(h => h.name);
      
      const jobs = await Promise.all(skus.map(async (product: any) => {
        // Find matching SKU in filenames (allowing for some fuzzy underscore match)
        const safeSku = product.sku.toString().replace(/[^a-z0-9_-]/gi, '_');
        const hasHarvest = harvests.includes(`${safeSku}.md`);
        const hasPdf = !!product.pdf_text;
        const hasSapData = !!product.sap_data;
        
        // Check if output already exists (terminal state)
        const output = await dbService.getOutput(safeSku);
        const outputExists = !!output;
        
        return {
          ...product,
          status: outputExists ? 'completed' : ((hasHarvest || hasPdf || hasSapData) ? 'ready' : 'pending'),
          harvestFile: hasHarvest ? `${safeSku}.md` : null,
          hasPdf: hasPdf,
          hasSapData: hasSapData
        };
      }));
      
      res.json(jobs);
    } catch (e) {
      res.json([]);
    }
  });

  app.post("/api/jobs/run", async (req, res) => {
    const { sku, attributeSetName: uiAttributeSetName, aiModel } = req.body;
    if (!sku) return res.status(400).json({ error: "SKU required" });

    try {
      const safeSku = sku.toString().replace(/[^a-z0-9_-]/gi, '_');
      const harvestPath = path.join(HARVEST_DIR, `${safeSku}.md`);
      const skuIndexData = await dbService.getSkuIndex();
      const skuRecord = skuIndexData.find((p: any) => (p.sku || p.SKU)?.toString() === sku.toString());

      if (!fs.existsSync(harvestPath) && !skuRecord?.pdf_text && !skuRecord?.sap_data && !skuRecord) {
        return res.status(404).json({ error: `Missing source data or SKU record for ${sku}` });
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
      
      // Determine attribute set name from UI, fallback to SKU record
      const attributeSetName = (uiAttributeSetName || skuRecord.attribute_set || skuRecord.attribute_set_name || skuRecord.Attribute_Set || skuRecord.schema || skuRecord.Schema || '').toString().trim();
      
      // Default fallback: use all headers uploaded in the Excel file for this SKU
      let headers = Object.keys(skuRecord).filter(k => 
         k.toLowerCase() !== 'attribute_set' && 
         k.toLowerCase() !== 'attribute_set_name' &&
         k.toLowerCase() !== 'schema'
      );
      if (!headers.some(k => k.toLowerCase() === 'sku')) {
         headers.unshift('SKU');
      }

      let mdRules = '';

      if (attributeSetName) {
        const foundSet = settings.attributeSets.find((s: any) => s.name.toLowerCase() === attributeSetName.toLowerCase());
        if (foundSet) {
          if (foundSet.fields && foundSet.fields.length > 0) {
            headers = foundSet.fields;
          }
          if (foundSet.mdRules) {
            mdRules = `\nSPECIFIC MAPPING RULES (APPLY THESE STRICTLY): \n${foundSet.mdRules}\n`;
          }
        }
      } else if (settings.attributeSets && settings.attributeSets.length === 1) {
        // Fallback: If no schema is specified in the SKU record but there's exactly one schema in the Hub, use it
        const foundSet = settings.attributeSets[0];
        if (foundSet.fields && foundSet.fields.length > 0) {
           headers = foundSet.fields;
        }
        if (foundSet.mdRules) {
           mdRules = `\nSPECIFIC MAPPING RULES (APPLY THESE STRICTLY): \n${foundSet.mdRules}\n`;
        }
      }
      
      let outputData = null;
      const groqClient = await resolveGroqClient(settings);
      if (groqClient) {
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
          
          try {
            const groqResponse = await groqClient.chat.completions.create({
              messages: [{ role: "user", content: prompt }],
              model: aiModel || "llama-3.3-70b-versatile",
              response_format: { type: "json_object" }
            });
            outputData = JSON.parse(groqResponse.choices[0]?.message?.content || '{}');
          } catch (err: any) {
             console.error(`[AI] Mapping failed for ${sku}:`, err.message);
             throw err;
          }
      } else {
          throw new Error("Groq API Key is not configured. Please add it in Connectivity settings.");
      }

      // Map manual indexer fields to specific schemas
      const manualOverrides: any = {};
      if (skuRecord) {
        if (skuRecord.shipping_weight) manualOverrides['attributes__shipping_weight'] = skuRecord.shipping_weight;
        if (skuRecord.brand) manualOverrides['attributes__brand'] = skuRecord.brand;
        if (skuRecord.ean) manualOverrides['attributes__lulu_ean'] = skuRecord.ean;
        if (skuRecord.base_code) manualOverrides['base code'] = skuRecord.base_code;
        if (skuRecord.product_type) manualOverrides['attributes__lulu_product_type'] = skuRecord.product_type;
      }

      // Ensure SKU and manual inputs are preserved and override AI output
      const finalOutput = { 
        ...outputData, 
        ...manualOverrides,
        SKU: sku,
        sku: sku 
      };

      await dbService.saveOutput(safeSku, finalOutput);
      res.json({ success: true, data: finalOutput });
    } catch (e: any) {
      console.error(`[AI_JOB] Failure for SKU ${sku}:`, e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/outputs/:sku", async (req, res) => {
    try {
      const { sku } = req.params;
      const data = req.body;
      const safeSku = sku.toString().replace(/[^a-z0-9_-]/gi, '_');
      await dbService.saveOutput(safeSku, data);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: "Failed to update output" });
    }
  });

  app.delete("/api/outputs/:sku", async (req, res) => {
    try {
      const { sku } = req.params;
      const safeSku = sku.toString().replace(/[^a-z0-9_-]/gi, '_');
      await dbService.deleteOutput(safeSku);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: "Delete failed" });
    }
  });

  app.get("/api/outputs/json/:filename", async (req, res) => {
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
      res.status(500).json({ error: "Failed to read output" });
    }
  });

  app.get("/api/outputs/xlsx", async (req, res) => {
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
      
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(rows, { header: predefinedHeaders });
      XLSX.utils.book_append_sheet(wb, ws, "MasterUpload");
      
      // Export as .xls
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xls' });
      res.setHeader('Content-Type', 'application/vnd.ms-excel');
      res.setHeader('Content-Disposition', 'attachment; filename=CMS_Upload_Master.xls');
      res.send(buf);
    } catch (e) {
      console.error('Error generating report:', e);
      res.status(500).json({ error: "Failed to generate report" });
    }
  });

  const SETTINGS_FILE = path.join(process.cwd(), 'settings.json');
  let currentGroq: Groq | null = groq;

  async function loadSettings() {
    try {
      return await dbService.getSettings();
    } catch (e) {
      return {
        title: "",
        bullets: "",
        description: "",
        keywords: "",
        groqApiKey: "",
        attributeSets: [],
        selectorPresets: [],
        plpSelectorPresets: []
      };
    }
  }

  async function resolveGroqClient(settingsOverride?: any) {
    if (currentGroq) {
      return currentGroq;
    }

    const settings = settingsOverride || await loadSettings();
    const persistedGroq = buildGroqClient(settings?.groqApiKey);
    if (persistedGroq) {
      currentGroq = persistedGroq;
      return currentGroq;
    }

    return groq;
  }

  app.get('/api/admin/status', (req, res) => {
    res.json({ adminConfigured: !!ADMIN_KEY });
  });

  app.get('/api/health/firestore', (_req, res) => {
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

  app.post('/api/admin/login', (req, res) => {
    const { key } = req.body || {};
    if (!ADMIN_KEY) {
      return res.status(403).json({ error: 'ADMIN_KEY is not configured on the server.' });
    }
    if (key === ADMIN_KEY) {
      return res.json({ success: true });
    }
    return res.status(401).json({ error: 'Invalid admin key' });
  });

  app.post("/api/settings", async (req, res) => {
    try {
      if (!ADMIN_KEY) {
        return res.status(500).json({ error: 'ADMIN_KEY is not configured on the server.' });
      }
      const adminKey = req.headers['x-admin-key'];
      if (typeof adminKey !== 'string' || adminKey !== ADMIN_KEY) {
        return res.status(403).json({ error: 'Admin access required to update settings.' });
      }
      const settings = req.body;
      await dbService.saveSettings(settings);
      currentGroq = buildGroqClient(settings.groqApiKey) || groq;
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: "Failed to save settings" });
    }
  });

  app.get("/api/settings", async (req, res) => {
    try {
      res.json(await dbService.getSettings());
    } catch (e) {
      res.status(500).json({ error: "Failed to read settings" });
    }
  });

  app.post("/api/images/extract", async (req, res) => {
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
      const safeSku = sku.replace(/[^a-z0-9_-]/gi, '_');

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
          const fetchRes = await fetch(cand.fullUrl);
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

  app.post("/api/images/render", async (req, res) => {
    const { sku, url } = req.body || {};
    console.log('[IMAGE RENDER] Request:', { sku, url });
    
    if (!sku || !url) {
      console.error('[IMAGE RENDER] Missing required params');
      return res.status(400).json({ error: "SKU and image URL are required" });
    }

    try {
      await assertSafeTargetUrl(sanitizeUrl(url));
      console.log('[IMAGE RENDER] Fetching source image...');
      const sourceResponse = await fetch(sanitizeUrl(url));
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

      const safeSku = sku.toString().replace(/[^a-z0-9_-]/gi, '_');
      console.log('[IMAGE RENDER] Success! Sending image...');
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Content-Disposition', `attachment; filename="${safeSku}.jpg"`);
      res.send(renderedBuffer);
    } catch (error: any) {
      console.error('[IMAGE SOURCER] Render failed:', error);
      res.status(500).json({ error: 'Failed to prepare JPG export', details: error.message });
    }
  });

  app.delete("/api/images/:sku", async (req, res) => {
    try {
      const { sku } = req.params;
      const safeSku = sku.replace(/[^a-z0-9_-]/gi, '_');
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
      res.status(500).json({ error: "Failed to delete image", details: err.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
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
      if (browser) {
        try {
          await browser.close();
        } catch (e) {
          console.error('[SERVER] Error while closing browser:', e);
        }
      }
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

startServer().catch(err => {
  console.error("[SERVER] Failed to start server:", err);
});
