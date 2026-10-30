import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { del, get, openFile, patch, post, useDebounced } from '../api.js';
import { useApp } from '../store.jsx';
import {
  Alert, Badge, Button, Card, DataTable, Drawer, EmptyState, Input, Loading, Modal, PageHeader, Progress, SearchField,
  Select, Stat, StatusBadge, Tabs, formatDate, formatMoney, useToast,
} from '../ui/index.jsx';
import Icon from '../ui/Icon.jsx';

const emptyVehicle = { registration_no: '', model: '', capacity: 40, driver_name: '', driver_phone: '', driver_license: '', insurance_expiry: '', fitness_expiry: '', status: 'active', notes: '' };
const emptyRoute = { name: '', code: '', vehicle_id: '', start_point: '', end_point: '', distance_km: 0, fee_amount: 0, status: 'active' };

function VehicleModal({ open, onClose, onDone, initial }) {
  const toast = useToast();
  const [form, setForm] = useState(emptyVehicle);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) setForm({ ...emptyVehicle, ...(initial || {}), insurance_expiry: initial?.insurance_expiry || '', fitness_expiry: initial?.fitness_expiry || '' }); }, [open, initial]);

  const save = async () => {
    setBusy(true);
    try {
      const payload = { ...form, capacity: Number(form.capacity) || 1, insurance_expiry: form.insurance_expiry || null, fitness_expiry: form.fitness_expiry || null };
      if (initial) await patch(`/transport/vehicles/${initial.id}`, payload);
      else await post('/transport/vehicles', payload);
      toast.success(initial ? 'Vehicle updated' : 'Vehicle added');
      onDone();
      onClose();
    } catch (err) {
      toast.error('Could not save vehicle', err.message);
    } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={initial ? 'Edit vehicle' : 'Add vehicle'} size="md" busy={busy}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save} disabled={!form.registration_no}>Save vehicle</Button></>}>
      <div className="field-row">
        <Input label="Registration no." required placeholder="WB-01-AB-1234" value={form.registration_no} onChange={(e) => setForm({ ...form, registration_no: e.target.value.toUpperCase() })} />
        <Input label="Model" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
        <Input label="Capacity" type="number" min={1} value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} />
      </div>
      <div className="field-row">
        <Input label="Driver" value={form.driver_name} onChange={(e) => setForm({ ...form, driver_name: e.target.value })} />
        <Input label="Driver phone" value={form.driver_phone} onChange={(e) => setForm({ ...form, driver_phone: e.target.value })} />
        <Select label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} options={[{ value: 'active', label: 'Active' }, { value: 'maintenance', label: 'In maintenance' }, { value: 'inactive', label: 'Inactive' }]} />
      </div>
      <div className="field-row">
        <Input label="Insurance expiry" type="date" value={form.insurance_expiry} onChange={(e) => setForm({ ...form, insurance_expiry: e.target.value })} />
        <Input label="Fitness expiry" type="date" value={form.fitness_expiry} onChange={(e) => setForm({ ...form, fitness_expiry: e.target.value })} />
        <Input label="Driver licence" value={form.driver_license} onChange={(e) => setForm({ ...form, driver_license: e.target.value })} />
      </div>
      <Input label="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
    </Modal>
  );
}

function RouteModal({ open, onClose, onDone, initial, vehicles }) {
  const toast = useToast();
  const [form, setForm] = useState(emptyRoute);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) setForm({ ...emptyRoute, ...(initial || {}), vehicle_id: initial?.vehicle_id || '', distance_km: initial?.distance_km ?? 0, fee_amount: initial?.fee_amount ?? 0 }); }, [open, initial]);

  const save = async () => {
    setBusy(true);
    try {
      const payload = { ...form, vehicle_id: form.vehicle_id || null, distance_km: Number(form.distance_km) || 0, fee_amount: Number(form.fee_amount) || 0 };
      if (initial) await patch(`/transport/routes/${initial.id}`, payload);
      else await post('/transport/routes', payload);
      toast.success(initial ? 'Route updated' : 'Route created');
      onDone();
      onClose();
    } catch (err) {
      toast.error('Could not save route', err.message);
    } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={initial ? 'Edit route' : 'New route'} size="md" busy={busy}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save} disabled={!form.name}>Save route</Button></>}>
      <div className="field-row">
        <Input label="Route name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Input label="Code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
        <Select label="Vehicle" placeholder="Unassigned" options={vehicles.map((v) => ({ value: v.id, label: `${v.registration_no} (${v.capacity} seats)` }))} value={form.vehicle_id} onChange={(e) => setForm({ ...form, vehicle_id: e.target.value })} />
      </div>
      <div className="field-row">
        <Input label="Starts from" value={form.start_point} onChange={(e) => setForm({ ...form, start_point: e.target.value })} />
        <Input label="Ends at" value={form.end_point} onChange={(e) => setForm({ ...form, end_point: e.target.value })} />
        <Input label="Distance (km)" type="number" step="0.1" value={form.distance_km} onChange={(e) => setForm({ ...form, distance_km: e.target.value })} />
      </div>
      <div className="field-row">
        <Input label="Monthly fee" type="number" value={form.fee_amount} onChange={(e) => setForm({ ...form, fee_amount: e.target.value })} />
        <Select label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} />
      </div>
    </Modal>
  );
}

