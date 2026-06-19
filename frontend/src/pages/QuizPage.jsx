import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useQuizStore from '../store/quizStore.js';
import usePlayerStore from '../store/playerStore.js';
import useSavedStore from '../store/savedStore.js';
import { QUESTIONS, ARCHETYPES } from './quiz/quizData.js';
import { score } from './quiz/scoreQuiz.js';
import VibeMeter from './quiz/VibeMeter.jsx';
import useQuizImages from './quiz/useQuizImages.js';
import { API_BASE } from '../config';
import './QuizPage.css';

// Phases: intro → question(0..N-1) → result
function QuizPage() {
  const navigate = useNavigate();

  // Pre-fetch all 24 tile images on mount, cached in localStorage. The hook
  // returns whatever it has, so cached images render instantly and any
  // missing ones stream in as Unsplash responds.
  const { images: quizImages } = useQuizImages();

  const {
    answers,
    archetype,
    runnerUp,
    scores,
    confidence,
    runnerUpConfidence,
    margin,
    displayConfidence,
    topMatches,
    completedAt,
    personalSeed,
    dislikedGenres,
    recordAnswer,
    finalize,
    reset,
    setPendingStyleSeed,
    setPersonalSeed,
    setDislikedGenres,
    setPinnedTracks,
    setQuizStyle,
  } = useQuizStore();

  // Phases: intro → question(0..N-1) → seed → dislikes → result.
  // If the user has a completed quiz on file, drop straight into the result.
  const [phase, setPhase] = useState(() => (completedAt ? 'result' : 'intro'));
  const [qIdx, setQIdx] = useState(0);
  const [fading, setFading] = useState(false);

  const currentQ = QUESTIONS[qIdx] || null;
  const selectedOption = useMemo(() => {
    if (!currentQ) return null;
    const rec = answers.find((a) => a.questionId === currentQ.id);
    if (!rec) return null;
    return currentQ.options.find((o) => o.id === rec.optionId) || null;
  }, [answers, currentQ]);

  // Transition helper, short cross-fade matching the rest of the app.
  const advance = (next) => {
    setFading(true);
    setTimeout(() => {
      next();
      setFading(false);
    }, 200);
  };

  const handlePick = (option) => {
    if (!currentQ) return;
    recordAnswer(currentQ.id, option);

    if (qIdx === QUESTIONS.length - 1) {
      // Compute final scoring against the FULL answer set (including the answer
      // we just recorded, which isn't yet in `answers` due to React batching).
      const finalAnswers = [
        ...answers.filter((a) => a.questionId !== currentQ.id),
        { questionId: currentQ.id, optionId: option.id, delta: option.delta },
      ];
      const result = score(finalAnswers);
      finalize({
        scores:             result.scores,
        archetype:          result.archetype,
        runnerUp:           result.runnerUp,
        confidence:         result.confidence,
        runnerUpConfidence: result.runnerUpConfidence,
        margin:             result.margin,
        displayConfidence:  result.displayConfidence,
        topMatches:         result.topMatches,
      });
      advance(() => setPhase('seed'));
    } else {
      advance(() => setQIdx((i) => i + 1));
    }
  };

  // Read the latest store snapshot at click-time. State setters from useStore()
  // close over stale values otherwise — `dislikedGenres` was just set in the
  // dislikes phase and we want THAT list folded into the seed.
  const readStore = () => useQuizStore.getState();

  const handleBack = () => {
    if (qIdx === 0) {
      advance(() => setPhase('intro'));
    } else {
      advance(() => setQIdx((i) => i - 1));
    }
  };

  const handleStart = () => {
    reset();
    setQIdx(0);
    advance(() => setPhase('question'));
  };

  const handleRetake = () => {
    reset();
    setQIdx(0);
    advance(() => setPhase('question'));
  };

  // Button 1 — apply ONLY the archetype style to the next playlist. Clears
  // any pinned songs so the generation is a pure archetype expression.
  const handleUseStyle = () => {
    if (!archetype) return;
    const style = {
      archetype:      archetype.id,
      name:           archetype.name,
      vibePrompt:     archetype.vibePrompt,
      genres:         archetype.genreSeed,
      dislikedGenres: readStore().dislikedGenres || [],
    };
    setPinnedTracks([]);          // pure style, no song carry-over
    setPendingStyleSeed(style);   // one-shot form prefill
    setQuizStyle(style);          // persistent, survives the Spotify redirect
    navigate('/generator');
  };

  // Button 2 — pin selected (or all, if none cherry-picked) recommended songs
  // into the next playlist WITHOUT applying the archetype style. Lets the user
  // ride a few quiz-found tracks into a manually-shaped playlist.
  const handleAddSongsOnly = (allTracks, picked) => {
    const pinned = (picked && picked.length > 0) ? picked : allTracks;
    setPinnedTracks(pinned || []);
    // Do NOT set pendingStyleSeed / quizStyle — songs only, no archetype gloss.
    navigate('/generator');
  };

  // Button 3 — BOTH: apply the archetype style AND carry the songs into the
  // next playlist in one shot. The style seed prefills the generator while the
  // pinned tracks ride along, so generation is archetype-shaped and already
  // seeded with the quiz picks.
  const handleUseBoth = (allTracks, picked) => {
    if (!archetype) return;
    const style = {
      archetype:      archetype.id,
      name:           archetype.name,
      vibePrompt:     archetype.vibePrompt,
      genres:         archetype.genreSeed,
      dislikedGenres: readStore().dislikedGenres || [],
    };
    const pinned = (picked && picked.length > 0) ? picked : allTracks;
    setPinnedTracks(pinned || []);   // songs ride along (style does NOT clear them here)
    setPendingStyleSeed(style);      // one-shot form prefill
    setQuizStyle(style);             // persistent, survives the Spotify redirect
    navigate('/generator');
  };

  // Sync phase if user navigates back here mid-result.
  useEffect(() => {
    if (phase === 'intro' && completedAt) setPhase('result');
  }, [completedAt, phase]);

  // When a new question (or phase) appears, jump back to the top so the prompt
  // is in view — otherwise you stay scrolled down from the previous options.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [qIdx, phase]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <div className={`quiz-shell ${fading ? 'fading' : ''}`}>
        {phase === 'intro' && <Intro onStart={handleStart} hasPrior={!!completedAt} onResume={() => setPhase('result')} />}

        {phase === 'question' && currentQ && (
          <QuestionView
            question={currentQ}
            index={qIdx}
            total={QUESTIONS.length}
            selectedId={selectedOption?.id}
            onPick={handlePick}
            onBack={handleBack}
            images={quizImages}
          />
        )}

        {phase === 'seed' && (
          <SeedView
            initial={personalSeed}
            onSubmit={(text) => { setPersonalSeed(text); advance(() => setPhase('dislikes')); }}
            onSkip={() => { setPersonalSeed(''); advance(() => setPhase('dislikes')); }}
          />
        )}

        {phase === 'dislikes' && (
          <DislikesView
            initial={(dislikedGenres || []).join(', ')}
            onSubmit={(text) => { setDislikedGenres(text); advance(() => setPhase('result')); }}
            onSkip={() => { setDislikedGenres([]); advance(() => setPhase('result')); }}
          />
        )}

        {phase === 'result' && archetype && (
          <ResultView
            archetype={archetype}
            runnerUp={runnerUp}
            scores={scores}
            confidence={confidence}
            runnerUpConfidence={runnerUpConfidence}
            margin={margin}
            displayConfidence={displayConfidence}
            topMatches={topMatches}
            personalSeed={personalSeed}
            onRetake={handleRetake}
            onUseStyle={handleUseStyle}
            onAddSongs={handleAddSongsOnly}
            onUseBoth={handleUseBoth}
          />
        )}

        {phase === 'result' && !archetype && (
          <div className="quiz-card">
            <p className="quiz-meta">Something is off, your saved result is missing. Retake the quiz.</p>
            <button className="quiz-btn-primary" onClick={handleStart}>Begin</button>
          </div>
        )}
      </div>
    </>
  );
}

