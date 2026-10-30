# Advanced School ERP & Website

A complete, self-hosted school management platform: a public school website with
admissions enquiries, plus a multi-module ERP covering students, attendance,
examinations, results, fees, payroll, library, transport, homework, messaging,
reports and site administration.

Built with **Node.js 22+**, **Express 4**, **SQLite (`node:sqlite`)**, and a
**React 19 + Vite** single-page app. No external database, cache or cloud service
is required — one process and one SQLite file.

---

## Quick start

```bash
# 1. install server dependencies (nodemailer needs --ignore-scripts in some sandboxes)
npm install

# 2. create the database schema
npm run db:reset -- --yes

# 3. load the demo school (195 students, 20 teachers, fees, exams, library, transport…)
npm run seed:demo -- --force

# 4. build the front-end and start the server
npm run build
npm start            # http://localhost:3001
```

For front-end development with hot reload:

```bash
npm run dev          # API on :3001 + Vite on :5173 (proxies /api and /uploads)
```

The first visit to a database **without** a school redirects to `/setup`, an
in-app wizard that creates the school, the academic session, classes and the
principal account.

### Deploying

The React app is a static bundle and can be hosted on **Netlify**; the Express +
SQLite API runs on any Node host with a persistent disk (Render, Railway, Fly.io,
Docker, VPS). Netlify proxies `/api/*` and `/uploads/*` to the API so sessions and
uploads stay same-origin — no CORS or cross-site cookies required.

```bash
# Netlify build command (already configured in netlify.toml)
npm --prefix client ci && npm run build:netlify
# Set API_ORIGIN on Netlify, e.g. https://school-api.onrender.com
```

A `Dockerfile`, `netlify.toml`, `_redirects` generator, `.env.example` and a
step-by-step guide are included — see **[DEPLOY.md](DEPLOY.md)** for the full
Netlify + API deployment walkthrough, environment variables and troubleshooting.

### Demo accounts

| Role        | Login                      | Password       |
|-------------|----------------------------|----------------|
| Super admin | `admin`                    | `admin123`     |
| Principal   | `principal@sunrise.edu.in` | `Principal@123`|
| Teacher   | `teacher1@sunrise.edu.in`  | `Teacher@123`  |
| Accounts  | `accounts@sunrise.edu.in`  | `Staff@123`    |
| Exams     | `exams@sunrise.edu.in`     | `Staff@123`    |
| Parent    | `parent1@example.com`      | `Parent@123`   |
| Student   | `student25@example.com`    | `Student@123`  |

These credentials are for local demo use — change them (Settings → Security, or
Users & roles) before exposing the app publicly.

Sign in with **either a username or an email address**. The seeded super admin
(`admin` / `admin123`) has the `principal` role, which bypasses every permission
check. On a fresh install the setup wizard asks for the first principal's login
username, defaulting to `admin`; administrators can also give other users a
username when creating their account.

Staff sign in at `/login` and land on `/app`; students and parents land on the
family portal at `/portal`.

---

## What is included

### Public website (`/`)
- Hero, highlight counters, about section, news/events grid, contact details.
- Admissions enquiry form (`POST /api/public/admissions/inquiry`) and contact
  form (`POST /api/public/contact`), both rate limited.
- Published CMS pages at `/p/:slug`; navigation driven by the `website_pages` table.
- Fully editable from **Website & CMS** (`/app/website`): hero copy and image,
  counters, about text, pages, news posts, enquiries and contact messages.

