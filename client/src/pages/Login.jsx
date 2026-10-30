import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../store.jsx';
import { assetUrl } from '../api.js';
import { Alert, Button, Input, useToast } from '../ui/index.jsx';
import Icon from '../ui/Icon.jsx';

const DEMO_ACCOUNTS = [
  { role: 'Principal', email: 'principal@sunrise.edu.in', password: 'Principal@123' },
  { role: 'Teacher', email: 'teacher1@sunrise.edu.in', password: 'Teacher@123' },
  { role: 'Accounts', email: 'accounts@sunrise.edu.in', password: 'Staff@123' },
  { role: 'Parent', email: 'parent1@example.com', password: 'Parent@123' },
];

export default function Login() {
  const { status, user, login, publicSite, theme, refresh } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const [form, setForm] = useState({ email: '', password: '', totp: '', schoolCode: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [showSchoolCode, setShowSchoolCode] = useState(false);
  const [needsTotp, setNeedsTotp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const school = publicSite?.school;
  const from = location.state?.from?.pathname;

  if (status === 'ready' && user) {
    const target = ['student', 'parent'].includes(user.role) ? '/portal' : (from || '/app');
    return <Navigate to={target} replace />;
  }
  if (status === 'setup') return <Navigate to="/setup" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const result = await login(form.email.trim(), form.password, needsTotp ? form.totp.trim() : '', showSchoolCode ? form.schoolCode.trim() : '');
      toast.success('Signed in', `Welcome back, ${result.user?.full_name?.split(' ')[0] || ''}!`);
      const role = result.user?.role;
      await refresh();
      navigate(['student', 'parent'].includes(role) ? '/portal' : (from || '/app'), { replace: true });
    } catch (err) {
      if (err.code === 'two_factor_required') {
        setNeedsTotp(true);
        setError('Enter the 6-digit code from your authenticator app.');
      } else {
        setError(err.message || 'Could not sign in');
      }
    } finally {
      setBusy(false);
    }
  };

  const fillDemo = (account) => setForm({ ...form, email: account.email, password: account.password });

  return (
    <div className="auth-shell">
      <div className="auth-brand">
        <div>
          <div className="row gap-2" style={{ marginBottom: 34 }}>
            <span className="brand-mark" style={{ width: 42, height: 42, fontSize: 16 }}>
              {school?.logo_url ? <img src={assetUrl(school.logo_url)} alt="" /> : (school?.name || 'S').slice(0, 1)}
            </span>
            <div>
              <div style={{ fontWeight: 650 }}>{school?.name || 'School ERP'}</div>
              <div style={{ color: 'rgba(219,231,250,0.7)', fontSize: 12.5 }}>{school?.city || 'School management workspace'}</div>
            </div>
          </div>
          <h2>{theme?.loginTitle || 'One workspace for your entire school'}</h2>
          <p style={{ marginTop: 12 }}>{theme?.loginSubtitle || 'Admissions, attendance, examinations, fees, communication and analytics — in one calm, reliable place.'}</p>
          <div className="auth-points">
            {[
              ['attendance', 'Attendance in seconds — class grids, staff registers and reports'],
              ['fees', 'Invoices, receipts and reconciliation with printable documents'],
              ['exam', 'Exams, marks entry, ranks and report cards that publish in one click'],
              ['shield', 'Role-based access with a full audit trail'],
            ].map(([icon, text]) => (
              <div className="auth-point" key={text}>
                <span className="tick"><Icon name={icon === 'exam' ? 'exams' : icon} size={12} /></span>
                {text}
              </div>
            ))}
          </div>
        </div>
        <div className="fs-12" style={{ color: 'rgba(219,231,250,0.55)' }}>
          © {new Date().getFullYear()} {school?.name || 'School ERP'} · Powered by School ERP
        </div>
      </div>

      <div className="auth-form-side">
        <div className="auth-card">
          <div className="only-mobile row gap-1 mb-2" style={{ display: 'none' }}>
            <span className="brand-mark">{school?.name?.slice(0, 1) || 'S'}</span>
            <strong>{school?.name}</strong>
          </div>
          <h1>Sign in</h1>
          <p className="sub">Use the credentials issued by your school administrator.</p>

          {error ? <div className="mb-2"><Alert tone="danger">{error}</Alert></div> : null}

          <form onSubmit={submit}>
            <Input
              label="Email address"
              type="email"
              required
              autoComplete="username"
              placeholder="you@school.edu"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
            <div style={{ position: 'relative' }}>
              <Input
                label="Password"
                type={showPassword ? 'text' : 'password'}
                required
                autoComplete="current-password"
                placeholder="••••••••"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
              <button
                type="button"
                className="icon-btn"
                style={{ position: 'absolute', right: 4, top: 26, width: 32, height: 32 }}
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                <Icon name={showPassword ? 'eyeOff' : 'eye'} size={16} />
              </button>
            </div>

            {needsTotp ? (
              <Input
                label="Two-factor code"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                required
                placeholder="123456"
                value={form.totp}
                onChange={(e) => setForm({ ...form, totp: e.target.value })}
              />
            ) : null}

            {showSchoolCode ? (
              <Input
                label="School code"
                placeholder="SUNRISE"
                value={form.schoolCode}
                onChange={(e) => setForm({ ...form, schoolCode: e.target.value })}
                hint="Only needed when the same email exists in more than one school."
              />
            ) : (
              <button type="button" className="btn btn-ghost btn-sm" style={{ paddingLeft: 0 }} onClick={() => setShowSchoolCode(true)}>
                <Icon name="school" size={14} /> Signing in to a specific school?
              </button>
            )}

            <Button type="submit" variant="primary" size="lg" block loading={busy} className="mt-2">
              Sign in
            </Button>
          </form>

          {school?.is_demo ? (
            <div className="demo-box">
              <div className="row-between mb-1">
                <strong className="fs-12">Demo accounts</strong>
                <span className="fs-12 muted">Click to fill</span>
              </div>
              {DEMO_ACCOUNTS.map((account) => (
                <button
                  key={account.email}
                  type="button"
                  className="demo-row"
                  style={{ border: 0, background: 'transparent', width: '100%', cursor: 'pointer', textAlign: 'left' }}
                  onClick={() => fillDemo(account)}
                >
                  <span style={{ fontWeight: 560 }}>{account.role}</span>
                  <code>{account.email}</code>
                  <span className="muted">{account.password}</span>
                </button>
              ))}
            </div>
          ) : null}

          <div className="row-between mt-3">
            <Link to="/" className="fs-13">← Back to website</Link>
            <span className="fs-12 muted">Parents & students: use the portal login</span>
          </div>
        </div>
      </div>
    </div>
  );
}
