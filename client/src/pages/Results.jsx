import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { get, openFile, useResource } from '../api.js';
import { useApp } from '../store.jsx';
import { useAcademic } from '../lib/academic.js';
import {
  Badge, Button, Card, DataTable, EmptyState, Loading, PageHeader, SearchField, StatusBadge, formatDate, useToast,
} from '../ui/index.jsx';
import Icon from '../ui/Icon.jsx';
import { Donut } from '../ui/Charts.jsx';

export default function Results() {
  const { can } = useApp();
  const { classes } = useAcademic();
  const toast = useToast();
  const { data: examsData, loading: examsLoading } = useResource('/exams');
  const postable = (examsData?.items || []).filter((e) => ['finalized', 'published'].includes(e.status));
  const [examId, setExamId] = useState('');
  const [classId, setClassId] = useState('');
  const [q, setQ] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!examId && postable.length) setExamId(String(postable[0].id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examsData]);

  useEffect(() => {
    if (!examId) return;
    setLoading(true);
    get(`/exams/${examId}/results`, { classId, q })
      .then(setData)
      .catch((err) => toast.error('Could not load results', err.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examId, classId, q]);

  const exam = data?.exam;
  const rows = data?.items || [];
  const stats = data?.stats || {};

  return (
    <div className="page">
      <PageHeader
        title="Results & report cards"
        subtitle="Review published results, ranks and grade distribution. Download individual or bulk report cards."
        actions={exam ? (
          <>
            {can('results.export') ? <Button variant="outline" icon="download" onClick={() => openFile(`/exams/${exam.id}/results/export`, { classId })}>Export register</Button> : null}
            {can('results.export') ? <Button variant="primary" icon="print" onClick={() => openFile(`/exams/${exam.id}/report-cards`, { classId })}>Bulk report cards</Button> : null}
          </>
        ) : null}
      />

      {examsLoading ? <Loading /> : postable.length === 0 ? (
        <Card>
          <EmptyState icon="results" title="No finalized results yet" text="Finalize and publish an examination to see results here." action={<Link className="btn btn-primary" to="/app/exams">Go to examinations</Link>} />
        </Card>
      ) : (
        <>
          <div className="row row-wrap gap-1 mb-2">
            <select className="select" style={{ width: 'auto', minWidth: 220 }} value={examId} onChange={(e) => setExamId(e.target.value)}>
              {postable.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.status})</option>)}
            </select>
            <select className="select" style={{ width: 'auto' }} value={classId} onChange={(e) => setClassId(e.target.value)}>
              <option value="">All classes</option>
              {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <SearchField value={q} onChange={setQ} placeholder="Find a student…" />
            <span className="grow" />
            {exam ? <Badge tone={exam.status === 'published' ? 'success' : 'warning'}>{exam.status}</Badge> : null}
            {exam ? <Link className="btn btn-sm btn-ghost" to={`/app/exams/${exam.id}`}>Open exam</Link> : null}
          </div>

          <div className="grid grid-4 mb-2">
            <div className="card card-pad"><div className="fs-12 muted">Students</div><div className="stat-value">{stats.students || 0}</div></div>
            <div className="card card-pad"><div className="fs-12 muted">Passed</div><div className="stat-value">{stats.passed || 0}</div></div>
            <div className="card card-pad"><div className="fs-12 muted">Average</div><div className="stat-value">{stats.average ?? 0}%</div></div>
            <div className="card card-pad"><div className="fs-12 muted">Highest</div><div className="stat-value">{stats.highest ?? 0}%</div></div>
          </div>

          {loading ? <Loading /> : rows.length === 0 ? (
            <Card><EmptyState icon="results" title="No results for this filter" text="Try another class or clear the search." /></Card>
          ) : (
            <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) 280px', gap: 16, alignItems: 'start' }}>
              <Card flush>
                <DataTable
                  rows={rows}
                  sortable
                  columns={[
                    { key: 'rank', header: 'Rank', align: 'num' },
                    { key: 'full_name', header: 'Student', render: (r) => (<div><div className="strong">{r.full_name}</div><div className="fs-12 muted">{r.class_name} {r.section_name} · Roll {r.roll_no || '—'}</div></div>) },
                    { key: 'total', header: 'Total', align: 'num', render: (r) => `${r.total_obtained}/${r.total_max}` },
                    { key: 'percentage', header: '%', align: 'num', render: (r) => `${Number(r.percentage || 0).toFixed(1)}%` },
                    { key: 'grade', header: 'Grade', render: (r) => <Badge tone="outline">{r.grade || '—'}</Badge> },
                    { key: 'result_status', header: 'Result', render: (r) => <StatusBadge status={r.result_status} labels={{ pass: 'Pass', fail: 'Fail', compartment: 'Compartment' }} /> },
                    {
                      key: 'actions',
                      header: '',
                      align: 'actions',
                      render: (r) => <Button size="sm" variant="outline" icon="download" onClick={() => openFile(`/exams/results/${r.id}/report-card`)}>Card</Button>,
                    },
                  ]}
                />
              </Card>

              <div className="col gap-3">
                <Card title="Grade distribution" icon="chart">
                  <Donut size={140} thickness={16} data={Object.entries(stats.gradeDistribution || {}).map(([label, value]) => ({ label, value }))} centerValue={stats.students || 0} centerLabel="students" />
                </Card>
                <Card title="Exam details" icon="exams">
                  <div className="stack-sm fs-13">
                    <div className="row-between"><span className="muted">Session</span><span>{exam?.session_name || '—'}</span></div>
                    <div className="row-between"><span className="muted">Type</span><span>{String(exam?.type || '').replace(/_/g, ' ')}</span></div>
                    <div className="row-between"><span className="muted">Pass mark</span><span>{exam?.pass_percentage}%</span></div>
                    <div className="row-between"><span className="muted">Published</span><span>{exam?.result_published_at ? formatDate(exam.result_published_at) : 'Not yet'}</span></div>
                    <div className="row-between"><span className="muted">Lowest</span><span>{stats.lowest ?? 0}%</span></div>
                  </div>
                </Card>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
