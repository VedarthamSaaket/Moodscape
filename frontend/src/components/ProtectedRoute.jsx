import React, { useContext } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { AuthContext } from '../AuthContext';

function ProtectedRoute() {
  const auth = useContext(AuthContext);

  
  if (!auth) throw new Error('ProtectedRoute must be used inside AuthContext.Provider');

  return auth.isLoggedIn ? <Outlet /> : <Navigate to="/signin" replace />;
}

export default ProtectedRoute;
