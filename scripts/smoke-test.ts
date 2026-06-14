#!/usr/bin/env tsx
/**
 * Production smoke test. Run after deploy or in CI.
 *
 * Required for authenticated checks:
 *   BASE_URL=https://your-service.example.com
 *   SMOKE_EMAIL=admin@example.com
 *   AUTH_LOGIN_CODE=your-internal-access-code
 */

const BASE_URL = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const SMOKE_EMAIL = process.env.SMOKE_EMAIL || '';
const AUTH_LOGIN_CODE = process.env.AUTH_LOGIN_CODE || process.env.INTERNAL_ACCESS_CODE || '';

let passed = 0;
let failed = 0;

async function check(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  OK  ${label}`);
    passed++;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  FAIL  ${label} - ${msg}`);
    failed++;
  }
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, init);
}

function getCookieHeader(res: Response): string {
  const setCookie = res.headers.get('set-cookie') || '';
  const firstCookie = setCookie.split(',').find((part) => part.trim().startsWith('auth_user='));
  const cookie = (firstCookie || setCookie).split(';')[0].trim();
  if (!cookie.startsWith('auth_user=')) {
    throw new Error('Login response did not set auth_user cookie');
  }
  return cookie;
}

async function run(): Promise<void> {
  console.log(`\nSmoke test -> ${BASE_URL}\n`);

  await check('GET /api/health returns 200 with {status:"ok"}', async () => {
    const res = await request('/api/health');
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    const body = await res.json() as Record<string, unknown>;
    if (body.status !== 'ok') throw new Error(`Unexpected body: ${JSON.stringify(body)}`);
  });

  await check('GET /api/sku/index without auth returns 403', async () => {
    const res = await request('/api/sku/index');
    if (res.status !== 403) throw new Error(`Expected 403, got HTTP ${res.status}`);
  });

  if (SMOKE_EMAIL && AUTH_LOGIN_CODE) {
    let cookie = '';

    await check('POST /api/auth/login accepts allowlisted email plus access code', async () => {
      const res = await request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: SMOKE_EMAIL, accessCode: AUTH_LOGIN_CODE }),
      });
      if (res.status !== 200) {
        const body = await res.text();
        throw new Error(`HTTP ${res.status}: ${body}`);
      }
      cookie = getCookieHeader(res);
      const body = await res.json() as Record<string, unknown>;
      if (body.success !== true) throw new Error(`Unexpected body: ${JSON.stringify(body)}`);
    });

    await check('GET /api/auth/me works with session cookie', async () => {
      const res = await request('/api/auth/me', { headers: { Cookie: cookie } });
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
      const body = await res.json() as Record<string, unknown>;
      if (body.authenticated !== true) throw new Error(`Unexpected body: ${JSON.stringify(body)}`);
    });

    await check('GET /api/sku/index works with session cookie', async () => {
      const res = await request('/api/sku/index', { headers: { Cookie: cookie } });
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    });
  } else {
    console.log('  SKIP authenticated checks (set SMOKE_EMAIL and AUTH_LOGIN_CODE)');
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);

  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Smoke test runner error:', err);
  process.exit(1);
});
