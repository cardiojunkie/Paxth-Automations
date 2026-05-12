import { initializeApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut as firebaseSignOut, onAuthStateChanged, User } from 'firebase/auth';
import firebaseConfig from '../firebase-applet-config.json';
import { useEffect, useState } from 'react';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
const provider = new GoogleAuthProvider();

export const signIn = () => signInWithPopup(auth, provider);
export const signOut = () => firebaseSignOut(auth);

// Hook
export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(auth, async (u) => {
      if (u) {
        const token = await u.getIdToken();
        (window as any)._firebaseToken = token;
        setUser(u);
      } else {
        (window as any)._firebaseToken = null;
        setUser(null);
      }
      setLoading(false);
    });
  }, []);

  return { user, loading };
}

export const apiFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const token = (window as any)._firebaseToken;
  const config = init || {};
  if (typeof input === 'string' && input.startsWith('/api') && token) {
    if (!config.headers) config.headers = {};
    if (config.headers instanceof Headers) {
      config.headers.set('Authorization', 'Bearer ' + token);
    } else {
      (config.headers as Record<string, string>)['Authorization'] = 'Bearer ' + token;
    }
  }
  return fetch(input, config);
};
