import React, { useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../AuthContext';
import { API_BASE } from '../config';
import { firebaseConfigured, prepareFirebase, signInWithGoogle } from '../lib/firebase';

const ERROR_COPY = {
  'auth/operation-not-allowed': 'Google sign-in is not switched on in the Firebase console.',
  'auth/configuration-not-found': 'Firebase Authentication is not set up for this project yet.',
  'auth/unauthorized-domain': 'This address is not in the Firebase authorized domains.',
  'auth/invalid-api-key': 'The Firebase API key in the frontend env file is not valid.',
  'auth/api-key-not-valid.-please-pass-a-valid-api-key.': 'The Firebase API key in the frontend env file is not valid.',
  'auth/popup-blocked': 'The browser blocked the Google popup. Allow popups for this site and try again.',
  'auth/network-request-failed': 'Could not reach Google. Check your connection and try again.',
};

function GoogleMark() {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

export default function GoogleSignInButton({ label = 'Continue with Google', onStatus }) {
  const { setIsLoggedIn } = useContext(AuthContext);
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  useEffect(() => { prepareFirebase(); }, []);

  const handleClick = async () => {
    if (!firebaseConfigured) {
      onStatus?.('Google sign-in is not set up yet. Add the Firebase keys to the frontend env file.', true);
      return;
    }
    setLoading(true);
    try {
      const idToken = await signInWithGoogle();
      const response = await fetch(`${API_BASE}/api/auth/firebase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_token: idToken, remember: true }),
      });
      const text = await response.text();
      const data = text ? JSON.parse(text) : {};
      if (!response.ok) {
        throw new Error(data.detail || `Error ${response.status}`);
      }
      if (data.session_token) {
        localStorage.setItem('authToken', data.session_token);
      }
      onStatus?.(data.is_new ? 'Welcome to MoodScape!' : 'Welcome back!', false);
      setIsLoggedIn(true);
      setTimeout(() => navigate('/generator'), 900);
    } catch (error) {
      const code = error?.code || '';
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        return;
      }
      onStatus?.(ERROR_COPY[code] || error.message || 'Could not sign in with Google.', true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      className="btn-google"
      onClick={handleClick}
      disabled={loading}
    >
      <GoogleMark />
      {loading ? 'Signing In…' : label}
    </button>
  );
}