function RouteDrawer({ route, onClose, onRefresh, canManage }) {
  const toast = useToast();
  const [stopName, setStopName] = useState('');
  const [stopTime, setStopTime] = useState('');
  const [busy, setBusy] = useState(false);

  const addStop = async () => {
    setBusy(true);
    try {
      await post(`/transport/routes/${route.id}/stops`, { name: stopName, pickup_time: stopTime, drop_time: '', landmark: '' });
      setStopName(''); setStopTime('');
      onRefresh();
      toast.success('Stop added');
    } catch (err) { toast.error('Could not add stop', err.message); } finally { setBusy(false); }
  };

  return (
    <Drawer open={!!route} onClose={onClose} title={route?.name || 'Route'} subtitle={`${route?.stops?.length || 0} stops · ${route?.students || 0} students`}>
      {route ? (
        <>
          <div className="grid grid-2 mb-2">
            <Stat label="Vehicle" value={route.registration_no || 'Unassigned'} />
            <Stat label="Driver" value={route.driver_name || '—'} meta={route.driver_phone || ''} />
            <Stat label="Distance" value={route.distance_km ? `${route.distance_km} km` : '—'} />
            <Stat label="Monthly fee" value={formatMoney(route.fee_amount)} />
          </div>
          <h4 className="fs-13 strong mb-1">Stops</h4>
          {(route.stops || []).length === 0 ? <EmptyState icon="transport" title="No stops yet" /> : (
            <div className="stack-sm">
              {route.stops.map((s) => (
                <div key={s.id} className="file-row">
                  <span className="file-icon"><Icon name="pin" size={14} /></span>
                  <div className="grow">
                    <div className="fs-13 strong">{s.name}</div>
                    <div className="fs-12 muted">{s.pickup_time || '—'} pickup {s.landmark ? `· ${s.landmark}` : ''}</div>
                  </div>
                  {canManage ? (
                    <Button size="sm" variant="ghost" icon="trash" aria-label="Remove stop" onClick={async () => { try { await del(`/transport/stops/${s.id}`); onRefresh(); } catch (err) { toast.error('Could not remove stop', err.message); } }} />
                  ) : null}
                </div>
              ))}
            </div>
          )}
          {canManage ? (
            <div className="row gap-1 mt-2">
              <input className="input grow" placeholder="Stop name" value={stopName} onChange={(e) => setStopName(e.target.value)} />
              <input className="input" style={{ width: 110 }} placeholder="07:15" value={stopTime} onChange={(e) => setStopTime(e.target.value)} />
              <Button variant="outline" loading={busy} onClick={addStop} disabled={!stopName.trim()}>Add</Button>
            </div>
          ) : null}
        </>
      ) : null}
    </Drawer>
  );
}

