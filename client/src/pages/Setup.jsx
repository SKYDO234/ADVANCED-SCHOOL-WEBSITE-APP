import { useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { post } from '../api.js';
import { useApp } from '../store.jsx';
import { Alert, Button, Card, Input, Select, useToast } from '../ui/index.jsx';
import Icon from '../ui/Icon.jsx';

const STEPS = ['School', 'Academic year', 'Principal account', 'Finish'];

export default function Setup() {
  const { status, setStatus, login, reloadPublic } = useApp();
  const toast = useToast();
  const navigate = useNavigate();
  const now = new Date();
  const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;

  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    schoolName: '',
    schoolCode: '',
    tagline: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    state: '',
    pincode: '',
    website: '',
    affiliation: '',
    currency: 'INR',
    currencySymbol: '₹',
    timezone: 'Asia/Kolkata',
    sessionName: `${year}-${String((year + 1) % 100).padStart(2, '0')}`,
    sessionStart: `${year}-04-01`,
    sessionEnd: `${year + 1}-03-31`,
    principalName: '',
    principalEmail: '',
    principalPassword: '',
    principalPhone: '',
  });

  const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));

  const schoolReady = form.schoolName.trim().length >= 2 && /^[A-Za-z0-9-]{2,20}$/.test(form.schoolCode) && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email);
  const sessionReady = form.sessionName.trim().length >= 4 && form.sessionStart && form.sessionEnd && new Date(form.sessionEnd) > new Date(form.sessionStart);
  const principalReady = form.principalName.trim().length >= 2 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.principalEmail) && form.principalPassword.length >= 8;

  const canContinue = useMemo(() => [schoolReady, sessionReady, principalReady, true][step], [step, schoolReady, sessionReady, principalReady]);

  if (status === 'ready') return <Navigate to="/app" replace />;
  if (status === 'anonymous' && step !== 3) {
    // Setup already completed elsewhere.
    return <Navigate to="/login" replace />;
  }

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await post('/setup', form);
      toast.success('School created', 'Signing you in as the principal…');
      setStatus('setup-complete');
      await reloadPublic();
      await login(form.principalEmail, form.principalPassword);
      navigate('/app', { replace: true });
    } catch (err) {
      setError(err.message || 'Could not complete setup');
      setStep(0);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-form-side" style={{ minHeight: '100vh', display: 'block', paddingTop: 40 }}>
      <div style={{ width: '100%', maxWidth: 760, margin: '0 auto' }}>
        <div className="row gap-2 mb-3">
          <span className="brand-mark"><Icon name="school" size={18} /></span>
          <div>
            <h1 style={{ fontSize: '1.4rem' }}>Set up your school</h1>
            <div className="page-sub">A guided, four-step start. Everything here can be changed later in Settings.</div>
          </div>
        </div>

        <div className="row gap-1 mb-3" style={{ flexWrap: 'wrap' }}>
          {STEPS.map((label, i) => (
            <div key={label} className="row gap-1" style={{ flex: 1, minWidth: 130 }}>
              <span
                style={{
                  width: 26, height: 26, borderRadius: '50%', display: 'grid', placeItems: 'center', flex: 'none',
                  fontSize: 12.5, fontWeight: 650,
                  background: i <= step ? 'var(--accent)' : 'var(--bg-hover)',
                  color: i <= step ? '#fff' : 'var(--ink-3)',
                }}
              >
                {i < step ? <Icon name="check" size={13} /> : i + 1}
              </span>
              <span className={i === step ? 'strong' : 'muted'} style={{ fontSize: 13 }}>{label}</span>
              {i < STEPS.length - 1 ? <span className="grow" style={{ height: 1, background: 'var(--line)' }} /> : null}
            </div>
          ))}
        </div>

        {error ? <div className="mb-2"><Alert tone="danger" title="Setup could not be completed">{error}</Alert></div> : null}

        <Card>
          {step === 0 ? (
            <>
              <h3 className="mb-2">School details</h3>
              <div className="field-row">
                <Input label="School name" required placeholder="Sunrise International School" value={form.schoolName} onChange={(e) => set({ schoolName: e.target.value })} />
                <Input
                  label="Short code"
                  required
                  placeholder="SUNRISE"
                  value={form.schoolCode}
                  onChange={(e) => set({ schoolCode: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '') })}
                  hint="Used on documents and for multi-school logins."
                />
              </div>
              <Input label="Tagline" placeholder="Learning with purpose" value={form.tagline} onChange={(e) => set({ tagline: e.target.value })} />
              <div className="field-row">
                <Input label="School email" type="email" required placeholder="office@school.edu" value={form.email} onChange={(e) => set({ email: e.target.value })} />
                <Input label="Phone" placeholder="+91 98765 43210" value={form.phone} onChange={(e) => set({ phone: e.target.value })} />
              </div>
              <Input label="Address" placeholder="12 Park Road" value={form.address} onChange={(e) => set({ address: e.target.value })} />
              <div className="field-row">
                <Input label="City" value={form.city} onChange={(e) => set({ city: e.target.value })} />
                <Input label="State" value={form.state} onChange={(e) => set({ state: e.target.value })} />
                <Input label="PIN code" value={form.pincode} onChange={(e) => set({ pincode: e.target.value })} />
              </div>
              <div className="field-row">
                <Input label="Website" placeholder="https://school.edu" value={form.website} onChange={(e) => set({ website: e.target.value })} />
                <Input label="Affiliation" placeholder="CBSE Affiliation No." value={form.affiliation} onChange={(e) => set({ affiliation: e.target.value })} />
              </div>
              <div className="field-row">
                <Select
                  label="Currency"
                  value={form.currency}
                  onChange={(e) => {
                    const map = { INR: '₹', USD: '$', EUR: '€', GBP: '£', AED: 'د.إ', SGD: 'S$' };
                    set({ currency: e.target.value, currencySymbol: map[e.target.value] || form.currencySymbol });
                  }}
                  options={['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD']}
                />
                <Input label="Currency symbol" value={form.currencySymbol} onChange={(e) => set({ currencySymbol: e.target.value })} />
                <Select label="Timezone" value={form.timezone} onChange={(e) => set({ timezone: e.target.value })} options={['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'America/New_York']} />
              </div>
            </>
          ) : null}

          {step === 1 ? (
            <>
              <h3 className="mb-2">Academic year</h3>
              <p className="muted fs-13 mb-2">This becomes the current session. Classes, sections and fee structures will belong to it.</p>
              <Input label="Session name" required placeholder="2026-27" value={form.sessionName} onChange={(e) => set({ sessionName: e.target.value })} />
              <div className="field-row">
                <Input label="Start date" type="date" required value={form.sessionStart} onChange={(e) => set({ sessionStart: e.target.value })} />
                <Input label="End date" type="date" required value={form.sessionEnd} onChange={(e) => set({ sessionEnd: e.target.value })} />
              </div>
              {!sessionReady ? <Alert tone="warning">The end date must be after the start date.</Alert> : null}
            </>
          ) : null}

          {step === 2 ? (
            <>
              <h3 className="mb-2">Principal account</h3>
              <p className="muted fs-13 mb-2">This account owns the workspace and can add every other user and role.</p>
              <div className="field-row">
                <Input label="Full name" required placeholder="Dr. Anita Rao" value={form.principalName} onChange={(e) => set({ principalName: e.target.value })} />
                <Input label="Phone" value={form.principalPhone} onChange={(e) => set({ principalPhone: e.target.value })} />
              </div>
              <Input label="Email" type="email" required placeholder="principal@school.edu" value={form.principalEmail} onChange={(e) => set({ principalEmail: e.target.value })} autoComplete="username" />
              <Input
                label="Password"
                type="password"
                required
                value={form.principalPassword}
                onChange={(e) => set({ principalPassword: e.target.value })}
                hint="Minimum 8 characters, with upper and lower case letters and a number."
                autoComplete="new-password"
              />
            </>
          ) : null}

          {step === 3 ? (
            <>
              <h3 className="mb-2">Review & finish</h3>
              <div className="grid grid-2" style={{ gap: 14 }}>
                <div className="card-pad" style={{ background: 'var(--bg-subtle)', borderRadius: 10 }}>
                  <div className="fs-12 muted">School</div>
                  <div className="strong">{form.schoolName}</div>
                  <div className="fs-13 muted">{form.city}{form.state ? `, ${form.state}` : ''}</div>
                  <div className="fs-13">{form.email}</div>
                  <div className="fs-13 muted">Code: {form.schoolCode}</div>
                </div>
                <div className="card-pad" style={{ background: 'var(--bg-subtle)', borderRadius: 10 }}>
                  <div className="fs-12 muted">Session</div>
                  <div className="strong">{form.sessionName}</div>
                  <div className="fs-13 muted">{form.sessionStart} → {form.sessionEnd}</div>
                  <div className="fs-12 muted mt-2">Principal</div>
                  <div className="strong">{form.principalName}</div>
                  <div className="fs-13">{form.principalEmail}</div>
                </div>
              </div>
              <div className="mt-3">
                <Alert tone="info" title="What happens next?">
                  Classes, subjects, grading scales, role permissions and the website are created automatically. You can import students or add them one by one.
                </Alert>
              </div>
            </>
          ) : null}

          <div className="row-between mt-3" style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}>
            <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || busy} icon="arrowLeft">Back</Button>
            {step < STEPS.length - 1 ? (
              <Button variant="primary" onClick={() => setStep((s) => s + 1)} disabled={!canContinue} iconRight="arrowRight">Continue</Button>
            ) : (
              <Button variant="primary" loading={busy} onClick={submit} icon="check">Create school & sign in</Button>
            )}
          </div>
        </Card>

        <p className="fs-12 muted center mt-3">Already configured? <a href="/login">Go to sign in</a></p>
      </div>
    </div>
  );
}
