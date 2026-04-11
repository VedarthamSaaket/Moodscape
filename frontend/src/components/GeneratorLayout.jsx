import React, { useContext } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { AuthContext } from '../AuthContext';
import './../App.css';

function GeneratorLayout() {
  const { setIsLoggedIn } = useContext(AuthContext);
  const navigate = useNavigate();

  const handleLogout = () => {
    setIsLoggedIn(false);
    navigate('/');
  };

  return (
    <div className="generator-layout-container">
      <header className="generator-header">
        <div className="top-brand-corner">Vædarth</div>
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
