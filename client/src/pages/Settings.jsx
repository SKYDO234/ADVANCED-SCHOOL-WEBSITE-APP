import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { assetUrl, del, downloadFile, get, patch, post, put, upload, useDebounced } from '../api.js';
import { useApp } from '../store.jsx';
import { SETTINGS_TABS } from '../nav.js';
import {
  Alert, Badge, Button, Card, Checkbox, DataTable, EmptyState, FileDrop, Input, KeyValue, Loading, Modal, PageHeader,
  Pagination, SearchField, Select, Stat, Tabs, Textarea, formatDate, formatDateTime, relativeTime, useToast,
} from '../ui/index.jsx';
import Icon from '../ui/Icon.jsx';

const DAYS = [['1', 'Mon'], ['2', 'Tue'], ['3', 'Wed'], ['4', 'Thu'], ['5', 'Fri'], ['6', 'Sat'], ['7', 'Sun']];

function bytes(value = 0) {
  if (!value) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

/* ---------------------------------- school -------------------------------- */

function SchoolTab({ data, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({});
  const [days, setDays] = useState([1, 2, 3, 4, 5, 6]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState('');
  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  useEffect(() => {
    if (!data?.school) return;
    setForm(data.school);
    try { setDays(JSON.parse(data.school.working_days || '[1,2,3,4,5,6]')); } catch { setDays([1, 2, 3, 4, 5, 6]); }
  }, [data]);

  const save = async () => {
    setBusy(true);
    try {
      await patch('/settings/school', { ...form, working_days: days });
      toast.success('School profile saved');
      onSaved();
    } catch (err) { toast.error('Could not save', err.message); } finally { setBusy(false); }
  };

  const uploadBrand = async (kind, file) => {
    setUploading(kind);
    try {
      await upload(`/settings/branding/${kind}`, file);
      toast.success(`${kind === 'logo' ? 'Logo' : 'Favicon'} updated`);
      onSaved();
    } catch (err) { toast.error('Upload failed', err.message); } finally { setUploading(''); }
  };

  return (
    <>
      <Card title="School profile" subtitle="This information appears on invoices, report cards and the public website." className="mb-3">
        <div className="field-row">
          <Input label="School name" required value={form.name || ''} onChange={(e) => set('name', e.target.value)} />
          <Input label="Tagline" value={form.tagline || ''} onChange={(e) => set('tagline', e.target.value)} />
          <Input label="Affiliation / board" value={form.affiliation || ''} onChange={(e) => set('affiliation', e.target.value)} />
        </div>
        <Input label="Address" value={form.address || ''} onChange={(e) => set('address', e.target.value)} />
        <div className="field-row">
          <Input label="City" value={form.city || ''} onChange={(e) => set('city', e.target.value)} />
          <Input label="State" value={form.state || ''} onChange={(e) => set('state', e.target.value)} />
          <Input label="PIN code" value={form.pincode || ''} onChange={(e) => set('pincode', e.target.value)} />
          <Input label="Country" value={form.country || ''} onChange={(e) => set('country', e.target.value)} />
        </div>
        <div className="field-row">
          <Input label="Phone" value={form.phone || ''} onChange={(e) => set('phone', e.target.value)} />
          <Input label="Email" type="email" value={form.email || ''} onChange={(e) => set('email', e.target.value)} />
          <Input label="Website" value={form.website || ''} onChange={(e) => set('website', e.target.value)} />
          <Input label="Principal name" value={form.principal_name || ''} onChange={(e) => set('principal_name', e.target.value)} />
        </div>
        <div className="field-row">
          <Input label="Currency code" value={form.currency || ''} onChange={(e) => set('currency', e.target.value)} />
          <Input label="Currency symbol" value={form.currency_symbol || ''} onChange={(e) => set('currency_symbol', e.target.value)} />
          <Input label="Timezone" value={form.timezone || ''} onChange={(e) => set('timezone', e.target.value)} />
          <Input label="Locale" value={form.locale || ''} onChange={(e) => set('locale', e.target.value)} />
        </div>
        <div className="mb-2">
          <div className="label mb-1">Working days</div>
          <div className="row row-wrap gap-2">
            {DAYS.map(([value, label]) => (
              <Checkbox key={value} label={label} checked={days.includes(Number(value))} onChange={(e) => setDays(e.target.checked ? [...days, Number(value)] : days.filter((d) => d !== Number(value)))} />
            ))}
          </div>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}><Button variant="primary" loading={busy} onClick={save}>Save school profile</Button></div>
      </Card>

      <div className="grid grid-2">
        <Card title="Logo" subtitle="Used on the sidebar, login page and documents.">
          {data?.school?.logo_url ? <img src={assetUrl(data.school.logo_url)} alt="School logo" style={{ height: 64, marginBottom: 12, objectFit: 'contain' }} /> : null}
          <FileDrop accept="image/*" onFile={(file) => uploadBrand('logo', file)} uploading={uploading === 'logo'} label="Upload logo (PNG or SVG, up to 2 MB)" />
        </Card>
        <Card title="Favicon" subtitle="The small icon shown in browser tabs.">
          {data?.school?.favicon_url ? <img src={assetUrl(data.school.favicon_url)} alt="Favicon" style={{ height: 40, marginBottom: 12, objectFit: 'contain' }} /> : null}
          <FileDrop accept="image/*" onFile={(file) => uploadBrand('favicon', file)} uploading={uploading === 'favicon'} label="Upload favicon (32×32 PNG or SVG)" />
        </Card>
      </div>
    </>
  );
}

/* --------------------------------- branding ------------------------------- */

function BrandingTab({ data, onSaved }) {
  const toast = useToast();
  const { refresh } = useApp();
  const [theme, setTheme] = useState({});
  const [report, setReport] = useState({});
  const [invoice, setInvoice] = useState({});
  const [busy, setBusy] = useState('');

  useEffect(() => {
    if (!data) return;
    setTheme(data.theme || {});
    setReport(data.reportCard || {});
    setInvoice(data.invoiceTemplate || {});
  }, [data]);

  const saveTheme = async () => {
    setBusy('theme');
    try {
      await put('/settings/theme', {
        mode: theme.mode, accent: theme.accent, accentSoft: theme.accentSoft, radius: theme.radius, font: theme.font,
        sidebarStyle: theme.sidebarStyle, density: theme.density, loginTitle: theme.loginTitle, loginSubtitle: theme.loginSubtitle,
        showPublicWebsite: !!theme.showPublicWebsite,
      });
      toast.success('Theme saved');
      await refresh();
      onSaved();
    } catch (err) { toast.error('Could not save theme', err.message); } finally { setBusy(''); }
  };

  const saveReport = async () => {
    setBusy('report');
    try { await put('/settings/report-card-template', report); toast.success('Report card template saved'); onSaved(); } catch (err) { toast.error('Could not save', err.message); } finally { setBusy(''); }
  };

  const saveInvoice = async () => {
    setBusy('invoice');
    try { await put('/settings/invoice-template', { accent: invoice.accent, footerNote: invoice.footerNote }); toast.success('Invoice template saved'); onSaved(); } catch (err) { toast.error('Could not save', err.message); } finally { setBusy(''); }
  };

  return (
    <div className="col gap-3">
      <Card title="Appearance" subtitle="Colour, density and login copy for the whole school." actions={<Button size="sm" variant="primary" loading={busy === 'theme'} onClick={saveTheme}>Save appearance</Button>}>
        <div className="field-row">
          <Select label="Colour mode" value={theme.mode || 'light'} onChange={(e) => setTheme({ ...theme, mode: e.target.value })} options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'system', label: 'Follow system' }]} />
          <Select label="Density" value={theme.density || 'comfortable'} onChange={(e) => setTheme({ ...theme, density: e.target.value })} options={[{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }]} />
          <Select label="Sidebar style" value={theme.sidebarStyle || 'dark'} onChange={(e) => setTheme({ ...theme, sidebarStyle: e.target.value })} options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }, { value: 'accent', label: 'Accent' }]} />
        </div>
        <div className="field-row">
          <div>
            <label className="label">Accent colour</label>
            <div className="row gap-1">
              <input type="color" value={theme.accent || '#1f3b73'} onChange={(e) => setTheme({ ...theme, accent: e.target.value })} style={{ width: 44, height: 38, border: '1px solid var(--line)', borderRadius: 9, background: 'transparent' }} />
              <input className="input" value={theme.accent || ''} onChange={(e) => setTheme({ ...theme, accent: e.target.value })} />
            </div>
          </div>
          <Select label="Corner radius" value={theme.radius || '12px'} onChange={(e) => setTheme({ ...theme, radius: e.target.value })} options={['6px', '9px', '12px', '16px', '20px'].map((r) => ({ value: r, label: r }))} />
          <Select label="Font" value={theme.font || 'Inter'} onChange={(e) => setTheme({ ...theme, font: e.target.value })} options={['Inter', 'Manrope', 'DM Sans', 'system-ui'].map((f) => ({ value: f, label: f }))} />
        </div>
        <div className="field-row">
          <Input label="Login heading" value={theme.loginTitle || ''} onChange={(e) => setTheme({ ...theme, loginTitle: e.target.value })} />
          <Input label="Login sub-text" value={theme.loginSubtitle || ''} onChange={(e) => setTheme({ ...theme, loginSubtitle: e.target.value })} />
        </div>
        <Checkbox label="Show the public website" checked={!!theme.showPublicWebsite} onChange={(e) => setTheme({ ...theme, showPublicWebsite: e.target.checked })} />
      </Card>

      <Card title="Report card template" subtitle="Choose what appears on printed report cards." actions={<Button size="sm" variant="primary" loading={busy === 'report'} onClick={saveReport}>Save template</Button>}>
        <div className="field-row">
          <Input label="Heading" value={report.title || ''} onChange={(e) => setReport({ ...report, title: e.target.value })} />
          <Input label="Footer note" value={report.footerNote || ''} onChange={(e) => setReport({ ...report, footerNote: e.target.value })} />
          <div>
            <label className="label">Accent colour</label>
            <input type="color" value={report.accent || '#1f3b73'} onChange={(e) => setReport({ ...report, accent: e.target.value })} style={{ width: 44, height: 38, border: '1px solid var(--line)', borderRadius: 9, background: 'transparent' }} />
          </div>
        </div>
        <div className="grid grid-3 gap-2">
          {[
            ['showPhoto', 'Student photo'], ['showRank', 'Class rank'], ['showAttendance', 'Attendance summary'],
            ['showGradeLegend', 'Grade legend'], ['showTeacherRemark', 'Teacher remark'], ['showPrincipalRemark', 'Principal remark'],
            ['showSignature', 'Signatures'], ['showStamp', 'School seal'], ['showDob', 'Date of birth'],
            ['showFatherName', "Father's name"], ['showSubjectRemark', 'Subject remarks'],
          ].map(([key, label]) => (
            <Checkbox key={key} label={label} checked={!!report[key]} onChange={(e) => setReport({ ...report, [key]: e.target.checked })} />
          ))}
        </div>
        <div className="field-row mt-2">
          <Input label="Principal label" value={report.principalLabel || ''} onChange={(e) => setReport({ ...report, principalLabel: e.target.value })} />
          <Input label="Teacher label" value={report.teacherLabel || ''} onChange={(e) => setReport({ ...report, teacherLabel: e.target.value })} />
        </div>
      </Card>

      <Card title="Invoice template" subtitle="Accent and footer for fee invoices and receipts." actions={<Button size="sm" variant="primary" loading={busy === 'invoice'} onClick={saveInvoice}>Save template</Button>}>
        <div className="field-row">
          <div>
            <label className="label">Accent colour</label>
            <input type="color" value={invoice.accent || '#1f3b73'} onChange={(e) => setInvoice({ ...invoice, accent: e.target.value })} style={{ width: 44, height: 38, border: '1px solid var(--line)', borderRadius: 9, background: 'transparent' }} />
          </div>
          <Input label="Footer note" value={invoice.footerNote || ''} onChange={(e) => setInvoice({ ...invoice, footerNote: e.target.value })} />
        </div>
      </Card>
    </div>
  );
}

