import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

export default function LoginPage() {
  const { login, user, loading } = useAuth();
  const { push } = useToast();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) {
      navigate('/', { replace: true });
    }
  }, [loading, user, navigate]);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await login(username, password);
      push('Logged in successfully');
      navigate('/', { replace: true });
    } catch (err) {
      push(err.message || 'Login failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4">
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at top left, #E8F5EE 0%, #ffffff 45%, #F5F6F7 100%)',
        }}
      />
      <div
        className="absolute -right-20 -top-20 h-72 w-72 rounded-full opacity-30"
        style={{ background: 'radial-gradient(circle, #3D9B5F 0%, transparent 70%)' }}
      />
      <form
        onSubmit={onSubmit}
        className="relative z-10 w-full max-w-md rounded-2xl border border-hw-dark/10 bg-white/95 p-8 shadow-lg"
      >
        <div className="mb-8 text-center">
          <h1 className="font-display text-3xl font-bold tracking-wide text-hw-dark">
            H&W PRODUCE
          </h1>
          <p className="mt-1 text-sm font-medium uppercase tracking-wider text-hw-muted">
            Digital Signage
          </p>
        </div>
        <label className="label" htmlFor="username">
          Username
        </label>
        <input
          id="username"
          className="input mb-4"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          required
        />
        <label className="label" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          type="password"
          className="input mb-6"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? 'Signing in…' : 'LOGIN'}
        </button>
      </form>
    </div>
  );
}
