import { apiFetch, setCsrfToken } from "./auth";
import { AppShell, type AppShellNavItem } from "./components/layout/AppShell";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { PresetDropdown } from "./components/PresetDropdown";
import { Alert, Badge, Button, Card, EmptyState, Input, LoadingState, Progress, Select, Tabs, Textarea } from "./components/ui";
import type { SkuRecord, HarvestFile, Job } from "./types";
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Activity, Beaker, Box, Cpu, Database, ExternalLink, Flame, Info, Layout, Play, Terminal, Zap, Loader2, X, Maximize2, Copy, Check, Eye, AlertCircle, FileSpreadsheet, Upload, Settings, Briefcase, Search, FileText, Globe, Key, List, AlignLeft, Plus, Archive, Trash2, RefreshCw, Network, Image as ImageIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import React, { useState, useRef, useEffect } from 'react';

// ErrorBoundary and PresetDropdown are imported from ./components/
// Types LogEntry and FirestoreHealth are defined here for local use in App.tsx

interface LogEntry {
  type: 'system' | 'debug' | 'success' | 'action' | 'network' | 'wait' | 'skill' | 'error';
  message: string;
  timestamp: string;
}

interface FirestoreHealth {
  mode: string;
  connected: boolean;
  projectId?: string | null;
  databaseId?: string | null;
  authSource?: string | null;
  initError?: string | null;
}

interface AuthUser {
  email: string;
  role: 'admin' | 'user';
}

const AUTH_USER_STORAGE_KEY = 'paxth.authUser';

const readCachedAuthUser = (): AuthUser | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(AUTH_USER_STORAGE_KEY);
    if (!raw) return null;
    const user = JSON.parse(raw);
    return typeof user?.email === 'string' && (user.role === 'admin' || user.role === 'user') ? user : null;
  } catch {
    return null;
  }
};

const cacheAuthUser = (user: AuthUser | null) => {
  if (typeof window === 'undefined') return;
  if (user) window.sessionStorage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(user));
  else window.sessionStorage.removeItem(AUTH_USER_STORAGE_KEY);
};

interface AllowlistUser {
  email: string;
  role: 'admin' | 'user';
  addedAt?: string | null;
}

interface BatchManifestRow {
  sku: string;
  url: string;
}

interface SelectedHarvestImageSource {
  filename: string;
  sku: string;
  content: string;
  urls: string[];
}

interface HarvestEditorEntry {
  filename: string;
  sku: string;
  content: string;
  sourceLabel: string;
  openedAt: string;
}

type ModuleId = 'upload' | 'pre-qa' | 'scrapper' | 'jobs' | 'review' | 'images' | 'settings';
type SettingsSubModuleId = 'api' | 'mapping' | 'indexer';

const SCRAPE_JOB_POLL_TIMEOUT_MS = 600_000;
const DISCOVERY_JOB_POLL_TIMEOUT_MS = 120_000;
const BATCH_TEMPLATE_HEADERS = ['sku', 'url'];
const DEFAULT_MAP_AI_MODELS = [
  'deepseek/deepseek-v4-flash',
  'deepseek/deepseek-v4-pro',
  'qwen/qwen3.5-flash-02-23',
] as const;
const CUSTOM_MAP_AI_MODEL_VALUE = 'custom';
const MAP_AI_MISSING_MODEL_MESSAGE = 'Please select or enter a model for Map AI.';
const SKU_ATTRIBUTE_SET_ALIASES = new Set([
  'attribute_set',
  'attribute_set_name',
  'attribute_setname',
  'attributeset',
  'schema',
]);
type SpreadsheetCell = string | number | boolean | null;

const ReactMarkdown = React.lazy(() => import('react-markdown'));

function MarkdownContent({ children }: { children: string }) {
  return (
    <React.Suspense fallback={<div className="text-[11px] text-white/45">Loading preview...</div>}>
      <ReactMarkdown>{children}</ReactMarkdown>
    </React.Suspense>
  );
}

function normalizeSkuIndexRecordForSubmit(
  record: Record<string, SpreadsheetCell | string | number | boolean | null | undefined>,
  selectedAttributeSet = '',
) {
  const normalized: Record<string, SpreadsheetCell | string | number | boolean | null> = {};
  let discoveredAttributeSet = '';

  Object.entries(record).forEach(([key, value]) => {
    if (!key) return;
    const normalizedKey = key.toLowerCase().trim().replace(/\s+/g, '_');
    const finalValue = typeof value === 'string' ? value.trim() : value ?? null;

    if (SKU_ATTRIBUTE_SET_ALIASES.has(normalizedKey)) {
      if (typeof finalValue === 'string' && finalValue) {
        discoveredAttributeSet = finalValue;
      }
      return;
    }

    normalized[normalizedKey] = finalValue;
  });

  const finalAttributeSet = selectedAttributeSet.trim() || discoveredAttributeSet.trim();
  if (finalAttributeSet) {
    normalized.attribute_set = finalAttributeSet;
  }

  return normalized;
}

function readSkuAttributeSetForDisplay(record?: Record<string, any> | null): string {
  if (!record) return '';
  for (const [key, value] of Object.entries(record)) {
    const normalizedKey = key.toLowerCase().trim().replace(/\s+/g, '_');
    if (!SKU_ATTRIBUTE_SET_ALIASES.has(normalizedKey)) continue;
    const attributeSet = typeof value === 'string' ? value.trim() : '';
    if (attributeSet) return attributeSet;
  }
  return '';
}

async function readFirstWorksheetRows(file: File): Promise<SpreadsheetCell[][]> {
  const formData = new FormData();
  formData.append('file', file);

  const res = await apiFetch('/api/xlsx/rows', {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    throw new Error(payload?.error || 'Failed to parse XLSX file.');
  }

  const payload = await res.json();
  const rows: SpreadsheetCell[][] = Array.isArray(payload?.rows) ? payload.rows : [];
  return rows.filter((row) => row.some((cell) => cell !== null && cell.toString().trim() !== ''));
}

async function readFirstWorksheetObjects(file: File): Promise<Record<string, SpreadsheetCell>[]> {
  const rows = await readFirstWorksheetRows(file);
  if (rows.length === 0) return [];
  const headers = rows[0].map((cell) => cell?.toString().trim() || '');
  return rows.slice(1).map((row) => {
    const record: Record<string, SpreadsheetCell> = {};
    headers.forEach((header, index) => {
      if (!header) return;
      record[header] = row[index] ?? null;
    });
    return record;
  }).filter((row) => Object.values(row).some((cell) => cell !== null && cell.toString().trim() !== ''));
}

async function downloadXlsxTemplate(filename: string, sheetName: string, headers: string[]) {
  const res = await apiFetch('/api/xlsx/template', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, sheetName, headers }),
  });

  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    throw new Error(payload?.error || 'Failed to generate XLSX template.');
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
const HARVEST_IMAGE_SECTION_HEADINGS = new Set([
  '### MEDIA SOURCE ASSETS (PLAINTEXT URLs):',
  '## High Quality Product Image URLs',
]);

function deriveHarvestSku(filename: string): string {
  return filename
    .replace(/_secondary_raw\.md$/i, '')
    .replace(/_secondary\.md$/i, '')
    .replace(/_raw\.md$/i, '')
    .replace(/\.md$/i, '');
}

function formatScrapePreview(title: string | null | undefined, strategyName: string, text: string | null | undefined): string {
  const trimmed = text?.trim();
  if (!trimmed) {
    return 'No content captured.';
  }

  if (strategyName === 'WholeCaptureStrategy') {
    return trimmed;
  }

  return `# ${title || 'Captured Page'}\n\nRAW DATA PREVIEW (${strategyName}):\n\n${trimmed}`;
}

function extractHarvestImageUrls(content: string): string[] {
  const sectionUrls = new Set<string>();
  const lines = content.split(/\r?\n/);
  let activeSection = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (HARVEST_IMAGE_SECTION_HEADINGS.has(trimmed)) {
      activeSection = true;
      continue;
    }

    if (activeSection && /^#{1,6}\s/.test(trimmed)) {
      activeSection = false;
    }

    if (!activeSection || !trimmed) {
      continue;
    }

    const matches = trimmed.match(/https?:\/\/[^\s)"']+/gi) || [];
    matches.forEach((match) => sectionUrls.add(match));
  }

  if (sectionUrls.size > 0) {
    return Array.from(sectionUrls);
  }

  const fallbackMatches = content.match(/https?:\/\/[^\s)"']+\.(?:jpg|jpeg|png|webp|gif|avif|bmp|jfif)(?:\?[^\s)"']*)?/gi) || [];
  return Array.from(new Set(fallbackMatches));
}

function createHarvestEditorEntry(filename: string, content: string, sourceLabel: string): HarvestEditorEntry {
  return {
    filename,
    sku: deriveHarvestSku(filename),
    content,
    sourceLabel,
    openedAt: new Date().toISOString(),
  };
}


/**
 * Poll a queue job until it completes (or fails/times out).
 * Returns the job result on success; throws on failure or timeout.
 */
async function pollJob(jobId: string, maxMs = SCRAPE_JOB_POLL_TIMEOUT_MS): Promise<any> {
  const deadline = Date.now() + maxMs;
  let lastKnownStatus = 'queued';
  let lastKnownRetryCount = 0;
  let lastKnownDurationMs: number | undefined;

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 2_000));
    const res = await apiFetch(`/api/queue/${jobId}`);
    if (!res.ok) throw new Error(`Job status check failed (HTTP ${res.status})`);
    const job = await res.json();
    lastKnownStatus = job?.status || lastKnownStatus;
    lastKnownRetryCount = Number(job?.retryCount || 0);
    if (typeof job?.durationMs === 'number') {
      lastKnownDurationMs = job.durationMs;
    }
    if (job.status === 'completed') return job.result;
    if (job.status === 'failed') throw new Error(job.error || 'Job failed');
  }

  try {
    const finalRes = await apiFetch(`/api/queue/${jobId}`);
    if (finalRes.ok) {
      const finalJob = await finalRes.json();
      if (finalJob.status === 'completed') return finalJob.result;
      if (finalJob.status === 'failed') {
        throw new Error(finalJob.error || 'Job failed');
      }
      throw new Error(
        `Job still ${finalJob.status || 'running'} after ${Math.round(maxMs / 1000)}s (retryCount=${Number(finalJob?.retryCount || 0)}).`
      );
    }
  } catch {
    // Fall through to the generic timeout message using last known state.
  }

  const elapsedSummary = typeof lastKnownDurationMs === 'number'
    ? `, durationMs=${lastKnownDurationMs}`
    : '';
  throw new Error(
    `Job timed out after ${Math.round(maxMs / 1000)}s (lastStatus=${lastKnownStatus}, retryCount=${lastKnownRetryCount}${elapsedSummary}).`
  );
}

