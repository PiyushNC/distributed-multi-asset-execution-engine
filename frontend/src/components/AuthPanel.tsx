import { useState, type FormEvent } from 'react';

import { useSocket } from '../context/SocketContext';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

export function AuthPanel({ onClose }: { onClose: () => void }) {
  const { setToken } = useSocket();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage('Connecting...');
    try {
      const response = await fetch(`${API_URL}/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json() as { accessToken?: string; message?: string };
      if (!response.ok || !data.accessToken) throw new Error(data.message ?? 'Authentication failed');
      setToken(data.accessToken);
      onClose();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Authentication failed');
    }
  }

  return (
    <div className="auth-backdrop" role="dialog" aria-modal="true">
      <form className="auth-card" onSubmit={submit}>
        <button className="close-button" type="button" onClick={onClose}>×</button>
        <span className="eyebrow">Secure access</span>
        <h2>{mode === 'login' ? 'Welcome back' : 'Create trading account'}</h2>
        <p className="auth-copy">Connect to the execution engine to place and monitor live orders.</p>
        <label>Email<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="trader@example.com" /></label>
        <label>Password<input type="password" required minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 6 characters" /></label>
        <button className="auth-submit" type="submit">{mode === 'login' ? 'Sign in' : 'Create account'} <span>→</span></button>
        {message ? <p className="form-message">{message}</p> : null}
        <button className="mode-switch" type="button" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>{mode === 'login' ? 'Need an account? Register' : 'Already registered? Sign in'}</button>
      </form>
    </div>
  );
}
