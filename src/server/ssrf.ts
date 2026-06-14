// SSRF-protection helpers — safe URL validation before browser navigation

import dns from 'node:dns/promises';
import net from 'node:net';

export function isPrivateIpAddress(host: string): boolean {
  const ipVersion = net.isIP(host);
  if (ipVersion === 4) {
    const parts = host.split('.').map(Number);
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a >= 224) return true;
    if (a === 0) return true;
    return false;
  }

  if (ipVersion === 6) {
    const normalized = host.toLowerCase();
    if (normalized === '::') return true;
    if (normalized === '::1') return true;
    if (normalized.startsWith('::ffff:')) {
      const mappedV4 = normalized.slice('::ffff:'.length);
      if (net.isIP(mappedV4) === 4) return isPrivateIpAddress(mappedV4);
    }
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
    if (normalized.startsWith('fe80')) return true;
    return false;
  }

  return false;
}

export async function assertSafeTargetUrl(inputUrl: string): Promise<void> {
  const parsed = new URL(inputUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http/https URLs are allowed');
  }

  const host = parsed.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '::1') {
    throw new Error('Localhost targets are not allowed');
  }

  if (net.isIP(host) && isPrivateIpAddress(host)) {
    throw new Error('Private network targets are not allowed');
  }

  try {
    const records = await dns.lookup(host, { all: true });
    if (records.some((record) => isPrivateIpAddress(record.address))) {
      throw new Error('Resolved target points to a private network address');
    }
  } catch (e: any) {
    if (e?.message?.includes('private network')) {
      throw e;
    }
    console.warn(`[SERVER] DNS lookup warning for ${host}: ${e?.message || 'lookup failed'}`);
  }
}

export async function assertSafeBrowserRequestUrl(inputUrl: string): Promise<void> {
  const parsed = new URL(inputUrl);
  if (['http:', 'https:'].includes(parsed.protocol)) {
    await assertSafeTargetUrl(inputUrl);
    return;
  }
  if (['about:', 'data:', 'blob:'].includes(parsed.protocol)) {
    return;
  }
  throw new Error('Browser request protocol is not allowed');
}
