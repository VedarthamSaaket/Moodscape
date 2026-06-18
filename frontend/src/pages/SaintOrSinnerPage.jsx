import React, { useState } from 'react';
import { FIGURES, ROUND_COUNT, SPECTRUM, repBand } from './quiz/saintOrSinnerData.js';
import useSaintStore, { vibeScoreOf, vibeRank } from '../store/saintStore.js';
import './QuizPage.css';        // shared shell + button + intro/progress styles
import './SaintOrSinner.css';   // game-specific: slider, options, reveal spectrum

// ── helpers ──────────────────────────────────────────────────────────────────
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const proximity = (user, rep) => 100 - Math.abs(user - rep); // 0..100, higher = closer

function summarise(results) {
  const n = results.length || 1;
  const accuracy = Math.round(results.reduce((s, r) => s + proximity(r.user, r.reputation), 0) / n);
  const bias = Math.round(results.reduce((s, r) => s + (r.user - r.reputation), 0) / n);

  let read;
  if (accuracy >= 80) read = 'In tune with the world';
  else if (accuracy >= 60) read = 'Roughly fair';
  else read = 'Out of step with the crowd';

  let lean;
  if (bias > 12) lean = 'You judge softer than the public, a forgiving sort.';
  else if (bias < -12) lean = 'You judge harsher than the public, a tough jury.';
  else lean = 'And you call it almost exactly down the middle.';

  return { accuracy, bias, total: results.length, read, lean };
}

// Phases: intro → round (judge → guess → reveal) → summary
function SaintOrSinnerPage() {
  const { runs, roundsTotal, proximityTotal, guessTotal, recordRun } = useSaintStore();
  const vibeScore = vibeScoreOf({ roundsTotal, proximityTotal, guessTotal });
  const rank = vibeRank(vibeScore);

  const [phase, setPhase] = useState('intro');
  const [deck, setDeck] = useState([]);
  const [idx, setIdx] = useState(0);
  const [step, setStep] = useState('judge');
  const [value, setValue] = useState(50);
  const [results, setResults] = useState([]);
  const [fading, setFading] = useState(false);

  const current = deck[idx] || null;

  // Short cross-fade between steps, matching the rest of the app.
  const advance = (fn) => {
    setFading(true);
    setTimeout(() => {
      fn();
      setFading(false);
    }, 200);
  };

  const begin = () => {
    setDeck(shuffle(FIGURES).slice(0, ROUND_COUNT));
    setIdx(0);
    setStep('judge');
    setValue(50);
    setResults([]);
    advance(() => setPhase('round'));
  };

  const lockVerdict = () => {
    if (!current) return;
    setResults((rs) => [
      ...rs,
      {
        id: current.id,
        name: current.name,
        user: value,
        reputation: current.reputation,
      },
    ]);
    advance(() => setStep('reveal'));
  };

  const next = () => {
    if (idx >= deck.length - 1) {
      const { accuracy, total } = summarise(results);
      recordRun({ accuracy, guesses: 0, total });
      advance(() => setPhase('summary'));
    } else {
      advance(() => {
        setIdx((i) => i + 1);
        setStep('judge');
        setValue(50);
      });
    }
  };

  return (
    <div className={`quiz-shell ${fading ? 'fading' : ''}`}>
      {/* Per-account uniqueness post-it — visible when the player is not
          actively mid-round, so it never distracts from a live judgement.
          Stats are backend-keyed by auth token, so each account sees only
          their own running totals. */}
      {(phase === 'intro' || phase === 'summary') && (
        <UniquenessPostit vibeScore={vibeScore} runs={runs} />
      )}

      {phase === 'intro' && (
        <Intro onStart={begin} runs={runs} vibeScore={vibeScore} rank={rank} />
      )}

      {phase === 'round' && current && (
        <>
          <Progress index={idx} total={deck.length} />

          {step === 'judge' && (
            <JudgeStep figure={current} value={value} onChange={setValue} onLock={lockVerdict} />
          )}

          {step === 'reveal' && (
            <RevealStep
              figure={current}
              value={value}
              isLast={idx >= deck.length - 1}
              onNext={next}
            />
          )}
        </>
      )}

      {phase === 'summary' && (
        <Summary results={results} onReplay={begin} vibeScore={vibeScore} rank={rank} runs={runs} />
      )}
    </div>
  );
}

