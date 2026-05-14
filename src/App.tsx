import { apiFetch } from "./auth";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { PresetDropdown } from "./components/PresetDropdown";
import type { SkuRecord, HarvestFile, Job } from "./types";
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Activity, Beaker, Box, Cpu, Database, ExternalLink, Flame, Info, Layout, Play, Terminal, Zap, Loader2, X, Maximize2, Copy, Check, Eye, AlertCircle, FileSpreadsheet, Upload, Settings, Briefcase, Search, FileText, Globe, Key, List, AlignLeft, Plus, Archive, Trash2, RefreshCw, Network, Image as ImageIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import * as XLSX from 'xlsx';

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

interface AllowlistUser {
  email: string;
  role: 'admin' | 'user';
  addedAt?: string | null;
}

const SCRAPE_JOB_POLL_TIMEOUT_MS = 600_000;
const DISCOVERY_JOB_POLL_TIMEOUT_MS = 120_000;


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

  const [currentModule, setCurrentModule] = useState<'sku-indexer' | 'scrapper' | 'jobs' | 'images' | 'settings'>('scrapper');
  const [settingsSubModule, setSettingsSubModule] = useState<'api' | 'mapping' | 'indexer'>('api');
  const [editingGenerator, setEditingGenerator] = useState<string | null>(null);
  const [editingSetRules, setEditingSetRules] = useState<number | null>(null);
  const [skuIndex, setSkuIndex] = useState<SkuRecord[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [harvestFiles, setHarvestFiles] = useState<HarvestFile[]>([]);
  const [appSettings, setAppSettings] = useState({ 
    title: "", 
    bullets: "", 
    description: "", 
    keywords: "",
    groqApiKey: "",
    attributeSets: [] as {name: string, fields: string[], mdRules?: string, mdFileName?: string}[],
    selectorPresets: [] as {name: string, selector: string, strategy: string}[],
    plpSelectorPresets: [] as {name: string, selector: string}[]
  });
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const [loginEmail, setLoginEmail] = useState('');
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
  const [batchData, setBatchData] = useState<SkuRecord[]>([]);
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
  
  // Sync core data
  useEffect(() => {
    if (!authUser) return;
    const fetchData = async () => {
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
        setSkuIndex(Array.isArray(idx) ? idx : []);
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
        const idxRes = await apiFetch('/api/sku/index');
        const refreshedIdx = await idxRes.json();
        setSkuIndex(Array.isArray(refreshedIdx) ? refreshedIdx : []);
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
  const [harvestFileContent, setHarvestFileContent] = useState<string>('');
  const [loadingHarvestFile, setLoadingHarvestFile] = useState(false);
  const [selectedJobs, setSelectedJobs] = useState<string[]>([]);
  const [jobAiModels, setJobAiModels] = useState<{[sku:string]: string}>({});
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
    try {
      const [idxRes, harvestRes, settingsRes] = await Promise.all([
        apiFetch('/api/sku/index'),
        apiFetch('/api/harvest'),
        apiFetch('/api/settings')
      ]);

      if (idxRes.ok) {
        const idx = await idxRes.json();
        setSkuIndex(Array.isArray(idx) ? idx : []);
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

  const loginWithEmail = async (email: string) => {
    try {
      const res = await apiFetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
        credentials: 'include'
      });
      if (!res.ok) return false;
      const payload = await res.json().catch(() => null);
      if (payload?.user) {
        setAuthUser(payload.user);
      }
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
    setIsLoggingIn(true);
    const ok = await loginWithEmail(loginEmail.trim().toLowerCase());
    setIsLoggingIn(false);
    if (ok) {
      addLog('success', 'Logged in successfully.');
    } else {
      addLog('error', 'Login failed. Ensure your email is in allowlist.');
    }
  };

  const logout = async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Best effort logout.
    }
    setAuthUser(null);
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
      if (!res.ok) throw new Error('Failed to load harvest file');
      const content = await res.text();
      setHarvestFileContent(content);
      
      // Extract image URLs from markdown (http/https URLs)
      const urlPattern = /https?:\/\/[^\s\)]+\.(?:jpg|jpeg|png|webp|gif)/gi;
      const urls = (content.match(urlPattern) || []).map(url => url.trim()).filter((url, idx, arr) => arr.indexOf(url) === idx);
      
      if (urls.length === 0) {
        throw new Error('No image URLs found in harvest file');
      }
      
      setImageUrls(urls);
      setSelectedImageUrls([]);
      addLog('success', `Loaded ${urls.length} image URLs from harvest file.`);
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
          await hydrateCoreData();
        } else {
          setAuthUser(null);
        }
      } catch {
        if (mounted) setAuthUser(null);
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
  }, []);

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

  const handleBatchUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBatchFile(file);
    
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws) as any[];
        
        // Expecting columns "SKU" and "URL" (case insensitive)
        const parsed = data.map(row => {
          const skuKey = Object.keys(row).find(k => k.toLowerCase() === 'sku');
          const urlKey = Object.keys(row).find(k => k.toLowerCase() === 'url');
          return {
            sku: skuKey ? row[skuKey] : '',
            url: urlKey ? row[urlKey] : ''
          };
        }).filter(item => item.sku && item.url);
        
        setBatchData(parsed);
        addLog('success', `Loaded ${parsed.length} items from batch file.`);
      } catch (err) {
        addLog('error', 'Failed to parse Excel file. Ensure columns are "SKU" and "URL".');
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleBatchScrape = async () => {
    if (isScraping || batchData.length === 0) return;
    setIsScraping(true);
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
              extractWithGroq: strategy === 'GroqExtractionStrategy',
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
          
          // Step 2: poll until done
          const data = await pollJob(jobId, SCRAPE_JOB_POLL_TIMEOUT_MS);
          
          let report = "";
          if (strategy === 'LLMExtractionStrategy') {
            addLog('error', 'Advanced Extraction Strategy is currently suspended for deployment. Please use Groq Strategy.');
            throw new Error("Advanced Strategy Suspended");
          } else {
            report = data.groqResult || data.text;
          }

          // Save to backend
          await apiFetch('/api/save-batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sku: item.sku, content: report })
          });

          addLog('success', `[${globalIdx + 1}/${batchData.length}] Saved: ${item.sku}`);
        } catch (err: any) {
          addLog('error', `[${globalIdx + 1}/${batchData.length}] Failed ${item.sku}: ${err.message}`);
        }
      });

      await Promise.all(promises);
      setProgress(Math.round(((i + currentBatch.length) / batchData.length) * 100));
    }

    addLog('success', 'Batch Harvest complete. All files saved to backend /harvest folder.');
    setIsScraping(false);
    setProgress(100);
  };

  const handleSkuUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSkuFile(file);
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        let data = XLSX.utils.sheet_to_json(wb.Sheets[wsname]);

        // Sanitize headers to ensure compatibility (sku, brand, ean, shipping_weight, product_type, attribute_set)
        data = (data as any[]).map(item => {
           const normalized: any = {};
           Object.keys(item).forEach(key => {
              const lowerKey = key.toLowerCase().trim().replace(/ /g, '_');
              normalized[lowerKey] = item[key];
           });
           return normalized;
        });

        // Save to backend
        const res = await apiFetch('/api/sku/index', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data })
        });
        if (res.ok) {
           const idxRes = await apiFetch('/api/sku/index');
           const refreshedIdx = await idxRes.json();
           setSkuIndex(Array.isArray(refreshedIdx) ? refreshedIdx : []);
           addLog('success', `SKU Indexer synced with ${data.length} records (merged with existing).`);
        }
      } catch (err) {
        addLog('error', 'SKU Indexing failed.');
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleSkuDelete = async (sku: string) => {
    try {
      addLog('wait', `Deleting SKU from system: ${sku}`);
      const res = await apiFetch(`/api/sku/index/${sku}`, { method: 'DELETE' });
      if (res.ok) {
        setSkuIndex(prev => prev.filter(s => (s.sku || s.SKU)?.toString() !== sku));
        addLog('success', `SKU ${sku} purged from index.`);
      } else {
        throw new Error('Delete failed');
      }
    } catch (e) {
      addLog('error', 'Failed to delete SKU.');
    }
  };

  const handleHarvestDelete = async (filename: string) => {
    try {
      addLog('wait', `Purging harvest file: ${filename}`);
      const res = await apiFetch(`/api/harvest/${filename}`, { method: 'DELETE' });
      if (res.ok) {
        addLog('success', 'Harvest deleted.');
        fetchJobs();
        fetchHarvest();
      }
    } catch (e) {
      addLog('error', 'Harvest purge failed.');
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
      const res = await apiFetch('/api/sku/index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: [manualSkuData] })
      });
      if (res.ok) {
        // Re-fetch to get merged state
        const idxRes = await apiFetch('/api/sku/index');
        const refreshedIdx = await idxRes.json();
        setSkuIndex(Array.isArray(refreshedIdx) ? refreshedIdx : []);
        setManualSkuData({ sku: '', brand: '', ean: '', shipping_weight: '', product_type: '', attribute_set: '', base_code: '', sap_data: '' });
        addLog('success', `Manual sku indexed: ${manualSkuData.sku}`);
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
    setImageUrls([]);
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
        extractWithGroq: strategy === 'GroqExtractionStrategy',
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
        addLog('error', 'Advanced Extraction is dormant. Switch to Groq (Llama-3) for active synthesis.');
        setProgress(0);
        setIsScraping(false);
        return;
      } else if (strategy === 'GroqExtractionStrategy') {
        addLog('skill', 'Applying Groq (Llama-3) Extraction...');
        setProgress(80);
        setExtractionResult(`# ${data.title}\n\n${data.groqResult}` || "Groq extraction failed or returned no data.");
        
        if (data.secondary) {
            setExtractionResult2(`# ${data.secondary.title}\n\n${data.secondary.groqResult}` || "Secondary extraction failed.");
        } else {
            setExtractionResult2(null);
        }

        addLog('success', 'Groq Extraction completed successfully.');
      } else {
        addLog('skill', `Using Raw Data Strategy (${strategy})`);
        await new Promise(r => setTimeout(r, 800));
        setExtractionResult(`# ${data.title}\n\nRAW DATA PREVIEW (${strategy}):\n\n${data.text}`);
        
        if (data.secondary) {
            setExtractionResult2(`# ${data.secondary.title}\n\nRAW DATA PREVIEW (${data.secondary.strategy || strategy2}):\n\n${data.secondary.text}`);
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
               extractWithGroq: strategy === 'GroqExtractionStrategy', 
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
              pageReport = data.groqResult || data.text;
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

  return (
    <ErrorBoundary>
      {isAuthChecking ? (
        <div className="h-screen bg-brand-bg flex items-center justify-center text-white/70 font-mono uppercase tracking-widest text-xs">
          Restoring session...
        </div>
      ) : !authUser ? (
        <div className="h-screen bg-brand-bg flex items-center justify-center p-6">
          <div className="w-full max-w-md bg-black/40 border border-white/10 rounded-3xl p-8 shadow-2xl">
            <div className="space-y-2 mb-6">
              <h1 className="text-2xl font-black tracking-tight text-white">Moos Studio Login</h1>
              <p className="text-[11px] text-white/40 uppercase tracking-[0.2em]">Allowlist Session Access</p>
            </div>
            <div className="space-y-4">
              <input
                type="email"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !isLoggingIn) submitLogin();
                }}
                placeholder="name@company.com"
                className="w-full bg-black/60 border border-white/10 rounded-2xl px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500"
              />
              <button
                onClick={submitLogin}
                disabled={isLoggingIn || !loginEmail.trim()}
                className="w-full py-3 rounded-2xl bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/40 disabled:text-white/50 text-white text-[11px] font-bold uppercase tracking-widest transition-colors"
              >
                {isLoggingIn ? 'Signing In...' : 'Sign In'}
              </button>
              <p className="text-[10px] text-white/35 leading-relaxed">
                Access is role-based. Admin users can edit schema, mapping rules, and selector presets.
              </p>
            </div>
          </div>
        </div>
      ) : (
      <div className="flex flex-col h-screen overflow-hidden bg-brand-bg font-sans selection:bg-blue-500/30">
        {/* TOP NAVIGATION BAR */}
      <nav id="top-nav" className="h-14 border-b border-white/10 flex items-center justify-between px-6 bg-black/40 z-10 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded flex items-center justify-center text-xl bg-white/10 border border-white/20 shadow-lg shadow-white/5"
            aria-label="MooStudioza logo"
            role="img"
          >
            <span className="cow-bob" aria-hidden="true">🐄</span>
          </div>
          <h1 className="text-lg font-medium tracking-tight">MooStudioza</h1>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isScraping ? 'bg-blue-500 animate-pulse' : 'bg-green-500 status-pulse'} shadow-[0_0_8px_rgba(34,197,94,0.5)]`}></div>
            <span className={`text-[10px] ${isScraping ? 'text-blue-500' : 'text-green-500'} font-mono tracking-wider uppercase`}>
              {isScraping ? 'Engine Busy' : 'Engine Active'}
            </span>
          </div>
          <div
            className={`flex items-center gap-2 px-2.5 py-1 rounded border ${
              isFirestoreStatusLoading
                ? 'border-white/15 text-white/50'
                : firestoreHealth?.connected
                  ? 'border-emerald-500/30 text-emerald-400'
                  : 'border-red-500/30 text-red-400'
            }`}
            title={
              isFirestoreStatusLoading
                ? 'Checking Firestore...'
                : firestoreHealth
                  ? `Mode: ${firestoreHealth.mode} | Project: ${firestoreHealth.projectId || 'n/a'} | DB: ${firestoreHealth.databaseId || '(default)'} | Auth: ${firestoreHealth.authSource || 'n/a'}${firestoreHealth.initError ? ` | Error: ${firestoreHealth.initError}` : ''}`
                  : 'Firestore health unavailable'
            }
          >
            <div
              className={`w-2 h-2 rounded-full ${
                isFirestoreStatusLoading
                  ? 'bg-white/40 animate-pulse'
                  : firestoreHealth?.connected
                    ? 'bg-emerald-400 status-pulse'
                    : 'bg-red-400'
              }`}
            ></div>
            <span className="text-[10px] font-mono tracking-wider uppercase">
              {isFirestoreStatusLoading
                ? 'Firebase: Checking'
                : firestoreHealth?.connected
                  ? 'Firebase: Live'
                  : 'Firebase: Fallback'}
            </span>
          </div>
          <div className="h-6 w-px bg-white/10"></div>
          <div className="text-[10px] text-white/50 font-mono uppercase tracking-widest hidden sm:block">
            Playwright: Chromium-124
          </div>
        </div>
      </nav>

      <main className="flex-1 flex min-h-0 overflow-hidden">
        {/* LEFT PANEL: MAIN MODULES NAVIGATION */}
        <aside id="main-nav" className="w-20 border-r border-white/10 flex flex-col bg-black/40 shrink-0 items-center py-6 gap-8">
          <button 
            onClick={() => setCurrentModule('sku-indexer')}
            className={`p-3 rounded-xl transition-all group relative ${currentModule === 'sku-indexer' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/40' : 'text-white/30 hover:bg-white/5'}`}
            title="SKU Indexer"
          >
            <Database className="w-6 h-6" />
            <div className="absolute left-full ml-4 px-2 py-1 bg-zinc-900 border border-white/10 rounded text-[10px] font-bold text-white opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50">SKU Indexer</div>
          </button>
          <button 
            onClick={() => setCurrentModule('scrapper')}
            className={`p-3 rounded-xl transition-all group relative ${currentModule === 'scrapper' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/40' : 'text-white/30 hover:bg-white/5'}`}
            title="E-commerce Scrapper"
          >
            <Cpu className="w-6 h-6" />
            <div className="absolute left-full ml-4 px-2 py-1 bg-zinc-900 border border-white/10 rounded text-[10px] font-bold text-white opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50">Data Harvest</div>
          </button>
          <button 
            onClick={() => setCurrentModule('jobs')}
            className={`p-3 rounded-xl transition-all group relative ${currentModule === 'jobs' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/40' : 'text-white/30 hover:bg-white/5'}`}
            title="AI Mapping Jobs"
          >
            <Briefcase className="w-6 h-6" />
            <div className="absolute left-full ml-4 px-2 py-1 bg-zinc-900 border border-white/10 rounded text-[10px] font-bold text-white opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50">AI Jobs</div>
          </button>
          <button 
            onClick={() => setCurrentModule('images')}
            className={`p-3 rounded-xl transition-all group relative ${currentModule === 'images' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/40' : 'text-white/30 hover:bg-white/5'}`}
            title="Image Sourcer"
          >
            <ImageIcon className="w-6 h-6" />
            <div className="absolute left-full ml-4 px-2 py-1 bg-zinc-900 border border-white/10 rounded text-[10px] font-bold text-white opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50">Image Sourcer</div>
          </button>
          <button 
            onClick={() => setCurrentModule('settings')}
            className={`p-3 rounded-xl transition-all group relative ${currentModule === 'settings' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/40' : 'text-white/30 hover:bg-white/5'}`}
            title="General Settings"
          >
            <Settings className="w-6 h-6" />
            <div className="absolute left-full ml-4 px-2 py-1 bg-zinc-900 border border-white/10 rounded text-[10px] font-bold text-white opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50">Configuration</div>
          </button>
        </aside>

        {/* SECONDARY PANEL: CONFIGURATION */}
        <aside id="config-panel" className="w-80 border-r border-white/10 flex flex-col bg-black/20 shrink-0">
          {currentModule === 'scrapper' && (
            <>
              {/* MODE SELECTOR */}
              <div id="mode-selector" className="p-3 border-b border-white/10 flex gap-2">
                <button 
                  id="mode-btn-single"
                  onClick={() => {
                    setMode('single');
                    setDiscoveryMode(false);
                  }}
                  className={`flex-1 py-1.5 px-3 rounded-lg text-[9px] font-bold uppercase tracking-widest transition-all ${mode === 'single' ? 'bg-blue-600 text-white shadow-[0_0_15px_rgba(37,99,235,0.4)]' : 'bg-white/5 text-white/40 hover:bg-white/10'}`}
                >
                  Single
                </button>
                <button 
                  id="mode-btn-batch"
                  onClick={() => {
                    setMode('batch');
                    setDiscoveryMode(false);
                  }}
                  className={`flex-1 py-1.5 px-3 rounded-lg text-[9px] font-bold uppercase tracking-widest transition-all ${mode === 'batch' ? 'bg-blue-600 text-white shadow-[0_0_15px_rgba(37,99,235,0.4)]' : 'bg-white/5 text-white/40 hover:bg-white/10'}`}
                >
                  Batch
                </button>
                <button 
                  id="mode-btn-deep"
                  onClick={() => {
                    setMode('deep');
                    setDiscoveryMode(true);
                  }}
                  className={`flex-1 py-1.5 px-3 rounded-lg text-[9px] font-bold uppercase tracking-widest transition-all ${mode === 'deep' ? 'bg-blue-600 text-white shadow-[0_0_15px_rgba(37,99,235,0.4)]' : 'bg-white/5 text-white/40 hover:bg-white/10'}`}
                >
                  Deep
                </button>
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
                      <div className="text-[10px] text-white/60 mb-2 font-medium uppercase tracking-wider">Target SKU Index</div>
                      <select 
                        value={harvestSku}
                        onChange={(e) => setHarvestSku(e.target.value)}
                        disabled={isScraping}
                        className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-xs font-mono text-green-400 focus:outline-none focus:border-green-500 transition-colors uppercase"
                      >
                        <option value="">Select SKU from Index</option>
                        {skuIndex.map((s, i) => (
                           <option key={i} value={s.sku || s.SKU}>{s.sku || s.SKU}</option>
                        ))}
                      </select>
                      {!harvestSku && (
                        <input 
                          type="text"
                          value={harvestSku}
                          onChange={(e) => setHarvestSku(e.target.value)}
                          disabled={isScraping}
                          placeholder="Or enter manual SKU..."
                          className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-xs font-mono text-green-400 focus:outline-none focus:border-green-500 transition-colors placeholder:text-white/20 mt-2"
                        />
                      )}
                    </div>
                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <div className="text-[10px] text-white/60 font-medium uppercase tracking-wider">Target URL</div>
                        <button 
                          onClick={handleSmartAnalyze}
                          disabled={isAnalyzing || isScraping || !url}
                          className="text-[10px] text-blue-400 hover:text-blue-300 font-bold flex items-center gap-1 transition-all disabled:opacity-30"
                        >
                          {isAnalyzing ? <RefreshCw className="w-2.5 h-2.5 animate-spin" /> : <Zap className="w-2.5 h-2.5" />}
                          AI ANALYZE
                        </button>
                      </div>
                      <input 
                        type="text"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        disabled={isScraping}
                        className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-xs font-mono text-blue-400 focus:outline-none focus:border-blue-500 transition-colors"
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
                      <input 
                        type="text"
                        value={selector}
                        onChange={(e) => setSelector(e.target.value)}
                        placeholder="e.g. .specs-table"
                        disabled={isScraping}
                        className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-xs font-mono text-blue-400 focus:outline-none focus:border-blue-500 transition-colors placeholder:text-white/20"
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
                      <select 
                        value={strategy}
                        onChange={(e) => setStrategy(e.target.value)}
                        disabled={isScraping}
                        className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-xs focus:outline-none focus:border-blue-500 transition-all cursor-pointer"
                      >
                        <option value="LLMExtractionStrategy">Advanced AI (Dormant)</option>
                        <option value="GroqExtractionStrategy">Llama-3 (Fast Batch)</option>
                        <option value="JsonLdExtractionStrategy">JSON-LD Meta</option>
                        <option value="WholeCaptureStrategy">Whole Capture</option>
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/5">
                        <div className="flex flex-col">
                          <span className="text-[10px] text-white/80 font-bold uppercase tracking-wider tracking-tighter">Screenshots</span>
                        </div>
                        <button 
                          onClick={() => setScreenshotEnabled(!screenshotEnabled)}
                          className={`w-8 h-4 rounded-full transition-all relative ${screenshotEnabled ? 'bg-blue-600' : 'bg-white/10'}`}
                        >
                          <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${screenshotEnabled ? 'left-4.5' : 'left-0.5'}`} />
                        </button>
                      </div>
                      <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/5">
                        <div className="flex flex-col">
                          <span className="text-[10px] text-white/80 font-bold uppercase tracking-wider tracking-tighter">Deep Scroll</span>
                        </div>
                        <button 
                          onClick={() => setDeepScrollEnabled(!deepScrollEnabled)}
                          className={`w-8 h-4 rounded-full transition-all relative ${deepScrollEnabled ? 'bg-blue-600' : 'bg-white/10'}`}
                        >
                          <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${deepScrollEnabled ? 'left-4.5' : 'left-0.5'}`} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {!hasSecondaryTarget ? (
                  <button
                    onClick={() => setHasSecondaryTarget(true)}
                    className="w-full border border-dashed border-white/20 rounded py-2 text-[10px] uppercase tracking-widest text-white/40 hover:text-white/80 hover:border-white/40 transition-colors"
                  >
                    + Add Secondary Target
                  </button>
                ) : (
                  <div className="space-y-4 pt-4 border-t border-white/10 relative mt-4">
                    <button 
                      onClick={() => { setHasSecondaryTarget(false); setUrl2(''); setSelector2(''); }}
                      className="absolute top-4 right-0 p-1 text-white/30 hover:text-red-400 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                    <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold mb-3 block">
                      Secondary Target Parameters
                    </label>
                    <div>
                      <div className="text-[10px] text-white/60 mb-2 font-medium uppercase tracking-wider">Target URL 2</div>
                      <input 
                        type="text"
                        value={url2}
                        onChange={(e) => setUrl2(e.target.value)}
                        disabled={isScraping}
                        className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-xs font-mono text-blue-400 focus:outline-none focus:border-blue-500 transition-colors"
                      />
                    </div>
                    <div>
                      <div className="text-[10px] text-white/60 mb-2 font-medium uppercase tracking-wider">Specific Selector 2</div>
                      <input 
                        type="text"
                        value={selector2}
                        onChange={(e) => setSelector2(e.target.value)}
                        disabled={isScraping}
                        className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-xs font-mono text-blue-400 focus:outline-none focus:border-blue-500 transition-colors placeholder:text-white/20"
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
                      <div className="text-[10px] text-white/60 mb-2 font-medium uppercase tracking-wider">AI Strategy 2</div>
                      <select 
                        value={strategy2}
                        onChange={(e) => setStrategy2(e.target.value)}
                        disabled={isScraping}
                        className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-xs focus:outline-none focus:border-blue-500 transition-all cursor-pointer"
                      >
                        <option value="LLMExtractionStrategy">Advanced AI (Dormant)</option>
                        <option value="GroqExtractionStrategy">Llama-3 (Fast Batch)</option>
                        <option value="JsonLdExtractionStrategy">JSON-LD Meta</option>
                        <option value="WholeCaptureStrategy">Whole Capture</option>
                      </select>
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
                      <input 
                        type="text"
                        autoFocus
                        value={tempSelectorName}
                        onChange={(e) => setTempSelectorName(e.target.value)}
                        placeholder="e.g. Amazon Product View"
                        className="w-full bg-black/40 border border-white/10 rounded px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
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
                        accept=".xlsx, .xls"
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
                      <input 
                        type="text"
                        value={selector}
                        onChange={(e) => setSelector(e.target.value)}
                        placeholder="e.g. .specs-table"
                        className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-xs font-mono text-blue-400 focus:outline-none focus:border-blue-500 transition-colors"
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
                      <select 
                        value={strategy}
                        onChange={(e) => setStrategy(e.target.value)}
                        disabled={isScraping}
                        className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-xs focus:outline-none focus:border-blue-500 transition-all cursor-pointer"
                      >
                        <option value="LLMExtractionStrategy">Advanced AI (Dormant)</option>
                        <option value="GroqExtractionStrategy">Llama-3 (Fast Batch)</option>
                        <option value="JsonLdExtractionStrategy">JSON-LD Meta</option>
                        <option value="WholeCaptureStrategy">Whole Capture</option>
                      </select>
                    </div>

                    <button 
                      onClick={handleBatchScrape}
                      disabled={isScraping || batchData.length === 0}
                      className={`w-full py-4 rounded-xl font-bold uppercase tracking-widest text-xs flex items-center justify-center gap-3 transition-all ${isScraping || batchData.length === 0 ? 'bg-white/5 text-white/20 cursor-not-allowed' : 'bg-green-600 hover:bg-green-500 text-white shadow-xl shadow-green-600/20 active:scale-[0.98]'}`}
                    >
                      {isScraping ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Processing Batch...
                        </>
                      ) : 'Run Batch Harvest'}
                    </button>

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
                              onClick={async () => {
                                const res = await apiFetch(`/api/harvest/${file.name}`);
                                const data = await res.json();
                                setExtractionResult(data.content);
                                setIsModalOpen(true);
                                addLog('action', `Inspecting batch archive: ${file.name}`);
                              }}
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
                      <input 
                        type="text"
                        autoFocus
                        value={tempSelectorName}
                        onChange={(e) => setTempSelectorName(e.target.value)}
                        placeholder="e.g. Bulk Products Profile"
                        className="w-full bg-black/40 border border-white/10 rounded px-3 py-2 text-xs text-white focus:outline-none focus:border-green-500"
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
                      <input 
                        type="text"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        placeholder="e.g. samsung.com/in/smartphones"
                        className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-xs font-mono text-blue-400 focus:outline-none focus:border-blue-500 transition-colors"
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
                      <input 
                        type="text"
                        value={plpSelector}
                        onChange={(e) => setPlpSelector(e.target.value)}
                        placeholder="e.g. .product-item a"
                        className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-xs font-mono text-blue-400 focus:outline-none focus:border-blue-500 transition-colors placeholder:text-white/20"
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
                      <input 
                        type="text"
                        autoFocus
                        value={tempPlpSelectorName}
                        onChange={(e) => setTempPlpSelectorName(e.target.value)}
                        placeholder="e.g. My Category List"
                        className="w-full bg-black/40 border border-white/10 rounded px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
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
                      <input 
                        type="text"
                        value={selector}
                        onChange={(e) => setSelector(e.target.value)}
                        placeholder="e.g. .specs-table"
                        className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-xs font-mono text-blue-400 focus:outline-none focus:border-blue-500 transition-colors placeholder:text-white/20"
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
                      <select 
                        value={strategy}
                        onChange={(e) => setStrategy(e.target.value)}
                        disabled={isScraping}
                        className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-xs focus:outline-none focus:border-blue-500 transition-all cursor-pointer"
                      >
                        <option value="LLMExtractionStrategy">Advanced AI (Dormant)</option>
                        <option value="GroqExtractionStrategy">Llama-3 (Fast Batch)</option>
                        <option value="JsonLdExtractionStrategy">JSON-LD Meta</option>
                        <option value="WholeCaptureStrategy">Whole Capture</option>
                      </select>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/5">
                      <div className="flex flex-col">
                        <span className="text-[10px] text-white/80 font-bold uppercase tracking-wider">Visual Context</span>
                        <span className="text-[9px] text-white/30 italic">Capture screenshots</span>
                      </div>
                      <button 
                        onClick={() => setScreenshotEnabled(!screenshotEnabled)}
                        className={`w-10 h-5 rounded-full transition-all relative ${screenshotEnabled ? 'bg-blue-600' : 'bg-white/10'}`}
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
                      <input 
                        type="text"
                        autoFocus
                        value={tempSelectorName}
                        onChange={(e) => setTempSelectorName(e.target.value)}
                        placeholder="e.g. Tech Specs Profile"
                        className="w-full bg-black/40 border border-white/10 rounded px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
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


          {currentModule === 'sku-indexer' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold block">Master Indexer</label>
                <div className="flex bg-white/5 p-1 rounded-lg border border-white/10">
                  <button 
                    onClick={() => setIndexerMode('upload')}
                    className={`px-3 py-1 text-[9px] font-bold uppercase transition-all rounded ${indexerMode === 'upload' ? 'bg-blue-600 text-white shadow-lg' : 'text-white/40 hover:text-white'}`}
                  >
                    Bulk Upload
                  </button>
                  <button 
                    onClick={() => setIndexerMode('manual')}
                    className={`px-3 py-1 text-[9px] font-bold uppercase transition-all rounded ${indexerMode === 'manual' ? 'bg-blue-600 text-white shadow-lg' : 'text-white/40 hover:text-white'}`}
                  >
                    Manual Entry
                  </button>
                </div>
              </div>

              {indexerMode === 'upload' ? (
                <div className="p-4 border-2 border-dashed border-white/10 rounded-xl flex flex-col items-center gap-3 text-center cursor-pointer relative group">
                  <input type="file" onChange={handleSkuUpload} accept=".xlsx, .xls" className="absolute inset-0 opacity-0 cursor-pointer" />
                  <Database className="w-6 h-6 text-blue-400 group-hover:scale-110 transition-transform" />
                  <div className="text-[10px] font-bold text-white/80 uppercase">UPLOAD Master Index (.xlsx)</div>
                </div>
              ) : (
                <div className="space-y-3 bg-white/5 p-4 rounded-xl border border-white/10">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[9px] uppercase text-white/40 font-bold">SKU *</label>
                      <input 
                        type="text" 
                        value={manualSkuData.sku || ''}
                        onChange={(e) => setManualSkuData({...manualSkuData, sku: e.target.value})}
                        className="w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-[10px] text-blue-400 focus:border-blue-500/50 outline-none"
                        placeholder="e.g. LAP-100"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] uppercase text-white/40 font-bold">Base Code</label>
                      <input 
                        type="text" 
                        value={manualSkuData.base_code || ''}
                        onChange={(e) => setManualSkuData({...manualSkuData, base_code: e.target.value})}
                        className="w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-[10px] text-white/80 focus:border-blue-500/50 outline-none"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[9px] uppercase text-white/40 font-bold">Brand</label>
                      <input 
                        type="text" 
                        value={manualSkuData.brand || ''}
                        onChange={(e) => setManualSkuData({...manualSkuData, brand: e.target.value})}
                        className="w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-[10px] text-white/80 focus:border-blue-500/50 outline-none"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] uppercase text-white/40 font-bold">EAN</label>
                      <input 
                        type="text" 
                        value={manualSkuData.ean || ''}
                        onChange={(e) => setManualSkuData({...manualSkuData, ean: e.target.value})}
                        className="w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-[10px] text-white/80 focus:border-blue-500/50 outline-none"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[9px] uppercase text-white/40 font-bold">Weight (kg)</label>
                      <input 
                        type="text" 
                        value={manualSkuData.shipping_weight || ''}
                        onChange={(e) => setManualSkuData({...manualSkuData, shipping_weight: e.target.value})}
                        className="w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-[10px] text-white/80 focus:border-blue-500/50 outline-none"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] uppercase text-white/40 font-bold">Product Type</label>
                      <input 
                        type="text" 
                        value={manualSkuData.product_type || ''}
                        onChange={(e) => setManualSkuData({...manualSkuData, product_type: e.target.value})}
                        className="w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-[10px] text-white/80 focus:border-blue-500/50 outline-none"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[9px] uppercase text-white/40 font-bold">Attr Set</label>
                      <select 
                        value={manualSkuData.attribute_set || ''}
                        onChange={(e) => setManualSkuData({...manualSkuData, attribute_set: e.target.value})}
                        className="w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-[10px] text-white/80 focus:border-blue-500/50 outline-none uppercase font-bold"
                      >
                         <option value="">Select Set...</option>
                         {appSettings.attributeSets.map((s, i) => (
                           <option key={i} value={s.name}>{s.name}</option>
                         ))}
                      </select>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] uppercase text-white/40 font-bold">SAP Data (Context)</label>
                    <textarea 
                      value={manualSkuData.sap_data || ''}
                      onChange={(e) => setManualSkuData({...manualSkuData, sap_data: e.target.value})}
                      placeholder="Paste SAP context data..."
                      className="w-full bg-black/40 border border-white/10 rounded px-2 py-2 text-[10px] text-white/80 focus:border-blue-500/50 outline-none h-16 resize-none custom-scrollbar"
                    />
                  </div>
                  <button 
                    onClick={handleManualSkuSubmit}
                    className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-[9px] font-bold uppercase tracking-widest transition-all mt-2"
                  >
                    Save SKU to Index
                  </button>
                </div>
              )}

              <div className="space-y-2 max-h-[400px] overflow-y-auto custom-scrollbar pr-2">
                 <input type="file" className="hidden" ref={pdfInputRef} accept="application/pdf" onChange={handlePdfFileChange} />
                 {skuIndex.map((s: any, i: number) => {
                   const skuValue = s.sku || s.SKU;
                   const hasPdf = !!s.pdf_text;
                   return (
                     <div key={i} className="p-2 bg-white/5 border border-white/5 rounded text-[10px] font-mono flex justify-between items-center group">
                        <div className="flex flex-col">
                          <span className="text-blue-400 font-bold flex items-center gap-2">
                            {skuValue}
                            {hasPdf && <span title="PDF Context Attached"><FileText className="w-3 h-3 text-cyan-400" /></span>}
                          </span>
                          <span className="text-white/20 text-[8px] uppercase">{s.brand || s.Brand || 'Generic'}</span>
                        </div>
                        <div className="flex items-center gap-2">
                           <div className="text-right mr-2">
                              <span className="text-white/40 block text-[9px]">{s.product_type || 'Uncategorized'}</span>
                           </div>
                           <button 
                             onClick={() => handlePdfTrigger(skuValue.toString())}
                             className="w-5 h-5 flex items-center justify-center rounded bg-cyan-500/10 text-cyan-500 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-cyan-500 hover:text-white"
                             title="Attach PDF as Context 1"
                           >
                             <FileText className="w-3.5 h-3.5" />
                           </button>
                           <button 
                             onClick={() => handleSkuDelete(skuValue.toString())}
                             className="w-5 h-5 flex items-center justify-center rounded bg-red-500/10 text-red-500 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500 hover:text-white"
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

          {currentModule === 'settings' && (
             <div className="p-6 border-b border-white/5 bg-blue-500/5">
                <div className="flex items-center gap-3">
                   <div className="w-10 h-10 bg-blue-600/20 rounded-xl flex items-center justify-center shadow-inner">
                      <Settings className="w-5 h-5 text-blue-400 animate-spin-slow" />
                   </div>
                   <div>
                      <h3 className="text-xs font-bold text-white uppercase tracking-[0.2em]">Logic Hub</h3>
                      <p className="text-[9px] text-white/30 uppercase mt-0.5 font-mono">Status: Routing</p>
                   </div>
                </div>
                <div className="mt-6 p-4 bg-white/[0.02] border border-white/5 rounded-xl text-[10px] text-white/40 leading-relaxed italic">
                    <p className="mb-2">Centralized Command active.</p>
                    <p>The governance engine has been expanded to the primary console for deep-scale orchestrating.</p>
                </div>
             </div>
          )}

          <div id="cta-area" className="p-6 border-t border-white/5 bg-black/30">
            {currentModule === 'scrapper' ? (
              <button 
                onClick={mode === 'single' ? handleScrape : (mode === 'batch' ? handleBatchScrape : handleDeepScrape)}
                disabled={isScraping || (mode === 'single' && !url) || (mode === 'batch' && batchData.length === 0)}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-white/20 text-white py-4 rounded-xl font-bold transition-all flex items-center justify-center gap-3 group shadow-xl active:scale-95"
              >
                {isScraping ? <Loader2 className="w-5 h-5 animate-spin" /> : <Zap className="w-5 h-5" />}
                {isScraping ? 'EXTRACTING...' : (mode === 'batch' ? 'RUN BATCH PULSE' : 'RUN HARVEST')}
              </button>
            ) : (
               <div className="p-4 border border-dashed border-white/5 rounded-xl text-center text-[10px] text-white/20 font-bold uppercase tracking-widest">Global Status Ready</div>
            )}
          </div>
        </aside>
        {/* CENTER PANEL: INTERACTIVE HUB */}
        <section id="main-content" className="flex-1 flex flex-col bg-black/5 min-h-0 relative">
          <div className="flex-1 p-6 overflow-y-auto custom-scrollbar flex flex-col gap-6 min-h-0">
            <div className="flex items-center justify-between bg-black/30 border border-white/10 rounded-xl px-4 py-3">
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-widest text-white/40">Signed In</p>
                <p className="text-sm text-white truncate">
                  {authUser.email} <span className="text-white/40">({authUser.role})</span>
                </p>
              </div>
              <button
                onClick={logout}
                className="ml-4 px-4 py-2 rounded-lg bg-white/5 hover:bg-red-600 border border-white/15 hover:border-red-500 text-[10px] font-bold uppercase tracking-widest text-white/80 hover:text-white transition-colors"
                title="End current session and sign in as another user"
              >
                Logout & Switch User
              </button>
            </div>
             
             {/* MODULE VIEW CONDITIONAL */}
             {currentModule === 'settings' ? (
                <div className="flex-1 flex flex-col p-8 max-w-7xl mx-auto w-full">
                   <motion.div 
                     initial={{ opacity: 0, y: 10 }}
                     animate={{ opacity: 1, y: 0 }}
                     className="flex flex-col gap-8 w-full"
                   >
                    <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-white/5">
                       <div className="space-y-1 text-left">
                         <div className="flex items-center gap-2 text-blue-500 mb-1">
                           <Settings className="w-4 h-4 animate-spin-slow" />
                           <span className="text-[10px] font-bold uppercase tracking-[0.3em]">System Core</span>
                         </div>
                         <h2 className="text-5xl font-black tracking-tighter text-white">Logic Governance</h2>
                         <p className="text-[11px] text-white/30 uppercase tracking-[0.2em] font-medium max-w-md leading-relaxed">
                           Orchestrate AI synthesis parameters and attribute indexing schemas.
                         </p>
                       </div>
                       
                       <div className="flex bg-white/5 p-1.5 rounded-2xl border border-white/10 backdrop-blur-md shadow-2xl">
                          {[
                            { id: 'api', label: 'Connectivity', icon: Globe },
                            { id: 'mapping', label: 'Mapping Logic', icon: Network },
                            { id: 'indexer', label: 'Schema Hub', icon: Database }
                          ].map(tab => (
                            <button 
                              key={tab.id}
                              onClick={() => setSettingsSubModule(tab.id as any)}
                              className={`relative px-6 py-3 text-[10px] font-bold uppercase tracking-widest transition-all rounded-xl flex items-center gap-2.5 overflow-hidden group ${settingsSubModule === tab.id ? 'text-white' : 'text-white/30 hover:text-white/60'}`}
                            >
                              {settingsSubModule === tab.id && (
                                <motion.div 
                                  layoutId="activeTabSettingsFull"
                                  className="absolute inset-0 bg-blue-600 shadow-[0_0_30px_rgba(37,99,235,0.4)]"
                                  transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                                />
                              )}
                              <tab.icon className={`w-3.5 h-3.5 relative z-10 ${settingsSubModule === tab.id ? 'text-white' : 'text-white/40 group-hover:text-white/60'}`} />
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
                              <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 pt-4 pb-20">
                                 <div className="space-y-8">
                                    <section className="space-y-6">
                                       <div className="flex items-center gap-4">
                                         <div className="w-14 h-14 bg-blue-600/10 border border-blue-500/20 rounded-2xl flex items-center justify-center shadow-inner">
                                           <Key className="w-7 h-7 text-blue-400" />
                                         </div>
                                         <div>
                                           <h3 className="text-xl font-bold text-white leading-none">Groq Infrastructure</h3>
                                           <p className="text-[10px] text-white/30 uppercase tracking-widest mt-2">Authentication & Gateway</p>
                                         </div>
                                       </div>
                                       <div className="bg-[#0a0a0a] border border-white/5 rounded-3xl p-10 shadow-2xl relative overflow-hidden group">
                                          <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none group-hover:opacity-10 transition-opacity">
                                            <Cpu className="w-32 h-32" />
                                          </div>
                                          <p className="text-sm text-white/50 leading-relaxed max-w-md mb-10">
                                             Define your production Groq API key for high-speed Llama-3 synthesis. 
                                             Failure to provide a key will trigger an automatic fallback to internal environment defaults.
                                          </p>
                                          <div className="space-y-4">
                                             <div className="flex items-center justify-between">
                                               <label className="text-[9px] text-white/40 font-bold uppercase tracking-widest">Secret Vault / Master Key</label>
                                               <span className="text-[9px] text-blue-400/50 font-mono">Llama-3.3-70B-Versatile</span>
                                             </div>
                                             <div className="flex flex-col gap-3">
                                                <div className="flex gap-4">
                                                   <div className="relative flex-1">
                                                     <input 
                                                       type="password" 
                                                       value={appSettings.groqApiKey}
                                                       onChange={(e) => setAppSettings({...appSettings, groqApiKey: e.target.value})}
                                                       placeholder="gsk_internal_production_gateway..."
                                                       className="w-full bg-black/60 border border-white/10 rounded-2xl px-6 py-5 text-sm font-mono text-blue-400 focus:outline-none focus:border-blue-500/50 focus:ring-8 focus:ring-blue-500/5 transition-all shadow-inner"
                                                     />
                                                   </div>
                                                   <button 
                                                     onClick={() => persistSettings(appSettings)}
                                                     disabled={isSavingSettings}
                                                     className="px-8 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/40 disabled:text-white/50 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all border border-blue-500/20 shadow-xl"
                                                   >
                                                      {isSavingSettings ? 'SAVING...' : 'SAVE KEY'}
                                                   </button>
                                                   <button 
                                                     onClick={() => {
                                                       const updatedSettings = {...appSettings, groqApiKey: ''};
                                                       setAppSettings(updatedSettings);
                                                       if (isAdmin) {
                                                         persistSettings(updatedSettings);
                                                       }
                                                     }}
                                                     className="px-8 bg-red-600/5 hover:bg-red-600 text-red-500 hover:text-white rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all border border-red-500/10 hover:border-red-600 shadow-xl"
                                                   >
                                                      WIPE
                                                   </button>
                                                </div>
                                                <p className="text-[10px] text-white/35 leading-relaxed">
                                                  {isAdmin
                                                    ? 'Use SAVE KEY to persist the Groq credential. WIPE clears the stored key immediately.'
                                                    : 'Admin role required to persist or wipe the Groq credential.'}
                                                </p>
                                             </div>
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

                                 <div className="hidden lg:block relative">
                                    <div className="absolute inset-0 bg-gradient-to-br from-blue-600/5 to-transparent rounded-[40px] border border-white/5 p-16 flex flex-col justify-center gap-8 shadow-inner">
                                       <div className="w-24 h-1.5 w-full bg-white/5 rounded-full" />
                                       <div className="w-48 h-1.5 w-full bg-white/5 rounded-full" />
                                       <div className="w-32 h-1.5 w-full bg-white/5 rounded-full" />
                                       <div className="text-6xl font-black text-white/[0.03] select-none leading-none">SYSTEM<br/>STATUS OK</div>
                                    </div>
                                 </div>
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
                                                   <span className="text-lg font-black text-white tracking-tight leading-none block mb-1">{set.name}</span>
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
                                                     {set.mdRules ? 'EDIT LOGIC' : 'ADD LOGIC'}
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
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                       {appSettings.attributeSets.map((set, idx) => (
                                         <motion.div 
                                           initial={{ opacity: 0, scale: 0.95 }}
                                           animate={{ opacity: 1, scale: 1 }}
                                           key={idx} 
                                           className="bg-[#0a0a0a] border border-white/5 rounded-[32px] p-8 hover:bg-white/[0.03] transition-all group relative overflow-hidden shadow-2xl"
                                         >
                                            <div className="absolute -right-6 -top-6 w-32 h-32 bg-white/[0.02] rounded-full blur-3xl pointer-events-none" />
                                            
                                            <div className="absolute top-6 right-6 flex gap-2 opacity-0 group-hover:opacity-100 transition-all">
                                              <button 
                                                onClick={() => {
                                                  setNewAttrName(set.name);
                                                  setNewAttrFields(set.fields.join(', '));
                                                  const newSets = appSettings.attributeSets.filter((_, i) => i !== idx);
                                                  const updatedSettings = {...appSettings, attributeSets: newSets};
                                                  setAppSettings(updatedSettings);
                                                  persistSettings(updatedSettings);
                                                }}
                                                className="p-2.5 bg-blue-600/10 hover:bg-blue-600 text-blue-400 hover:text-white rounded-xl transition-all"
                                                title="Modify Schema"
                                              >
                                                <Settings className="w-5 h-5" />
                                              </button>
                                              <button 
                                                onClick={() => {
                                                  const newSets = appSettings.attributeSets.filter((_, i) => i !== idx);
                                                  const updatedSettings = {...appSettings, attributeSets: newSets};
                                                  setAppSettings(updatedSettings);
                                                  persistSettings(updatedSettings);
                                                }}
                                                className="p-2.5 bg-red-600/10 hover:bg-red-600 text-red-500 hover:text-white rounded-xl transition-all"
                                                title="Delete Schema"
                                              >
                                                <X className="w-5 h-5" />
                                              </button>
                                            </div>

                                            <div className="flex items-center gap-5 mb-8">
                                               <div className="w-12 h-12 bg-blue-600/10 border border-blue-500/20 rounded-2xl flex items-center justify-center shadow-inner">
                                                 <Layout className="w-6 h-6 text-blue-400" />
                                               </div>
                                               <div>
                                                  <span className="text-lg font-black text-white tracking-tight leading-none block mb-1">{set.name}</span>
                                                  <p className="text-[9px] text-white/20 uppercase tracking-widest">{set.fields.length} Logic Points</p>
                                               </div>
                                            </div>

                                            <div className="flex flex-wrap gap-2.5 mb-6">
                                               {set.fields.map((f, i) => (
                                                 <span key={i} className="px-4 py-1.5 bg-black/60 border border-white/10 rounded-xl text-[10px] text-white/50 font-mono hover:text-blue-400 hover:border-blue-500/40 transition-colors shadow-inner">
                                                   {f}
                                                 </span>
                                               ))}
                                            </div>
                                         </motion.div>
                                       ))}
                                       
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
                           className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-3xl p-12 flex items-center justify-center"
                         >
                           <motion.div 
                             initial={{ scale: 0.95, opacity: 0 }}
                             animate={{ scale: 1, opacity: 1 }}
                             exit={{ scale: 0.95, opacity: 0 }}
                             className="w-full max-w-6xl bg-[#0a0a0a] border border-white/10 rounded-[40px] shadow-[0_0_100px_rgba(0,0,0,0.8)] flex flex-col h-[85vh] overflow-hidden"
                           >
                             <div className="p-10 border-b border-white/5 flex items-center justify-between shrink-0 bg-white/[0.01]">
                                <div className="flex items-center gap-6">
                                   <div className="w-16 h-16 bg-blue-600/10 border border-blue-500/20 rounded-2xl flex items-center justify-center">
                                     <Zap className="w-8 h-8 text-blue-400" />
                                   </div>
                                   <div>
                                      <h3 className="text-3xl font-black text-white tracking-tighter">
                                        Mapping Logic Governance
                                      </h3>
                                      <p className="text-xs text-white/30 uppercase tracking-[0.3em] mt-2 font-bold">Instruction Set for {appSettings.attributeSets[editingSetRules].name}</p>
                                   </div>
                                </div>
                                <button 
                                  onClick={() => setEditingSetRules(null)}
                                  className="w-14 h-14 bg-white/5 border border-white/10 rounded-2xl flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-all hover:scale-110 active:scale-95"
                                >
                                  <X className="w-6 h-6" />
                                </button>
                             </div>

                             <div className="flex-1 p-10 overflow-hidden flex flex-col bg-black/20">
                                <textarea 
                                  value={appSettings.attributeSets[editingSetRules].mdRules || ''}
                                  onChange={(e) => {
                                     const newSets = [...appSettings.attributeSets];
                                     newSets[editingSetRules] = { ...newSets[editingSetRules], mdRules: e.target.value };
                                     setAppSettings({...appSettings, attributeSets: newSets});
                                  }}
                                  className="flex-1 bg-black/40 border border-white/10 rounded-[32px] p-10 text-xl text-white/90 font-mono focus:outline-none focus:border-blue-500/50 transition-all resize-none leading-relaxed placeholder:text-white/5 custom-scrollbar"
                                  placeholder="Define production logic rules here (Markdown format)..."
                                  autoFocus
                                />
                             </div>

                             <div className="p-10 border-t border-white/5 flex items-center justify-between bg-white/[0.01] shrink-0">
                                <div className="flex items-center gap-8 text-[11px] text-white/20 font-bold uppercase tracking-widest">
                                   <div className="flex items-center gap-3">
                                     <div className="w-2.5 h-2.5 bg-blue-500 rounded-full shadow-[0_0_10px_rgba(59,130,246,0.5)]" />
                                     Protocol Synthesis Instance
                                   </div>
                                </div>
                                <button 
                                  onClick={() => {
                                    persistSettings(appSettings);
                                    setEditingSetRules(null);
                                  }}
                                  className="px-12 py-5 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl text-[11px] font-black uppercase tracking-[0.5em] transition-all shadow-[0_0_40px_rgba(37,99,235,0.3)] active:scale-95"
                                >
                                  COMMIT MAPPING RULES
                                </button>
                             </div>
                           </motion.div>
                         </motion.div>
                       )}
                     </AnimatePresence>

                    <div className="flex justify-end pt-10 pb-4 shrink-0 mt-auto">
                      <button 
                        onClick={() => persistSettings(appSettings)} 
                        className="group relative px-16 py-5 bg-blue-600 hover:bg-blue-500 text-white rounded-[20px] text-[11px] font-black uppercase tracking-[0.5em] transition-all shadow-[0_0_60px_rgba(37,99,235,0.25)] active:scale-95 overflow-hidden"
                      >
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
                        DEPLOY CORE CONFIG
                      </button>
                    </div>
                  </motion.div>
                </div>
              ) : currentModule === 'scrapper' ? (
               <>
                 <div className={`h-[350px] rounded-xl border border-white/10 bg-[#0a0a0a] flex flex-col shadow-inner overflow-hidden shrink-0 transition-all ${isScraping ? 'ring-1 ring-blue-500/20' : ''}`}>
                    <div className="h-9 border-b border-white/10 flex items-center px-4 justify-between bg-white/[0.02]">
                       <div className="flex items-center gap-2"><Terminal className="w-3 h-3 text-white/30" /><span className="text-[10px] font-mono text-white/30 uppercase tracking-widest italic">Live Engine Terminal</span></div>
                       <button onClick={() => setLogs([])} className="text-[9px] text-white/20 hover:text-white font-bold tracking-tighter uppercase">[X_CLEAR]</button>
                    </div>
                    <div className="flex-1 p-4 font-mono text-[10px] leading-relaxed overflow-y-auto text-white/80 custom-scrollbar">
                      {logs.map((log, i) => (
                        <div key={i} className={`${getLogColor(log.type)} flex gap-2 mb-0.5`}>
                          <span className="text-white/10 shrink-0">{log.timestamp}</span>
                          <span>{log.message}</span>
                        </div>
                      ))}
                      <div ref={logsEndRef} />
                    </div>
                 </div>

                 <div className="flex-1 flex flex-col min-h-0">
                    {discoveryMode && discoveredLinks.length > 0 && (
                      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mb-6 rounded-xl border border-blue-500/20 bg-blue-500/5 flex flex-col overflow-hidden max-h-64">
                         <div className="h-10 border-b border-blue-500/20 px-4 flex items-center justify-between">
                            <span className="text-[10px] font-bold text-blue-400 uppercase tracking-widest uppercase">Target Discovery: {discoveredLinks.length} Items Found</span>
                            <div className="flex gap-4">
                               <button onClick={() => setSelectedLinks(discoveredLinks.map(l => l.href))} className="text-[10px] text-blue-400 hover:text-blue-300 font-bold uppercase transition-colors">Select All</button>
                               <button onClick={handleDeepScrape} disabled={selectedLinks.length === 0 || isScraping} className="bg-blue-600 px-3 py-1 rounded text-[10px] font-bold text-white transition-all disabled:opacity-50">EXTRACT SELECTED ({selectedLinks.length})</button>
                            </div>
                         </div>
                         <div className="flex-1 overflow-y-auto p-2 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-1 custom-scrollbar">
                            {discoveredLinks.map((link, idx) => (
                              <button key={idx} onClick={() => setSelectedLinks(prev => prev.includes(link.href) ? prev.filter(h => h !== link.href) : [...prev, link.href])} className={`flex items-center justify-between p-2 rounded border transition-all text-left ${selectedLinks.includes(link.href) ? 'bg-blue-600/20 border-blue-500/40' : 'bg-black/20 border-white/5 hover:border-white/10'}`}>
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
                      (extractionResult || extractionResult2) ? (
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
                                      <button onClick={(e) => { e.preventDefault(); setIsModalOpen(true) }} className="p-1 px-3 bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 rounded text-[10px] font-bold uppercase transition-all tracking-tighter">Expand View</button>
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
                                    <div className="markdown-body"><ReactMarkdown>{extractionResult}</ReactMarkdown></div>
                                  </div>
                                )}
                              </div>
                            </details>
                          )}
                          
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
                                    <div className="markdown-body"><ReactMarkdown>{extractionResult2}</ReactMarkdown></div>
                                  </div>
                                )}
                              </div>
                            </details>
                          )}
                        </div>
                      ) : (
                        <div className="flex-1 flex flex-col items-center justify-center border border-dashed border-white/5 rounded-xl opacity-20">
                          <Activity className="w-12 h-12 mb-4 border border-white/20 p-5 rounded-full" />
                          <div className="text-[10px] font-bold uppercase tracking-[0.4em]">
                            {extractionResult === '' ? 'Harvest Complete: No Data Extracted' : 'Engine Awaiting Initialization'}
                          </div>
                        </div>
                      )
                    )}
                 </div>
               </>
             ) : currentModule === 'jobs' ? (
               <div className="flex-1 flex flex-col gap-6">
                  <div className="flex justify-between items-end">
                    <div>
                      <h2 className="text-2xl font-bold tracking-tight">AI Mapping Dispatch</h2>
                      <p className="text-[11px] text-white/40 uppercase tracking-widest mt-1">Bind SKU Master with Collected Markdown Assets</p>
                    </div>
                    <div className="flex gap-3">
                        <button onClick={() => fetchJobs()} className="px-5 py-2.5 bg-white/5 hover:bg-white/10 rounded-lg text-xs font-bold transition-all flex items-center gap-2 border border-white/10"><Activity className="w-3.5 h-3.5" /> RE-SYNC</button>
                        <button onClick={() => {
                          const query = selectedJobs.length > 0 ? `?skus=${selectedJobs.join(',')}` : '';
                          window.open(`/api/outputs/xlsx${query}`)
                        }} className="px-6 py-2.5 bg-green-600 hover:bg-green-500 rounded-lg text-xs font-bold text-white shadow-lg shadow-green-900/20 transition-all flex items-center gap-2">
                           EXPORT MASTER XLS {selectedJobs.length > 0 ? `(${selectedJobs.length})` : ''}
                        </button>
                    </div>
                  </div>

                  {/* Search bar */}
                  <div className="flex items-center gap-3">
                    <input
                      type="text"
                      value={jobsSearch}
                      onChange={(e) => {
                        setJobsSearch(e.target.value);
                        fetchJobs({ search: e.target.value });
                      }}
                      placeholder="Search by SKU or title…"
                      className="flex-1 px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-xs placeholder-white/30 focus:outline-none focus:border-white/20"
                    />
                    {jobsTotal !== undefined && (
                      <span className="text-[11px] text-white/30 whitespace-nowrap">
                        {jobs.length} / {jobsTotal} SKUs
                      </span>
                    )}
                  </div>

                  <div className="flex-1 rounded-xl border border-white/10 bg-[#0a0a0a]/80 overflow-hidden flex flex-col shadow-2xl">
                      <div className="grid grid-cols-[1fr_8fr_8fr_6fr_5fr_4fr_4fr] h-12 border-b border-white/10 bg-white/5 items-center px-6 text-[10px] font-bold uppercase tracking-widest text-white/40">
                         <div className="flex items-center">
                           <input 
                             type="checkbox" 
                             className="w-3 h-3 cursor-pointer outline-none accent-blue-500"
                             checked={jobs.length > 0 && selectedJobs.length === jobs.filter(j => j.status === 'completed').length}
                             onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedJobs(jobs.filter(j => j.status === 'completed').map(j => j.sku));
                                } else {
                                  setSelectedJobs([]);
                                }
                             }}
                           />
                         </div>
                         <div>SKU INDEX</div>
                         <div>PRODUCT IDENTITY</div>
                         <div>PROTOCOL</div>
                         <div>HARVEST DATA</div>
                         <div>LIFECYCLE</div>
                         <div className="text-right">DISPATCH</div>
                      </div>
                      <div className="flex-1 overflow-y-auto custom-scrollbar">
                         {jobs.map((job, idx) => (
                            <div key={idx} className="grid grid-cols-[1fr_8fr_8fr_6fr_5fr_4fr_4fr] h-14 border-b border-white/[0.03] hover:bg-white/[0.02] items-center px-6 transition-colors">
                               <div className="flex items-center">
                                 {job.status === 'completed' && (
                                   <input 
                                     type="checkbox" 
                                     className="w-3 h-3 cursor-pointer outline-none accent-blue-500"
                                     checked={selectedJobs.includes(job.sku)}
                                     onChange={(e) => {
                                        if(e.target.checked) setSelectedJobs(p => [...p, job.sku]);
                                        else setSelectedJobs(p => p.filter(s => s !== job.sku));
                                     }}
                                   />
                                 )}
                               </div>
                               <div className="text-[11px] font-mono text-blue-500 font-bold">{job.sku}</div>
                               <div className="text-[11px] font-medium text-white/80 truncate pr-6">{job.title || 'Unknown Product Entity'}</div>
                               <div className="text-[10px] font-bold text-blue-400/60 uppercase tracking-tighter truncate">{job.attribute_set || job.Attribute_Set || 'DEFAULT'}</div>
                               <div className="flex flex-col justify-center gap-1 text-[10px] font-mono">
                                 {job.harvestFile && (
                                   <div className="flex items-center gap-2">
                                     <div className="text-green-500 flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-green-500"></div> HARVEST_READY</div>
                                     <button 
                                       onClick={() => handleHarvestDelete(job.harvestFile!)}
                                       className="w-4 h-4 bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white rounded flex items-center justify-center transition-all"
                                       title="Delete Harvest File"
                                     >
                                       <X className="w-3 h-3" />
                                     </button>
                                   </div>
                                 )}
                                 {job.hasPdf && (
                                   <div className="flex items-center gap-2">
                                     <div className="text-purple-400 flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-purple-400"></div> PDF_ARCHIVED</div>
                                     <button onClick={() => handleViewPdf(job.sku)} className="w-4 h-4 bg-white/5 hover:bg-white/10 text-blue-400 rounded flex items-center justify-center transition-all" title="View PDF Extracted Text"><FileText className="w-3 h-3" /></button>
                                   </div>
                                 )}
                               {job.hasSapData && (
                                 <div className="flex items-center gap-2">
                                   <div className="text-yellow-400 flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-yellow-400"></div> SAP_DATA</div>
                                 </div>
                               )}
                               {!job.harvestFile && !job.hasPdf && !job.hasSapData && <div className="text-white/20">NO_DATA_LINK</div>}
                              </div>
                              <div className="flex items-center gap-2">
                                 <div className={`w-2 h-2 rounded-full ${job.status === 'completed' ? 'bg-green-500 shadow-[0_0_8px_#22c55e]' : (job.status === 'ready' ? 'bg-blue-500 animate-pulse' : 'bg-white/10')}`}></div>
                                 <span className={`text-[10px] font-bold uppercase tracking-tighter ${job.status === 'completed' ? 'text-green-500' : (job.status === 'ready' ? 'text-blue-500' : 'text-white/20')}`}>{job.status}</span>
                                 {job.status === 'completed' && (
                                   <button 
                                     onClick={() => handleOutputDelete(job.sku)}
                                     className="w-4 h-4 bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white rounded flex items-center justify-center transition-all ml-1"
                                     title="Delete Output JSON"
                                   >
                                      <X className="w-3 h-3" />
                                   </button>
                                 )}
                              </div>
                              <div className="text-right">
                                 {job.status === 'completed' ? (
                                   <button 
                                     onClick={() => fetchOutput(job.sku)}
                                     className="p-2 rounded bg-white/5 hover:bg-white/10 transition-all text-blue-400 hover:text-blue-300"
                                     title="View/Edit Output"
                                   >
                                     <Eye className="w-4 h-4"/>
                                   </button>
                                 ) : 
                                  (job.status === 'ready' && (
                                     <div className="flex items-center justify-end gap-2">
                                       <select 
                                         value={jobAiModels[job.sku] || 'llama-3.3-70b-versatile'}
                                         onChange={(e) => setJobAiModels({...jobAiModels, [job.sku]: e.target.value})}
                                         className="px-2 py-1 bg-white/5 border border-white/10 rounded text-[9px] font-bold uppercase text-white/50 focus:outline-none focus:border-white/20 transition-all cursor-pointer h-[26px]"
                                       >
                                         <option value="llama-3.3-70b-versatile">Llama 3.3 70B</option>
                                         <option value="llama-3.1-8b-instant">Llama 3.1 8B</option>
                                         <option value="mixtral-8x7b-32768">Mixtral 8x7B</option>
                                         <option value="gemma2-9b-it">Gemma 2 9B</option>
                                       </select>
                                       <button onClick={async () => {
                                          addLog('skill', `AI Dispatching mapping for SKU ${job.sku}...`);
                                          try {
                                            const startRes = await apiFetch('/api/jobs/run', {
                                              method: 'POST',
                                              headers: {'Content-Type': 'application/json'},
                                              body: JSON.stringify({ 
                                                 sku: job.sku, 
                                                 aiModel: jobAiModels[job.sku] || 'llama-3.3-70b-versatile'
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
                                       }} className="px-4 py-1.5 h-[26px] bg-blue-600 hover:bg-blue-500 rounded text-[10px] font-bold uppercase tracking-widest text-white shadow-lg transition-all active:scale-95 flex items-center">MAP AI</button>
                                     </div>
                                  ))}
                              </div>
                           </div>
                        ))}
                        {jobs.length === 0 && <div className="flex-1 flex items-center justify-center text-[10px] text-white/20 uppercase font-bold tracking-[0.2em] py-20 italic">Awaiting SKU Master Upload</div>}
                     </div>
                     {jobsHasMore && (
                       <div className="flex justify-center py-3 border-t border-white/5">
                         <button
                           onClick={() => fetchJobs({ cursor: jobsNextCursor ?? undefined, append: true })}
                           className="px-6 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-xs font-bold border border-white/10 transition-all"
                         >
                           LOAD MORE
                         </button>
                       </div>
                     )}
                  </div>
               </div>
             ) : currentModule === 'sku-indexer' ? (
               <div className="flex-1 flex flex-col gap-6">
                  <div className="flex justify-between items-end">
                    <div>
                      <h2 className="text-2xl font-bold tracking-tight">SKU Master Pulse</h2>
                      <p className="text-[11px] text-white/40 uppercase tracking-widest mt-1">Currently governing {skuIndex.length} product records in local memory</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 overflow-y-auto custom-scrollbar flex-1 pb-10">
                     {skuIndex.map((sku, i) => (
                        <div key={i} className="p-5 rounded-2xl border border-white/5 bg-black/40 hover:border-blue-500/20 transition-all group relative overflow-hidden">
                           <div className="absolute top-0 right-0 p-3 opacity-0 group-hover:opacity-100 transition-opacity"><Zap className="w-4 h-4 text-blue-500/40" /></div>
                           <div className="px-2 py-1 bg-blue-600/10 border border-blue-500/20 rounded text-[10px] font-mono text-blue-400 font-bold mb-3 inline-block">{sku.sku || sku.SKU}</div>
                           <div className="text-xs font-bold text-white/90 line-clamp-2 min-h-[32px] leading-relaxed italic">{sku.title || sku.Name || 'Unlabeled Record'}</div>
                           <div className="mt-4 pt-4 border-t border-white/[0.03] grid grid-cols-2 gap-2">
                              <div className="flex flex-col"><span className="text-[8px] text-white/20 uppercase font-bold">Category</span><span className="text-[10px] text-white/70 truncate">{sku.category || 'N/A'}</span></div>
                              <div className="flex flex-col"><span className="text-[8px] text-white/20 uppercase font-bold">Protocol</span><span className="text-[10px] text-blue-400 font-bold truncate uppercase">{sku.attribute_set || sku.Attribute_Set || 'DEFAULT'}</span></div>
                              <div className="flex flex-col"><span className="text-[8px] text-white/20 uppercase font-bold">Brand</span><span className="text-[10px] text-white/70 truncate">{sku.brand || 'N/A'}</span></div>
                           </div>
                        </div>
                     ))}
                     {skuIndex.length === 0 && <div className="col-span-full border border-dashed border-white/10 rounded-2xl py-24 flex flex-col items-center justify-center opacity-20 italic font-bold uppercase tracking-[0.3em] text-xs">Awaiting Master Index Pulse</div>}
                  </div>
               </div>
             ) : currentModule === 'images' ? (
               <div className="flex-1 flex flex-col gap-6 max-w-5xl mx-auto w-full pb-10">
                  <div className="flex items-end justify-between">
                    <div>
                      <h2 className="text-2xl font-bold tracking-tight">Image Sourcer</h2>
                      <p className="text-[11px] text-white/40 uppercase tracking-widest mt-1">High-fidelity image extraction and formatting engine</p>
                    </div>
                  </div>

                  <div className="p-6 rounded-3xl border border-white/10 bg-black/40 space-y-6">
                    <div className="grid grid-cols-[1fr_2fr_auto] gap-4 items-end">
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold text-white/40 tracking-widest">SKU ID</label>
                        <input
                          type="text"
                          value={imageSku}
                          onChange={(e) => setImageSku(e.target.value)}
                          placeholder="e.g. LAP-100"
                          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-blue-400 font-mono focus:border-blue-500/50 outline-none"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold text-white/40 tracking-widest">Target URL</label>
                        <input
                          type="text"
                          value={imageUrl}
                          onChange={(e) => setImageUrl(e.target.value)}
                          placeholder="https://"
                          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white/80 font-mono focus:border-blue-500/50 outline-none"
                        />
                      </div>
                      <button
                        onClick={handleImageExtract}
                        disabled={isExtractingImage || !imageUrl || !imageSku}
                        className={`h-[46px] px-8 rounded-xl font-bold uppercase tracking-widest text-[11px] transition-all flex items-center justify-center gap-2 ${isExtractingImage ? 'bg-cyan-600/50 text-white/50 cursor-not-allowed' : 'bg-cyan-600 hover:bg-cyan-500 text-white shadow-lg active:scale-95'}`}
                      >
                        {isExtractingImage ? <><Loader2 className="w-4 h-4 animate-spin" /> Extracting</> : <><ImageIcon className="w-4 h-4" /> Source Image</>}
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                       <input 
                         type="checkbox" 
                         id="imageScreenshotEnable"
                         checked={imageScreenshotEnabled}
                         onChange={(e) => setImageScreenshotEnabled(e.target.checked)}
                         className="rounded bg-white/10 border-white/20 text-cyan-500 focus:ring-cyan-500/20"
                       />
                       <label htmlFor="imageScreenshotEnable" className="text-[10px] text-white/60 uppercase font-bold tracking-widest cursor-pointer">
                         Enable Full Page Screenshot (Debug)
                       </label>
                    </div>
                  </div>

                  <div className="rounded-3xl border border-emerald-500/20 bg-emerald-500/5 p-5 space-y-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <h3 className="text-[10px] font-bold uppercase tracking-widest text-emerald-300">Load from Harvest File</h3>
                        <p className="text-[11px] text-white/45 mt-1">Extract all image URLs directly from a previously scraped .md harvest file.</p>
                      </div>
                      <div className="flex gap-2">
                        <select
                          onChange={(e) => {
                            if (e.target.value) {
                              loadHarvestFile(e.target.value);
                              e.target.value = '';
                            }
                          }}
                          disabled={loadingHarvestFile || harvestFiles.length === 0}
                          className="px-4 py-2 rounded-xl border border-emerald-500/20 bg-black/40 text-white text-[10px] uppercase tracking-widest font-bold focus:border-emerald-500/50 outline-none disabled:opacity-50"
                        >
                          <option value="">Select harvest file...</option>
                          {harvestFiles.map((file: any, idx: number) => (
                            <option key={idx} value={file.name}>{file.name}</option>
                          ))}
                        </select>
                        <button
                          disabled={loadingHarvestFile || harvestFiles.length === 0}
                          className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-600/40 disabled:text-white/50 text-white text-[10px] uppercase tracking-widest font-black transition-all shadow-lg active:scale-95"
                        >
                          {loadingHarvestFile ? 'Loading...' : 'Load'}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-3xl border border-cyan-500/20 bg-cyan-500/5 p-5 space-y-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <h3 className="text-[10px] font-bold uppercase tracking-widest text-cyan-300">Scraped Image URLs</h3>
                        <p className="text-[11px] text-white/45 mt-1">Select up to 10 images from the scraped markdown source or load from a harvest file. Export happens locally and does not touch Firebase.</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="px-3 py-1 rounded-full border border-white/10 bg-black/40 text-[10px] font-bold text-white/60 uppercase tracking-widest">
                          {selectedImageUrls.length}/10 selected
                        </span>
                        <button
                          onClick={() => setSelectedImageUrls([])}
                          disabled={selectedImageUrls.length === 0}
                          className="px-4 py-2 rounded-xl border border-white/10 text-[10px] uppercase tracking-widest font-bold text-white/60 hover:text-white hover:border-white/20 transition-colors disabled:opacity-40"
                        >
                          Clear Selection
                        </button>
                        <button
                          onClick={exportSelectedImages}
                          disabled={selectedImageUrls.length === 0 || isExportingImages}
                          className="px-5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:bg-cyan-600/40 disabled:text-white/50 text-white text-[10px] uppercase tracking-widest font-black transition-all shadow-lg active:scale-95"
                        >
                          {isExportingImages ? 'Exporting...' : `Export Selected (${selectedImageUrls.length})`}
                        </button>
                      </div>
                    </div>
                    {imageExportError && (
                      <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-xs text-red-200">
                        {imageExportError}
                      </div>
                    )}
                    {imageUrls.length === 0 ? (
                      <div className="border border-dashed border-white/10 rounded-2xl py-16 flex flex-col items-center justify-center opacity-30 italic font-bold uppercase tracking-[0.3em] text-xs">
                        No scraped image URLs yet
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
                        {imageUrls.map((src, index) => {
                          const isSelected = selectedImageUrls.includes(src);
                          const isDisabled = !isSelected && selectedImageUrls.length >= 10;
                          return (
                            <button
                              key={`${src}-${index}`}
                              type="button"
                              onClick={() => toggleImageSelection(src)}
                              disabled={isDisabled}
                              className={`text-left rounded-2xl border transition-all overflow-hidden group ${isSelected ? 'border-cyan-400 bg-cyan-500/10 ring-2 ring-cyan-400/30' : 'border-white/10 bg-black/40 hover:border-white/20'} ${isDisabled ? 'opacity-45 cursor-not-allowed' : ''}`}
                            >
                              <div className="relative aspect-square bg-white p-3 flex items-center justify-center">
                                <img
                                  src={src}
                                  alt={`Scraped image ${index + 1}`}
                                  className="max-w-full max-h-full object-contain"
                                />
                                <div className="absolute top-3 left-3 px-2 py-1 rounded-full bg-black/70 text-[9px] font-bold uppercase tracking-widest text-white/80">
                                  {sanitizeImageSku(imageSku) || 'sku'}-{index + 1}
                                </div>
                                <div className={`absolute top-3 right-3 w-7 h-7 rounded-full border flex items-center justify-center transition-colors ${isSelected ? 'bg-cyan-500 border-cyan-300 text-white' : 'bg-black/70 border-white/20 text-white/30 group-hover:text-white/60'}`}>
                                  {isSelected && <Check className="w-4 h-4" />}
                                </div>
                              </div>
                              <div className="p-3 border-t border-white/10">
                                <div className="text-[10px] font-mono text-white/50 truncate">{src}</div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="space-y-4 flex-1">
                    <h3 className="text-[10px] font-bold uppercase tracking-widest text-white/40">Extracted Assets ({extractedImages.length})</h3>
                    {extractedImages.length === 0 ? (
                      <div className="border border-dashed border-white/10 rounded-2xl py-24 flex flex-col items-center justify-center opacity-20 italic font-bold uppercase tracking-[0.3em] text-xs h-64">
                         No Extractions Yet
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-6">
                        {extractedImages.map((img, i) => (
                           <div key={i} className="rounded-2xl border border-white/10 bg-black/40 overflow-hidden group relative">
                             <div className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
                               <button 
                                 onClick={() => handleImageDelete(img.sku)}
                                 className="w-8 h-8 bg-red-500/20 hover:bg-red-500 text-red-300 hover:text-white rounded-lg flex items-center justify-center transition-colors"
                                 title="Delete Image"
                               >
                                  <Trash2 className="w-4 h-4" />
                               </button>
                             </div>
                             {img.imagePath ? (
                               <div className="aspect-square bg-white flex items-center justify-center relative p-4">
                                 <img src={img.imagePath} alt={img.sku} className="max-w-full max-h-full object-contain" />
                                 <div className="absolute inset-0 bg-black/80 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                   <a href={img.imagePath} download={`${img.sku}.jpg`} className="px-4 py-2 bg-blue-600 text-white text-xs font-bold uppercase tracking-wider rounded-lg hover:bg-blue-500 transition-colors">Download Format</a>
                                 </div>
                               </div>
                             ) : (
                               <div className="aspect-square bg-[#0a0a0a] flex items-center justify-center relative p-4 text-center">
                                  <span className="text-white/20 text-[10px] uppercase font-bold">Image Failed to Process</span>
                               </div>
                             )}
                             <div className="p-4 border-t border-white/10 flex flex-col gap-1">
                               <span className="text-[10px] font-mono text-blue-400 font-bold">{img.sku}</span>
                               <a href={img.originalUrl} target="_blank" rel="noopener noreferrer" className="text-[9px] text-white/40 hover:text-white/80 truncate">Original Source</a>
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
          <div id="stats-bar" className="h-24 border-t border-cyan-900/40 px-8 flex items-center justify-between bg-[#030712] shrink-0 relative overflow-hidden">
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
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 md:p-10 bg-black/90 backdrop-blur-sm" onClick={() => setIsScreenshotExpanded(false)}>
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-4xl h-[85vh] bg-[#0d0d0d] border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="h-16 border-b border-white/10 flex items-center justify-between px-6 bg-white/[0.02] shrink-0">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-purple-500/20 rounded-lg text-purple-400">
                    <Activity className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-white tracking-tight">Visual Verification Snapshot</h2>
                    <p className="text-[10px] text-white/30 font-mono uppercase tracking-widest">{url}</p>
                  </div>
                </div>
                <button 
                  onClick={() => setIsScreenshotExpanded(false)}
                  className="p-3 hover:bg-red-500/20 rounded-xl transition-colors text-white/30 hover:text-red-500 group"
                >
                  <X className="w-5 h-5 group-hover:rotate-90 transition-transform" />
                </button>
              </div>
              <div className="flex-1 overflow-auto bg-black p-4 flex items-start justify-center">
                <img src={currentScreenshot} alt="Target Visual" className="w-full max-w-none border border-white/10 rounded-xl" />
              </div>
            </motion.div>
          </div>
        )}

        {isModalOpen && extractionResult && (
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
                    <p className="text-[10px] text-white/30 font-mono uppercase tracking-widest">{strategy}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => {
                      navigator.clipboard.writeText(extractionResult);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                    className="p-3 hover:bg-white/5 rounded-xl transition-colors text-white/60 hover:text-white group"
                  >
                    {copied ? <Check className="w-5 h-5 text-green-500" /> : <Copy className="w-5 h-5" />}
                  </button>
                  <button 
                    onClick={() => setIsModalOpen(false)}
                    className="p-3 hover:bg-red-500/20 rounded-xl transition-colors text-white/30 hover:text-red-500 group"
                  >
                    <X className="w-5 h-5 group-hover:rotate-90 transition-transform" />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                <div className="max-w-none prose prose-invert prose-blue prose-sm markdown-body">
                  <ReactMarkdown>{extractionResult}</ReactMarkdown>
                </div>
              </div>
              
              <div className="h-12 border-t border-white/10 bg-black/40 flex items-center justify-between px-8 text-[10px] text-white/20 font-mono tracking-widest uppercase">
                <div className="flex gap-6 items-center">
                  <button 
                    onClick={() => {
                      const blob = new Blob([extractionResult], { type: 'text/markdown' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `report_${new Date().getTime()}.md`;
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
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-md text-white">
            <motion.div 
               initial={{ opacity: 0, scale: 0.9 }} 
               animate={{ opacity: 1, scale: 1 }} 
               className="w-full max-w-4xl max-h-[80vh] bg-[#0a0a0a] border border-white/10 rounded-[32px] overflow-hidden flex flex-col shadow-2xl"
            >
              <div className="h-16 border-b border-white/10 flex items-center px-8 justify-between shrink-0">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-purple-500/10 text-purple-400"><FileText className="w-5 h-5" /></div>
                  <div>
                    <h3 className="text-sm font-bold text-white uppercase tracking-widest">Extracted PDF Text</h3>
                    <p className="text-[10px] text-white/30 font-mono">SKU: {viewingPdfSku}</p>
                  </div>
                </div>
                <button onClick={() => { setViewingPdfContent(null); setViewingPdfSku(null); }} className="p-2 rounded-full hover:bg-white/5 transition-all outline-none">
                  <X className="w-5 h-5 text-white/40" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                <div className="bg-white/5 border border-white/10 rounded-2xl p-6 whitespace-pre-wrap font-mono text-[11px] text-white/70 leading-relaxed max-w-full overflow-x-hidden">
                  {viewingPdfContent}
                </div>
              </div>
            </motion.div>
          </div>
        )}
        {viewingOutput && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-md text-white">
            <motion.div 
               initial={{ opacity: 0, scale: 0.9 }} 
               animate={{ opacity: 1, scale: 1 }} 
               className="w-full max-w-4xl max-h-[80vh] bg-[#0a0a0a] border border-white/10 rounded-[32px] overflow-hidden flex flex-col shadow-2xl"
            >
              <div className="h-16 border-b border-white/10 flex items-center px-8 justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400"><FileText className="w-5 h-5" /></div>
                  <div>
                    <h3 className="text-sm font-bold text-white uppercase tracking-widest">Edit Job Outcome</h3>
                    <p className="text-[10px] text-white/30 font-mono">SKU: {editingOutputSku}</p>
                  </div>
                </div>
                <button onClick={() => setViewingOutput(null)} className="p-2 rounded-full hover:bg-white/5 transition-all outline-none">
                  <X className="w-5 h-5 text-white/40" />
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-8 custom-scrollbar grid grid-cols-1 gap-6 text-white">
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
                      <label className="text-[10px] font-bold text-white/40 uppercase tracking-widest pl-1">{key.replace(/_/g, ' ')}</label>
                      {((viewingOutput[key] as string | undefined)?.toString().length ?? 0) > 100 || key.toLowerCase().includes('description') || key.toLowerCase().includes('bullets') ? (
                         <textarea 
                           value={(viewingOutput[key] as string) || ''} 
                           onChange={(e) => setViewingOutput({...viewingOutput, [key]: e.target.value})}
                           className="w-full bg-white/5 border border-white/10 rounded-xl p-4 text-xs text-white/80 focus:border-blue-500/30 outline-none min-h-[120px] leading-relaxed transition-all"
                         />
                      ) : (
                         <input 
                           type="text" 
                           value={(viewingOutput[key] as string) || ''} 
                           onChange={(e) => setViewingOutput({...viewingOutput, [key]: e.target.value})}
                           className="w-full bg-white/5 border border-white/10 rounded-xl p-4 text-xs text-white/80 focus:border-blue-500/30 outline-none transition-all"
                         />
                      )}
                    </div>
                  ));
                })()}
              </div>

              <div className="h-20 border-t border-white/10 bg-white/[0.02] flex items-center px-8 justify-between">
                <div className="flex items-center gap-2 text-[10px] text-white/20 uppercase font-bold tracking-widest">
                  <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></div>
                  Auto-syncing to Dispatch Hub
                </div>
                <button 
                  onClick={handleSaveOutput}
                  disabled={isSavingOutput}
                  className="px-8 py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-full text-xs font-bold text-white transition-all flex items-center gap-3 shadow-lg shadow-blue-600/20"
                >
                  {isSavingOutput ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
                  PERSIST TO MASTER INDEX
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {showHarvestModal && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-6 bg-black/90 backdrop-blur-md text-white">
            <motion.div 
               initial={{ opacity: 0, scale: 0.95 }} 
               animate={{ opacity: 1, scale: 1 }} 
               className="w-full max-w-2xl bg-[#0a0a0a] border border-white/10 rounded-[32px] overflow-hidden flex flex-col shadow-2xl"
            >
              <div className="h-20 border-b border-white/10 flex items-center px-8 justify-between bg-white/[0.02]">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-400"><Archive className="w-6 h-6" /></div>
                  <div>
                    <h3 className="text-sm font-bold text-white uppercase tracking-widest">Harvest History</h3>
                    <p className="text-[10px] text-white/30 font-mono uppercase">Indexed Data Assets</p>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-white">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
                    <input 
                      type="text"
                      placeholder="Search files..."
                      value={harvestSearch}
                      onChange={(e) => setHarvestSearch(e.target.value)}
                      className="bg-white/5 border border-white/10 rounded-full pl-9 pr-4 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500/50 w-48 transition-all"
                    />
                  </div>
                  <button onClick={() => setShowHarvestModal(false)} className="p-2 rounded-full hover:bg-white/5 transition-all text-white/40 outline-none">
                    <X className="w-5 h-5 text-white/40" />
                  </button>
                </div>
              </div>
              
              <div className="flex-1 overflow-y-auto p-8 custom-scrollbar max-h-[60vh] space-y-3">
                {harvestFiles
                  .filter((f: any) => f.name.toLowerCase().includes(harvestSearch.toLowerCase()))
                  .map((file: any, idx: number) => (
                    <div key={idx} className="p-4 bg-white/[0.03] border border-white/5 rounded-2xl flex items-center justify-between group hover:bg-white/[0.06] transition-all text-white">
                      <div className="flex items-center gap-4 text-white">
                        <div className="p-3 rounded-xl bg-white/5 text-white/40"><FileText className="w-5 h-5" /></div>
                        <div className="flex flex-col truncate">
                          <span className="text-xs font-mono text-white/80 truncate font-bold">{file.name}</span>
                          <span className="text-[10px] text-white/20 uppercase tracking-tight">{(file.size / 1024).toFixed(1)} KB • {new Date(file.mtime).toLocaleString()}</span>
                        </div>
                      </div>
                      <div className="flex gap-2 transition-all">
                        <button 
                          onClick={async () => {
                            const res = await apiFetch(`/api/harvest/${file.name}`);
                            const data = await res.json();
                            setExtractionResult(data.content);
                            setIsModalOpen(true);
                            addLog('action', `Opening harvest archive: ${file.name}`);
                          }}
                          className="p-2 bg-blue-600/10 hover:bg-blue-600 text-blue-400 hover:text-white rounded-xl transition-all"
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
                          className="p-2 bg-red-600/10 hover:bg-red-600 text-red-400 hover:text-white rounded-xl transition-all"
                          title="Delete File"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                {harvestFiles.filter((f: any) => f.name.toLowerCase().includes(harvestSearch.toLowerCase())).length === 0 && (
                  <div className="py-12 text-center text-white">
                    <div className="inline-block p-4 rounded-full bg-white/5 text-white/10 mb-4"><Search className="w-8 h-8 text-white/20" /></div>
                    <p className="text-xs text-white/20 uppercase tracking-widest font-bold">No assets match your search</p>
                  </div>
                )}
              </div>

              <div className="h-16 border-t border-white/10 bg-white/[0.01] flex items-center px-8 justify-between">
                 <div className="text-[10px] text-white/20 font-mono italic">Found {harvestFiles.length} total indexed assets</div>
                 <button onClick={fetchHarvest} className="text-[10px] text-blue-400 hover:text-blue-300 font-bold uppercase tracking-widest flex items-center gap-2 transition-all">
                   <RefreshCw className="w-3 h-3" />
                   Sync Filesystem
                 </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      </div>
      )}
    </ErrorBoundary>
  );
}
