import React, { useState, useRef, useEffect, useContext } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { AuthContext } from '../AuthContext';
import { API_BASE } from '../config';

const CODE_LENGTH = 6;

function VerifyEmailPage() {
    const location = useLocation();
    const navigate = useNavigate();
    const { setIsLoggedIn } = useContext(AuthContext);

    const [email, setEmail] = useState(location.state?.email || '');
    const [digits, setDigits] = useState(Array(CODE_LENGTH).fill(''));
    const [message, setMessage] = useState('');
    const [isError, setIsError] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [resendCooldown, setResendCooldown] = useState(0);
    const inputRefs = useRef([]);

    useEffect(() => { inputRefs.current[0]?.focus(); }, []);
    useEffect(() => {
        if (resendCooldown <= 0) return;
        const t = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
        return () => clearTimeout(t);
    }, [resendCooldown]);

    const handleDigitChange = (i, val) => {
        const d = val.replace(/\D/g, '').slice(-1);
        const next = [...digits]; next[i] = d; setDigits(next);
        if (d && i < CODE_LENGTH - 1) inputRefs.current[i + 1]?.focus();
    };
    const handleKeyDown = (i, e) => {
        if (e.key === 'Backspace' && !digits[i] && i > 0) inputRefs.current[i - 1]?.focus();
    };
    const handlePaste = (e) => {
        e.preventDefault();
        const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, CODE_LENGTH);
        if (!pasted) return;
        const next = [...digits];
        for (let i = 0; i < pasted.length; i++) next[i] = pasted[i];
        setDigits(next);
        const idx = next.findIndex((d) => !d);
        inputRefs.current[idx !== -1 ? idx : CODE_LENGTH - 1]?.focus();
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        const code = digits.join('');
        if (code.length < CODE_LENGTH) {
            setIsError(true); setMessage('Please enter the full 6-digit code.'); return;
        }
        setMessage(''); setIsError(false); setIsLoading(true);
        try {
            const res = await fetch(`${API_BASE}/api/verify-email`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, code }),
            });
            const data = await res.text().then((t) => (t ? JSON.parse(t) : {}));
            if (!res.ok) throw new Error(data.detail || `Error ${res.status}`);
            if (data.session_token) {
                localStorage.setItem('authToken', data.session_token);
                setIsLoggedIn(true);
            }
            setMessage(data.message || 'Email verified! Redirecting…');
            setTimeout(() => navigate(data.session_token ? '/generator' : '/signin'), 1200);
        } catch (err) { setIsError(true); setMessage(err.message); }
        finally { setIsLoading(false); }
    };

    const handleResend = async () => {
        if (resendCooldown > 0) return;
        setMessage(''); setIsError(false);
        try {
            const res = await fetch(`${API_BASE}/api/resend-verify-code`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email }),
            });
            const data = await res.text().then((t) => (t ? JSON.parse(t) : {}));
            if (!res.ok) throw new Error(data.detail || `Error ${res.status}`);
            setMessage(data.message || 'A new code has been sent to your email.');
            setResendCooldown(60);
        } catch (err) { setIsError(true); setMessage(err.message); }
    };

    return (
        
        <div className="auth-page-wrapper">
            <div className="auth-page">
                <h1>Verify Your Email</h1>
                <p className="auth-subtitle">
                    We sent a 6-digit code to <strong>{email || 'your email'}</strong>.
                    Enter it below to confirm your account.
                </p>

                {}
                {!location.state?.email && (
                    <input
                        className="auth-email-fallback"
                        type="email"
                        placeholder="Your email address"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                    />
                )}

                <form className="auth-form" onSubmit={handleSubmit}>
                    <div className="otp-inputs" onPaste={handlePaste}>
                        {digits.map((digit, i) => (
                            <input
                                key={i}
                                ref={(el) => (inputRefs.current[i] = el)}
                                className="otp-box"
                                type="text"
                                inputMode="numeric"
                                maxLength={1}
                                value={digit}
                                onChange={(e) => handleDigitChange(i, e.target.value)}
                                onKeyDown={(e) => handleKeyDown(i, e)}
                                aria-label={`Digit ${i + 1}`}
                            />
                        ))}
                    </div>

                    <button type="submit" className="btn-auth" disabled={isLoading}>
                        {isLoading ? 'Verifying…' : 'Verify Email'}
                    </button>
                </form>

                {message && (
                    <p className={`message ${isError ? 'error' : 'success'}`}>{message}</p>
                )}

                <p className="resend-row">
                    Didn&apos;t receive a code?{' '}
                    <button
                        type="button"
                        className="resend-btn"
                        onClick={handleResend}
                        disabled={resendCooldown > 0}
                    >
                        {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
                    </button>
                </p>

                <Link to="/signin" className="home-link">Back to Sign In</Link>
            </div>
        </div>
    );
}

export default VerifyEmailPage;
