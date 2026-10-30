import { Router } from 'express';
import { z } from 'zod';
import { db, nowIso, newId } from '../db/index.js';
import { validateBody } from '../lib/validate.js';
import { requirePermission } from '../lib/auth.js';
import { badRequest, conflict, notFound, asyncHandler } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { currentSession } from '../lib/defaults.js';
import { sendTable } from '../lib/export.js';

const router = Router();

router.get('/overview', requirePermission('transport.view'), asyncHandler(async (req, res) => {
  const schoolId = req.user.school_id;
  const vehicles = db.prepare('SELECT * FROM vehicles WHERE school_id = ? ORDER BY registration_no').all(schoolId);
  const routes = db.prepare(
    `SELECT r.*, v.registration_no, v.capacity, v.driver_name, v.driver_phone,
       (SELECT COUNT(*) FROM transport_stops st WHERE st.route_id = r.id) stops,
       (SELECT COUNT(*) FROM students s WHERE s.transport_route_id = r.id AND s.status = 'active') students
     FROM transport_routes r LEFT JOIN vehicles v ON v.id = r.vehicle_id
     WHERE r.school_id = ? ORDER BY r.name`,
  ).all(schoolId);
  const stops = db.prepare('SELECT * FROM transport_stops WHERE school_id = ? ORDER BY sort_order').all(schoolId);
  const allocations = db.prepare(
    `SELECT s.id, s.full_name, s.admission_no, r.name AS route_name, st.name AS stop_name, c.name AS class_name
     FROM students s LEFT JOIN transport_routes r ON r.id = s.transport_route_id
     LEFT JOIN transport_stops st ON st.id = s.transport_stop_id LEFT JOIN classes c ON c.id = s.class_id
     WHERE s.school_id = ? AND s.transport_route_id IS NOT NULL AND s.status = 'active' ORDER BY r.name, s.full_name`,
  ).all(schoolId);
  const maintenance = db.prepare(
    `SELECT m.*, v.registration_no FROM vehicle_maintenance m JOIN vehicles v ON v.id = m.vehicle_id
     WHERE m.school_id = ? ORDER BY m.service_date DESC LIMIT 50`,
  ).all(schoolId);

  const today = new Date().toISOString().slice(0, 10);
  const attendance = db.prepare(
    `SELECT ta.status, COUNT(*) c FROM transport_attendance ta WHERE ta.school_id = ? AND ta.date = ? GROUP BY ta.status`,
  ).all(schoolId, today);

  res.json({
    vehicles,
    routes: routes.map((r) => ({ ...r, stops: stops.filter((s) => s.route_id === r.id) })),
    allocations,
    maintenance,
    attendanceToday: attendance,
    stats: {
      fleet: vehicles.length,
      activeVehicles: vehicles.filter((v) => v.status === 'active').length,
      routes: routes.length,
      students: allocations.length,
      expiringInsurance: vehicles.filter((v) => v.insurance_expiry && v.insurance_expiry <= addDays(45)).length,
    },
  });
}));

function addDays(days) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

/* -------------------------------- vehicles -------------------------------- */

const vehicleSchema = z.object({
  registration_no: z.string().min(3).max(20),
  model: z.string().max(80).optional().default(''),
  capacity: z.coerce.number().int().min(1).max(120).optional().default(40),
  driver_name: z.string().max(80).optional().default(''),
  driver_phone: z.string().max(20).optional().default(''),
  driver_license: z.string().max(40).optional().default(''),
  insurance_expiry: z.string().max(20).nullish(),
  fitness_expiry: z.string().max(20).nullish(),
  status: z.enum(['active', 'maintenance', 'inactive']).optional().default('active'),
  notes: z.string().max(300).optional().default(''),
});