// ── sub-views ─────────────────────────────────────────────────────────────────

// Per-account uniqueness chip, rendered as a tilted post-it stuck to the wall
// on the left of the page. `vibeScore` is the % of times the player matched
// the crowd; `100 − vibeScore` is therefore how much their reads diverge from
// public opinion. Saint stats are per-user on the backend, so this surfaces
// the individual's running uniqueness across every account login.
function UniquenessPostit({ vibeScore, runs }) {
  if (!runs) return null;
  const uniqueness = Math.max(0, Math.min(100, 100 - vibeScore));
  let read;
  if (uniqueness >= 50) read = 'sharply your own';
  else if (uniqueness >= 30) read = 'often off-script';
  else if (uniqueness >= 15) read = 'mostly with the crowd';
  else read = 'almost exactly the crowd';
  return (
    <aside className="sns-postit" aria-label="Your judgement uniqueness vs the crowd">
      <span className="sns-postit-tape" aria-hidden="true" />
      <div className="sns-postit-eyebrow">your read · vs the crowd</div>
      <div className="sns-postit-num">{uniqueness}<span className="sns-postit-pct">%</span></div>
      <div className="sns-postit-sub">uniquely yours</div>
      <div className="sns-postit-foot">
        <div>{vibeScore}% in tune with the public</div>
        <div>{read}</div>
        <div>across {runs} {runs === 1 ? 'run' : 'runs'}</div>
      </div>
    </aside>
  );
}

// Persistent lifetime meter: how good a "vibe guesser" the player is — i.e. how
// sharply they read strangers, accumulated across every run.
function VibeGuesserMeter({ score, rank, runs, variant }) {
  return (
    <div className={`sns-vibe${variant ? ` sns-vibe--${variant}` : ''}`} style={{ '--vibe': `${score}%` }}>
      <div className="sns-vibe-head">
        <span className="sns-vibe-label">Vibe Guesser</span>
        <span className="sns-vibe-value"><strong>{score}</strong> · {rank.label}</span>
      </div>
      <div className="sns-vibe-track">
        <div className="sns-vibe-fill" style={{ width: `${score}%` }} />
      </div>
      <p className="sns-vibe-sub">
        how sharply you read people — across {runs} {runs === 1 ? 'round' : 'rounds'}
      </p>
    </div>
  );
}

function Intro({ onStart, runs, vibeScore, rank }) {
  return (
    <div className="quiz-intro">
      <div className="quiz-intro-eyebrow">A blind game of reputation</div>
      <h1 className="quiz-intro-title">
        Saint or <em>Sinner?</em>
      </h1>
      <p className="quiz-intro-body">
        A few cryptic facts. One stranger. You decide where they fall, from
        reviled to revered, <em>before</em> you know who it is. Then see how
        the world really judges them.
      </p>
      {runs > 0 && <VibeGuesserMeter score={vibeScore} rank={rank} runs={runs} />}
      <div className="quiz-intro-actions">
        <button className="quiz-btn-primary" onClick={onStart}>
          {runs > 0 ? 'Play again' : 'Take the stand'}
        </button>
      </div>
    </div>
  );
}

function Progress({ index, total }) {
  const pct = ((index + 1) / total) * 100;
  return (
    <div className="quiz-progress">
      <span className="quiz-progress-label">
        {String(index + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}
      </span>
      <div className="quiz-progress-track">
        <div className="quiz-progress-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function JudgeStep({ figure, value, onChange, onLock }) {
  const band = repBand(value);
  return (
    <div className="sns-round">
      <h2 className="sns-prompt">Sinner, saint, or somewhere between?</h2>
      <p className="sns-caption">Read the facts. Slide your verdict before the name drops.</p>

      <ul className="sns-traits">
        {figure.traits.map((t, i) => (
          <li key={i} className="sns-trait" style={{ '--i': i }}>{t}</li>
        ))}
      </ul>

      <div className="sns-slider-block">
        <div className="sns-slider-ends">
          <span className="sns-end sns-end-low">{SPECTRUM.low}</span>
          <span className="sns-verdict-live" style={{ color: band.color }}>{band.label}</span>
          <span className="sns-end sns-end-high">{SPECTRUM.high}</span>
        </div>
        <input
          type="range"
          className="sns-slider"
          min={SPECTRUM.min}
          max={SPECTRUM.max}
          value={value}
          aria-label="Your verdict, from sinner to saint"
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ '--pct': `${value}%`, '--accent': band.color }}
        />
      </div>

      <div className="sns-actions">
        <button className="quiz-btn-primary" onClick={onLock}>Lock in my verdict</button>
      </div>
    </div>
  );
}

