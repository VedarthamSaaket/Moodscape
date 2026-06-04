import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import GeneratorLayout from './components/GeneratorLayout';
import ProtectedRoute from './components/ProtectedRoute';
import HomePage from './pages/HomePage';
import SignInPage from './pages/SignInPage';
import SignUpPage from './pages/SignUpPage';
import VerifyEmailPage from './pages/VerifyEmailPage';
import GeneratorPage from './pages/GeneratorPage';
import StudioPage from './pages/StudioPage';
import QuizPage from './pages/QuizPage';
import CallbackPage from './pages/CallbackPage';
import { AuthProvider } from './AuthContext';

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/callback" element={<CallbackPage />} />
          <Route path="/" element={<Layout />}>
            <Route index element={<HomePage />} />
            <Route path="signin" element={<SignInPage />} />
            <Route path="signup" element={<SignUpPage />} />
            <Route path="verify-email" element={<VerifyEmailPage />} />
          </Route>
          <Route element={<ProtectedRoute />}>
            <Route path="/generator" element={<GeneratorLayout />}>
              <Route index element={<GeneratorPage />} />
            </Route>
            <Route path="/studio" element={<GeneratorLayout />}>
              <Route index element={<StudioPage />} />
            </Route>
            <Route path="/quiz" element={<GeneratorLayout />}>
              <Route index element={<QuizPage />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
