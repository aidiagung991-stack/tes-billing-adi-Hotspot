import React, { useState, useEffect } from 'react';
import { Radio, Lock, User, Eye, EyeOff, AlertCircle, ShieldCheck } from 'lucide-react';

interface LoginPageProps {
  authConfigured: boolean;
  initialNotice?: string | null;
  onLogin: (username: string, password: string) => Promise<{ success: boolean; message?: string }>;
}

export const LoginPage: React.FC<LoginPageProps> = ({
  authConfigured,
  initialNotice,
  onLogin,
}) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(initialNotice || null);

  useEffect(() => {
    if (initialNotice) {
      setErrorMessage(initialNotice);
    }
  }, [initialNotice]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const trimmedUsername = username.trim();
    if (!trimmedUsername || !password) {
      setErrorMessage('Username dan password admin wajib diisi.');
      return;
    }

    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      const result = await onLogin(trimmedUsername, password);
      if (!result.success) {
        setErrorMessage(result.message || 'Username atau password tidak valid.');
        setPassword('');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col justify-center px-4 py-8 sm:px-6 font-sans antialiased text-slate-800">
      <div className="w-full max-w-md mx-auto">
        <div className="flex items-center justify-center gap-3 mb-6">
          <div className="w-11 h-11 rounded-xl bg-slate-900 flex items-center justify-center text-white shadow-sm">
            <Radio className="w-6 h-6 text-blue-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight leading-tight">
              Adi_Hotspot Billing
            </h1>
            <p className="text-xs font-medium text-slate-500">
              Sistem Administrasi RT/RW Net &amp; MikroTik
            </p>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8">
          <div className="mb-6">
            <h2 className="text-lg font-bold text-slate-900 tracking-tight">
              Masuk Panel Administrator
            </h2>
            <p className="text-sm text-slate-600 mt-1">
              Masukkan kredensial admin untuk mengakses data pelanggan, tagihan, dan router.
            </p>
          </div>

          {!authConfigured && (
            <div
              role="alert"
              className="mb-5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900 flex items-start gap-2.5"
            >
              <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Autentikasi Server Belum Dikonfigurasi</p>
                <p className="mt-0.5 text-amber-800">
                  Konfigurasikan <code className="font-mono">ADMIN_USERNAME</code>,{' '}
                  <code className="font-mono">ADMIN_PASSWORD_HASH</code>, dan{' '}
                  <code className="font-mono">SESSION_SECRET</code> di file environment server sebelum login.
                </p>
              </div>
            </div>
          )}

          {errorMessage && (
            <div
              role="alert"
              className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 flex items-start gap-2.5"
            >
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div>
              <label
                htmlFor="admin-username"
                className="block text-sm font-semibold text-slate-700 mb-1.5"
              >
                Username Admin
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="admin-username"
                  name="username"
                  type="text"
                  autoComplete="username"
                  autoFocus
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={isSubmitting}
                  placeholder="Masukkan username admin"
                  className="w-full pl-10 pr-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus:border-blue-600 disabled:bg-slate-50 disabled:text-slate-500 transition-colors"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="admin-password"
                className="block text-sm font-semibold text-slate-700 mb-1.5"
              >
                Password Admin
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="admin-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isSubmitting}
                  placeholder="Masukkan password admin"
                  className="w-full pl-10 pr-11 py-2.5 text-sm bg-white border border-slate-300 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus:border-blue-600 disabled:bg-slate-50 disabled:text-slate-500 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 transition-colors"
                  aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting || !authConfigured}
              className="w-full mt-2 py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 text-white text-sm font-semibold shadow-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-600 transition-colors cursor-pointer disabled:cursor-not-allowed"
            >
              {isSubmitting ? 'Memverifikasi Kredensial...' : 'Masuk ke Dashboard'}
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-slate-100 flex items-center gap-2 text-xs text-slate-500">
            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>Akses dibatasi khusus untuk satu administrator terdaftar.</span>
          </div>
        </div>
      </div>
    </div>
  );
};
