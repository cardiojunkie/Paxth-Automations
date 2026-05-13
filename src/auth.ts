export const apiFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const cfg: RequestInit = init ? { ...init } : {};
  if (typeof input === 'string' && input.startsWith('/api')) {
    const adminKey = (window as any)._adminKey;
    if (adminKey) {
      if (!cfg.headers) cfg.headers = {};
      if (cfg.headers instanceof Headers) {
        cfg.headers.set('x-admin-key', adminKey);
      } else {
        (cfg.headers as Record<string, string>)['x-admin-key'] = adminKey;
      }
    }
  }
  return fetch(input, cfg);
};