router.post('/vehicles', requirePermission('transport.manage'), validateBody(vehicleSchema), asyncHandler(async (req, res) => {
  const exists = db.prepare('SELECT id FROM vehicles WHERE school_id = ? AND registration_no = ?').get(req.user.school_id, req.data.registration_no);
  if (exists) throw conflict('Vehicle already registered');
  const id = newId('veh');
  db.prepare(
    `INSERT INTO vehicles (id, school_id, registration_no, model, capacity, driver_name, driver_phone, driver_license,
      insurance_expiry, fitness_expiry, status, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(id, req.user.school_id, req.data.registration_no, req.data.model, req.data.capacity, req.data.driver_name,
    req.data.driver_phone, req.data.driver_license, req.data.insurance_expiry || null, req.data.fitness_expiry || null,
    req.data.status, req.data.notes, nowIso(), nowIso());
  audit(req, { action: 'create', module: 'transport', entityType: 'vehicle', entityId: id, summary: `Added vehicle ${req.data.registration_no}` });
  res.status(201).json({ id });
}));

router.patch('/vehicles/:id', requirePermission('transport.manage'), validateBody(vehicleSchema.partial()), asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT * FROM vehicles WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!row) throw notFound('Vehicle not found');
  const d = req.data;
  db.prepare(
    `UPDATE vehicles SET registration_no = ?, model = ?, capacity = ?, driver_name = ?, driver_phone = ?, driver_license = ?,
      insurance_expiry = ?, fitness_expiry = ?, status = ?, notes = ?, updated_at = ? WHERE id = ?`,
  ).run(d.registration_no ?? row.registration_no, d.model ?? row.model, d.capacity ?? row.capacity,
    d.driver_name ?? row.driver_name, d.driver_phone ?? row.driver_phone, d.driver_license ?? row.driver_license,
    d.insurance_expiry === undefined ? row.insurance_expiry : d.insurance_expiry,
    d.fitness_expiry === undefined ? row.fitness_expiry : d.fitness_expiry,
    d.status ?? row.status, d.notes ?? row.notes, nowIso(), row.id);
  audit(req, { action: 'update', module: 'transport', entityType: 'vehicle', entityId: row.id, summary: 'Updated vehicle record' });
  res.json({ ok: true });
}));

router.delete('/vehicles/:id', requirePermission('transport.manage'), asyncHandler(async (req, res) => {
  const used = db.prepare('SELECT COUNT(*) c FROM transport_routes WHERE vehicle_id = ?').get(req.params.id).c;
  if (used) throw conflict('Vehicle is assigned to a route');
  db.prepare('DELETE FROM vehicles WHERE id = ? AND school_id = ?').run(req.params.id, req.user.school_id);
  res.json({ ok: true });
}));

/* --------------------------------- routes --------------------------------- */

const routeSchema = z.object({
  name: z.string().min(2).max(80),
  code: z.string().max(20).optional().default(''),
  vehicle_id: z.string().nullish(),
  start_point: z.string().max(80).optional().default(''),
  end_point: z.string().max(80).optional().default(''),
  distance_km: z.coerce.number().min(0).optional().default(0),
  fee_amount: z.coerce.number().min(0).optional().default(0),
  status: z.string().max(20).optional().default('active'),
});

router.post('/routes', requirePermission('transport.manage'), validateBody(routeSchema), asyncHandler(async (req, res) => {
  const id = newId('rte');
  db.prepare(
    `INSERT INTO transport_routes (id, school_id, name, code, vehicle_id, start_point, end_point, distance_km, fee_amount, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(id, req.user.school_id, req.data.name, req.data.code, req.data.vehicle_id || null, req.data.start_point,
    req.data.end_point, req.data.distance_km, req.data.fee_amount, req.data.status, nowIso(), nowIso());
  audit(req, { action: 'create', module: 'transport', entityType: 'route', entityId: id, summary: `Created route ${req.data.name}` });
  res.status(201).json({ id });
}));

router.patch('/routes/:id', requirePermission('transport.manage'), validateBody(routeSchema.partial()), asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT * FROM transport_routes WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!row) throw notFound('Route not found');
  const d = req.data;
  db.prepare(
    `UPDATE transport_routes SET name = ?, code = ?, vehicle_id = ?, start_point = ?, end_point = ?, distance_km = ?,
      fee_amount = ?, status = ?, updated_at = ? WHERE id = ?`,
  ).run(d.name ?? row.name, d.code ?? row.code, d.vehicle_id === undefined ? row.vehicle_id : d.vehicle_id,
    d.start_point ?? row.start_point, d.end_point ?? row.end_point, d.distance_km ?? row.distance_km,
    d.fee_amount ?? row.fee_amount, d.status ?? row.status, nowIso(), row.id);
  res.json({ ok: true });
}));