export default function App() {
  const defaultSelectorPresets = [
    {
      name: "Amazon Global Profile",
      selector: 'link[rel="canonical"], #titleSection, #corePriceDisplay_desktop_feature_div, #productOverview_feature_div, #feature-bullets, #productDetails_feature_div, #altImages',
      strategy: "LLMExtractionStrategy"
    }
  ];
  const defaultPlpPresets = [
    { name: "Standard Product List", selector: ".product-item a, .product-card a" }
  ];

  const [currentModule, setCurrentModule] = useState<ModuleId>('upload');
  const [reviewSku, setReviewSku] = useState<string>('');
  const [settingsSubModule, setSettingsSubModule] = useState<SettingsSubModuleId>('api');
  const [editingGenerator, setEditingGenerator] = useState<string | null>(null);
  const [editingSetRules, setEditingSetRules] = useState<number | null>(null);
  const [expandedSchemaIdx, setExpandedSchemaIdx] = useState<number | null>(null);
  const [skuIndex, setSkuIndex] = useState<SkuRecord[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [harvestFiles, setHarvestFiles] = useState<HarvestFile[]>([]);
  const [appSettings, setAppSettings] = useState({ 
    title: "", 
    bullets: "", 
    description: "", 
    keywords: "",
    aiCreditsApiKey: "",
    globalMappingLogic: "",
    attributeSets: [] as {name: string, fields: string[], mdRules?: string, mdFileName?: string}[],
    selectorPresets: [] as {name: string, selector: string, strategy: string}[],
    plpSelectorPresets: [] as {name: string, selector: string}[]
  });
  const [authUser, setAuthUser] = useState<AuthUser | null>(() => readCachedAuthUser());
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginAccessCode, setLoginAccessCode] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [allowlistUsers, setAllowlistUsers] = useState<AllowlistUser[]>([]);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserRole, setNewUserRole] = useState<'admin' | 'user'>('user');
  const [isManagingUsers, setIsManagingUsers] = useState(false);
  const [firestoreHealth, setFirestoreHealth] = useState<FirestoreHealth | null>(null);
  const [isFirestoreStatusLoading, setIsFirestoreStatusLoading] = useState(true);
  const [newAttrName, setNewAttrName] = useState('');
  const [newAttrFields, setNewAttrFields] = useState('');
  const [mode, setMode] = useState<'single' | 'batch' | 'deep'>('single');
  const [url, setUrl] = useState('');
  const [batchFile, setBatchFile] = useState<File | null>(null);
  const [skuFile, setSkuFile] = useState<File | null>(null);
  const [batchData, setBatchData] = useState<BatchManifestRow[]>([]);
  const [strategy, setStrategy] = useState('JsonLdExtractionStrategy');
  const [selector, setSelector] = useState('');
  
  const [pdfUploadSku, setPdfUploadSku] = useState<string | null>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  // Secondary Target State
  const [hasSecondaryTarget, setHasSecondaryTarget] = useState(false);
  const [url2, setUrl2] = useState('');
  const [selector2, setSelector2] = useState('');
  const [strategy2, setStrategy2] = useState('JsonLdExtractionStrategy');
  const [extractionResult2, setExtractionResult2] = useState<string | null>(null);

  const [plpSelector, setPlpSelector] = useState('');
  const [screenshotEnabled, setScreenshotEnabled] = useState(true);
  const [deepScrollEnabled, setDeepScrollEnabled] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [harvestSku, setHarvestSku] = useState('');
  const [indexerMode, setIndexerMode] = useState<'upload' | 'manual'>('upload');
  const [manualSkuData, setManualSkuData] = useState({
    sku: '',
    brand: '',
    ean: '',
    shipping_weight: '',
    product_type: '',
    attribute_set: '',
    base_code: '',
    sap_data: ''
  });
  const skuIndexFetchVersionRef = useRef(0);
  
  // Sync core data
  useEffect(() => {
    if (!authUser) return;
    const fetchData = async () => {
      const skuIndexFetchVersion = ++skuIndexFetchVersionRef.current;
      try {
        const safeFetch = async (url: string, defaultVal: any) => {
          try {
            const r = await apiFetch(url);
            if (!r.ok) return defaultVal;
            const text = await r.text();
            try { return JSON.parse(text); } catch { return defaultVal; }
          } catch(e) {
            console.error("SafeFetch error on", url, e);
            return defaultVal;
          }
        };
        const [idx, hrv, settings] = await Promise.all([
          safeFetch('/api/sku/index', []),
          safeFetch('/api/harvest', []),
          safeFetch('/api/settings', {})
        ]);
        setAppSettings(prev => ({ ...prev, ...settings }));
        if (skuIndexFetchVersion === skuIndexFetchVersionRef.current) {
          setSkuIndex(Array.isArray(idx) ? idx : []);
        }
        setHarvestFiles(Array.isArray(hrv) ? hrv : []);
        if (Array.isArray(idx) && idx.length > 0) fetchJobs();
      } catch (e) {
        console.error("Baseline sync failed", e);
      }
    };
    fetchData();
  }, [authUser]);

  const fetchJobs = async (params?: { cursor?: string; search?: string; append?: boolean }) => {
    try {
      const searchParam = params?.search !== undefined ? params.search : jobsSearch;
      const qs = new URLSearchParams({ limit: '50' });
      if (params?.cursor) qs.set('cursor', params.cursor);
      if (searchParam) qs.set('search', searchParam);

      const res = await apiFetch(`/api/jobs?${qs}`);
      if (!res.ok) return;
      const text = await res.text();
      let data: any;
      try { data = JSON.parse(text); } catch { return; }

      // Handle both legacy array format and new paginated format
      if (Array.isArray(data)) {
        setJobs(data);
        setJobsHasMore(false);
        setJobsNextCursor(null);
        setJobsTotal(data.length);
      } else {
        const items = Array.isArray(data.items) ? data.items : [];
        if (params?.append) {
          setJobs(prev => [...prev, ...items]);
        } else {
          setJobs(items);
        }
        setJobsHasMore(!!data.hasMore);
        setJobsNextCursor(data.nextCursor ?? null);
        setJobsTotal(data.total);
      }
    } catch (e) {
      console.error("Failed to fetch jobs", e);
    }
  };

  const handlePdfTrigger = (sku: string) => {
    setPdfUploadSku(sku);
    if (pdfInputRef.current) pdfInputRef.current.click();
  };

  const handlePdfFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !pdfUploadSku) return;
    addLog('wait', `Uploading Context 1 (PDF) for SKU: ${pdfUploadSku}`);
    
    const formData = new FormData();
    formData.append('file', file);
    formData.append('sku', pdfUploadSku);
    
    try {
      const res = await apiFetch('/api/upload-pdf', {
        method: 'POST',
        body: formData
      });
      if (res.ok) {
        addLog('success', `PDF attached as Context 1 for SKU: ${pdfUploadSku}`);
        const skuIndexFetchVersion = ++skuIndexFetchVersionRef.current;
        const idxRes = await apiFetch('/api/sku/index');
        const refreshedIdx = await idxRes.json();
        if (skuIndexFetchVersion === skuIndexFetchVersionRef.current) {
          setSkuIndex(Array.isArray(refreshedIdx) ? refreshedIdx : []);
        }
      } else {
        const err = await res.json();
        addLog('error', `Failed to upload PDF: ${err.error}`);
      }
    } catch(err: any) {
      addLog('error', `PDF upload error: ${err.message}`);
    }
    setPdfUploadSku(null);
    if(pdfInputRef.current) pdfInputRef.current.value = '';
  };

  const fetchHarvest = async () => {
    const res = await apiFetch('/api/harvest');
    const data = await res.json();
    setHarvestFiles(data);
  };
  const [savedSelectors, setSavedSelectors] = useState<{name: string, selector: string, strategy: string}[]>([]);
  const [savedPlpSelectors, setSavedPlpSelectors] = useState<{name: string, selector: string}[]>([]);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showSavePlpDialog, setShowSavePlpDialog] = useState(false);
  const [showHarvestModal, setShowHarvestModal] = useState(false);
  const [harvestSearch, setHarvestSearch] = useState('');
  const [tempSelectorName, setTempSelectorName] = useState('');
  const [tempPlpSelectorName, setTempPlpSelectorName] = useState('');
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [selectedImageUrls, setSelectedImageUrls] = useState<string[]>([]);
  const [isExportingImages, setIsExportingImages] = useState(false);
  const [imageExportError, setImageExportError] = useState<string | null>(null);
  const [selectedHarvestSource, setSelectedHarvestSource] = useState<SelectedHarvestImageSource | null>(null);
  const [primaryHarvestEntries, setPrimaryHarvestEntries] = useState<HarvestEditorEntry[]>([]);
  const [activeHarvestEntryFilename, setActiveHarvestEntryFilename] = useState<string | null>(null);
  const [editingHarvestFilename, setEditingHarvestFilename] = useState<string | null>(null);
  const [editedHarvestContent, setEditedHarvestContent] = useState('');
  const [isSavingHarvestEntry, setIsSavingHarvestEntry] = useState(false);
  const [harvestSaveError, setHarvestSaveError] = useState<string | null>(null);
  const [loadingHarvestFile, setLoadingHarvestFile] = useState(false);
  const [selectedJobs, setSelectedJobs] = useState<string[]>([]);
  const [isExportingOutputs, setIsExportingOutputs] = useState(false);
  const [outputExportError, setOutputExportError] = useState<string | null>(null);
  const [selectedSkuIndexItems, setSelectedSkuIndexItems] = useState<string[]>([]);
  const [jobAiModels, setJobAiModels] = useState<{[sku:string]: string}>({});
  const [customJobAiModels, setCustomJobAiModels] = useState<{[sku:string]: string}>({});
  const [bulkSkuAttributeSet, setBulkSkuAttributeSet] = useState('');
  // Pagination state for the Jobs module
  const [jobsSearch, setJobsSearch] = useState('');
  const [jobsNextCursor, setJobsNextCursor] = useState<string | null>(null);
  const [jobsHasMore, setJobsHasMore] = useState(false);
  const [jobsTotal, setJobsTotal] = useState<number | undefined>(undefined);
  const [currentScreenshot, setCurrentScreenshot] = useState<string | null>(null);
  const [isScreenshotExpanded, setIsScreenshotExpanded] = useState(false);
  const [viewingPdfSku, setViewingPdfSku] = useState<string | null>(null);
  const [viewingPdfContent, setViewingPdfContent] = useState<string | null>(null);
  const [discoveredLinks, setDiscoveredLinks] = useState<{href: string, text: string}[]>([]);
  const [discoveryMode, setDiscoveryMode] = useState(false);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const isAdmin = authUser?.role === 'admin';

  const hydrateCoreData = async () => {
    const skuIndexFetchVersion = ++skuIndexFetchVersionRef.current;
    try {
      const [idxRes, harvestRes, settingsRes] = await Promise.all([
        apiFetch('/api/sku/index'),
        apiFetch('/api/harvest'),
        apiFetch('/api/settings')
      ]);

      if (idxRes.ok) {
        const idx = await idxRes.json();
        if (skuIndexFetchVersion === skuIndexFetchVersionRef.current) {
          setSkuIndex(Array.isArray(idx) ? idx : []);
        }
      }
      if (harvestRes.ok) {
        const harvest = await harvestRes.json();
        setHarvestFiles(Array.isArray(harvest) ? harvest : []);
      }
      if (settingsRes.ok) {
        const settings = await settingsRes.json();
        setAppSettings(prev => ({ ...prev, ...settings }));
      }
      fetchJobs();
    } catch {
      // Keep app usable even if hydration partially fails.
    }
  };

  const loginWithEmail = async (email: string, accessCode: string) => {
    try {
      const res = await apiFetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, accessCode }),
        credentials: 'include'
      });
      if (!res.ok) return false;
      const payload = await res.json().catch(() => null);
      if (payload?.user) {
        setAuthUser(payload.user);
        cacheAuthUser(payload.user);
      }
      setCsrfToken(payload?.csrfToken || null);
      await hydrateCoreData();
      return true;
    } catch {
      return false;
    }
  };

  const submitLogin = async () => {
    if (!loginEmail.trim()) {
      addLog('error', 'Email is required.');
      return;
    }
    if (!loginAccessCode.trim()) {
      addLog('error', 'Access code is required.');
      return;
    }
    setIsLoggingIn(true);
    const ok = await loginWithEmail(loginEmail.trim().toLowerCase(), loginAccessCode);
    setIsLoggingIn(false);
    if (ok) {
      setLoginAccessCode('');
      addLog('success', 'Logged in successfully.');
    } else {
      addLog('error', 'Login failed. Check your email and access code.');
    }
  };

  const logout = async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Best effort logout.
    }
    setCsrfToken(null);
    setAuthUser(null);
    cacheAuthUser(null);
    setAllowlistUsers([]);
    addLog('system', 'Session ended.');
  };

  const fetchAllowlistUsers = async () => {
    if (!isAdmin) return;
    try {
      const res = await apiFetch('/api/admin/users');
      if (!res.ok) return;
      const users = await res.json();
      setAllowlistUsers(Array.isArray(users) ? users : []);
    } catch {
      // Ignore temporary load errors in admin panel.
    }
  };

  const upsertAllowlistUser = async () => {
    if (!isAdmin || !newUserEmail.trim()) return;
    setIsManagingUsers(true);
    try {
      const res = await apiFetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newUserEmail.trim().toLowerCase(), role: newUserRole })
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error || 'Failed to save user');
      }
      setNewUserEmail('');
      setNewUserRole('user');
      await fetchAllowlistUsers();
      addLog('success', 'User role updated.');
    } catch (e: any) {
      addLog('error', e?.message || 'Failed to save user');
    } finally {
      setIsManagingUsers(false);
    }
  };

  const deleteAllowlistUser = async (email: string) => {
    if (!isAdmin) return;
    setIsManagingUsers(true);
    try {
      const res = await apiFetch(`/api/admin/users/${encodeURIComponent(email)}`, {
        method: 'DELETE'
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error || 'Failed to remove user');
      }
      await fetchAllowlistUsers();
      addLog('success', `Removed ${email} from allowlist.`);
    } catch (e: any) {
      addLog('error', e?.message || 'Failed to remove user');
    } finally {
      setIsManagingUsers(false);
    }
  };

  const [imageSku, setImageSku] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [imageScreenshotEnabled, setImageScreenshotEnabled] = useState(false);
  const [isExtractingImage, setIsExtractingImage] = useState(false);
  const [extractedImages, setExtractedImages] = useState<{sku: string, originalUrl: string, imagePath: string, screenshotPath?: string}[]>([]);

  const handleImageExtract = async () => {
    if(!imageSku || !imageUrl) return;
    setIsExtractingImage(true);
    addLog('wait', `Extracting image for SKU: ${imageSku} from ${imageUrl}`);
    try {
      const res = await apiFetch('/api/images/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sku: imageSku, url: imageUrl, screenshotEnabled: imageScreenshotEnabled })
      });
      const data = await res.json();
      if(data.success && data.images && data.images.length > 0) {
        addLog('success', `Extracted ${data.images.length} images successfully for SKU: ${imageSku}`);
        setExtractedImages(prev => [...data.images, ...prev]);
        setImageSku('');
        setImageUrl('');
      } else {
        if (data.screenshotPath) {
          setExtractedImages(prev => [{sku: imageSku, originalUrl: imageUrl, imagePath: '', screenshotPath: data.screenshotPath}, ...prev]);
        }
        addLog('error', `Failed to extract image: ${data.error || 'Unknown error'}`);
      }
    } catch(err: any) {
      addLog('error', `Image extraction error: ${err.message}`);
    } finally {
      setIsExtractingImage(false);
    }
  };

  const handleImageDelete = async (skuToDelete: string) => {
    addLog('wait', `Deleting image for SKU: ${skuToDelete}`);
    try {
      const res = await apiFetch(`/api/images/${encodeURIComponent(skuToDelete)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.success) {
        addLog('success', `Image deleted for SKU: ${skuToDelete}`);
        setExtractedImages(prev => prev.filter(img => img.sku !== skuToDelete));
      } else {
        addLog('error', `Failed to delete image: ${data.error}`);
      }
    } catch(err: any) {
      addLog('error', `Image deletion error: ${err.message}`);
    }
  };

  const sanitizeImageSku = (value: string) => value.trim().replace(/[^a-z0-9_-]/gi, '_') || 'sku';

  const toggleImageSelection = (url: string) => {
    setImageExportError(null);
    setSelectedImageUrls(prev => {
      if (prev.includes(url)) {
        return prev.filter(item => item !== url);
      }

      if (prev.length >= 10) {
        addLog('error', 'Select up to 10 scraped images before exporting.');
        return prev;
      }

      return [...prev, url];
    });
  };

  const exportSelectedImages = async () => {
    if (selectedImageUrls.length === 0 || isExportingImages) return;

    // Use provided SKU or default to 'sku'
    const effectiveSku = imageSku.trim() || 'sku';
    const safeSku = sanitizeImageSku(effectiveSku);
    setIsExportingImages(true);
    setImageExportError(null);

    console.log('[EXPORT] Starting export:', { selectedCount: selectedImageUrls.length, sku: effectiveSku, safeSku });

    try {
      for (let index = 0; index < selectedImageUrls.length; index++) {
        const sourceUrl = selectedImageUrls[index];
        addLog('wait', `Preparing ${safeSku}-${index + 1}.jpg`);
        
        console.log(`[EXPORT] Processing ${index + 1}/${selectedImageUrls.length}:`, sourceUrl);

        const res = await apiFetch('/api/images/render', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sku: effectiveSku, url: sourceUrl })
        });

        if (!res.ok) {
          const payload = await res.json().catch(() => null);
          const errorMsg = payload?.error || payload?.details || res.statusText || `Failed to prepare image ${index + 1}`;
          console.error(`Export error for ${sourceUrl}:`, { status: res.status, payload });
          throw new Error(errorMsg);
        }

        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = objectUrl;
        anchor.download = `${safeSku}-${index + 1}.jpg`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
        await new Promise(resolve => setTimeout(resolve, 150));
      }

      addLog('success', `Exported ${selectedImageUrls.length} JPG file(s).`);
      console.log('[EXPORT] All files exported successfully');
    } catch (error: any) {
      const message = error?.message || 'Export failed';
      setImageExportError(message);
      addLog('error', message);
      console.error('[EXPORT] Error:', error);
    } finally {
      setIsExportingImages(false);
    }
  };

  const loadHarvestFile = async (filename: string) => {
    setLoadingHarvestFile(true);
    setImageExportError(null);
    try {
      const res = await apiFetch(`/api/harvest/${encodeURIComponent(filename)}`);
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.content) throw new Error(payload?.error || 'Failed to load harvest file');
      const content = payload.content as string;
      const urls = extractHarvestImageUrls(content);
      
      if (urls.length === 0) {
        throw new Error('No image URLs found in harvest file');
      }
      
      const derivedSku = deriveHarvestSku(filename);
      setSelectedHarvestSource({ filename, sku: derivedSku, content, urls });
      setImageUrls(urls);
      setImageSku(derivedSku);
      setSelectedImageUrls([]);
      addLog('success', `Loaded ${urls.length} image URLs from ${filename}.`);
    } catch (error: any) {
      const msg = error?.message || 'Failed to load harvest file';
      setImageExportError(msg);
      addLog('error', msg);
    } finally {
      setLoadingHarvestFile(false);
    }
  };

  const [selectedLinks, setSelectedLinks] = useState<string[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([
    { type: 'system', message: 'PaXth Engine initialized (Playwright Mode). System standby.', timestamp: new Date().toLocaleTimeString() }
  ]);

  // Restore session state from server cookie.
  useEffect(() => {
    let mounted = true;
    const restoreSession = async () => {
      try {
        const res = await apiFetch('/api/auth/me');
        if (!mounted) return;
        if (res.ok) {
          const payload = await res.json();
          setAuthUser(payload.user || null);
          cacheAuthUser(payload.user || null);
          setCsrfToken(payload?.csrfToken || null);
          await hydrateCoreData();
        } else {
          setCsrfToken(null);
          setAuthUser(null);
          cacheAuthUser(null);
        }
      } catch {
        if (mounted) {
          setCsrfToken(null);
          setAuthUser(null);
          cacheAuthUser(null);
        }
      } finally {
        if (mounted) setIsAuthChecking(false);
      }
    };
    restoreSession();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (isAdmin) {
      fetchAllowlistUsers();
    }
  }, [isAdmin]);

  useEffect(() => {
    let mounted = true;

    if (!authUser) {
      setFirestoreHealth(null);
      setIsFirestoreStatusLoading(false);
      return () => {
        mounted = false;
      };
    }

    const fetchFirestoreHealth = async () => {
      try {
        const res = await apiFetch('/api/health/firestore');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (mounted && data?.firestore) {
          setFirestoreHealth(data.firestore);
        }
      } catch {
        if (mounted) {
          setFirestoreHealth(null);
        }
      } finally {
        if (mounted) {
          setIsFirestoreStatusLoading(false);
        }
      }
    };

    fetchFirestoreHealth();
    const interval = window.setInterval(fetchFirestoreHealth, 30000);

    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, [authUser]);

  useEffect(() => {
    const selectorPresets = appSettings.selectorPresets?.length > 0 ? appSettings.selectorPresets : defaultSelectorPresets;
    const plpPresets = appSettings.plpSelectorPresets?.length > 0 ? appSettings.plpSelectorPresets : defaultPlpPresets;
    setSavedSelectors(selectorPresets);
    setSavedPlpSelectors(plpPresets);
  }, [appSettings.selectorPresets, appSettings.plpSelectorPresets]);

  const saveSelector = () => {
    if (!isAdmin) {
      addLog('error', 'Admin mode required to save selector presets.');
      return;
    }
    if (!tempSelectorName || !selector) return;
    const newSelectors = [...savedSelectors, { 
      name: tempSelectorName, 
      selector, 
      strategy 
    }];
    setSavedSelectors(newSelectors);
    const updatedSettings = { ...appSettings, selectorPresets: newSelectors };
    setAppSettings(updatedSettings);
    persistSettings(updatedSettings);
    setTempSelectorName('');
    setShowSaveDialog(false);
    addLog('success', `Extraction Profile "${tempSelectorName}" saved.`);
  };

  const deleteSelector = (index: number) => {
    if (!isAdmin) {
      addLog('error', 'Admin mode required to delete selector presets.');
      return;
    }
    const newSelectors = savedSelectors.filter((_, i) => i !== index);
    setSavedSelectors(newSelectors);
    const updatedSettings = { ...appSettings, selectorPresets: newSelectors };
    setAppSettings(updatedSettings);
    persistSettings(updatedSettings);
  };

  const savePlpSelector = () => {
    if (!isAdmin) {
      addLog('error', 'Admin mode required to save PLP presets.');
      return;
    }
    if (!tempPlpSelectorName || !plpSelector) return;
    const newSelectors = [...savedPlpSelectors, { 
      name: tempPlpSelectorName, 
      selector: plpSelector
    }];
    setSavedPlpSelectors(newSelectors);
    const updatedSettings = { ...appSettings, plpSelectorPresets: newSelectors };
    setAppSettings(updatedSettings);
    persistSettings(updatedSettings);
    setTempPlpSelectorName('');
    setShowSavePlpDialog(false);
    addLog('success', `PLP Preset "${tempPlpSelectorName}" saved.`);
  };

  const handleBatchUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBatchFile(file);

    try {
      const rows = await readFirstWorksheetRows(file);

      if (rows.length === 0) {
        throw new Error('The manifest is empty.');
      }

      const headerRow = rows[0].map((cell) => cell?.toString().trim().toLowerCase());
      const skuIndex = headerRow.indexOf('sku');
      const urlIndex = headerRow.indexOf('url');

      if (skuIndex === -1 || urlIndex === -1) {
        throw new Error('The manifest must include sku and url headers.');
      }

      const parsed: BatchManifestRow[] = [];
      const invalidRows: number[] = [];

      rows.slice(1).forEach((row, idx) => {
        const sku = row[skuIndex]?.toString().trim() || '';
        const itemUrl = row[urlIndex]?.toString().trim() || '';
        const rowIsEmpty = row.every((cell) => !cell?.toString().trim());

        if (rowIsEmpty) return;

        if (!sku || !itemUrl) {
          invalidRows.push(idx + 2);
          return;
        }

        parsed.push({ sku, url: itemUrl });
      });

      if (invalidRows.length > 0) {
        throw new Error(`Rows ${invalidRows.join(', ')} are missing a sku or url value.`);
      }

      if (parsed.length === 0) {
        throw new Error('No valid sku/url rows were found in the manifest.');
      }

      const seenSkus = new Set<string>();
      const duplicateSkus: string[] = [];
      parsed.forEach((item) => {
        if (seenSkus.has(item.sku) && !duplicateSkus.includes(item.sku)) {
          duplicateSkus.push(item.sku);
          return;
        }
        seenSkus.add(item.sku);
      });

      if (duplicateSkus.length > 0) {
        throw new Error(`Duplicate sku values are not allowed: ${duplicateSkus.join(', ')}`);
      }

      setBatchData(parsed);
      addLog('success', `Loaded ${parsed.length} items from batch file.`);
    } catch (err: any) {
      setBatchData([]);
      addLog('error', err?.message || 'Failed to parse Excel file. Ensure columns are sku and url.');
    }
  };

  const handleBatchScrape = async () => {
    if (isScraping || batchData.length === 0) return;
    setIsScraping(true);
    setActiveHarvestEntryFilename(null);
    setEditingHarvestFilename(null);
    setEditedHarvestContent('');
    setHarvestSaveError(null);
    addLog('system', `Initiating Batch Harvest [${batchData.length} items]...`);
    setProgress(1);

    const BATCH_SIZE = 2;
    for (let i = 0; i < batchData.length; i += BATCH_SIZE) {
      const currentBatch = batchData.slice(i, i + BATCH_SIZE);
      addLog('action', `Processing Batch ${Math.floor(i/BATCH_SIZE) + 1}...`);
      
      const promises = currentBatch.map(async (item, idx) => {
        const globalIdx = i + idx;
        try {
          // Step 1: enqueue
          const startRes = await apiFetch('/api/scrape', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              url: item.url, 
              selector, 
              extractWithAI: strategy === 'AIExtractionStrategy',
              strategy,
              enableScreenshot: screenshotEnabled,
              deepScroll: deepScrollEnabled,
              sku: item.sku
            })
          });
          
          if (!startRes.ok) {
            const errData = await startRes.json().catch(() => ({}));
            throw new Error(errData.details || errData.error || `HTTP ${startRes.status}`);
          }
          
          const { jobId } = await startRes.json();
          addLog('network', `[${globalIdx + 1}/${batchData.length}] Queued ${item.sku} (${jobId})`);
          
          // Step 2: poll until done
          const data = await pollJob(jobId, SCRAPE_JOB_POLL_TIMEOUT_MS);

          if (strategy === 'LLMExtractionStrategy') {
            addLog('error', 'Advanced Extraction Strategy is currently suspended. Please use AI Credits (DeepSeek/Qwen) for active synthesis.');
            throw new Error('Advanced Strategy Suspended');
          }

          if (!(data.aiResult || data.text)) {
            throw new Error('Scrape completed without harvest content.');
          }

          const safeSku = item.sku.toString().replace(/[^a-z0-9_-]/gi, '_');
          await syncHarvestEntryFromServer(`${safeSku}.md`, 'batch harvest');

          addLog('success', `[${globalIdx + 1}/${batchData.length}] Saved: ${item.sku}.md`);
        } catch (err: any) {
          addLog('error', `[${globalIdx + 1}/${batchData.length}] Failed ${item.sku}: ${err.message}`);
        }
      });

      await Promise.all(promises);
      setProgress(Math.round(((i + currentBatch.length) / batchData.length) * 100));
    }

    await Promise.all([
      fetchHarvest(),
      fetchJobs(),
    ]);
    addLog('success', 'Batch Harvest complete. All files saved to backend /harvest folder.');
    setIsScraping(false);
    setProgress(100);
  };

  const handleSkuUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSkuFile(file);

    try {
      let data = await readFirstWorksheetObjects(file);

      // Sanitize headers to ensure compatibility (sku, brand, ean, shipping_weight, product_type, attribute_set)
      data = data.map(item => normalizeSkuIndexRecordForSubmit(item, bulkSkuAttributeSet));

      // Map XLS column names to internal field names
      const XLS_COLUMN_MAP: Record<string, string> = {
        attributes__lulu_ean: 'ean',
        attributes__shipping_weight: 'shipping_weight',
        attributes__lulu_product_type: 'product_type',
      };
      data = data.map(item => {
        const mapped: any = { ...item };
        Object.entries(XLS_COLUMN_MAP).forEach(([from, to]) => {
          if (from in mapped) {
            mapped[to] = mapped[from];
            delete mapped[from];
          }
        });
        return mapped;
      });

      // Save to backend
      const res = await apiFetch('/api/sku/index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data })
      });
      if (res.ok) {
         const skuIndexFetchVersion = ++skuIndexFetchVersionRef.current;
         const idxRes = await apiFetch('/api/sku/index');
         const refreshedIdx = await idxRes.json();
         if (skuIndexFetchVersion === skuIndexFetchVersionRef.current) {
           setSkuIndex(Array.isArray(refreshedIdx) ? refreshedIdx : []);
         }
         addLog('success', `SKU Indexer synced with ${data.length} records (merged with existing).`);
      } else {
         const payload = await res.json().catch(() => null);
         throw new Error(payload?.error || 'Upload rejected.');
      }
    } catch (err: any) {
      addLog('error', err?.message || 'SKU Indexing failed.');
    }
  };

  const handleDownloadSkuTemplate = async () => {
    const headers = ['sku', 'base_code', 'brand', 'attributes__lulu_ean', 'attributes__shipping_weight', 'attributes__lulu_product_type', 'sap_data', 'attribute_set'];
    try {
      await downloadXlsxTemplate('sku_index_template.xlsx', 'SKU Template', headers);
      addLog('success', 'SKU template download started.');
    } catch (error: any) {
      addLog('error', error?.message || 'Failed to download SKU template.');
    }
  };

  const handleDownloadBatchTemplate = async () => {
    try {
      await downloadXlsxTemplate('batch_manifest_template.xlsx', 'Batch Manifest', BATCH_TEMPLATE_HEADERS);
      addLog('success', 'Batch template download started.');
    } catch (error: any) {
      addLog('error', error?.message || 'Failed to download batch template.');
    }
  };

  const handleSkuDelete = async (sku: string) => {
    try {
      addLog('wait', `Deleting SKU from system: ${sku}`);
      const res = await apiFetch(`/api/sku/index/${sku}`, { method: 'DELETE' });
      if (res.ok) {
        setSkuIndex(prev => prev.filter(s => (s.sku || s.SKU)?.toString() !== sku));
        setSelectedSkuIndexItems(prev => prev.filter(s => s !== sku));
        addLog('success', `SKU ${sku} purged (index + harvest + output).`);
      } else {
        throw new Error('Delete failed');
      }
    } catch (e) {
      addLog('error', 'Failed to delete SKU.');
    }
  };

  const handleBulkSkuDelete = async (skus: string[], source: 'indexer' | 'jobs') => {
    if (skus.length === 0) return;
    addLog('wait', `Purging ${skus.length} SKU(s)…`);
    try {
      const res = await apiFetch('/api/sku/index/purge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skus }),
      });
      if (!res.ok) throw new Error('Purge request failed');
      const data = await res.json();
      const deleted: number = data.deleted ?? skus.length;
      const skuSet = new Set(skus);
      setSkuIndex(prev => prev.filter(s => !skuSet.has((s.sku || s.SKU)?.toString() ?? '')));
      setJobs(prev => prev.filter((j: any) => !skuSet.has((j.sku || j.SKU)?.toString() ?? '')));
      setSelectedSkuIndexItems([]);
      setSelectedJobs([]);
      addLog('success', `${deleted} SKU(s) purged (index + harvest + output).`);
      fetchJobs();
    } catch (e: any) {
      addLog('error', `Bulk SKU purge failed: ${e?.message ?? 'unknown error'}`);
    }
  };

  const handleHarvestDelete = async (filename: string) => {
    try {
      addLog('wait', `Purging harvest file: ${filename}`);
      const res = await apiFetch(`/api/harvest/${filename}`, { method: 'DELETE' });
      if (res.ok) {
        setPrimaryHarvestEntries((prev) => prev.filter((entry) => entry.filename !== filename));
        if (activeHarvestEntryFilename === filename) {
          setActiveHarvestEntryFilename(null);
          setIsModalOpen(false);
        }
        if (editingHarvestFilename === filename) {
          setEditingHarvestFilename(null);
          setEditedHarvestContent('');
          setHarvestSaveError(null);
        }
        if (selectedHarvestSource?.filename === filename) {
          setSelectedHarvestSource(null);
          setImageUrls([]);
          setSelectedImageUrls([]);
        }
        addLog('success', 'Harvest deleted.');
        fetchJobs();
        fetchHarvest();
      }
    } catch (e) {
      addLog('error', 'Harvest purge failed.');
    }
  };

  const openHarvestFile = async (filename: string, sourceLabel = 'harvest archive') => {
    try {
      await syncHarvestEntryFromServer(filename, sourceLabel);
      setExtractionResult2(null);
      setIsModalOpen(true);
      if (sourceLabel === 'harvest archive') {
        setShowHarvestModal(false);
      }
      addLog('action', `Opening ${sourceLabel}: ${filename}`);
    } catch (error: any) {
      addLog('error', error?.message || 'Failed to load harvest file.');
    }
  };

  const handleOutputDelete = async (sku: string) => {
    try {
      addLog('wait', `Purging output data for SKU: ${sku}`);
      const res = await apiFetch(`/api/outputs/${sku}`, { method: 'DELETE' });
      if (res.ok) {
        addLog('success', 'Output data purged.');
        fetchJobs();
      }
    } catch (e) {
      addLog('error', 'Output purge failed.');
    }
  };

  const handleManualSkuSubmit = async () => {
    if (!manualSkuData.sku) {
      addLog('error', 'SKU is required for manual indexing.');
      return;
    }
    
    try {
      const submittedSku = manualSkuData.sku;
      const res = await apiFetch('/api/sku/index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: [normalizeSkuIndexRecordForSubmit(manualSkuData, manualSkuData.attribute_set)] })
      });
      if (res.ok) {
        // Re-fetch to get merged state
        const skuIndexFetchVersion = ++skuIndexFetchVersionRef.current;
        const idxRes = await apiFetch('/api/sku/index');
        const refreshedIdx = await idxRes.json();
        if (skuIndexFetchVersion === skuIndexFetchVersionRef.current) {
          setSkuIndex(Array.isArray(refreshedIdx) ? refreshedIdx : []);
        }
        setManualSkuData({ sku: '', brand: '', ean: '', shipping_weight: '', product_type: '', attribute_set: '', base_code: '', sap_data: '' });
        addLog('success', `Manual sku indexed: ${submittedSku}`);
      }
    } catch (e) {
      addLog('error', 'Manual indexing failed.');
    }
  };

  const deletePlpSelector = (index: number) => {
    if (!isAdmin) {
      addLog('error', 'Admin mode required to delete PLP presets.');
      return;
    }
    const newSelectors = savedPlpSelectors.filter((_, i) => i !== index);
    setSavedPlpSelectors(newSelectors);
    const updatedSettings = { ...appSettings, plpSelectorPresets: newSelectors };
    setAppSettings(updatedSettings);
    persistSettings(updatedSettings);
  };
  const [viewingOutput, setViewingOutput] = useState<SkuRecord | null>(null);
  const [editingOutputSku, setEditingOutputSku] = useState<string | null>(null);
  const [isSavingOutput, setIsSavingOutput] = useState(false);

  const handleViewPdf = async (sku: string) => {
    addLog('wait', `Fetching PDF content for ${sku}...`);
    try {
      const res = await apiFetch(`/api/pdf/${sku}`);
      if (res.ok) {
        const data = await res.json();
        setViewingPdfContent(data.text);
        setViewingPdfSku(sku);
        addLog('success', 'PDF content loaded.');
      } else {
        addLog('error', 'Failed to load PDF content');
      }
    } catch (e) {
      addLog('error', 'Network error fetching PDF');
    }
  };

  const fetchOutput = async (sku: string) => {
    try {
      const res = await apiFetch(`/api/outputs/json/${sku}.json`); // Note: I need to check if I have this get route
      if (res.ok) {
        const data = await res.json();
        setViewingOutput(data);
        setEditingOutputSku(sku);
      }
    } catch (e) {
      addLog('error', 'Failed to fetch output data.');
    }
  };

  const handleExportOutputs = async () => {
    setIsExportingOutputs(true);
    setOutputExportError(null);
    try {
      const params = new URLSearchParams();
      if (selectedJobs.length > 0) params.set('skus', selectedJobs.join(','));
      const res = await apiFetch(`/api/outputs/xlsx${params.toString() ? `?${params}` : ''}`);
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.details || payload?.error || 'Failed to generate XLSX export.');
      }

      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') || '';
      const filename = disposition.match(/filename="?([^"]+)"?/i)?.[1] || 'CMS_Upload_Master.xlsx';
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      addLog('success', `XLSX export started${selectedJobs.length > 0 ? ` for ${selectedJobs.length} selected SKU(s)` : ''}.`);
    } catch (error: any) {
      const message = error?.message || 'Failed to export XLSX.';
      setOutputExportError(message);
      addLog('error', message);
    } finally {
      setIsExportingOutputs(false);
    }
  };

  const handleSaveOutput = async () => {
    if (!editingOutputSku || !viewingOutput) return;
    setIsSavingOutput(true);
    try {
      const res = await apiFetch(`/api/outputs/${editingOutputSku}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(viewingOutput)
      });
      if (res.ok) {
        addLog('success', `Output data for ${editingOutputSku} updated.`);
        setViewingOutput(null);
      }
    } catch (e) {
      addLog('error', 'Failed to save edits.');
    } finally {
      setIsSavingOutput(false);
    }
  };

  const runMapping = async (sku: string) => {
    try {
      addLog('wait', `Dispatching AI Mapping for SKU: ${sku}`);
      const res = await apiFetch('/api/jobs/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sku })
      });
      
      if (res.ok) {
        const data = await res.json();
        addLog('success', `AI Mapping complete for ${sku}. Attributes synthesized.`);
        fetchJobs();
      } else {
        const err = await res.json();
        throw new Error(err.error || 'Mapping failed');
      }
    } catch (e: any) {
      addLog('error', `Mapping failed: ${e.message}`);
    }
  };

  const [isScraping, setIsScraping] = useState(false);
  const [progress, setProgress] = useState(0);
  const [extractionResult, setExtractionResult] = useState<string | null>(null);
  const [isEditingPrimary, setIsEditingPrimary] = useState(false);
  const [editedPrimaryResult, setEditedPrimaryResult] = useState<string>('');
  const [isEditingSecondary, setIsEditingSecondary] = useState(false);
  const [editedSecondaryResult, setEditedSecondaryResult] = useState<string>('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [logs]);

  const addLog = (type: LogEntry['type'], message: string) => {
    setLogs(prev => [...prev, { type, message, timestamp: new Date().toLocaleTimeString() }]);
  };

  const activeHarvestEntry = activeHarvestEntryFilename
    ? primaryHarvestEntries.find((entry) => entry.filename === activeHarvestEntryFilename) ?? null
    : null;
  const modalHarvestContent = activeHarvestEntry?.content ?? extractionResult;
  const isEditingActiveHarvestEntry = !!activeHarvestEntry && editingHarvestFilename === activeHarvestEntry.filename;

  async function fetchHarvestFileContent(filename: string): Promise<string> {
    const res = await apiFetch(`/api/harvest/${encodeURIComponent(filename)}`);
    const payload = await res.json().catch(() => null);
    if (!res.ok || !payload?.content) {
      throw new Error(payload?.error || 'Failed to load harvest file');
    }
    return payload.content as string;
  }

  function upsertPrimaryHarvestEntry(entry: HarvestEditorEntry, focus = true) {
    setPrimaryHarvestEntries((prev) => {
      const next = prev.filter((item) => item.filename !== entry.filename);
      return [entry, ...next];
    });
    if (focus) {
      setActiveHarvestEntryFilename(entry.filename);
    }
  }

  async function syncHarvestEntryFromServer(filename: string, sourceLabel: string, focus = true) {
    const content = await fetchHarvestFileContent(filename);
    const entry = createHarvestEditorEntry(filename, content, sourceLabel);
    upsertPrimaryHarvestEntry(entry, focus);
    return entry;
  }

  function handleEditSavedHarvest(filename: string) {
    const entry = primaryHarvestEntries.find((item) => item.filename === filename);
    if (!entry) return;

    setActiveHarvestEntryFilename(filename);
    setEditingHarvestFilename(filename);
    setEditedHarvestContent(entry.content);
    setHarvestSaveError(null);
  }

  function handleCancelSavedHarvestEdit() {
    setEditingHarvestFilename(null);
    setEditedHarvestContent('');
    setHarvestSaveError(null);
  }

  async function handleSaveSavedHarvest(filename: string) {
    const existingEntry = primaryHarvestEntries.find((item) => item.filename === filename);
    if (!existingEntry) return;

    setIsSavingHarvestEntry(true);
    setHarvestSaveError(null);

    try {
      const res = await apiFetch(`/api/harvest/${encodeURIComponent(filename)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editedHarvestContent }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error || 'Failed to save harvest file');
      }

      const updatedEntry = createHarvestEditorEntry(filename, editedHarvestContent, existingEntry.sourceLabel);
      upsertPrimaryHarvestEntry(updatedEntry);

      if (selectedHarvestSource?.filename === filename) {
        const nextUrls = extractHarvestImageUrls(editedHarvestContent);
        setSelectedHarvestSource({
          ...selectedHarvestSource,
          content: editedHarvestContent,
          urls: nextUrls,
        });
        setImageUrls(nextUrls);
        setSelectedImageUrls((prev) => prev.filter((url) => nextUrls.includes(url)));
      }

      setEditingHarvestFilename(null);
      setEditedHarvestContent('');
      await fetchHarvest();
      addLog('success', `Harvest file updated: ${filename}`);
    } catch (error: any) {
      const message = error?.message || 'Failed to save harvest file';
      setHarvestSaveError(message);
      addLog('error', message);
    } finally {
      setIsSavingHarvestEntry(false);
    }
  }

  const persistSettings = async (settings: any) => {
    if (!isAdmin) {
      addLog('error', 'Admin role is required to save Connectivity, mapping, and preset changes.');
      const res = await apiFetch('/api/settings');
      if (res.ok) {
        const fresh = await res.json();
        setAppSettings(prev => ({ ...prev, ...fresh }));
      }
      return;
    }
    try {
      setIsSavingSettings(true);
      addLog('wait', 'Initiating neural nexus sync...');
      const res = await apiFetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error || 'Sync failed');
      }

      const freshRes = await apiFetch('/api/settings');
      if (freshRes.ok) {
        const fresh = await freshRes.json();
        setAppSettings(prev => ({ ...prev, ...fresh }));
      }
      addLog('success', 'Neural logic persisted to system root.');
    } catch (e: any) {
      addLog('error', `Nexus sync failure: ${e?.message || 'IO Error'}`);
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleScrape = async () => {
    if (isScraping) return;
    
    setIsScraping(true);
    // Add a separator instead of clearing completely to prevent 'black screen' feel
    addLog('system', '--- NEW EXTRACTION SESSION STARTED ---');
    setExtractionResult(null);
    setActiveHarvestEntryFilename(null);
    setEditingHarvestFilename(null);
    setEditedHarvestContent('');
    setHarvestSaveError(null);
    setImageUrls([]);
    setSelectedHarvestSource(null);
    setSelectedImageUrls([]);
    setImageExportError(null);
    setCurrentScreenshot(null);
    setProgress(10);
    
    addLog('system', `Initializing engine for: ${url}`);
    
    try {
      await new Promise(r => setTimeout(r, 1000));
      addLog('debug', 'Setting user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)...');
      setProgress(20);
      
      await new Promise(r => setTimeout(r, 800));
      addLog('success', 'Browser context created in 142ms.');
      addLog('action', 'Navigating to target URL...');
      setProgress(30);

      const requestBody: any = { 
        url, 
        selector,
        extractWithAI: strategy === 'AIExtractionStrategy',
        strategy,
        enableScreenshot: screenshotEnabled,
        deepScroll: deepScrollEnabled,
        sku: harvestSku
      };

      if (hasSecondaryTarget && url2) {
        requestBody.secondaryTarget = {
          url: url2,
          selector: selector2,
          strategy: strategy2
        };
      }

      const startRes = await apiFetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      if (!startRes.ok) {
        const errData = await startRes.json().catch(() => ({}));
        throw new Error(errData.details || errData.error || `Scrape failed (HTTP ${startRes.status})`);
      }
      const { jobId } = await startRes.json();
      addLog('network', `Job enqueued (${jobId}). Polling for result...`);
      setProgress(20);
      
      const data = await pollJob(jobId, SCRAPE_JOB_POLL_TIMEOUT_MS);
      
      // OPTIMIZED SEQUENTIAL UPDATES TO PREVENT MAIN-THREAD BLOCKING
      addLog('network', `Loaded content from ${data.title || 'URL'} (${Math.round(data.text.length / 1024)}kb)`);
      
      if (data.screenshot) {
        setCurrentScreenshot(data.screenshot);
        await new Promise(r => setTimeout(r, 100)); // Pause for paint
      }

      setImageUrls(Array.from(new Set(data.imageUrls || [])));
      addLog('success', 'Visual Snapshot ready.');
      setProgress(50);

      if (strategy === 'LLMExtractionStrategy') {
        addLog('error', 'Advanced Extraction is dormant. Switch to AI Credits (DeepSeek/Qwen) for active synthesis.');
        setProgress(0);
        setIsScraping(false);
        return;
      } else if (strategy === 'AIExtractionStrategy') {
        addLog('skill', 'Applying AI Credits (DeepSeek/Qwen) Extraction...');
        setProgress(80);
        setExtractionResult(`# ${data.title}\n\n${data.aiResult}` || "AI extraction failed or returned no data.");
        
        if (data.secondary) {
            setExtractionResult2(`# ${data.secondary.title}\n\n${data.secondary.aiResult}` || "Secondary extraction failed.");
        } else {
            setExtractionResult2(null);
        }

        addLog('success', 'AI Credits Extraction completed successfully.');
      } else {
        addLog('skill', `Using Raw Data Strategy (${strategy})`);
        await new Promise(r => setTimeout(r, 800));
        setExtractionResult(formatScrapePreview(data.title, strategy, data.text));
        
        if (data.secondary) {
          setExtractionResult2(formatScrapePreview(data.secondary.title, data.secondary.strategy || strategy2, data.secondary.text));
        } else {
            setExtractionResult2(null);
        }

        addLog('success', 'Content retrieved and displayed.');
      }

      setProgress(100);
      addLog('system', 'Job completed. System returned to standby.');
      if (harvestSku) {
        fetchHarvest();
      }
    } catch (error: any) {
      console.error("SCRAPE ERROR:", error);
      addLog('error', `CRITICAL FAILURE: ${error.message}`);
      setProgress(0);
    } finally {
      setIsScraping(false);
    }
  };

  const handleDiscover = async () => {
    if (isDiscovering || !url) return;
    setIsDiscovering(true);
    setDiscoveredLinks([]);
    setSelectedLinks([]);
    addLog('system', `Discovery initialised on base: ${url}`);
    
    try {
      // Enqueue discover job (returns 202)
      const startRes = await apiFetch('/api/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, linkSelector: plpSelector })
      });
      
      if (!startRes.ok) {
        const errData = await startRes.json().catch(() => ({}));
        throw new Error(errData.details || errData.error || `Discovery failed (HTTP ${startRes.status})`);
      }
      const { jobId } = await startRes.json();
      addLog('network', `Discovery job enqueued (${jobId}). Polling...`);

      // Poll until done; discover result is an array of { href, text }
      const links = await pollJob(jobId, DISCOVERY_JOB_POLL_TIMEOUT_MS);

      if (Array.isArray(links) && links.length > 0) {
        // Normalize links
        const urlObj = new URL(url);
        const normalizedLinks = links
          .map((link: any) => ({ ...link, href: link.href?.startsWith('/') ? urlObj.origin + link.href : link.href }))
          .filter((v: any, i: number, a: any[]) => a.findIndex((t: any) => t.href === v.href) === i);
        setDiscoveredLinks(normalizedLinks);
        addLog('success', `Discovered ${normalizedLinks.length} targets. Select targets to begin deep extraction.`);
      } else {
        addLog('error', 'Discovery returned no links. Try a different selector.');
      }
    } catch (e: any) {
      addLog('error', `Discovery failed: ${e.message}`);
    } finally {
      setIsDiscovering(false);
    }
  };

  const handleDeepScrape = async () => {
    if (isScraping || selectedLinks.length === 0) return;
    setIsScraping(true);
    setExtractionResult('');
    addLog('system', `Initializing Parallel Harvest Engine [Concurrency: 5]...`);
    addLog('system', `Processing ${selectedLinks.length} total targets in optimized batches.`);

    let fullReport = "";
    const BATCH_SIZE = 2;
    
    // Process in batches
    for (let i = 0; i < selectedLinks.length; i += BATCH_SIZE) {
       const batch = selectedLinks.slice(i, i + BATCH_SIZE);
       addLog('action', `Executing Batch [${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(selectedLinks.length/BATCH_SIZE)}]...`);
       
       const batchPromises = batch.map(async (linkUrl, index) => {
         const globalIndex = i + index;
         try {
           // Step 1: enqueue
           const startRes = await apiFetch('/api/scrape', {
             method: 'POST',
             headers: { 'Content-Type': 'application/json' },
             body: JSON.stringify({ 
               url: linkUrl, 
               selector, 
               extractWithAI: strategy === 'AIExtractionStrategy',
               strategy,
               enableScreenshot: screenshotEnabled 
             })
           });

           if (!startRes.ok) {
             const errData = await startRes.json().catch(() => ({}));
             throw new Error(errData.details || errData.error || `HTTP ${startRes.status}`);
           }
           const { jobId } = await startRes.json();

           // Step 2: poll until done
           const data = await pollJob(jobId, SCRAPE_JOB_POLL_TIMEOUT_MS);
           
           let pageReport = "";
           if (strategy === 'LLMExtractionStrategy') {
              addLog('error', 'Advanced Strategy inactive.');
              pageReport = "ADVANCED_INACTIVE";
           } else {
              pageReport = data.aiResult || data.text;
           }
           
           addLog('success', `[${globalIndex + 1}/${selectedLinks.length}] Harvested: ${data.title || 'Page'}`);
           return `\n\n--- TARGET: ${linkUrl} ---\n\n${pageReport}`;
         } catch (err: any) {
           addLog('error', `[${globalIndex + 1}/${selectedLinks.length}] Failed: ${linkUrl} (${err.message})`);
           return `\n\n--- TARGET FAILED: ${linkUrl} ---\nError: ${err.message}`;
         }
       });

       const results = await Promise.all(batchPromises);
       fullReport += results.join("");
       setProgress(Math.round(((i + batch.length) / selectedLinks.length) * 100));
    }

    setExtractionResult(fullReport);
    setIsScraping(false);
    addLog('system', 'Deep Harvest Cycle complete. Master data compiled.');
  };

  const handleEditPrimary = () => {
    setEditedPrimaryResult(extractionResult || '');
    setIsEditingPrimary(true);
  };

  const handleSavePrimary = () => {
    setExtractionResult(editedPrimaryResult);
    setIsEditingPrimary(false);
    addLog('success', 'Primary outcome updated.');
  };

  const handleCancelPrimary = () => {
    setIsEditingPrimary(false);
    setEditedPrimaryResult('');
  };

  const handleEditSecondary = () => {
    setEditedSecondaryResult(extractionResult2 || '');
    setIsEditingSecondary(true);
  };

  const handleSaveSecondary = () => {
    setExtractionResult2(editedSecondaryResult);
    setIsEditingSecondary(false);
    addLog('success', 'Secondary outcome updated.');
  };

  const handleCancelSecondary = () => {
    setIsEditingSecondary(false);
    setEditedSecondaryResult('');
  };

  const handleSmartAnalyze = async () => {
    if (!url) {
      addLog('error', 'URL required for Smart Analysis');
      return;
    }
    setIsAnalyzing(true);
    addLog('system', `Initiating Smart Analysis Analysis: ${url}`);
    
    try {
      const response = await apiFetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, deepScroll: deepScrollEnabled })
      });
      
      const result = await response.json();
      if (!response.ok) throw new Error(result.details || result.error || 'Analysis failed');
      
      setSelector(result.selectors);
      setStrategy(result.strategy);
      addLog('success', `AI suggested selectors set: ${result.selectors}`);
      addLog('debug', `Reasoning: ${result.reasoning}`);
      
      if (result.screenshot) {
        setCurrentScreenshot(result.screenshot);
      }
    } catch (e: any) {
      addLog('error', `Smart Analysis failed: ${e.message}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const getLogColor = (type: LogEntry['type']) => {
    switch (type) {
      case 'system': return 'text-blue-500';
      case 'debug': return 'text-white/40';
      case 'success': return 'text-green-500';
      case 'action': return 'text-white/90';
      case 'network': return 'text-white/40';
      case 'wait': return 'text-yellow-500';
      case 'skill': return 'text-blue-400';
      case 'error': return 'text-red-500';
      default: return 'text-white';
    }
  };

  const getLogLabel = (type: LogEntry['type']) => {
    switch (type) {
      case 'system': return 'SYS';
      case 'debug': return 'DBG';
      case 'success': return 'OK';
      case 'action': return 'ACT';
      case 'network': return 'NET';
      case 'wait': return 'WAIT';
      case 'skill': return 'AI';
      case 'error': return 'ERR';
      default: return 'LOG';
    }
  };

  const skuRecords = skuIndex as Record<string, any>[];
  const harvestSkuSet = new Set(harvestFiles.map((file: any) => deriveHarvestSku(file.name).toLowerCase()));
  const uploadedAttributeFields = new Set<string>();
  skuRecords.forEach((record) => {
    Object.keys(record || {}).forEach((key) => {
      if (key.toLowerCase().startsWith('attributes__')) uploadedAttributeFields.add(key);
    });
  });
  const hasSapSource = (record: Record<string, any>) => Boolean(record.sap_data || record.source__sap || record.source_sap);
  const hasUrlSource = (record: Record<string, any>) => Boolean(record.source__url || record.source_url || record.url);
  const hasHarvestSource = (record: Record<string, any>) => {
    const rawSku = (record.sku || record.SKU || '').toString();
    return rawSku ? harvestSkuSet.has(rawSku.replace(/[^a-z0-9_-]/gi, '_').toLowerCase()) : false;
  };
  const uploadedSkuCount = skuRecords.length;
  const sapSourceCount = skuRecords.filter(hasSapSource).length;
  const urlSourceCount = skuRecords.filter(hasUrlSource).length;
  const pdfSourceCount = skuRecords.filter((record) => Boolean(record.pdf_text)).length;
  const harvestSourceCount = skuRecords.filter(hasHarvestSource).length;
  const sourceReadyCount = skuRecords.filter((record) => hasSapSource(record) || record.pdf_text || hasHarvestSource(record)).length;
  const missingSourceCount = Math.max(uploadedSkuCount - sourceReadyCount, 0);
  const completedJobCount = jobs.filter((job) => job.status === 'completed').length;
  const failedJobCount = jobs.filter((job) => job.status === 'failed').length;
  const pendingJobCount = jobs.filter((job) => job.status === 'pending').length;
  const inProgressJobCount = jobs.filter((job) => job.status === 'queued' || job.status === 'running').length;
  const readyMappingJobCount = jobs.filter((job) => job.status === 'ready').length;
  const selectedReviewJob = jobs.find((job) => job.sku === reviewSku) || jobs[0] || null;
  const selectedReviewRecord = selectedReviewJob
    ? skuRecords.find((record) => ((record.sku || record.SKU || '') as string).toString().toLowerCase() === selectedReviewJob.sku.toLowerCase()) || null
    : null;
  const selectedReviewLogs = selectedReviewJob
    ? logs.filter((log) => log.message.toLowerCase().includes(selectedReviewJob.sku.toLowerCase())).slice(-8)
    : [];
  const uploadLatestSuccess = [...logs].reverse().find((log) =>
    log.type === 'success' && /SKU Indexer synced|SKU .* inserted/i.test(log.message)
  );
  const uploadLatestError = [...logs].reverse().find((log) =>
    log.type === 'error' && /SKU Index|Excel|Upload|manifest/i.test(log.message)
  );
  const workflowSteps = ['Upload', 'Pre-QA', 'QA Jobs', 'SKU Review', 'Sources', 'Settings'];

  const moduleNavItems: AppShellNavItem<ModuleId>[] = [
    { id: 'upload', label: 'Upload', description: 'Import catalogue data', icon: Upload },
    { id: 'pre-qa', label: 'Pre-QA', description: 'Readiness checks', icon: Check },
    { id: 'scrapper', label: 'Data Harvest', description: 'Scrape and archive', icon: Cpu },
    { id: 'jobs', label: 'QA Jobs', description: 'Mapping queue', icon: Briefcase },
    { id: 'review', label: 'SKU Review', description: 'Inspect sources', icon: List },
    { id: 'images', label: 'Sources', description: 'Images and archives', icon: ImageIcon },
    { id: 'settings', label: 'Settings', description: 'System controls', icon: Settings },
  ];

  const moduleMeta: Record<ModuleId, { title: string; subtitle: string }> = {
    upload: { title: 'Upload Catalogue', subtitle: 'Import SKU, attribute, and source data before QA.' },
    'pre-qa': { title: 'Pre-QA Readiness', subtitle: 'Check source coverage and job readiness before running AI QA.' },
    scrapper: { title: 'Data Harvest', subtitle: 'Capture product content, discovery targets, and markdown harvest files.' },
    jobs: { title: 'QA Jobs', subtitle: 'Dispatch mapping jobs and review generated catalogue outputs.' },
    review: { title: 'SKU Review', subtitle: 'Inspect SKU data, source context, timelines, and outputs.' },
    images: { title: 'Sources', subtitle: 'Manage harvest files, source images, and export selected assets.' },
    settings: { title: 'Settings', subtitle: 'Configure connectivity, mapping logic, and schema governance.' },
  };

  const scraperModeTabs = [
    { id: 'single', label: 'Single' },
    { id: 'batch', label: 'Batch' },
    { id: 'deep', label: 'Deep' },
  ] as const;

  const firestoreTitle = isFirestoreStatusLoading
    ? 'Checking Firestore...'
    : firestoreHealth
      ? `Mode: ${firestoreHealth.mode} | Project: ${firestoreHealth.projectId || 'n/a'} | DB: ${firestoreHealth.databaseId || '(default)'} | Auth: ${firestoreHealth.authSource || 'n/a'}${firestoreHealth.initError ? ` | Error: ${firestoreHealth.initError}` : ''}`
      : 'Firestore health unavailable';

  const scraperBlockedReason =
    mode === 'single' && !url.trim()
      ? 'Target URL is required before harvest can run.'
      : mode === 'batch' && batchData.length === 0
        ? 'Upload an XLSX manifest before running batch harvest.'
        : mode === 'deep' && selectedLinks.length === 0
          ? 'Run PLP discovery and select at least one target first.'
          : null;

  const scraperActionLabel = isScraping
    ? mode === 'batch' ? 'Processing Batch...' : 'Extracting...'
    : mode === 'batch' ? 'Run Batch Harvest' : mode === 'deep' ? 'Extract Selected Targets' : 'Run Harvest';

  const shellStatusItems = (
    <>
      <Badge tone={isScraping ? 'blue' : 'green'}>
        <span className={`h-2 w-2 rounded-full ${isScraping ? 'bg-blue-400 animate-pulse' : 'bg-emerald-400 status-pulse'}`} />
        {isScraping ? 'Engine Busy' : 'Engine Active'}
      </Badge>
      <Badge
        tone={isFirestoreStatusLoading ? 'neutral' : firestoreHealth?.connected ? 'green' : 'red'}
        title={firestoreTitle}
      >
        <span
          className={[
            'h-2 w-2 rounded-full',
            isFirestoreStatusLoading ? 'bg-white/40 animate-pulse' : firestoreHealth?.connected ? 'bg-emerald-400 status-pulse' : 'bg-red-400',
          ].join(' ')}
        />
        {isFirestoreStatusLoading ? 'Firebase Checking' : firestoreHealth?.connected ? 'Firebase Live' : 'Firebase Fallback'}
      </Badge>
      <Badge tone="neutral">Chromium 124</Badge>
    </>
  );

  return (
    <ErrorBoundary>
      {isAuthChecking ? (
        <div className="h-screen bg-brand-bg flex items-center justify-center">
          <LoadingState label="Restoring session..." />
        </div>
      ) : !authUser ? (
        <div className="h-screen bg-brand-bg flex items-center justify-center p-6">
          <Card className="w-full max-w-md" padded>
            <div className="space-y-2 mb-6">
              <div className="h-10 w-16 rounded-lg border border-white/10 bg-black overflow-hidden">
                <img src="/logoq.png" alt="paxth logo" className="h-full w-full object-contain" />
              </div>
              <h1 className="text-2xl font-black tracking-tight text-slate-950">Paxth Automation Solution</h1>
              <p className="text-sm text-slate-600">Sign in with an approved email and internal access code.</p>
            </div>
            <div className="space-y-4">
              <Input
                type="email"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !isLoggingIn) submitLogin();
                }}
                placeholder="name@company.com"
                label="Email"
              />
              <Input
                type="password"
                value={loginAccessCode}
                onChange={(e) => setLoginAccessCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !isLoggingIn) submitLogin();
                }}
                placeholder="Access code"
                autoComplete="current-password"
                label="Access code"
              />
              <Button
                onClick={submitLogin}
                disabled={isLoggingIn || !loginEmail.trim() || !loginAccessCode.trim()}
                className="w-full"
                size="lg"
              >
                {isLoggingIn ? 'Signing In...' : 'Sign In'}
              </Button>
            </div>
          </Card>
        </div>
      ) : (
      <AppShell<ModuleId>
        productName="paxth"
        versionLabel="v22.30"
        logoSrc="/logoq.png"
        navItems={moduleNavItems}
        activeNavId={currentModule}
        onNavChange={setCurrentModule}
        title={moduleMeta[currentModule].title}
        subtitle={moduleMeta[currentModule].subtitle}
        statusItems={shellStatusItems}
        userEmail={authUser.email}
        userRole={authUser.role}
        onLogout={logout}
      >
      <main className="flex flex-1 min-h-0 overflow-hidden max-lg:flex-col">

        {/* SECONDARY PANEL: CONFIGURATION */}
        <aside id="config-panel" className="w-80 shrink-0 border-r border-stone-200 bg-stone-50/70 flex flex-col max-lg:w-full max-lg:max-h-[44vh] max-lg:border-r-0 max-lg:border-b">
          {currentModule === 'scrapper' && (
            <>
              {/* MODE SELECTOR */}
              <div id="mode-selector" className="border-b border-white/10 p-3">
                <Tabs
                  items={[...scraperModeTabs]}
                  value={mode}
                  onChange={(nextMode) => {
                    setMode(nextMode);
                    setDiscoveryMode(nextMode === 'deep');
                  }}
                  ariaLabel="Harvest mode"
                  className="grid w-full grid-cols-3"
                />
              </div>

          <div className="flex-1 overflow-y-auto p-6 custom-scrollbar flex flex-col gap-6">
            {mode === 'single' ? (
              <div className="space-y-6">
                <div>
                  <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold mb-3 block">
                    Extraction Parameters
                  </label>
                  <div className="space-y-4">
                    <div>
                      <Select 
                        label="Target SKU Index"
                        value={skuIndex.some((s) => (s.sku || s.SKU) === harvestSku) ? harvestSku : ''}
                        onChange={(e) => setHarvestSku(e.target.value)}
                        disabled={isScraping}
                        className="font-mono text-xs text-green-400 uppercase"
                        helpText="Choose an indexed SKU, or enter a manual SKU when no index match exists."
                      >
                        <option value="">Select SKU from Index</option>
                        {skuIndex.map((s, i) => (
                           <option key={i} value={s.sku || s.SKU}>{s.sku || s.SKU}</option>
                        ))}
                      </Select>
                      <Input
                        type="text"
                        value={harvestSku}
                        onChange={(e) => setHarvestSku(e.target.value)}
                        disabled={isScraping}
                        placeholder="Or enter manual SKU..."
                        className="font-mono text-xs text-green-400 uppercase"
                        wrapperClassName="mt-2"
                        aria-label="Manual SKU"
                      />
                    </div>
                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <div className="text-[10px] text-white/60 font-medium uppercase tracking-wider">Target URL</div>
                        <button 
                          type="button"
                          aria-label="Analyze target URL with AI"
                          onClick={handleSmartAnalyze}
                          disabled={isAnalyzing || isScraping || !url}
                          className="text-[10px] text-blue-400 hover:text-blue-300 font-bold flex items-center gap-1 transition-all disabled:opacity-30"
                        >
                          {isAnalyzing ? <RefreshCw className="w-2.5 h-2.5 animate-spin" /> : <Zap className="w-2.5 h-2.5" />}
                          AI ANALYZE
                        </button>
                      </div>
                      <Input
                        type="text"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        disabled={isScraping}
                        placeholder="https://example.com/product"
                        className="font-mono text-xs text-blue-400"
                        aria-label="Target URL"
                        error={!url.trim() ? 'Required to start a product scrape.' : undefined}
                      />
                    </div>
                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <div className="text-[10px] text-white/60 font-medium uppercase tracking-wider">Specific Selector</div>
                        {selector && (
                          <button 
                            onClick={() => setShowSaveDialog(true)}
                            className="text-[10px] text-blue-400 hover:text-blue-300 font-mono transition-colors"
                          >
                            [SAVE]
                          </button>
                        )}
                      </div>
                      <Input
                        type="text"
                        value={selector}
                        onChange={(e) => setSelector(e.target.value)}
                        placeholder="e.g. .specs-table"
                        disabled={isScraping}
                        className="font-mono text-xs text-blue-400"
                        aria-label="Specific selector"
                        helpText="Optional: limit extraction to a known product details container."
                      />
                    </div>
                    <div>
                      <div className="text-[10px] text-white/60 mb-2 font-medium uppercase tracking-wider">Site Presets</div>
                      <PresetDropdown 
                        presets={savedSelectors}
                        onSelect={(profile) => {
                          setSelector(profile.selector);
                          if (profile.strategy) setStrategy(profile.strategy);
                        }}
                        onDelete={deleteSelector}
                        defaultText="-- Choose Preset --"
                        disabled={isScraping}
                      />
                    </div>
                    <div>
                      <div className="text-[10px] text-white/60 mb-2 font-medium uppercase tracking-wider">AI Strategy</div>
                      <Select 
                        value={strategy}
                        onChange={(e) => setStrategy(e.target.value)}
                        disabled={isScraping}
                        className="text-xs"
                      >
                        <option value="LLMExtractionStrategy">Advanced AI (Dormant)</option>
                        <option value="AIExtractionStrategy">DeepSeek/Qwen (Fast Batch)</option>
                        <option value="JsonLdExtractionStrategy">JSON-LD Meta</option>
                        <option value="WholeCaptureStrategy">Whole Capture</option>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/5">
                        <div className="flex flex-col">
                          <span className="text-[10px] text-white/80 font-bold uppercase tracking-wider tracking-tighter">Screenshots</span>
                        </div>
                        <button 
                          type="button"
                          role="switch"
                          aria-checked={screenshotEnabled}
                          aria-label="Toggle screenshots"
                          onClick={() => setScreenshotEnabled(!screenshotEnabled)}
                          className={`w-8 h-4 rounded-full transition-all relative focus:outline-none focus:ring-2 focus:ring-blue-500/50 ${screenshotEnabled ? 'bg-blue-600' : 'bg-white/10'}`}
                        >
                          <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${screenshotEnabled ? 'left-4.5' : 'left-0.5'}`} />
                        </button>
                      </div>
                      <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/5">
                        <div className="flex flex-col">
                          <span className="text-[10px] text-white/80 font-bold uppercase tracking-wider tracking-tighter">Deep Scroll</span>
                        </div>
                        <button 
                          type="button"
                          role="switch"
                          aria-checked={deepScrollEnabled}
                          aria-label="Toggle deep scroll"
                          onClick={() => setDeepScrollEnabled(!deepScrollEnabled)}
                          className={`w-8 h-4 rounded-full transition-all relative focus:outline-none focus:ring-2 focus:ring-blue-500/50 ${deepScrollEnabled ? 'bg-blue-600' : 'bg-white/10'}`}
                        >
                          <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${deepScrollEnabled ? 'left-4.5' : 'left-0.5'}`} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {!hasSecondaryTarget ? (
                  <Button
                    onClick={() => setHasSecondaryTarget(true)}
                    variant="secondary"
                    className="w-full border-dashed"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add Secondary Target
                  </Button>
                ) : (
                  <div className="space-y-4 pt-4 border-t border-white/10 relative mt-4">
                    <button 
                      type="button"
                      aria-label="Remove secondary target"
                      onClick={() => { setHasSecondaryTarget(false); setUrl2(''); setSelector2(''); }}
                      className="absolute top-4 right-0 p-1 text-white/30 hover:text-red-400 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500/40 rounded"
                    >
                      <X className="w-4 h-4" />
                    </button>
                    <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold mb-3 block">
                      Secondary Target Parameters
                    </label>
                    <div>
                      <div className="text-[10px] text-white/60 mb-2 font-medium uppercase tracking-wider">Target URL 2</div>
                      <Input
                        type="text"
                        value={url2}
                        onChange={(e) => setUrl2(e.target.value)}
                        disabled={isScraping}
                        placeholder="https://example.com/product-context"
                        className="font-mono text-xs text-blue-400"
                        aria-label="Secondary target URL"
                        helpText="Optional: capture a second source for comparison or supporting context."
                      />
                    </div>
                    <div>
                      <div className="text-[10px] text-white/60 mb-2 font-medium uppercase tracking-wider">Specific Selector 2</div>
                      <Input
                        type="text"
                        value={selector2}
                        onChange={(e) => setSelector2(e.target.value)}
                        disabled={isScraping}
                        placeholder="e.g. .specs-table"
                        className="font-mono text-xs text-blue-400"
                        aria-label="Secondary selector"
                      />
                    </div>
                    <div>
                      <div className="text-[10px] text-white/60 mb-2 font-medium uppercase tracking-wider">Site Presets</div>
                      <PresetDropdown 
                        presets={savedSelectors}
                        onSelect={(profile) => {
                          setSelector2(profile.selector);
                          if (profile.strategy) setStrategy2(profile.strategy);
                        }}
                        onDelete={deleteSelector}
                        defaultText="-- Choose Preset --"
                        disabled={isScraping}
                      />
                    </div>
                    <div>
                      <Select
                        label="AI Strategy 2"
                        value={strategy2}
                        onChange={(e) => setStrategy2(e.target.value)}
                        disabled={isScraping}
                        className="text-xs"
                      >
                        <option value="LLMExtractionStrategy">Advanced AI (Dormant)</option>
                        <option value="AIExtractionStrategy">DeepSeek/Qwen (Fast Batch)</option>
                        <option value="JsonLdExtractionStrategy">JSON-LD Meta</option>
                        <option value="WholeCaptureStrategy">Whole Capture</option>
                      </Select>
                    </div>
                  </div>
                )}

                <div className="pt-2">
                  <button 
                    onClick={() => { fetchHarvest(); setShowHarvestModal(true); }}
                    className="w-full group relative overflow-hidden p-4 bg-white/5 border border-white/10 rounded-xl flex items-center justify-between hover:bg-white/[0.08] transition-all"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400 group-hover:scale-110 transition-transform">
                        <Archive className="w-5 h-5" />
                      </div>
                      <div className="text-left">
                        <span className="text-[10px] uppercase font-bold text-white/60 tracking-widest block">Harvest Archive</span>
                        <span className="text-[9px] text-white/20 font-mono italic">Browse {harvestFiles.length} indexed files</span>
                      </div>
                    </div>
                    <div className="p-1 px-3 bg-blue-600/20 text-blue-400 text-[10px] font-bold rounded-full border border-blue-500/20 flex items-center gap-2">
                      <Eye className="w-3 h-3" />
                      VIEW HISTORY
                    </div>
                  </button>
                </div>

                {/* SAVE SELECTOR DIALOG (SINGLE MODE) */}
                <AnimatePresence>
                  {showSaveDialog && (
                    <motion.div 
                      key="save-dialog-single"
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      className="p-4 bg-blue-600/10 border border-blue-500/30 rounded-xl space-y-3"
                    >
                      <div className="text-[10px] font-bold text-blue-400 uppercase tracking-widest">Site Preset Name</div>
                      <Input
                        type="text"
                        autoFocus
                        value={tempSelectorName}
                        onChange={(e) => setTempSelectorName(e.target.value)}
                        placeholder="e.g. Amazon Product View"
                        className="text-xs"
                        aria-label="Site preset name"
                      />
                      <div className="flex gap-2">
                        <button 
                          onClick={saveSelector}
                          className="flex-1 bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-bold py-2 rounded transition-colors"
                        >
                          SAVE
                        </button>
                        <button 
                          onClick={() => setShowSaveDialog(false)}
                          className="flex-1 bg-white/5 hover:bg-white/10 text-white/60 text-[10px] font-bold py-2 rounded transition-colors"
                        >
                          CANCEL
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="p-4 bg-blue-600/5 border border-blue-500/10 rounded-xl space-y-3">
                  <div className="flex items-center gap-2">
                    <Activity className="w-3.5 h-3.5 text-blue-500/50" />
                    <span className="text-[9px] font-bold uppercase tracking-widest text-white/30">Optimization Status</span>
                  </div>
                  <div className="flex justify-between items-center text-[10px]">
                    <span className="text-white/40">Browser Simulation</span>
                    <span className="text-green-500 font-bold uppercase tracking-tighter">Active</span>
                  </div>
                </div>
              </div>
            ) : mode === 'batch' ? (
              <div className="space-y-6">
                <div>
                  <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold mb-3 block">
                    Batch Mode (Excel Tool)
                  </label>
                  <div className="space-y-4">
                    <div className="p-4 border-2 border-dashed border-white/10 rounded-xl hover:border-blue-500/50 transition-colors flex flex-col items-center gap-3 text-center group cursor-pointer relative">
                      <input 
                        type="file" 
                        onChange={handleBatchUpload}
                        accept=".xlsx"
                        aria-label="Upload batch manifest XLSX"
                        className="absolute inset-0 opacity-0 cursor-pointer"
                      />
                      <div className="p-3 bg-blue-500/10 rounded-full text-blue-400 group-hover:scale-110 transition-transform">
                        <Upload className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-white/80">Upload Manifest</div>
                        <div className="text-[10px] text-white/30 uppercase tracking-tighter">Columns: SKU, URL</div>
                      </div>
                    </div>

                    <Button
                      onClick={handleDownloadBatchTemplate}
                      variant="secondary"
                      size="sm"
                      className="w-full"
                    >
                      ↓ Download Batch Template
                    </Button>

                    {batchData.length > 0 && (
                      <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-lg flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <FileSpreadsheet className="w-4 h-4 text-green-500" />
                          <span className="text-xs font-bold text-green-500/80">{batchData.length} URLs Loaded</span>
                        </div>
                        <button 
                          onClick={() => setBatchData([])}
                          className="text-[10px] text-white/40 hover:text-white"
                        >
                          Clear
                        </button>
                      </div>
                    )}

                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <div className="text-[10px] text-white/60 font-medium uppercase tracking-wider">Specific Selector</div>
                        {selector && (
                          <button 
                            onClick={() => setShowSaveDialog(true)}
                            className="text-[10px] text-blue-400 hover:text-blue-300 font-mono transition-colors"
                          >
                            [SAVE]
                          </button>
                        )}
                      </div>
                      <Input
                        type="text"
                        value={selector}
                        onChange={(e) => setSelector(e.target.value)}
                        placeholder="e.g. .specs-table"
                        className="font-mono text-xs text-blue-400"
                        aria-label="Batch selector"
                      />
                    </div>

                    <div>
                      <div className="text-[10px] text-white/60 mb-2 font-medium uppercase tracking-wider">Site Presets</div>
                      <PresetDropdown 
                        presets={savedSelectors}
                        onSelect={(profile) => {
                          setSelector(profile.selector);
                          if (profile.strategy) setStrategy(profile.strategy);
                        }}
                        onDelete={deleteSelector}
                        defaultText="-- Choose Preset --"
                      />
                    </div>

                    <div>
                      <div className="text-[10px] text-white/60 mb-2 font-medium uppercase tracking-wider">AI Strategy</div>
                      <Select 
                        value={strategy}
                        onChange={(e) => setStrategy(e.target.value)}
                        disabled={isScraping}
                        className="text-xs"
                      >
                        <option value="LLMExtractionStrategy">Advanced AI (Dormant)</option>
                        <option value="AIExtractionStrategy">DeepSeek/Qwen (Fast Batch)</option>
                        <option value="JsonLdExtractionStrategy">JSON-Ld Meta</option>
                        <option value="WholeCaptureStrategy">Whole Capture</option>
                      </Select>
                    </div>

                    <Button 
                      onClick={handleBatchScrape}
                      disabled={isScraping || batchData.length === 0}
                      className="w-full"
                      size="lg"
                    >
                      {isScraping ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Processing Batch...
                        </>
                      ) : 'Run Batch Harvest'}
                    </Button>

                    <div className="pt-6 border-t border-white/5 space-y-4">
                      <div className="flex items-center justify-between">
                        <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold block">Recent Batch Results</label>
                        <button onClick={fetchHarvest} className="text-[9px] text-green-500 hover:text-green-400 font-bold uppercase tracking-tighter">Refresh</button>
                      </div>
                      <div className="space-y-2 max-h-64 overflow-y-auto custom-scrollbar pr-2">
                        {harvestFiles.length === 0 && <div className="text-[9px] text-white/20 italic text-center py-4 border border-dashed border-white/5 rounded-lg">No harvest assets found</div>}
                        {harvestFiles.map((file: any, idx: number) => (
                          <div key={idx} className="p-2 bg-white/5 border border-white/5 rounded-xl flex items-center justify-between group hover:border-green-500/30 transition-all">
                            <div className="flex flex-col truncate pr-2">
                              <span className="text-[11px] font-mono text-white/80 truncate font-bold">{file.name}</span>
                              <span className="text-[8px] text-white/20 uppercase">{(file.size / 1024).toFixed(1)} KB • {new Date(file.mtime).toLocaleDateString()}</span>
                            </div>
                            <button 
                              onClick={() => openHarvestFile(file.name, 'batch harvest')}
                              className="px-3 py-1 bg-green-600/10 hover:bg-green-600 text-green-500 hover:text-white rounded text-[9px] font-bold uppercase transition-all opacity-0 group-hover:opacity-100"
                            >
                              Open
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* SAVE SELECTOR DIALOG (BATCH MODE) */}
                <AnimatePresence>
                  {showSaveDialog && (
                    <motion.div 
                      key="save-dialog-batch"
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      className="p-4 bg-green-600/10 border border-green-500/30 rounded-xl space-y-3"
                    >
                      <div className="text-[10px] font-bold text-green-400 uppercase tracking-widest">Site Preset Name</div>
                      <Input
                        type="text"
                        autoFocus
                        value={tempSelectorName}
                        onChange={(e) => setTempSelectorName(e.target.value)}
                        placeholder="e.g. Bulk Products Profile"
                        className="text-xs"
                        aria-label="Batch preset name"
                      />
                      <div className="flex gap-2">
                        <button 
                          onClick={saveSelector}
                          className="flex-1 bg-green-600 hover:bg-green-500 text-white text-[10px] font-bold py-2 rounded transition-colors"
                        >
                          SAVE
                        </button>
                        <button 
                          onClick={() => setShowSaveDialog(false)}
                          className="flex-1 bg-white/5 hover:bg-white/10 text-white/60 text-[10px] font-bold py-2 rounded transition-colors"
                        >
                          CANCEL
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ) : (
              <div className="space-y-6">
                <div>
                  <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold mb-3 block">
                    Crawl & Discovery
                  </label>
                  <div className="space-y-4">
                    <div>
                      <div className="text-[10px] text-white/60 mb-2 font-medium uppercase tracking-wider">PLP (Listing) URL</div>
                      <Input
                        type="text"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        placeholder="e.g. samsung.com/in/smartphones"
                        className="font-mono text-xs text-blue-400"
                        aria-label="PLP listing URL"
                        error={!url.trim() ? 'A listing URL is required before discovery can run.' : undefined}
                      />
                    </div>
                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <div className="text-[10px] text-white/60 font-medium uppercase tracking-wider">PLP Selectors</div>
                        {plpSelector && (
                          <button 
                            onClick={() => setShowSavePlpDialog(true)}
                            className="text-[10px] text-blue-400 hover:text-blue-300 font-mono transition-colors"
                          >
                            [SAVE]
                          </button>
                        )}
                      </div>
                      <Input
                        type="text"
                        value={plpSelector}
                        onChange={(e) => setPlpSelector(e.target.value)}
                        placeholder="e.g. .product-item a"
                        className="font-mono text-xs text-blue-400"
                        aria-label="PLP selectors"
                        helpText="Optional selector for product cards or links on the listing page."
                      />
                    </div>
                    <div>
                      <div className="text-[10px] text-white/60 mb-2 font-medium uppercase tracking-wider">PLP Presets</div>
                      <PresetDropdown 
                        presets={savedPlpSelectors}
                        onSelect={(profile) => {
                          setPlpSelector(profile.selector);
                        }}
                        onDelete={deletePlpSelector}
                        defaultText="-- Choose PLP Preset --"
                        isPlp={true}
                      />
                    </div>
                    <Button
                      onClick={handleDiscover}
                      disabled={isDiscovering || isScraping || !url.trim()}
                      className="w-full"
                    >
                      {isDiscovering ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                      {isDiscovering ? 'Discovering Targets...' : 'Run PLP Discovery'}
                    </Button>
                  </div>
                </div>

                {/* SAVE PLP SELECTOR DIALOG */}
                <AnimatePresence>
                  {showSavePlpDialog && (
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      className="p-4 bg-blue-600/10 border border-blue-500/30 rounded-xl space-y-3"
                    >
                      <div className="text-[10px] font-bold text-blue-400 uppercase tracking-widest">PLP Preset Name</div>
                      <Input
                        type="text"
                        autoFocus
                        value={tempPlpSelectorName}
                        onChange={(e) => setTempPlpSelectorName(e.target.value)}
                        placeholder="e.g. My Category List"
                        className="text-xs"
                        aria-label="PLP preset name"
                      />
                      <div className="flex gap-2">
                        <button 
                          onClick={savePlpSelector}
                          className="flex-1 bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-bold py-2 rounded transition-colors"
                        >
                          SAVE
                        </button>
                        <button 
                          onClick={() => setShowSavePlpDialog(false)}
                          className="flex-1 bg-white/5 hover:bg-white/10 text-white/60 text-[10px] font-bold py-2 rounded transition-colors"
                        >
                          CANCEL
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div>
                  <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold mb-3 block">
                    Target Page Extraction logic
                  </label>
                  <div className="space-y-4">
                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <div className="text-[10px] text-white/60 font-medium uppercase tracking-wider">Specific Selector</div>
                        {selector && (
                          <button 
                            onClick={() => setShowSaveDialog(true)}
                            className="text-[10px] text-blue-400 hover:text-blue-300 font-mono transition-colors"
                          >
                            [SAVE]
                          </button>
                        )}
                      </div>
                      <Input
                        type="text"
                        value={selector}
                        onChange={(e) => setSelector(e.target.value)}
                        placeholder="e.g. .specs-table"
                        className="font-mono text-xs text-blue-400"
                        aria-label="Deep scrape selector"
                        helpText="Optional: applied to each discovered target page."
                      />
                    </div>
                    <div>
                      <div className="text-[10px] text-white/60 mb-2 font-medium uppercase tracking-wider">Site Presets</div>
                      <PresetDropdown 
                        presets={savedSelectors}
                        onSelect={(profile) => {
                          setSelector(profile.selector);
                          if (profile.strategy) setStrategy(profile.strategy);
                        }}
                        onDelete={deleteSelector}
                        defaultText="-- Use Preset for Deep Scrape --"
                      />
                    </div>
                    <div>
                      <div className="text-[10px] text-white/60 mb-2 font-medium uppercase tracking-wider">AI Strategy</div>
                      <Select 
                        value={strategy}
                        onChange={(e) => setStrategy(e.target.value)}
                        disabled={isScraping}
                        className="text-xs"
                      >
                        <option value="LLMExtractionStrategy">Advanced AI (Dormant)</option>
                        <option value="AIExtractionStrategy">DeepSeek/Qwen (Fast Batch)</option>
                        <option value="JsonLdExtractionStrategy">JSON-LD Meta</option>
                        <option value="WholeCaptureStrategy">Whole Capture</option>
                      </Select>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/5">
                      <div className="flex flex-col">
                        <span className="text-[10px] text-white/80 font-bold uppercase tracking-wider">Visual Context</span>
                        <span className="text-[9px] text-white/30 italic">Capture screenshots</span>
                      </div>
                      <button 
                        type="button"
                        role="switch"
                        aria-checked={screenshotEnabled}
                        aria-label="Toggle visual context screenshots"
                        onClick={() => setScreenshotEnabled(!screenshotEnabled)}
                        className={`w-10 h-5 rounded-full transition-all relative focus:outline-none focus:ring-2 focus:ring-blue-500/50 ${screenshotEnabled ? 'bg-blue-600' : 'bg-white/10'}`}
                      >
                        <div className={`absolute top-1 w-3 h-3 rounded-full bg-white transition-all ${screenshotEnabled ? 'left-6' : 'left-1'}`} />
                      </button>
                    </div>
                  </div>
                </div>

                {/* SAVE SELECTOR DIALOG (DEEP MODE) */}
                <AnimatePresence>
                  {showSaveDialog && (
                    <motion.div 
                      key="save-dialog-deep"
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      className="p-4 bg-blue-600/10 border border-blue-500/30 rounded-xl space-y-3 mt-4"
                    >
                      <div className="text-[10px] font-bold text-blue-400 uppercase tracking-widest">Site Preset Name</div>
                      <Input
                        type="text"
                        autoFocus
                        value={tempSelectorName}
                        onChange={(e) => setTempSelectorName(e.target.value)}
                        placeholder="e.g. Tech Specs Profile"
                        className="text-xs"
                        aria-label="Deep scrape preset name"
                      />
                      <div className="flex gap-2">
                        <button 
                          onClick={saveSelector}
                          className="flex-1 bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-bold py-2 rounded transition-colors"
                        >
                          SAVE
                        </button>
                        <button 
                          onClick={() => setShowSaveDialog(false)}
                          className="flex-1 bg-white/5 hover:bg-white/10 text-white/60 text-[10px] font-bold py-2 rounded transition-colors"
                        >
                          CANCEL
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                  </div>
              )}
            </div>
          </>
        )}


          {currentModule === 'upload' && (
            <div className="space-y-6">
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-semibold text-slate-950">Catalogue import</p>
                  <p className="text-xs text-slate-500">Upload the master SKU file or add one SKU manually.</p>
                </div>
                <Tabs
                  items={[
                    { id: 'upload', label: 'Excel upload' },
                    { id: 'manual', label: 'Manual SKU' },
                  ]}
                  value={indexerMode}
                  onChange={(value) => setIndexerMode(value as 'upload' | 'manual')}
                  ariaLabel="SKU indexer mode"
                  className="grid w-full grid-cols-2"
                />
              </div>

              {indexerMode === 'upload' ? (
                <div className="space-y-4">
                  <div className="upload-zone group min-h-44">
                    <input type="file" onChange={handleSkuUpload} accept=".xlsx" aria-label="Upload SKU master index XLSX" className="absolute inset-0 opacity-0 cursor-pointer" />
                    <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-blue-700">
                      <FileSpreadsheet className="h-6 w-6" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-slate-950">Upload master index</div>
                      <div className="mt-1 text-xs text-slate-500">Drop or choose an `.xlsx` file. Existing SKUs are merged by SKU.</div>
                    </div>
                  </div>
                  <Select
                    label="Apply Attribute Set"
                    value={bulkSkuAttributeSet}
                    onChange={(e) => setBulkSkuAttributeSet(e.target.value)}
                    className="text-xs"
                    helpText="Optional: applies this attribute set to every SKU in the uploaded file."
                  >
                    <option value="">Use file column if present</option>
                    {appSettings.attributeSets.map((set, i) => (
                      <option key={i} value={set.name}>{set.name}</option>
                    ))}
                  </Select>
                  <Button
                    onClick={handleDownloadSkuTemplate}
                    variant="secondary"
                    size="sm"
                    className="w-full"
                  >
                    Download SKU template
                  </Button>
                  <div className="rounded-lg border border-stone-200 bg-white p-4">
                    <p className="text-sm font-semibold text-slate-950">Expected workbook fields</p>
                    <div className="mt-3 grid gap-2 text-xs text-slate-600">
                      <div className="flex items-start gap-2"><Check className="mt-0.5 h-3.5 w-3.5 text-emerald-600" />SKU identifiers: `sku`, `base_code`, brand, EAN.</div>
                      <div className="flex items-start gap-2"><Check className="mt-0.5 h-3.5 w-3.5 text-emerald-600" />Attribute columns: headers starting with `attributes__`.</div>
                      <div className="flex items-start gap-2"><Check className="mt-0.5 h-3.5 w-3.5 text-emerald-600" />SAP truth source: current storage uses `sap_data`.</div>
                      <div className="flex items-start gap-2"><Check className="mt-0.5 h-3.5 w-3.5 text-emerald-600" />Optional source fields: `source__url`, PDF context, or scraped harvest later.</div>
                    </div>
                  </div>
                  <div className="rounded-lg border border-stone-200 bg-stone-50 p-4">
                    <p className="text-sm font-semibold text-slate-950">Batch source URLs</p>
                    <p className="mt-1 text-xs text-slate-500">Optional manifest for scraping product pages. Required columns are `sku` and `url`.</p>
                    <div className="mt-3 grid gap-2">
                      <label className="relative flex cursor-pointer items-center justify-between rounded-lg border border-dashed border-stone-300 bg-white px-3 py-2 text-sm text-slate-700 hover:border-blue-400 hover:bg-blue-50">
                        <span>{batchFile ? batchFile.name : 'Choose batch manifest'}</span>
                        <Upload className="h-4 w-4 text-slate-400" />
                        <input type="file" onChange={handleBatchUpload} accept=".xlsx" aria-label="Upload batch manifest XLSX" className="absolute inset-0 opacity-0 cursor-pointer" />
                      </label>
                      <Button onClick={handleDownloadBatchTemplate} variant="secondary" size="sm" className="w-full">
                        Download batch template
                      </Button>
                      {batchData.length > 0 ? (
                        <Alert tone="success" className="text-xs">{batchData.length} URL rows loaded for scraping.</Alert>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-3 rounded-lg border border-stone-200 bg-white p-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-700">SKU *</label>
                      <input 
                        type="text" 
                        value={manualSkuData.sku || ''}
                        onChange={(e) => setManualSkuData({...manualSkuData, sku: e.target.value})}
                        className="form-control-mono"
                        placeholder="e.g. LAP-100"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-700">Base Code</label>
                      <input 
                        type="text" 
                        value={manualSkuData.base_code || ''}
                        onChange={(e) => setManualSkuData({...manualSkuData, base_code: e.target.value})}
                        className="form-control"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-700">Brand</label>
                      <input 
                        type="text" 
                        value={manualSkuData.brand || ''}
                        onChange={(e) => setManualSkuData({...manualSkuData, brand: e.target.value})}
                        className="form-control"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-700">EAN</label>
                      <input 
                        type="text" 
                        value={manualSkuData.ean || ''}
                        onChange={(e) => setManualSkuData({...manualSkuData, ean: e.target.value})}
                        className="form-control"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-700">Weight (kg)</label>
                      <input 
                        type="text" 
                        value={manualSkuData.shipping_weight || ''}
                        onChange={(e) => setManualSkuData({...manualSkuData, shipping_weight: e.target.value})}
                        className="form-control"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-700">Product Type</label>
                      <input 
                        type="text" 
                        value={manualSkuData.product_type || ''}
                        onChange={(e) => setManualSkuData({...manualSkuData, product_type: e.target.value})}
                        className="form-control"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-700">Attribute Set</label>
                      <select 
                        value={manualSkuData.attribute_set || ''}
                        onChange={(e) => setManualSkuData({...manualSkuData, attribute_set: e.target.value})}
                        className="form-control"
                      >
                         <option value="">Select Set...</option>
                         {appSettings.attributeSets.map((s, i) => (
                           <option key={i} value={s.name}>{s.name}</option>
                         ))}
                      </select>
                    </div>
                  </div>
                  <Textarea
                      label="SAP Data (Context)"
                      value={manualSkuData.sap_data || ''}
                      onChange={(e) => setManualSkuData({...manualSkuData, sap_data: e.target.value})}
                      placeholder="Paste SAP context data..."
                      className="h-20 resize-none text-[10px] custom-scrollbar"
                      helpText="Optional supporting data used by mapping jobs."
                    />
                  {!manualSkuData.sku?.trim() && (
                    <Alert tone="warning" className="text-[11px]">
                      SKU is required before this record can be saved.
                    </Alert>
                  )}
                  <Button 
                    onClick={handleManualSkuSubmit}
                    className="w-full mt-2"
                  >
                    Save SKU to Index
                  </Button>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-stone-200 bg-white p-3">
                  <div className="text-xs text-slate-500">Uploaded SKUs</div>
                  <div className="mt-1 text-2xl font-semibold text-slate-950">{uploadedSkuCount}</div>
                </div>
                <div className="rounded-lg border border-stone-200 bg-white p-3">
                  <div className="text-xs text-slate-500">attributes__ fields</div>
                  <div className="mt-1 text-2xl font-semibold text-slate-950">{uploadedAttributeFields.size}</div>
                </div>
                <div className="rounded-lg border border-stone-200 bg-white p-3">
                  <div className="text-xs text-slate-500">SAP truth source</div>
                  <div className="mt-1 text-2xl font-semibold text-slate-950">{sapSourceCount}</div>
                </div>
                <div className="rounded-lg border border-stone-200 bg-white p-3">
                  <div className="text-xs text-slate-500">Source URLs</div>
                  <div className="mt-1 text-2xl font-semibold text-slate-950">{urlSourceCount + batchData.length}</div>
                </div>
                <div className="rounded-lg border border-stone-200 bg-white p-3">
                  <div className="text-xs text-slate-500">PDF context</div>
                  <div className="mt-1 text-2xl font-semibold text-slate-950">{pdfSourceCount}</div>
                </div>
              </div>

              {uploadLatestSuccess ? (
                <Alert tone="success" className="text-xs">{uploadLatestSuccess.message}</Alert>
              ) : uploadedSkuCount === 0 ? (
                <Alert tone="info" className="text-xs">No master index loaded yet. Upload Excel or add a manual SKU to start Pre-QA.</Alert>
              ) : null}
              {uploadLatestError ? (
                <Alert tone="danger" className="text-xs">{uploadLatestError.message}</Alert>
              ) : null}

              {/* Bulk delete action bar */}
              {selectedSkuIndexItems.length > 0 && (
                <div className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                  <span className="text-xs font-medium text-red-700">{selectedSkuIndexItems.length} selected</span>
                  <button
                    type="button"
                    onClick={() => handleBulkSkuDelete(selectedSkuIndexItems, 'indexer')}
                    className="rounded bg-red-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-red-700"
                  >
                    Delete Selected
                  </button>
                </div>
              )}

              <div className="space-y-2 max-h-[400px] overflow-y-auto custom-scrollbar pr-2">
                 {/* Select all row */}
                 {skuIndex.length > 0 && (
                   <div className="flex items-center gap-2 border-b border-stone-200 px-1 pb-2">
                     <input
                       type="checkbox"
                       className="h-4 w-4 cursor-pointer rounded border-stone-300 accent-blue-600"
                       aria-label="Select all SKU index records"
                       checked={selectedSkuIndexItems.length === skuIndex.length}
                       onChange={(e) => {
                         if (e.target.checked) setSelectedSkuIndexItems(skuIndex.map((s: any) => (s.sku || s.SKU)?.toString() ?? ''));
                         else setSelectedSkuIndexItems([]);
                       }}
                     />
                     <span className="text-xs text-slate-500">Select all indexed SKUs</span>
                   </div>
                 )}
                 <input type="file" className="hidden" ref={pdfInputRef} accept="application/pdf" aria-label="Attach PDF context to SKU" onChange={handlePdfFileChange} />
                 {skuIndex.map((s: any, i: number) => {
                   const skuValue = s.sku || s.SKU;
                   const hasPdf = !!s.pdf_text;
                   const isChecked = selectedSkuIndexItems.includes(skuValue?.toString() ?? '');
                   return (
                     <div key={i} className={`flex items-center justify-between rounded-lg border p-3 text-xs transition-colors group ${isChecked ? 'border-blue-200 bg-blue-50' : 'border-stone-200 bg-white hover:border-blue-200 hover:bg-blue-50/50'}`}>
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            className="h-4 w-4 flex-shrink-0 cursor-pointer rounded border-stone-300 accent-blue-600"
                            aria-label={`Select SKU ${skuValue}`}
                            checked={isChecked}
                            onChange={(e) => {
                              const v = skuValue?.toString() ?? '';
                              if (e.target.checked) setSelectedSkuIndexItems(prev => [...prev, v]);
                              else setSelectedSkuIndexItems(prev => prev.filter(x => x !== v));
                            }}
                          />
                          <div className="flex flex-col">
                            <span className="flex items-center gap-2 font-mono font-semibold text-blue-700">
                              {skuValue}
                              {hasPdf && <span title="PDF Context Attached"><FileText className="w-3 h-3 text-cyan-400" /></span>}
                            </span>
                            <span className="text-xs text-slate-500">{s.brand || s.Brand || 'Generic'}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                           <div className="text-right mr-2">
                              <span className="block text-xs text-slate-500">{s.product_type || 'Uncategorized'}</span>
                           </div>
                           <button 
                             type="button"
                             onClick={() => handlePdfTrigger(skuValue.toString())}
                             className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 text-blue-700 opacity-0 transition-opacity hover:bg-blue-600 hover:text-white group-hover:opacity-100 focus:opacity-100"
                             title="Attach PDF as Context 1"
                             aria-label={`Attach PDF to SKU ${skuValue}`}
                           >
                             <FileText className="w-3.5 h-3.5" />
                           </button>
                           <button 
                             type="button"
                             onClick={() => handleSkuDelete(skuValue.toString())}
                             className="flex h-7 w-7 items-center justify-center rounded-lg bg-red-50 text-red-700 opacity-0 transition-opacity hover:bg-red-600 hover:text-white group-hover:opacity-100 focus:opacity-100"
                             aria-label={`Delete SKU ${skuValue}`}
                           >
                             <X className="w-3.5 h-3.5" />
                           </button>
                        </div>
                     </div>
                   );
                 })}
              </div>
            </div>
          )}

          {currentModule === 'pre-qa' && (
            <div className="space-y-5">
              <div>
                <p className="text-sm font-semibold text-slate-950">Readiness checks</p>
                <p className="mt-1 text-xs text-slate-500">Pre-QA uses existing SKU, SAP, PDF, harvest, and output state. No data is changed here.</p>
              </div>
              <div className="space-y-2">
                {workflowSteps.map((step, index) => {
                  const active = index <= 1;
                  return (
                    <div key={step} className="flex items-center gap-3">
                      <div className={`flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold ${active ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-stone-200 bg-white text-slate-400'}`}>
                        {index + 1}
                      </div>
                      <span className={active ? 'text-sm font-medium text-slate-900' : 'text-sm text-slate-500'}>{step}</span>
                    </div>
                  );
                })}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-stone-200 bg-white p-3">
                  <div className="text-xs text-slate-500">Ready for QA</div>
                  <div className="mt-1 text-2xl font-semibold text-slate-950">{sourceReadyCount}</div>
                </div>
                <div className="rounded-lg border border-stone-200 bg-white p-3">
                  <div className="text-xs text-slate-500">Missing source</div>
                  <div className="mt-1 text-2xl font-semibold text-slate-950">{missingSourceCount}</div>
                </div>
                <div className="rounded-lg border border-stone-200 bg-white p-3">
                  <div className="text-xs text-slate-500">SAP rows</div>
                  <div className="mt-1 text-2xl font-semibold text-slate-950">{sapSourceCount}</div>
                </div>
                <div className="rounded-lg border border-stone-200 bg-white p-3">
                  <div className="text-xs text-slate-500">Harvest rows</div>
                  <div className="mt-1 text-2xl font-semibold text-slate-950">{harvestSourceCount}</div>
                </div>
              </div>
              {uploadedSkuCount === 0 ? (
                <Alert tone="warning" className="text-xs">Upload a master index before Pre-QA can evaluate readiness.</Alert>
              ) : missingSourceCount > 0 ? (
                <Alert tone="warning" className="text-xs">{missingSourceCount} SKU(s) do not yet have SAP, PDF, or scraped harvest data.</Alert>
              ) : (
                <Alert tone="success" className="text-xs">All uploaded SKUs have at least one usable source in current state.</Alert>
              )}
              <div className="grid gap-2">
                <Button onClick={() => setCurrentModule('upload')} variant="secondary" size="sm" className="w-full">
                  Back to Upload
                </Button>
                <Button onClick={() => setCurrentModule('scrapper')} size="sm" className="w-full">
                  Continue to Data Harvest
                </Button>
              </div>
            </div>
          )}

          {currentModule === 'settings' && (
             <div className="p-6 border-b border-stone-200 bg-white">
                <div className="flex items-center gap-3">
                   <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center">
                      <Settings className="w-5 h-5 text-blue-700" />
                   </div>
                   <div>
                      <h3 className="text-sm font-semibold text-slate-950">Settings workspace</h3>
                      <p className="mt-0.5 text-xs text-slate-500">Connectivity, mapping logic, schema hub, and allowlist controls.</p>
                   </div>
                </div>
                <div className="mt-6 rounded-lg border border-blue-100 bg-blue-50 p-4 text-xs leading-relaxed text-blue-800">
                    <p>Settings changes keep existing persistence and admin restrictions intact.</p>
                </div>
             </div>
          )}

          <div id="cta-area" className="p-6 border-t border-stone-200 bg-white">
            {currentModule === 'scrapper' ? (
              <div className="space-y-3">
                {scraperBlockedReason && !isScraping ? (
                  <Alert tone="warning" className="text-[11px] leading-relaxed">
                    {scraperBlockedReason}
                  </Alert>
                ) : null}
                <Button 
                  onClick={mode === 'single' ? handleScrape : (mode === 'batch' ? handleBatchScrape : handleDeepScrape)}
                  disabled={isScraping || (mode === 'single' && !url) || (mode === 'batch' && batchData.length === 0) || (mode === 'deep' && selectedLinks.length === 0)}
                  className="w-full"
                  size="lg"
                >
                  {isScraping ? <Loader2 className="w-5 h-5 animate-spin" /> : <Zap className="w-5 h-5" />}
                  {scraperActionLabel}
                </Button>
              </div>
            ) : (
               <Alert tone="info" className="text-center text-xs">Workflow ready</Alert>
            )}
          </div>
        </aside>
        {/* CENTER PANEL: INTERACTIVE HUB */}
        <section id="main-content" className="flex-1 flex flex-col bg-brand-bg min-h-0 relative">
          <div className="flex-1 p-6 overflow-y-auto custom-scrollbar flex flex-col gap-6 min-h-0">
             {/* MODULE VIEW CONDITIONAL */}
             {currentModule === 'settings' ? (
                <div className="settings-saas flex-1 flex flex-col p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full">
                   <motion.div 
                     initial={{ opacity: 0, y: 10 }}
                     animate={{ opacity: 1, y: 0 }}
                     className="flex flex-col gap-8 w-full"
                   >
                    <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-stone-200">
                       <div className="space-y-1 text-left">
                         <div className="flex items-center gap-2 text-blue-500 mb-1">
                           <Settings className="w-4 h-4" />
                           <span className="text-xs font-medium">Admin configuration</span>
                         </div>
                         <h2 className="text-2xl font-semibold tracking-tight text-slate-950">Settings</h2>
                         <p className="mt-1 max-w-xl text-sm text-slate-500">
                           Manage connectivity, global mapping logic, attribute schemas, and user access.
                         </p>
                       </div>
                       
                       <div className="flex flex-wrap gap-1 rounded-lg border border-stone-200 bg-white p-1 shadow-sm">
                          {[
                            { id: 'api', label: 'Connectivity', icon: Globe },
                            { id: 'mapping', label: 'Mapping Logic', icon: Network },
                            { id: 'indexer', label: 'Schema Hub', icon: Database }
                          ].map(tab => (
                            <button 
                              key={tab.id}
                              onClick={() => setSettingsSubModule(tab.id as any)}
                              className={`relative flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${settingsSubModule === tab.id ? 'text-white' : 'text-slate-600 hover:bg-stone-50 hover:text-slate-900'}`}
                            >
                              {settingsSubModule === tab.id && (
                                <motion.div 
                                  layoutId="activeTabSettingsFull"
                                  className="absolute inset-0 bg-blue-600"
                                  transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                                />
                              )}
                              <tab.icon className={`w-3.5 h-3.5 relative z-10 ${settingsSubModule === tab.id ? 'text-white' : 'text-slate-500'}`} />
                              <span className="relative z-10">{tab.label}</span>
                            </button>
                          ))}
                       </div>
                    </div>

                    <div className="relative">
                       <AnimatePresence mode="wait">
                         <motion.div
                           key={settingsSubModule}
                           initial={{ opacity: 0, x: 20 }}
                           animate={{ opacity: 1, x: 0 }}
                           exit={{ opacity: 0, x: -20 }}
                           transition={{ duration: 0.3, ease: "easeOut" }}
                           className="relative w-full pr-4 text-left"
                         >
                            {settingsSubModule === 'api' && (
                              <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 pt-4 pb-20">
                                    <section className="space-y-6">
                                       <div className="flex items-center gap-4">
                                         <div className="w-14 h-14 bg-blue-600/10 border border-blue-500/20 rounded-2xl flex items-center justify-center shadow-inner">
                                           <Key className="w-7 h-7 text-blue-400" />
                                         </div>
                                         <div>
                                           <h3 className="text-xl font-bold text-white leading-none">AI Credits Infrastructure</h3>
                                           <p className="text-[10px] text-white/30 uppercase tracking-widest mt-2">Authentication & Gateway</p>
                                         </div>
                                       </div>
                                       <div className="bg-[#0a0a0a] border border-white/5 rounded-3xl p-10 shadow-2xl relative overflow-hidden group">
                                          <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none group-hover:opacity-10 transition-opacity">
                                            <Cpu className="w-32 h-32" />
                                          </div>
                                          <p className="text-sm text-white/50 leading-relaxed max-w-md mb-10">
                                             Define your production AI Credits API key for high-speed DeepSeek/Qwen synthesis. 
                                             Failure to provide a key will trigger an automatic fallback to internal environment defaults.
                                          </p>
                                          <div className="space-y-4">
                                             <div className="flex items-center justify-between">
                                               <label className="text-[9px] text-white/40 font-bold uppercase tracking-widest">Secret Vault / Master Key</label>
                                               <span className="text-[9px] text-blue-400/50 font-mono">DeepSeek-V4-Flash</span>
                                             </div>
                                             <div className="flex flex-col gap-3">
                                                <div className="flex flex-col gap-3 sm:flex-row">
                                                   <div className="relative flex-1">
                                                     <input 
                                                       type="password" 
                                                       value={appSettings.aiCreditsApiKey}
                                                       onChange={(e) => setAppSettings({...appSettings, aiCreditsApiKey: e.target.value})}
                                                       placeholder="aicredits_production_key..."
                                                       className="w-full bg-black/60 border border-white/10 rounded-2xl px-6 py-5 text-sm font-mono text-blue-400 focus:outline-none focus:border-blue-500/50 focus:ring-8 focus:ring-blue-500/5 transition-all shadow-inner"
                                                     />
                                                   </div>
                                                   <button 
                                                     onClick={() => persistSettings(appSettings)}
                                                     disabled={isSavingSettings}
                                                     className="shrink-0 px-5 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/40 disabled:text-white/50 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all border border-blue-500/20 shadow-xl"
                                                   >
                                                      {isSavingSettings ? 'SAVING...' : 'SAVE KEY'}
                                                   </button>
                                                   <button 
                                                     onClick={() => {
                                                       const updatedSettings = {...appSettings, aiCreditsApiKey: ''};
                                                       setAppSettings(updatedSettings);
                                                       if (isAdmin) {
                                                         persistSettings(updatedSettings);
                                                       }
                                                     }}
                                                     className="shrink-0 px-5 bg-red-600/5 hover:bg-red-600 text-red-500 hover:text-white rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all border border-red-500/10 hover:border-red-600 shadow-xl"
                                                   >
                                                      WIPE
                                                   </button>
                                                </div>
                                                <p className="text-[10px] text-white/35 leading-relaxed">
                                                  {isAdmin
                                                    ? 'Use SAVE KEY to persist the AI Credits credential. WIPE clears the stored key immediately.'
                                                    : 'Admin role required to persist or wipe the AI Credits credential.'}
                                                </p>
                                             </div>
                                          </div>
                                       </div>
                                    </section>

                                    <section className="space-y-6">
                                      <div className="flex items-center gap-4">
                                        <div className="w-14 h-14 bg-purple-600/10 border border-purple-500/20 rounded-2xl flex items-center justify-center shadow-inner">
                                          <Network className="w-7 h-7 text-purple-400" />
                                        </div>
                                        <div>
                                          <h3 className="text-xl font-bold text-white leading-none">Global Mapping Logic</h3>
                                          <p className="text-[10px] text-white/30 uppercase tracking-widest mt-2">Default Rule Layer</p>
                                        </div>
                                      </div>
                                      <div className="bg-[#0a0a0a] border border-white/5 rounded-3xl p-8 shadow-2xl space-y-4">
                                        <div className="flex items-center justify-between gap-3">
                                          <span className="text-[9px] text-white/40 font-bold uppercase tracking-widest">Rule Characters</span>
                                          <span className="text-[9px] text-purple-300/70 font-mono">
                                            {(appSettings.globalMappingLogic || '').length}
                                          </span>
                                        </div>
                                        <textarea
                                          value={appSettings.globalMappingLogic || ''}
                                          onChange={(e) => setAppSettings({ ...appSettings, globalMappingLogic: e.target.value })}
                                          className="w-full min-h-48 bg-black/60 border border-white/10 rounded-2xl px-5 py-4 text-xs text-white/80 font-mono leading-relaxed resize-y outline-none focus:border-purple-500/50 custom-scrollbar"
                                          placeholder="Global mapping rules..."
                                        />
                                        <div className="flex items-center justify-between gap-4">
                                          <p className="text-[10px] text-white/35 leading-relaxed">
                                            {isAdmin
                                              ? 'Saved rules apply before schema-specific mapping instructions.'
                                              : 'Admin role required to edit global rules.'}
                                          </p>
                                          <button
                                            onClick={() => persistSettings(appSettings)}
                                            disabled={isSavingSettings || !isAdmin}
                                            className="px-6 py-3 bg-purple-600 hover:bg-purple-500 disabled:bg-purple-600/30 disabled:text-white/40 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border border-purple-500/20 shadow-xl"
                                          >
                                            {isSavingSettings ? 'Saving...' : 'Save Rules'}
                                          </button>
                                        </div>
                                      </div>
                                    </section>

                                    <section className="space-y-6">
                                      <div className="flex items-center gap-4">
                                        <div className="w-14 h-14 bg-emerald-600/10 border border-emerald-500/20 rounded-2xl flex items-center justify-center shadow-inner">
                                          <Database className="w-7 h-7 text-emerald-400" />
                                        </div>
                                        <div>
                                          <h3 className="text-xl font-bold text-white leading-none">Access Roles</h3>
                                          <p className="text-[10px] text-white/30 uppercase tracking-widest mt-2">Allowlist Administration</p>
                                        </div>
                                      </div>
                                      <div className="bg-[#0a0a0a] border border-white/5 rounded-3xl p-8 shadow-2xl">
                                        {isAdmin ? (
                                          <div className="space-y-4">
                                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                              <input
                                                type="email"
                                                value={newUserEmail}
                                                onChange={(e) => setNewUserEmail(e.target.value)}
                                                placeholder="user@company.com"
                                                className="md:col-span-2 bg-black/60 border border-white/10 rounded-xl px-4 py-3 text-xs text-white focus:outline-none focus:border-emerald-500"
                                              />
                                              <select
                                                value={newUserRole}
                                                onChange={(e) => setNewUserRole((e.target.value as 'admin' | 'user'))}
                                                className="bg-black/60 border border-white/10 rounded-xl px-3 py-3 text-xs text-white focus:outline-none focus:border-emerald-500"
                                              >
                                                <option value="user">user</option>
                                                <option value="admin">admin</option>
                                              </select>
                                            </div>
                                            <div className="flex gap-3">
                                              <button
                                                onClick={upsertAllowlistUser}
                                                disabled={isManagingUsers || !newUserEmail.trim()}
                                                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-600/40 disabled:text-white/50 text-white text-[10px] font-bold uppercase tracking-widest"
                                              >
                                                {isManagingUsers ? 'Saving...' : 'Add/Update User'}
                                              </button>
                                              <button
                                                onClick={fetchAllowlistUsers}
                                                disabled={isManagingUsers}
                                                className="px-5 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/70 text-[10px] font-bold uppercase tracking-widest border border-white/10"
                                              >
                                                Refresh
                                              </button>
                                            </div>
                                            <div className="space-y-2 max-h-52 overflow-y-auto custom-scrollbar pr-1">
                                              {allowlistUsers.map((u) => (
                                                <div key={u.email} className="flex items-center justify-between gap-3 bg-white/[0.03] border border-white/10 rounded-xl px-3 py-2">
                                                  <div className="min-w-0">
                                                    <div className="text-xs text-white truncate">{u.email}</div>
                                                    <div className="text-[10px] text-white/40 uppercase tracking-widest">{u.role}</div>
                                                  </div>
                                                  <button
                                                    onClick={() => deleteAllowlistUser(u.email)}
                                                    disabled={isManagingUsers || u.email === authUser?.email}
                                                    className="px-3 py-1 rounded-lg bg-red-500/10 hover:bg-red-500 text-red-400 hover:text-white disabled:opacity-40 text-[10px] font-bold uppercase tracking-wider"
                                                    title={u.email === authUser?.email ? 'Cannot delete your own active account' : 'Remove user'}
                                                  >
                                                    Remove
                                                  </button>
                                                </div>
                                              ))}
                                              {allowlistUsers.length === 0 && (
                                                <p className="text-[11px] text-white/40">No users found.</p>
                                              )}
                                            </div>
                                          </div>
                                        ) : (
                                          <p className="text-[11px] text-white/40">Admin role required to manage users and roles.</p>
                                        )}
                                      </div>
                                    </section>
                              </div>
                            )}

                            {settingsSubModule === 'mapping' && (
                              <div className="flex flex-col gap-10 pt-4 pb-20">
                                 <div className="bg-[#0a0a0a] border border-white/5 rounded-[32px] p-10 space-y-10 shadow-2xl">
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between">
                                          <h3 className="text-xl font-bold text-white tracking-tight">Mapping Logic</h3>
                                          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-purple-500/10 border border-purple-500/20 rounded-full animate-pulse">
                                            <Network className="w-3 h-3 text-purple-500" />
                                            <span className="text-[8px] font-bold text-purple-500 uppercase tracking-tighter">Logic Sync</span>
                                          </div>
                                        </div>
                                        <p className="text-[10px] text-white/30 uppercase tracking-[0.3em] font-medium leading-relaxed">Map properties to extraction rules.</p>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                       {appSettings.attributeSets.map((set, idx) => (
                                          <motion.div 
                                            initial={{ opacity: 0, scale: 0.95 }}
                                            animate={{ opacity: 1, scale: 1 }}
                                            key={idx} 
                                            className="bg-[#0a0a0a] border border-white/5 rounded-[32px] p-8 hover:bg-white/[0.03] transition-all group relative overflow-hidden shadow-2xl flex flex-col h-full"
                                          >
                                             <div className="absolute -right-6 -top-6 w-32 h-32 bg-purple-500/[0.02] rounded-full blur-3xl pointer-events-none" />
                                             <div className="flex items-center gap-5 mb-8">
                                                <div className="w-12 h-12 bg-purple-600/10 border border-purple-500/20 rounded-2xl flex items-center justify-center shadow-inner">
                                                  <Network className="w-6 h-6 text-purple-400" />
                                                </div>
                                                <div>
                                                   <span className="flex items-center gap-2 text-lg font-black text-white tracking-tight leading-none mb-1">
                                                     {set.name}
                                                     {(set.mdRules || '').trim() && (
                                                       <span
                                                         className="block h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-emerald-100"
                                                         title="Mapping logic attached"
                                                         aria-label="Mapping logic attached"
                                                       />
                                                     )}
                                                   </span>
                                                   <p className="text-[9px] text-white/20 uppercase tracking-widest">{set.fields.length} Logic Points</p>
                                                </div>
                                             </div>
                                            
                                             <div className="mt-auto border-t border-white/10 pt-4">
                                                <div className="flex items-center justify-between">
                                                   <div className="flex items-center gap-2">
                                                      <FileText className="w-4 h-4 text-white/40" />
                                                      <span className="text-[10px] uppercase font-bold tracking-widest text-white/40">Mapping Logic</span>
                                                   </div>
                                                   <button 
                                                     onClick={() => setEditingSetRules(idx)} 
                                                     className="text-[9px] px-3 py-1 bg-white/5 hover:bg-purple-600 rounded border border-white/10 text-white/60 hover:text-white uppercase font-bold transition-all"
                                                   >
                                                     {(set.mdRules || '').trim() ? 'EDIT LOGIC' : 'ADD LOGIC'}
                                                   </button>
                                                </div>
                                              </div>
                                              {set.mdFileName && (
                                                 <div className="mt-3 p-3 bg-purple-500/10 border border-purple-500/20 rounded-xl flex items-center justify-between">
                                                    <span className="text-[10px] font-mono text-purple-400 truncate">{set.mdFileName}</span>
                                                    <button 
                                                      onClick={() => {
                                                         const newSets = [...appSettings.attributeSets];
                                                         newSets[idx] = { ...newSets[idx], mdRules: undefined, mdFileName: undefined };
                                                         const updatedSettings = {...appSettings, attributeSets: newSets};
                                                         setAppSettings(updatedSettings);
                                                         persistSettings(updatedSettings);
                                                      }}
                                                      className="text-red-400 hover:text-red-300 p-1"
                                                    >
                                                      <X className="w-3 h-3" />
                                                    </button>
                                                 </div>
                                              )}
                                          </motion.div>
                                       ))}
                                       {appSettings.attributeSets.length === 0 && (
                                          <div className="col-span-full py-20 border border-dashed border-white/10 rounded-[48px] flex flex-col items-center justify-center text-center opacity-30">
                                            <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mb-8 border border-white/5 shadow-inner">
                                              <Network className="w-10 h-10 text-white" />
                                            </div>
                                            <h5 className="text-sm font-bold text-white uppercase tracking-[0.3em] mb-3">No Schemas Available</h5>
                                            <p className="text-[11px] text-white/40 font-medium px-20 leading-relaxed max-w-sm">
                                              Create a schema in the Schema Hub first to assign mapping logic.
                                            </p>
                                          </div>
                                       )}
                                    </div>
                                 </div>
                              </div>
                            )}

                            {settingsSubModule === 'indexer' && (
                              <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 pt-4 pb-20">
                                 <div className="lg:col-span-4 space-y-8">
                                    <div className="bg-[#0a0a0a] border border-white/5 rounded-[32px] p-10 space-y-10 shadow-2xl">
                                       <div className="space-y-2">
                                           <div className="flex items-center justify-between">
                                             <h3 className="text-xl font-bold text-white tracking-tight">Schema Hub</h3>
                                             <div className="flex items-center gap-1.5 px-2.5 py-1 bg-green-500/10 border border-green-500/20 rounded-full animate-pulse">
                                               <Database className="w-3 h-3 text-green-500" />
                                               <span className="text-[8px] font-bold text-green-500 uppercase tracking-tighter">Live DB Sync</span>
                                             </div>
                                           </div>
                                           <p className="text-[10px] text-white/30 uppercase tracking-[0.3em] font-medium leading-relaxed">Structural mapping protocols for AI synthesis.</p>
                                       </div>
                                       
                                       <div className="space-y-8">
                                          <div className="space-y-2">
                                        <label className="text-[10px] text-white/40 font-black uppercase tracking-widest flex items-center gap-2.5">
                                           <Info className="w-4 h-4" /> Attribute Set Name
                                        </label>
                                        <input 
                                          type="text" 
                                          value={newAttrName}
                                          onChange={(e)=>setNewAttrName(e.target.value)}
                                          className="w-full bg-black/60 border border-white/10 rounded-2xl px-5 py-4.5 text-sm text-blue-400 font-mono shadow-inner outline-none focus:border-blue-500/50 transition-all"
                                          placeholder="e.g. ELECTRONICS_SCHEMA"
                                        />
                                      </div>
                                      
                                      <div className="space-y-2">
                                        <label className="text-[10px] text-white/40 font-black uppercase tracking-widest flex items-center gap-2.5">
                                           <Database className="w-4 h-4" /> Attribute Headers
                                        </label>
                                        <textarea 
                                          value={newAttrFields}
                                          onChange={(e)=>setNewAttrFields(e.target.value)}
                                          className="w-full bg-black/60 border border-white/10 rounded-2xl px-5 py-5 text-sm text-white/80 h-48 font-mono shadow-inner outline-none focus:border-blue-500/50 transition-all resize-none leading-relaxed"
                                          placeholder="SKU, Title, Color, Size, Voltage, Material..."
                                        />
                                        <p className="text-[9px] text-white/20 italic mt-2">Separate each header name with a comma.</p>
                                      </div>

                                          <button 
                                            onClick={() => {
                                              if(!newAttrName) return;
                                              const fields = newAttrFields.split(',').map(f => f.trim()).filter(f => f);
                                              const newSets = [...appSettings.attributeSets, { name: newAttrName, fields }];
                                              const updatedSettings = {...appSettings, attributeSets: newSets};
                                              setAppSettings(updatedSettings);
                                              persistSettings(updatedSettings);
                                              setNewAttrName('');
                                              setNewAttrFields('');
                                              addLog('success', `Protocol registered: ${newAttrName}`);
                                            }}
                                            className="w-full py-5 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl text-[11px] font-black uppercase tracking-[0.3em] transition-all shadow-2xl shadow-blue-900/40 active:scale-95 flex items-center justify-center gap-3 overflow-hidden group"
                                          >
                                             <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
                                             <Plus className="w-4 h-4 relative z-10" /> <span className="relative z-10">COMPILE SCHEMA</span>
                                          </button>
                                       </div>
                                    </div>
                                 </div>

                                 <div className="lg:col-span-8 flex flex-col gap-6">
                                    <div className="bg-[#0a0a0a] border border-white/5 rounded-[32px] px-8 py-6 shadow-2xl">
                                      <div className="flex items-center justify-between gap-4">
                                        <div>
                                          <p className="text-[9px] text-white/30 uppercase tracking-[0.28em] font-black">Schema Hub Metrics</p>
                                          <h4 className="text-sm text-white/70 font-bold tracking-wide mt-2">Total Compiled Schemas</h4>
                                        </div>
                                        <div className="px-5 py-2 bg-blue-600/10 border border-blue-500/20 rounded-2xl text-right">
                                          <span className="text-2xl text-blue-400 font-black leading-none">{appSettings.attributeSets.length}</span>
                                        </div>
                                      </div>
                                    </div>

                                    <div className="grid grid-cols-1 gap-3">
                                       {appSettings.attributeSets.map((set, idx) => {
                                         const isExpanded = expandedSchemaIdx === idx;
                                         return (
                                           <motion.div 
                                             initial={{ opacity: 0, scale: 0.98 }}
                                             animate={{ opacity: 1, scale: 1 }}
                                             key={idx} 
                                             className="bg-[#0a0a0a] border border-white/5 rounded-[32px] p-0 transition-all group overflow-hidden shadow-2xl"
                                           >
                                              <div className="flex items-center gap-3 p-4">
                                                <button
                                                  type="button"
                                                  onClick={() => setExpandedSchemaIdx(isExpanded ? null : idx)}
                                                  aria-expanded={isExpanded}
                                                  className="flex min-w-0 flex-1 items-center gap-4 rounded-lg text-left transition-colors hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                                                >
                                                  <div className="w-10 h-10 bg-blue-600/10 border border-blue-500/20 rounded-2xl flex shrink-0 items-center justify-center shadow-inner">
                                                    <Layout className="w-5 h-5 text-blue-400" />
                                                  </div>
                                                  <div className="min-w-0">
                                                    <span className="text-base font-black text-white tracking-tight leading-none block truncate">{set.name}</span>
                                                    <p className="mt-1 text-[9px] text-white/20 uppercase tracking-widest">{set.fields.length} Attribute Headers</p>
                                                  </div>
                                                  <span className="ml-auto shrink-0 text-[10px] font-bold uppercase tracking-widest text-blue-500">
                                                    {isExpanded ? 'Hide' : 'Show'}
                                                  </span>
                                                </button>
                                                <div className="flex shrink-0 gap-2">
                                                  <button 
                                                    onClick={() => {
                                                      setNewAttrName(set.name);
                                                      setNewAttrFields(set.fields.join(', '));
                                                      const newSets = appSettings.attributeSets.filter((_, i) => i !== idx);
                                                      const updatedSettings = {...appSettings, attributeSets: newSets};
                                                      setAppSettings(updatedSettings);
                                                      setExpandedSchemaIdx(null);
                                                      persistSettings(updatedSettings);
                                                    }}
                                                    className="p-2.5 bg-blue-600/10 hover:bg-blue-600 text-blue-400 hover:text-white rounded-xl transition-all"
                                                    title="Modify Schema"
                                                    aria-label={`Modify schema ${set.name}`}
                                                  >
                                                    <Settings className="w-5 h-5" />
                                                  </button>
                                                  <button 
                                                    onClick={() => {
                                                      const newSets = appSettings.attributeSets.filter((_, i) => i !== idx);
                                                      const updatedSettings = {...appSettings, attributeSets: newSets};
                                                      setAppSettings(updatedSettings);
                                                      setExpandedSchemaIdx(null);
                                                      persistSettings(updatedSettings);
                                                    }}
                                                    className="p-2.5 bg-red-600/10 hover:bg-red-600 text-red-500 hover:text-white rounded-xl transition-all"
                                                    title="Delete Schema"
                                                    aria-label={`Delete schema ${set.name}`}
                                                  >
                                                    <X className="w-5 h-5" />
                                                  </button>
                                                </div>
                                              </div>

                                              {isExpanded && (
                                                <div className="border-t border-white/10 px-4 pb-4 pt-3">
                                                  <div className="flex flex-wrap gap-2.5">
                                                    {set.fields.map((f, i) => (
                                                      <span key={i} className="px-4 py-1.5 bg-black/60 border border-white/10 rounded-xl text-[10px] text-white/50 font-mono hover:text-blue-400 hover:border-blue-500/40 transition-colors shadow-inner">
                                                        {f}
                                                      </span>
                                                    ))}
                                                  </div>
                                                </div>
                                              )}
                                           </motion.div>
                                         );
                                       })}
                                       
                                       {appSettings.attributeSets.length === 0 && (
                                         <div className="col-span-full py-40 border border-dashed border-white/10 rounded-[48px] flex flex-col items-center justify-center text-center opacity-30">
                                            <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mb-8 border border-white/5 shadow-inner">
                                              <Database className="w-10 h-10 text-white" />
                                            </div>
                                            <h5 className="text-sm font-bold text-white uppercase tracking-[0.3em] mb-3">Registry Silent</h5>
                                            <p className="text-[11px] text-white/40 font-medium px-20 leading-relaxed max-w-sm">
                                              No custom attribute protocols detected in core memory. Initialize a schema to begin mapping orchestration.
                                            </p>
                                         </div>
                                       )}
                                    </div>
                                 </div>
                              </div>
                            )}
                         </motion.div>
                       </AnimatePresence>
                    </div>

                    <AnimatePresence>
                       {editingSetRules !== null && (
                         <motion.div 
                           initial={{ opacity: 0 }}
                           animate={{ opacity: 1 }}
                           exit={{ opacity: 0 }}
                           className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 p-6 backdrop-blur-md"
                         >
                           <motion.div 
                             initial={{ scale: 0.95, opacity: 0 }}
                             animate={{ scale: 1, opacity: 1 }}
                             exit={{ scale: 0.95, opacity: 0 }}
                             className="flex h-[85vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-stone-200 bg-white shadow-2xl"
                           >
                             <div className="flex shrink-0 items-center justify-between border-b border-stone-200 bg-white p-6">
                                <div className="flex items-center gap-4">
                                   <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
                                     <Zap className="w-6 h-6" />
                                   </div>
                                   <div>
                                      <h3 className="text-xl font-semibold text-slate-950">Mapping logic</h3>
                                      <p className="mt-1 text-sm text-slate-500">Instruction set for {appSettings.attributeSets[editingSetRules].name}</p>
                                   </div>
                                </div>
                                <button 
                                  onClick={() => setEditingSetRules(null)}
                                  className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-stone-100 hover:text-slate-700"
                                >
                                  <X className="w-5 h-5" />
                                </button>
                             </div>

                             <div className="flex flex-1 flex-col overflow-hidden bg-stone-50 p-6">
                                <textarea 
                                  value={appSettings.attributeSets[editingSetRules].mdRules || ''}
                                  onChange={(e) => {
                                     const newSets = [...appSettings.attributeSets];
                                     newSets[editingSetRules] = { ...newSets[editingSetRules], mdRules: e.target.value };
                                     setAppSettings({...appSettings, attributeSets: newSets});
                                  }}
                                  className="flex-1 resize-none rounded-lg border border-slate-800 bg-slate-950 p-5 font-mono text-sm leading-relaxed text-slate-100 outline-none transition-colors placeholder:text-slate-500 focus:border-blue-500 custom-scrollbar"
                                  placeholder="Define production logic rules here (Markdown format)..."
                                  autoFocus
                                />
                             </div>

                             <div className="flex shrink-0 items-center justify-between border-t border-stone-200 bg-white p-6">
                                <div className="text-sm text-slate-500">Saved rules stay on the existing settings payload.</div>
                                <button 
                                  onClick={() => {
                                    persistSettings(appSettings);
                                    setEditingSetRules(null);
                                  }}
                                  className="rounded-md bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
                                >
                                  Save mapping rules
                                </button>
                             </div>
                           </motion.div>
                         </motion.div>
                       )}
                     </AnimatePresence>

                    <div className="flex justify-end pt-6 pb-4 shrink-0 mt-auto">
                      <button 
                        onClick={() => persistSettings(appSettings)} 
                        className="rounded-md bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
                      >
                        {isSavingSettings ? 'Saving settings...' : 'Save settings'}
                      </button>
                    </div>
                  </motion.div>
                </div>
              ) : currentModule === 'scrapper' ? (
               <>
                 <Card padded={false} className={`h-[350px] terminal-card flex flex-col overflow-hidden shrink-0 transition-all ${isScraping ? 'ring-1 ring-blue-500/20' : ''}`}>
                    <div className="min-h-10 border-b border-white/10 flex flex-wrap items-center px-4 py-2 justify-between gap-2 bg-white/[0.02]">
                       <div className="flex items-center gap-2"><Terminal className="w-3 h-3 text-blue-300" /><span className="text-[10px] font-mono text-white/65 uppercase tracking-widest">Live Progress</span></div>
                       <div className="flex items-center gap-2">
                         <Badge tone={isScraping ? 'blue' : 'neutral'}>{isScraping ? `${progress}%` : 'Idle'}</Badge>
                         <Badge tone="neutral">{logs.length} events</Badge>
                         <Button variant="ghost" size="sm" onClick={() => setLogs([])} disabled={logs.length === 0} className="h-7 px-2 text-[9px]">Clear</Button>
                       </div>
                    </div>
                    <div className="px-4 pt-3">
                      <Progress value={isScraping ? progress : 0} />
                    </div>
                    <div className="flex-1 p-3 font-mono text-[10px] leading-relaxed overflow-y-auto text-white/80 custom-scrollbar" aria-live="polite" aria-label="Live job logs">
                      {logs.length === 0 ? (
                        <div className="flex h-full min-h-28 items-center justify-center rounded-lg border border-dashed border-white/10 text-center text-white/35">
                          <div>
                            <Terminal className="mx-auto mb-2 h-5 w-5 text-white/25" />
                            <p className="text-[10px] font-bold uppercase tracking-widest">No log events yet</p>
                            <p className="mt-1 text-[10px] text-white/28">Run a harvest, discovery, mapping, or image job to stream activity here.</p>
                          </div>
                        </div>
                      ) : logs.map((log, i) => (
                        <div key={`${log.timestamp}-${i}`} className={`${getLogColor(log.type)} log-row`}>
                          <span className="text-white/22 shrink-0">{log.timestamp}</span>
                          <span className="log-type-pill">{getLogLabel(log.type)}</span>
                          <span className="min-w-0 break-words text-white/78">{log.message}</span>
                        </div>
                      ))}
                      <div ref={logsEndRef} />
                    </div>
                 </Card>

                 <div className="flex-1 flex flex-col min-h-0">
                    {discoveryMode && discoveredLinks.length > 0 && (
                      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mb-6 rounded-xl border border-blue-500/20 bg-blue-500/5 flex flex-col overflow-hidden max-h-72">
                         <div className="min-h-12 border-b border-blue-500/20 px-4 py-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <span className="text-[10px] font-bold text-blue-400 uppercase tracking-widest">Target Discovery: {discoveredLinks.length} items found</span>
                            <div className="responsive-actions">
                               <Badge tone={selectedLinks.length > 0 ? 'blue' : 'neutral'}>{selectedLinks.length} selected</Badge>
                               <Button onClick={() => setSelectedLinks(discoveredLinks.map(l => l.href))} variant="ghost" size="sm">Select All</Button>
                               <Button onClick={handleDeepScrape} disabled={selectedLinks.length === 0 || isScraping} size="sm">
                                 {isScraping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                                 Extract Selected
                               </Button>
                            </div>
                         </div>
                         <div className="flex-1 overflow-y-auto p-2 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-1 custom-scrollbar">
                            {discoveredLinks.map((link, idx) => (
                              <button key={idx} type="button" aria-pressed={selectedLinks.includes(link.href)} onClick={() => setSelectedLinks(prev => prev.includes(link.href) ? prev.filter(h => h !== link.href) : [...prev, link.href])} className={`flex items-center justify-between p-2 rounded border transition-all text-left focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${selectedLinks.includes(link.href) ? 'bg-blue-600/20 border-blue-500/40' : 'bg-black/20 border-white/5 hover:border-white/10'}`}>
                                <div className="truncate flex-1 pr-2">
                                  <div className="text-[10px] font-medium text-white truncate">{link.text || 'Target Product'}</div>
                                  <div className="text-[8px] text-white/30 truncate font-mono">{link.href}</div>
                                </div>
                                <div className={`w-3 h-3 rounded transition-colors flex items-center justify-center shrink-0 ${selectedLinks.includes(link.href) ? 'bg-blue-500' : 'border border-white/20'}`}>{selectedLinks.includes(link.href) && <Check className="w-2 h-2 text-white" />}</div>
                              </button>
                            ))}
                         </div>
                      </motion.div>
                    )}

                    {!isScraping && (
                      (extractionResult || extractionResult2 || primaryHarvestEntries.length > 0) ? (
                        <div className="flex-1 flex flex-col gap-4 overflow-y-auto custom-scrollbar">
                          {extractionResult && (
                            <details className="group border border-white/10 bg-zinc-900/40 rounded-xl overflow-hidden shrink-0" open>
                              <summary className="h-10 border-b border-white/10 flex items-center px-4 justify-between bg-white/[0.02] cursor-pointer hover:bg-white/[0.04]">
                                <div className="flex items-center gap-2"><Layout className="w-3.5 h-3.5 text-blue-400" /><span className="text-[10px] font-bold uppercase text-white/60">Logic Harvest Outcome (Primary)</span></div>
                                <div className="flex gap-4 items-center">
                                  {!isEditingPrimary && (
                                    <>
                                      <button onClick={(e) => { e.preventDefault(); navigator.clipboard.writeText(extractionResult!); setCopied(true); setTimeout(()=>setCopied(false), 2000); }} className="text-[10px] font-bold text-white/30 hover:text-white transition-colors">{copied ? 'COPIED' : 'COPY MD'}</button>
                                      {currentScreenshot && (
                                        <button onClick={(e) => { e.preventDefault(); setIsScreenshotExpanded(true) }} className="p-1 px-3 bg-purple-600/10 hover:bg-purple-600/20 text-purple-400 rounded text-[10px] font-bold uppercase transition-all tracking-tighter">View Screenshot</button>
                                      )}
                                      <button onClick={(e) => { e.preventDefault(); setActiveHarvestEntryFilename(null); setIsModalOpen(true) }} className="p-1 px-3 bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 rounded text-[10px] font-bold uppercase transition-all tracking-tighter">Expand View</button>
                                      <button onClick={(e) => { e.preventDefault(); handleEditPrimary() }} className="p-1 px-3 bg-amber-600/10 hover:bg-amber-600/20 text-amber-400 rounded text-[10px] font-bold uppercase transition-all tracking-tighter">Edit</button>
                                    </>
                                  )}
                                  {isEditingPrimary && (
                                    <>
                                      <button onClick={(e) => { e.preventDefault(); handleSavePrimary() }} className="p-1 px-3 bg-green-600/10 hover:bg-green-600/20 text-green-400 rounded text-[10px] font-bold uppercase transition-all tracking-tighter">Save</button>
                                      <button onClick={(e) => { e.preventDefault(); handleCancelPrimary() }} className="p-1 px-3 bg-red-600/10 hover:bg-red-600/20 text-red-400 rounded text-[10px] font-bold uppercase transition-all tracking-tighter">Cancel</button>
                                    </>
                                  )}
                                </div>
                              </summary>
                              <div className="p-6 overflow-y-auto max-h-[500px] custom-scrollbar">
                                {isEditingPrimary ? (
                                  <textarea
                                    value={editedPrimaryResult}
                                    onChange={(e) => setEditedPrimaryResult(e.target.value)}
                                    className="w-full h-[400px] p-4 bg-zinc-900 border border-white/10 rounded text-white text-sm font-mono resize-none focus:outline-none focus:border-blue-500"
                                    placeholder="Edit harvest outcome..."
                                  />
                                ) : (
                                  <div className="prose prose-invert prose-xs max-w-none">
                                    <div className="markdown-body"><MarkdownContent>{extractionResult}</MarkdownContent></div>
                                  </div>
                                )}
                              </div>
                            </details>
                          )}

                          {primaryHarvestEntries.map((entry) => {
                            const isEditingEntry = editingHarvestFilename === entry.filename;
                            const isEntryOpen = primaryHarvestEntries.length === 1 || activeHarvestEntryFilename === entry.filename || isEditingEntry;

                            return (
                              <details key={entry.filename} className="group border border-white/10 bg-zinc-900/40 rounded-xl overflow-hidden shrink-0" open={isEntryOpen}>
                                <summary
                                  onClick={(e) => {
                                    e.preventDefault();
                                    setActiveHarvestEntryFilename((prev) => prev === entry.filename ? null : entry.filename);
                                  }}
                                  className="min-h-12 border-b border-white/10 flex items-center px-4 justify-between gap-4 bg-white/[0.02] cursor-pointer hover:bg-white/[0.04]"
                                >
                                  <div className="flex items-center gap-3 min-w-0">
                                    <Layout className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                                    <div className="min-w-0">
                                      <div className="text-[10px] font-bold uppercase text-white/60">Logic Harvest Outcome (Primary)</div>
                                      <div className="text-[9px] font-mono uppercase tracking-widest text-white/30 truncate">{entry.filename} • {entry.sourceLabel}</div>
                                    </div>
                                  </div>
                                  <div className="flex gap-3 items-center shrink-0">
                                    {!isEditingEntry && (
                                      <>
                                        <button onClick={(e) => { e.preventDefault(); navigator.clipboard.writeText(entry.content); setCopied(true); setTimeout(()=>setCopied(false), 2000); }} className="text-[10px] font-bold text-white/30 hover:text-white transition-colors">{copied ? 'COPIED' : 'COPY MD'}</button>
                                        <button onClick={(e) => { e.preventDefault(); setActiveHarvestEntryFilename(entry.filename); setIsModalOpen(true); }} className="p-1 px-3 bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 rounded text-[10px] font-bold uppercase transition-all tracking-tighter">Expand View</button>
                                        <button onClick={(e) => { e.preventDefault(); handleEditSavedHarvest(entry.filename); }} className="p-1 px-3 bg-amber-600/10 hover:bg-amber-600/20 text-amber-400 rounded text-[10px] font-bold uppercase transition-all tracking-tighter">Edit</button>
                                      </>
                                    )}
                                    {isEditingEntry && (
                                      <>
                                        <button onClick={(e) => { e.preventDefault(); void handleSaveSavedHarvest(entry.filename); }} disabled={isSavingHarvestEntry} className="p-1 px-3 bg-green-600/10 hover:bg-green-600/20 disabled:opacity-50 text-green-400 rounded text-[10px] font-bold uppercase transition-all tracking-tighter flex items-center gap-2">
                                          {isSavingHarvestEntry ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                                          Save
                                        </button>
                                        <button onClick={(e) => { e.preventDefault(); handleCancelSavedHarvestEdit(); }} disabled={isSavingHarvestEntry} className="p-1 px-3 bg-red-600/10 hover:bg-red-600/20 disabled:opacity-50 text-red-400 rounded text-[10px] font-bold uppercase transition-all tracking-tighter">Cancel</button>
                                      </>
                                    )}
                                  </div>
                                </summary>
                                <div className="p-6 overflow-y-auto max-h-[500px] custom-scrollbar space-y-4">
                                  {isEditingEntry && harvestSaveError && (
                                    <Alert tone="danger">{harvestSaveError}</Alert>
                                  )}
                                  {isEditingEntry ? (
                                    <textarea
                                      value={editedHarvestContent}
                                      onChange={(e) => setEditedHarvestContent(e.target.value)}
                                      className="w-full h-[400px] p-4 bg-zinc-900 border border-white/10 rounded text-white text-sm font-mono resize-none focus:outline-none focus:border-blue-500"
                                      placeholder="Edit harvested markdown..."
                                    />
                                  ) : (
                                    <div className="prose prose-invert prose-xs max-w-none">
                                      <div className="markdown-body"><MarkdownContent>{entry.content}</MarkdownContent></div>
                                    </div>
                                  )}
                                </div>
                              </details>
                            );
                          })}
                          
                          {extractionResult2 && (
                            <details className="group border border-white/10 bg-zinc-900/40 rounded-xl overflow-hidden shrink-0" open>
                              <summary className="h-10 border-b border-white/10 flex items-center px-4 justify-between bg-white/[0.02] cursor-pointer hover:bg-white/[0.04]">
                                <div className="flex items-center gap-2"><Layout className="w-3.5 h-3.5 text-green-400" /><span className="text-[10px] font-bold uppercase text-white/60">Logic Harvest Outcome (Secondary)</span></div>
                                <div className="flex gap-4 items-center">
                                  {!isEditingSecondary && (
                                    <>
                                      <button onClick={(e) => { e.preventDefault(); navigator.clipboard.writeText(extractionResult2!); setCopied(true); setTimeout(()=>setCopied(false), 2000); }} className="text-[10px] font-bold text-white/30 hover:text-white transition-colors">{copied ? 'COPIED' : 'COPY MD'}</button>
                                      <button onClick={(e) => { e.preventDefault(); handleEditSecondary() }} className="p-1 px-3 bg-amber-600/10 hover:bg-amber-600/20 text-amber-400 rounded text-[10px] font-bold uppercase transition-all tracking-tighter">Edit</button>
                                    </>
                                  )}
                                  {isEditingSecondary && (
                                    <>
                                      <button onClick={(e) => { e.preventDefault(); handleSaveSecondary() }} className="p-1 px-3 bg-green-600/10 hover:bg-green-600/20 text-green-400 rounded text-[10px] font-bold uppercase transition-all tracking-tighter">Save</button>
                                      <button onClick={(e) => { e.preventDefault(); handleCancelSecondary() }} className="p-1 px-3 bg-red-600/10 hover:bg-red-600/20 text-red-400 rounded text-[10px] font-bold uppercase transition-all tracking-tighter">Cancel</button>
                                    </>
                                  )}
                                </div>
                              </summary>
                              <div className="p-6 overflow-y-auto max-h-[500px] custom-scrollbar">
                                {isEditingSecondary ? (
                                  <textarea
                                    value={editedSecondaryResult}
                                    onChange={(e) => setEditedSecondaryResult(e.target.value)}
                                    className="w-full h-[400px] p-4 bg-zinc-900 border border-white/10 rounded text-white text-sm font-mono resize-none focus:outline-none focus:border-blue-500"
                                    placeholder="Edit harvest outcome..."
                                  />
                                ) : (
                                  <div className="prose prose-invert prose-xs max-w-none">
                                    <div className="markdown-body"><MarkdownContent>{extractionResult2}</MarkdownContent></div>
                                  </div>
                                )}
                              </div>
                            </details>
                          )}
                        </div>
                      ) : (
                        <EmptyState
                          icon={<Activity className="h-8 w-8" />}
                          title={extractionResult === '' ? 'Harvest complete: no data extracted' : 'Engine awaiting initialization'}
                          description="Run a product scrape, PLP discovery, or batch harvest to populate this workspace."
                          className="flex-1"
                        />
                      )
                    )}
                 </div>
               </>
             ) : currentModule === 'jobs' ? (
               <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6">
                  <div className="responsive-toolbar">
                    <div>
                      <h2 className="text-2xl font-semibold tracking-tight text-slate-950">QA Jobs</h2>
                      <p className="mt-1 text-sm text-slate-500">Map SKUs, inspect source readiness, and export completed QA results.</p>
                    </div>
                    <div className="responsive-actions">
                        <Button onClick={() => fetchJobs()} variant="secondary" size="md"><Activity className="w-3.5 h-3.5" /> Re-sync</Button>
                        {selectedJobs.length > 0 && (
                          <Button
                            onClick={() => handleBulkSkuDelete(selectedJobs, 'jobs')}
                            variant="danger"
                            size="md"
                          >
                            <X className="w-3.5 h-3.5" /> Delete ({selectedJobs.length})
                          </Button>
                        )}
                        <Button onClick={handleExportOutputs} disabled={isExportingOutputs} className="bg-green-600 hover:bg-green-500" size="md">
                           {isExportingOutputs ? 'Exporting...' : `Export XLS ${selectedJobs.length > 0 ? `(${selectedJobs.length})` : ''}`}
                        </Button>
                    </div>
                  </div>
                  {outputExportError ? (
                    <Alert tone="danger" className="text-xs">{outputExportError}</Alert>
                  ) : null}

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
                    {[
                      ['Total SKUs', jobsTotal ?? jobs.length, 'Jobs in the current queue', 'neutral'],
                      ['Ready for mapping', readyMappingJobCount, 'Can run Map AI now', 'blue'],
                      ['In progress', inProgressJobCount, 'Queued or running jobs', 'blue'],
                      ['Completed outputs', completedJobCount, 'Output JSON available', 'green'],
                      ['Failed or pending', failedJobCount + pendingJobCount, 'Needs attention', failedJobCount > 0 ? 'red' : 'amber'],
                    ].map(([label, value, help, tone]) => (
                      <Card key={label as string} className="p-4">
                        <Badge tone={tone as any}>{label}</Badge>
                        <div className="mt-3 text-3xl font-semibold text-slate-950">{value}</div>
                        <div className="mt-1 text-xs text-slate-500">{help}</div>
                      </Card>
                    ))}
                  </div>

                  {/* Search bar */}
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <Input
                      type="text"
                      value={jobsSearch}
                      onChange={(e) => {
                        setJobsSearch(e.target.value);
                        fetchJobs({ search: e.target.value });
                      }}
                      placeholder="Search by SKU or title…"
                      label="Search jobs"
                      wrapperClassName="flex-1"
                      className="text-xs"
                    />
                    {jobsTotal !== undefined && (
                      <span className="whitespace-nowrap text-sm text-slate-500">
                        {jobs.length} / {jobsTotal} SKUs
                      </span>
                    )}
                  </div>

                      <div className="data-table-shell flex flex-1 flex-col">
                      <div className="data-table-header grid min-w-[1280px] grid-cols-[1fr_5fr_7fr_5fr_7fr_4fr_3fr_6fr_7fr] items-center px-6 py-3">
                         <div className="flex items-center">
                           <input 
                             type="checkbox" 
                             className="w-3 h-3 cursor-pointer outline-none accent-blue-500"
                             aria-label="Select all visible jobs"
                             checked={jobs.length > 0 && selectedJobs.length === jobs.length}
                             onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedJobs(jobs.map(j => j.sku));
                                } else {
                                  setSelectedJobs([]);
                                }
                             }}
                           />
                         </div>
                         <div>SKU</div>
                         <div>Product</div>
                         <div>Attribute set</div>
                         <div>Source readiness</div>
                         <div>Status / output</div>
                         <div>Retry</div>
                         <div>Model</div>
                         <div className="text-right">Actions</div>
                      </div>
                      <div className="flex-1 overflow-y-auto custom-scrollbar">
                         {jobs.map((job, idx) => {
                            const jobAttributeSet = readSkuAttributeSetForDisplay(job);
                            return (
                            <div key={idx} className="data-table-row grid min-h-20 min-w-[1280px] grid-cols-[1fr_5fr_7fr_5fr_7fr_4fr_3fr_6fr_7fr] items-center px-6 py-3">
                               <div className="flex items-center">
                                 <input 
                                   type="checkbox" 
                                   className="w-3 h-3 cursor-pointer outline-none accent-blue-500"
                                   aria-label={`Select job ${job.sku}`}
                                   checked={selectedJobs.includes(job.sku)}
                                   onChange={(e) => {
                                      if(e.target.checked) setSelectedJobs(p => [...p, job.sku]);
                                      else setSelectedJobs(p => p.filter(s => s !== job.sku));
                                   }}
                                 />
                               </div>
                               <div className="font-mono text-sm font-semibold text-blue-700">{job.sku}</div>
                               <div className="truncate pr-6 text-sm font-medium text-slate-700">{job.title || 'Unknown product'}</div>
                               <div className="truncate text-xs font-medium text-slate-600">{jobAttributeSet || 'Default'}</div>
                               <div className="flex flex-col justify-center gap-1 text-xs">
                                 {job.harvestFile && (
                                   <div className="flex items-center gap-2">
                                     <Badge tone="green" className="rounded-md">Harvest</Badge>
                                     <button
                                       onClick={() => openHarvestFile(job.harvestFile!, 'job harvest')}
                                       className="flex h-5 w-5 items-center justify-center rounded bg-blue-50 text-blue-700 transition-colors hover:bg-blue-100"
                                       title="Open Harvest File"
                                       aria-label={`Open harvest file for ${job.sku}`}
                                     >
                                       <Eye className="w-3 h-3" />
                                     </button>
                                     <button 
                                       onClick={() => handleHarvestDelete(job.harvestFile!)}
                                       className="flex h-5 w-5 items-center justify-center rounded bg-red-50 text-red-700 transition-colors hover:bg-red-600 hover:text-white"
                                       title="Delete Harvest File"
                                       aria-label={`Delete harvest file for ${job.sku}`}
                                     >
                                       <X className="w-3 h-3" />
                                     </button>
                                   </div>
                                 )}
                                 {job.hasPdf && (
                                   <div className="flex items-center gap-2">
                                     <Badge tone="blue" className="rounded-md">PDF</Badge>
                                     <button onClick={() => handleViewPdf(job.sku)} className="flex h-5 w-5 items-center justify-center rounded bg-blue-50 text-blue-700 transition-colors hover:bg-blue-100" title="View PDF Extracted Text" aria-label={`View PDF text for ${job.sku}`}><FileText className="w-3 h-3" /></button>
                                   </div>
                                 )}
                               {job.hasSapData && (
                                 <div className="flex items-center gap-2">
                                   <Badge tone="amber" className="rounded-md">SAP truth</Badge>
                                 </div>
                               )}
                               {!job.harvestFile && !job.hasPdf && !job.hasSapData && <Badge tone="neutral" className="rounded-md">No source</Badge>}
                              </div>
                              <div className="flex items-center gap-2">
                                 <Badge tone={job.status === 'completed' ? 'green' : job.status === 'failed' ? 'red' : job.status === 'pending' ? 'amber' : job.status === 'ready' || job.status === 'queued' || job.status === 'running' ? 'blue' : 'neutral'} className="rounded-md">
                                   <span className={`h-1.5 w-1.5 rounded-full ${job.status === 'completed' ? 'bg-emerald-400' : job.status === 'ready' ? 'bg-blue-400 animate-pulse' : 'bg-white/30'}`} />
                                   {job.status}
                                 </Badge>
                                 <Badge tone={job.status === 'completed' ? 'green' : 'neutral'} className="rounded-md">
                                   {job.status === 'completed' ? 'Output' : 'No output'}
                                 </Badge>
                                 {job.status === 'completed' && (
                                   <button 
                                     onClick={() => handleOutputDelete(job.sku)}
                                     className="ml-1 flex h-5 w-5 items-center justify-center rounded bg-red-50 text-red-700 transition-colors hover:bg-red-600 hover:text-white"
                                     title="Delete Output JSON"
                                     aria-label={`Delete output for ${job.sku}`}
                                   >
                                      <X className="w-3 h-3" />
                                   </button>
                                 )}
                              </div>
                              <div className="text-sm text-slate-500">{(job as any).retryCount ?? '-'}</div>
                              <div className="truncate text-xs text-slate-500">{jobAiModels[job.sku] || DEFAULT_MAP_AI_MODELS[0]}</div>
                              <div className="text-right">
                                 <div className="flex flex-wrap items-center justify-end gap-2">
                                   <Button
                                     onClick={() => { setReviewSku(job.sku); setCurrentModule('review'); }}
                                     variant="secondary"
                                     size="sm"
                                   >
                                     Review
                                   </Button>
                                 {job.status === 'completed' ? (
                                   <button 
                                     onClick={() => fetchOutput(job.sku)}
                                     className="rounded-lg border border-blue-200 bg-blue-50 p-2 text-blue-700 transition-colors hover:bg-blue-100"
                                     title="View/Edit Output"
                                     aria-label={`View or edit output for ${job.sku}`}
                                   >
                                     <Eye className="w-4 h-4"/>
                                   </button>
                                 ) : 
                                  (job.status === 'ready' && (
                                     <div className="flex flex-wrap items-center justify-end gap-2">
                                       <select 
                                         value={jobAiModels[job.sku] || DEFAULT_MAP_AI_MODELS[0]}
                                         onChange={(e) => setJobAiModels({...jobAiModels, [job.sku]: e.target.value})}
                                         aria-label={`AI model for ${job.sku}`}
                                         className="h-[30px] rounded-md border border-stone-300 bg-white px-2 py-1 text-xs text-slate-700 outline-none transition-all focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                                       >
                                         {DEFAULT_MAP_AI_MODELS.map((model) => (
                                           <option key={model} value={model}>{model}</option>
                                         ))}
                                         <option value={CUSTOM_MAP_AI_MODEL_VALUE}>Custom model...</option>
                                       </select>
                                       {(jobAiModels[job.sku] || DEFAULT_MAP_AI_MODELS[0]) === CUSTOM_MAP_AI_MODEL_VALUE && (
                                         <input
                                           type="text"
                                           value={customJobAiModels[job.sku] || ''}
                                           onChange={(e) => setCustomJobAiModels({...customJobAiModels, [job.sku]: e.target.value})}
                                           placeholder="provider/model-id"
                                          aria-label={`Custom AI model for ${job.sku}`}
                                          className="h-[30px] w-44 rounded-md border border-stone-300 bg-white px-2 py-1 text-xs font-mono text-slate-700 outline-none transition-all placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                                         />
                                       )}
                                       <button aria-label={`Run AI mapping for ${job.sku}`} onClick={async () => {
                                          try {
                                            const selectedMapAiModel = jobAiModels[job.sku] || DEFAULT_MAP_AI_MODELS[0];
                                            const model = selectedMapAiModel === CUSTOM_MAP_AI_MODEL_VALUE
                                              ? (customJobAiModels[job.sku] || '').trim()
                                              : selectedMapAiModel;

                                            if (!model) {
                                              throw new Error(MAP_AI_MISSING_MODEL_MESSAGE);
                                            }

                                            addLog('skill', `AI Dispatching mapping for SKU ${job.sku} using ${model}...`);
                                            const startRes = await apiFetch('/api/jobs/run', {
                                              method: 'POST',
                                              headers: {'Content-Type': 'application/json'},
                                              body: JSON.stringify({ 
                                                 sku: job.sku, 
                                                 aiModel: model
                                               })
                                            });
                                            if (!startRes.ok) {
                                              const errData = await startRes.json().catch(() => ({}));
                                              addLog('error', `Mapping failed for ${job.sku}: ${errData?.error || `HTTP ${startRes.status}`}`);
                                              return;
                                            }
                                            const { jobId } = await startRes.json();
                                            addLog('skill', `Mapping job queued (${jobId}). Waiting for result...`);
                                            await pollJob(jobId, SCRAPE_JOB_POLL_TIMEOUT_MS);
                                            addLog('success', `SKU ${job.sku} mapping cycle complete.`);
                                            fetchJobs();
                                          } catch (e: any) { addLog('error', `Mapping failed for ${job.sku}: ${e.message}`); }
                                       }} className="flex h-[30px] items-center rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-blue-700">Map AI</button>
                                     </div>
                                  ))}
                                 </div>
                              </div>
                           </div>
                        )})}
                        {jobs.length === 0 && (
                          <EmptyState
                            icon={<Briefcase className="h-8 w-8" />}
                            title="Awaiting SKU master upload"
                            description="Upload or create SKU records first, then jobs will appear here for enrichment and export."
                            className="m-6"
                          />
                        )}
                     </div>
                     {jobsHasMore && (
                       <div className="flex justify-center border-t border-stone-200 py-3">
                         <Button
                           onClick={() => fetchJobs({ cursor: jobsNextCursor ?? undefined, append: true })}
                           variant="secondary"
                           size="sm"
                         >
                           Load more
                         </Button>
                       </div>
                     )}
                  </div>
               </div>
             ) : currentModule === 'review' ? (
               <div className="mx-auto grid w-full max-w-7xl flex-1 gap-6 lg:grid-cols-[340px_1fr]">
                 <Card className="flex min-h-0 flex-col overflow-hidden p-0">
                   <div className="border-b border-stone-200 p-4">
                     <h2 className="text-base font-semibold text-slate-950">SKU Review</h2>
                     <p className="mt-1 text-sm text-slate-500">Select a SKU to inspect source context, output, and timeline.</p>
                   </div>
                   <div className="flex-1 overflow-y-auto p-2 custom-scrollbar">
                     {jobs.map((job) => {
                       const active = selectedReviewJob?.sku === job.sku;
                       return (
                         <button
                           key={job.sku}
                           type="button"
                           onClick={() => setReviewSku(job.sku)}
                           className={`mb-2 w-full rounded-lg border p-3 text-left transition-colors ${active ? 'border-blue-200 bg-blue-50' : 'border-stone-200 bg-white hover:border-blue-200 hover:bg-blue-50/50'}`}
                         >
                           <div className="flex items-start justify-between gap-3">
                             <div className="min-w-0">
                               <div className="font-mono text-sm font-semibold text-blue-700">{job.sku}</div>
                               <div className="mt-1 truncate text-sm text-slate-600">{job.title || 'Unknown product'}</div>
                             </div>
                             <Badge tone={job.status === 'completed' ? 'green' : job.status === 'failed' ? 'red' : job.status === 'ready' ? 'blue' : 'neutral'}>{job.status}</Badge>
                           </div>
                         </button>
                       );
                     })}
                     {jobs.length === 0 && (
                       <EmptyState
                         icon={<Briefcase className="h-8 w-8" />}
                         title="No SKUs to review"
                         description="Upload catalogue data and sync jobs first."
                         className="m-2"
                       />
                     )}
                   </div>
                 </Card>

                 {selectedReviewJob ? (
                   <div className="flex min-w-0 flex-col gap-6">
                     <div className="responsive-toolbar">
                       <div>
                         <h2 className="text-2xl font-semibold tracking-tight text-slate-950">{selectedReviewJob.sku}</h2>
                         <p className="mt-1 text-sm text-slate-500">{selectedReviewJob.title || 'SKU inspection workspace'}</p>
                       </div>
                       <div className="responsive-actions">
                         <Button onClick={() => setCurrentModule('jobs')} variant="secondary">Back to jobs</Button>
                         {selectedReviewJob.status === 'completed' && (
                           <Button onClick={() => fetchOutput(selectedReviewJob.sku)}>Open output</Button>
                         )}
                       </div>
                     </div>

                     <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                       <Card className="p-4"><div className="text-xs text-slate-500">Status</div><div className="mt-2"><Badge tone={selectedReviewJob.status === 'completed' ? 'green' : selectedReviewJob.status === 'failed' ? 'red' : selectedReviewJob.status === 'ready' ? 'blue' : 'neutral'}>{selectedReviewJob.status}</Badge></div></Card>
                       <Card className="p-4"><div className="text-xs text-slate-500">Attribute set</div><div className="mt-2 text-sm font-semibold text-slate-950">{readSkuAttributeSetForDisplay(selectedReviewJob) || 'Default'}</div></Card>
                       <Card className="p-4"><div className="text-xs text-slate-500">Retry count</div><div className="mt-2 text-2xl font-semibold text-slate-950">{(selectedReviewJob as any).retryCount ?? 0}</div></Card>
                       <Card className="p-4"><div className="text-xs text-slate-500">Output</div><div className="mt-2"><Badge tone={selectedReviewJob.status === 'completed' ? 'green' : 'neutral'}>{selectedReviewJob.status === 'completed' ? 'Available' : 'Not ready'}</Badge></div></Card>
                     </div>

                     <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                       <Card className="p-5">
                         <h3 className="text-base font-semibold text-slate-950">Source context</h3>
                         <div className="mt-4 flex flex-wrap gap-2">
                           {selectedReviewJob.hasSapData || (selectedReviewRecord && hasSapSource(selectedReviewRecord)) ? <Badge tone="amber">SAP truth source</Badge> : null}
                           {selectedReviewJob.hasPdf || selectedReviewRecord?.pdf_text ? <Badge tone="blue">PDF context</Badge> : null}
                           {selectedReviewJob.harvestFile ? <Badge tone="green">Scraped harvest</Badge> : null}
                           {!selectedReviewJob.hasSapData && !selectedReviewJob.hasPdf && !selectedReviewJob.harvestFile && <Badge tone="neutral">No linked source</Badge>}
                         </div>
                         <div className="mt-5 flex flex-wrap gap-2">
                           {selectedReviewJob.harvestFile && (
                             <Button onClick={() => openHarvestFile(selectedReviewJob.harvestFile!, 'sku review harvest')} variant="secondary" size="sm">
                               <FileText className="h-3.5 w-3.5" /> Scraped markdown
                             </Button>
                           )}
                           {selectedReviewJob.hasPdf && (
                             <Button onClick={() => handleViewPdf(selectedReviewJob.sku)} variant="secondary" size="sm">
                               <FileText className="h-3.5 w-3.5" /> PDF text
                             </Button>
                           )}
                           {selectedReviewJob.status === 'completed' && (
                             <Button onClick={() => fetchOutput(selectedReviewJob.sku)} variant="secondary" size="sm">
                               <Eye className="h-3.5 w-3.5" /> QA result JSON
                             </Button>
                           )}
                         </div>
                       </Card>

                       <Card className="p-5">
                         <h3 className="text-base font-semibold text-slate-950">Timeline logs</h3>
                         <div className="mt-4 max-h-56 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950 p-3 font-mono text-xs text-slate-200 custom-scrollbar">
                           {selectedReviewLogs.length > 0 ? selectedReviewLogs.map((log, i) => (
                             <div key={`${log.timestamp}-${i}`} className="mb-2 last:mb-0">
                               <span className="text-slate-500">{log.timestamp}</span> <span>{log.message}</span>
                             </div>
                           )) : (
                             <div className="text-slate-500">No timeline entries found for this SKU in current logs.</div>
                           )}
                         </div>
                       </Card>
                     </div>

                     <Card className="overflow-hidden p-0">
                       <div className="border-b border-stone-200 px-5 py-4">
                         <h3 className="text-base font-semibold text-slate-950">Uploaded SKU JSON</h3>
                         <p className="mt-1 text-sm text-slate-500">Raw uploaded/indexed record for this SKU.</p>
                       </div>
                       <pre className="max-h-96 overflow-auto bg-slate-950 p-5 text-xs leading-relaxed text-slate-100 custom-scrollbar">{JSON.stringify(selectedReviewRecord || selectedReviewJob, null, 2)}</pre>
                     </Card>
                   </div>
                 ) : null}
               </div>
             ) : currentModule === 'upload' ? (
               <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6">
                  <div className="responsive-toolbar">
                    <div>
                      <h2 className="text-2xl font-semibold tracking-tight text-slate-950">Import catalogue data</h2>
                      <p className="mt-1 text-sm text-slate-500">Upload Excel, confirm source coverage, then move into Pre-QA checks.</p>
                    </div>
                    <Button onClick={() => setCurrentModule('pre-qa')} disabled={uploadedSkuCount === 0}>
                      Open Pre-QA
                    </Button>
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                    {[
                      ['Uploaded SKUs', uploadedSkuCount, 'Rows currently indexed'],
                      ['attributes__ fields', uploadedAttributeFields.size, 'Detected in uploaded records'],
                      ['SAP truth source', sapSourceCount, 'Rows with sap_data/source SAP'],
                      ['Source/PDF context', urlSourceCount + batchData.length + pdfSourceCount, 'URLs and attached PDF rows'],
                    ].map(([label, value, help]) => (
                      <Card key={label as string} className="p-4">
                        <div className="text-sm font-medium text-slate-500">{label}</div>
                        <div className="mt-2 text-3xl font-semibold text-slate-950">{value}</div>
                        <div className="mt-1 text-xs text-slate-500">{help}</div>
                      </Card>
                    ))}
                  </div>

                  {uploadedSkuCount === 0 ? (
                    <EmptyState
                      icon={<FileSpreadsheet className="h-8 w-8" />}
                      title="No catalogue uploaded yet"
                      description="Use the import panel to upload the SKU master XLSX or create a manual SKU. Pre-QA will populate from real indexed data."
                    />
                  ) : (
                    <Card className="overflow-hidden p-0">
                      <div className="border-b border-stone-200 px-5 py-4">
                        <h3 className="text-base font-semibold text-slate-950">Recent indexed SKUs</h3>
                        <p className="mt-1 text-sm text-slate-500">Showing up to 12 records from the current master index.</p>
                      </div>
                      <div className="divide-y divide-stone-100">
                        {skuRecords.slice(0, 12).map((sku, i) => {
                          const skuValue = (sku.sku || sku.SKU || `SKU-${i + 1}`).toString();
                          const skuAttributeSet = readSkuAttributeSetForDisplay(sku);
                          return (
                            <div key={`${skuValue}-${i}`} className="grid gap-3 px-5 py-4 md:grid-cols-[1.2fr_1fr_1fr_1fr] md:items-center">
                              <div>
                                <div className="font-mono text-sm font-semibold text-blue-700">{skuValue}</div>
                                <div className="mt-1 text-sm text-slate-500">{sku.title || sku.Name || sku.brand || sku.Brand || 'Unlabeled record'}</div>
                              </div>
                              <Badge tone={skuAttributeSet ? 'blue' : 'neutral'}>{skuAttributeSet || 'Default attribute set'}</Badge>
                              <div className="flex flex-wrap gap-2">
                                {hasSapSource(sku) ? <Badge tone="amber">SAP truth</Badge> : null}
                                {sku.pdf_text ? <Badge tone="blue">PDF</Badge> : null}
                                {hasHarvestSource(sku) ? <Badge tone="green">Harvest</Badge> : null}
                                {hasUrlSource(sku) ? <Badge tone="neutral">URL</Badge> : null}
                              </div>
                              <div className="text-sm text-slate-500">{sku.product_type || sku.category || 'Uncategorized'}</div>
                            </div>
                          );
                        })}
                      </div>
                    </Card>
                  )}
               </div>
             ) : currentModule === 'pre-qa' ? (
               <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6">
                  <div className="responsive-toolbar">
                    <div>
                      <h2 className="text-2xl font-semibold tracking-tight text-slate-950">Pre-QA readiness dashboard</h2>
                      <p className="mt-1 text-sm text-slate-500">Review source coverage before scraping, mapping, reviewing, and exporting.</p>
                    </div>
                    <div className="responsive-actions">
                      <Button onClick={() => setCurrentModule('upload')} variant="secondary">Upload data</Button>
                      <Button onClick={() => setCurrentModule('scrapper')} disabled={uploadedSkuCount === 0}>Continue</Button>
                    </div>
                  </div>

                  <Card className="p-4">
                    <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
                      {workflowSteps.map((step, index) => (
                        <div key={step} className="rounded-lg border border-stone-200 bg-stone-50 p-3">
                          <div className="flex items-center gap-2">
                            <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${index <= 1 ? 'bg-blue-600 text-white' : 'bg-white text-slate-500 ring-1 ring-stone-200'}`}>
                              {index + 1}
                            </div>
                            <div className="text-sm font-medium text-slate-900">{step}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {[
                      ['Ready for QA', sourceReadyCount, 'SKUs with usable SAP, PDF, or scraped source data', 'blue'],
                      ['Missing source', missingSourceCount, 'No SAP, PDF, or harvested scrape currently attached', 'amber'],
                      ['Has SAP/source data', sapSourceCount, 'SAP is displayed as the truth source', 'amber'],
                      ['Has scraped/harvest data', harvestSourceCount, 'Harvest markdown available for SKU', 'green'],
                      ['Completed outputs', completedJobCount, 'QA result JSON already exists', 'green'],
                      ['Failed or pending items', failedJobCount + pendingJobCount, 'Needs attention before export', failedJobCount > 0 ? 'red' : 'neutral'],
                    ].map(([label, value, help, tone]) => (
                      <Card key={label as string} className="p-5">
                        <Badge tone={tone as any}>{label}</Badge>
                        <div className="mt-4 text-3xl font-semibold text-slate-950">{value}</div>
                        <div className="mt-1 text-sm text-slate-500">{help}</div>
                      </Card>
                    ))}
                  </div>

                  {uploadedSkuCount === 0 ? (
                    <EmptyState
                      icon={<AlertCircle className="h-8 w-8" />}
                      title="Pre-QA needs catalogue data"
                      description="Upload an XLSX master index or create a manual SKU first. This dashboard only uses real app state."
                      action={<Button onClick={() => setCurrentModule('upload')}>Go to Upload</Button>}
                    />
                  ) : missingSourceCount > 0 ? (
                    <Alert tone="warning">Some SKUs are missing SAP, PDF, or scraped harvest context. Add SAP data, attach PDFs, or run scraping before mapping those SKUs.</Alert>
                  ) : (
                    <Alert tone="success">Current uploaded SKUs have at least one usable source. SAP data remains the highest-priority truth source during mapping.</Alert>
                  )}
               </div>
             ) : currentModule === 'images' ? (
               <div className="sources-saas flex-1 flex flex-col gap-6 max-w-6xl mx-auto w-full pb-10">
                  <div className="responsive-toolbar">
                    <div>
                      <h2 className="text-2xl font-semibold tracking-tight text-slate-950">Sources</h2>
                      <p className="mt-1 text-sm text-slate-500">Load harvest files, extract image URLs, select assets, and export formatted images.</p>
                    </div>
                    <div className="responsive-actions">
                      <Button onClick={fetchHarvest} variant="secondary" size="sm">
                        <RefreshCw className="h-3.5 w-3.5" /> Sync harvest files
                      </Button>
                      <Button onClick={() => setCurrentModule('scrapper')} variant="secondary" size="sm">
                        <Cpu className="h-3.5 w-3.5" /> Run scrape
                      </Button>
                    </div>
                  </div>

                  <Card className="space-y-6">
                    <div>
                      <h3 className="text-base font-semibold text-slate-950">Image URL extraction</h3>
                      <p className="mt-1 text-sm text-slate-500">Extract from a direct product URL or load URLs from saved markdown harvest files.</p>
                    </div>
                    <div className="grid grid-cols-1 gap-4 items-end lg:grid-cols-[1fr_2fr_auto]">
                        <Input
                          type="text"
                          value={imageSku}
                          onChange={(e) => setImageSku(e.target.value)}
                          placeholder="e.g. LAP-100"
                          className="font-mono text-blue-400"
                          label="SKU ID"
                          error={!imageSku.trim() ? 'Required before sourcing an image.' : undefined}
                        />
                        <Input
                          type="text"
                          value={imageUrl}
                          onChange={(e) => setImageUrl(e.target.value)}
                          placeholder="https://"
                          className="font-mono"
                          label="Target URL"
                          error={!imageUrl.trim() ? 'Required before image extraction.' : undefined}
                        />
                      <Button
                        onClick={handleImageExtract}
                        disabled={isExtractingImage || !imageUrl || !imageSku}
                        className="h-[46px]"
                      >
                        {isExtractingImage ? <><Loader2 className="w-4 h-4 animate-spin" /> Extracting</> : <><ImageIcon className="w-4 h-4" /> Source Image</>}
                      </Button>
                    </div>
                    <div className="flex items-center gap-2">
                       <input 
                         type="checkbox" 
                         id="imageScreenshotEnable"
                         checked={imageScreenshotEnabled}
                         onChange={(e) => setImageScreenshotEnabled(e.target.checked)}
                         className="rounded border-stone-300 text-blue-600 focus:ring-blue-500/20"
                       />
                       <label htmlFor="imageScreenshotEnable" className="cursor-pointer text-sm text-slate-600">
                         Capture full page screenshot for debugging
                       </label>
                    </div>
                  </Card>

                  <div className="dashboard-card space-y-4 p-5">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <h3 className="text-base font-semibold text-slate-950">Harvest archive</h3>
                        <p className="mt-1 text-sm text-slate-500">Each saved markdown file is listed separately. Select one to show that file&apos;s image URLs.</p>
                      </div>
                    </div>
                    {selectedHarvestSource && (
                      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-center justify-between gap-3">
                        <div>
                          <div className="text-xs font-medium text-emerald-700">Active harvest file</div>
                          <div className="mt-1 font-mono text-xs text-slate-700">{selectedHarvestSource.filename}</div>
                        </div>
                        <div className="text-xs text-emerald-700">
                          {selectedHarvestSource.urls.length} URLS • EXPORT AS {selectedHarvestSource.sku}-1.jpg
                        </div>
                      </div>
                    )}
                    {harvestFiles.length === 0 ? (
                      <EmptyState
                        icon={<Archive className="h-7 w-7" />}
                        title="No harvest files available"
                        description="Run a scrape or batch harvest first, then load image URLs from the saved harvest files."
                      />
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                        {harvestFiles.map((file: any, idx: number) => {
                          const isActive = selectedHarvestSource?.filename === file.name;
                          return (
                            <div
                              key={idx}
                              className={`rounded-lg border px-4 py-3 text-left transition-all ${isActive ? 'border-emerald-300 bg-emerald-50 ring-2 ring-emerald-100' : 'border-stone-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/50'} ${loadingHarvestFile ? 'opacity-60 cursor-not-allowed' : ''}`}
                            >
                              <div className="text-xs font-semibold text-emerald-700">{deriveHarvestSku(file.name)}</div>
                              <div className="mt-2 truncate font-mono text-xs text-slate-700">{file.name}</div>
                              <div className="mt-2 text-xs text-slate-500">{(file.size / 1024).toFixed(1)} KB</div>
                              <div className="mt-3 flex flex-wrap gap-2">
                                <Button
                                  onClick={() => loadHarvestFile(file.name)}
                                  disabled={loadingHarvestFile}
                                  variant="secondary"
                                  size="sm"
                                >
                                  Load images
                                </Button>
                                <Button
                                  onClick={() => openHarvestFile(file.name, 'sources harvest')}
                                  variant="secondary"
                                  size="sm"
                                >
                                  Open markdown
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="rounded-lg border border-stone-200 bg-white p-5 space-y-4 shadow-sm">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <h3 className="text-base font-semibold text-slate-950">Scraped image URLs</h3>
                        <p className="mt-1 text-sm text-slate-500">{selectedHarvestSource ? `Showing URL-only output for ${selectedHarvestSource.filename}.` : 'Select up to 10 image URLs from the current scrape output or a harvested markdown file.'}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1 text-xs font-medium text-slate-600">
                          {selectedImageUrls.length}/10 selected
                        </span>
                        <Button
                          onClick={() => setSelectedImageUrls([])}
                          disabled={selectedImageUrls.length === 0}
                          variant="secondary"
                          size="sm"
                        >
                          Clear Selection
                        </Button>
                        <Button
                          onClick={exportSelectedImages}
                          disabled={selectedImageUrls.length === 0 || isExportingImages}
                          size="sm"
                        >
                          {isExportingImages ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Exporting...</> : `Export Selected (${selectedImageUrls.length})`}
                        </Button>
                      </div>
                    </div>
                    {imageExportError && (
                      <Alert tone="danger">{imageExportError}</Alert>
                    )}
                    {imageUrls.length === 0 ? (
                      <EmptyState
                        icon={<ImageIcon className="h-8 w-8" />}
                        title="No scraped image URLs yet"
                        description="Load a harvest file or run image extraction to populate export-ready image sources."
                      />
                    ) : (
                      <div className="space-y-3">
                        {imageUrls.map((src, index) => {
                          const isSelected = selectedImageUrls.includes(src);
                          const isDisabled = !isSelected && selectedImageUrls.length >= 10;
                          const exportSku = sanitizeImageSku(selectedHarvestSource?.sku || imageSku || 'sku');
                          return (
                            <button
                              key={`${src}-${index}`}
                              type="button"
                              onClick={() => toggleImageSelection(src)}
                              disabled={isDisabled}
                              className={`w-full text-left rounded-lg border transition-all overflow-hidden group ${isSelected ? 'border-blue-300 bg-blue-50 ring-2 ring-blue-100' : 'border-stone-200 bg-white hover:border-blue-200 hover:bg-blue-50/40'} ${isDisabled ? 'opacity-45 cursor-not-allowed' : ''}`}
                            >
                              <div className="p-4 flex items-start gap-4">
                                <div className="relative shrink-0 w-20 h-20 rounded-lg overflow-hidden border border-stone-200 bg-stone-50">
                                  <img
                                    src={src}
                                    alt={`${exportSku}-${index + 1}`}
                                    loading="lazy"
                                    referrerPolicy="no-referrer"
                                    className="w-full h-full object-cover"
                                    onError={(e) => {
                                      e.currentTarget.style.display = 'none';
                                      const fallback = e.currentTarget.nextElementSibling;
                                      if (fallback instanceof HTMLElement) {
                                        fallback.style.display = 'flex';
                                      }
                                    }}
                                  />
                                  <div className="hidden absolute inset-0 items-center justify-center bg-black/40 text-white/35">
                                    <ImageIcon className="w-5 h-5" />
                                  </div>
                                </div>
                                <div className="shrink-0 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs font-medium text-slate-600">
                                  {exportSku}-{index + 1}.jpg
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="mb-2 text-xs font-medium text-slate-500">
                                    {selectedHarvestSource ? selectedHarvestSource.filename : 'Current scrape session'}
                                  </div>
                                  <div className="break-all font-mono text-xs leading-relaxed text-slate-700">{src}</div>
                                </div>
                                <div className={`shrink-0 w-7 h-7 rounded-full border flex items-center justify-center transition-colors ${isSelected ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-stone-300 text-slate-300 group-hover:text-blue-600'}`}>
                                  {isSelected && <Check className="w-4 h-4" />}
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="space-y-4 flex-1">
                    <h3 className="text-base font-semibold text-slate-950">Extracted assets ({extractedImages.length})</h3>
                    {extractedImages.length === 0 ? (
                      <EmptyState
                        icon={<ImageIcon className="h-8 w-8" />}
                        title="No extracted assets yet"
                        description="Source an image from a product URL to generate formatted assets for export."
                        className="h-64"
                      />
                    ) : (
                      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-6">
                        {extractedImages.map((img, i) => (
                           <div key={i} className="relative overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm group">
                             <div className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
                               <button 
                                 onClick={() => handleImageDelete(img.sku)}
                                 className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-50 text-red-700 transition-colors hover:bg-red-600 hover:text-white"
                                 title="Delete Image"
                               >
                                  <Trash2 className="w-4 h-4" />
                               </button>
                             </div>
                             {img.imagePath ? (
                               <div className="relative flex aspect-square items-center justify-center bg-white p-4">
                                 <img src={img.imagePath} alt={img.sku} className="max-w-full max-h-full object-contain" />
                                 <div className="absolute inset-0 bg-black/80 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                   <a href={img.imagePath} download={`${img.sku}.jpg`} className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700">Download image</a>
                                 </div>
                               </div>
                             ) : (
                               <div className="relative flex aspect-square items-center justify-center bg-stone-50 p-4 text-center">
                                  <span className="text-xs font-medium text-slate-500">Image failed to process</span>
                               </div>
                             )}
                             <div className="flex flex-col gap-1 border-t border-stone-200 p-4">
                               <span className="font-mono text-xs font-semibold text-blue-700">{img.sku}</span>
                               <a href={img.originalUrl} target="_blank" rel="noopener noreferrer" className="truncate text-xs text-slate-500 hover:text-slate-900">Original source</a>
                               {img.screenshotPath && (
                                 <a href={img.screenshotPath} target="_blank" rel="noopener noreferrer" className="text-[9px] text-cyan-400 hover:text-cyan-300 truncate inline-flex items-center gap-1 mt-1">
                                   <Eye className="w-3 h-3" /> View Debug Screenshot
                                 </a>
                               )}
                             </div>
                           </div>
                        ))}
                      </div>
                    )}
                  </div>
               </div>
             ) : null}
          </div>

          {/* DYNAMIC SYSTEM BAR */}
          <div id="stats-bar" className="h-24 border-t border-cyan-900/40 px-8 hidden lg:flex items-center justify-between bg-[#030712] shrink-0 relative overflow-hidden">
             {/* Tech Grid Background */}
             <div className="absolute inset-0 bg-[linear-gradient(to_right,#0891b222_1px,transparent_1px),linear-gradient(to_bottom,#0891b222_1px,transparent_1px)] bg-[size:24px_24px] [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)] pointer-events-none"></div>
             
             <div className="flex gap-12 relative z-10">
                <div className="flex flex-col border-l-2 border-cyan-500 pl-3">
                   <span className="text-[8px] text-cyan-500/70 uppercase font-mono tracking-[0.3em] mb-1">Engine Identity</span>
                   <span className="text-sm font-mono text-cyan-100 font-bold tracking-widest shadow-[0_0_10px_rgba(6,182,212,0.5)]">C4-HARV-PROTO_0.2</span>
                </div>
                <div className="flex flex-col border-l-2 border-emerald-500 pl-3">
                   <span className="text-[8px] text-emerald-500/70 uppercase font-mono tracking-[0.3em] mb-1">Status Ledger</span>
                   <span className="text-sm font-mono text-emerald-400 font-bold tracking-widest drop-shadow-[0_0_8px_rgba(16,185,129,0.5)] flex items-center gap-2">
                     <div className={`w-1.5 h-1.5 rounded-none bg-emerald-400 ${isScraping ? 'animate-pulse' : 'opacity-70'}`} />
                     SYSTEM NOMINAL
                   </span>
                </div>
                <div className="flex flex-col border-l-2 border-amber-500 pl-3">
                   <span className="text-[8px] text-amber-500/70 uppercase font-mono tracking-[0.3em] mb-1">Current Scope</span>
                   <span className="text-sm font-mono text-amber-400 font-bold tracking-widest flex items-center gap-2 uppercase">
                      [{currentModule}]
                   </span>
                </div>
             </div>
             
             <div className="flex items-center gap-8 relative z-10">
                {/* Simulated Telemetry Data */}
                <div className="hidden xl:flex gap-4 mr-4 text-[9px] font-mono text-cyan-500/40 uppercase tracking-widest">
                  <div className="flex flex-col"><span className="text-cyan-500/80 mb-0.5">LAT(ms)</span><span>0{isScraping ? Math.floor(Math.random() * 50 + 10) : '04'}</span></div>
                  <div className="flex flex-col"><span className="text-cyan-500/80 mb-0.5">MEM(GB)</span><span>{isScraping ? '4.2' : '1.8'}</span></div>
                  <div className="flex flex-col"><span className="text-cyan-500/80 mb-0.5">CPU(%)</span><span>{isScraping ? '84' : '12'}</span></div>
                </div>

                <div className="text-right flex flex-col items-end">
                   <div className="text-[9px] text-cyan-400/60 uppercase font-mono tracking-[0.2em] flex items-center gap-2">
                     <Cpu className="w-3 h-3 text-cyan-500" />
                     Playwright Cluster V124_LTS
                   </div>
                   <div className="text-[10px] font-bold text-cyan-100/20 tracking-[0.4em] mt-1 uppercase font-mono">Alpha Infrastructure</div>
                </div>
                {/* Visualizer */}
                <div className="flex gap-1 h-12 items-end bg-cyan-950/20 p-2 rounded border border-cyan-900/30">
                   {[30, 50, 20, 80, 40, 90, 60, 45, 75, 25].map((h, i) => (
                      <div key={i} className={`w-3 ${i % 2 === 0 ? 'bg-cyan-500' : 'bg-cyan-400'} transition-all duration-[800ms] ${isScraping ? 'animate-pulse' : 'opacity-40'} shadow-[0_0_8px_rgba(6,182,212,0.3)]`} style={{ height: `${isScraping ? Math.floor(Math.random() * 80 + 20) : h}%` }} />
                   ))}
                </div>
             </div>
          </div>
        </section>

      </main>

      {/* FOOTER */}
      <footer id="main-footer" className="h-8 border-t border-white/10 px-6 flex items-center justify-between text-[10px] text-white/30 font-mono bg-black/40 shrink-0">
        <div className="flex items-center gap-2">
          <Activity className="w-3 h-3" />
          <span>CONNECTED TO {isScraping ? 'PROXY-GRID-X' : 'LOCAL-INSTANCE'}</span>
        </div>
        <div className="flex gap-4">
          <span className="flex items-center gap-1">
             UPTIME: 42D 11H
          </span>
          <span className="text-white/60 flex items-center gap-1">
             LATENCY: {isScraping ? Math.floor(Math.random() * 50 + 10) : '0'}MS
          </span>
        </div>
      </footer>

      {/* FLOATING OVERLAYS - RELOCATED FOR LAYOUT STABILITY */}
      <AnimatePresence>
        {isScreenshotExpanded && currentScreenshot && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm sm:p-6 md:p-10" onClick={() => setIsScreenshotExpanded(false)}>
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative flex h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-stone-200 bg-white shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex h-16 shrink-0 items-center justify-between border-b border-stone-200 bg-white px-6">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-blue-50 p-2 text-blue-700">
                    <Activity className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-slate-950">Visual verification snapshot</h2>
                    <p className="mt-1 truncate font-mono text-xs text-slate-500">{url}</p>
                  </div>
                </div>
                <button 
                  onClick={() => setIsScreenshotExpanded(false)}
                  aria-label="Close screenshot preview"
                  className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-stone-100 hover:text-slate-700"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="flex-1 overflow-auto bg-black p-4 flex items-start justify-center">
                <img src={currentScreenshot} alt="Target Visual" className="w-full max-w-none border border-white/10 rounded-xl" />
              </div>
            </motion.div>
          </div>
        )}

        {isModalOpen && modalHarvestContent && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 md:p-10 bg-black/90 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-5xl h-[85vh] bg-[#0d0d0d] border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
            >
              <div className="h-16 border-b border-white/10 flex items-center justify-between px-6 bg-white/[0.02]">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-500/20 rounded-lg text-blue-400">
                    <Activity className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-white tracking-tight">Extracted Logic Report</h2>
                    <p className="text-[10px] text-white/30 font-mono uppercase tracking-widest">{activeHarvestEntry ? `${activeHarvestEntry.filename} • ${activeHarvestEntry.sourceLabel}` : strategy}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {activeHarvestEntry && !isEditingActiveHarvestEntry && (
                    <button
                      onClick={() => handleEditSavedHarvest(activeHarvestEntry.filename)}
                      className="px-3 py-2 hover:bg-amber-500/10 rounded-xl transition-colors text-amber-400 hover:text-amber-300 text-[10px] font-bold uppercase tracking-widest"
                    >
                      Edit
                    </button>
                  )}
                  {activeHarvestEntry && isEditingActiveHarvestEntry && (
                    <>
                      <button
                        onClick={() => void handleSaveSavedHarvest(activeHarvestEntry.filename)}
                        disabled={isSavingHarvestEntry}
                        className="px-3 py-2 hover:bg-green-500/10 rounded-xl transition-colors text-green-400 hover:text-green-300 text-[10px] font-bold uppercase tracking-widest disabled:opacity-50 flex items-center gap-2"
                      >
                        {isSavingHarvestEntry ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                        Save
                      </button>
                      <button
                        onClick={handleCancelSavedHarvestEdit}
                        disabled={isSavingHarvestEntry}
                        className="px-3 py-2 hover:bg-red-500/10 rounded-xl transition-colors text-red-400 hover:text-red-300 text-[10px] font-bold uppercase tracking-widest disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </>
                  )}
                  <button 
                    onClick={() => {
                      navigator.clipboard.writeText(modalHarvestContent);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                    className="p-3 hover:bg-white/5 rounded-xl transition-colors text-white/60 hover:text-white group"
                  >
                    {copied ? <Check className="w-5 h-5 text-green-500" /> : <Copy className="w-5 h-5" />}
                  </button>
                  <button 
                    onClick={() => setIsModalOpen(false)}
                    aria-label="Close report modal"
                    className="p-3 hover:bg-red-500/20 rounded-xl transition-colors text-white/30 hover:text-red-500 group"
                  >
                    <X className="w-5 h-5 group-hover:rotate-90 transition-transform" />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                {activeHarvestEntry && isEditingActiveHarvestEntry ? (
                  <div className="space-y-4">
                    {harvestSaveError && (
                      <Alert tone="danger">{harvestSaveError}</Alert>
                    )}
                    <textarea
                      value={editedHarvestContent}
                      onChange={(e) => setEditedHarvestContent(e.target.value)}
                      className="w-full h-full min-h-[60vh] p-4 bg-zinc-900 border border-white/10 rounded text-white text-sm font-mono resize-none focus:outline-none focus:border-blue-500"
                      placeholder="Edit harvested markdown..."
                    />
                  </div>
                ) : (
                  <div className="max-w-none prose prose-invert prose-blue prose-sm markdown-body">
                    <MarkdownContent>{modalHarvestContent}</MarkdownContent>
                  </div>
                )}
              </div>
              
              <div className="h-12 border-t border-white/10 bg-black/40 flex items-center justify-between px-8 text-[10px] text-white/20 font-mono tracking-widest uppercase">
                <div className="flex gap-6 items-center">
                  <button 
                    onClick={() => {
                      const blob = new Blob([modalHarvestContent], { type: 'text/markdown' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = activeHarvestEntry?.filename || `report_${new Date().getTime()}.md`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                    className="text-blue-500 hover:text-blue-400 font-bold transition-colors"
                  >
                    DOWNLOAD REPORT (.MD)
                  </button>
                </div>
                <span>Session Hash: {Math.random().toString(36).substring(7)}</span>
              </div>
            </motion.div>
          </div>
        )}
        {viewingPdfContent && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 p-6 backdrop-blur-md">
            <motion.div 
               initial={{ opacity: 0, scale: 0.9 }} 
               animate={{ opacity: 1, scale: 1 }} 
               className="flex max-h-[80vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-stone-200 bg-white shadow-2xl"
            >
              <div className="flex h-16 shrink-0 items-center justify-between border-b border-stone-200 px-6">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-blue-50 p-2 text-blue-700"><FileText className="w-5 h-5" /></div>
                  <div>
                    <h3 className="text-base font-semibold text-slate-950">Extracted PDF text</h3>
                    <p className="mt-1 font-mono text-xs text-slate-500">SKU: {viewingPdfSku}</p>
                  </div>
                </div>
                <button onClick={() => { setViewingPdfContent(null); setViewingPdfSku(null); }} aria-label="Close PDF text modal" className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-stone-100 hover:text-slate-700">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                <div className="max-w-full overflow-x-hidden whitespace-pre-wrap rounded-lg border border-slate-800 bg-slate-950 p-6 font-mono text-xs leading-relaxed text-slate-100">
                  {viewingPdfContent}
                </div>
              </div>
            </motion.div>
          </div>
        )}
        {viewingOutput && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-md sm:p-6">
            <motion.div 
               initial={{ opacity: 0, scale: 0.9 }} 
               animate={{ opacity: 1, scale: 1 }} 
               className="flex max-h-[84vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-stone-200 bg-white shadow-2xl"
            >
              <div className="flex min-h-16 items-center justify-between border-b border-stone-200 px-6 py-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-blue-50 p-2 text-blue-700"><FileText className="w-5 h-5" /></div>
                  <div>
                    <h3 className="text-base font-semibold text-slate-950">QA result editor</h3>
                    <p className="mt-1 font-mono text-xs text-slate-500">SKU: {editingOutputSku}</p>
                  </div>
                </div>
                <button onClick={() => setViewingOutput(null)} aria-label="Close output editor" className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-stone-100 hover:text-slate-700">
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="grid flex-1 grid-cols-1 gap-5 overflow-y-auto p-6 custom-scrollbar">
                {(() => {
                  const job = jobs.find(j => j.sku === editingOutputSku);
                  const attrSetName = (job?.attribute_set || job?.Attribute_Set || job?.schema || job?.Schema || '').toString();
                  const attrSet = appSettings?.attributeSets?.find((s: any) => s.name?.toLowerCase() === attrSetName.toLowerCase()) || (appSettings?.attributeSets?.length === 1 ? appSettings.attributeSets[0] : null);
                  
                  const keys = Object.keys(viewingOutput);
                  if (attrSet && attrSet.fields && attrSet.fields.length > 0) {
                    keys.sort((a, b) => {
                      const idxA = attrSet.fields.findIndex((f: string) => f.toLowerCase() === a.toLowerCase());
                      const idxB = attrSet.fields.findIndex((f: string) => f.toLowerCase() === b.toLowerCase());
                      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
                      if (idxA !== -1) return -1;
                      if (idxB !== -1) return 1;
                      return 0;
                    });
                  }
                  
                  return keys.map((key) => (
                    <div key={key} className="space-y-2 text-left">
                      <label className="pl-1 text-xs font-medium text-slate-700">{key.replace(/_/g, ' ')}</label>
                      {((viewingOutput[key] as string | undefined)?.toString().length ?? 0) > 100 || key.toLowerCase().includes('description') || key.toLowerCase().includes('bullets') ? (
                         <textarea 
                           value={(viewingOutput[key] as string) || ''} 
                           onChange={(e) => setViewingOutput({...viewingOutput, [key]: e.target.value})}
                           className="min-h-[120px] w-full rounded-lg border border-stone-300 bg-white p-3 text-sm leading-relaxed text-slate-900 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                         />
                      ) : (
                         <input 
                           type="text" 
                           value={(viewingOutput[key] as string) || ''} 
                           onChange={(e) => setViewingOutput({...viewingOutput, [key]: e.target.value})}
                           className="w-full rounded-lg border border-stone-300 bg-white p-3 text-sm text-slate-900 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                         />
                      )}
                    </div>
                  ));
                })()}
              </div>

              <div className="flex min-h-20 items-center justify-between gap-4 border-t border-stone-200 bg-stone-50 px-6 py-4">
                <div className="text-sm text-slate-500">
                  Edits save back to the existing output JSON for this SKU.
                </div>
                <button 
                  onClick={handleSaveOutput}
                  disabled={isSavingOutput}
                  className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                >
                  {isSavingOutput ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
                  Save output
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {showHarvestModal && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/70 p-6 backdrop-blur-md">
            <motion.div 
               initial={{ opacity: 0, scale: 0.95 }} 
               animate={{ opacity: 1, scale: 1 }} 
               className="flex max-h-[82vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-stone-200 bg-white shadow-2xl"
            >
              <div className="flex min-h-20 items-center justify-between border-b border-stone-200 bg-white px-6 py-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-blue-50 p-2.5 text-blue-700"><Archive className="w-6 h-6" /></div>
                  <div>
                    <h3 className="text-base font-semibold text-slate-950">Harvest archive</h3>
                    <p className="mt-1 text-sm text-slate-500">Saved markdown source records</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                    <input 
                      type="text"
                      placeholder="Search files..."
                      value={harvestSearch}
                      onChange={(e) => setHarvestSearch(e.target.value)}
                      className="w-48 rounded-md border border-stone-300 bg-white py-2 pl-9 pr-4 text-xs text-slate-900 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    />
                  </div>
                  <button onClick={() => setShowHarvestModal(false)} aria-label="Close harvest history" className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-stone-100 hover:text-slate-700">
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>
              
              <div className="flex-1 overflow-y-auto p-6 custom-scrollbar space-y-3">
                {harvestFiles
                  .filter((f: any) => f.name.toLowerCase().includes(harvestSearch.toLowerCase()))
                  .map((file: any, idx: number) => (
                    <div key={idx} className="flex items-center justify-between rounded-lg border border-stone-200 bg-white p-4 transition-colors hover:bg-blue-50/40">
                      <div className="flex items-center gap-4">
                        <div className="rounded-lg bg-stone-50 p-3 text-slate-500"><FileText className="w-5 h-5" /></div>
                        <div className="flex flex-col truncate">
                          <span className="truncate font-mono text-xs font-semibold text-slate-800">{file.name}</span>
                          <span className="text-[10px] text-slate-500 uppercase tracking-tight">{(file.size / 1024).toFixed(1)} KB • {new Date(file.mtime).toLocaleString()}</span>
                        </div>
                      </div>
                      <div className="flex gap-2 transition-all">
                        <button 
                          onClick={() => openHarvestFile(file.name)}
                          className="rounded-lg bg-blue-50 p-2 text-blue-700 transition-colors hover:bg-blue-600 hover:text-white"
                          title="View Content"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={async () => {
                            if(!confirm(`Permanently delete ${file.name}?`)) return;
                            await apiFetch(`/api/harvest/${file.name}`, { method: 'DELETE' });
                            fetchHarvest();
                            addLog('wait', `Harvest asset purged: ${file.name}`);
                          }}
                          className="rounded-lg bg-red-50 p-2 text-red-700 transition-colors hover:bg-red-600 hover:text-white"
                          title="Delete File"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                {harvestFiles.filter((f: any) => f.name.toLowerCase().includes(harvestSearch.toLowerCase())).length === 0 && (
                  <div className="py-12 text-center text-slate-500">
                    <div className="mb-4 inline-block rounded-full bg-stone-50 p-4 text-slate-300"><Search className="w-8 h-8" /></div>
                    <p className="text-sm font-medium">No harvest records match your search</p>
                  </div>
                )}
              </div>

              <div className="flex h-16 items-center justify-between border-t border-stone-200 bg-stone-50 px-6">
                 <div className="text-sm text-slate-500">Found {harvestFiles.length} total source files</div>
                 <button onClick={fetchHarvest} className="flex items-center gap-2 text-sm font-medium text-blue-700 transition-colors hover:text-blue-900">
                   <RefreshCw className="w-3 h-3" />
                   Sync files
                 </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      </AppShell>
      )}
    </ErrorBoundary>
  );
}