// ── Sub-views ───────────────────────────────────────────────────────────────

function Intro({ onStart, hasPrior, onResume }) {
  return (
    <div className="quiz-intro">
      <div className="quiz-intro-eyebrow">A short, vibes-led quiz</div>
      <h1 className="quiz-intro-title">
        What <em>vibe</em><br />suits you, really?
      </h1>
      <p className="quiz-intro-body">
        Eight quick choices. No right answers. At the end, an aesthetic that fits, and a playlist
        seed shaped for it.
      </p>
      <div className="quiz-intro-actions">
        <button className="quiz-btn-primary" onClick={onStart}>
          {hasPrior ? 'Retake the quiz' : 'Begin'}
        </button>
        {hasPrior && (
          <button className="quiz-btn-ghost" onClick={onResume}>
            See your last result
          </button>
        )}
      </div>
    </div>
  );
}

function SeedView({ initial, onSubmit, onSkip }) {
  const [text, setText] = useState(initial || '');
  return (
    <div className="quiz-intro quiz-seed-step">
      <div className="quiz-intro-eyebrow">One more thing</div>
      <h1 className="quiz-intro-title">
        Name a song or artist<br />you can’t stop returning to.
      </h1>
      <p className="quiz-intro-body">
        Optional, but it lets us hand you songs that sound like <em>you</em>,
        not just your aesthetic.
      </p>
      <input
        className="quiz-seed-input"
        type="text"
        placeholder="e.g. Phoebe Bridgers, or “Night Changes”…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') onSubmit(text.trim()); }}
        maxLength={120}
        autoFocus
      />
      <div className="quiz-intro-actions">
        <button className="quiz-btn-primary" onClick={() => onSubmit(text.trim())}>
          Reveal my vibe
        </button>
        <button className="quiz-btn-ghost" onClick={onSkip}>
          Skip
        </button>
      </div>
    </div>
  );
}

