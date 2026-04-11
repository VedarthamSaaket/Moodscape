import React, { useState, useCallback } from 'react';
import { API_BASE } from '../config';
import Dither from '../assets/Dither';
import "./GeneratorPage.css"

const LANGUAGES = [
  { value: 'English', label: 'English' },
  { value: 'Hindi', label: 'Hindi' },
  { value: 'Telugu', label: 'Telugu' },
  { value: 'Tamil', label: 'Tamil' },
  { value: 'Kannada', label: 'Kannada' },
  { value: 'Malayalam', label: 'Malayalam' },
  { value: 'Punjabi', label: 'Punjabi' },
  { value: 'Bengali', label: 'Bengali' },
  { value: 'Marathi', label: 'Marathi' },
  { value: 'Gujarati', label: 'Gujarati' },
  { value: 'Spanish', label: 'Spanish' },
  { value: 'Korean (K-Pop)', label: 'Korean' },
  { value: 'Japanese (J-Pop)', label: 'Japanese' },
  { value: 'French', label: 'French' },
  { value: 'German', label: 'German' },
  { value: 'Portuguese', label: 'Portuguese' },
  { value: 'Italian', label: 'Italian' },
  { value: 'Arabic', label: 'Arabic' },
  { value: 'Turkish', label: 'Turkish' },
  { value: 'Any / Instrumental', label: 'Instrumental' },
];

const GENRES = [
  { value: 'Pop', label: 'Pop' },
  { value: 'Hip-Hop / Rap', label: 'Hip-Hop' },
  { value: 'Rock', label: 'Rock' },
  { value: 'R&B / Soul', label: 'R&B / Soul' },
  { value: 'Electronic / EDM', label: 'Electronic' },
  { value: 'Jazz', label: 'Jazz' },
  { value: 'Classical', label: 'Classical' },
  { value: 'Lofi / Chill', label: 'Lofi' },
  { value: 'Indie', label: 'Indie' },
  { value: 'Acoustic', label: 'Acoustic' },
  { value: 'Metal', label: 'Metal' },
  { value: 'Folk', label: 'Folk' },
  { value: 'Blues', label: 'Blues' },
  { value: 'Country', label: 'Country' },
  { value: 'Reggae', label: 'Reggae' },
  { value: 'Latin', label: 'Latin' },
  { value: 'Afrobeats', label: 'Afrobeats' },
  { value: 'Ambient', label: 'Ambient' },
  { value: 'Ghazal', label: 'Ghazal' },
  { value: 'Qawwali', label: 'Qawwali' },
  { value: 'Sufi', label: 'Sufi' },
  { value: 'Carnatic', label: 'Carnatic' },
  { value: 'Hindustani', label: 'Hindustani' },
  { value: 'Bhangra / Punjabi', label: 'Bhangra' },
  { value: 'Devotional', label: 'Devotional' },
  { value: 'Indian Folk', label: 'Indian Folk' },
];

const FILM_INDUSTRIES = [
  { value: '', label: 'None / Not a film playlist' },
  { value: 'bollywood', label: 'Bollywood (Hindi)' },
  { value: 'tollywood', label: 'Tollywood (Telugu)' },
  { value: 'kollywood', label: 'Kollywood (Tamil)' },
  { value: 'sandalwood', label: 'Sandalwood (Kannada)' },
  { value: 'mollywood', label: 'Mollywood (Malayalam)' },
];

const PLAYLIST_SIZES = [
  { key: '15-30', label: '15 - 30', sub: 'a tight set' },
  { key: '50-60', label: '50 - 60', sub: 'a solid session' },
  { key: '100-130', label: '100 - 130', sub: 'the full journey' },
];

const MAX_LANGUAGES = 5;

