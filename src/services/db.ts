import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';

// Safely initialize Firebase Admin
let db: admin.firestore.Firestore | null = null;
try {
  const firebaseConfigPath = path.join(process.cwd(), 'firebase-applet-config.json');
  if (fs.existsSync(firebaseConfigPath)) {
    const config = JSON.parse(fs.readFileSync(firebaseConfigPath, 'utf8'));
    // Make sure we only initialize once
    if (!admin.apps.length) {
      admin.initializeApp({ projectId: config.projectId });
    }
    // Set up with the specified databaseId
    const databaseId = config.firestoreDatabaseId !== '(default)' && config.firestoreDatabaseId ? config.firestoreDatabaseId : undefined;
    db = getFirestore(admin.app(), databaseId);
    // Test connection silently
    if (db) {
      db.collection('settings').doc('connection_test').set({ 
        last_init: new Date().toISOString(),
        platform: 'server_admin_sdk'
      }).catch(() => {});
    }
  }
} catch (e: any) {
  // Fallback to local FS only
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

export const dbService = {
  // SKU Index
  async getSkuIndex() {
    if (db) {
      try {
        const docSnap = await db.collection('settings').doc('master_index').get();
        if (docSnap.exists) return docSnap.data()?.data || [];
      } catch (e: any) {
        // Silently fallback
      }
    }
    const fp = path.join(SKU_INDEX_DIR, 'master.json');
    if (fs.existsSync(fp)) return JSON.parse(fs.readFileSync(fp, 'utf8'));
    return [];
  },
  async updateSkuIndex(data: any[]) {
    if (db) {
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
    if (db) {
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
    if (db) {
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
    if (db) {
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
    if (db) {
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
    if (db) {
      try {
        const docSnap = await db.collection('outputs').doc(sku).get();
        if (docSnap.exists) return docSnap.data()?.data || null;
      } catch (e: any) {
        // ignore
      }
    }
    const fp = path.join(OUTPUTS_DIR, `${sku}.json`);
    if (fs.existsSync(fp)) return JSON.parse(fs.readFileSync(fp, 'utf8'));
    return null;
  },
  async saveOutput(sku: string, data: any) {
    if (db) {
      try {
        await db.collection('outputs').doc(sku).set({ sku, data });
      } catch (e: any) {
        // ignore
      }
    }
    fs.writeFileSync(path.join(OUTPUTS_DIR, `${sku}.json`), JSON.stringify(data, null, 2));
  },
  async deleteOutput(sku: string) {
    if (db) {
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
    if (db) {
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
    const files = fs.readdirSync(OUTPUTS_DIR).filter(f => f.endsWith('.json'));
    return files.map(f => JSON.parse(fs.readFileSync(path.join(OUTPUTS_DIR, f), 'utf8')));
  },

  // Settings
  async getSettings() {
    if (db) {
      try {
        const docSnap = await db.collection('settings').doc('app_settings').get();
        if (docSnap.exists) return docSnap.data()?.data || {};
      } catch (e: any) {
        // ignore
      }
    }
    const fp = path.join(SETTINGS_DIR, 'app_settings.json');
    if (fs.existsSync(fp)) return JSON.parse(fs.readFileSync(fp, 'utf8'));
    return {};
  },
  async saveSettings(settings: any) {
    if (db) {
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
    if (db) {
      try {
        const querySnapshot = await db.collection('allowlist').get();
        return querySnapshot.docs.map(d => ({ email: d.id, ...d.data() }));
      } catch (e: any) {
        // Ignore fallback
      }
    }
    const fp = path.join(SETTINGS_DIR, 'allowlist.json');
    if (fs.existsSync(fp)) return JSON.parse(fs.readFileSync(fp, 'utf8'));
    return [{ email: 'aswathmantle@gmail.com', role: 'admin' }];
  },
  async getAllowlistUser(email: string) {
    if (db) {
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
    if (db) {
      try {
        await db.collection('allowlist').doc(email).set(entry);
      } catch (e: any) {
        // Ignore fallback
      }
    }
    const fp = path.join(SETTINGS_DIR, 'allowlist.json');
    const list = fs.existsSync(fp) ? JSON.parse(fs.readFileSync(fp, 'utf8')) : [];
    if (!list.find((u: any) => u.email === email)) {
      list.push(entry);
      fs.writeFileSync(fp, JSON.stringify(list, null, 2));
    }
  },
  async removeAllowlistUser(email: string) {
    if (db) {
      try {
        await db.collection('allowlist').doc(email).delete();
      } catch (e: any) {
        // Ignore fallback
      }
    }
    const fp = path.join(SETTINGS_DIR, 'allowlist.json');
    if (fs.existsSync(fp)) {
      let list = JSON.parse(fs.readFileSync(fp, 'utf8'));
      list = list.filter((u: any) => u.email !== email);
      fs.writeFileSync(fp, JSON.stringify(list, null, 2));
    }
  }
}
;