/* -------------------------------- preferences ----------------------------- */

function PreferencesTab({ data, onSaved }) {
  const toast = useToast();
  const [academic, setAcademic] = useState({});
  const [fees, setFees] = useState({});
  const [exams, setExams] = useState({});
  const [attendance, setAttendance] = useState({});
  const [library, setLibrary] = useState({});
  const [notifications, setNotifications] = useState({});
  const [busy, setBusy] = useState('');

  useEffect(() => {
    if (!data?.settings) return;
    setAcademic(data.settings.academic || {});
    setFees(data.settings.fees || {});
    setExams(data.settings.exams || {});
    setAttendance(data.settings.attendance || {});
    setLibrary(data.settings.library || {});
    setNotifications(data.settings.notifications || {});
  }, [data]);

  const save = async (category, payload) => {
    setBusy(category);
    try { await patch(`/settings/${category}`, payload); toast.success('Settings saved'); onSaved(); } catch (err) { toast.error('Could not save', err.message); } finally { setBusy(''); }
  };

  return (
    <div className="col gap-3">
      <Card title="Academic preferences" actions={<Button size="sm" variant="primary" loading={busy === 'academic'} onClick={() => save('academic', academic)}>Save</Button>}>
        <div className="field-row">
          <Select label="Session starts in" value={String(academic.sessionStartMonth ?? 4)} onChange={(e) => setAcademic({ ...academic, sessionStartMonth: Number(e.target.value) })} options={Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: new Date(2024, i, 1).toLocaleString('en', { month: 'long' }) }))} />
          <Select label="Grading style" value={academic.gradingStyle || 'percentage'} onChange={(e) => setAcademic({ ...academic, gradingStyle: e.target.value })} options={[{ value: 'percentage', label: 'Percentage' }, { value: 'grade', label: 'Grades' }, { value: 'both', label: 'Both' }]} />
          <Input label="Attendance lock (days)" type="number" value={academic.attendanceLockDays ?? 7} onChange={(e) => setAcademic({ ...academic, attendanceLockDays: Number(e.target.value) })} hint="Teachers cannot edit attendance older than this." />
        </div>
      </Card>

      <Card title="Attendance rules" actions={<Button size="sm" variant="primary" loading={busy === 'attendance'} onClick={() => save('attendance', attendance)}>Save</Button>}>
        <div className="field-row">
          <Input label="Late after (minutes)" type="number" value={attendance.lateAfterMinutes ?? 15} onChange={(e) => setAttendance({ ...attendance, lateAfterMinutes: Number(e.target.value) })} />
          <Select label="Weekly off" value={String(attendance.weeklyOff ?? 7)} onChange={(e) => setAttendance({ ...attendance, weeklyOff: Number(e.target.value) })} options={DAYS.map(([v, l]) => ({ value: v, label: l }))} />
          <div style={{ paddingTop: 24 }}><Checkbox label="Notify parents when a student is absent" checked={!!attendance.notifyParentsOnAbsence} onChange={(e) => setAttendance({ ...attendance, notifyParentsOnAbsence: e.target.checked })} /></div>
        </div>
      </Card>

      <Card title="Fees & invoicing" actions={<Button size="sm" variant="primary" loading={busy === 'fees'} onClick={() => save('fees', fees)}>Save</Button>}>
        <div className="field-row">
          <Input label="Invoice prefix" value={fees.invoicePrefix || ''} onChange={(e) => setFees({ ...fees, invoicePrefix: e.target.value })} />
          <Input label="Receipt prefix" value={fees.receiptPrefix || ''} onChange={(e) => setFees({ ...fees, receiptPrefix: e.target.value })} />
          <Input label="Due days" type="number" value={fees.invoiceDueDays ?? 15} onChange={(e) => setFees({ ...fees, invoiceDueDays: Number(e.target.value) })} />
          <Input label="Grace days" type="number" value={fees.graceDays ?? 5} onChange={(e) => setFees({ ...fees, graceDays: Number(e.target.value) })} />
        </div>
        <div className="field-row">
          <Input label="Late fee (fixed)" type="number" value={fees.lateFeeFixed ?? 0} onChange={(e) => setFees({ ...fees, lateFeeFixed: Number(e.target.value) })} />
          <Input label="Late fee (%)" type="number" value={fees.lateFeePercent ?? 0} onChange={(e) => setFees({ ...fees, lateFeePercent: Number(e.target.value) })} />
          <div style={{ paddingTop: 24 }}><Checkbox label="Allow partial payments" checked={fees.partialPaymentsAllowed !== false} onChange={(e) => setFees({ ...fees, partialPaymentsAllowed: e.target.checked })} /></div>
        </div>
      </Card>

      <Card title="Examination rules" actions={<Button size="sm" variant="primary" loading={busy === 'exams'} onClick={() => save('exams', exams)}>Save</Button>}>
        <div className="field-row">
          <Input label="Default pass %" type="number" value={exams.defaultPassPercentage ?? 33} onChange={(e) => setExams({ ...exams, defaultPassPercentage: Number(e.target.value) })} />
          <Select label="Rank scope" value={exams.rankScope || 'section'} onChange={(e) => setExams({ ...exams, rankScope: e.target.value })} options={[{ value: 'section', label: 'Within section' }, { value: 'class', label: 'Within class' }, { value: 'school', label: 'Whole school' }]} />
          <div style={{ paddingTop: 24 }}><Checkbox label="Show rank on report card" checked={exams.showRankOnReportCard !== false} onChange={(e) => setExams({ ...exams, showRankOnReportCard: e.target.checked })} /></div>
        </div>
      </Card>

      <Card title="Notifications" subtitle="Automatic emails and SMS sent by the system." actions={<Button size="sm" variant="primary" loading={busy === 'notifications'} onClick={() => save('notifications', notifications)}>Save</Button>}>
        <div className="field-row">
          <div style={{ paddingTop: 24 }}><Checkbox label="Email when results are published" checked={!!notifications.emailOnResult} onChange={(e) => setNotifications({ ...notifications, emailOnResult: e.target.checked })} /></div>
          <div style={{ paddingTop: 24 }}><Checkbox label="Email invoices to parents" checked={!!notifications.emailOnInvoice} onChange={(e) => setNotifications({ ...notifications, emailOnInvoice: e.target.checked })} /></div>
          <div style={{ paddingTop: 24 }}><Checkbox label="SMS on absence" checked={!!notifications.smsOnAbsence} onChange={(e) => setNotifications({ ...notifications, smsOnAbsence: e.target.checked })} /></div>
          <Input label="Daily digest time" type="time" value={notifications.digestTime || '18:00'} onChange={(e) => setNotifications({ ...notifications, digestTime: e.target.value })} />
        </div>
      </Card>

      <Card title="Library rules" actions={<Button size="sm" variant="primary" loading={busy === 'library'} onClick={() => save('library', library)}>Save</Button>}>
        <div className="field-row">
          <Input label="Fine per day" type="number" value={library.finePerDay ?? 2} onChange={(e) => setLibrary({ ...library, finePerDay: Number(e.target.value) })} />
          <Input label="Loan period (days)" type="number" value={library.loanDays ?? 14} onChange={(e) => setLibrary({ ...library, loanDays: Number(e.target.value) })} />
          <Input label="Max books per borrower" type="number" value={library.maxBooksPerBorrower ?? 3} onChange={(e) => setLibrary({ ...library, maxBooksPerBorrower: Number(e.target.value) })} />
        </div>
      </Card>
    </div>
  );
}

