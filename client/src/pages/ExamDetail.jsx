import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { get, openFile, patch, post, useResource } from '../api.js';
import { useApp } from '../store.jsx';
import { useAcademic } from '../lib/academic.js';
import {
  Alert, Avatar, Badge, Button, Card, DataTable, EmptyState, Input, Loading, Modal, PageHeader, Progress,
  Select, StatusBadge, Tabs, Textarea, formatDate, formatMoney, useToast,
} from '../ui/index.jsx';
import Icon from '../ui/Icon.jsx';
import { Donut, HBars } from '../ui/Charts.jsx';

function StatusActions({ exam, reload }) {
  const toast = useToast();
  const { can } = useApp();
  const [busy, setBusy] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [reason, setReason] = useState('');

  const act = async (kind) => {
    setBusy(kind);
    try {
      if (kind === 'start') {
        await patch(`/exams/${exam.id}`, { status: 'marks_entry' });
        toast.success('Marks entry is open', 'Subject teachers have been notified.');
      }
      if (kind === 'finalize') {
        const res = await post(`/exams/${exam.id}/finalize`, { force: Boolean(reason) && reason === 'force' });
        toast.success('Results finalized', `${res.students} students ranked · ${res.passed} passed`);
      }
      if (kind === 'publish') {
        const res = await post(`/exams/${exam.id}/publish`, { notify: true });
        toast.success('Results published', `${res.students} report cards are now visible to families.`);
      }
      if (kind === 'unpublish') {
        await post(`/exams/${exam.id}/unpublish`, { reason: reason || 'Unpublished for correction' });
        toast.success('Results unpublished');
      }
      if (kind === 'recalculate') {
        const res = await post(`/exams/${exam.id}/recalculate`, { reason: reason || 'Rank recalculation' });
        toast.success('Results recalculated', `${res.students} students processed`);
      }
      setConfirm(null);
      setReason('');
      reload(false);
    } catch (err) {
      if (err.code === 'marks_incomplete') {
        const detail = (err.details || []).slice(0, 5).map((d) => `${d.subject} (${d.class}) ${d.entered}/${d.required}`).join(', ');
        toast.error('Marks entry is incomplete', `${detail}. Finalize anyway by confirming the override.`);
        setConfirm('finalize');
        setReason('force');
      } else {
        toast.error('Action failed', err.message);
      }
    } finally {
      setBusy('');
    }
  };

  return (
    <>
      <div className="row row-wrap gap-1">
        {exam.status === 'draft' && can('exams.edit') ? <Button variant="primary" icon="play" loading={busy === 'start'} onClick={() => act('start')}>Open marks entry</Button> : null}
        {['marks_entry', 'marks_complete', 'draft'].includes(exam.status) && can('results.finalize') ? (
          <Button variant="primary" icon="check" loading={busy === 'finalize'} onClick={() => act('finalize')}>Finalize results</Button>
        ) : null}
        {exam.status === 'finalized' && can('results.publish') ? <Button variant="primary" icon="send" loading={busy === 'publish'} onClick={() => act('publish')}>Publish results</Button> : null}
        {exam.status === 'published' && can('results.publish') ? <Button variant="outline" icon="eyeOff" onClick={() => setConfirm('unpublish')}>Unpublish</Button> : null}
        {['finalized', 'published'].includes(exam.status) && can('results.recalculate') ? <Button variant="outline" icon="refresh" loading={busy === 'recalculate'} onClick={() => act('recalculate')}>Recalculate ranks</Button> : null}
      </div>

      <Modal
        open={Boolean(confirm)}
        onClose={() => { setConfirm(null); setReason(''); }}
        title={confirm === 'finalize' ? 'Finalize with missing marks?' : confirm === 'unpublish' ? 'Unpublish results' : 'Recalculate results'}
        size="sm"
        busy={Boolean(busy)}
        footer={(
          <>
            <Button variant="ghost" onClick={() => { setConfirm(null); setReason(''); }}>Cancel</Button>
            <Button variant={confirm === 'finalize' ? 'danger' : 'primary'} loading={Boolean(busy)} onClick={() => act(confirm)}>
              {confirm === 'finalize' ? 'Finalize anyway' : confirm === 'unpublish' ? 'Unpublish' : 'Recalculate'}
            </Button>
          </>
        )}
      >
        {confirm === 'finalize' ? (
          <Alert tone="warning">Some subjects do not have complete marks. Students with missing marks will be treated as absent for those subjects.</Alert>
        ) : (
          <Textarea label="Reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Explain why this change is being made" />
        )}
      </Modal>
    </>
  );
}

