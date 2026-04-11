import React, { useState, useRef, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { API_BASE } from '../config';

const CODE_LENGTH = 6;

function RequestStage({ onSent }) {
    const [email, setEmail] = useState('');
    const [method, setMethod] = useState('link');
    const [message, setMessage] = useState('');
    const [isError, setIsError] = useState(false);
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setMessage(''); setIsError(false); setIsLoading(true);
        try {
            const res = await fetch(`${API_BASE}/api/forgot-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, method }),
            });
            const data = await res.text().then((t) => (t ? JSON.parse(t) : {}));
            if (!res.ok) throw new Error(data.detail || `Error ${res.status}`);
            setMessage(method === 'link'
                ? data.message || 'Reset link sent! Check your inbox.'
                : data.message || '6-digit code sent! Check your inbox.');
            if (method === 'code') setTimeout(() => onSent({ email, method }), 1000);
        } catch (err) {
            setIsError(true); setMessage(err.message);
        } finally { setIsLoading(false); }
    };

    return (
        <>
            <h1>Reset Password</h1>
            <p className="auth-subtitle">Choose how you&apos;d like to reset your password.</p>
            <form className="auth-form" onSubmit={handleSubmit}>
                <input type="email" placeholder="Email Address" value={email}
                    onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
                <div className="method-selector">
                    <label className={`method-option ${method === 'link' ? 'selected' : ''}`}>
                        <input type="radio" name="reset-method" value="link"
                            checked={method === 'link'} onChange={() => setMethod('link')} />
                        <span className="method-icon"><LinkIcon /></span>
                        <span className="method-text">
                            <strong>Reset link</strong>
                            <small>Receive a secure link via email</small>
                        </span>
                    </label>
                    <label className={`method-option ${method === 'code' ? 'selected' : ''}`}>
                        <input type="radio" name="reset-method" value="code"
                            checked={method === 'code'} onChange={() => setMethod('code')} />
                        <span className="method-icon"><CodeIcon /></span>
                        <span className="method-text">
                            <strong>6-digit code</strong>
                            <small>Receive a one-time code via email</small>
                        </span>
                    </label>
                </div>
                <button type="submit" className="btn-auth" disabled={isLoading}>
                    {isLoading ? 'Sending…' : 'Send Reset Instructions'}
                </button>
            </form>
            {message && <p className={`message ${isError ? 'error' : 'success'}`}>{message}</p>}
            <Link to="/signin" className="home-link">Back to Sign In</Link>
        </>
    );
}

function CodeStage({ email, onVerified }) {
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
        if (code.length < CODE_LENGTH) { setIsError(true); setMessage('Please enter the full 6-digit code.'); return; }
        setMessage(''); setIsError(false); setIsLoading(true);
        try {
            const res = await fetch(`${API_BASE}/api/verify-reset-code`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, code }),
            });
            const data = await res.text().then((t) => (t ? JSON.parse(t) : {}));
            if (!res.ok) throw new Error(data.detail || `Error ${res.status}`);
            onVerified(data.resetToken);
        } catch (err) { setIsError(true); setMessage(err.message); }
        finally { setIsLoading(false); }
    };

    const handleResend = async () => {
        if (resendCooldown > 0) return;
        setMessage(''); setIsError(false);
        try {
            const res = await fetch(`${API_BASE}/api/forgot-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, method: 'code' }),
            });
            const data = await res.text().then((t) => (t ? JSON.parse(t) : {}));
            if (!res.ok) throw new Error(data.detail || `Error ${res.status}`);
            setMessage(data.message || 'New code sent!');
            setResendCooldown(60);
        } catch (err) { setIsError(true); setMessage(err.message); }
    };

    return (
        <>
            <h1>Enter Your Code</h1>
            <p className="auth-subtitle">We sent a 6-digit code to <strong>{email}</strong>.</p>
            <form className="auth-form" onSubmit={handleSubmit}>
                <div className="otp-inputs" onPaste={handlePaste}>
                    {digits.map((digit, i) => (
                        <input key={i} ref={(el) => (inputRefs.current[i] = el)}
                            className="otp-box" type="text" inputMode="numeric" maxLength={1}
                            value={digit} onChange={(e) => handleDigitChange(i, e.target.value)}
                            onKeyDown={(e) => handleKeyDown(i, e)} aria-label={`Digit ${i + 1}`} />
                    ))}
                </div>
                <button type="submit" className="btn-auth" disabled={isLoading}>
                    {isLoading ? 'Verifying…' : 'Verify Code'}
                </button>
            </form>
            {message && <p className={`message ${isError ? 'error' : 'success'}`}>{message}</p>}
            <p className="resend-row">
                Didn&apos;t receive a code?{' '}
                <button type="button" className="resend-btn" onClick={handleResend} disabled={resendCooldown > 0}>
                    {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
                </button>
            </p>
            <Link to="/signin" className="home-link">Back to Sign In</Link>
        </>
    );
}

