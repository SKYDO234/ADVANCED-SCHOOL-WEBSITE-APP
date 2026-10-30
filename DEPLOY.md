# Deploying the front-end on Netlify

Netlify hosts the **React single-page app** (public school website + ERP UI).
The API needs a persistent Node process and a writable SQLite file, so it runs on
a normal Node host (Render, Railway, Fly.io, a VPS, or Docker) while Netlify
serves the static build and proxies `/api` and `/uploads` to it.

```
Browser ──► https://school.netlify.app      (static SPA, Netlify CDN)
                │  /api/*, /uploads/*  (proxy rewrite)
                ▼
            https://school-api.onrender.com  (Express + SQLite + uploads volume)
```

Proxy mode keeps everything same-origin, so the session cookie keeps working in
every browser (including Safari). Set a token of your choice and Netlify will
generate the rewrite rules at build time.

---

## 1. Deploy the API somewhere with a disk

Any of these work — the app only needs Node 22+, one open port and a persistent
directory for `data/`.

### Option A — Docker (Fly.io, Railway, Render, VPS)

A ready-made multi-stage `Dockerfile` is in the repository root:

```bash
docker build -t school-erp .
docker run -p 3001:3001 \
  -v school_data:/app/data \
  -e NODE_ENV=production \
  -e PORT=3001 \
  school-erp
```

The container stores the database, uploads and backups in `/app/data` — mount a
volume there (Fly: `fly volumes create`, Railway: add a volume at `/app/data`,
Render: add a disk at `/app/data`).

First boot on an empty volume shows the setup wizard. To load the demo school
instead:

```bash
docker exec -it <container> npm run seed:demo -- --force
```

### Option B — Render / Railway without Docker

- **Build command:** `npm install --ignore-scripts && npm run build`
- **Start command:** `npm start`
- **Health check:** `/api/setup/status`
- **Disk:** mount a persistent disk at `/app/data` (adjust the path to your
  working directory if the platform differs, or set `DATA_DIR`).

`npm install --ignore-scripts` avoids native-script builds for nodemailer; the
database uses Node's built-in `node:sqlite`, so nothing compiles native code.

### Serve the SPA from the API too (single-host alternative)

The Express server already serves `client/dist` with SPA fallback. If you prefer
one host only, build the client on the API host (`npm run build`) and skip
Netlify entirely — the app works at `https://api-host/`.

---

## 2. Deploy the SPA to Netlify

### Git-connected site (recommended)

1. In Netlify: **Add new site → Import an existing project** and pick this repo.
2. Netlify reads `netlify.toml`:
   - **Build command:** `npm --prefix client ci --no-audit --no-fund && npm run build:netlify`
   - **Publish directory:** `client/dist`
   - **Node version:** 22
3. Add an environment variable:

   | Variable | Value | Example |
   |---|---|---|
   | `API_ORIGIN` | Public origin of the API **without** trailing slash | `https://school-api.onrender.com` |

   Optional: `VITE_API_BASE` if you deliberately want the browser to call the API
   cross-origin instead of using the proxy (then also set `CORS_ORIGINS` and
   `CROSS_SITE_COOKIES=1` on the API — see "Direct API mode" below).
4. Deploy. `npm run build:netlify` builds the SPA and writes
   `client/dist/_redirects`:

   ```
   /api/*      https://school-api.onrender.com/api/:splat      200
   /uploads/*  https://school-api.onrender.com/uploads/:splat  200
   /*          /index.html                                     200
   ```

   The first rule proxies API calls, the second proxies uploaded logos and
   documents, the third makes deep links such as `/app/fees/invoices/:id` work on
   refresh.

### Netlify CLI

```bash
npm run build:netlify                      # with API_ORIGIN exported
npx netlify deploy --prod --dir client/dist
```

### Drag-and-drop

```bash
API_ORIGIN=https://school-api.onrender.com npm run build:netlify
# then drag client/dist onto https://app.netlify.com/drop
```

---

## 3. Environment reference

### Netlify (build time)

| Variable | Required | Purpose |
|---|---|---|
| `API_ORIGIN` | Yes (proxy mode) | API origin used to generate `_redirects` proxy rules |
| `VITE_API_BASE` | No | Absolute API base baked into the bundle; bypasses the proxy |
| `NODE_VERSION` | No | Defaults to 22 in `netlify.toml` |

### API host (runtime)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3001` | Listen port (many hosts inject this) |
| `HOST` | `0.0.0.0` | Bind address |
| `DATA_DIR` | `./data` | SQLite database, uploads and backups live here — **must be persistent** |
| `DB_FILE` / `UPLOAD_DIR` | derived | Override individual paths |
| `NODE_ENV` | — | `production` enables secure cookies |
| `INSECURE_COOKIES` | — | Set to `1` only if you run production over plain HTTP (e.g. inside a private network) |
| `CORS_ORIGINS` | — | Comma-separated trusted origins, or `*`; only needed for direct API mode |
| `CROSS_SITE_COOKIES` | — | Set to `1` for direct API mode so the session cookie uses `SameSite=None; Secure` |
| `COOKIE_SAMESITE` / `COOKIE_SECURE` | — | Fine-grained cookie overrides |

---

## 4. Direct API mode (no proxy)

If you would rather have the browser talk straight to the API host:

1. Netlify build variable: `VITE_API_BASE=https://school-api.onrender.com`
2. API host variables:
   ```
   CORS_ORIGINS=https://your-site.netlify.app
   CROSS_SITE_COOKIES=1
   NODE_ENV=production
   ```
3. Keep the API on HTTPS — `SameSite=None` cookies are rejected over HTTP.

Trade-offs: third-party-cookie blocking can break sign-in in Safari/private
browsing; the proxy mode avoids this entirely and is the recommended setup.

---

## 5. Post-deploy checklist

- `https://your-site.netlify.app/` — public website with hero, news and forms.
- `https://your-site.netlify.app/login` — sign in with `admin` / `admin123`
  (demo data) or with the principal username/password you chose in the setup
  wizard (the username defaults to `admin`).
- Submit the admissions form, then check **Website & CMS → Admissions**.
- Upload a logo in **Settings → School profile** (files are served through the
  `/uploads` proxy rule).
- Open an invoice detail page and download its PDF (verifies proxied downloads).
- Add the custom domain in Netlify → Domain management; Point DNS as instructed.
  Update `CORS_ORIGINS` only if you use direct API mode.

### Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `404` on `/api/...` right after deploy | `API_ORIGIN` missing during build | Set it, trigger a new deploy, confirm `_redirects` in the deploy log |
| Deep link shows Netlify 404 | `_redirects` absent | Ensure `npm run build:netlify` ran (not `vite build` alone) |
| Sign-in succeeds then immediately 401 | API on a different origin without cookies | Use proxy mode, or set `CROSS_SITE_COOKIES=1` + `CORS_ORIGINS` |
| Logos/images broken | `/uploads` not proxied | Keep the generated `/uploads/*` rule |
| Data disappears after restart | `data/` not on a persistent disk | Mount a volume and point `DATA_DIR` at it |
| `Cannot find module 'node:sqlite'` | Node < 22.5 | Use Node 22+ on the API host |
