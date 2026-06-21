import React, { useEffect, useContext } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { AuthContext } from '../AuthContext';
import { API_BASE } from '../config';

// A Spotify authorization `code` is single-use: the backend exchanges it with
// Spotify exactly once. React 18 StrictMode (and any remount) runs effects
// TWICE in dev, and even in prod a fast double-render could fire the exchange
// twice. The second exchange of the same code fails ("invalid_grant"), the old
// code did `navigate('/')` on that failure and bounced an already-authenticated
// user back to the landing page — then they'd retry and loop forever. We track
// codes we've already started exchanging at module scope so the second pass is
// a no-op instead of a failing re-exchange.
const handledCodes = new Set();

function CallbackPage() {
  const auth = useContext(AuthContext);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    if (!auth) return;
    const { setIsLoggedIn } = auth;

    // Some deploys redirect straight to the frontend with a status flag instead
    // of a raw code (e.g. backend already did the exchange). Keep supporting it.
    const spotifyAuthStatus = searchParams.get('spotify_auth');
    const code = searchParams.get('code');
    const error = searchParams.get('error'); // Spotify sends ?error=access_denied on cancel

    if (error) { navigate('/generator'); return; }

    if (spotifyAuthStatus) {
      if (spotifyAuthStatus === 'success') {
        // Backend redirected here after exchanging the code. Tokens are in the
        // URL query params — extract and persist them before navigating away.
        const accessToken  = searchParams.get('access_token');
        const refreshToken = searchParams.get('refresh_token');
        const sessionToken = searchParams.get('session_token');

        if (accessToken)  localStorage.setItem('spotify_token', accessToken);
        if (refreshToken) localStorage.setItem('spotify_refresh_token', refreshToken);
        // App session token bridged from the Spotify identity. ONLY set it
        // when no app token exists yet — otherwise a user who signed up
        // with email A and links Spotify under email B would silently
        // swap identities and lose access to their saved_songs/boards/quiz
        // tied to A. Spotify auth is for playback; existing app identity wins.
        if (sessionToken && !localStorage.getItem('authToken')) {
          localStorage.setItem('authToken', sessionToken);
        }

        setIsLoggedIn(true);
        navigate('/generator');
      } else {
        navigate('/generator');
      }
      return;
    }

    if (code) {
      // StrictMode / double-mount guard: never exchange the same code twice.
      if (handledCodes.has(code)) return;
      handledCodes.add(code);

      fetch(`${API_BASE}/api/callback/spotify?code=${encodeURIComponent(code)}`)
        .then(async (response) => {
          if (response.ok) {
            const data = await response.json();
            if (data.access_token) {
              localStorage.setItem('spotify_token', data.access_token);
            }
            if (data.refresh_token) {
              localStorage.setItem('spotify_refresh_token', data.refresh_token);
            }
            // App session token bridged from the Spotify identity. ONLY set it
            // when no app token exists yet — otherwise a user who signed up
            // with email A and links Spotify under email B would silently
            // swap identities and lose access to their saved_songs/boards/quiz
            // tied to A. Spotify auth is for playback; existing app identity wins.
            if (data.session_token && !localStorage.getItem('authToken')) {
              localStorage.setItem('authToken', data.session_token);
            }
            setIsLoggedIn(true);
            navigate('/generator');
          } else {
            // Exchange failed. The user IS still logged into the app (they got
            // here from the authenticated generator). Drop them back on the
            // generator with a flag — NOT the landing page — so they don't get
            // logged out and stuck re-looping. Spotify just isn't linked.
            handledCodes.delete(code); // allow a manual retry to re-exchange
            navigate('/generator?spotify=failed');
          }
        })
        .catch(() => {
          handledCodes.delete(code);
          navigate('/generator?spotify=failed');
        });
      return;
    }

    // No code, no status — nothing to do here. Send to generator if logged in,
    // else the protected route will redirect to sign-in.
    navigate('/generator');
  }, [auth, navigate, searchParams]);

  
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: '#111827',
        color: 'white',
        fontFamily: 'system-ui, sans-serif',
        gap: '1rem',
      }}
    >
      <div className="loading-spinner" />
      <p style={{ fontSize: '1.1rem', color: '#9ca3af' }}>
        Authenticating with Spotify…
      </p>
    </div>
  );
}

export default CallbackPage;