const COVER_PALETTES = [
  { bg: '#060d1a', stops: ['#0d2040', '#1a4a7a', '#2d7aaa', '#60b0e0'] },
  { bg: '#0a0615', stops: ['#1a0a35', '#3a1a6a', '#6a30b0', '#b060e8'] },
  { bg: '#060f0c', stops: ['#0d2520', '#1a5040', '#30906a', '#60d0a0'] },
  { bg: '#150a06', stops: ['#351a0a', '#6a3010', '#b06020', '#e8a040'] },
  { bg: '#0d0610', stops: ['#200d25', '#481a50', '#803090', '#c060c8'] },
  { bg: '#060a15', stops: ['#0d1835', '#1a3060', '#2850a0', '#5080d8'] },
  { bg: '#100d06', stops: ['#251a0d', '#504018', '#907828', '#d0b850'] },
  { bg: '#060d10', stops: ['#0d2028', '#1a4050', '#2a7080', '#50a8b8'] },
];

function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function generateCoverSVG(seed = 0) {
  const palette = COVER_PALETTES[seed % COVER_PALETTES.length];
  const rand = seededRandom(seed * 7919 + 31337);

  const orbs = Array.from({ length: 8 }, () => ({
    cx: Math.floor(rand() * 320) - 10,
    cy: Math.floor(rand() * 320) - 10,
    r: Math.floor(rand() * 120 + 50),
    color: palette.stops[Math.floor(rand() * palette.stops.length)],
    opacity: (rand() * 0.55 + 0.25).toFixed(2),
  }));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">
  <defs>
    <filter id="soft${seed}"><feGaussianBlur stdDeviation="22"/></filter>
  </defs>
  <rect width="300" height="300" fill="${palette.bg}"/>
  <g filter="url(#soft${seed})">
    ${orbs.map(o => `<circle cx="${o.cx}" cy="${o.cy}" r="${o.r}" fill="${o.color}" opacity="${o.opacity}"/>`).join('\n    ')}
  </g>
  <rect width="300" height="300" fill="rgba(0,0,0,0.20)"/>
  <circle cx="150" cy="150" r="38" fill="none" stroke="${palette.stops[2]}" stroke-width="0.6" opacity="0.28"/>
  <circle cx="150" cy="150" r="22" fill="none" stroke="${palette.stops[3]}" stroke-width="0.4" opacity="0.20"/>
  <text x="150" y="155" text-anchor="middle" dominant-baseline="middle"
    font-family="Georgia,serif" font-size="18" fill="${palette.stops[3]}" opacity="0.50" letter-spacing="6">✦</text>
</svg>`;
}

function svgToDataUrl(svgStr) {
  return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgStr)));
}

function LanguagePillSelector({ label, options, selected, onChange }) {
  const toggle = (val) => {
    if (selected.includes(val)) {
      onChange(selected.filter(v => v !== val));
    } else if (selected.length < MAX_LANGUAGES) {
      onChange([...selected, val]);
    }
  };

  return (
    <div className="gen-field">
      <div className="gen-label-row">
        <label className="gen-label">{label}</label>
        {selected.length > 0 && (
          <span className="gen-pill-count">{selected.length} / {MAX_LANGUAGES}</span>
        )}
      </div>
      <div className="gen-pill-grid">
        {options.map(opt => {
          const isActive = selected.includes(opt.value);
          const isMaxed = !isActive && selected.length >= MAX_LANGUAGES;
          return (
            <button
              key={opt.value}
              type="button"
              className={`gen-pill${isActive ? ' gen-pill--active' : ''}${isMaxed ? ' gen-pill--maxed' : ''}`}
              onClick={() => toggle(opt.value)}
            >
              {opt.label}
              {isActive && <span className="gen-pill-check" aria-hidden>✓</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function GenrePillSelector({ label, options, selected, onChange }) {
  const toggle = (val) => {
    if (selected.includes(val)) {
      onChange(selected.filter(v => v !== val));
    } else {
      onChange([...selected, val]);
    }
  };

  return (
    <div className="gen-field">
      <div className="gen-label-row">
        <label className="gen-label">{label}</label>
        {selected.length > 0 && (
          <span className="gen-pill-count">
            {selected.length} selected
            <button
              type="button"
              className="gen-pill-clear"
              onClick={() => onChange([])}
              title="Clear all genres"
            >
              ✕ clear
            </button>
          </span>
        )}
      </div>
      <div className="gen-pill-grid">
        {options.map(opt => {
          const isActive = selected.includes(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              className={`gen-pill${isActive ? ' gen-pill--active' : ''}`}
              onClick={() => toggle(opt.value)}
            >
              {opt.label}
              {isActive && <span className="gen-pill-check" aria-hidden>✓</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SuggestButton({ track, token, playlistId, onAdded, moodText, playlistIntent, selectedLanguages, selectedGenres }) {
  const [state, setState] = useState('idle'); 

  const handleClick = async () => {
    if (state !== 'idle' || !token) return;
    setState('loading');
    try {
      const res = await fetch(`${API_BASE}/api/similar-tracks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          track_title: track.title,
          track_artist: track.artist,
          playlist_id: playlistId || '',
          mood_text: moodText || '',
          playlist_intent: playlistIntent || '',
          language: selectedLanguages?.[0] || null,
          genre: selectedGenres?.[0] || null,
          ignored_uris: Array.from(window.ignoredTrackUris || new Set()) 
        }),
      });

      if (!res.ok) throw new Error('backend error');
      const data = await res.json();
      onAdded && onAdded(data.tracks);
      setState('done');
    } catch {
      setState('error');
      setTimeout(() => setState('idle'), 2200);
    }
  };

  return (
    <button
      type="button"
      className={`gen-suggest-btn gen-suggest-btn--${state}`}
      onClick={handleClick}
      disabled={state === 'loading' || state === 'done'}
      title={
        state === 'done' ? 'Similar tracks added!'
          : state === 'error' ? 'Could not fetch, try again'
            : 'Add 20 similar tracks'
      }
    >
      {state === 'idle' && <WaveIcon />}
      {state === 'loading' && <span className="gen-spin-ring" />}
      {state === 'done' && '✓'}
      {state === 'error' && '!'}
    </button>
  );
}

