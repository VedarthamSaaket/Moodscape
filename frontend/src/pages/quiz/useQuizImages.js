// useQuizImages, fetches one Unsplash photo per tile option in the quiz, caches
// the results in localStorage so the user does not pay the network cost on
// every quiz launch. Falls back gracefully if Unsplash is unavailable; the
// caller can still render the CSS-gradient swatch.
//
// Returns: { images: { [`${questionId}::${optionId}`]: imageUrl }, loaded: bool }
//
// Cache shape (localStorage key 'moodscape-quiz-images-v1'):
//   { [`${questionId}::${optionId}`]: { url, query, fetchedAt } }
//
// Cache TTL: 14 days. Unsplash queries can return slightly different images
// per call but we want stable images so users see the same tiles each time,
// matching their muscle memory.

import { useEffect, useState } from 'react';
import { QUESTIONS } from './quizData.js';

const CACHE_KEY = 'moodscape-quiz-images-v1';
const TTL_MS    = 14 * 24 * 60 * 60 * 1000;
const API_BASE  = import.meta.env.VITE_API_BASE_URL || '';

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeCache(cache) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* quota or private mode, ignore */
  }
}

function isFresh(entry) {
  if (!entry?.url || !entry?.fetchedAt) return false;
  return Date.now() - entry.fetchedAt < TTL_MS;
}

// Build the flat list of every tile option that needs an image.
function collectTargets() {
  const targets = [];
  for (const q of QUESTIONS) {
    if (q.kind !== 'tile') continue;
    for (const opt of q.options) {
      if (!opt.searchQuery) continue;
      targets.push({
        key:   `${q.id}::${opt.id}`,
        query: opt.searchQuery,
      });
    }
  }
  return targets;
}

// Provider keys live on the backend. We call /api/images/search with the
// source we want (Unsplash for aesthetic match, Pexels as fallback) and
// the backend forwards the request with its own credentials.
async function fetchFromProxy(query, source) {
  try {
    const url = `${API_BASE}/api/images/search?query=${encodeURIComponent(query)}&source=${source}&per_page=1&orientation=landscape`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const first = data?.results?.[0];
    return first?.full || first?.thumb || null;
  } catch {
    return null;
  }
}

async function fetchOne(query) {
  return (await fetchFromProxy(query, 'unsplash'))
      || (await fetchFromProxy(query, 'pexels'))
      || null;
}

export default function useQuizImages() {
  const [images, setImages] = useState(() => {
    // Hydrate immediately from cache so cached entries render on first paint.
    const cache = readCache();
    const out = {};
    for (const { key } of collectTargets()) {
      if (isFresh(cache[key])) out[key] = cache[key].url;
    }
    return out;
  });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const targets = collectTargets();
    const cache = readCache();

    // Decide which keys still need a live fetch.
    const stale = targets.filter(({ key }) => !isFresh(cache[key]));
    if (stale.length === 0) {
      setLoaded(true);
      return;
    }

    // Throttle: 4 concurrent requests max so we do not slam Unsplash.
    const queue = [...stale];
    const inflight = new Set();
    const updates = {};

    const next = async () => {
      while (inflight.size < 4 && queue.length > 0 && !cancelled) {
        const item = queue.shift();
        const p = (async () => {
          const url = await fetchOne(item.query);
          if (cancelled) return;
          if (url) {
            updates[item.key] = url;
            setImages((prev) => ({ ...prev, [item.key]: url }));
            // Persist incrementally so a refresh mid-fetch keeps progress.
            const fresh = readCache();
            fresh[item.key] = { url, query: item.query, fetchedAt: Date.now() };
            writeCache(fresh);
          }
        })().finally(() => {
          inflight.delete(p);
          if (queue.length > 0) next();
          else if (inflight.size === 0) setLoaded(true);
        });
        inflight.add(p);
      }
      if (inflight.size === 0 && queue.length === 0) setLoaded(true);
    };
    next();

    return () => { cancelled = true; };
    // Run once on mount, the targets list is static at build time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { images, loaded };
}
