import React, { useMemo, useState } from 'react';
import { FIGURES, ROUND_COUNT, SPECTRUM, repBand } from './quiz/saintOrSinnerData.js';
import useSaintStore from '../store/saintStore.js';
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
  const guesses = results.filter((r) => r.correctGuess).length;

  let read;
  if (accuracy >= 80) read = 'In tune with the world';
  else if (accuracy >= 60) read = 'Roughly fair';
  else read = 'Out of step with the crowd';

  let lean;
  if (bias > 12) lean = 'You judge softer than the public, a forgiving sort.';
  else if (bias < -12) lean = 'You judge harsher than the public, a tough jury.';
  else lean = 'And you call it almost exactly down the middle.';

  return { accuracy, bias, guesses, total: results.length, read, lean };
}

// Phases: intro → round (judge → guess → reveal) → summary
function SaintOrSinnerPage() {
  const { bestAccuracy, runs, recordRun } = useSaintStore();

  const [phase, setPhase] = useState('intro');
  const [deck, setDeck] = useState([]);
  const [idx, setIdx] = useState(0);
  const [step, setStep] = useState('judge');
  const [value, setValue] = useState(50);
  const [guess, setGuess] = useState(null);
  const [results, setResults] = useState([]);
  const [fading, setFading] = useState(false);

  const current = deck[idx] || null;

  // Shuffle the 3 candidate names once per figure so the answer's slot varies.
  const options = useMemo(
    () => (current ? shuffle(current.options) : []),
    [current?.id], // eslint-disable-line react-hooks/exhaustive-deps
  );

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
    setGuess(null);
    setResults([]);
    advance(() => setPhase('round'));
  };

  const lockVerdict = () => advance(() => setStep('guess'));

  const pickGuess = (name) => {
    if (!current) return;
    setGuess(name);
    setResults((rs) => [
      ...rs,
      {
        id: current.id,
        name: current.name,
        user: value,
        reputation: current.reputation,
        correctGuess: name === current.name,
      },
    ]);
    advance(() => setStep('reveal'));
  };

  const next = () => {
    if (idx >= deck.length - 1) {
      // results state already holds every round (set synchronously in pickGuess).
      const { accuracy } = summarise(results);
      recordRun(accuracy);
      advance(() => setPhase('summary'));
    } else {
      advance(() => {
        setIdx((i) => i + 1);
        setStep('judge');
        setValue(50);
        setGuess(null);
      });
    }
  };

  return (
    <div className={`quiz-shell ${fading ? 'fading' : ''}`}>
      {phase === 'intro' && (
        <Intro onStart={begin} bestAccuracy={bestAccuracy} runs={runs} />
      )}

      {phase === 'round' && current && (
        <>
          <Progress index={idx} total={deck.length} />

          {step === 'judge' && (
            <JudgeStep figure={current} value={value} onChange={setValue} onLock={lockVerdict} />
          )}

          {step === 'guess' && (
            <GuessStep figure={current} options={options} onPick={pickGuess} />
          )}

          {step === 'reveal' && (
            <RevealStep
              figure={current}
              value={value}
              guess={guess}
              isLast={idx >= deck.length - 1}
              onNext={next}
            />
          )}
        </>
      )}

      {phase === 'summary' && (
        <Summary results={results} onReplay={begin} />
      )}
    </div>
  );
}

// ── sub-views ─────────────────────────────────────────────────────────────────
function Intro({ onStart, bestAccuracy, runs }) {
  return (
    <div className="quiz-intro">
      <div className="quiz-intro-eyebrow">A blind game of reputation</div>
      <h1 className="quiz-intro-title">
        Saint or <em>Sinner?</em>
      </h1>
      <p className="quiz-intro-body">
        A few cryptic facts. One stranger. You decide where they fall, from
        reviled to revered, <em>before</em> you know who it is. Then guess the name,
        and see how the world really judges them.
      </p>
      {runs > 0 && (
        <p className="sns-best">
          Best read: <span>{bestAccuracy}%</span> · {runs} {runs === 1 ? 'round' : 'rounds'} played
        </p>
      )}
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
      <h2 className="sns-prompt">Who is this, and are they worth admiring?</h2>
      <p className="sns-caption">Judge on the facts alone. No names yet.</p>

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

function GuessStep({ figure, options, onPick }) {
  return (
    <div className="sns-round">
      <h2 className="sns-prompt">Now, who do you think it was?</h2>
      <p className="sns-caption">One of these three. Trust your gut.</p>

      <ul className="sns-traits sns-traits-compact">
        {figure.traits.map((t, i) => (
          <li key={i} className="sns-trait">{t}</li>
        ))}
      </ul>

      <div className="sns-options">
        {options.map((name, i) => (
          <button
            key={name}
            type="button"
            className="sns-option"
            style={{ '--i': i }}
            onClick={() => onPick(name)}
          >
            {name}
          </button>
        ))}
      </div>
    </div>
  );
}

function RevealStep({ figure, value, guess, isLast, onNext }) {
  const worldBand = repBand(figure.reputation);
  const gap = Math.abs(value - figure.reputation);
  const guessRight = guess === figure.name;

  let verdictLine;
  if (gap <= 8) verdictLine = 'Almost exactly how the world sees them.';
  else if (value > figure.reputation) verdictLine = `You were ${gap} points kinder than the public.`;
  else verdictLine = `You were ${gap} points harsher than the public.`;

  return (
    <div className="sns-reveal">
      <div className="sns-reveal-eyebrow">{figure.era} · {guessRight ? 'You named them' : 'Not quite'}</div>
      <h1 className="sns-reveal-name">{figure.name}</h1>

      <div className="sns-chip" style={{ '--chip': worldBand.color }}>
        {figure.verdict} · the world says {figure.reputation}/100
      </div>

      <SpectrumBar you={value} world={figure.reputation} worldColor={worldBand.color} />
      <p className="sns-gap-line">{verdictLine}</p>

      <p className="sns-guess-line" data-right={guessRight ? 'yes' : 'no'}>
        {guessRight
          ? `✓ Right, you knew it was ${figure.name}.`
          : `✗ You guessed ${guess}.`}
      </p>

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

function Summary({ results, onReplay }) {
  const { accuracy, guesses, total, read, lean } = summarise(results);
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
          <span className="sns-score-num">{guesses}/{total}</span>
          <span className="sns-score-label">Names guessed</span>
        </div>
      </div>

      <ul className="sns-recap">
        {results.map((r) => {
          const g = Math.abs(r.user - r.reputation);
          return (
            <li key={r.id} className="sns-recap-row">
              <span className="sns-recap-name">{r.name}</span>
              <span className="sns-recap-nums">
                you {r.user} · world {r.reputation}
                <span className="sns-recap-gap" data-close={g <= 10 ? 'yes' : 'no'}>±{g}</span>
                <span className="sns-recap-guess" data-right={r.correctGuess ? 'yes' : 'no'}>
                  {r.correctGuess ? '✓' : '✗'}
                </span>
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