### ERP modules
| Module | Route | Highlights |
|---|---|---|
| Dashboard | `/app` | Role-aware KPIs, attendance/collection charts, quick actions, today's timetable |
| Students | `/app/students` | Search/filter, admissions form, bulk import + template, credentials, parent linking, documents, status changes, transport |
| Student profile | `/app/students/:id` | 360° view: attendance, results, invoices, payments, guardians, history |
| Attendance | `/app/attendance` | Class grid with bulk marking, employee attendance, summaries, PDF reports |
| Examinations | `/app/exams` | Exam setup, subject schedules, marks entry, finalize/publish, recalculation |
| Exam detail | `/app/exams/:id` | Progress tracker, per-subject marks, lifecycle actions |
| Results | `/app/results` | Result browser with stats, grade distribution, report cards, remarks |
| Timetable | `/app/timetable` | Weekly grid editor per class/section, teacher clash awareness |
| Homework | `/app/homework` | Assignments, submissions and grading, study materials |
| Classes & Subjects | `/app/academics` | Classes, sections, subjects, sessions, holidays, period settings, assignments |
| Fees & billing | `/app/fees` | Structures, invoice generation, collection, expenses, defaulters, refunds |
| Invoice detail | `/app/fees/invoices/:id` | Line items, payments, receipts, cancel with reason, late fees |
| Payroll | `/app/payroll` | Monthly generation, adjustments, payment marking, export |
| Teachers & staff | `/app/employees` | Directory, profiles, leave approvals, payroll snapshot, export |
| Users & roles | `/app/users` | Accounts, temp passwords, per-user overrides, role editor |
| Library | `/app/library` | Catalogue, issues/returns, fines, overdue tracking, export |
| Transport | `/app/transport` | Fleet, routes and stops, allocations, maintenance, bus attendance |
| Communication | `/app/communication` | Announcements (email/SMS fan-out), direct messages, notifications |
| Reports | `/app/reports` | 16 report types with on-screen preview and CSV/PDF export |
| Website & CMS | `/app/website` | Content, pages, news, admission enquiries, contact messages |
| Settings | `/app/settings` | School profile, branding/theme, academic/fees/exam/library rules, security, integrations, backups, audit log, API keys, system info |

The parent/student portal (`/portal`) shows overview, attendance, timetable,
homework, results, report cards and fee payment (online via Razorpay when
configured).

---

## Architecture

```
server/
  index.js          HTTP listener + graceful shutdown
  app.js            Express wiring: helmet, compression, JSON, cookies, routers, SPA fallback
  env.js            tiny .env loader
  db/
    schema.sql      68-table multi-tenant schema
    index.js        node:sqlite wrapper (db, migrate, transaction, newId, settings)
    reset.js        drop & recreate
    seed-demo.js    deterministic demo school
  lib/              permissions, auth, audit, validation, exports, uploads, PDF,
                    fees maths, integrations (SMTP/SMS/Razorpay), notifications, scheduler
  routes/           20 feature routers mounted under /api
  tests/api.test.js 29 end-to-end API tests
client/
  src/
    main.jsx  App.jsx  store.jsx  api.js  nav.js  styles.css
    layout/AppShell.jsx        sidebar + topbar shell
    ui/                        design-system primitives (buttons, tables, modals…)
    lib/academic.js            academic helpers/hooks
    pages/                     one file per screen
```

**Multi-tenancy** — every table carries `school_id` and every query scopes by the
session's school. **Auth** — scrypt password hashes, `sm_sid` HTTP-only session
cookie, optional TOTP, lockout after repeated failures, revocable sessions.
**RBAC** — permissions are `module.action` strings; the principal bypasses checks,
and per-user allow/deny overrides sit on top of role defaults.

---

## Scripts

| Command | Purpose |
|---|---|
| `npm start` | Start the server (serves `client/dist` when built) |
| `npm run dev` | API with `--watch` + Vite dev server |
| `npm run build` | Production build of the React app |
| `npm run build:netlify` | Build the SPA and generate `client/dist/_redirects` from `API_ORIGIN` |
| `npm run serve` | Build then start |
| `npm run db:reset -- --yes` | Delete and recreate the database |
| `npm run seed:demo -- --force` | Seed/refresh the demo school |
| `npm run test:api` | Run the API test suite against `http://127.0.0.1:3001` |

`npm run test:api` expects a running server with the demo data seeded
(`API_BASE` overrides the default URL).

---

## Configuration

Configuration is read from environment variables and an optional `.env` at the
repository root:

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `3001` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `DATA_DIR` | `./data` | SQLite file, uploads, backups |
| `SESSION_SECRET` | generated | Session signing secret |

School-level configuration (SMTP, SMS, Razorpay, password policy, theme, report
card and invoice templates, payment settings) lives in the database and is edited
in **Settings**; secrets are masked in API responses and preserved on round-trip.

Backups use SQLite `VACUUM INTO` and can be downloaded, restored (principal only,
with a safety snapshot first) or scheduled. `POST /api/settings/maintenance/retention`
purges audit/login history and expired sessions according to the retention policy.

---

## Testing & verification

- `npm run test:api` — 29 API tests covering auth/RBAC, setup, students,
  attendance, exams and results, fees, library, homework, transport, reports,
  settings and the parent portal.
- The SPA builds with `npm run build` and all routes are served by the Express
  fallback, so deep links such as `/app/fees/invoices/:id` work after a refresh.
- Uploaded branding/website assets are public under `/uploads/branding` and
  `/uploads/website`; all other uploads require a session.

## License

ISC.
