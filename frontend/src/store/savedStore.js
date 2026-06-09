// Saved songs the user keeps to replay later. Backend is the single source of
// truth (table: saved_songs, endpoints under /api/saved) — this store holds a
// runtime mirror only, hydrated from the server on load. No localStorage.
//
// Tracks are kept in the player's track-ish shape ({title, artist, albumArt,
// spotifyUrl}) so they can be handed straight to the GlobalPlayer queue.

import { create } from 'zustand';
import { API_BASE } from '../config';

// Stable identity for a track: prefer the Spotify URL, fall back to title·artist.
export const savedKey = (t) =>
  (t && (t.spotifyUrl || `${t.title || ''}·${t.artist || ''}`)) || '';

const authHeaders = () => {
  const token =
    (typeof localStorage !== 'undefined') && localStorage.getItem('authToken');
  return token
    ? { 'Content-Type': 'application/json', 'X-Session-Token': token }
    : null;
};

const useSavedStore = create((set, get) => ({
  saved: [],            // [{ title, artist, albumArt, spotifyUrl }], newest first
  hydrated: false,      // pulled from server this session

  // Pull the user's saved songs from the server. Source of truth. No-op if
  // logged out or already hydrated this session.
  hydrate: async () => {
    const headers = authHeaders();
    if (!headers || get().hydrated) return;
    try {
      const res = await fetch(`${API_BASE}/api/saved`, { headers });
      if (!res.ok) return;
      const data = await res.json();
      set({ saved: Array.isArray(data.saved) ? data.saved : [], hydrated: true });
    } catch { /* network down — leave empty, retry next session */ }
  },
  resetHydration: () => set({ saved: [], hydrated: false }),

  isSaved: (t) => {
    const k = savedKey(t);
    return get().saved.some((x) => savedKey(x) === k);
  },

  toggleSave: (t) => {
    const k = savedKey(t);
    if (get().saved.some((x) => savedKey(x) === k)) {
      get().removeSaved(t);
      return;
    }
    const clean = {
      title:      t.title || 'Unknown',
      artist:     t.artist || '',
      albumArt:   t.albumArt || null,
      spotifyUrl: t.spotifyUrl || null,
    };
    set((s) => ({ saved: [clean, ...s.saved.filter((x) => savedKey(x) !== k)] })); // optimistic
    const headers = authHeaders();
    if (headers) {
      fetch(`${API_BASE}/api/saved/add`, {
        method: 'POST', headers, body: JSON.stringify(clean),
      }).catch(() => { /* stays local this session; re-synced on next hydrate */ });
    }
  },

  removeSaved: (t) => {
    const k = savedKey(t);
    set((s) => ({ saved: s.saved.filter((x) => savedKey(x) !== k) })); // optimistic
    const headers = authHeaders();
    if (headers) {
      fetch(`${API_BASE}/api/saved/remove`, {
        method: 'POST', headers,
        body: JSON.stringify({ title: t.title, artist: t.artist, spotifyUrl: t.spotifyUrl }),
      }).catch(() => {});
    }
  },

  clearSaved: () => {
    set({ saved: [] });
    const headers = authHeaders();
    if (headers) {
      fetch(`${API_BASE}/api/saved/clear`, { method: 'POST', headers }).catch(() => {});
    }
  },
}));

export default useSavedStore;