/* --------------------------------- security ------------------------------- */

function SecurityTab({ data, onSaved }) {
  const toast = useToast();
  const [policy, setPolicy] = useState({});
  const [sessions, setSessions] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [history, setHistory] = useState(null);

  useEffect(() => { if (data?.passwordPolicy) setPolicy(data.passwordPolicy); }, [data]);
  const loadSessions = () => get('/settings/sessions').then((res) => setSessions(res.items || [])).catch(() => setSessions([]));
  const loadHistory = () => get('/settings/login-history', { limit: 20 }).then((res) => setHistory(res.items || [])).catch(() => setHistory([]));
  useEffect(() => { loadSessions(); loadHistory(); }, []);

  const savePolicy = async () => {
    setBusy(true);
    try { await put('/settings/security/password-policy', policy); toast.success('Password policy saved'); onSaved(); } catch (err) { toast.error('Could not save policy', err.message); } finally { setBusy(false); }
  };

  const changePassword = async () => {
    try {
      await post('/settings/principal/password', pw);
      toast.success('Password changed');
      setPw({ currentPassword: '', newPassword: '' });
    } catch (err) { toast.error('Could not change password', err.message); }
  };

  return (
    <div className="col gap-3">
      <Card title="Password policy" subtitle="Applies to every account in the school." actions={<Button size="sm" variant="primary" loading={busy} onClick={savePolicy}>Save policy</Button>}>
        <div className="field-row">
          <Input label="Minimum length" type="number" value={policy.minLength ?? 8} onChange={(e) => setPolicy({ ...policy, minLength: Number(e.target.value) })} />
          <Input label="Max failed attempts" type="number" value={policy.maxAttempts ?? 5} onChange={(e) => setPolicy({ ...policy, maxAttempts: Number(e.target.value) })} />
          <Input label="Lockout minutes" type="number" value={policy.lockoutMinutes ?? 15} onChange={(e) => setPolicy({ ...policy, lockoutMinutes: Number(e.target.value) })} />
          <Input label="Session days" type="number" value={policy.sessionDays ?? 7} onChange={(e) => setPolicy({ ...policy, sessionDays: Number(e.target.value) })} />
        </div>
        <div className="row row-wrap gap-3">
          <Checkbox label="Require uppercase" checked={!!policy.requireUpper} onChange={(e) => setPolicy({ ...policy, requireUpper: e.target.checked })} />
          <Checkbox label="Require a number" checked={!!policy.requireNumber} onChange={(e) => setPolicy({ ...policy, requireNumber: e.target.checked })} />
          <Checkbox label="Require a symbol" checked={!!policy.requireSymbol} onChange={(e) => setPolicy({ ...policy, requireSymbol: e.target.checked })} />
          <Checkbox label="2FA required for admins" checked={!!policy.twoFactorRequiredForAdmins} onChange={(e) => setPolicy({ ...policy, twoFactorRequiredForAdmins: e.target.checked })} />
        </div>
      </Card>

      <Card title="Active sessions" subtitle="Revoke any device you do not recognise.">
        {!sessions ? <Loading /> : sessions.length === 0 ? <EmptyState icon="security" title="No active sessions" /> : (
          <div className="stack-sm">
            {sessions.map((s) => (
              <div key={s.id} className="file-row">
                <span className="file-icon"><Icon name="device" size={15} /></span>
                <div className="grow">
                  <div className="fs-13 strong">{s.full_name} <Badge tone="outline">{s.role}</Badge></div>
                  <div className="fs-12 muted">{s.ip || 'unknown IP'} · seen {relativeTime(s.last_seen_at)} · expires {formatDate(s.expires_at)}</div>
                </div>
                <Button size="sm" variant="outline" onClick={async () => { try { await del(`/settings/sessions/${s.id}`); toast.success('Session revoked'); loadSessions(); } catch (err) { toast.error('Could not revoke', err.message); } }}>Revoke</Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Recent sign-ins" subtitle="Latest 20 attempts">
        {!history ? <Loading /> : (
          <DataTable
            rows={history}
            rowKey="id"
            keyField="id"
            columns={[
              { key: 'created_at', header: 'When', render: (r) => formatDateTime(r.created_at) },
              { key: 'full_name', header: 'User', render: (r) => r.full_name || '—' },
              { key: 'status', header: 'Result', render: (r) => <Badge tone={r.status === 'success' ? 'success' : 'danger'}>{r.status}</Badge> },
              { key: 'ip', header: 'IP', render: (r) => r.ip || '—' },
              { key: 'user_agent', header: 'Device', render: (r) => <span className="fs-12 muted truncate">{r.user_agent || '—'}</span> },
            ]}
            emptyTitle="No sign-in history"
          />
        )}
      </Card>

      {data?.school ? (
        <Card title="Change principal password" subtitle="Only the principal account can do this.">
          <div className="field-row">
            <Input label="Current password" type="password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
            <Input label="New password" type="password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
          </div>
          <Button variant="primary" onClick={changePassword} disabled={!pw.currentPassword || pw.newPassword.length < 8}>Update password</Button>
        </Card>
      ) : null}
    </div>
  );
}

/* ------------------------------- integrations ----------------------------- */

function IntegrationsTab() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [email, setEmail] = useState({});
  const [sms, setSms] = useState({});
  const [pay, setPay] = useState({});
  const [busy, setBusy] = useState('');
  const [testTo, setTestTo] = useState('');
  const [testPhone, setTestPhone] = useState('');

  const load = () => get('/settings/integrations').then((res) => {
    setData(res);
    setEmail(res.email || {});
    setSms({ ...(res.sms || {}), provider: res.sms?.provider || 'generic_http' });
    setPay(res.payments || {});
  }).catch((err) => toast.error('Could not load integrations', err.message));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const saveEmail = async () => {
    setBusy('email');
    try { await put('/settings/integrations/email', { ...email, port: Number(email.port) || 587 }); toast.success('SMTP configuration saved'); load(); } catch (err) { toast.error('Could not save', err.message); } finally { setBusy(''); }
  };
  const saveSms = async () => {
    setBusy('sms');
    try { await put('/settings/integrations/sms', sms); toast.success('SMS configuration saved'); load(); } catch (err) { toast.error('Could not save', err.message); } finally { setBusy(''); }
  };
  const savePay = async () => {
    setBusy('pay');
    try { await put('/settings/payments/razorpay', pay); toast.success('Payment gateway saved'); load(); } catch (err) { toast.error('Could not save', err.message); } finally { setBusy(''); }
  };

  if (!data) return <Loading />;
  return (
    <div className="col gap-3">
      <Card title="Email (SMTP)" subtitle="Used for fee receipts, announcements and notifications." actions={<Button size="sm" variant="primary" loading={busy === 'email'} onClick={saveEmail}>Save SMTP</Button>}>
        <div className="field-row">
          <Input label="SMTP host" value={email.host || ''} onChange={(e) => setEmail({ ...email, host: e.target.value })} />
          <Input label="Port" type="number" value={email.port ?? 587} onChange={(e) => setEmail({ ...email, port: e.target.value })} />
          <div style={{ paddingTop: 24 }}><Checkbox label="Use TLS (secure)" checked={!!email.secure} onChange={(e) => setEmail({ ...email, secure: e.target.checked })} /></div>
          <div style={{ paddingTop: 24 }}><Checkbox label="Email delivery enabled" checked={!!email.enabled} onChange={(e) => setEmail({ ...email, enabled: e.target.checked })} /></div>
        </div>
        <div className="field-row">
          <Input label="Username" value={email.user || ''} onChange={(e) => setEmail({ ...email, user: e.target.value })} />
          <Input label="Password" type="password" placeholder="Leave as-is to keep" value={email.pass || ''} onChange={(e) => setEmail({ ...email, pass: e.target.value })} />
          <Input label="From name" value={email.fromName || ''} onChange={(e) => setEmail({ ...email, fromName: e.target.value })} />
          <Input label="From email" value={email.fromEmail || ''} onChange={(e) => setEmail({ ...email, fromEmail: e.target.value })} />
        </div>
        <div className="row gap-1">
          <input className="input grow" placeholder="Send test email to…" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
          <Button variant="outline" onClick={async () => { try { const res = await post('/settings/integrations/email/test', { to: testTo }); toast.success(res.message || 'Test sent'); } catch (err) { toast.error('Test failed', err.message); } }} disabled={!testTo}>Send test</Button>
        </div>
      </Card>

      <Card title="SMS" actions={<Button size="sm" variant="primary" loading={busy === 'sms'} onClick={saveSms}>Save SMS</Button>}>
        <div className="field-row">
          <Select label="Provider" value={sms.provider || 'generic_http'} onChange={(e) => setSms({ ...sms, provider: e.target.value })} options={[{ value: 'generic_http', label: 'Generic HTTP' }, { value: 'twilio', label: 'Twilio' }]} />
          <Input label="API URL" value={sms.apiUrl || ''} onChange={(e) => setSms({ ...sms, apiUrl: e.target.value })} />
          <Select label="Method" value={sms.method || 'POST'} onChange={(e) => setSms({ ...sms, method: e.target.value })} options={['GET', 'POST']} />
          <div style={{ paddingTop: 24 }}><Checkbox label="SMS enabled" checked={!!sms.enabled} onChange={(e) => setSms({ ...sms, enabled: e.target.checked })} /></div>
        </div>
        <div className="field-row">
          <Input label="API key" value={sms.apiKey || ''} onChange={(e) => setSms({ ...sms, apiKey: e.target.value })} />
          <Input label="Sender ID" value={sms.senderId || ''} onChange={(e) => setSms({ ...sms, senderId: e.target.value })} />
          <Input label="Account SID" value={sms.accountSid || ''} onChange={(e) => setSms({ ...sms, accountSid: e.target.value })} />
          <Input label="Auth header" value={sms.authHeaderName || ''} onChange={(e) => setSms({ ...sms, authHeaderName: e.target.value })} />
        </div>
        <div className="row gap-1">
          <input className="input grow" placeholder="Send test SMS to…" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} />
          <Button variant="outline" onClick={async () => { try { const res = await post('/settings/integrations/sms/test', { to: testPhone }); toast.success(res.message || 'Test sent'); } catch (err) { toast.error('Test failed', err.message); } }} disabled={!testPhone}>Send test</Button>
        </div>
      </Card>

      <Card title="Online payments (Razorpay)" subtitle="Lets parents pay fees from the portal." actions={<Button size="sm" variant="primary" loading={busy === 'pay'} onClick={savePay}>Save gateway</Button>}>
        <div className="field-row">
          <Input label="Key ID" value={pay.keyId || ''} onChange={(e) => setPay({ ...pay, keyId: e.target.value })} />
          <Input label="Key secret" type="password" value={pay.keySecret || ''} onChange={(e) => setPay({ ...pay, keySecret: e.target.value })} />
          <Input label="Webhook secret" type="password" value={pay.webhookSecret || ''} onChange={(e) => setPay({ ...pay, webhookSecret: e.target.value })} />
          <Select label="Mode" value={pay.mode || 'test'} onChange={(e) => setPay({ ...pay, mode: e.target.value })} options={[{ value: 'test', label: 'Test' }, { value: 'live', label: 'Live' }]} />
        </div>
        <div className="row gap-2">
          <Checkbox label="Enable online payments" checked={!!pay.enabled} onChange={(e) => setPay({ ...pay, enabled: e.target.checked })} />
          <span className="fs-12 muted">Webhook URL: <code>/api/webhooks/razorpay</code></span>
        </div>
      </Card>

      <Card title="Message outbox" subtitle="Queued emails and SMS waiting to be delivered." actions={<Button size="sm" variant="outline" icon="send" onClick={async () => { try { const res = await post('/settings/maintenance/outbox'); toast.success('Outbox processed', `${res.sent || 0} sent · ${res.failed || 0} failed`); load(); } catch (err) { toast.error('Could not process outbox', err.message); } }}>Process queue</Button>}>
        {data.outbox?.length ? (
          <div className="row row-wrap gap-2">
            {data.outbox.map((o) => <Badge key={o.status} tone={o.status === 'failed' ? 'danger' : o.status === 'sent' ? 'success' : 'outline'}>{o.status}: {o.c}</Badge>)}
          </div>
        ) : <span className="fs-13 muted">Outbox is empty.</span>}
      </Card>
    </div>
  );
}

/* --------------------------------- backups -------------------------------- */

function BackupTab() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [restoreFor, setRestoreFor] = useState(null);
  const [confirmText, setConfirmText] = useState('');

  const load = () => get('/settings/backups').then(setData).catch((err) => toast.error('Could not load backups', err.message));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const create = async () => {
    setBusy(true);
    try { const res = await post('/settings/backups', { kind: 'manual' }); toast.success('Backup created', res.filename); load(); } catch (err) { toast.error('Backup failed', err.message); } finally { setBusy(false); }
  };

  return (
    <div className="col gap-3">
      <Card title="Database backups" subtitle={data?.dir ? `Stored in ${data.dir}` : 'Full snapshots of the school database.'}
        actions={<div className="row gap-1">
          <Button size="sm" variant="outline" onClick={async () => { try { const res = await post('/settings/maintenance/retention'); toast.success('Retention cleanup done', `${res.auditLogs} audit rows removed`); } catch (err) { toast.error('Cleanup failed', err.message); } }}>Run retention cleanup</Button>
          <Button size="sm" variant="primary" icon="plus" loading={busy} onClick={create}>Backup now</Button>
        </div>}>
        {!data ? <Loading /> : data.items.length === 0 ? <EmptyState icon="backup" title="No backups yet" text="Create your first snapshot before making big changes." /> : (
          <DataTable
            rows={data.items}
            emptyTitle="No backups"
            columns={[
              { key: 'filename', header: 'File', render: (r) => (<div><div className="strong fs-13">{r.filename}</div><div className="fs-12 muted">{r.kind} · {bytes(r.size)}</div></div>) },
              { key: 'created_at', header: 'Created', render: (r) => formatDateTime(r.created_at) },
              { key: 'exists', header: 'Status', render: (r) => <Badge tone={r.exists ? 'success' : 'danger'}>{r.exists ? 'available' : 'missing'}</Badge> },
              {
                key: 'actions', header: '', align: 'actions',
                render: (r) => (
                  <div className="row gap-1" style={{ justifyContent: 'flex-end' }}>
                    <Button size="sm" variant="outline" icon="download" onClick={() => downloadFile(`/settings/backups/${r.id}/download`, null, r.filename)}>Download</Button>
                    <Button size="sm" variant="ghost" icon="restore" aria-label="Restore" onClick={() => { setRestoreFor(r); setConfirmText(''); }} />
                    <Button size="sm" variant="ghost" icon="trash" aria-label="Delete" onClick={async () => { if (!window.confirm(`Delete ${r.filename}?`)) return; try { await del(`/settings/backups/${r.id}`); toast.success('Backup deleted'); load(); } catch (err) { toast.error('Could not delete', err.message); } }} />
                  </div>
                ),
              },
            ]}
          />
        )}
      </Card>

      <Alert tone="warning" title="Restoring replaces all live data">
        A safety snapshot is taken automatically before a restore, but you should still download a backup first. Only the principal can restore.
      </Alert>

      <Modal open={!!restoreFor} onClose={() => setRestoreFor(null)} title="Restore database" size="sm"
        footer={<><Button variant="ghost" onClick={() => setRestoreFor(null)}>Cancel</Button>
          <Button variant="danger" disabled={confirmText !== 'RESTORE'} onClick={async () => {
            try {
              const res = await post(`/settings/backups/${restoreFor.id}/restore`, { confirm: 'RESTORE' });
              toast.success('Restore complete', res.message);
              setRestoreFor(null);
              load();
            } catch (err) { toast.error('Restore failed', err.message); }
          }}>Restore now</Button></>}>
        <p className="fs-13">You are about to replace all current data with <strong>{restoreFor?.filename}</strong>. Type <code>RESTORE</code> to confirm.</p>
        <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="RESTORE" />
      </Modal>
    </div>
  );
}

/* ---------------------------------- audit --------------------------------- */

function AuditTab() {
  const toast = useToast();
  const [q, setQ] = useState('');
  const debounced = useDebounced(q);
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const limit = 30;

  const load = async () => {
    setLoading(true);
    try { setData(await get('/settings/audit', { q: debounced, page, limit })); } catch (err) { toast.error('Could not load activity', err.message); } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [debounced, page]);

  return (
    <Card title="Activity log" subtitle="Every privileged action is recorded here."
      actions={<Button size="sm" variant="outline" icon="download" onClick={() => downloadFile('/settings/audit', { format: 'csv' }, 'audit-log.csv')}>Export CSV</Button>}>
      <div className="row gap-1 mb-2">
        <SearchField value={q} onChange={setQ} placeholder="Search user, summary or module…" />
        <span className="grow" />
        <span className="fs-12 muted">{data?.total || 0} entries</span>
      </div>
      <DataTable
        loading={loading}
        rows={data?.items || []}
        columns={[
          { key: 'created_at', header: 'When', render: (r) => <span className="nowrap fs-12">{formatDateTime(r.created_at)}</span> },
          { key: 'actor_name', header: 'User', render: (r) => (<div><div className="fs-13">{r.actor_name || 'System'}</div><div className="fs-12 muted">{r.actor_role || ''}</div></div>) },
          { key: 'action', header: 'Action', render: (r) => <Badge tone="outline">{r.action}</Badge> },
          { key: 'module', header: 'Module', render: (r) => r.module || '—' },
          { key: 'summary', header: 'Details', render: (r) => <span className="fs-13">{r.summary || '—'}</span> },
          { key: 'ip', header: 'IP', render: (r) => <span className="fs-12 muted">{r.ip || '—'}</span> },
        ]}
        emptyTitle="No activity yet"
        footer={<Pagination page={page} pageCount={data?.pages || 1} total={data?.total || 0} pageSize={limit} onChange={setPage} />}
      />
    </Card>
  );
}

/* ---------------------------------- API ----------------------------------- */

function ApiTab() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [created, setCreated] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => get('/settings/api-keys').then((res) => setData(res.items || [])).catch((err) => toast.error('Could not load keys', err.message));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const create = async () => {
    setBusy(true);
    try {
      const res = await post('/settings/api-keys', { name, scopes: ['read'] });
      setCreated(res);
      setName('');
      setOpen(false);
      load();
    } catch (err) { toast.error('Could not create key', err.message); } finally { setBusy(false); }
  };

  return (
    <>
      <Card title="API keys" subtitle="Use these keys for integrations and reporting tools."
        actions={<Button size="sm" variant="primary" icon="plus" onClick={() => setOpen(true)}>Create key</Button>}>
        {!data ? <Loading /> : data.length === 0 ? <EmptyState icon="key" title="No API keys" text="Create a key for a trusted integration." /> : (
          <DataTable
            rows={data}
            columns={[
              { key: 'name', header: 'Name', render: (r) => <div><div className="strong fs-13">{r.name}</div><div className="fs-12 muted">{r.prefix}…</div></div> },
              { key: 'scopes', header: 'Scopes', render: (r) => (r.scopes || []).map((s) => <Badge key={s} tone="outline">{s}</Badge>) },
              { key: 'created_at', header: 'Created', render: (r) => formatDate(r.created_at) },
              { key: 'last_used_at', header: 'Last used', render: (r) => (r.last_used_at ? relativeTime(r.last_used_at) : 'never') },
              { key: 'revoked_at', header: 'Status', render: (r) => <Badge tone={r.revoked_at ? 'danger' : 'success'}>{r.revoked_at ? 'revoked' : 'active'}</Badge> },
              {
                key: 'actions', header: '', align: 'actions',
                render: (r) => r.revoked_at ? null : <Button size="sm" variant="ghost" icon="trash" onClick={async () => { if (!window.confirm(`Revoke ${r.name}?`)) return; try { await del(`/settings/api-keys/${r.id}`); toast.success('Key revoked'); load(); } catch (err) { toast.error('Could not revoke', err.message); } }}>Revoke</Button>,
              },
            ]}
          />
        )}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="Create API key" size="sm" busy={busy}
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={create} disabled={name.trim().length < 2}>Create key</Button></>}>
        <Input label="Key name" placeholder="Reporting integration" value={name} onChange={(e) => setName(e.target.value)} />
        <Alert tone="info">The full key is shown only once. Store it in your integration’s secrets.</Alert>
      </Modal>

      <Modal open={!!created} onClose={() => setCreated(null)} title="Copy your API key" size="sm" footer={<Button variant="primary" onClick={() => setCreated(null)}>Done</Button>}>
        <p className="fs-13">Copy this key now — it will not be shown again.</p>
        <div className="row gap-1">
          <input className="input" readOnly value={created?.key || ''} onFocus={(e) => e.target.select()} />
          <Button variant="outline" icon="copy" onClick={() => { navigator.clipboard?.writeText(created.key); toast.success('Copied'); }}>Copy</Button>
        </div>
      </Modal>
    </>
  );
}

