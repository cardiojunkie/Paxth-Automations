import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { getApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { dbService } from '../src/services/db.js';
import { SettingsRequestSchema } from '../src/server/schemas.js';

type SettingsSummary = {
  attributeSets: number | null;
  withMdRules: number | null;
  selectorPresets: number | null;
  plpSelectorPresets: number | null;
  hasGlobalMappingLogic: boolean;
  firstAttributeSet: string | null;
  lastAttributeSet: string | null;
};

function summarize(settings: any): SettingsSummary {
  const attributeSets = Array.isArray(settings?.attributeSets) ? settings.attributeSets : null;
  const selectorPresets = Array.isArray(settings?.selectorPresets) ? settings.selectorPresets : null;
  const plpSelectorPresets = Array.isArray(settings?.plpSelectorPresets) ? settings.plpSelectorPresets : null;

  return {
    attributeSets: attributeSets ? attributeSets.length : null,
    withMdRules: attributeSets ? attributeSets.filter((set: any) => Boolean(set?.mdRules)).length : null,
    selectorPresets: selectorPresets ? selectorPresets.length : null,
    plpSelectorPresets: plpSelectorPresets ? plpSelectorPresets.length : null,
    hasGlobalMappingLogic: Boolean(settings?.globalMappingLogic),
    firstAttributeSet: attributeSets?.[0]?.name ?? null,
    lastAttributeSet: attributeSets?.[attributeSets.length - 1]?.name ?? null,
  };
}

const mode = process.argv.includes('--write') ? 'write' : 'check';
const settingsPath = path.join(process.cwd(), 'settings', 'app_settings.json');
const firebaseConfigPath = path.join(process.cwd(), 'firebase-applet-config.json');
const localSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
const firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, 'utf8'));

const validatedLocalSettings = SettingsRequestSchema.parse(localSettings);
const validatedAttributeSets = Array.isArray(validatedLocalSettings.attributeSets)
  ? validatedLocalSettings.attributeSets
  : [];
if (!validatedAttributeSets.length || !validatedAttributeSets.some((set: any) => Boolean(set.mdRules))) {
  throw new Error('Settings validation did not preserve attributeSets with mdRules.');
}

async function readRemoteSettings() {
  const databaseId =
    firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== '(default)'
      ? firebaseConfig.firestoreDatabaseId
      : undefined;
  const firestore = getFirestore(getApp(), databaseId);
  const doc = await firestore.collection('settings').doc('app_settings').get();
  return doc.exists ? doc.data()?.data : null;
}

console.log('Local settings:', JSON.stringify(summarize(localSettings), null, 2));

try {
  const remoteSettings = await readRemoteSettings();
  console.log('Remote settings before sync:', JSON.stringify(summarize(remoteSettings), null, 2));
} catch (error: any) {
  console.error('Remote settings before sync: failed to read Firestore:', error?.message || error);
  if (mode === 'write') process.exit(1);
}

if (mode === 'write') {
  await dbService.saveSettings(localSettings);
  console.log('Synced local settings to configured Firestore/local stores.');
}

const resolvedSettings = await dbService.getSettings();
console.log('Resolved settings:', JSON.stringify(summarize(resolvedSettings), null, 2));

try {
  const remoteSettings = await readRemoteSettings();
  console.log('Remote settings after sync:', JSON.stringify(summarize(remoteSettings), null, 2));
} catch (error: any) {
  console.error('Remote settings after sync: failed to read Firestore:', error?.message || error);
  process.exit(1);
}
