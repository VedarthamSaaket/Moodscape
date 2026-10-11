import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import GoogleSignInButton from '../components/GoogleSignInButton';

function SignInPage() {
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);

  return (
    <div className="auth-page">
      <h1>Sign In</h1>

      <GoogleSignInButton
        label="Continue with Google"
        onStatus={(msg, isErr) => { setMessage(msg); setIsError(isErr); }}
      />

      {message && (
        <p className={`message ${isError ? 'error' : 'success'}`}>{message}</p>
      )}

      <Link to="/" className="home-link">Back to home</Link>
    </div>
  );
}

export default SignInPage;
