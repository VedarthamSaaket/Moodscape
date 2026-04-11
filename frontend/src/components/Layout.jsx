import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import './../App.css';
import fogVideo from '../assets/fog.mp4';

function Layout() {
  const { pathname } = useLocation();
  const isHome = pathname === '/';

  return (
    <div
      className="persistent-layout-container"
      style={isHome ? { position: 'static', height: 'auto', overflow: 'visible' } : {}}
    >
      <div
        className="page-content"
        style={isHome ? { height: 'auto' } : {}}
      >
        <Outlet />
      </div>

      {}
      {isHome && (
        <video
          autoPlay
          loop
          muted
          playsInline
          preload="none"
          className="fog-video-layer"
        >
          <source src={fogVideo} type="video/mp4" />
        </video>
      )}
    </div>
  );
}

export default Layout;
