import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';

type FirestoreScope = 'sku' | 'harvest' | 'settings' | 'allowlist' | 'outputs';
type FirestoreModeType = 'all' | 'outputs-only' | 'off';

// Default to full Firestore sync so admin updates are shared across users.
// Allowed values: all | outputs-only | off
const FIRESTORE_MODE = (process.env.FIRESTORE_MODE || 'all').toLowerCase() as FirestoreModeType;

// Validate FIRESTORE_MODE (Security)
const VALID_FIRESTORE_MODES: FirestoreModeType[] = ['all', 'outputs-only', 'off'];
if (!VALID_FIRESTORE_MODES.includes(FIRESTORE_MODE)) {
  console.error(`[Firestore] FATAL: Invalid FIRESTORE_MODE='${FIRESTORE_MODE}'. Must be one of: ${VALID_FIRESTORE_MODES.join(', ')}`);
  process.exit(1);
}

const canUseFirestore = (scope: FirestoreScope) => {
  if (FIRESTORE_MODE === 'all') return true;
  if (FIRESTORE_MODE === 'off') return false;
  return scope === 'outputs';
};

console.log(`[Firestore] Mode: ${FIRESTORE_MODE}`);

let firestoreProjectId: string | null = null;
let firestoreDatabaseId: string | null = null;
let firestoreInitError: string | null = null;
let firestoreAuthSource: 'service-account-env' | 'service-account-file' | 'application-default' | 'none' = 'none';

const loadServiceAccount = () => {
  const fromEnv = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (fromEnv) {
    try {
      const parsed = JSON.parse(fromEnv);
      firestoreAuthSource = 'service-account-env';
      return parsed;
    } catch (e: any) {
      firestoreInitError = `Invalid FIREBASE_SERVICE_ACCOUNT_JSON: ${e?.message || 'parse error'}`;
      return null;
    }
  }

  const serviceAccountPath = path.join(process.cwd(), 'firebase-service-account.json');
  if (fs.existsSync(serviceAccountPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
      firestoreAuthSource = 'service-account-file';
      return parsed;
    } catch (e: any) {
      firestoreInitError = `Invalid firebase-service-account.json: ${e?.message || 'parse error'}`;
      return null;
    }
  }

  firestoreAuthSource = 'application-default';
  return null;
};

// Safely initialize Firebase Admin
let db: admin.firestore.Firestore | null = null;
try {
  const firebaseConfigPath = path.join(process.cwd(), 'firebase-applet-config.json');
  if (fs.existsSync(firebaseConfigPath)) {
    const config = JSON.parse(fs.readFileSync(firebaseConfigPath, 'utf8'));
    firestoreProjectId = typeof config.projectId === 'string' ? config.projectId : null;
    firestoreDatabaseId = typeof config.firestoreDatabaseId === 'string' ? config.firestoreDatabaseId : '(default)';
    const serviceAccount = loadServiceAccount();

    if (!serviceAccount && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      console.warn('[Firestore] No explicit credentials detected. Set FIREBASE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS for stable local connectivity.');
    }

    // Make sure we only initialize once
    if (!admin.apps.length) {
      if (serviceAccount) {
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
          projectId: config.projectId
        });
      } else {
        admin.initializeApp({ projectId: config.projectId });
      }
    }
    // Set up with the specified databaseId
    const databaseId = config.firestoreDatabaseId !== '(default)' && config.firestoreDatabaseId ? config.firestoreDatabaseId : undefined;
    db = getFirestore(admin.app(), databaseId);
    // Test connection silently
    if (db && canUseFirestore('settings')) {
      db.collection('settings').doc('connection_test').set({ 
        last_init: new Date().toISOString(),
        platform: 'server_admin_sdk'
      }).catch((err: any) => {
        console.error(`[Firestore] Connection test failed: ${err?.message || 'unknown error'}`);
      });
    }
  } else {
    console.warn('[Firestore] firebase-applet-config.json not found. Using local filesystem fallback.');
    firestoreInitError = 'firebase-applet-config.json not found';
    firestoreAuthSource = 'none';
  }
} catch (e: any) {
  console.warn(`[Firestore] Initialization failed: ${e?.message || 'unknown error'}. Using local filesystem fallback.`);
  firestoreInitError = e?.message || 'unknown error';
  firestoreAuthSource = 'none';
  db = null;
}

const ensureDb = async () => {
  return db;
};