router.delete('/routes/:id', requirePermission('transport.manage'), asyncHandler(async (req, res) => {
  const students = db.prepare('SELECT COUNT(*) c FROM students WHERE transport_route_id = ?').get(req.params.id).c;
  if (students) throw conflict(`${students} student(s) are allocated to this route`);
  db.prepare('DELETE FROM transport_stops WHERE route_id = ?').run(req.params.id);
  db.prepare('DELETE FROM transport_routes WHERE id = ? AND school_id = ?').run(req.params.id, req.user.school_id);
  res.json({ ok: true });
}));

router.post('/routes/:id/stops', requirePermission('transport.manage'), validateBody(z.object({
  name: z.string().min(2).max(80),
  pickup_time: z.string().max(10).optional().default(''),
  drop_time: z.string().max(10).optional().default(''),
  landmark: z.string().max(120).optional().default(''),
  fee_amount: z.coerce.number().min(0).optional().default(0),
})), asyncHandler(async (req, res) => {
  const route = db.prepare('SELECT * FROM transport_routes WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!route) throw notFound('Route not found');
  const order = db.prepare('SELECT COALESCE(MAX(sort_order),0)+1 n FROM transport_stops WHERE route_id = ?').get(route.id).n;
  const id = newId('stp');
  db.prepare('INSERT INTO transport_stops (id, school_id, route_id, name, pickup_time, drop_time, landmark, fee_amount, sort_order) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, req.user.school_id, route.id, req.data.name, req.data.pickup_time, req.data.drop_time, req.data.landmark, req.data.fee_amount, order);
  audit(req, { action: 'create', module: 'transport', entityType: 'stop', entityId: id, summary: `Added stop ${req.data.name}` });
  res.status(201).json({ id });
}));

router.delete('/stops/:id', requirePermission('transport.manage'), asyncHandler(async (req, res) => {
  const used = db.prepare('SELECT COUNT(*) c FROM students WHERE transport_stop_id = ?').get(req.params.id).c;
  if (used) throw conflict('Students are allocated to this stop');
  db.prepare('DELETE FROM transport_stops WHERE id = ? AND school_id = ?').run(req.params.id, req.user.school_id);
  res.json({ ok: true });
}));

/* ------------------------------- allocations ------------------------------ */

router.post('/allocate', requirePermission('transport.allocate'), validateBody(z.object({
  student_id: z.string().min(1),
  route_id: z.string().nullish(),
  stop_id: z.string().nullish(),
})), asyncHandler(async (req, res) => {
  const student = db.prepare('SELECT * FROM students WHERE id = ? AND school_id = ?').get(req.data.student_id, req.user.school_id);
  if (!student) throw notFound('Student not found');
  if (req.data.route_id) {
    const route = db.prepare('SELECT * FROM transport_routes WHERE id = ? AND school_id = ?').get(req.data.route_id, req.user.school_id);
    if (!route) throw notFound('Route not found');
    if (route.vehicle_id) {
      const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(route.vehicle_id);
      const allocated = db.prepare('SELECT COUNT(*) c FROM students WHERE transport_route_id = ? AND status = ?').get(route.id, 'active').c;
      if (vehicle && allocated >= vehicle.capacity) throw conflict(`Vehicle ${vehicle.registration_no} is at capacity (${vehicle.capacity})`);
    }
  }
  db.prepare('UPDATE students SET transport_route_id = ?, transport_stop_id = ?, updated_at = ? WHERE id = ?')
    .run(req.data.route_id || null, req.data.stop_id || null, nowIso(), student.id);
  audit(req, {
    action: 'allocate', module: 'transport', entityType: 'student', entityId: student.id,
    summary: `${student.full_name} transport ${req.data.route_id ? 'allocated' : 'removed'}`,
  });
  res.json({ ok: true });
}));

/* ------------------------------- maintenance ------------------------------ */

router.post('/maintenance', requirePermission('transport.maintenance'), validateBody(z.object({
  vehicle_id: z.string().min(1),
  service_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  type: z.string().max(60).optional().default('service'),
  cost: z.coerce.number().min(0).optional().default(0),
  garage: z.string().max(120).optional().default(''),
  notes: z.string().max(300).optional().default(''),
  next_service_date: z.string().max(20).nullish(),
})), asyncHandler(async (req, res) => {
  const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ? AND school_id = ?').get(req.data.vehicle_id, req.user.school_id);
  if (!vehicle) throw notFound('Vehicle not found');
  const id = newId('vm');
  db.prepare(
    `INSERT INTO vehicle_maintenance (id, school_id, vehicle_id, service_date, type, cost, garage, notes, next_service_date, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run(id, req.user.school_id, vehicle.id, req.data.service_date, req.data.type, req.data.cost,
    req.data.garage, req.data.notes, req.data.next_service_date || null, nowIso());
  db.prepare('INSERT INTO expenses (id, school_id, session_id, category, description, amount, expense_date, paid_to, method, recorded_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(newId('exp'), req.user.school_id, currentSession(req.user.school_id)?.id, 'transport',
      `Vehicle maintenance ${vehicle.registration_no} — ${req.data.type}`, req.data.cost, req.data.service_date,
      req.data.garage || null, 'cash', req.user.id, nowIso());
  audit(req, { action: 'maintenance', module: 'transport', entityType: 'vehicle', entityId: vehicle.id, summary: `Logged maintenance for ${vehicle.registration_no}`, meta: { cost: req.data.cost } });
  res.status(201).json({ id });
}));

/* --------------------------- transport attendance ------------------------- */

router.get('/attendance', requirePermission('transport.attendance', 'transport.view'), asyncHandler(async (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const routeId = req.query.routeId;
  if (!routeId) throw badRequest('routeId is required');
  const students = db.prepare(
    `SELECT s.id, s.full_name, s.admission_no, c.name AS class_name, st.name AS stop_name,
       ta.status, ta.direction
     FROM students s LEFT JOIN classes c ON c.id = s.class_id
     LEFT JOIN transport_stops st ON st.id = s.transport_stop_id
     LEFT JOIN transport_attendance ta ON ta.student_id = s.id AND ta.date = ? AND ta.route_id = ?
     WHERE s.school_id = ? AND s.transport_route_id = ? AND s.status = 'active' ORDER BY s.full_name`,
  ).all(date, routeId, req.user.school_id, routeId);
  res.json({ date, students });
}));

router.post('/attendance', requirePermission('transport.attendance'), validateBody(z.object({
  route_id: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  direction: z.enum(['pickup', 'drop']).default('pickup'),
  records: z.array(z.object({ student_id: z.string(), status: z.enum(['present', 'absent']) })).min(1).max(300),
})), asyncHandler(async (req, res) => {
  let saved = 0;
  const run = db.transaction(() => {
    for (const rec of req.data.records) {
      const existing = db.prepare('SELECT id FROM transport_attendance WHERE route_id = ? AND student_id = ? AND date = ? AND direction = ?')
        .get(req.data.route_id, rec.student_id, req.data.date, req.data.direction);
      if (existing) {
        db.prepare('UPDATE transport_attendance SET status = ? WHERE id = ?').run(rec.status, existing.id);
      } else {
        db.prepare('INSERT INTO transport_attendance (id, school_id, route_id, student_id, date, direction, status, boarded_at) VALUES (?,?,?,?,?,?,?,?)')
          .run(newId('tat'), req.user.school_id, req.data.route_id, rec.student_id, req.data.date, req.data.direction, rec.status, nowIso());
      }
      saved += 1;
    }
  });
  run();
  audit(req, { action: 'attendance', module: 'transport', summary: `Transport ${req.data.direction} attendance ${req.data.date}: ${saved} records` });
  res.json({ saved });
}));

router.get('/export', requirePermission('transport.view'), asyncHandler(async (req, res) => {
  const rows = db.prepare(
    `SELECT s.full_name, s.admission_no, c.name AS class_name, r.name AS route_name, st.name AS stop_name,
       r.fee_amount, v.registration_no
     FROM students s LEFT JOIN classes c ON c.id = s.class_id
     LEFT JOIN transport_routes r ON r.id = s.transport_route_id
     LEFT JOIN transport_stops st ON st.id = s.transport_stop_id
     LEFT JOIN vehicles v ON v.id = r.vehicle_id
     WHERE s.school_id = ? AND s.transport_route_id IS NOT NULL ORDER BY r.name, s.full_name`,
  ).all(req.user.school_id);
  await sendTable(req, res, {
    filename: 'transport-allocation', title: 'Transport Allocation',
    columns: [
      { label: 'Student', key: 'full_name' }, { label: 'Admission No', key: 'admission_no' },
      { label: 'Class', key: 'class_name' }, { label: 'Route', key: 'route_name' },
      { label: 'Stop', key: 'stop_name' }, { label: 'Vehicle', key: 'registration_no' },
      { label: 'Monthly Fee', key: 'fee_amount' },
    ],
    rows,
  });
}));

export default router;
