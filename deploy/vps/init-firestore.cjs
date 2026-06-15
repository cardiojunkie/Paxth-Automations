// Create Firestore database via REST API using service account JWT
// Uses only built-in Node.js modules - no external dependencies needed
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');

const sa = JSON.parse(fs.readFileSync('/app/firebase-service-account.json', 'utf8'));
const PROJECT_ID = sa.project_id;

function base64url(str) {
  return Buffer.from(str).toString('base64url');
}

function base64urlEncode(obj) {
  return base64url(JSON.stringify(obj));
}

function sign(header, payload, privateKey) {
  const input = header + '.' + payload;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(input);
  signer.end();
  const signature = signer.sign(privateKey, 'base64');
  return signature.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Create JWT
const now = Math.floor(Date.now() / 1000);
const header = base64urlEncode({ alg: 'RS256', typ: 'JWT', kid: sa.private_key_id });
const payload = base64urlEncode({
  iss: sa.client_email,
  scope: 'https://www.googleapis.com/auth/cloud-platform',
  aud: sa.token_uri,
  exp: now + 3600,
  iat: now,
});

const jwt = header + '.' + payload + '.' + sign(header, payload, sa.private_key);

// Get access token
function httpsPost(url, body, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = Object.entries(body).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
    const opts = {
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname,
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(data) },
    };
    const req = https.request(opts, (res) => {
      let chunks = '';
      res.on('data', (c) => chunks += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(chunks) }); } 
        catch(e) { resolve({ status: res.statusCode, body: chunks }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function httpsPostJson(url, body, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = JSON.stringify(body);
    const opts = {
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    };
    const req = https.request(opts, (res) => {
      let chunks = '';
      res.on('data', (c) => chunks += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(chunks) }); } 
        catch(e) { resolve({ status: res.statusCode, body: chunks }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

(async () => {
  try {
    console.log('Getting access token...');
    const tokenResp = await httpsPost(sa.token_uri, {
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }, {});
    
    if (!tokenResp.body.access_token) {
      console.error('Failed to get token:', JSON.stringify(tokenResp.body));
      process.exit(1);
    }
    const token = tokenResp.body.access_token;
    console.log('Access token obtained successfully');

    // Create Firestore database
    const DB_ID = 'ai-studio-efa482b0-be5e-4020-b79b-2bf5bb11d6e0';
    const dbUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases?databaseId=${DB_ID}`;
    const dbBody = {
      type: 'FIRESTORE_NATIVE',
      locationId: 'europe-west3',
    };

    console.log('Creating Firestore database...');
    const dbResp = await httpsPostJson(dbUrl, dbBody, {
      Authorization: 'Bearer ' + token,
    });

    console.log('Response status:', dbResp.status);
    console.log('Response body:', JSON.stringify(dbResp.body, null, 2));

    if (dbResp.status === 200 || dbResp.status === 201) {
      console.log('\nSUCCESS: Firestore database created!');
    } else if (dbResp.status === 409 || (dbResp.body && dbResp.body.error && dbResp.body.error.status === 'ALREADY_EXISTS')) {
      console.log('\nDatabase already exists - that is fine!');
    } else {
      console.log('\nUnexpected response - check the error above');
      process.exit(1);
    }
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();