function AllocationsTab({ routes, refresh, canAllocate }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const debounced = useDebounced(q);
  const [results, setResults] = useState([]);
  const [form, setForm] = useState({ student_id: '', route_id: '', stop_id: '' });
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState(null);

  const load = () => get('/transport/overview').then((res) => setData(res)).catch(() => {});
  useEffect(load, []);
  useEffect(() => {
    if (!open || debounced.trim().length < 2) { setResults([]); return; }
    get('/students', { q: debounced.trim(), limit: 8 }).then((res) => setResults(res.items || [])).catch(() => {});
  }, [debounced, open]);

  const selectedRoute = routes.find((r) => r.id === form.route_id);

  const allocate = async () => {
    setBusy(true);
    try {
      await post('/transport/allocate', { student_id: form.student_id, route_id: form.route_id || null, stop_id: form.stop_id || null });
      toast.success(form.route_id ? 'Student allocated' : 'Transport removed');
      setOpen(false);
      setForm({ student_id: '', route_id: '', stop_id: '' });
      setQ(''); setResults([]);
      load();
      refresh();
    } catch (err) { toast.error('Could not allocate', err.message); } finally { setBusy(false); }
  };

  return (
    <>
      <div className="row-between mb-2">
        <span className="fs-13 muted">Students assigned to a route, {data ? `${data.allocations.length} in total` : '…'}</span>
        <div className="row gap-1">
          <Button size="sm" variant="outline" icon="download" onClick={() => openFile('/transport/export')}>Export</Button>
          {canAllocate ? <Button size="sm" variant="primary" icon="plus" onClick={() => setOpen(true)}>Allocate student</Button> : null}
        </div>
      </div>
      <DataTable
        rows={data?.allocations || []}
        loading={!data}
        columns={[
          { key: 'full_name', header: 'Student', render: (r) => (<div><div className="strong">{r.full_name}</div><div className="fs-12 muted">{r.admission_no}</div></div>) },
          { key: 'class_name', header: 'Class', render: (r) => r.class_name || '—' },
          { key: 'route_name', header: 'Route', render: (r) => r.route_name || '—' },
          { key: 'stop_name', header: 'Stop', render: (r) => r.stop_name || '—' },
        ]}
        emptyTitle="No allocations"
        emptyText="Allocate a student to a route to track transport."
      />

      <Modal open={open} onClose={() => setOpen(false)} title="Allocate transport" size="sm" busy={busy}
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={allocate} disabled={!form.student_id}>Allocate</Button></>}>
        {form.student_id ? <Alert tone="info">Selected student ready. Choose a route below.</Alert> : <SearchField value={q} onChange={setQ} placeholder="Search student by name or admission no…" className="w-100" />}
        {results.length && !form.student_id ? (
          <div style={{ border: '1px solid var(--line)', borderRadius: 9, margin: '8px 0', maxHeight: 180, overflow: 'auto' }}>
            {results.map((s) => (
              <div key={s.id} role="presentation" className="search-result" onClick={() => { setForm({ ...form, student_id: s.id }); setQ(s.full_name); }}>
                <div><div className="strong fs-13">{s.full_name}</div><div className="fs-12 muted">{s.admission_no} · {s.class_name || ''}</div></div>
              </div>
            ))}
          </div>
        ) : null}
        <Select label="Route" placeholder="No transport" options={routes.map((r) => ({ value: r.id, label: r.name }))} value={form.route_id} onChange={(e) => setForm({ ...form, route_id: e.target.value, stop_id: '' })} />
        <Select label="Stop" placeholder="—" options={(selectedRoute?.stops || []).map((s) => ({ value: s.id, label: s.name }))} value={form.stop_id} onChange={(e) => setForm({ ...form, stop_id: e.target.value })} disabled={!form.route_id} />
      </Modal>
    </>
  );
}

