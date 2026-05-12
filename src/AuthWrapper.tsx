import React, { useEffect, useState } from 'react';
import { useAuth, signIn, signOut, apiFetch } from './auth';

export default function AuthWrapper({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const [role, setRole] = useState<string | null>(null);
  const [checkingRole, setCheckingRole] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      setCheckingRole(true);
      setError(null);
      
      // Perform a test fetch to an endpoint we just created
      apiFetch('/api/allowlist') // wait, allowlist is admin only.
        .then(()=> {}) // this doesn't help me get my role easily if I'm not admin.
        
      // Instead, let's create a dedicated /api/me endpoint or just wait.
      // Wait, let's make /api/me to return role.
      apiFetch('/api/me')
        .then(async (res) => {
          if (!res.ok) {
            const text = await res.text();
            let data: any = { error: `Server Error ${res.status}` };
            try { data = JSON.parse(text); } catch { /* Ignore HTML */ }
            throw new Error(data.error || "Access Denied");
          }
          const text = await res.text();
          let payload: any = {};
          try { payload = JSON.parse(text); } catch { throw new Error("Invalid response format"); }
          setRole(payload.role);
          (window as any)._userRole = payload.role; // store globally for App.tsx to use
        })
        .catch(err => {
          setError(err.message);
          signOut();
        })
        .finally(() => setCheckingRole(false));
    } else {
      setRole(null);
      setError(null);
      setCheckingRole(false);
    }
  }, [user]);

  if (loading || checkingRole) {
    return <div className="flex h-screen bg-[#050505] text-white items-center justify-center">Loading...</div>;
  }

  if (!user || error) {
    return (
      <div className="flex flex-col h-screen bg-[#050505] text-white items-center justify-center p-4">
        <h1 className="text-2xl font-bold mb-4">Enterprise Access</h1>
        {error && <div className="bg-red-500/20 text-red-400 p-3 rounded mb-4 max-w-sm text-center">{error}</div>}
        <button 
          onClick={async () => {
            if (checkingRole) return;
            setCheckingRole(true);
            setError(null);
            try {
              await signIn();
            } catch (err: any) {
              if (err?.code === 'auth/popup-blocked') {
                setError('Popup blocked by browser. Please allow popups for this site.');
              } else if (err?.code === 'auth/cancelled-popup-request' || err?.code === 'auth/popup-closed-by-user') {
                // User cancelled or we cancelled
              } else {
                setError(err?.message || 'Failed to sign in');
              }
            } finally {
              setCheckingRole(false);
            }
          }}
          disabled={checkingRole}
          className="px-6 py-3 bg-blue-600 hover:bg-blue-500 rounded text-white font-semibold transition-colors disabled:opacity-50"
        >
          {checkingRole ? "Signing In..." : "Sign In with Google"}
        </button>
      </div>
    );
  }

  return <>{children}</>;
}
