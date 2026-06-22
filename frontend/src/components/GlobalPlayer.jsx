import React, { useEffect, useRef, useState, useCallback } from 'react';
import usePlayerStore from '../store/playerStore';
import useRadioStore from '../store/radioStore';
import { API_BASE } from '../config';
import './GlobalPlayer.css';

// Radio and the music player are mutually exclusive — starting playback stops
// the lofi radio stream. (The reverse — radio ON pauses the player — lives in
// radioStore.) Called whenever the player actually begins playing.
const stopRadioIfOn = () => {
  try {
    const rs = useRadioStore.getState();
    if (rs.on) rs.setOn(false);
  } catch { /* radio store not ready */ }
};

// ── Load the YouTube IFrame Player API exactly once ──────────────────────────
let ytApiPromise = null;
function loadYouTubeAPI() {
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve) => {
    if (window.YT && window.YT.Player) {
      resolve(window.YT);
      return;
    }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof prev === 'function') prev();
      resolve(window.YT);
    };
    if (!document.getElementById('youtube-iframe-api')) {
      const tag = document.createElement('script');
      tag.id = 'youtube-iframe-api';
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
    }
  });
  return ytApiPromise;
}

// Clean, deterministic vector cover for each track — keeps scraped/unofficial
// YouTube thumbnails out of the UI. Stays in the app's blue palette, with a
// glyph that varies per track so the bar feels alive without photo thumbnails.
const GP_GLYPHS = ['♪', '♫', '♬', '✦', '✧', '◉'];
function TrackArt({ seed = '' }) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const hue   = 198 + (h % 34);          // 198–231 → blues/indigos only
  const hue2  = hue + 14;
  const light = 40 + ((h >> 3) % 12);    // 40–51% lightness for subtle variety
  const glyph = GP_GLYPHS[h % GP_GLYPHS.length];
  const gid   = `gp-art-${hue}-${light}`;
  return (
    <svg className="gp-art-svg" viewBox="0 0 48 48" width="48" height="48" aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={`hsl(${hue} 55% ${light}%)`} />
          <stop offset="1" stopColor={`hsl(${hue2} 60% ${Math.max(16, light - 22)}%)`} />
        </linearGradient>
      </defs>
      <rect width="48" height="48" fill={`url(#${gid})`} />
      <rect width="48" height="48" fill="rgba(0,0,0,0.18)" />
      <circle cx="24" cy="24" r="11" fill="none" stroke="rgba(220,235,255,0.5)" strokeWidth="0.7" />
      <circle cx="24" cy="24" r="6"  fill="none" stroke="rgba(220,235,255,0.38)" strokeWidth="0.6" />
      {/* U+FE0E (text variation selector) forces single-colour text rendering;
          without it iOS substitutes ♪ ♫ ✦ etc. with its colour-emoji font. */}
      <text x="24" y="25.5" textAnchor="middle" dominantBaseline="middle"
        fontFamily="Georgia, serif" fontSize="14" fill="rgba(235,244,255,0.92)">{glyph + '︎'}</text>
    </svg>
  );
}

