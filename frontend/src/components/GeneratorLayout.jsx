import React, { useContext } from 'react';
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import { AuthContext } from '../AuthContext';
import './../App.css';

function GeneratorLayout() {
  const { setIsLoggedIn } = useContext(AuthContext);
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const handleLogout = () => {
    setIsLoggedIn(false);
    navigate('/');
  };

  const isStudio = pathname.startsWith('/studio');

  return (
    <div className="generator-layout-container">
      <header className="generator-header">
        <div className="top-brand-corner">M&amp;M</div>
        <nav style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <Link
            to={isStudio ? '/generator' : '/studio'}
            style={{
              fontFamily: 'var(--font-mono)', fontSize: '0.44rem', letterSpacing: '0.15em',
              color: 'var(--text-3)', textTransform: 'uppercase', textDecoration: 'none',
              borderBottom: '1px solid transparent', paddingBottom: '2px', transition: 'all 0.2s',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--rg)'; e.currentTarget.style.borderBottomColor = 'var(--rg)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-3)'; e.currentTarget.style.borderBottomColor = 'transparent'; }}
          >
            {isStudio ? 'Generator' : 'Studio'}
          </Link>
          <button onClick={handleLogout} className="btn-logout">
            Log Out &rsaquo;
          </button>
        </nav>
      </header>

      <main className="generator-content">
        <Outlet />
      </main>
    </div>
  );
}

export default GeneratorLayout;
