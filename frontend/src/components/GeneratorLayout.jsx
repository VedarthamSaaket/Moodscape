import React, { useContext, useEffect } from 'react';
import { Outlet, useNavigate, NavLink } from 'react-router-dom';
import { AuthContext } from '../AuthContext';
import useStudioStore from '../store';
import useQuizStore from '../store/quizStore';
import useSavedStore from '../store/savedStore';
import usePlayerStore from '../store/playerStore';
import useSaintStore from '../store/saintStore';
import Dither from '../assets/Dither';
import './../App.css';

function GeneratorLayout() {
  const { setIsLoggedIn } = useContext(AuthContext);
  const navigate = useNavigate();
  const hydrateFromServer = useStudioStore((s) => s.hydrateFromServer);
  const resetHydration   = useStudioStore((s) => s.resetHydration);
  const hydrateQuiz        = useQuizStore((s) => s.hydrateFromServer);
  const resetQuizHydration = useQuizStore((s) => s.resetHydration);
  const hydrateSaved       = useSavedStore((s) => s.hydrate);
  const resetSavedHydration = useSavedStore((s) => s.resetHydration);
  const hydratePlayer       = usePlayerStore((s) => s.hydrate);
  const resetPlayerHydration = usePlayerStore((s) => s.resetHydration);
  const hydrateSaint        = useSaintStore((s) => s.hydrate);
  const resetSaintHydration = useSaintStore((s) => s.resetHydration);

  // Sync moodboards and the saved quiz result once per session.
  // No-op if logged out or already hydrated.
  useEffect(() => {
    hydrateFromServer();
    hydrateQuiz();
    hydrateSaved();
    hydratePlayer();
    hydrateSaint();
  }, [hydrateFromServer, hydrateQuiz, hydrateSaved, hydratePlayer, hydrateSaint]);

  // Aggressive re-sync for saved songs. Every time the tab regains focus or
  // becomes visible, force a fresh pull from the server so the user never
  // sees a stale list — addresses the "my saved songs disappeared" bug
  // where a silent server write failure earlier in the session would leave
  // the in-memory list out of sync with the database.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') hydrateSaved(true);
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [hydrateSaved]);

  const handleLogout = () => {
    // Clear hydrate flags so the next user's session starts a fresh sync.
    resetHydration();
    resetQuizHydration();
    resetSavedHydration();
    resetPlayerHydration();
    resetSaintHydration();
    localStorage.removeItem('authToken');
    setIsLoggedIn(false);
    navigate('/');
  };

  return (
    <div className="generator-layout-container">
      <div className="gen-beams-bg">
        <Dither
          waveColor={[0.4, 0.66, 0.92]}
          waveSpeed={0.04}
          waveFrequency={3}
          waveAmplitude={0.3}
          colorNum={5}
          pixelSize={2}
          disableAnimation={false}
          enableMouseInteraction={false}
        />
      </div>
      <header className="generator-header">
        <div className="top-brand-corner">M&amp;M</div>
        <nav className="gen-tab-bar">
          <NavLink to="/generator" className={({ isActive }) => 'gen-tab' + (isActive ? ' active' : '')}>
            Generator
          </NavLink>
          <NavLink to="/studio" className={({ isActive }) => 'gen-tab' + (isActive ? ' active' : '')}>
            Moodboard
          </NavLink>
          <NavLink to="/quiz" className={({ isActive }) => 'gen-tab' + (isActive ? ' active' : '')}>
            Quiz
          </NavLink>
          <NavLink to="/saved" className={({ isActive }) => 'gen-tab' + (isActive ? ' active' : '')}>
            Saved
          </NavLink>
        </nav>
        <button onClick={handleLogout} className="btn-logout">
          Log Out &rsaquo;
        </button>
      </header>

      <main className="generator-content">
        <Outlet />
      </main>
    </div>
  );
}

export default GeneratorLayout;
