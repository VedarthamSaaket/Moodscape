import React, { useEffect, useContext } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { AuthContext } from '../AuthContext';
import { API_BASE } from '../config';

function CallbackPage() {
  const auth = useContext(AuthContext);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    if (!auth) return;
    const { setIsLoggedIn } = auth;

    const spotifyAuthStatus = searchParams.get('spotify_auth');
    const code = searchParams.get('code');

    if (spotifyAuthStatus) {
      if (spotifyAuthStatus === 'success') {
        setIsLoggedIn(true);
        navigate('/generator');
      } else {
        navigate('/');
      }
      return;
    }

    if (code) {
      fetch(`${API_BASE}/api/callback/spotify?code=${code}`)
        .then(async (response) => {
          if (response.ok) {
            const data = await response.json();
            localStorage.setItem('spotify_token', data.access_token);
            setIsLoggedIn(true);
            navigate('/generator');
          } else {
            navigate('/');
          }
        })
        .catch(() => navigate('/'));
      return;
    }

    
    navigate('/');
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