export default function GeneratorPage() {
  const [moodText, setMoodText] = useState('');
  const [playlistName, setPlaylistName] = useState('');
  const [languages, setLanguages] = useState(['English']);
  const [genres, setGenres] = useState([]);
  const [trackCountRange, setTrackCountRange] = useState('15-30');
  const [playlistIntent, setPlaylistIntent] = useState('');
  const [filmIndustry, setFilmIndustry] = useState('');
  const [movieName, setMovieName] = useState('');
  const [coverSeed, setCoverSeed] = useState(() => Math.floor(Math.random() * COVER_PALETTES.length));

  const [playlist, setPlaylist] = useState(null);
  const [playlistUrl, setPlaylistUrl] = useState(null);
  const [playlistId, setPlaylistId] = useState(null);
  const [playlistNameResult, setPlaylistNameResult] = useState('');
  const [isConnected] = useState(!!localStorage.getItem('spotify_token'));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const token = localStorage.getItem('spotify_token');
  const coverDataUrl = svgToDataUrl(generateCoverSVG(coverSeed));

  const isIndian = [
    'Hindi', 'Telugu', 'Tamil', 'Kannada', 'Malayalam', 'Punjabi', 'Bengali', 'Marathi', 'Gujarati',
  ].some(l => languages.includes(l)) ||
    genres.some(g => [
      'Ghazal', 'Qawwali', 'Sufi', 'Carnatic', 'Hindustani', 'Bhangra / Punjabi',
      'Devotional', 'Indian Folk',
    ].includes(g)) ||
    filmIndustry !== '';

  const handleSpotifyConnect = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/login/spotify`);
      const data = await res.json();
      window.location.href = data.authorization_url;
    } catch {
      setError('Could not connect to Spotify.');
    }
  };

  const randomSeed = () => {
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];
    return `${pick(['melancholic', 'euphoric', 'introspective', 'nostalgic', 'restless', 'dreamy', 'electric', 'raw', 'tender', 'bittersweet'])}, ${pick(['midnight', 'golden hour', 'late afternoon', 'early morning', 'dusk', 'rainy evening', 'sunday noon'])}, ${pick(['driving alone', 'staring out a window', 'a slow walk', 'sitting by water', 'a dimly lit room', 'an empty street'])}`;
  };

  const handleGeneratePlaylist = async (e) => {
    e.preventDefault();
    setError(null);
    setPlaylist(null);
    setPlaylistUrl(null);
    setPlaylistId(null);
    if (!moodText.trim()) { setError('Please describe your mood first.'); return; }

    const newSeed = Math.floor(Math.random() * COVER_PALETTES.length);
    setCoverSeed(newSeed);
    setLoading(true);

    try {
      if (!token) throw new Error('Connect your Spotify account first.');

      const body = {
        moodText: moodText.trim(),
        playlistName: playlistName.trim() || 'Vædarth AI Playlist',
        trackCountRange,
        playlistIntent: playlistIntent.trim() || null,
        filmIndustry: filmIndustry || null,
        movieName: movieName.trim() || null,
        selectedLanguages: languages,
        selectedGenres: genres,
      };

      const response = await fetch(`${API_BASE}/api/create-playlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || err.error || 'Failed to generate playlist');
      }

      const data = await response.json();
      setPlaylist(data.tracks);
      setPlaylistUrl(data.playlist_url);
      setPlaylistId(data.playlist_id || null);
      setPlaylistNameResult(playlistName.trim() || 'Your Playlist');

      if (data.playlist_id) uploadCoverToSpotify(token, data.playlist_id, newSeed);
    } catch (err) {
      setError(err.message || 'Unexpected error');
    } finally {
      setLoading(false);
    }
  };

  const uploadCoverToSpotify = (tok, pid, seed) => {
    setTimeout(() => {
      try {
        const svgStr = generateCoverSVG(seed);
        const blob = new Blob([svgStr], { type: 'image/svg+xml' });
        const blobUrl = URL.createObjectURL(blob);
        const img = new Image();

        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = 300;
          canvas.height = 300;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#000000';
          ctx.fillRect(0, 0, 300, 300);
          ctx.drawImage(img, 0, 0, 300, 300);
          URL.revokeObjectURL(blobUrl);

          const b64 = canvas.toDataURL('image/jpeg', 0.92).split(',')[1];

          fetch(`https://api.spotify.com/v1/playlists/${pid}/images`, {
            method: 'PUT',
            headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'image/jpeg' },
            body: b64,
          })
            .then(async r => {
              if (!r.ok) {
                const t = await r.text();
                console.warn('[COVER] rejected:', r.status, t);
              } else {
                console.log('[COVER] uploaded successfully');
              }
            })
            .catch(e => console.warn('[COVER] fetch error:', e));
        };

        img.onerror = (e) => console.warn('[COVER] SVG failed to load as image:', e);
        img.src = blobUrl;
      } catch (e) {
        console.warn('[COVER] unexpected error:', e);
      }
    }, 800);
  };

  const handleSimilarAdded = useCallback((newTracks) => {
    setPlaylist(prev => [...(prev || []), ...newTracks]);
  }, []);

  const handleRemoveTrack = async (track, index) => {
    
    setPlaylist(prev => prev.filter((_, i) => i !== index));

    
    if (!window.ignoredTrackUris) window.ignoredTrackUris = new Set();
    if (track.spotifyUrl) {
      
      let id = track.spotifyUrl.split('/').pop();
      if (id.includes('?')) id = id.split('?')[0];
      if (id) window.ignoredTrackUris.add(`spotify:track:${id}`);
    }

    if (playlistId && token && track.spotifyUrl) {
      try {
        let trackId = track.spotifyUrl.split('/').pop();
        if (trackId.includes('?')) trackId = trackId.split('?')[0];
        if(!trackId) return;

        await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            tracks: [{ uri: `spotify:track:${trackId}` }]
          })
        });
      } catch (err) {
        console.warn('Failed to remove from Spotify playlist', err);
      }
    }
  };

  return (
    <>
      {}
      <div className="gen-beams-bg">
        <Dither
          waveColor={[0.18, 0.36, 0.52]}
          waveSpeed={0.04}
          waveFrequency={3}
          waveAmplitude={0.3}
          colorNum={5}
          pixelSize={2}
          disableAnimation={false}
          enableMouseInteraction={false}
        />
      </div>

      <div className="gen-card">

        {}
        <div className="gen-header">
          <div className="gen-eyebrow">Vædarth · AI Curator</div>
          <h1 className="gen-title">Playlist<br />Generator</h1>
          <p className="gen-subtitle">
            Please tell us how you feel. We'll compose the soundtrack for you :D
          </p>
          <div className="gen-title-rule" />
        </div>

        {/* Spotify connect */}
        {!isConnected && (
          <div className="gen-connect-block">
            <div className="gen-connect-inner">
              <SpotifyIcon size={28} />
              <div>
                <p className="gen-connect-heading">Connect Spotify to begin</p>
                <p className="gen-connect-sub">We'll generate a playlist and save it directly to your library.</p>
              </div>
            </div>
            <button className="btn-spotify-connect" onClick={handleSpotifyConnect}>
              <SpotifyIcon size={15} />
              Authenticate with Spotify
            </button>
          </div>
        )}

        {}
        {isConnected && (
          <form className="gen-form" onSubmit={handleGeneratePlaylist}>

            {}
            <div className="gen-field">
              <label className="gen-label">Describe your mood</label>
              <textarea
                className="gen-textarea"
                rows={4}
                placeholder="e.g. calm, nostalgic, like driving at 2am with the windows down…"
                value={moodText}
                onChange={e => setMoodText(e.target.value)}
                required
              />
            </div>

            {}
            <div className="gen-field">
              <label className="gen-label">
                Playlist intent <span className="gen-label-optional">(optional)</span>
              </label>
              <input
                className="gen-input"
                type="text"
                placeholder="e.g. to feel better about myself, study session, late night drive…"
                value={playlistIntent}
                onChange={e => setPlaylistIntent(e.target.value)}
              />
              <p className="gen-field-hint">
                Narrows the focus, combines your mood with a purpose.
              </p>
            </div>

            {}
            <div className="gen-name-cover-row">
              <div className="gen-field gen-name-field">
                <label className="gen-label">Playlist name</label>
                <input
                  className="gen-input"
                  type="text"
                  placeholder="Optional name…"
                  value={playlistName}
                  onChange={e => setPlaylistName(e.target.value)}
                />
              </div>
              <div className="gen-cover-col">
                <label className="gen-label">Cover</label>
                <div className="gen-cover-thumb-wrap">
                  <img src={coverDataUrl} alt="cover preview" className="gen-cover-thumb" />
                  <button
                    type="button"
                    className="gen-cover-reroll"
                    onClick={() => setCoverSeed(s => (s + 1) % COVER_PALETTES.length)}
                    title="Try another"
                  >↻</button>
                </div>
              </div>
            </div>

            {}
            <LanguagePillSelector
              label="Language"
              options={LANGUAGES}
              selected={languages}
              onChange={setLanguages}
            />

            {}
            <GenrePillSelector
              label="Genre"
              options={GENRES}
              selected={genres}
              onChange={setGenres}
            />

            {}
            {isIndian && (
              <div className="gen-indian-block">
                <p className="gen-indian-heading">🎬 Indian Film Options</p>
                <div className="gen-row">
                  <div className="gen-field">
                    <label className="gen-label">Film industry</label>
                    <div className="gen-select-wrap">
                      <select
                        className="gen-select"
                        value={filmIndustry}
                        onChange={e => setFilmIndustry(e.target.value)}
                      >
                        {FILM_INDUSTRIES.map(f => (
                          <option key={f.value} value={f.value}>{f.label}</option>
                        ))}
                      </select>
                      <ChevronIcon />
                    </div>
                  </div>
                  <div className="gen-field">
                    <label className="gen-label">
                      Movie / album <span className="gen-label-optional">(optional)</span>
                    </label>
                    <input
                      className="gen-input"
                      type="text"
                      placeholder="e.g. Pushpa, RRR, Jawan…"
                      value={movieName}
                      onChange={e => setMovieName(e.target.value)}
                    />
                  </div>
                </div>
                <p className="gen-field-hint">
                  A movie name seeds the playlist with its soundtrack, then fills remaining slots mood-matched.
                </p>
              </div>
            )}

            {}
            <div className="gen-field">
              <label className="gen-label">Playlist size</label>
              <div className="gen-range-pills">
                {PLAYLIST_SIZES.map(({ key, label, sub }) => (
                  <button
                    key={key}
                    type="button"
                    className={`gen-range-pill${trackCountRange === key ? ' gen-range-pill--active' : ''}`}
                    onClick={() => setTrackCountRange(key)}
                  >
                    <span className="gen-range-pill-label">{label}</span>
                    <span className="gen-range-pill-sub">{sub}</span>
                  </button>
                ))}
              </div>
            </div>

            <button
              type="submit"
              className={`btn-generate${loading ? ' btn-generate--loading' : ''}`}
              disabled={loading}
            >
              {loading
                ? <><span className="gen-spinner" />Composing your playlist…</>
                : <><MusicIcon />Generate Playlist</>}
            </button>
          </form>
        )}

        {error && <div className="gen-error">{error}</div>}

        {}
        {playlist && (
          <div className="gen-results">
            <div className="gen-results-header">
              <div className="gen-results-left">
                <img src={coverDataUrl} alt="playlist cover" className="gen-results-cover" />
                <div>
                  <h2 className="gen-playlist-title">{playlistNameResult}</h2>
                  <p className="gen-playlist-meta">{playlist.length} tracks</p>
                </div>
              </div>
              {playlistUrl && (
                <a className="btn-open-spotify" href={playlistUrl} target="_blank" rel="noopener noreferrer">
                  <SpotifyIcon size={14} />
                  Open in Spotify
                  <ArrowIcon />
                </a>
              )}
            </div>

            <ul className="gen-tracklist">
              {playlist.map(({ title, artist, albumArt, spotifyUrl }, i) => (
                <li
                  className="gen-track"
                  key={`${title}-${artist}-${i}`}
                  style={{ '--i': i }}
                >
                  <a
                    className="gen-track-inner"
                    href={spotifyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span className="gen-track-num">{String(i + 1).padStart(2, '0')}</span>
                    {albumArt && (
                      <img className="gen-track-art" src={albumArt} alt={`${title} cover`} />
                    )}
                    <span className="gen-track-info">
                      <span className="gen-track-title">{title}</span>
                      <span className="gen-track-artist">{artist}</span>
                    </span>
                    <span className="gen-track-arrow">↗</span>
                  </a>
                  <button 
                    type="button" 
                    className="gen-track-remove" 
                    onClick={() => handleRemoveTrack({ title, artist, spotifyUrl }, i)}
                    title="Remove track"
                  >
                    ✕
                  </button>
                  <SuggestButton
                    track={{ title, artist }}
                    token={token}
                    playlistId={playlistId}
                    onAdded={handleSimilarAdded}
                    moodText={moodText}
                    playlistIntent={playlistIntent}
                    selectedLanguages={languages}
                    selectedGenres={genres}
                  />
                </li>
              ))}
            </ul>

            <p className="gen-suggest-hint">
              <WaveIcon /> tap the wave icon on any track to add up to 20 similar songs
            </p>
          </div>
        )}
      </div>
    </>
  );
}

const SpotifyIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
  </svg>
);

const MusicIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 18V5l12-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="16" r="3" />
  </svg>
);

const ChevronIcon = () => (
  <svg width="11" height="7" viewBox="0 0 12 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <path d="M1 1l5 5 5-5" />
  </svg>
);

const ArrowIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 13L13 3M7 3h6v6" />
  </svg>
);

const WaveIcon = () => (
  <svg width="14" height="12" viewBox="0 0 18 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
    <path d="M1 7 Q4 1 7 7 Q10 13 13 7 Q15 3.5 17 2" />
    <path d="M14.5 2 L17 2 L17 4.5" />
  </svg>
);
