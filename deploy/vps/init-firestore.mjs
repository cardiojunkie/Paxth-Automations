// Create Firestore database via REST API using the service account inside the container
import { GoogleAuth } from 'google-auth-library';

const PROJECT_ID = 'gen-lang-client-0698365856';

async function main() {
  const auth = new GoogleAuth({
    keyFile: '/app/firebase-service-account.json',
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });

  const client = await auth.getClient();
  const accessToken = await client.getAccessToken();
  const token = accessToken.token || accessToken;

  console.log('Access token obtained successfully');

  // Create the Firestore database
  const DB_ID = 'ai-studio-efa482b0-be5e-4020-b79b-2bf5bb11d6e0';
  const dbUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases?databaseId=${DB_ID}`;
  const body = JSON.stringify({
    type: 'FIRESTORE_NATIVE',
    locationId: 'europe-west3',
  });

  const response = await fetch(dbUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body,
  });

  const result = await response.json();
  console.log('Response status:', response.status);
  console.log('Response body:', JSON.stringify(result, null, 2));

  if (response.ok || response.status === 409) {
    console.log('\nSUCCESS: Firestore database is active (or already existed)!');
  } else {
    console.error('\nFAILED to create Firestore database');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  console.error(err.stack);
  process.exit(1);
});