function RevealStep({ figure, value, isLast, onNext }) {
  const worldBand = repBand(figure.reputation);
  const gap = Math.abs(value - figure.reputation);

  let verdictLine;
  if (gap <= 8) verdictLine = 'Almost exactly how the world sees them.';
  else if (value > figure.reputation) verdictLine = `You were ${gap} points kinder than the public.`;
  else verdictLine = `You were ${gap} points harsher than the public.`;

  return (
    <div className="sns-reveal">
      <div className="sns-reveal-eyebrow">{figure.era}</div>
      <h1 className="sns-reveal-name">{figure.name}</h1>

      <div className="sns-chip" style={{ '--chip': worldBand.color }}>
        {figure.verdict} · the world says {figure.reputation}/100
      </div>

      <SpectrumBar you={value} world={figure.reputation} worldColor={worldBand.color} />
      <p className="sns-gap-line">{verdictLine}</p>

      <p className="sns-reveal-blurb">{figure.reveal}</p>

      <div className="sns-actions">
        <button className="quiz-btn-primary" onClick={onNext}>
          {isLast ? 'See your verdict' : 'Next stranger'}
        </button>
      </div>
    </div>
  );
}

// Horizontal Sinner↔Saint track with two markers: the player and the world.
function SpectrumBar({ you, world, worldColor }) {
  return (
    <div className="sns-spectrum">
      <div className="sns-spectrum-track">
        <span
          className="sns-marker sns-marker-you"
          style={{ left: `${you}%` }}
          title={`You: ${you}`}
        >
          <span className="sns-marker-dot" />
          <span className="sns-marker-label">You · {you}</span>
        </span>
        <span
          className="sns-marker sns-marker-world"
          style={{ left: `${world}%`, '--world': worldColor }}
          title={`The world: ${world}`}
        >
          <span className="sns-marker-dot" />
          <span className="sns-marker-label">World · {world}</span>
        </span>
      </div>
      <div className="sns-spectrum-ends">
        <span>{SPECTRUM.low}</span>
        <span>{SPECTRUM.high}</span>
      </div>
    </div>
  );
}

function Summary({ results, onReplay, vibeScore, rank, runs }) {
  const { accuracy, total, read, lean } = summarise(results);
  return (
    <div className="quiz-result">
      <div className="quiz-result-eyebrow">The verdict on your judgement</div>
      <h1 className="sns-summary-title">{read}</h1>
      <p className="quiz-result-blurb">{lean}</p>

      <div className="sns-scoreboard">
        <div className="sns-score">
          <span className="sns-score-num">{accuracy}%</span>
          <span className="sns-score-label">Read the room</span>
        </div>
        <div className="sns-score">
          <span className="sns-score-num">{total}</span>
          <span className="sns-score-label">Strangers judged</span>
        </div>
      </div>

      <VibeGuesserMeter score={vibeScore} rank={rank} runs={runs} variant="summary" />

      <ul className="sns-recap">
        {results.map((r) => {
          const g = Math.abs(r.user - r.reputation);
          return (
            <li key={r.id} className="sns-recap-row">
              <span className="sns-recap-name">{r.name}</span>
              <span className="sns-recap-nums">
                you {r.user} · world {r.reputation}
                <span className="sns-recap-gap" data-close={g <= 10 ? 'yes' : 'no'}>±{g}</span>
              </span>
            </li>
          );
        })}
      </ul>

      <div className="quiz-result-actions">
        <button className="quiz-btn-primary" onClick={onReplay}>Play again</button>
      </div>
    </div>
  );
}

export default SaintOrSinnerPage;
