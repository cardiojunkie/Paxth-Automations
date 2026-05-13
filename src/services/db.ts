import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';

type FirestoreScope = 'sku' | 'harvest' | 'settings' | 'allowlist' | 'outputs';

// Default to full Firestore sync so admin updates are shared across users.
// Allowed values: all | outputs-only | off
const FIRESTORE_MODE = (process.env.FIRESTORE_MODE || 'all').toLowerCase();
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
      }).catch(() => {});
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
        if (docSnap.exists) return docSnap.data()?.data || [];
      } catch (e: any) {
        // Silently fallback
      }
    }
    const fp = path.join(SKU_INDEX_DIR, 'master.json');
    return readJsonFile(fp, [] as any[]);
  },
  async updateSkuIndex(data: any[]) {
    if (db && canUseFirestore('sku')) {
      try {
        await db.collection('settings').doc('master_index').set({ data });
      } catch (e: any) {
        // ignore
      }
    }
    fs.writeFileSync(path.join(SKU_INDEX_DIR, 'master.json'), JSON.stringify(data, null, 2));
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
    fs.writeFileSync(path.join(HARVEST_DIR, `${sku}.md`), content);
    if (secondaryContent !== undefined) {
      fs.writeFileSync(path.join(HARVEST_DIR, `${sku}_secondary.md`), secondaryContent);
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
    fs.writeFileSync(path.join(OUTPUTS_DIR, `${sku}.json`), JSON.stringify(data, null, 2));
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
    const files = fs.readdirSync(OUTPUTS_DIR).filter(f => f.endsWith('.json'));
    if (files.length > 0) {
      return files.map(f => JSON.parse(fs.readFileSync(path.join(OUTPUTS_DIR, f), 'utf8')));
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

  // Settings
  async getSettings() {
    if (db && canUseFirestore('settings')) {
      try {
        const docSnap = await db.collection('settings').doc('app_settings').get();
        if (docSnap.exists) return docSnap.data()?.data || {};
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