function MarksTab({ exam, reload, initialSubject }) {
  const toast = useToast();
  const { can } = useApp();
  const classes = useMemo(() => {
    const map = new Map();
    (exam.subjects || []).forEach((s) => {
      const key = s.exam_class_id || `${s.class_id}:${s.section_id || ''}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          examClassId: s.exam_class_id,
          classId: s.class_id,
          sectionId: s.section_id,
          label: `${s.class_name}${s.section_name ? ` · ${s.section_name}` : ''}`,
        });
      }
    });
    return [...map.values()];
  }, [exam]);

  const [examClassId, setExamClassId] = useState(classes[0]?.examClassId || '');
  const [subjectId, setSubjectId] = useState(initialSubject || '');
  const [data, setData] = useState(null);
  const [rows, setRows] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const subjects = (exam.subjects || []).filter((s) => s.exam_class_id === examClassId);
  const activeSubject = subjects.find((s) => s.id === subjectId) || null;

  useEffect(() => {
    if (!examClassId) return;
    if (!subjects.find((s) => s.id === subjectId)) setSubjectId(subjects[0]?.id || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examClassId, exam]);

  useEffect(() => {
    if (!examClassId || !subjectId) return;
    setLoading(true);
    get(`/exams/${exam.id}/marks`, { examClassId, subjectId })
      .then((res) => {
        setData(res);
        const next = {};
        res.students.forEach((s) => {
          next[s.id] = {
            theory: s.theory_marks ?? '',
            practical: s.practical_marks ?? '',
            marks: s.marks_obtained ?? '',
            absent: Boolean(s.is_absent),
            exempt: Boolean(s.is_exempt),
          };
        });
        setRows(next);
      })
      .catch((err) => toast.error('Could not load marks', err.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examClassId, subjectId]);

  const set = (studentId, patchValue) => setRows((prev) => ({ ...prev, [studentId]: { ...prev[studentId], ...patchValue } }));

  const save = async () => {
    const records = Object.entries(rows)
      .filter(([, v]) => v.absent || v.exempt || v.theory !== '' || v.practical !== '' || v.marks !== '')
      .map(([student_id, v]) => ({
        student_id,
        theory_marks: v.theory === '' ? null : Number(v.theory),
        practical_marks: v.practical === '' ? null : Number(v.practical),
        marks_obtained: v.marks === '' ? null : Number(v.marks),
        is_absent: Boolean(v.absent),
        is_exempt: Boolean(v.exempt),
      }));
    if (!records.length) return toast.warning('No marks entered');
    setSaving(true);
    try {
      const res = await post(`/exams/${exam.id}/marks`, { examSubjectId: subjectId, records });
      toast.success('Marks saved', `${res.saved ?? records.length} records · ${res.errors?.length || 0} rejected`);
      const again = await get(`/exams/${exam.id}/marks`, { examClassId, subjectId });
      setData(again);
      reload(true);
    } catch (err) {
      toast.error('Could not save marks', err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!classes.length) return <EmptyState icon="exams" title="No classes configured" />;

  const entered = Object.values(rows).filter((r) => r.absent || r.exempt || r.theory !== '' || r.practical !== '' || r.marks !== '').length;

  return (
    <>
      <div className="row row-wrap gap-1 mb-2">
        <select className="select" style={{ width: 'auto' }} value={examClassId} onChange={(e) => setExamClassId(e.target.value)}>
          {classes.map((c) => <option key={c.key} value={c.examClassId}>{c.label}</option>)}
        </select>
        <select className="select" style={{ width: 'auto' }} value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.subject_name} — {s.entered}/{s.required} entered
            </option>
          ))}
        </select>
        <span className="grow" />
        {activeSubject ? <span className="fs-12 muted">Max {activeSubject.max_marks}{activeSubject.teacher_name ? ` · ${activeSubject.teacher_name}` : ''}</span> : null}
        {data?.canEnter || data?.canCorrect ? (
          <Button variant="primary" icon="check" loading={saving} onClick={save} disabled={!data?.canEnter && !data?.canCorrect}>Save marks</Button>
        ) : null}
      </div>

      {data?.exam?.locked ? <div className="mb-2"><Alert tone="warning">Results are finalized — marks are locked. Use result correction to change a published result.</Alert></div> : null}
      {data && !data.canEnter && !data.canCorrect ? <div className="mb-2"><Alert tone="info">You can view these marks but not edit them. Only the assigned subject teacher or a marks-correction user can edit.</Alert></div> : null}

      {loading ? <Loading label="Loading marks sheet…" /> : null}
      {data && !loading ? (
        <Card
          flush
          title={`${activeSubject?.subject_name || ''} · ${data.subject?.class_name || ''} ${data.subject?.section_name || ''}`}
          subtitle={`${entered} of ${data.students.length} students entered`}
          actions={<Badge tone={entered === data.students.length ? 'success' : 'warning'}>{entered === data.students.length ? 'complete' : 'in progress'}</Badge>}
        >
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th style={{ width: 60 }}>Roll</th>
                  <th>Student</th>
                  {activeSubject?.theory_max ? <th className="num">Theory<br /><span className="fs-12 muted">/ {activeSubject.theory_max}</span></th> : null}
                  {activeSubject?.practical_max ? <th className="num">Practical<br /><span className="fs-12 muted">/ {activeSubject.practical_max}</span></th> : null}
                  {!activeSubject?.theory_max && !activeSubject?.practical_max ? <th className="num">Marks<br /><span className="fs-12 muted">/ {activeSubject?.max_marks}</span></th> : null}
                  <th className="num">Total</th>
                  <th>Flags</th>
                </tr>
              </thead>
              <tbody>
                {data.students.map((s, i) => {
                  const row = rows[s.id] || {};
                  const total = row.theory !== '' || row.practical !== ''
                    ? (Number(row.theory) || 0) + (Number(row.practical) || 0)
                    : (row.marks === '' ? '' : Number(row.marks));
                  const disabled = !data.canEnter && !data.canCorrect;
                  return (
                    <tr key={s.id}>
                      <td className="tnum">{s.roll_no || i + 1}</td>
                      <td>
                        <div className="person">
                          <Avatar name={s.full_name} src={s.photo_url} size="sm" />
                          <div className="person-meta">
                            <div className="person-name">{s.full_name}</div>
                            <div className="person-sub">{s.admission_no}</div>
                          </div>
                        </div>
                      </td>
                      {activeSubject?.theory_max ? (
                        <td className="num">
                          <input className="input" type="number" min="0" max={activeSubject.theory_max} disabled={disabled || row.absent || row.exempt} value={row.theory} onChange={(e) => set(s.id, { theory: e.target.value })} style={{ width: 86, textAlign: 'right' }} />
                        </td>
                      ) : null}
                      {activeSubject?.practical_max ? (
                        <td className="num">
                          <input className="input" type="number" min="0" max={activeSubject.practical_max} disabled={disabled || row.absent || row.exempt} value={row.practical} onChange={(e) => set(s.id, { practical: e.target.value })} style={{ width: 86, textAlign: 'right' }} />
                        </td>
                      ) : null}
                      {!activeSubject?.theory_max && !activeSubject?.practical_max ? (
                        <td className="num">
                          <input className="input" type="number" min="0" max={activeSubject?.max_marks} disabled={disabled || row.absent || row.exempt} value={row.marks} onChange={(e) => set(s.id, { marks: e.target.value })} style={{ width: 86, textAlign: 'right' }} />
                        </td>
                      ) : null}
                      <td className="num strong">{row.absent ? 'AB' : row.exempt ? 'EX' : total === '' ? '—' : total}</td>
                      <td>
                        <label className="checkbox" style={{ fontSize: 12 }}>
                          <input type="checkbox" checked={Boolean(row.absent)} disabled={disabled} onChange={(e) => set(s.id, { absent: e.target.checked, exempt: false })} />
                          <span>Absent</span>
                        </label>
                        <label className="checkbox" style={{ fontSize: 12 }}>
                          <input type="checkbox" checked={Boolean(row.exempt)} disabled={disabled} onChange={(e) => set(s.id, { exempt: e.target.checked, absent: false })} />
                          <span>Exempt</span>
                        </label>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </>
  );
}

function ResultsTab({ exam }) {
  const toast = useToast();
  const { can, school } = useApp();
  const { classes } = useAcademic();
  const [classId, setClassId] = useState('');
  const [result, setResult] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [editResult, setEditResult] = useState(null);
  const [remarks, setRemarks] = useState({ teacher_remark: '', principal_remark: '' });

  useEffect(() => {
    setLoading(true);
    get(`/exams/${exam.id}/results`, { classId, result })
      .then(setData)
      .catch((err) => toast.error('Could not load results', err.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId, result, exam.status]);

  const rows = data?.items || [];
  const stats = data?.stats || {};

  const saveRemarks = async () => {
    try {
      await patch(`/exams/results/${editResult.id}/remarks`, remarks);
      toast.success('Remarks updated');
      setEditResult(null);
      const again = await get(`/exams/${exam.id}/results`, { classId, result });
      setData(again);
    } catch (err) {
      toast.error('Could not save remarks', err.message);
    }
  };

  return (
    <>
      <div className="row row-wrap gap-1 mb-2">
        <select className="select" style={{ width: 'auto' }} value={classId} onChange={(e) => setClassId(e.target.value)}>
          <option value="">All classes</option>
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="select" style={{ width: 'auto' }} value={result} onChange={(e) => setResult(e.target.value)}>
          <option value="">All results</option>
          <option value="pass">Passed</option>
          <option value="fail">Failed</option>
          <option value="compartment">Compartment</option>
        </select>
        <span className="grow" />
        {can('results.export') ? (
          <>
            <Button variant="outline" icon="download" onClick={() => openFile(`/exams/${exam.id}/results/export`, { classId, result })}>Export</Button>
            <Button variant="outline" icon="print" onClick={() => openFile(`/exams/${exam.id}/report-cards`, { classId })}>Report cards</Button>
          </>
        ) : null}
      </div>

      <div className="grid grid-4 mb-2">
        <div className="card card-pad"><div className="fs-12 muted">Students</div><div className="stat-value">{stats.students || 0}</div></div>
        <div className="card card-pad"><div className="fs-12 muted">Passed</div><div className="stat-value">{stats.passed || 0}</div></div>
        <div className="card card-pad"><div className="fs-12 muted">Average</div><div className="stat-value">{stats.average ?? 0}%</div></div>
        <div className="card card-pad"><div className="fs-12 muted">Highest</div><div className="stat-value">{stats.highest ?? 0}%</div></div>
      </div>

      {loading ? <Loading /> : rows.length === 0 ? (
        <Card><EmptyState icon="results" title="No computed results" text="Finalize the examination to compute totals, ranks and grades." /></Card>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) 260px', gap: 16, alignItems: 'start' }}>
          <Card flush>
            <DataTable
              rows={rows}
              sortable
              columns={[
                { key: 'rank', header: 'Rank', align: 'num', render: (r) => <Badge tone={r.rank === 1 ? 'accent' : 'outline'}>#{r.rank}</Badge> },
                { key: 'full_name', header: 'Student', render: (r) => (<div><div className="strong">{r.full_name}</div><div className="fs-12 muted">{r.class_name} {r.section_name} · {r.admission_no}</div></div>) },
                { key: 'total', header: 'Total', align: 'num', render: (r) => `${r.total_obtained}/${r.total_max}` },
                { key: 'percentage', header: '%', align: 'num', render: (r) => `${Number(r.percentage || 0).toFixed(1)}%` },
                { key: 'grade', header: 'Grade', render: (r) => <Badge tone="outline">{r.grade || '—'}</Badge> },
                { key: 'result_status', header: 'Result', render: (r) => <StatusBadge status={r.result_status} labels={{ pass: 'Pass', fail: 'Fail', compartment: 'Compartment' }} /> },
                {
                  key: 'actions',
                  header: '',
                  align: 'actions',
                  render: (r) => (
                    <div className="row gap-1" style={{ justifyContent: 'flex-end' }}>
                      <Button size="sm" variant="ghost" onClick={() => { setEditResult(r); setRemarks({ teacher_remark: r.teacher_remark || '', principal_remark: r.principal_remark || '' }); }}>Remarks</Button>
                      <Button size="sm" variant="ghost" icon="download" onClick={() => openFile(`/exams/results/${r.id}/report-card`)} aria-label="Report card" />
                    </div>
                  ),
                },
              ]}
            />
          </Card>
          <Card title="Grade distribution" icon="chart">
            <Donut size={140} thickness={16} data={Object.entries(stats.gradeDistribution || {}).map(([label, value]) => ({ label, value }))} />
            <div className="divider" />
            <HBars data={[
              { label: 'Passed', value: stats.passed || 0, color: 'var(--success)' },
              { label: 'Failed', value: stats.failed || 0, color: 'var(--danger)' },
            ]} />
            <div className="fs-12 muted mt-2">Lowest: {stats.lowest ?? 0}% · Highest: {stats.highest ?? 0}%</div>
          </Card>
        </div>
      )}

      <Modal
        open={!!editResult}
        onClose={() => setEditResult(null)}
        title={`Remarks · ${editResult?.full_name || ''}`}
        size="sm"
        footer={<><Button variant="ghost" onClick={() => setEditResult(null)}>Cancel</Button><Button variant="primary" onClick={saveRemarks}>Save</Button></>}
      >
        <Textarea label="Teacher remark" rows={3} value={remarks.teacher_remark} onChange={(e) => setRemarks({ ...remarks, teacher_remark: e.target.value })} />
        <Textarea label="Principal remark" rows={3} value={remarks.principal_remark} onChange={(e) => setRemarks({ ...remarks, principal_remark: e.target.value })} />
      </Modal>
    </>
  );
}

export default function ExamDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useApp();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'overview';
  const setTab = (value) => { const next = new URLSearchParams(params); next.set('tab', value); setParams(next, { replace: true }); };
  const { data: exam, loading, error, reload } = useResource(`/exams/${id}`);

  if (error) return <div className="page"><Alert tone="danger" title="Examination not found">{error.message}</Alert></div>;
  if (loading || !exam) return <div className="page"><Loading label="Loading examination…" /></div>;

  const graded = exam.grading_ranges || [];

  return (
    <div className="page">
      <div className="breadcrumb">
        <Link to="/app/exams">Examinations</Link>
        <Icon name="chevronRight" size={12} />
        <span>{exam.name}</span>
      </div>
      <PageHeader
        title={exam.name}
        subtitle={`${exam.session_name || ''} · ${formatDate(exam.start_date)}${exam.end_date ? ` → ${formatDate(exam.end_date)}` : ''} · Pass ${exam.pass_percentage}%`}
        actions={<StatusActions exam={exam} reload={reload} />}
      />

      <div className="grid grid-4 mb-3">
        <div className="card card-pad">
          <div className="row-between"><span className="fs-12 muted">Status</span><StatusBadge status={exam.status} /></div>
          <div className="fs-13 mt-1">{exam.published_count || 0} published results</div>
        </div>
        <div className="card card-pad">
          <div className="fs-12 muted">Marks entry</div>
          <div className="stat-value">{exam.progress?.percentage ?? 0}%</div>
          <Progress small value={exam.progress?.percentage ?? 0} />
        </div>
        <div className="card card-pad">
          <div className="fs-12 muted">Classes · subjects</div>
          <div className="stat-value">{(exam.classes || []).length} · {(exam.subjects || []).length}</div>
        </div>
        <div className="card card-pad">
          <div className="fs-12 muted">Pending subjects</div>
          <div className="stat-value">{exam.progress?.pendingSubjects ?? 0}</div>
        </div>
      </div>

      <Card flush>
        <div style={{ padding: '0 14px' }}>
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'overview', label: 'Overview' },
              { value: 'marks', label: 'Marks entry' },
              { value: 'results', label: 'Results', count: exam.result_count || undefined },
            ]}
          />
        </div>
        <div style={{ padding: 18 }}>
          {tab === 'overview' ? (
            <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)', gap: 18, alignItems: 'start' }}>
              <div>
                <h4 className="mb-2">Subject progress</h4>
                <div className="scroll-x">
                  <table className="data compact">
                    <thead><tr><th>Class</th><th>Subject</th><th>Teacher</th><th className="num">Entered</th><th style={{ width: 130 }}>Progress</th></tr></thead>
                    <tbody>
                      {(exam.subjects || []).map((s) => (
                        <tr key={s.id}>
                          <td className="nowrap">{s.class_name}{s.section_name ? ` · ${s.section_name}` : ''}</td>
                          <td>
                            <button type="button" className="btn btn-ghost btn-sm" style={{ padding: '2px 6px' }} onClick={() => { setTab('marks'); setParams((prev) => { const next = new URLSearchParams(prev); next.set('tab', 'marks'); next.set('subject', s.id); return next; }, { replace: true }); }}>
                              {s.subject_name}
                            </button>
                          </td>
                          <td className="fs-12 muted">{s.teacher_name || 'Unassigned'}</td>
                          <td className="num">{s.entered}/{s.required}</td>
                          <td><Progress small value={s.entered} max={s.required || 1} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <h4 className="mb-2 mt-3">Instructions</h4>
                <p className="fs-13 ink-2 prewrap">{exam.instructions || 'No instructions provided.'}</p>
              </div>
              <div>
                <h4 className="mb-2">Grading scale</h4>
                <div className="fs-13 mb-1 strong">{exam.grading_scale_name || 'Default'}</div>
                <div className="stack-sm">
                  {graded.map((g, i) => (
                    <div key={i} className="row-between fs-13" style={{ padding: '4px 0', borderBottom: '1px solid var(--line)' }}>
                      <span><Badge tone="outline">{g.grade}</Badge> <span className="muted">{g.min}–{g.max}%</span></span>
                      <span className="muted">{g.remark || ''}</span>
                    </div>
                  ))}
                </div>
                <h4 className="mb-2 mt-3">Classes</h4>
                {(exam.classes || []).map((c) => (
                  <div key={c.id} className="row-between fs-13" style={{ padding: '5px 0', borderBottom: '1px solid var(--line)' }}>
                    <span>{c.class_name}{c.section_name ? ` · ${c.section_name}` : ''}</span>
                    <span className="muted">{c.students} students · {c.subjects} subjects</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {tab === 'marks' ? <MarksTab exam={exam} reload={reload} initialSubject={params.get('subject') || ''} /> : null}
          {tab === 'results' ? <ResultsTab exam={exam} /> : null}
        </div>
      </Card>
    </div>
  );
}
