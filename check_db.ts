import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';

async function checkDb() {
  const firebaseConfigPath = path.join(process.cwd(), 'firebase-applet-config.json');
  if (fs.existsSync(firebaseConfigPath)) {
    const config = JSON.parse(fs.readFileSync(firebaseConfigPath, 'utf8'));
    if (!admin.apps.length) {
      admin.initializeApp({ projectId: config.projectId });
    }
    const databaseId = config.firestoreDatabaseId !== '(default)' && config.firestoreDatabaseId ? config.firestoreDatabaseId : undefined;
    const db = getFirestore(admin.app(), databaseId);
    
    // Check harvests
    const harvestSnap = await db.collection('harvests').get();
    console.log('Harvests in Firestore: ', harvestSnap.size);
    harvestSnap.docs.forEach((doc, idx) => { if (idx < 5) console.log(' - ' + doc.id); });
    
    // Check master_index
    const masterIdx = await db.collection('settings').doc('master_index').get();
    console.log('Master Index items in Firestore: ', masterIdx.exists ? masterIdx.data()?.data?.length : 'None');
    
    // Check outputs
    const outSnap = await db.collection('outputs').get();
    console.log('Outputs in Firestore: ', outSnap.size);
  } else {
    console.log('No firebase config');
  }
}

checkDb().catch(console.error);
