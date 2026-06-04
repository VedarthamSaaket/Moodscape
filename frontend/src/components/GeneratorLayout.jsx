import React, { useContext, useEffect } from 'react';
import { Outlet, useNavigate, NavLink } from 'react-router-dom';
import { AuthContext } from '../AuthContext';
import useStudioStore from '../store';
import useQuizStore from '../store/quizStore';
import './../App.css';

function GeneratorLayout() {
  const { setIsLoggedIn } = useContext(AuthContext);
  const navigate = useNavigate();
  const hydrateFromServer = useStudioStore((s) => s.hydrateFromServer);
  const resetHydration   = useStudioStore((s) => s.resetHydration);
  const hydrateQuiz        = useQuizStore((s) => s.hydrateFromServer);
  const resetQuizHydration = useQuizStore((s) => s.resetHydration);

  // Sync moodboards and the saved quiz result once per session.
  // No-op if logged out or already hydrated.
  useEffect(() => {
    hydrateFromServer();
    hydrateQuiz();
  }, [hydrateFromServer, hydrateQuiz]);

  const handleLogout = () => {
    // Clear hydrate flags so the next user's session starts a fresh sync.
    resetHydration();
    resetQuizHydration();
    localStorage.removeItem('authToken');
    setIsLoggedIn(false);
    navigate('/');
  };

  return (
    <div className="generator-layout-container">
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
