const CSRF_STORAGE_KEY = 'paxth.csrfToken';

let csrfTokenCache: string | null = null;

export const setCsrfToken = (token: string | null | undefined) => {
  const normalized = typeof token === 'string' && token.trim() ? token.trim() : null;
  csrfTokenCache = normalized;

  if (typeof window === 'undefined') return;
  if (normalized) {
    window.sessionStorage.setItem(CSRF_STORAGE_KEY, normalized);
  } else {
    window.sessionStorage.removeItem(CSRF_STORAGE_KEY);
  }
};

const getCsrfToken = () => {
  if (csrfTokenCache) return csrfTokenCache;
  if (typeof window === 'undefined') return null;
  const stored = window.sessionStorage.getItem(CSRF_STORAGE_KEY);
  csrfTokenCache = stored && stored.trim() ? stored.trim() : null;
  return csrfTokenCache;
};

export const apiFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  // Credentials now automatically sent via httpOnly cookie (CORS credentials: true)
  const cfg: RequestInit = init ? { ...init } : {};
  if (typeof input === 'string' && input.startsWith('/api')) {
    cfg.credentials = 'include'; // Send cookies with cross-origin requests

    const method = (cfg.method || 'GET').toUpperCase();
    const isMutating = method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
    if (isMutating) {
      const token = getCsrfToken();
      if (token) {
        const headers = new Headers(cfg.headers || undefined);
        headers.set('X-CSRF-Token', token);
        cfg.headers = headers;
      }
    }
  }
  return fetch(input, cfg);
};