/* --------------------------------- system --------------------------------- */

function SystemTab({ data }) {
  const s = data?.system;
  if (!s) return <Loading />;
  const counts = s.counts || {};
  return (
    <div className="col gap-3">
      <div className="grid grid-4">
        <Stat label="Students" value={(counts.students || 0).toLocaleString('en-IN')} icon="students" />
        <Stat label="Users" value={(counts.users || 0).toLocaleString('en-IN')} icon="users" />
        <Stat label="Invoices" value={(counts.invoices || 0).toLocaleString('en-IN')} icon="invoices" />
        <Stat label="Payments" value={(counts.payments || 0).toLocaleString('en-IN')} icon="fees" />
      </div>
      <Card title="Storage & runtime">
        <KeyValue columns={2} items={[
          { label: 'Database size', value: bytes(s.dbSize) },
          { label: 'Uploads', value: bytes(s.uploadsSize) },
          { label: 'Backups', value: s.backups },
          { label: 'Node.js', value: s.node },
          { label: 'Platform', value: s.platform },
          { label: 'Uptime', value: `${Math.floor((s.uptimeSeconds || 0) / 60)} min` },
          { label: 'Data directory', value: <code className="fs-12">{s.dataDir}</code> },
        ]} />
      </Card>
      <Card title="Record counts">
        <KeyValue columns={3} items={Object.entries(counts).map(([key, value]) => ({ label: key.replace(/_/g, ' '), value: value.toLocaleString('en-IN') }))} />
      </Card>
    </div>
  );
}

