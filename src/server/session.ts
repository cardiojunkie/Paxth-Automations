/**
 * Stateless signed session utilities for v2 authentication.
 *
 * Token format: base64url(json_payload).base64url(hmac_sha256)
 *
 * The payload carries email, role, a unique session ID (sid), issued-at (iat),
 * and expiry (exp). The HMAC signature is verified on every request using
 * constant-time comparison so timing attacks cannot probe validity.
 *
 * CSRF tokens are derived from the session ID using a 1-hour rolling window,
 * so they remain valid ~2 hours without server-side state.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export interface SessionPayload {
  /** Normalized (lowercase) email address. */
  email: string;
  /** Role at time of login — re-verified against allowlist on every authenticated request. */
  role: string;
  /** Unique session identifier — used for CSRF token binding. */
  sid: string;
  /** Unix timestamp ms — issued at. */
  iat: number;
  /** Unix timestamp ms — expires at. */
  exp: number;
}

const SEPARATOR = '.';
const ALGO = 'sha256' as const;

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

let _secret: string | null = null;

export function getSessionSecret(): string {
  if (_secret) return _secret;
  const env = process.env.SESSION_SECRET;
  if (env && env.length >= 32) {
    _secret = env;
    return _secret;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      '[SESSION] SESSION_SECRET must be set to at least 32 characters in production. ' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  // Development fallback: ephemeral key per process start. Sessions won't survive restarts.
  console.warn(
    '[SESSION] SESSION_SECRET not configured — using ephemeral key. ' +
    'Sessions will not survive restarts. Set SESSION_SECRET in .env for persistence.',
  );
  _secret = randomBytes(32).toString('hex');
  return _secret;
}

/**
 * Signs a session payload and returns a compact token plus the full payload
 * (so the caller can extract the sid for CSRF token generation without re-parsing).
 */
export function signSession(
  fields: Pick<SessionPayload, 'email' | 'role'>,
  ttlMs: number = SESSION_TTL_MS,
): { token: string; payload: SessionPayload } {
  const secret = getSessionSecret();
  const now = Date.now();
  const payload: SessionPayload = {
    email: fields.email,
    role: fields.role,
    sid: randomBytes(16).toString('hex'),
    iat: now,
    exp: now + ttlMs,
  };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = createHmac(ALGO, secret).update(data).digest('base64url');
  return { token: `${data}${SEPARATOR}${mac}`, payload };
}

/**
 * Verifies a signed token with constant-time MAC comparison.
 * Returns the payload on success, null on any failure (bad MAC, expired, malformed).
 */
export function verifySession(token: string): SessionPayload | null {
  try {
    const secret = getSessionSecret();
    const dotIdx = token.lastIndexOf(SEPARATOR);
    if (dotIdx === -1) return null;
    const data = token.slice(0, dotIdx);
    const mac = token.slice(dotIdx + 1);
    if (!data || !mac) return null;
    const expectedMac = createHmac(ALGO, secret).update(data).digest('base64url');
    const macBuf = Buffer.from(mac, 'base64url');
    const expBuf = Buffer.from(expectedMac, 'base64url');
    if (macBuf.length !== expBuf.length || !timingSafeEqual(macBuf, expBuf)) return null;
    const payload: SessionPayload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (!payload.email || !payload.sid || !payload.exp) return null;
    if (Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Returns true if the cookie value appears to be a v2 signed token.
 * Signed tokens are base64url.base64url — they never contain '@'.
 */
export function isSignedToken(value: string): boolean {
  return !value.includes('@') && value.includes('.');
}

/**
 * Generates a CSRF token bound to the given session ID.
 * Uses a 1-hour rolling window so the same token is stable within one window
 * and the previous window is also accepted (~2 hours total validity).
 */
export function generateCsrfToken(sid: string): string {
  const secret = getSessionSecret();
  const window = Math.floor(Date.now() / 3_600_000);
  return createHmac(ALGO, secret).update(`csrf:${sid}:${window}`).digest('hex');
}

/**
 * Verifies a CSRF token against a session ID.
 * Accepts both the current and previous 1-hour window.
 */
export function verifyCsrfToken(token: string, sid: string): boolean {
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return false;
  try {
    const secret = getSessionSecret();
    const window = Math.floor(Date.now() / 3_600_000);
    for (const w of [window, window - 1]) {
      const expected = createHmac(ALGO, secret).update(`csrf:${sid}:${w}`).digest('hex');
      const eBuf = Buffer.from(expected, 'hex');
      const tBuf = Buffer.from(token, 'hex');
      if (eBuf.length === tBuf.length && timingSafeEqual(eBuf, tBuf)) return true;
    }
    return false;
  } catch {
    return false;
  }
}
