import React, { useState } from 'react';
import useSavedStore from '../store/savedStore';
import usePlayerStore from '../store/playerStore';
import PixelRadio from './saved/PixelRadio.jsx';
import './SavedPage.css';

const RADIO_EMBED_URL =
  'https://www.youtube.com/embed/tRsQsTMvPNg?autoplay=1&rel=0';

export default function SavedPage() {
  const saved       = useSavedStore((s) => s.saved);
  const removeSaved = useSavedStore((s) => s.removeSaved);
  const clearSaved  = useSavedStore((s) => s.clearSaved);
  const playList    = usePlayerStore((s) => s.playList);

  const [radioOn, setRadioOn] = useState(false);

  return (
    <div className="saved-page">
      <aside className="saved-radio-col">
        <PixelRadio on={radioOn} onToggle={() => setRadioOn((v) => !v)} />

        <div className="saved-radio-caption">
          <span className="saved-radio-eyebrow">FM · live</span>
          <span className="saved-radio-title">
            {radioOn ? 'now broadcasting' : 'tap to tune in'}
          </span>
          <span className="saved-radio-sub">
            {radioOn ? '24/7 lofi hip hop radio' : 'a little background while you browse'}
          </span>
        </div>

        {/* Audio source — visually hidden iframe, mounted only when on so the
            stream actually starts. We keep the iframe at real dimensions and
            push it off-screen instead of `display:none`, because some browsers
            suspend hidden iframes' audio. The user sees the animated radio +
            soundwaves; they hear the lofi stream. */}
        {radioOn && (
          <div className="saved-radio-audio" aria-hidden="true">
            <iframe
              src={RADIO_EMBED_URL}
              title="Lofi radio audio"
              width="320"
              height="180"
              frameBorder="0"
              allow="autoplay; encrypted-media"
              tabIndex={-1}
            />
          </div>
        )}
      </aside>

      <section className="saved-main">
        <header className="saved-head">
          <div>
            <div className="saved-eyebrow">Your library</div>
            <h1 className="saved-title">Saved Songs</h1>
            <p className="saved-sub">
              {saved.length
                ? `${saved.length} song${saved.length > 1 ? 's' : ''} kept for later`
                : 'Songs you save from the quiz land here.'}
            </p>
          </div>
          {saved.length > 0 && (
            <div className="saved-actions">
              <button className="saved-btn" onClick={() => playList(saved, 0)}>▶ Play all</button>
              <button className="saved-btn saved-btn--ghost" onClick={clearSaved}>Clear all</button>
            </div>
          )}
        </header>

        {saved.length === 0 ? (
          <div className="saved-empty">
            <span className="saved-empty-glyph">♡</span>
            <p className="saved-empty-line">No saved songs yet.</p>
            <p className="saved-empty-hint">Take the Quiz and tap ♥ on any suggestion to keep it here.</p>
          </div>
        ) : (
          <ul className="saved-list">
            {saved.map((t, i) => (
              <li className="saved-row" key={`${t.spotifyUrl || t.title}-${i}`}>
                <button
                  className="saved-play"
                  onClick={() => playList(saved, i)}
                  title="Play (and queue the rest)"
                  aria-label={`Play ${t.title}`}
                >▶</button>
                {t.albumArt
                  ? <img className="saved-art" src={t.albumArt} alt="" />
                  : <span className="saved-art saved-art--empty">♪</span>}
                <span className="saved-info">
                  <span className="saved-song-title" title={t.title}>{t.title}</span>
                  <span className="saved-song-artist" title={t.artist}>{t.artist}</span>
                </span>
                {t.spotifyUrl && (
                  <a className="saved-ext" href={t.spotifyUrl} target="_blank" rel="noreferrer" title="Open in Spotify">↗</a>
                )}
                <button
                  className="saved-remove"
                  onClick={() => removeSaved(t)}
                  title="Remove from saved"
                  aria-label="Remove from saved"
                >✕</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
