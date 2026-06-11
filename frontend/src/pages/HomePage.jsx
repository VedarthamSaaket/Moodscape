// File: frontend/src/pages/HomePage.jsx
import React, { useContext, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AuthContext } from '../AuthContext';
import bgImage from '../assets/bg.png';
import Beams from '../assets/Beams';

const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400;1,700;1,900&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400;1,600&family=IBM+Plex+Mono:wght@200;300;400&display=swap');

  :root {
    --black: #02040b;
    --rg: #9ab8cc;
    --rg-light: #c2d8e8;
    --mist: #8e9fc4;
    --mist-light: #b8c6e0;
    --parch: #dce8f0;
    --steel: #8fa3b0;
    --text: rgba(220,234,248,0.95);
    --text-2: rgba(180,205,222,0.60);
    --text-3: rgba(140,170,192,0.32);
    --font-display: 'Playfair Display', 'Times New Roman', serif;
    --font-editorial: 'Cormorant Garamond', Georgia, serif;
    --font-mono: 'IBM Plex Mono', monospace;
  }

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html { scroll-behavior: smooth; }
  body { background: var(--black); overflow-x: hidden; }
  ::-webkit-scrollbar { width: 2px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: rgba(154,184,204,0.22); }

  @keyframes scrollLine {
    0%   { transform: scaleY(0); transform-origin: top; opacity: 1; }
    48%  { transform: scaleY(1); transform-origin: top; opacity: 1; }
    52%  { transform: scaleY(1); transform-origin: bottom; opacity: 1; }
    100% { transform: scaleY(0); transform-origin: bottom; opacity: 0.3; }
  }
  @keyframes ticker { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
  @keyframes cardIn { to { opacity: 1; transform: translateY(0); } }
  @keyframes pulseSilver { 0%,100% { opacity:0.35; } 50% { opacity:0.85; } }
  @keyframes rotateCW  { from { transform: rotate(0deg);   } to { transform: rotate(360deg);  } }
  @keyframes heroIn    { from { opacity:0; transform: translateY(36px); } to { opacity:1; transform:translateY(0); } }

  .section-rule {
    width: 100%;
    height: 1px;
    background: linear-gradient(90deg,
      transparent 0%,
      rgba(154,184,204,0.04) 12%,
      rgba(194,217,232,0.18) 42%,
      rgba(184,198,224,0.14) 58%,
      rgba(154,184,204,0.04) 82%,
      transparent 100%);
  }

  .btn-gold {
    display: inline-flex; align-items: center; gap: 12px;
    padding: 15px 36px;
    background: transparent;
    border: 1px solid rgba(154,184,204,0.42);
    color: rgba(194,217,232,0.90);
    font-family: var(--font-mono); font-size: 0.64rem; letter-spacing: 0.28em; text-transform: uppercase;
    text-decoration: none; position: relative; overflow: hidden;
    transition: all 0.4s cubic-bezier(0.16,1,0.3,1);
  }
  .btn-gold::before {
    content: ''; position: absolute; inset: 0;
    background: linear-gradient(90deg, transparent, rgba(154,184,204,0.07), transparent);
    transform: translateX(-110%); transition: transform 0.55s ease;
  }
  .btn-gold:hover { border-color: rgba(194,217,232,0.72); color: var(--parch); letter-spacing: 0.34em; }
  .btn-gold:hover::before { transform: translateX(110%); }

  .btn-ghost {
    display: inline-flex; align-items: center; padding: 15px 28px;
    background: transparent; border: 1px solid rgba(154,184,204,0.16);
    color: var(--text-2); font-family: var(--font-mono); font-size: 0.64rem;
    letter-spacing: 0.22em; text-transform: uppercase; text-decoration: none;
    transition: all 0.3s ease;
  }
  .btn-ghost:hover { border-color: rgba(194,217,232,0.34); color: var(--text); }

  .marquee-wrap { overflow: hidden; }
  .marquee-track { display: flex; width: max-content; animation: ticker 34s linear infinite; }
  .marquee-track.rev { animation-direction: reverse; animation-duration: 44s; }
  .marquee-track:hover { animation-play-state: paused; }

  .step-card, .feat-tile, .pl-card, .t-card {
    transition: all 0.40s cubic-bezier(0.16,1,0.3,1);
  }
  .step-card:hover { transform: translateY(-8px) !important; }
  .feat-tile:hover  { transform: translateY(-5px) !important; background: rgba(154,184,204,0.022) !important; }
  .pl-card:hover    { transform: translateY(-10px) !important; box-shadow: 0 44px 80px rgba(0,0,0,0.68) !important; }
`;

function useReveal(threshold = 0.08) {
  const ref = useRef(null);
  const [v, setV] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setV(true); obs.disconnect(); } }, { threshold });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return [ref, v];
}

function Reveal({ children, delay = 0 }) {
  const [ref, v] = useReveal();
  return (
    <div ref={ref} style={{ opacity: v ? 1 : 0, transform: v ? 'translateY(0)' : 'translateY(20px)', transition: `opacity 0.88s cubic-bezier(0.16,1,0.3,1) ${delay}ms, transform 0.88s cubic-bezier(0.16,1,0.3,1) ${delay}ms` }}>
      {children}
    </div>
  );
}

function Vinyl({ size = 300, style = {} }) {
  const rings = [1, 0.72, 0.52, 0.36, 0.22, 0.10];
  return (
    <div style={{ width: size, height: size, position: 'relative', ...style }}>
      {rings.map((r, i) => (
        <div key={i} style={{ position: 'absolute', borderRadius: '50%', border: '1px solid rgba(154,184,204,0.18)', width: `${r * 100}%`, height: `${r * 100}%`, top: '50%', left: '50%', transform: 'translate(-50%,-50%)', opacity: 0.65 - i * 0.08 }} />
      ))}
      <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: '9%', height: '9%', borderRadius: '50%', background: 'radial-gradient(circle, rgba(194,217,232,0.42), transparent)', animation: 'pulseSilver 3.2s ease-in-out infinite' }} />
      <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'conic-gradient(from 0deg, transparent 0%, rgba(154,184,204,0.032) 25%, transparent 50%, rgba(184,198,224,0.018) 75%, transparent 100%)', animation: 'rotateCW 30s linear infinite' }} />
    </div>
  );
}

const TICKER = ['mood to music', 'emotion', 'frequency', 'atmosphere', 'resonance', 'texture', 'feeling', 'pulse', 'current', 'wavelength', 'inner sound'];
function Ticker({ rev = false }) {
  const items = [...TICKER, ...TICKER];
  return (
    <div className="marquee-wrap" style={{ borderTop: '1px solid rgba(154,184,204,0.10)', borderBottom: '1px solid rgba(154,184,204,0.10)', padding: '11px 0', background: rev ? 'rgba(154,184,204,0.018)' : 'rgba(184,198,224,0.008)' }}>
      <div className={`marquee-track${rev ? ' rev' : ''}`}>
        {items.map((w, i) => (
          <span key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.50rem', letterSpacing: '0.30em', textTransform: 'uppercase', color: i % 3 === 1 ? 'rgba(194,217,232,0.55)' : 'rgba(154,184,204,0.20)', padding: '0 32px', whiteSpace: 'nowrap' }}>
            {w}<span style={{ marginLeft: '32px', color: i % 3 === 1 ? 'rgba(194,217,232,0.22)' : 'rgba(154,184,204,0.09)' }}>{i % 3 === 1 ? '♩' : '/'}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

const STEPS = [
  { num: '01', label: 'Input', title: 'Write the feeling', body: 'A sentence. A fragment. A memory half-formed. No tempo preferences, no technical knowledge. Just the texture of the moment you are in, as honestly as you can put it.' },
  { num: '02', label: 'Process', title: 'The AI reads between the lines', body: 'Not keywords. The emotional weight of your words, the pace of your sentences, the atmosphere underneath the literal meaning. It maps the feeling to sound.' },
  { num: '03', label: 'Output', title: 'Your soundtrack arrives', body: 'A Spotify playlist built in seconds, dropped straight into your library, ready on every device. Steer by genre if you want, or let the AI decide.' },
];

const FEATURES = [
  { n: '01', title: 'Emotion-first', sub: 'not genre-first', body: 'Most apps ask what genre you want. MoodScape asks how you feel. The difference is subtle. The result is deeply personal.' },
  { n: '02', title: 'Under 10 seconds', sub: 'from feeling to playlist', body: 'No buffering, no waiting. The moment you submit, your soundtrack begins assembling itself.' },
  { n: '03', title: 'Precision matching', sub: 'nuance, not keywords', body: 'Metaphor, emotional layering, atmospheric subtext. Not just what you say but how you say it.' },
  { n: '04', title: 'Native Spotify sync', sub: 'no extra steps', body: 'Playlists land directly in your Spotify library, ready on every device you own.' },
  { n: '05', title: 'Context-aware', sub: 'time, place, energy', body: 'Time of day, setting, the energy in your writing. All read, all factored into what you hear.' },
  { n: '06', title: 'Genre-optional', sub: 'steer if you want to', body: 'Pick a genre to guide the results, or leave it open and let the AI decide. Your call, always.' },
];

const PLAYLISTS = [
  { gradient: 'linear-gradient(145deg,#0a0c12 0%,#141822 45%,#0c0e16 100%)', accent: '#8a9eb4', mood: 'melancholic, rainy afternoon', name: 'Glass and Rain', desc: 'Watching rain from a cafe window, coffee going cold', tracks: ['Nuvole Bianche', 'Motion Picture Soundtrack', 'Holocene'], artists: ['Einaudi', 'Radiohead', 'Bon Iver'], bpm: '72 BPM', key: 'C min' },
  { gradient: 'linear-gradient(145deg,#0c0e14 0%,#16191f 45%,#0a0c10 100%)', accent: '#9aacbc', mood: 'focused, deep work', name: 'Forest Protocol', desc: 'That zone where hours disappear and only the work exists', tracks: ['Comptine', 'Experience', 'Re: Stacks'], artists: ['Tiersen', 'Einaudi', 'Bon Iver'], bpm: '84 BPM', key: 'G maj' },
  { gradient: 'linear-gradient(145deg,#0e1018 0%,#181c26 45%,#0a0e14 100%)', accent: '#a0b0c4', mood: 'nostalgic, late night', name: 'City After Midnight', desc: 'Driving alone at 2am, nowhere specific to be', tracks: ['The Night Will Always Win', 'Motion', 'Drive'], artists: ['Manch. Orch.', 'Tourist', 'Vallis Alps'], bpm: '96 BPM', key: 'A min' },
];

const GAMES = [
  { tag: 'Quiz', title: 'Find your archetype', body: 'Ten questions. No right answers. A style profile mapped to your taste across warmth, edge, era and density, with a playlist that fits.', link: '/quiz' },
  { tag: 'Game', title: 'Saint or Sinner?', body: 'Read cryptic traits about a real person. Slide your verdict before the reveal. How sharply do you actually read people?', link: '/quiz/saint-or-sinner' },
];

export default function HomePage() {
  const { isLoggedIn } = useContext(AuthContext);
  const [beamsOp, setBeamsOp] = useState(0);
  const [hovStep, setHovStep] = useState(null);
  const [hovPl, setHovPl] = useState(null);

  useEffect(() => {
    const fn = () => {
      const y = window.scrollY, h = window.innerHeight, s = h * 0.5, e = h * 1.1;
      setBeamsOp(y <= s ? 0 : y >= e ? 1 : (y - s) / (e - s));
    };
    window.addEventListener('scroll', fn, { passive: true });
    return () => window.removeEventListener('scroll', fn);
  }, []);

  // Bold / dominant ghost numbers, silver only, high opacity
  const GhostNum = ({ n, top, left, right, opacity = 0.15 }) => (
    <span style={{
      position: 'absolute', top, left, right,
      fontFamily: 'var(--font-display)',
      fontSize: 'clamp(8rem,15vw,11rem)',
      fontWeight: 900,
      fontStyle: 'italic',
      color: 'transparent',
      WebkitTextStroke: `1.5px rgba(194,217,232,${opacity})`,
      userSelect: 'none',
      pointerEvents: 'none',
      lineHeight: 1,
      zIndex: 0,
      // Subtle fill so it reads as a true watermark, not just outline
      textShadow: `0 0 80px rgba(154,184,204,${opacity * 0.35})`,
    }}>{n}</span>
  );

  return (
    <div style={{ width: '100vw', minHeight: '100vh', background: 'var(--black)', color: 'var(--text)', fontFamily: 'var(--font-editorial)', overflowX: 'hidden' }}>
      <style>{GLOBAL_CSS}</style>

      <div style={{ position: 'fixed', inset: 0, zIndex: 0, opacity: beamsOp, transition: 'opacity 0.1s linear', pointerEvents: 'none' }}>
        <Beams beamWidth={2.5} beamHeight={35} beamNumber={18} lightColor="#8a9ea8" speed={1.8} noiseIntensity={1.6} scale={0.18} rotation={25} />
      </div>

      {/* ══ HERO ══ */}
      <section style={{ position: 'relative', minHeight: '100vh', width: '100%', display: 'flex', flexDirection: 'column', overflow: 'visible' }}>
        <div style={{ position: 'absolute', inset: 0, backgroundImage: `url(${bgImage})`, backgroundSize: 'cover', backgroundPosition: 'center', zIndex: 0 }} />
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 130% 70% at 50% 115%, rgba(2,4,11,0.94) 0%, rgba(2,4,11,0.38) 55%, transparent 80%), linear-gradient(180deg, rgba(2,4,11,0.52) 0%, transparent 32%, rgba(2,4,11,0.78) 100%)', zIndex: 1 }} />
        <div style={{ position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none', backgroundImage: 'linear-gradient(rgba(154,184,204,0.022) 1px, transparent 1px), linear-gradient(90deg, rgba(154,184,204,0.022) 1px, transparent 1px)', backgroundSize: '60px 60px' }} />

        <Vinyl size={460} style={{ position: 'absolute', top: '-110px', right: '-120px', zIndex: 2, opacity: 0.22 }} />

        {/* Swiss cross decorations */}
        {[[{ top: '22%', left: '5.5%' }, { top: '70%', left: '88%' }, { top: '82%', left: '13%' }]].flat().map((pos, i) => (
          <div key={i} style={{ position: 'absolute', zIndex: 2, pointerEvents: 'none', ...pos }}>
            <div style={{ position: 'relative', width: '20px', height: '20px' }}>
              <div style={{ position: 'absolute', width: '1px', height: '20px', background: 'rgba(154,184,204,0.22)', left: '50%', top: 0 }} />
              <div style={{ position: 'absolute', height: '1px', width: '20px', background: 'rgba(154,184,204,0.22)', top: '50%', left: 0 }} />
            </div>
          </div>
        ))}

        {/* Side labels */}
        <div style={{ position: 'absolute', left: '20px', top: '50%', zIndex: 3, transform: 'translateY(-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '1px', height: '44px', background: 'linear-gradient(180deg, transparent, rgba(194,217,232,0.30))' }} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.42rem', letterSpacing: '0.32em', textTransform: 'uppercase', color: 'rgba(194,217,232,0.32)', writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>emotion to frequency</span>
          <div style={{ width: '1px', height: '44px', background: 'linear-gradient(180deg, rgba(194,217,232,0.30), transparent)' }} />
        </div>
        <div style={{ position: 'absolute', right: '20px', top: '28%', zIndex: 3, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '1px', height: '32px', background: 'linear-gradient(180deg, transparent, rgba(154,184,204,0.20))' }} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.42rem', letterSpacing: '0.28em', textTransform: 'uppercase', color: 'rgba(154,184,204,0.20)', writingMode: 'vertical-rl' }}>type, feel, listen</span>
          <div style={{ width: '1px', height: '32px', background: 'linear-gradient(180deg, rgba(154,184,204,0.20), transparent)' }} />
        </div>

        {/* Top nav bar */}
        <div style={{ position: 'relative', zIndex: 4, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '22px 52px' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.60rem', letterSpacing: '0.46em', textTransform: 'uppercase', color: 'rgba(194,217,232,0.58)' }}>M<span style={{ marginLeft: '2px', marginRight: '2px' }}>&amp;</span>M</span>
          <div style={{ display: 'flex' }}>
            {['Mood', 'Music', 'AI'].map((w, i) => (
              <span key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.48rem', letterSpacing: '0.24em', textTransform: 'uppercase', padding: '4px 14px', color: 'rgba(154,184,204,0.26)', borderLeft: '1px solid rgba(154,184,204,0.09)', borderRight: i === 2 ? '1px solid rgba(154,184,204,0.09)' : 'none' }}>{w}</span>
            ))}
          </div>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.48rem', letterSpacing: '0.20em', color: 'rgba(154,184,204,0.22)' }}>Vol. I</span>
        </div>

        {/* Hero center content */}
        <div style={{ flex: 1, position: 'relative', zIndex: 4, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px 48px 50px', overflow: 'visible' }}>

          {/* Issue label */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '24px', animation: 'heroIn 1.0s cubic-bezier(0.16,1,0.3,1) 0.1s both' }}>
            <div style={{ height: '1px', width: '38px', background: 'linear-gradient(90deg, transparent, rgba(194,217,232,0.40))' }} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.50rem', letterSpacing: '0.30em', textTransform: 'uppercase', color: 'rgba(194,217,232,0.58)' }}>Soundtrack for the soul</span>
            <div style={{ height: '1px', width: '38px', background: 'linear-gradient(90deg, rgba(194,217,232,0.40), transparent)' }} />
          </div>

          {/* Title */}
          <div style={{ animation: 'heroIn 1.1s cubic-bezier(0.16,1,0.3,1) 0.2s both', overflow: 'visible', padding: '8px 24px' }}>
            <h1 style={{
              fontFamily: 'Tangerine, var(--font-display), serif',
              fontSize: 'clamp(5.5rem, 13vw, 11.5rem)',
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: '0.03em',
              margin: 0,
              padding: '0 16px',
              display: 'block',
              overflow: 'visible',
              background: 'linear-gradient(155deg, rgba(240,248,255,0.98) 0%, rgba(194,217,232,0.88) 35%, rgba(168,198,218,0.80) 62%, rgba(120,155,178,0.65) 100%)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              filter: 'drop-shadow(0 4px 28px rgba(0,0,0,0.58))',
              textAlign: 'center',
            }}>
              M<span style={{ marginLeft: '2px', marginRight: '2px' }}>&amp;</span>M
            </h1>
          </div>

          {/* Ruled subtitle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0', marginTop: '18px', width: 'min(580px, 85vw)', animation: 'heroIn 1.1s cubic-bezier(0.16,1,0.3,1) 0.35s both' }}>
            <div style={{ flex: 1, height: '1px', background: 'linear-gradient(90deg, transparent, rgba(154,184,204,0.24))' }} />
            <div style={{ padding: '8px 20px', border: '1px solid rgba(154,184,204,0.18)', background: 'rgba(154,184,204,0.03)' }}>
              <p style={{ fontFamily: 'var(--font-editorial)', fontSize: '0.88rem', fontWeight: 300, fontStyle: 'italic', letterSpacing: '0.18em', color: 'rgba(220,234,248,0.52)', margin: 0, whiteSpace: 'nowrap' }}>
                type your emotion, get a soundtrack
              </p>
            </div>
            <div style={{ flex: 1, height: '1px', background: 'linear-gradient(90deg, rgba(154,184,204,0.24), transparent)' }} />
          </div>

          {/* CTAs */}
          <div style={{ marginTop: '38px', display: 'flex', gap: '10px', animation: 'heroIn 1.0s cubic-bezier(0.16,1,0.3,1) 0.5s both' }}>
            {isLoggedIn
              ? <Link to="/generator" className="btn-gold">Enter</Link>
              : <><Link to="/signup" className="btn-gold">Begin</Link><Link to="/signin" className="btn-ghost">Sign In</Link></>
            }
          </div>

          {/* Stat strip */}
          <div style={{ marginTop: '48px', display: 'flex', gap: '0', border: '1px solid rgba(154,184,204,0.09)', animation: 'heroIn 1.0s cubic-bezier(0.16,1,0.3,1) 0.65s both' }}>
            {[['Type a Feeling', 'AI Playlists'], ['Drag & Drop', 'Moodboards'], ['Style Quiz', 'Find Your Archetype'], ['Native', 'Spotify Sync']].map(([a, b], i) => (
              <div key={i} style={{ padding: '14px 26px', borderLeft: i > 0 ? '1px solid rgba(154,184,204,0.09)' : 'none', textAlign: 'center' }}>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: '0.80rem', fontWeight: 700, color: 'rgba(194,217,232,0.78)', letterSpacing: '0.04em' }}>{a}</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.44rem', letterSpacing: '0.22em', textTransform: 'uppercase', color: 'rgba(154,184,204,0.28)', marginTop: '3px' }}>{b}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Scroll nudge */}
        <div style={{ position: 'relative', zIndex: 4, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', paddingBottom: '26px' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.42rem', letterSpacing: '0.28em', textTransform: 'uppercase', color: 'rgba(154,184,204,0.28)' }}>scroll</span>
          <div style={{ width: '1px', height: '34px', background: 'rgba(194,217,232,0.28)', animation: 'scrollLine 2.4s ease-in-out infinite' }} />
        </div>
      </section>

      <Ticker />

      <div style={{ position: 'relative', zIndex: 1 }}>

        {/* ── MANIFESTO ── */}
        <section style={{ maxWidth: '1000px', margin: '0 auto', padding: '108px 52px 88px', position: 'relative' }}>
          {/* Bold dominant watermark, "feel" in silver */}
          <GhostNum n="feel" top="40px" right="-10px" opacity={0.14} />
          <Reveal>
            <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr', gap: '52px', alignItems: 'start' }}>
              <div style={{ paddingTop: '4px' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.48rem', letterSpacing: '0.28em', textTransform: 'uppercase', color: 'rgba(154,184,204,0.48)', display: 'block', marginBottom: '16px' }}>Manifesto</span>
                <div style={{ width: '1px', height: '68px', background: 'linear-gradient(180deg, rgba(154,184,204,0.38), rgba(154,184,204,0.04))' }} />
                <div style={{ marginTop: '14px', fontFamily: 'var(--font-mono)', fontSize: '0.44rem', letterSpacing: '0.20em', textTransform: 'uppercase', color: 'rgba(154,184,204,0.22)', lineHeight: 2.2 }}>
                  <div>Emotion</div><div>Frequency</div><div>Moodboards</div><div>Archetypes</div>
                </div>
              </div>
              <div>
                <p style={{ fontFamily: 'var(--font-editorial)', fontSize: 'clamp(1.22rem,2.5vw,1.80rem)', fontWeight: 300, fontStyle: 'italic', lineHeight: 1.58, color: 'rgba(220,234,248,0.78)', letterSpacing: '0.01em', marginBottom: '30px' }}>
                  Most music apps ask what genre you want. MoodScape asks how you feel. Write freely, a feeling, a scene, a memory half-formed, and the AI maps the emotional texture of your words to a Spotify playlist. Build moodboards, take the style quiz, judge strangers blind.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0', borderTop: '1px solid rgba(154,184,204,0.12)', paddingTop: '22px' }}>
                  {['Emotion-first search', 'No star ratings', 'Genre-aware, not genre-bound', 'Just honest words'].map((t, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0', borderBottom: i < 2 ? '1px solid rgba(154,184,204,0.07)' : 'none', borderRight: i % 2 === 0 ? '1px solid rgba(154,184,204,0.07)' : 'none', paddingRight: i % 2 === 0 ? '18px' : '0', paddingLeft: i % 2 === 1 ? '18px' : '0' }}>
                      <div style={{ width: '4px', height: '4px', background: 'rgba(194,217,232,0.50)', flexShrink: 0 }} />
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.60rem', letterSpacing: '0.12em', color: 'rgba(154,184,204,0.42)' }}>{t}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Reveal>
        </section>

        <div className="section-rule" />

        {/* ── STUDIO TEASER ── */}
        <section style={{ maxWidth: '1000px', margin: '0 auto', padding: '80px 52px 70px', position: 'relative' }}>
          <Reveal>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '60px', alignItems: 'center' }}>
              <div>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.48rem', letterSpacing: '0.28em', textTransform: 'uppercase', color: 'rgba(154,184,204,0.48)', display: 'block', marginBottom: '14px' }}>Studio</span>
                <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(2rem,4.2vw,3rem)', fontWeight: 700, fontStyle: 'italic', lineHeight: 1.06, margin: '0 0 18px' }}>
                  Your mood,<br />
                  <span style={{ background: 'linear-gradient(90deg, rgba(194,217,232,0.95), rgba(184,198,224,0.80))', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>your board</span>
                </h2>
                <p style={{ fontFamily: 'var(--font-editorial)', fontSize: '0.92rem', fontWeight: 300, fontStyle: 'italic', color: 'var(--text-2)', lineHeight: 1.75, marginBottom: '24px' }}>
                  Drag images, drop text, scatter shapes.<br />
                  A freeform canvas that feels like your notebook, not a tool.
                </p>
                <Link to="/studio" className="btn-gold" style={{ fontSize: '0.62rem' }}>Open Studio</Link>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', justifyContent: 'center', opacity: 0.65 }}>
                {['▖', '◉', '✦', '⬡', '△', '▥', '♫', '◇', '☽', '⚜', '▚', '❦', '○', '⬤', '◈', '☯'].map((g, i) => (
                  <span key={i} style={{
                    width: '46px', height: '46px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: '1px solid rgba(154,184,204,0.12)', fontSize: '1.1rem',
                    color: i % 3 === 0 ? 'rgba(194,217,232,0.55)' : i % 3 === 1 ? 'rgba(184,198,224,0.38)' : 'rgba(154,184,204,0.25)',
                  }}>{g}</span>
                ))}
              </div>
            </div>
          </Reveal>
        </section>

        <div className="section-rule" />

        {/* ── HOW IT WORKS ── */}
        <section style={{ maxWidth: '1000px', margin: '0 auto', padding: '100px 52px', position: 'relative' }}>
          {/* Bold dominant silver watermark */}
          <GhostNum n="02" top="36px" right="-8px" opacity={0.16} />
          <Reveal>
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: '60px', gap: '40px' }}>
              <div>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.48rem', letterSpacing: '0.28em', textTransform: 'uppercase', color: 'rgba(154,184,204,0.48)', display: 'block', marginBottom: '14px' }}>Process</span>
                <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(2.1rem,4.8vw,3.5rem)', fontWeight: 700, fontStyle: 'italic', lineHeight: 1.06, margin: 0 }}>
                  Three steps to your<br />
                  <span style={{ background: 'linear-gradient(90deg, rgba(194,217,232,0.95), rgba(184,198,224,0.80))', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>perfect soundtrack</span>
                </h2>
              </div>
              <div style={{ borderLeft: '2px solid rgba(154,184,204,0.18)', paddingLeft: '18px', flexShrink: 0 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.46rem', letterSpacing: '0.20em', color: 'rgba(154,184,204,0.26)', display: 'block', lineHeight: 2.2 }}>Input a feeling<br />Receive a playlist<br />No configuration</span>
              </div>
            </div>
          </Reveal>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1px', background: 'rgba(154,184,204,0.07)' }}>
            {STEPS.map((s, i) => (
              <Reveal key={i} delay={i * 80}>
                <div className="step-card" onMouseEnter={() => setHovStep(i)} onMouseLeave={() => setHovStep(null)}
                  style={{ padding: '46px 36px 50px', background: hovStep === i ? 'rgba(154,184,204,0.028)' : '#02040b', position: 'relative', overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: hovStep === i ? 'linear-gradient(90deg,rgba(194,217,232,0.62),transparent)' : 'linear-gradient(90deg,rgba(154,184,204,0.12),transparent)', transition: 'all 0.4s ease' }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '42px' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.48rem', letterSpacing: '0.24em', textTransform: 'uppercase', color: 'rgba(154,184,204,0.40)', border: '1px solid rgba(154,184,204,0.16)', padding: '4px 9px' }}>{s.label}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.46rem', letterSpacing: '0.20em', color: 'rgba(154,184,204,0.22)' }}>{s.num}</span>
                  </div>
                  {/* In-card bold silver ghost number */}
                  <span style={{ position: 'absolute', bottom: '-14px', right: '-6px', fontFamily: 'var(--font-display)', fontSize: '9rem', fontWeight: 900, fontStyle: 'italic', color: 'transparent', WebkitTextStroke: '1.5px rgba(194,217,232,0.13)', lineHeight: 1, userSelect: 'none', pointerEvents: 'none' }}>{s.num}</span>
                  <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', fontWeight: 700, fontStyle: 'italic', color: 'rgba(220,234,248,0.90)', marginBottom: '14px', lineHeight: 1.18, position: 'relative', zIndex: 1 }}>{s.title}</h3>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.66rem', fontWeight: 300, color: 'var(--text-2)', lineHeight: 1.86, letterSpacing: '0.02em', position: 'relative', zIndex: 1 }}>{s.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        <div className="section-rule" />

        {/* ── FEATURES ── */}
        <section style={{ maxWidth: '1000px', margin: '0 auto', padding: '100px 52px', position: 'relative' }}>
          <GhostNum n="03" top="36px" left="-8px" opacity={0.16} />
          <Reveal>
            <div style={{ marginBottom: '58px' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.48rem', letterSpacing: '0.28em', textTransform: 'uppercase', color: 'rgba(154,184,204,0.48)', display: 'block', marginBottom: '14px' }}>Features</span>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(2.1rem,4.8vw,3.5rem)', fontWeight: 700, fontStyle: 'italic', lineHeight: 1.06, margin: 0 }}>
                Music that knows<br />
                <span style={{ background: 'linear-gradient(90deg, rgba(194,217,232,0.95), rgba(184,198,224,0.80))', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>how you feel</span>
              </h2>
            </div>
          </Reveal>

          {/* Dominant lead feature, emotion-first */}
          <Reveal>
            <div className="feat-tile" style={{ padding: '42px 38px', background: '#02040b', border: '1px solid rgba(154,184,204,0.05)', marginBottom: '1px', position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', top: 0, left: 0, width: '2px', height: '100%', background: 'linear-gradient(180deg, rgba(194,217,232,0.50), rgba(184,198,224,0.12))' }} />
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '48px' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.46rem', letterSpacing: '0.22em', color: 'rgba(154,184,204,0.40)' }}>01</span>
                    <div style={{ width: '18px', height: '1px', background: 'rgba(154,184,204,0.22)' }} />
                    <span style={{ fontFamily: 'var(--font-editorial)', fontSize: '0.72rem', fontStyle: 'italic', color: 'rgba(194,217,232,0.55)' }}>the core principle</span>
                  </div>
                  <h4 style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', fontWeight: 700, fontStyle: 'italic', color: 'rgba(220,234,248,0.92)', marginBottom: '6px', lineHeight: 1.18 }}>{FEATURES[0].title}</h4>
                  <p style={{ fontFamily: 'var(--font-editorial)', fontSize: '0.84rem', fontStyle: 'italic', color: 'rgba(194,217,232,0.52)', marginBottom: '14px', letterSpacing: '0.04em' }}>{FEATURES[0].sub}</p>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.66rem', fontWeight: 300, color: 'var(--text-2)', lineHeight: 1.80, maxWidth: '520px' }}>{FEATURES[0].body}</p>
                </div>
                <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.44rem', letterSpacing: '0.18em', color: 'rgba(154,184,204,0.20)', writingMode: 'vertical-rl' }}>emotion → frequency → sound</span>
                </div>
              </div>
            </div>
          </Reveal>

          {/* Supporting features in asymmetric 3 + 2 layout */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '1px', background: 'rgba(154,184,204,0.055)', marginBottom: '1px' }}>
            {FEATURES.slice(1, 4).map((f, i) => (
              <Reveal key={i + 1} delay={i * 55}>
                <div className="feat-tile" style={{ padding: i === 0 ? '38px 34px' : '28px 22px', background: '#02040b', position: 'relative' }}>
                  <div style={{ marginBottom: i === 0 ? '18px' : '14px' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.44rem', letterSpacing: '0.20em', color: 'rgba(154,184,204,0.38)' }}>{f.n}</span>
                  </div>
                  <h4 style={{ fontFamily: 'var(--font-display)', fontSize: i === 0 ? '1.2rem' : '0.9rem', fontWeight: 700, fontStyle: 'italic', color: 'rgba(220,234,248,0.88)', marginBottom: '4px', lineHeight: 1.18 }}>{f.title}</h4>
                  <p style={{ fontFamily: 'var(--font-editorial)', fontSize: '0.68rem', fontStyle: 'italic', color: 'rgba(194,217,232,0.40)', marginBottom: i === 0 ? '11px' : '8px', letterSpacing: '0.03em' }}>{f.sub}</p>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.60rem', fontWeight: 300, color: 'var(--text-2)', lineHeight: 1.70 }}>{f.body}</p>
                </div>
              </Reveal>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1px', background: 'rgba(154,184,204,0.055)' }}>
            {FEATURES.slice(4, 6).map((f, i) => (
              <Reveal key={i + 4} delay={i * 55 + 120}>
                <div className="feat-tile" style={{ padding: '24px 26px', background: '#02040b', position: 'relative' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.44rem', letterSpacing: '0.20em', color: 'rgba(154,184,204,0.38)' }}>{f.n}</span>
                    <div style={{ flex: 1, height: '1px', background: 'rgba(154,184,204,0.10)' }} />
                  </div>
                  <h4 style={{ fontFamily: 'var(--font-display)', fontSize: '0.88rem', fontWeight: 700, fontStyle: 'italic', color: 'rgba(220,234,248,0.86)', marginBottom: '3px', lineHeight: 1.18 }}>{f.title}</h4>
                  <p style={{ fontFamily: 'var(--font-editorial)', fontSize: '0.64rem', fontStyle: 'italic', color: 'rgba(194,217,232,0.36)', marginBottom: '6px', letterSpacing: '0.02em' }}>{f.sub}</p>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.58rem', fontWeight: 300, color: 'var(--text-2)', lineHeight: 1.65 }}>{f.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        <div className="section-rule" />
        <Ticker rev />

        {/* ── PLAYLISTS ── */}
        <section style={{ maxWidth: '1000px', margin: '0 auto', padding: '100px 52px', position: 'relative' }}>
          <GhostNum n="04" top="36px" right="-8px" opacity={0.16} />
          <Reveal>
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: '58px', gap: '40px' }}>
              <div>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.48rem', letterSpacing: '0.28em', textTransform: 'uppercase', color: 'rgba(154,184,204,0.48)', display: 'block', marginBottom: '14px' }}>Examples</span>
                <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(2.1rem,4.8vw,3.5rem)', fontWeight: 700, fontStyle: 'italic', lineHeight: 1.06, margin: 0 }}>
                  Real moods,<br />
                  <span style={{ background: 'linear-gradient(90deg, rgba(194,217,232,0.95), rgba(184,198,224,0.80))', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>real soundtracks</span>
                </h2>
              </div>
              <Vinyl size={72} style={{ opacity: 0.32, flexShrink: 0 }} />
            </div>
          </Reveal>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '2px' }}>
            {PLAYLISTS.map((pl, i) => (
              <div key={i} style={{ opacity: 0, transform: 'translateY(22px)', animation: `cardIn 0.80s cubic-bezier(0.16,1,0.3,1) ${i * 110 + 120}ms forwards` }}>
                <div className="pl-card" onMouseEnter={() => setHovPl(i)} onMouseLeave={() => setHovPl(null)}
                  style={{ background: '#060912', border: `1px solid ${hovPl === i ? 'rgba(154,184,204,0.24)' : 'rgba(154,184,204,0.07)'}`, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
                  <div style={{ height: '128px', background: pl.gradient, position: 'relative', overflow: 'hidden' }}>
                    <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg,rgba(255,255,255,0.04) 0%,transparent 52%)' }} />
                    <svg style={{ position: 'absolute', top: '-12px', right: '-8px', opacity: 0.18 }} width="100" height="100" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M50 4 L68 50 L50 96 L32 50 Z" stroke={pl.accent} strokeWidth="0.8" fill="none" />
                      <path d="M50 22 L60 50 L50 78 L40 50 Z" stroke={pl.accent} strokeWidth="0.5" fill="none" />
                      <path d="M50 36 L54 50 L50 64 L46 50 Z" fill={pl.accent} fillOpacity="0.12" />
                    </svg>
                    <svg style={{ position: 'absolute', bottom: '18px', right: '42px', opacity: 0.10 }} width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M14 2 L20 14 L14 26 L8 14 Z" stroke={pl.accent} strokeWidth="0.6" fill="none" />
                    </svg>
                    <svg style={{ position: 'absolute', top: '22px', right: '90px', opacity: 0.08 }} width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M8 1 L11 8 L8 15 L5 8 Z" fill={pl.accent} fillOpacity="0.18" />
                    </svg>
                    <div style={{ position: 'absolute', top: '10px', left: '12px', display: 'flex', gap: '4px' }}>
                      {[pl.bpm, pl.key].map((tag, ti) => (
                        <span key={ti} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.40rem', letterSpacing: '0.16em', padding: '3px 7px', background: 'rgba(0,0,0,0.52)', border: `1px solid ${pl.accent}28`, color: `${pl.accent}90` }}>{tag}</span>
                      ))}
                    </div>
                    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '8px 14px', background: 'linear-gradient(0deg,rgba(6,9,18,0.88),transparent)' }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.44rem', letterSpacing: '0.24em', textTransform: 'uppercase', color: `${pl.accent}99` }}>{pl.mood}</span>
                    </div>
                  </div>
                  <div style={{ padding: '18px 16px 20px', flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.12rem', fontWeight: 700, fontStyle: 'italic', color: 'rgba(220,234,248,0.92)', marginBottom: '5px' }}>{pl.name}</h3>
                    <p style={{ fontFamily: 'var(--font-editorial)', fontSize: '0.72rem', fontStyle: 'italic', color: 'var(--text-3)', lineHeight: 1.55, marginBottom: '16px' }}>{pl.desc}</p>
                    <div style={{ marginTop: 'auto' }}>
                      {pl.tracks.map((t, j) => (
                        <div key={j} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '7px 0', borderTop: j === 0 ? '1px solid rgba(154,184,204,0.08)' : 'none' }}>
                          <div style={{ display: 'flex', gap: '7px', alignItems: 'baseline', minWidth: 0 }}>
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.42rem', color: `${pl.accent}55`, flexShrink: 0 }}>{String(j + 1).padStart(2, '0')}</span>
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.61rem', fontWeight: 300, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t}</span>
                          </div>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.52rem', color: 'var(--text-3)', flexShrink: 0, marginLeft: '6px' }}>{pl.artists[j]}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <div className="section-rule" />

        {/* ── GAMES ── */}
        <section style={{ maxWidth: '1000px', margin: '0 auto', padding: '100px 52px', position: 'relative' }}>
          <GhostNum n="05" top="36px" left="-8px" opacity={0.16} />
          <Reveal>
            <div style={{ marginBottom: '58px' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.48rem', letterSpacing: '0.28em', textTransform: 'uppercase', color: 'rgba(154,184,204,0.48)', display: 'block', marginBottom: '14px' }}>Play</span>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(2.1rem,4.8vw,3.5rem)', fontWeight: 700, fontStyle: 'italic', lineHeight: 1.06, margin: 0 }}>
                Beyond the<br />
                <span style={{ background: 'linear-gradient(90deg, rgba(194,217,232,0.95), rgba(184,198,224,0.80))', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>playlist</span>
              </h2>
            </div>
          </Reveal>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1px', background: 'rgba(154,184,204,0.055)' }}>
            {GAMES.map((g, i) => (
              <Reveal key={i} delay={i * 80}>
                <div className="feat-tile" style={{ padding: '44px 36px', background: '#02040b', position: 'relative', overflow: 'hidden', height: '100%', display: 'flex', flexDirection: 'column' }}>
                  <div style={{ position: 'absolute', top: 0, left: 0, width: '2px', height: '100%', background: 'linear-gradient(180deg, rgba(194,217,232,0.40), rgba(184,198,224,0.06))' }} />
                  <svg style={{ position: 'absolute', bottom: '-6px', right: '-4px', opacity: 0.06 }} width="110" height="110" viewBox="0 0 110 110" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M55 4 L76 55 L55 106 L34 55 Z" stroke="rgba(194,217,232,1)" strokeWidth="0.8" fill="none" />
                    <path d="M55 28 L64 55 L55 82 L46 55 Z" stroke="rgba(194,217,232,1)" strokeWidth="0.5" fill="none" />
                  </svg>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '18px' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.46rem', letterSpacing: '0.22em', textTransform: 'uppercase', color: 'rgba(154,184,204,0.40)', border: '1px solid rgba(154,184,204,0.16)', padding: '4px 9px' }}>{g.tag}</span>
                  </div>
                  <h4 style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', fontWeight: 700, fontStyle: 'italic', color: 'rgba(220,234,248,0.92)', marginBottom: '12px', lineHeight: 1.18, position: 'relative', zIndex: 1 }}>{g.title}</h4>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.66rem', fontWeight: 300, color: 'var(--text-2)', lineHeight: 1.80, marginBottom: '22px', position: 'relative', zIndex: 1 }}>{g.body}</p>
                  <div style={{ marginTop: 'auto', position: 'relative', zIndex: 1 }}>
                    <Link to={g.link} className="btn-ghost" style={{ fontSize: '0.58rem' }}>Play</Link>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        <div className="section-rule" />

        {/* ── CTA ── */}
        <Reveal>
          <div style={{ width: '100%', padding: '118px 52px 138px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
            <Vinyl size={580} style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', opacity: 0.06 }} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.48rem', letterSpacing: '0.30em', textTransform: 'uppercase', color: 'rgba(154,184,204,0.44)', display: 'block', marginBottom: '24px', position: 'relative', zIndex: 1 }}>Ready</span>
            <h2 style={{ fontFamily: 'Tangerine, var(--font-display), serif', fontSize: 'clamp(4rem,10vw,8.5rem)', fontWeight: 700, lineHeight: 0.94, margin: '0 0 18px', background: 'linear-gradient(155deg, rgba(240,248,255,0.96) 0%, rgba(194,217,232,0.86) 38%, rgba(168,198,218,0.76) 65%, rgba(120,155,178,0.60) 100%)', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent', position: 'relative', zIndex: 1 }}>
              Your soundtrack<br />is waiting
            </h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '36px', position: 'relative', zIndex: 1 }}>
              <div style={{ height: '1px', width: '34px', background: 'linear-gradient(90deg,transparent,rgba(154,184,204,0.28))' }} />
              <p style={{ fontFamily: 'var(--font-editorial)', fontSize: '0.90rem', fontWeight: 300, fontStyle: 'italic', color: 'var(--text-2)', letterSpacing: '0.14em', margin: 0 }}>Start with a feeling. The music follows.</p>
              <div style={{ height: '1px', width: '34px', background: 'linear-gradient(90deg,rgba(154,184,204,0.28),transparent)' }} />
            </div>
            <div style={{ display: 'flex', gap: '10px', position: 'relative', zIndex: 1 }}>
              {isLoggedIn
                ? <Link to="/generator" className="btn-gold">Enter</Link>
                : <><Link to="/signup" className="btn-gold">Get Started</Link><Link to="/signin" className="btn-ghost">Sign In</Link></>
              }
            </div>
            <div style={{ marginTop: '56px', display: 'flex', alignItems: 'center', gap: '12px', position: 'relative', zIndex: 1 }}>
              <div style={{ height: '1px', width: '70px', background: 'rgba(154,184,204,0.10)' }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.42rem', letterSpacing: '0.26em', textTransform: 'uppercase', color: 'rgba(154,184,204,0.18)' }}>VÆDARTH Studio, 2026</span>
              <div style={{ height: '1px', width: '70px', background: 'rgba(154,184,204,0.10)' }} />
            </div>
          </div>
        </Reveal>

      </div>
    </div>
  );
}