// Global in-app music player state (Zustand, backend-backed).
//
// Playback is served by the YouTube IFrame Player API, driven by the single
// persistent <GlobalPlayer/> mounted at the app root. This store is the source
// of truth for the queue + which track is current + play/pause; the player
// component reacts to it and controls the actual YouTube iframe.
//
// The queue + currentIndex live in the backend (table: player_queue, endpoints
// under /api/player/queue) — hydrated on load, synced (debounced) on change.
// No localStorage. isPlaying / isReady / minimized are runtime-only; we never
// autoplay on load.

import { create } from 'zustand';
import { API_BASE } from '../config';

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// Normalise any track-ish object into the player's shape.
function toTrack(t) {
  return {
    id:         uid(),
    title:      t.title || 'Unknown',
    artist:     t.artist || '',
    albumArt:   t.albumArt || null,
    spotifyUrl: t.spotifyUrl || null,
    videoId:    t.videoId || null, // resolved lazily on first play
    durationMs: t.durationMs || 0, // Spotify track length — backend uses it to prefer full-length YouTube uploads over remixes/snippets
  };
}

const MAX_QUEUE = 100;

const authHeaders = () => {
  const token =
    (typeof localStorage !== 'undefined') && localStorage.getItem('authToken');
  return token
    ? { 'Content-Type': 'application/json', 'X-Session-Token': token }
    : null;
};

// Debounced best-effort PUT of {queue, currentIndex} to the backend. Coalesces
// rapid changes (next/prev spamming, lazy videoId caching) into one write.
let _syncTimer = null;
function _sync(state) {
  const headers = authHeaders();
  if (!headers) return;
  const body = JSON.stringify({ queue: state.queue, currentIndex: state.currentIndex });
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(() => {
    fetch(`${API_BASE}/api/player/queue`, { method: 'PUT', headers, body }).catch(() => {
      /* offline — server catches up on the next change */
    });
  }, 600);
}

const usePlayerStore = create((set, get) => ({
  queue: [],
  currentIndex: -1,
  isPlaying: false,
  isReady: false,   // YT API ready, runtime only
  minimized: false, // bar collapsed to a floating pill (audio keeps playing)
  hydrated: false,  // queue pulled from the server this session

  setReady:      (v) => set({ isReady: v }),
  setIsPlaying:  (v) => set({ isPlaying: v }),
  setMinimized:  (v) => set({ minimized: v }),

  // Pull the user's stored queue from the server. Source of truth. No-op if
  // logged out, already hydrated, or the user has already started a queue this
  // session (we never clobber live playback).
  hydrate: async () => {
    const headers = authHeaders();
    if (!headers || get().hydrated) return;
    try {
      const res = await fetch(`${API_BASE}/api/player/queue`, { headers });
      if (res.ok) {
        const data = await res.json();
        if (get().queue.length === 0 && Array.isArray(data.queue) && data.queue.length) {
          const ci = Number.isInteger(data.currentIndex) ? data.currentIndex : -1;
          set({ queue: data.queue, currentIndex: Math.min(ci, data.queue.length - 1) });
        }
      }
    } catch { /* offline — keep whatever is local */ }
    set({ hydrated: true });
  },
  // On logout: drop the local mirror WITHOUT syncing (so we never wipe the
  // server copy on the way out).
  resetHydration: () =>
    set({ queue: [], currentIndex: -1, isPlaying: false, minimized: false, hydrated: false }),

  // Play one track immediately. If it's already in the queue, jump to it;
  // otherwise append and jump to the end.
  playNow: (track) => {
    set((s) => {
      const existing = track.spotifyUrl
        ? s.queue.findIndex((t) => t.spotifyUrl === track.spotifyUrl)
        : -1;
      if (existing >= 0) {
        return { currentIndex: existing, isPlaying: true, minimized: false };
      }
      let queue = [...s.queue, toTrack(track)];
      if (queue.length > MAX_QUEUE) queue = queue.slice(queue.length - MAX_QUEUE);
      return { queue, currentIndex: queue.length - 1, isPlaying: true, minimized: false };
    });
    _sync(get());
  },

  // Replace the whole queue and start playing at startIndex.
  // Fast-path: if the incoming tracks match the current queue (same set of
  // spotifyUrls in the same order), just JUMP to startIndex without rebuilding
  // the queue — that preserves the resolved videoIds we already cached, so
  // clicking between tracks in the same playlist doesn't pay a re-resolve cost
  // for every previously-played track.
  playList: (tracks, startIndex = 0) => {
    const incoming = tracks || [];
    if (!incoming.length) return;
    set((s) => {
      const sameQueue =
        s.queue.length === incoming.length &&
        incoming.every((t, i) => {
          const a = t && t.spotifyUrl;
          const b = s.queue[i] && s.queue[i].spotifyUrl;
          return a && b && a === b;
        });
      if (sameQueue) {
        return {
          currentIndex: Math.max(0, Math.min(startIndex, s.queue.length - 1)),
          isPlaying: true,
          minimized: false,
        };
      }
      const q = incoming.map(toTrack);
      return {
        queue: q,
        currentIndex: Math.max(0, Math.min(startIndex, q.length - 1)),
        isPlaying: true,
        minimized: false,
      };
    });
    _sync(get());
  },

  // Append without disturbing what's playing.
  enqueue: (tracks) => {
    set((s) => {
      let queue = [...s.queue, ...(tracks || []).map(toTrack)];
      if (queue.length > MAX_QUEUE) queue = queue.slice(queue.length - MAX_QUEUE);
      return { queue };
    });
    _sync(get());
  },

  playAt: (index) => {
    set((s) =>
      index >= 0 && index < s.queue.length
        ? { currentIndex: index, isPlaying: true, minimized: false }
        : {}
    );
    _sync(get());
  },

  // Wrap around so playback never stops on its own.
  next: () => {
    set((s) => {
      if (!s.queue.length) return {};
      const ni = s.currentIndex + 1 >= s.queue.length ? 0 : s.currentIndex + 1;
      return { currentIndex: ni, isPlaying: true };
    });
    _sync(get());
  },

  prev: () => {
    set((s) => {
      if (!s.queue.length) return {};
      const pi = s.currentIndex - 1 < 0 ? s.queue.length - 1 : s.currentIndex - 1;
      return { currentIndex: pi, isPlaying: true };
    });
    _sync(get());
  },

  // Cache a resolved YouTube videoId onto the matching queue item.
  setVideoId: (trackId, videoId) => {
    set((s) => ({
      queue: s.queue.map((t) => (t.id === trackId ? { ...t, videoId } : t)),
    }));
    _sync(get());
  },

  clearQueue: () => {
    set({ queue: [], currentIndex: -1, isPlaying: false, minimized: false });
    _sync(get()); // user intentionally stopped → persist the empty queue
  },
}));

export default usePlayerStore;
