import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import GeneratorLayout from './components/GeneratorLayout';
import ProtectedRoute from './components/ProtectedRoute';
import HomePage from './pages/HomePage';
import SignInPage from './pages/SignInPage';
import SignUpPage from './pages/SignUpPage';
import VerifyEmailPage from './pages/VerifyEmailPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import GeneratorPage from './pages/GeneratorPage';
import StudioPage from './pages/StudioPage';
import SavedPage from './pages/SavedPage';
import QuizLayout from './components/QuizLayout';
import QuizPage from './pages/QuizPage';
import SaintOrSinnerPage from './pages/SaintOrSinnerPage';
import CallbackPage from './pages/CallbackPage';
import GlobalPlayer from './components/GlobalPlayer';
import GlobalRadio from './components/GlobalRadio';
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
            <Route path="forgot-password" element={<ForgotPasswordPage />} />
          </Route>
          <Route element={<ProtectedRoute />}>
            <Route path="/generator" element={<GeneratorLayout />}>
              <Route index element={<GeneratorPage />} />
            </Route>
            <Route path="/studio" element={<GeneratorLayout />}>
              <Route index element={<StudioPage />} />
            </Route>
            <Route path="/saved" element={<GeneratorLayout />}>
              <Route index element={<SavedPage />} />
            </Route>
            <Route path="/quiz" element={<GeneratorLayout />}>
              <Route element={<QuizLayout />}>
                <Route index element={<QuizPage />} />
                <Route path="saint-or-sinner" element={<SaintOrSinnerPage />} />
              </Route>
            </Route>
          </Route>
        </Routes>
        {/* Persistent across every route, keeps playing until the tab closes. */}
        <GlobalPlayer />
        {/* Lofi-radio audio host. Off-screen iframe, mounted outside the
            <Routes> boundary so navigating between pages doesn't unmount it. */}
        <GlobalRadio />
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