function NewPasswordStage({ resetToken }) {
    const navigate = useNavigate();
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showNew, setShowNew] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);
    const [message, setMessage] = useState('');
    const [isError, setIsError] = useState(false);
    const [isLoading, setIsLoading] = useState(false);

    const getStrength = (pwd) => {
        if (!pwd) return null;
        let s = 0;
        if (pwd.length >= 8) s++;
        if (/[A-Z]/.test(pwd)) s++;
        if (/[0-9]/.test(pwd)) s++;
        if (/[^A-Za-z0-9]/.test(pwd)) s++;
        return [null, { label: 'Weak', level: 1 }, { label: 'Fair', level: 2 },
            { label: 'Good', level: 3 }, { label: 'Strong', level: 4 }][s] || { label: 'Weak', level: 1 };
    };
    const strength = getStrength(newPassword);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (newPassword !== confirmPassword) { setIsError(true); setMessage('Passwords do not match.'); return; }
        setMessage(''); setIsError(false); setIsLoading(true);
        try {
            const res = await fetch(`${API_BASE}/api/reset-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ resetToken, newPassword }),
            });
            const data = await res.text().then((t) => (t ? JSON.parse(t) : {}));
            if (!res.ok) throw new Error(data.detail || `Error ${res.status}`);
            setMessage(data.message || 'Password updated! Redirecting to sign in…');
            setTimeout(() => navigate('/signin'), 1500);
        } catch (err) { setIsError(true); setMessage(err.message); }
        finally { setIsLoading(false); }
    };

    return (
        <>
            <h1>New Password</h1>
            <p className="auth-subtitle">Choose a strong new password for your account.</p>
            <form className="auth-form" onSubmit={handleSubmit}>
                <div className="password-wrapper">
                    <input type={showNew ? 'text' : 'password'} placeholder="New Password"
                        value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                        autoComplete="new-password" required />
                    <button type="button" className="toggle-password" onClick={() => setShowNew((v) => !v)}
                        aria-label={showNew ? 'Hide' : 'Show'}>{showNew ? <EyeOffIcon /> : <EyeIcon />}</button>
                </div>
                {newPassword && strength && (
                    <div className="password-strength">
                        <div className="strength-bars">
                            {[1, 2, 3, 4].map((l) => (
                                <div key={l} className={`strength-bar ${strength.level >= l ? `level-${strength.level}` : ''}`} />
                            ))}
                        </div>
                        <span className={`strength-label level-${strength.level}`}>{strength.label}</span>
                    </div>
                )}
                <div className="password-wrapper">
                    <input type={showConfirm ? 'text' : 'password'} placeholder="Confirm New Password"
                        value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                        autoComplete="new-password" required />
                    <button type="button" className="toggle-password" onClick={() => setShowConfirm((v) => !v)}
                        aria-label={showConfirm ? 'Hide' : 'Show'}>{showConfirm ? <EyeOffIcon /> : <EyeIcon />}</button>
                </div>
                {confirmPassword && (
                    <p className={`message ${newPassword === confirmPassword ? 'success' : 'error'}`} style={{ marginTop: 0 }}>
                        {newPassword === confirmPassword ? '✓ Passwords match' : '✗ Passwords do not match'}
                    </p>
                )}
                <button type="submit" className="btn-auth"
                    disabled={isLoading || Boolean(confirmPassword && newPassword !== confirmPassword)}>
                    {isLoading ? 'Saving…' : 'Set New Password'}
                </button>
            </form>
            {message && <p className={`message ${isError ? 'error' : 'success'}`}>{message}</p>}
            <Link to="/signin" className="home-link">Back to Sign In</Link>
        </>
    );
}

function ForgotPasswordPage() {
    const [searchParams] = useSearchParams();
    const [stage, setStage] = useState(() =>
        searchParams.get('resetToken') ? 'new-password' : 'request'
    );
    const [email, setEmail] = useState('');
    const [resetToken, setResetToken] = useState(searchParams.get('resetToken') || '');

    const handleSent = ({ email: e, method }) => {
        setEmail(e);
        if (method === 'code') setStage('code');
    };

    return (
        <div className="auth-page">
            {stage === 'request' && <RequestStage onSent={handleSent} />}
            {stage === 'code' && <CodeStage email={email} onVerified={(token) => { setResetToken(token); setStage('new-password'); }} />}
            {stage === 'new-password' && <NewPasswordStage resetToken={resetToken} />}
        </div>
    );
}

function EyeIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
        </svg>
    );
}
function EyeOffIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
            <line x1="1" y1="1" x2="23" y2="23" />
        </svg>
    );
}
function LinkIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
    );
}
function CodeIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
            <line x1="9" y1="9" x2="15" y2="9" /><line x1="9" y1="13" x2="15" y2="13" /><line x1="9" y1="17" x2="12" y2="17" />
        </svg>
    );
}

export default ForgotPasswordPage;