function DislikesView({ initial, onSubmit, onSkip }) {
  const [text, setText] = useState(initial || '');
  return (
    <div className="quiz-intro quiz-seed-step">
      <div className="quiz-intro-eyebrow">One last thing</div>
      <h1 className="quiz-intro-title">
        Any genre or music type<br />you can’t stand?
      </h1>
      <p className="quiz-intro-body">
        Optional. Whatever you list here gets <em>strictly</em> excluded from
        every playlist we shape from your style — separate multiples with commas.
      </p>
      <input
        className="quiz-seed-input"
        type="text"
        placeholder="e.g. mainstream pop, kpop, russian music…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') onSubmit(text.trim()); }}
        maxLength={200}
        autoFocus
      />
      <div className="quiz-intro-actions">
        <button className="quiz-btn-primary" onClick={() => onSubmit(text.trim())}>
          Reveal my vibe
        </button>
        <button className="quiz-btn-ghost" onClick={onSkip}>
          Skip
        </button>
      </div>
    </div>
  );
}

function QuestionView({ question, index, total, selectedId, onPick, onBack, images }) {
  const progress = ((index + 1) / total) * 100;

  return (
    <div className="quiz-question">
      <div className="quiz-progress">
        <span className="quiz-progress-label">{String(index + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}</span>
        <div className="quiz-progress-track">
          <div className="quiz-progress-fill" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <h2 className="quiz-question-prompt">{question.prompt}</h2>
      <p className="quiz-question-caption">{question.caption}</p>

      {question.kind === 'tile' ? (
        <div className="quiz-tile-grid">
          {question.options.map((opt, i) => {
            const imgUrl = images?.[`${question.id}::${opt.id}`] || null;
            return (
              <button
                key={opt.id}
                type="button"
                className={`quiz-tile ${selectedId === opt.id ? 'is-selected' : ''}`}
                style={{ '--i': i, '--swatch': opt.swatch }}
                onClick={() => onPick(opt)}
              >
                <span className="quiz-tile-swatch">
                  {imgUrl && (
                    <img
                      className="quiz-tile-img"
                      src={imgUrl}
                      alt=""
                      loading="lazy"
                      draggable={false}
                    />
                  )}
                  <span className="quiz-tile-swatch-tint" aria-hidden />
                </span>
                <span className="quiz-tile-label">{opt.label}</span>
                <span className="quiz-tile-whisper">{opt.whisper}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="quiz-likert-row">
          {question.options.map((opt, i) => (
            <button
              key={opt.id}
              type="button"
              className={`quiz-likert ${selectedId === opt.id ? 'is-selected' : ''}`}
              style={{ '--i': i }}
              onClick={() => onPick(opt)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      <div className="quiz-nav-row">
        {index > 0 ? (
          <button className="quiz-btn-ghost" onClick={onBack}>‹ Back</button>
        ) : (
          <button className="quiz-btn-ghost" onClick={onBack}>‹ Restart</button>
        )}
      </div>
    </div>
  );
}

function ResultView({ archetype, runnerUp, scores, confidence, margin, displayConfidence, topMatches, personalSeed, onRetake, onUseStyle, onAddSongs, onUseBoth }) {
  const accent = archetype.accent;
  const gradient = `linear-gradient(110deg, ${accent.from} 0%, ${accent.to} 100%)`;
  const textGradient = {
    backgroundImage: gradient,
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    color: 'transparent',
  };

  const playList = usePlayerStore((s) => s.playList);
  const saved      = useSavedStore((s) => s.saved);
  const toggleSave = useSavedStore((s) => s.toggleSave);
  const savedSet = useMemo(
    () => new Set(saved.map((t) => t.spotifyUrl || `${t.title}·${t.artist}`)),
    [saved]
  );

  const [suggestions, setSuggestions] = useState([]);
  const [loadingSugg, setLoadingSugg] = useState(true);
  const [suggError, setSuggError]     = useState(false);
  const [selected, setSelected]       = useState(() => new Set()); // by spotifyUrl

  // Fetch 2-3 song suggestions shaped by the archetype + the user's seed.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingSugg(true);
      setSuggError(false);
      try {
        const appToken = localStorage.getItem('authToken') || '';
        const res = await fetch(`${API_BASE}/api/quiz/suggestions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Session-Token': appToken },
          body: JSON.stringify({
            archetypeId:   archetype.id,
            archetypeName: archetype.name,
            vibePrompt:    archetype.vibePrompt,
            genreSeed:     archetype.genreSeed,
            languageSeed:  archetype.languageSeed,
            // Archetype-curated Spotify search queries — backend runs these
            // before the generic mood/genre fill so the samples land on the
            // archetype's actual sonic core (e.g. chamber music for Dark
            // Academia rather than an undifferentiated "sad indie" cloud).
            searchSeeds:   archetype.searchSeeds || null,
            personalSeed:  personalSeed || null,
            count:         10,
          }),
        });
        if (!res.ok) throw new Error('bad');
        const data = await res.json();
        if (cancelled) return;
        const tracks = Array.isArray(data.tracks) ? data.tracks : [];
        setSuggestions(tracks);
        // Opt-in: nothing selected by default, the user cherry-picks which
        // songs ride into their next playlist.
        setSelected(new Set());
      } catch {
        if (!cancelled) setSuggError(true);
      } finally {
        if (!cancelled) setLoadingSugg(false);
      }
    })();
    return () => { cancelled = true; };
  }, [archetype, personalSeed]);

  const toggleSelect = (url) => {
    if (!url) return;
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(url)) n.delete(url); else n.add(url);
      return n;
    });
  };

  // Pin only what the user picked. If they picked nothing, pin the whole
  // suggested list — that's the spec for the "use these songs" button.
  const handleAddSongsClick = () => {
    const picks = suggestions.filter((t) => t.spotifyUrl && selected.has(t.spotifyUrl));
    const allWithUri = suggestions.filter((t) => t.spotifyUrl);
    onAddSongs(allWithUri, picks);
  };

  // Both — apply the archetype style AND carry the songs (picked, or all) over.
  const handleBothClick = () => {
    const picks = suggestions.filter((t) => t.spotifyUrl && selected.has(t.spotifyUrl));
    const allWithUri = suggestions.filter((t) => t.spotifyUrl);
    onUseBoth(allWithUri, picks);
  };

  return (
    <div className="quiz-result">
      <div className="quiz-result-eyebrow">Your style reads as</div>
      <h1 className="quiz-result-name" style={textGradient}>{archetype.name}</h1>

      {runnerUp && (
        <p className="quiz-result-runner">
          with a streak of <span style={textGradient}>{runnerUp.name}</span>
        </p>
      )}

      {(() => {
        // The number we show is human-facing certainty (85-97), not the raw
        // 9-way softmax. Older saved results predate displayConfidence — derive
        // the same band from margin so they don't suddenly read differently.
        let pct = displayConfidence;
        if (!Number.isFinite(pct)) {
          if (!Number.isFinite(confidence)) return null;
          const m = Math.max(0, Math.min(1, (margin ?? 0) / 0.35));
          pct = Math.round(85 + m * 11);
        }
        // A genuine blend — the quiz hovered between two-plus styles. Lower end
        // of the band, framed as "you straddle styles," never as a weak result.
        const blend = Array.isArray(topMatches) && topMatches.length > 1;
        const m = margin ?? 0;
        const label = blend
          ? 'A blend of styles'
          : m >= 0.20 ? 'Strong match'
          : m >= 0.08 ? 'Clear match'
          :             'Your match';
        return (
          <p className="quiz-result-confidence">
            {`${label} · ${pct}% you`}
          </p>
        );
      })()}

      {Array.isArray(topMatches) && topMatches.length > 1 && (
        <p className="quiz-result-blend">
          You sit between{' '}
          {topMatches.map((tm, i) => (
            <React.Fragment key={tm.archetype.id}>
              {i > 0 && (i === topMatches.length - 1 ? ' and ' : ', ')}
              <strong>{tm.archetype.name}</strong>
            </React.Fragment>
          ))}
          {'. '}A more complex read than most.
        </p>
      )}

      <p className="quiz-result-blurb">{archetype.blurb}</p>

      <div className="quiz-meter-wrap">
        <VibeMeter scores={scores} accent={accent} />
      </div>

      <div className="quiz-seed-card">
        <div className="quiz-seed-row">
          <span className="quiz-seed-label">Vibe</span>
          <span className="quiz-seed-value">{archetype.vibePrompt}</span>
        </div>
        <div className="quiz-seed-row">
          <span className="quiz-seed-label">Genres</span>
          <span className="quiz-seed-value">{archetype.genreSeed.join(' · ')}</span>
        </div>
      </div>

      {/* ── Song suggestions ─────────────────────────────────────────────── */}
      <div className="quiz-suggest">
        <div className="quiz-suggest-head">
          <span className="quiz-seed-label">Songs picked for you</span>
          {personalSeed && (
            <span className="quiz-suggest-sub">shaped by your taste + “{personalSeed}”</span>
          )}
        </div>

        {loadingSugg && (
          <div className="quiz-suggest-loading"><span className="quiz-spin-ring" /> finding songs…</div>
        )}

        {suggError && !loadingSugg && (
          <div className="quiz-suggest-error">
            Couldn’t load song picks right now, you can still use your style below.
          </div>
        )}

        {!loadingSugg && !suggError && suggestions.length > 0 && (
          <>
            <ul className="quiz-suggest-list">
              {suggestions.map((t, i) => {
                const isSel = t.spotifyUrl && selected.has(t.spotifyUrl);
                const isSaved = savedSet.has(t.spotifyUrl || `${t.title}·${t.artist}`);
                return (
                  <li className="quiz-song-card" key={`${t.spotifyUrl || t.title}-${i}`}>
                    <button
                      className="quiz-song-play"
                      onClick={() => playList(suggestions, i)}
                      title="Play (and queue the rest)"
                      aria-label={`Play ${t.title}`}
                    >▶</button>
                    {t.albumArt
                      ? <img className="quiz-song-art" src={t.albumArt} alt="" />
                      : <span className="quiz-song-art quiz-song-art--empty">♪</span>}
                    <span className="quiz-song-info">
                      <span className="quiz-song-title" title={t.title}>{t.title}</span>
                      <span className="quiz-song-artist" title={t.artist}>{t.artist}</span>
                    </span>
                    <button
                      className={`quiz-song-save ${isSaved ? 'is-on' : ''}`}
                      onClick={() => toggleSave(t)}
                      title={isSaved ? 'Saved — tap to remove' : 'Save for later'}
                      aria-label={isSaved ? 'Remove from saved' : 'Save song'}
                    >
                      {isSaved ? '♥' : '♡'}
                    </button>
                    <button
                      className={`quiz-song-pick ${isSel ? 'is-on' : ''}`}
                      onClick={() => toggleSelect(t.spotifyUrl)}
                      disabled={!t.spotifyUrl}
                      title={isSel ? 'Will be added to your next playlist' : 'Add to your next playlist'}
                    >
                      {isSel ? '✓ added' : '+ add'}
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="quiz-suggest-hint">
              ▶ plays in-app (queues the rest) · ♥ saves to your Saved tab · + add rides into your next playlist
            </p>
          </>
        )}
      </div>

      <div className="quiz-result-actions">
        <button className="quiz-btn-primary" onClick={onUseStyle}>
          Use my style in the next playlist →
        </button>
        <button
          className="quiz-btn-primary"
          onClick={handleAddSongsClick}
          disabled={suggestions.length === 0}
          title={selected.size > 0
            ? `Add the ${selected.size} song${selected.size > 1 ? 's' : ''} you picked into the next playlist`
            : 'Add ALL recommended songs into the next playlist'}
        >
          {selected.size > 0
            ? `Add ${selected.size} song${selected.size > 1 ? 's' : ''} to my next playlist →`
            : 'Add all songs to my next playlist →'}
        </button>
        <button
          className="quiz-btn-primary"
          onClick={handleBothClick}
          disabled={suggestions.length === 0}
          title={selected.size > 0
            ? `Apply your style AND add the ${selected.size} song${selected.size > 1 ? 's' : ''} you picked into the next playlist`
            : 'Apply your style AND add ALL recommended songs into the next playlist'}
        >
          Both
        </button>
        <button className="quiz-btn-ghost" onClick={onRetake}>
          Retake
        </button>
      </div>
    </div>
  );
}

export default QuizPage;