export default function GlobalPlayer() {
  const queue        = usePlayerStore((s) => s.queue);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const isPlaying    = usePlayerStore((s) => s.isPlaying);
  const isReady      = usePlayerStore((s) => s.isReady);
  const minimized    = usePlayerStore((s) => s.minimized);
  const setReady     = usePlayerStore((s) => s.setReady);
  const setIsPlaying = usePlayerStore((s) => s.setIsPlaying);
  const setVideoId   = usePlayerStore((s) => s.setVideoId);
  const setMinimized = usePlayerStore((s) => s.setMinimized);
  const next         = usePlayerStore((s) => s.next);
  const prev         = usePlayerStore((s) => s.prev);
  const clearQueue   = usePlayerStore((s) => s.clearQueue);

  const hostRef        = useRef(null);   // stable wrapper React owns
  const playerRef      = useRef(null);   // YT.Player instance
  const loadedVideoRef = useRef(null);   // videoId currently loaded/cued
  const lastErrKeyRef  = useRef(null);   // dedupe onError logs to one per track
  const transitioningRef = useRef(false); // true between currentIndex change and first PLAYING — swallows YT's spurious PAUSED tick on video swap
  const skipTimerRef   = useRef(null);   // pending auto-skip timeout
  const failCountRef   = useRef(0);      // consecutive unplayable tracks (loop guard)
  const altsRef        = useRef(new Map());  // trackId -> [alternate embeddable videoIds]
  const triedRef       = useRef(new Map());  // trackId -> Set of videoIds already failed
  const confRef        = useRef(new Map());  // trackId -> { score, label } from resolve
  const playStartRef   = useRef(0);      // ms timestamp PLAYING last fired — drives skip-window classification
  const playEventSentRef = useRef(null); // trackId of the last "play" telemetry already fired (dedupe)
  const replayedRef    = useRef(new Set());  // trackIds that have already triggered a "replay" event this session
  const [status, setStatus] = useState(''); // '', 'resolving', 'unavailable'
  const [confidence, setConfidence] = useState({ score: 0, label: '' }); // for the "best guess" badge
  const [progress, setProgress] = useState({ cur: 0, dur: 0 }); // seconds — for the bar's seek slider

  // ── Telemetry (fire-and-forget) ────────────────────────────────────────────
  // POST a single playback event. Never awaits, never blocks playback. Skip
  // threshold (10s): the player decides skip vs natural-next by comparing
  // elapsed playback time at the moment the user advances. "replay" fires
  // when the same track is loaded a second time within the session.
  const SKIP_CUTOFF_MS = 10_000;
  const sendTelemetry = useCallback((eventType, track, extra = {}) => {
    if (!track) return;
    try {
      const appToken = localStorage.getItem('authToken') || '';
      const conf = confRef.current.get(track.id) || {};
      fetch(`${API_BASE}/api/telemetry/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Session-Token': appToken },
        body: JSON.stringify({
          event_type:       eventType,
          track_id:         track.id || '',
          title:            track.title || '',
          artist:           track.artist || '',
          video_id:         track.videoId || '',
          score:            conf.score || 0,
          confidence_label: conf.label || '',
          elapsed_ms:       extra.elapsedMs || 0,
          timestamp:        Date.now(),
        }),
      }).catch(() => { /* telemetry never blocks playback */ });
    } catch { /* ignore */ }
  }, []);

  const current =
    currentIndex >= 0 && currentIndex < queue.length ? queue[currentIndex] : null;

  // A track couldn't be resolved or its video errored. Advance to the next one
  // so playback keeps flowing — but stop after a full lap so an all-unplayable
  // queue can't spin forever.
  const skipUnplayable = useCallback(() => {
    const st = usePlayerStore.getState();
    const len = st.queue.length;
    failCountRef.current += 1;
    if (len <= 1 || failCountRef.current >= len) {
      failCountRef.current = 0;
      setStatus('unavailable');
      return;
    }
    clearTimeout(skipTimerRef.current);
    skipTimerRef.current = setTimeout(() => next(), 900);
  }, [next]);

  // A loaded video failed — most often code 150: an upload the API SWEARS is
  // embeddable but still blocks playback. Before giving up, try OTHER uploads of
  // the same song: first any alternates we already fetched, then a fresh resolve
  // that excludes every dead id. Only when those run dry do we skip the track.
  const handlePlaybackError = useCallback(async () => {
    const st = usePlayerStore.getState();
    const cur = st.queue[st.currentIndex];
    if (!cur) { skipUnplayable(); return; }
    const tid = cur.id;

    let tried = triedRef.current.get(tid);
    if (!tried) { tried = new Set(); triedRef.current.set(tid, tried); }
    if (loadedVideoRef.current) tried.add(loadedVideoRef.current);

    if (tried.size > 24) { skipUnplayable(); return; }  // bound the hunt — backend serves up to 40 candidates per track

    // 1) An alternate upload we already know about — costs no extra quota.
    const known = (altsRef.current.get(tid) || []).filter((id) => !tried.has(id));
    if (known.length) { loadedVideoRef.current = null; setVideoId(tid, known[0]); return; }

    // 2) Ask the backend for fresh uploads, excluding the dead ones.
    try {
      const appToken = localStorage.getItem('authToken') || '';
      const exclude = encodeURIComponent(Array.from(tried).join(','));
      const dur = cur.durationMs ? `&duration_ms=${cur.durationMs}` : '';
      const res = await fetch(
        `${API_BASE}/api/youtube/resolve?title=${encodeURIComponent(cur.title)}&artist=${encodeURIComponent(cur.artist)}&exclude=${exclude}${dur}`,
        { headers: { 'X-Session-Token': appToken } }
      );
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.candidates)) altsRef.current.set(tid, data.candidates);
        const fresh = (data.candidates || []).filter((id) => !tried.has(id));
        const pick = (data.videoId && !tried.has(data.videoId)) ? data.videoId : (fresh[0] || null);
        if (pick) { loadedVideoRef.current = null; setVideoId(tid, pick); return; }
      }
    } catch { /* fall through to skip */ }

    skipUnplayable();
  }, [skipUnplayable, setVideoId]);

  // ── Create the player once ────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    loadYouTubeAPI().then((YT) => {
      if (cancelled || playerRef.current || !hostRef.current) return;
      // Hand the API a throwaway child so it can replace it without fighting React.
      const mount = document.createElement('div');
      hostRef.current.appendChild(mount);
      playerRef.current = new YT.Player(mount, {
        height: '200',
        width: '200',
        playerVars: { autoplay: 0, controls: 1, playsinline: 1, rel: 0, modestbranding: 1 },
        events: {
          onReady: () => setReady(true),
          onStateChange: (e) => {
            const S = window.YT && window.YT.PlayerState;
            if (!S) return;
            if (e.data === S.ENDED) {
              const st0 = usePlayerStore.getState();
              const ended = st0.queue[st0.currentIndex];
              if (ended) sendTelemetry('complete', ended, { elapsedMs: Date.now() - playStartRef.current });
              next();
            }
            else if (e.data === S.PLAYING) {
              failCountRef.current = 0;
              transitioningRef.current = false;
              stopRadioIfOn();
              setIsPlaying(true);
              // Fire telemetry once per (track, play-start). If this track id
              // already played once this session, classify as a replay instead.
              const st1 = usePlayerStore.getState();
              const t = st1.queue[st1.currentIndex];
              if (t && playEventSentRef.current !== t.id) {
                playEventSentRef.current = t.id;
                playStartRef.current = Date.now();
                const isReplay = replayedRef.current.has(t.id);
                replayedRef.current.add(t.id);
                sendTelemetry(isReplay ? 'replay' : 'play', t);
              }
            }
            else if (e.data === S.PAUSED) {
              // YT emits a spurious PAUSED tick when swapping videos via
              // loadVideoById; ignore it so next/prev don't visibly pause.
              if (transitioningRef.current) return;
              setIsPlaying(false);
            }
          },
          onError: (e) => {
            // YT error codes: 2 = bad/invalid videoId, 5 = HTML5 player error,
            // 100 = video not found / private / removed, 101 & 150 = the owner
            // disabled embedding (official VEVO/label uploads usually do this).
            const code = e && e.data;
            const st = usePlayerStore.getState();
            const cur = st.queue[st.currentIndex];
            // Log only the FIRST error per track — subsequent retries are expected
            // noise (code=150 fallthrough). Quiets the console without losing signal.
            const trackKey = cur ? `${cur.title}|${cur.artist}` : '?';
            if (lastErrKeyRef.current !== trackKey) {
              lastErrKeyRef.current = trackKey;
              console.debug(
                `[GlobalPlayer] YT error code=${code} ("${cur ? cur.title : '?'}" — ${cur ? cur.artist : ''}) — falling through uploads`
              );
            }
            setStatus('resolving');
            handlePlaybackError();
          },
        },
      });
    });
    return () => { cancelled = true; };
    // Player is created exactly once; every handler referenced here is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Resolve (if needed) + cue/load the current track ──────────────────────
  const ensureAndLoad = useCallback(async () => {
    const player = playerRef.current;
    if (!player || !isReady || !current) return;

    let videoId = current.videoId;
    if (!videoId) {
      setStatus('resolving');
      try {
        const appToken = localStorage.getItem('authToken') || '';
        const dur = current.durationMs ? `&duration_ms=${current.durationMs}` : '';
        const res = await fetch(
          `${API_BASE}/api/youtube/resolve?title=${encodeURIComponent(current.title)}&artist=${encodeURIComponent(current.artist)}${dur}`,
          { headers: { 'X-Session-Token': appToken } }
        );
        if (res.ok) {
          const data = await res.json();
          videoId = data.videoId || null;
          if (Array.isArray(data.candidates)) altsRef.current.set(current.id, data.candidates);
          // Stash the resolver's confidence on the track + drive the badge.
          // Cached responses come back with the same shape so the UI is stable
          // whether we hit the cache or just searched.
          const conf = { score: Number(data.confidence) || 0, label: data.confidenceLabel || '' };
          confRef.current.set(current.id, conf);
          setConfidence(conf);
          if (videoId) setVideoId(current.id, videoId);
        }
      } catch { /* network down, fall through to unavailable */ }
    } else {
      // Re-using a cached videoId (page reload / queue hydrate); surface
      // whatever confidence we already knew, blanked otherwise.
      const conf = confRef.current.get(current.id) || { score: 0, label: '' };
      setConfidence(conf);
    }

    if (!videoId) { setStatus('unavailable'); skipUnplayable(); return; }
    setStatus('');

    if (loadedVideoRef.current !== videoId) {
      loadedVideoRef.current = videoId;
      const playing = usePlayerStore.getState().isPlaying;
      try {
        if (playing) player.loadVideoById(videoId);   // autoplays (after a gesture)
        else player.cueVideoById(videoId);            // reload → cued, paused
      } catch { /* player not ready yet */ }
    }
  }, [current, isReady, setVideoId, skipUnplayable]);

  // Track the previous current-track so we can classify a track-swap as a skip
  // (user advanced before SKIP_CUTOFF_MS elapsed). One ref, no extra state.
  const prevTrackRef = useRef(null);
  useEffect(() => {
    const prev = prevTrackRef.current;
    if (prev && prev.id && current && prev.id !== current.id) {
      // Outgoing track was swapped — was it within the skip window?
      const elapsedMs = playStartRef.current ? Date.now() - playStartRef.current : 0;
      if (playStartRef.current && elapsedMs > 0 && elapsedMs < SKIP_CUTOFF_MS) {
        sendTelemetry('skip', prev, { elapsedMs });
      }
    }
    // Hard-stop the previous track BEFORE any async resolve work — without
    // this, the iframe keeps playing the old audio for the duration of the
    // /api/youtube/resolve fetch (or the cached-id round-trip), then
    // abruptly switches. We want immediate silence on a deliberate track
    // change, with the new track easing in once it's ready.
    if (prev && current && prev.id !== current.id) {
      const p = playerRef.current;
      try { p && p.stopVideo && p.stopVideo(); } catch { /* ignore */ }
      loadedVideoRef.current = null;        // force loadVideoById on the new pick
      setProgress({ cur: 0, dur: 0 });      // bar resets immediately, no leftover elapsed
    }

    prevTrackRef.current = current;
    playEventSentRef.current = null;     // arm "play" telemetry for the new track

    clearTimeout(skipTimerRef.current); // drop any stale skip from a prior error
    transitioningRef.current = true;    // swallow YT's transient PAUSED on video swap
    ensureAndLoad();
    // Safety: clear the flag after 4s even if PLAYING never fires (resolve failed,
    // network stall) so a real user pause later still registers.
    const t = setTimeout(() => { transitioningRef.current = false; }, 4000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, isReady, current?.videoId]);

  // ── Keep player play/pause in sync with the store ─────────────────────────
  useEffect(() => {
    const player = playerRef.current;
    if (!player || !isReady || !current) return;
    try {
      if (isPlaying) player.playVideo();
      else player.pauseVideo();
    } catch { /* ignore */ }
  }, [isPlaying, isReady, current]);

  // Poll the YT player for currentTime / duration while playing so the
  // progress bar advances live. 500ms is smooth enough without burning CPU.
  useEffect(() => {
    if (!isReady || !current || !isPlaying) return;
    const id = setInterval(() => {
      const p = playerRef.current;
      if (!p || !p.getCurrentTime) return;
      try {
        const cur = p.getCurrentTime() || 0;
        const dur = p.getDuration() || 0;
        setProgress((prev) => (prev.cur === cur && prev.dur === dur ? prev : { cur, dur }));
      } catch { /* ignore */ }
    }, 500);
    return () => clearInterval(id);
  }, [isReady, current, isPlaying]);

  // Reset the bar to 0 the instant the track switches, so the new song doesn't
  // briefly show the previous song's elapsed time.
  useEffect(() => { setProgress({ cur: 0, dur: 0 }); }, [currentIndex]);

  const seekTo = (sec) => {
    const p = playerRef.current;
    if (!p || !p.seekTo) return;
    try { p.seekTo(sec, true); setProgress((prev) => ({ ...prev, cur: sec })); } catch { /* ignore */ }
  };

  const fmt = (sec) => {
    sec = Math.max(0, Math.floor(sec || 0));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  // Reserve space at the bottom of scroll areas only while the full bar shows.
  useEffect(() => {
    document.body.classList.toggle('has-player', !!current && !minimized);
    return () => document.body.classList.remove('has-player');
  }, [current, minimized]);

  // Direct control for the bar's play button, keeps the click close to the
  // gesture so browsers allow audio to start.
  const togglePlay = () => {
    const player = playerRef.current;
    if (!player || !current) return;
    if (isPlaying) { try { player.pauseVideo(); } catch {} setIsPlaying(false); }
    else { stopRadioIfOn(); try { player.playVideo(); } catch {} setIsPlaying(true); }
  };

  // Hard stop: actually halt the iframe audio, then clear the queue. (clearQueue
  // alone left the audio playing because the pause effect bails when current is
  // null.)
  const stopPlayback = () => {
    const player = playerRef.current;
    try { player && player.stopVideo && player.stopVideo(); } catch { /* ignore */ }
    loadedVideoRef.current = null;
    clearQueue();
  };

  // The iframe is ALWAYS parked off-screen — this is an audio player, the video
  // is never shown. It must stay rendered (not display:none) so audio survives.
  const hostClass = 'gp-host ' + (current ? 'gp-host--collapsed' : 'gp-host--idle');

  return (
    <>
      {/* The YouTube iframe lives here permanently so audio survives navigation. */}
      <div className={hostClass} ref={hostRef} aria-hidden="true" />

      {current && !minimized && (
        <div className="gp-bar" role="region" aria-label="Now playing">
          <div className="gp-meta">
            <div className="gp-art">
              <TrackArt seed={(current.title || '') + '·' + (current.artist || '')} />
            </div>
            <div className="gp-text">
              <span className="gp-title" title={current.title}>
                {current.title}
                {confidence.label === 'low' && (
                  <span
                    className="gp-conf-badge"
                    title={`Best-effort match (confidence ${(confidence.score * 100).toFixed(0)}%) — if this isn't right, hit ⏭`}
                  >
                    best guess
                  </span>
                )}
              </span>
              <span className="gp-artist" title={current.artist}>
                {status === 'resolving' ? 'finding audio…'
                  : status === 'unavailable' ? "couldn't load, skipping…"
                  : current.artist}
              </span>
            </div>
          </div>

          <div className="gp-controls">
            <button className="gp-ctrl gp-glyph" onClick={prev} title="Previous" aria-label="Previous">{'⏮︎'}</button>
            <button className="gp-ctrl gp-ctrl--play gp-glyph" onClick={togglePlay}
              title={isPlaying ? 'Pause' : 'Play'} aria-label={isPlaying ? 'Pause' : 'Play'}>
              {isPlaying ? '⏸︎' : '▶︎'}
            </button>
            <button className="gp-ctrl gp-glyph" onClick={next} title="Next" aria-label="Next">{'⏭︎'}</button>
          </div>

          <div className="gp-right">
            <button className="gp-mini gp-glyph" onClick={stopPlayback} title="Stop" aria-label="Stop playback">{'⏹︎'}</button>
            <button className="gp-mini gp-close gp-glyph" onClick={() => setMinimized(true)}
              title="Minimize" aria-label="Minimize player">{'✕'}</button>
          </div>

          <div className="gp-progress">
            <span className="gp-time gp-time--cur">{fmt(progress.cur)}</span>
            <input
              className="gp-seek"
              type="range"
              min={0}
              max={Math.max(progress.dur || 0, 1)}
              step={1}
              value={Math.min(progress.cur, progress.dur || progress.cur)}
              onChange={(e) => seekTo(Number(e.target.value))}
              style={{ '--gp-fill': `${progress.dur ? (progress.cur / progress.dur) * 100 : 0}%` }}
              aria-label="Seek"
              disabled={!progress.dur}
            />
            <span className="gp-time gp-time--dur">{fmt(progress.dur)}</span>
          </div>
        </div>
      )}

      {current && minimized && (
        <button className="gp-pill" onClick={() => setMinimized(false)}
          title="Show player" aria-label="Show player">
          <span className="gp-pill-art"><TrackArt seed={(current.title || '') + '·' + (current.artist || '')} /></span>
          <span className="gp-pill-text">
            <span className="gp-pill-title">{current.title}</span>
            <span className="gp-pill-tag gp-glyph" aria-label={isPlaying ? 'playing' : 'paused'}>
              <span aria-hidden="true">{(isPlaying ? '▶︎' : '⏸︎') + ' · ⤢︎'}</span>
            </span>
          </span>
        </button>
      )}
    </>
  );
}
