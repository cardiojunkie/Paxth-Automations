export const apiFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  // Credentials now automatically sent via httpOnly cookie (CORS credentials: true)
  const cfg: RequestInit = init ? { ...init } : {};
  if (typeof input === 'string' && input.startsWith('/api')) {
    cfg.credentials = 'include'; // Send cookies with cross-origin requests
  }
  return fetch(input, cfg);
};