/* --------------------------------- wrapper -------------------------------- */

export default function Settings() {
  const toast = useToast();
  const { can, permissions } = useApp();
  const [params, setParams] = useSearchParams();
  const tabs = SETTINGS_TABS.filter((t) => can(t.perm));
  const tab = params.get('tab') || tabs[0]?.value || 'school';
  const setTab = (value) => { const next = new URLSearchParams(params); next.set('tab', value); setParams(next, { replace: true }); };
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try { setData(await get('/settings')); } catch (err) {
      // Non-principals may lack settings.view; still try the integrations endpoint.
      if (err.status === 403) setData({ school: null, settings: {}, theme: {}, reportCard: {}, invoiceTemplate: {}, passwordPolicy: {}, system: {} });
      else toast.error('Could not load settings', err.message);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  return (
    <div className="page">
      <PageHeader title="Settings" subtitle="Configure the school, customise the interface and manage security." />
      {!tabs.length ? <Alert tone="warning" title="No settings access">Your role does not include any settings permissions.</Alert> : (
        <>
          <div className="mb-3"><Tabs value={tab} onChange={setTab} tabs={tabs} /></div>
          {loading ? <Loading label="Loading settings…" /> : (
            <>
              {tab === 'school' && data?.school ? <SchoolTab data={data} onSaved={load} /> : null}
              {tab === 'branding' ? <BrandingTab data={data} onSaved={load} /> : null}
              {tab === 'academic' ? <PreferencesTab data={data} onSaved={load} /> : null}
              {tab === 'security' ? <SecurityTab data={data} onSaved={load} /> : null}
              {tab === 'integrations' ? <IntegrationsTab /> : null}
              {tab === 'backup' ? <BackupTab /> : null}
              {tab === 'audit' ? <AuditTab /> : null}
              {tab === 'api' ? <ApiTab /> : null}
              {tab === 'system' ? <SystemTab data={data} /> : null}
            </>
          )}
        </>
      )}
      {permissions ? null : null}
    </div>
  );
}