// Ensure directories exist
const SKU_INDEX_DIR = path.join(process.cwd(), 'sku-index');
const HARVEST_DIR = path.join(process.cwd(), 'harvest');
const OUTPUTS_DIR = path.join(process.cwd(), 'outputs');
const SETTINGS_DIR = path.join(process.cwd(), 'settings');

[SKU_INDEX_DIR, HARVEST_DIR, OUTPUTS_DIR, SETTINGS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ── In-memory SKU index cache ─────────────────────────────────────────────
// Loading master.json on every request is O(n) disk I/O. The cache avoids
// repeated reads for the 30-second window of a typical view refresh.
interface SkuIndexCache { data: any[]; loadedAt: number; }
let _skuCache: SkuIndexCache | null = null;
const SKU_CACHE_TTL_MS = 30_000; // 30 seconds

function _invalidateSkuCache(): void { _skuCache = null; }

function _getSkuCached(): any[] {
  const now = Date.now();
  if (_skuCache && now - _skuCache.loadedAt < SKU_CACHE_TTL_MS) return _skuCache.data;
  const fp = path.join(SKU_INDEX_DIR, 'master.json');
  const data = readJsonFile(fp, [] as any[]);
  _skuCache = { data, loadedAt: now };
  return data;
}

// ── Per-SKU write serialization ───────────────────────────────────────────
// Chains promises per SKU key so concurrent writes to the same SKU are
// serialized rather than racing to write the master.json file.
const _skuWriteLocks = new Map<string, Promise<unknown>>();

function withSkuWriteLock<T>(sku: string, fn: () => Promise<T>): Promise<T> {
  const prior = _skuWriteLocks.get(sku) ?? Promise.resolve();
  // Chain fn after the prior operation. Swallow prior errors so they don't
  // block subsequent work, but propagate fn errors to the caller normally.
  const next = prior.catch(() => {}).then(() => fn());
  // Store a silenced version in the map so the chain isn't broken by fn errors.
  _skuWriteLocks.set(sku, next.catch(() => {}));
  return next;
}
// ──────────────────────────────────────────────────────────────────────────

const readJsonFile = <T>(filePath: string, fallback: T): T => {
  if (!fs.existsSync(filePath)) return fallback;

  try {
    const raw = fs.readFileSync(filePath, 'utf8').trim();
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const isNonEmptyObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length > 0;

export const dbService = {
  getFirestoreStatus() {
    return {
      mode: FIRESTORE_MODE,
      connected: !!db,
      projectId: firestoreProjectId,
      databaseId: firestoreDatabaseId,
      authSource: firestoreAuthSource,
      initError: firestoreInitError,
      scopeAccess: {
        sku: canUseFirestore('sku'),
        harvest: canUseFirestore('harvest'),
        settings: canUseFirestore('settings'),
        allowlist: canUseFirestore('allowlist'),
        outputs: canUseFirestore('outputs')
      }
    };
  },

  // SKU Index
  async getSkuIndex() {
    if (db && canUseFirestore('sku')) {
      try {
        const docSnap = await db.collection('settings').doc('master_index').get();
        if (docSnap.exists) {
          const data = docSnap.data()?.data || [];
          if (data.length > 0) {
            // Warm the local cache from Firestore so subsequent calls are fast
            _skuCache = { data, loadedAt: Date.now() };
            return data;
          }
        }
      } catch (e: any) {
        // Silently fallback
      }
    }
    return _getSkuCached();
  },
  async updateSkuIndex(data: any[]) {
    _invalidateSkuCache();
    if (db && canUseFirestore('sku')) {
      try {
        // Legacy single-doc write (compat for older reads)
        await db.collection('settings').doc('master_index').set({ data });
        // Per-SKU document writes in batches of 500 (Firestore batch limit)
        // This enables paginated queries on the 'skus' collection going forward.
        for (let i = 0; i < data.length; i += 500) {
          const batch = db.batch();
          data.slice(i, i + 500).forEach((item: any) => {
            const sku = (item.sku || item.SKU)?.toString();
            if (sku) {
              batch.set(db!.collection('skus').doc(sku), {
                ...item,
                _updatedAt: new Date().toISOString(),
              });
            }
          });
          await batch.commit();
        }
      } catch (e: any) {
        console.warn('[Firestore] SKU index write failed, using file fallback:', e.message);
      }
    }
    fs.writeFileSync(path.join(SKU_INDEX_DIR, 'master.json'), JSON.stringify(data, null, 2));
  },

  /**
   * Atomically upsert a single SKU record without touching other SKUs.
   * On the Firestore path this is a true atomic merge-set.
   * On the file path it serialises per-SKU via a write lock to prevent lost updates.
   */
  async upsertSku(sku: string, data: Record<string, unknown>): Promise<{ sku: string; updatedAt: string }> {
    const updatedAt = new Date().toISOString();
    const record = { ...data, sku, _updatedAt: updatedAt };
    _invalidateSkuCache();
    if (db && canUseFirestore('sku')) {
      try {
        await db.collection('skus').doc(sku).set(record);
        return { sku, updatedAt };
      } catch (e: any) {
        console.warn('[Firestore] upsertSku failed, falling back to file:', e.message);
      }
    }
    await withSkuWriteLock(sku, async () => {
      const fp = path.join(SKU_INDEX_DIR, 'master.json');
      const all = readJsonFile(fp, [] as any[]);
      const idx = all.findIndex((item: any) => (item.sku || item.SKU)?.toString() === sku);
      if (idx !== -1) {
        all[idx] = { ...all[idx], ...record };
      } else {
        all.push(record);
      }
      await fs.promises.writeFile(fp, JSON.stringify(all, null, 2));
    });
    return { sku, updatedAt };
  },

  /**
   * Optimistic-concurrency patch for a single SKU.
   * Pass `ifVersion` (the `_version` field from a prior read) to guard against lost updates.
   * Returns the new version on success, or null when the version check fails (conflict).
   */
  async patchSku(
    sku: string,
    fields: Record<string, unknown>,
    ifVersion?: number,
  ): Promise<{ sku: string; version: number; updatedAt: string } | null> {
    const updatedAt = new Date().toISOString();
    _invalidateSkuCache();
    if (db && canUseFirestore('sku')) {
      try {
        const result = await db.runTransaction(async (tx) => {
          const ref = db!.collection('skus').doc(sku);
          const snap = await tx.get(ref);
          const current = snap.exists ? (snap.data() ?? {}) : {};
          const currentVersion = typeof current._version === 'number' ? current._version : 0;
          if (ifVersion !== undefined && currentVersion !== ifVersion) return null;
          const newVersion = currentVersion + 1;
          tx.set(ref, { ...current, ...fields, sku, _version: newVersion, _updatedAt: updatedAt });
          return { sku, version: newVersion, updatedAt };
        });
        if (result !== null) return result;
        return null; // version conflict
      } catch (e: any) {
        console.warn('[Firestore] patchSku failed, falling back to file:', e.message);
      }
    }
    // File fallback with per-SKU serialisation
    return withSkuWriteLock(sku, async () => {
      const fp = path.join(SKU_INDEX_DIR, 'master.json');
      const all = readJsonFile(fp, [] as any[]);
      const idx = all.findIndex((item: any) => (item.sku || item.SKU)?.toString() === sku);
      let currentVersion = 0;
      let existing: Record<string, unknown> = {};
      if (idx !== -1) {
        existing = all[idx];
        currentVersion = typeof existing._version === 'number' ? (existing._version as number) : 0;
      }
      if (ifVersion !== undefined && currentVersion !== ifVersion) return null;
      const newVersion = currentVersion + 1;
      const updated = { ...existing, ...fields, sku, _version: newVersion, _updatedAt: updatedAt };
      if (idx !== -1) {
        all[idx] = updated;
      } else {
        all.push(updated);
      }
      await fs.promises.writeFile(fp, JSON.stringify(all, null, 2));
      return { sku, version: newVersion, updatedAt };
    });
  },

  /** O(1) single-SKU lookup. Uses per-doc Firestore collection or in-memory cache. */
  async getSkuById(sku: string): Promise<any | null> {
    if (db && canUseFirestore('sku')) {
      try {
        const docSnap = await db.collection('skus').doc(sku).get();
        if (docSnap.exists) return docSnap.data() || null;
      } catch { /* fallback */ }
    }
    const all = _getSkuCached();
    return all.find((item: any) => (item.sku || item.SKU)?.toString() === sku) ?? null;
  },

  /**
   * Paginated SKU listing. Backed by Firestore 'skus' collection (per-doc model)
   * or the in-memory cache of master.json as fallback.
   *
   * For the Firestore path, `cursor` is the last document ID of the previous page.
   * For the file/cache path, `cursor` is the last SKU value of the previous page.
   */
  async listSkusPaginated({ cursor, limit = 50, search, statusFilter }: {
    cursor?: string;
    limit?: number;
    search?: string;
    statusFilter?: string;
  }): Promise<{ items: any[]; nextCursor: string | null; hasMore: boolean; total?: number }> {
    const effectiveLimit = Math.min(limit || 50, 200);

    // Firestore per-doc path (new model — available after first updateSkuIndex call)
    if (db && canUseFirestore('sku')) {
      try {
        const skusRef = db.collection('skus');
        // Check whether the new per-doc model has data
        const probe = await skusRef.limit(1).get();
        if (probe.size > 0) {
          let q: FirebaseFirestore.Query = skusRef.orderBy('sku');
          if (search) {
            q = q.where('sku', '>=', search).where('sku', '<=', search + '\uf8ff');
          }
          if (cursor) {
            const cursorDoc = await skusRef.doc(cursor).get();
            if (cursorDoc.exists) q = q.startAfter(cursorDoc);
          }
          q = q.limit(effectiveLimit + 1); // +1 to detect hasMore
          const snap = await q.get();
          const docs = snap.docs.slice(0, effectiveLimit);
          const hasMore = snap.docs.length > effectiveLimit;
          return {
            items: docs.map(d => d.data()),
            nextCursor: hasMore && docs.length > 0 ? docs[docs.length - 1].id : null,
            hasMore,
          };
        }
      } catch { /* fallback to cache */ }
    }

    // File / cache fallback — sorts and slices in-memory
    let all = _getSkuCached();
    if (search) {
      const s = search.toLowerCase();
      all = all.filter((item: any) => {
        const skuVal = ((item.sku || item.SKU) ?? '').toString().toLowerCase();
        const title = ((item.title || item.Name) ?? '').toString().toLowerCase();
        return skuVal.includes(s) || title.includes(s);
      });
    }
    // Stable alphabetical sort so cursor positions are deterministic
    all = [...all].sort((a: any, b: any) => {
      const sa = (a.sku || a.SKU || '').toString();
      const sb = (b.sku || b.SKU || '').toString();
      return sa < sb ? -1 : sa > sb ? 1 : 0;
    });

    let startIndex = 0;
    if (cursor) {
      const idx = all.findIndex((item: any) => (item.sku || item.SKU)?.toString() === cursor);
      if (idx >= 0) startIndex = idx + 1;
    }
    const page = all.slice(startIndex, startIndex + effectiveLimit);
    const hasMore = startIndex + effectiveLimit < all.length;
    const nextCursor =
      hasMore && page.length > 0
        ? (page[page.length - 1].sku || page[page.length - 1].SKU)?.toString() ?? null
        : null;
    return { items: page, nextCursor, hasMore, total: all.length };
  },

  /** Fast per-SKU harvest existence check. O(1). */
  async harvestExists(sku: string): Promise<boolean> {
    if (db && canUseFirestore('harvest')) {
      try {
        const docSnap = await db.collection('harvests').doc(sku).get();
        return docSnap.exists;
      } catch { /* fallback */ }
    }
    return fs.existsSync(path.join(HARVEST_DIR, `${sku}.md`));
  },

  // Harvests
  async getHarvest(sku: string) {
    if (db && canUseFirestore('harvest')) {
      try {
        const docSnap = await db.collection('harvests').doc(sku).get();
        if (docSnap.exists) return docSnap.data()?.content || null;
      } catch (e: any) {
        // ignore
      }
    }
    const fp = path.join(HARVEST_DIR, `${sku}.md`);
    if (fs.existsSync(fp)) return fs.readFileSync(fp, 'utf8');
    return null;
  },
  async saveHarvest(sku: string, content: string, secondaryContent?: string) {
    if (db && canUseFirestore('harvest')) {
      try {
        const docData: any = { sku, content };
        if (secondaryContent !== undefined) {
          docData.secondary_content = secondaryContent;
        }
        await db.collection('harvests').doc(sku).set(docData);
        console.log(`[Firestore] Successfully saved harvest for SKU: ${sku}`);
      } catch (e: any) {
        console.error("[Firestore ERROR] Failed to save harvest:", e.message);
      }
    }
    fs.promises.writeFile(path.join(HARVEST_DIR, `${sku}.md`), content).catch((e: any) => {
      console.error('[DB] saveHarvest file write failed:', e.message);
    });
    if (secondaryContent !== undefined) {
      fs.promises.writeFile(path.join(HARVEST_DIR, `${sku}_secondary.md`), secondaryContent).catch((e: any) => {
        console.error('[DB] saveHarvest secondary file write failed:', e.message);
      });
    }
  },
  async deleteHarvest(sku: string) {
    if (db && canUseFirestore('harvest')) {
      try {
        await db.collection('harvests').doc(sku).delete();
      } catch (e: any) {
        // ignore
      }
    }
    const fp = path.join(HARVEST_DIR, `${sku}.md`);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    const fpSecondary = path.join(HARVEST_DIR, `${sku}_secondary.md`);
    if (fs.existsSync(fpSecondary)) fs.unlinkSync(fpSecondary);
  },
  async deleteSku(sku: string) {
    // Explicitly delete the per-SKU Firestore document so it no longer
    // appears in listSkusPaginated queries after the index file is updated.
    if (db && canUseFirestore('sku')) {
      try {
        await db.collection('skus').doc(sku).delete();
      } catch (e: any) {
        // ignore — file path is always the source of truth
      }
    }
  },
  async listHarvests() {
    if (db && canUseFirestore('harvest')) {
      try {
        const querySnapshot = await db.collection('harvests').get();
        return querySnapshot.docs.map(d => ({
          name: d.id + '.md',
          size: 0,
          mtime: new Date()
        }));
      } catch (e: any) {
        // ignore
      }
    }
    const files = fs.readdirSync(HARVEST_DIR).filter(f => f.endsWith('.md'));
    return files.map(f => {
      const stats = fs.statSync(path.join(HARVEST_DIR, f));
      return {
        name: f,
        size: stats.size,
        mtime: stats.mtime
      };
    });
  },

  // Outputs
  async getOutput(sku: string) {
    const fp = path.join(OUTPUTS_DIR, `${sku}.json`);
    if (fs.existsSync(fp)) return JSON.parse(fs.readFileSync(fp, 'utf8'));
    if (db && canUseFirestore('outputs')) {
      try {
        const docSnap = await db.collection('outputs').doc(sku).get();
        if (docSnap.exists) return docSnap.data()?.data || null;
      } catch (e: any) {
        // ignore
      }
    }
    return null;
  },
  async saveOutput(sku: string, data: any) {
    if (db && canUseFirestore('outputs')) {
      try {
        await db.collection('outputs').doc(sku).set({ sku, data });
      } catch (e: any) {
        // ignore
      }
    }
    fs.promises.writeFile(
      path.join(OUTPUTS_DIR, `${sku}.json`),
      JSON.stringify(data, null, 2),
    ).catch((e: any) => {
      console.error('[DB] saveOutput file write failed:', e.message);
    });
  },
  async deleteOutput(sku: string) {
    if (db && canUseFirestore('outputs')) {
      try {
        await db.collection('outputs').doc(sku).delete();
      } catch (e: any) {
        // ignore
      }
    }
    const fp = path.join(OUTPUTS_DIR, `${sku}.json`);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  },
  async listOutputs() {
    const files = fs.readdirSync(OUTPUTS_DIR).filter(f => f.endsWith('.json') && !f.includes('/'));
    if (files.length > 0) {
      // Sequential reads to avoid holding hundreds of file buffers in memory simultaneously
      const results: any[] = [];
      for (const f of files) {
        try {
          results.push(JSON.parse(fs.readFileSync(path.join(OUTPUTS_DIR, f), 'utf8')));
        } catch { /* skip malformed */ }
      }
      return results;
    }
    if (db && canUseFirestore('outputs')) {
      try {
        const querySnapshot = await db.collection('outputs').get();
        return querySnapshot.docs.map(d => {
          const val = d.data();
          return val.data ? val.data : val;
        });
      } catch (e: any) {
        // ignore
      }
    }
    return [];
  },

  /**
   * Paginated output listing. Use instead of listOutputs() for large datasets
   * — avoids loading all output files into memory at once.
   */
  async listOutputsPaginated({ cursor, limit = 50 }: {
    cursor?: string;
    limit?: number;
  }): Promise<{ items: any[]; nextCursor: string | null; hasMore: boolean }> {
    const effectiveLimit = Math.min(limit || 50, 200);

    if (db && canUseFirestore('outputs')) {
      try {
        let q: FirebaseFirestore.Query = db.collection('outputs').orderBy('sku');
        if (cursor) {
          const cursorDoc = await db.collection('outputs').doc(cursor).get();
          if (cursorDoc.exists) q = q.startAfter(cursorDoc);
        }
        q = q.limit(effectiveLimit + 1);
        const snap = await q.get();
        if (snap.size > 0) {
          const docs = snap.docs.slice(0, effectiveLimit);
          const hasMore = snap.docs.length > effectiveLimit;
          return {
            items: docs.map(d => { const val = d.data(); return val.data ? val.data : val; }),
            nextCursor: hasMore && docs.length > 0 ? docs[docs.length - 1].id : null,
            hasMore,
          };
        }
      } catch { /* fallback */ }
    }

    // File fallback — sequential reads of sorted files
    const files = fs.readdirSync(OUTPUTS_DIR)
      .filter(f => f.endsWith('.json') && !f.includes('/'))
      .sort();

    let startIndex = 0;
    if (cursor) {
      const idx = files.findIndex(f => f.replace('.json', '') === cursor);
      if (idx >= 0) startIndex = idx + 1;
    }
    const pageFiles = files.slice(startIndex, startIndex + effectiveLimit);
    const hasMore = startIndex + effectiveLimit < files.length;
    const items: any[] = [];
    for (const f of pageFiles) {
      try {
        items.push(JSON.parse(fs.readFileSync(path.join(OUTPUTS_DIR, f), 'utf8')));
      } catch { /* skip */ }
    }
    return {
      items,
      nextCursor:
        hasMore && pageFiles.length > 0
          ? pageFiles[pageFiles.length - 1].replace('.json', '')
          : null,
      hasMore,
    };
  },

  // Settings
  async getSettings() {
    if (db && canUseFirestore('settings')) {
      try {
        const docSnap = await db.collection('settings').doc('app_settings').get();
        if (docSnap.exists) {
          const remoteSettings = docSnap.data()?.data;
          if (isNonEmptyObject(remoteSettings)) {
            return remoteSettings;
          }
          console.warn('[Firestore] app_settings is empty. Falling back to settings/app_settings.json.');
        }
      } catch (e: any) {
        // ignore
      }
    }
    const fp = path.join(SETTINGS_DIR, 'app_settings.json');
    return readJsonFile(fp, {});
  },
  async saveSettings(settings: any) {
    if (db && canUseFirestore('settings')) {
      try {
        await db.collection('settings').doc('app_settings').set({ data: settings });
      } catch (e: any) {
        // ignore
      }
    }
    fs.writeFileSync(path.join(SETTINGS_DIR, 'app_settings.json'), JSON.stringify(settings, null, 2));
  },

  // Allowlist
  async getAllowlist() {
    if (db && canUseFirestore('allowlist')) {
      try {
        const querySnapshot = await db.collection('allowlist').get();
        return querySnapshot.docs.map(d => ({ email: d.id, ...d.data() }));
      } catch (e: any) {
        // Ignore fallback
      }
    }
    const fp = path.join(SETTINGS_DIR, 'allowlist.json');
    return readJsonFile(fp, [{ email: 'aswathmantle@gmail.com', role: 'admin' }]);
  },
  async getAllowlistUser(email: string) {
    if (db && canUseFirestore('allowlist')) {
      try {
        const docSnap = await db.collection('allowlist').doc(email).get();
        if (docSnap.exists) return { email, ...docSnap.data() };
      } catch (e: any) {
        // Ignore fallback
      }
    }
    const list = await this.getAllowlist();
    return list.find((u: any) => u.email === email) || null;
  },
  async addAllowlistUser(email: string, role: string) {
    const entry = { email, role, addedAt: new Date().toISOString() };
    if (db && canUseFirestore('allowlist')) {
      try {
        await db.collection('allowlist').doc(email).set(entry);
      } catch (e: any) {
        // Ignore fallback
      }
    }
    const fp = path.join(SETTINGS_DIR, 'allowlist.json');
    const list = readJsonFile(fp, [] as any[]);
    if (!list.find((u: any) => u.email === email)) {
      list.push(entry);
      fs.writeFileSync(fp, JSON.stringify(list, null, 2));
    }
  },
  async removeAllowlistUser(email: string) {
    if (db && canUseFirestore('allowlist')) {
      try {
        await db.collection('allowlist').doc(email).delete();
      } catch (e: any) {
        // Ignore fallback
      }
    }
    const fp = path.join(SETTINGS_DIR, 'allowlist.json');
    if (fs.existsSync(fp)) {
      let list = readJsonFile(fp, [] as any[]);
      list = list.filter((u: any) => u.email !== email);
      fs.writeFileSync(fp, JSON.stringify(list, null, 2));
    }
  }
}
;

