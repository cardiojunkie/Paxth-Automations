// Test Firestore read/write via Firebase Admin SDK inside container
const admin = require('firebase-admin');

// Check if already initialized
if (admin.apps && admin.apps.length === 0 || !admin.apps) {
  // Newer firebase-admin uses getApps()
  try {
    if (admin.getApps && admin.getApps().length === 0) {
      const sa = require('/app/firebase-service-account.json');
      admin.initializeApp({
        credential: admin.credential.cert(sa),
        databaseId: 'ai-studio-efa482b0-be5e-4020-b79b-2bf5bb11d6e0',
      });
    }
  } catch(e) {
    const sa = require('/app/firebase-service-account.json');
    admin.initializeApp({
      credential: admin.credential.cert(sa),
      databaseId: 'ai-studio-efa482b0-be5e-4020-b79b-2bf5bb11d6e0',
    });
  }
}

const db = admin.firestore();

db.collection('_init_test').doc('_ping').set({
  ts: Date.now(),
  note: 'Firestore initialization ping'
}).then(() => {
  console.log('FIRESTORE OK: Write succeeded, database is active');
  return db.collection('_init_test').doc('_ping').get();
}).then(doc => {
  console.log('FIRESTORE OK: Read-back confirmed, data:', JSON.stringify(doc.data()));
  console.log('Firebase Firestore is fully active!');
}).catch(err => {
  console.error('FIRESTORE ERR:', err.code || err.message || err);
});