function AttendanceTab({ routes, canMark }) {
  const toast = useToast();
  const [routeId, setRouteId] = useState(routes[0]?.id || '');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [direction, setDirection] = useState('pickup');
  const [data, setData] = useState(null);
  const [marks, setMarks] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!routeId && routes[0]) setRouteId(routes[0].id); }, [routes, routeId]);

  const load = () => {
    if (!routeId) { setData(null); return; }
    get('/transport/attendance', { routeId, date }).then((res) => {
      setData(res);
      const next = {};
      (res.students || []).forEach((s) => { next[s.id] = s.status || 'absent'; });
      setMarks(next);
    }).catch(() => {});
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [routeId, date]);

  const save = async () => {
    setBusy(true);
    try {
      const records = Object.entries(marks).map(([student_id, status]) => ({ student_id, status }));
      const res = await post('/transport/attendance', { route_id: routeId, date, direction, records });
      toast.success(`${res.saved} records saved`, `${direction} · ${formatDate(date)}`);
    } catch (err) { toast.error('Could not save', err.message); } finally { setBusy(false); }
  };

  const present = Object.values(marks).filter((m) => m === 'present').length;

  return (
    <Card
      title="Transport attendance"
      subtitle="Mark who boarded the bus for a route and date."
      actions={canMark ? <Button size="sm" variant="primary" loading={busy} onClick={save} disabled={!routeId || !data}>Save attendance</Button> : null}
    >
      <div className="row row-wrap gap-1 mb-2">
        <select className="select" style={{ width: 'auto' }} value={routeId} onChange={(e) => setRouteId(e.target.value)}>
          <option value="">Select route</option>
          {routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <input className="input" style={{ width: 'auto' }} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <select className="select" style={{ width: 'auto' }} value={direction} onChange={(e) => setDirection(e.target.value)}>
          <option value="pickup">Pickup</option><option value="drop">Drop</option>
        </select>
        <span className="grow" />
        {data ? <Badge tone="success">{present} boarded</Badge> : null}
      </div>
      {!data ? <EmptyState icon="transport" title="Choose a route" text="Select a route to load its students." /> : data.students.length === 0 ? <EmptyState icon="students" title="No students on this route" /> : (
        <div className="stack-sm">
          {data.students.map((s) => (
            <div key={s.id} className="row-between" style={{ borderBottom: '1px solid var(--line)', padding: '7px 0' }}>
              <div>
                <div className="fs-13 strong">{s.full_name}</div>
                <div className="fs-12 muted">{s.admission_no} · {s.class_name || ''} · {s.stop_name || 'no stop'}</div>
              </div>
              <div className="segmented">
                <button type="button" className={marks[s.id] === 'present' ? 'on' : ''} onClick={() => setMarks({ ...marks, [s.id]: 'present' })}>Boarded</button>
                <button type="button" className={marks[s.id] === 'absent' ? 'on' : ''} onClick={() => setMarks({ ...marks, [s.id]: 'absent' })}>Absent</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export default function Transport() {
  const { can } = useApp();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'routes';
  const setTab = (value) => { const next = new URLSearchParams(params); next.set('tab', value); setParams(next, { replace: true }); };
  const [data, setData] = useState(null);
  const [vehicleModal, setVehicleModal] = useState(null);
  const [vehicleOpen, setVehicleOpen] = useState(false);
  const [routeModal, setRouteModal] = useState(null);
  const [routeOpen, setRouteOpen] = useState(false);
  const [drawer, setDrawer] = useState(null);

  const load = () => get('/transport/overview').then((res) => { setData(res); setDrawer((prev) => (prev ? res.routes.find((r) => r.id === prev.id) || null : null)); }).catch((err) => toast.error('Could not load transport', err.message));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const routes = data?.routes || [];
  const vehicles = data?.vehicles || [];
  const currency = undefined;

  if (!data) return <div className="page"><Loading label="Loading transport…" /></div>;

  return (
    <div className="page">
      <PageHeader
        title="Transport"
        subtitle="Fleet, routes, stops, allocations and bus attendance."
        actions={can('transport.manage') ? <Button variant="primary" icon="plus" onClick={() => { setRouteModal(null); setRouteOpen(true); }}>New route</Button> : null}
      />

      <div className="grid grid-4 mb-3">
        <Stat label="Fleet" value={data.stats.fleet} meta={`${data.stats.activeVehicles} active`} icon="transport" />
        <Stat label="Routes" value={data.stats.routes} icon="map" />
        <Stat label="Students" value={data.stats.students} meta="using transport" icon="students" />
        <Stat label="Insurance due" value={data.stats.expiringInsurance} meta="within 45 days" tone={data.stats.expiringInsurance ? 'var(--warning)' : undefined} icon="alert" />
      </div>

      <Card flush>
        <div style={{ padding: '0 14px' }}>
          <Tabs value={tab} onChange={setTab} tabs={[
            { value: 'routes', label: 'Routes' },
            { value: 'vehicles', label: 'Fleet' },
            { value: 'allocations', label: 'Allocations' },
            { value: 'attendance', label: 'Attendance' },
          ]} />
        </div>
        <div style={{ padding: 16 }}>
          {tab === 'routes' ? (
            routes.length === 0 ? <EmptyState icon="map" title="No routes yet" text="Create a route, assign a vehicle and add stops." action={can('transport.manage') ? <Button variant="primary" onClick={() => { setRouteModal(null); setRouteOpen(true); }}>New route</Button> : null} /> : (
              <div className="grid grid-2">
                {routes.map((r) => {
                  const pct = r.capacity ? Math.round((r.students / r.capacity) * 100) : 0;
                  return (
                    <div key={r.id} className="card card-pad">
                      <div className="row-between">
                        <div className="row gap-1">
                          <strong>{r.name}</strong>
                          {r.code ? <Badge tone="outline">{r.code}</Badge> : null}
                          <StatusBadge status={r.status} />
                        </div>
                        {can('transport.manage') ? (
                          <div className="row gap-1">
                            <Button size="sm" variant="ghost" icon="edit" aria-label="Edit route" onClick={() => { setRouteModal(r); setRouteOpen(true); }} />
                            <Button size="sm" variant="ghost" icon="trash" aria-label="Delete route" onClick={async () => { if (!window.confirm(`Delete route ${r.name}?`)) return; try { await del(`/transport/routes/${r.id}`); toast.success('Route deleted'); load(); } catch (err) { toast.error('Cannot delete', err.message); } }} />
                          </div>
                        ) : null}
                      </div>
                      <div className="fs-12 muted mt-1">{r.start_point || '—'} → {r.end_point || '—'} · {r.distance_km || 0} km</div>
                      <div className="fs-12 muted">{r.registration_no || 'No vehicle'} · {r.driver_name || 'No driver'}</div>
                      <div className="mt-2">
                        <div className="row-between fs-12 muted mb-0"><span>{r.students} students</span><span>{r.stops?.length || 0} stops</span></div>
                        <Progress value={r.students} max={r.capacity || r.students || 1} tone={pct > 90 ? 'var(--danger)' : pct > 70 ? 'var(--warning)' : undefined} />
                      </div>
                      <div className="row gap-1 mt-2">
                        <Button size="sm" variant="outline" onClick={() => setDrawer(r)}>View stops</Button>
                        <span className="fs-12 muted">{formatMoney(r.fee_amount)}{currency}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          ) : null}

          {tab === 'vehicles' ? (
            <>
            {can('transport.manage') ? <div className="row-between mb-2"><span className="fs-13 muted">{vehicles.length} vehicles in the fleet</span><Button size="sm" variant="primary" icon="plus" onClick={() => { setVehicleModal(null); setVehicleOpen(true); }}>Add vehicle</Button></div> : null}
            <DataTable
              rows={vehicles}
              columns={[
                { key: 'registration_no', header: 'Registration', render: (r) => <strong>{r.registration_no}</strong> },
                { key: 'model', header: 'Model', render: (r) => r.model || '—' },
                { key: 'capacity', header: 'Seats', align: 'num' },
                { key: 'driver_name', header: 'Driver', render: (r) => (<div><div>{r.driver_name || '—'}</div><div className="fs-12 muted">{r.driver_phone || ''}</div></div>) },
                { key: 'insurance_expiry', header: 'Insurance', render: (r) => r.insurance_expiry ? formatDate(r.insurance_expiry) : '—' },
                { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
                {
                  key: 'actions', header: '', align: 'actions',
                  render: (r) => can('transport.manage') ? (
                    <div className="row gap-1" style={{ justifyContent: 'flex-end' }}>
                      <Button size="sm" variant="ghost" icon="edit" aria-label="Edit" onClick={() => { setVehicleModal(r); setVehicleOpen(true); }} />
                      <Button size="sm" variant="ghost" icon="trash" aria-label="Delete" onClick={async () => { if (!window.confirm(`Delete ${r.registration_no}?`)) return; try { await del(`/transport/vehicles/${r.id}`); toast.success('Vehicle deleted'); load(); } catch (err) { toast.error('Cannot delete', err.message); } }} />
                    </div>
                  ) : null,
                },
              ]}
              emptyTitle="No vehicles"
              emptyText="Add the school buses and vans to manage routes."
            />
            </>
          ) : null}

          {tab === 'allocations' ? <AllocationsTab routes={routes} refresh={load} canAllocate={can('transport.allocate')} /> : null}
          {tab === 'attendance' ? <AttendanceTab routes={routes} canMark={can('transport.attendance')} /> : null}
        </div>
      </Card>

      {tab === 'vehicles' && data.maintenance.length ? (
        <Card title="Recent maintenance" subtitle="Latest service history" className="mt-3">
          <DataTable
            rows={data.maintenance.slice(0, 8)}
            columns={[
              { key: 'service_date', header: 'Date', render: (r) => formatDate(r.service_date) },
              { key: 'registration_no', header: 'Vehicle' },
              { key: 'type', header: 'Type', render: (r) => <Badge tone="outline">{r.type}</Badge> },
              { key: 'garage', header: 'Garage', render: (r) => r.garage || '—' },
              { key: 'cost', header: 'Cost', align: 'num', render: (r) => formatMoney(r.cost) },
            ]}
          />
        </Card>
      ) : null}

      <VehicleModal open={vehicleOpen} initial={vehicleModal} onClose={() => { setVehicleOpen(false); setVehicleModal(null); }} onDone={load} />
      <RouteModal open={routeOpen} initial={routeModal} vehicles={vehicles} onClose={() => { setRouteOpen(false); setRouteModal(null); }} onDone={load} />
      <RouteDrawer route={drawer} onClose={() => setDrawer(null)} onRefresh={load} canManage={can('transport.manage')} />
    </div>
  );
}
