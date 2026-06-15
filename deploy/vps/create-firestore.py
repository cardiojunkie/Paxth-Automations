#!/usr/bin/env python3
"""Create Firestore database via REST API using service account."""
import json
import sys
import time
import urllib.request
import urllib.parse
import urllib.error

# Read service account
with open('/opt/moosstudio/firebase-service-account.json') as f:
    sa = json.load(f)

# Get access token via OAuth2 JWT bearer
import jwt

now = int(time.time())
payload = {
    'iss': sa['client_email'],
    'scope': 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/datastore',
    'aud': sa['token_uri'],
    'exp': now + 3600,
    'iat': now
}

headers_jwt = {'alg': 'RS256', 'typ': 'JWT', 'kid': sa['private_key_id']}
jwt_token = jwt.encode(payload, sa['private_key'], algorithm='RS256', headers=headers_jwt)

data = urllib.parse.urlencode({
    'grant_type': 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    'assertion': jwt_token
}).encode()

req = urllib.request.Request(sa['token_uri'], data=data)
try:
    resp = urllib.request.urlopen(req)
    token = json.loads(resp.read())['access_token']
    print('Token obtained successfully')
except Exception as e:
    print(f'Failed to get token: {e}')
    sys.exit(1)

# Create Firestore database
DB_ID = 'ai-studio-efa482b0-be5e-4020-b79b-2bf5bb11d6e0'
db_url = 'https://firestore.googleapis.com/v1/projects/' + sa['project_id'] + '/databases?databaseId=' + DB_ID
db_payload = json.dumps({
    'type': 'FIRESTORE_NATIVE',
    'locationId': 'europe-west3'
}).encode()

req = urllib.request.Request(db_url, data=db_payload, method='POST')
req.add_header('Authorization', 'Bearer ' + token)
req.add_header('Content-Type', 'application/json')

try:
    resp = urllib.request.urlopen(req)
    result = json.loads(resp.read())
    print('Firestore database creation response:', json.dumps(result, indent=2))
    print('\nSUCCESS: Firestore database created!')
except urllib.error.HTTPError as e:
    body = e.read().decode()
    print(f'HTTP {e.code}: {body}')
    if 'already exists' in body.lower() or e.code == 409:
        print('\nDatabase already exists - that is fine!')
    elif 'ALREADY_EXISTS' in body:
        print('\nDatabase already exists - that is fine!')
    else:
        sys.exit(1)