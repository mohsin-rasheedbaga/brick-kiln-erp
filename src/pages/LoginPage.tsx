import { useState, type FormEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';
import { useToastStore } from '../stores/toast';
import { Spinner } from '../components/Feedback';
import { Boxes, Lock, User as UserIcon, AlertCircle } from 'lucide-react';

export default function LoginPage() {
  const { login, loading, error } = useAuthStore();
  const pushToast = useToastStore((s) => s.push);
  const navigate = useNavigate();
  const location = useLocation();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      pushToast('warning', 'Please enter username and password.');
      return;
    }
    try {
      await login(username.trim(), password);
      pushToast('success', 'Welcome back!');
      const from = (location.state as { from?: { pathname: string } })?.from?.pathname || '/dashboard';
      navigate(from, { replace: true });
    } catch (err: any) {
      pushToast('error', err.message || 'Login failed.');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-slate-900 via-slate-800 to-brand-900">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-brand-600 text-white shadow-lg mb-4">
            <Boxes className="h-8 w-8" />
          </div>
          <h1 className="text-2xl font-bold text-white">Brick Kiln ERP</h1>
          <p className="text-slate-300 text-sm mt-1">Production · Labour · Sales · Accounts</p>
        </div>

        <div className="bg-white rounded-xl shadow-2xl p-6 sm:p-8">
          <h2 className="text-lg font-semibold text-slate-900 mb-1">Sign In</h2>
          <p className="text-sm text-slate-500 mb-5">Enter your credentials to access the system.</p>

          {error && (
            <div className="mb-4 flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
              <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label" htmlFor="username">Username</label>
              <div className="relative">
                <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                  id="username"
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="input pl-9"
                  placeholder="e.g. admin"
                  disabled={loading}
                  autoFocus
                />
              </div>
            </div>

            <div>
              <label className="label" htmlFor="password">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input pl-9 pr-16"
                  placeholder="••••••••"
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-500 hover:text-slate-700 px-1 py-0.5"
                  tabIndex={-1}
                >
                  {showPassword ? 'HIDE' : 'SHOW'}
                </button>
              </div>
            </div>

            <button
              type="submit"
              className="btn-primary w-full py-2.5"
              disabled={loading}
            >
              {loading ? <Spinner size="sm" className="border-white" /> : 'Sign In'}
            </button>
          </form>

          <div className="mt-6 pt-4 border-t border-slate-100 text-xs text-slate-500 text-center">
            <p className="mb-1"><span className="font-medium">Default credentials (first run):</span></p>
            <p>Username: <code className="bg-slate-100 px-1.5 py-0.5 rounded">admin</code></p>
            <p>Password: <code className="bg-slate-100 px-1.5 py-0.5 rounded">admin123</code></p>
            <p className="mt-2 text-amber-600">You will be asked to change this password on first login.</p>
          </div>
        </div>

        <p className="text-center text-xs text-slate-400 mt-6">
          Brick Kiln ERP v1.0.0 · Windows Desktop Edition
        </p>
      </div>
    </div>
  );
}
