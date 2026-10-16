require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const AWS = require('aws-sdk');
const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const xlsx = require('xlsx');
const { parse: csvParse } = require('csv-parse/sync');

const app = express();

// ===== MULTI-TENANCY: per-request company (workspace) scoping engine =====
// Every request runs inside an AsyncLocalStorage carrying the logged-in user's
// workspace. A Prisma client extension then auto-filters reads and stamps writes
// for tenant models, so company data can never cross between workspaces — even
// if an endpoint forgets to scope manually. Children (questions, comments, etc.)
// are reached only via their scoped parents and guarded at those endpoints.
const { AsyncLocalStorage } = require('async_hooks');
const wsStore = new AsyncLocalStorage();
const currentWs = () => { const s = wsStore.getStore(); return s && s.ws ? s.ws : null; };
const TENANT_MODELS = new Set([
  'User', 'Project', 'LedgerEntry', 'ExpenseCategory', 'DailyLog', 'PunchItem', 'Subscription', 'BillingInvoice',
  'ChangeOrder', 'ChangeOrderActivity', 'Commitment', 'Document', 'Bid', 'BidPackage', 'Invoice', 'Inspection', 'SafetyIncident',
  'Equipment', 'ChecklistTemplate', 'Checklist', 'Drawing', 'DrawingVersion', 'PlanMarkup', 'ScheduledReport', 'Attendance',
  'Observation', 'CoordinationIssue', 'ActionPlan', 'Correspondence', 'ScheduleItem', 'Crew',
  'DirectoryContact', 'CompanyDoc', 'Announcement', 'FormTemplate', 'Conversation',
  'PaymentApplication', 'RetentionRecord', 'CostCode', 'Approval',
  'InventoryItem', 'InventoryMovement',
  'BoqRevision', 'RateLibraryItem', 'Quote', 'Selection', 'AiDesign',
]);
const prismaBase = new PrismaClient();
const delegateOf = (m) => prismaBase[m.charAt(0).toLowerCase() + m.slice(1)];
const prisma = prismaBase.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const ws = currentWs();
        if (!ws || !TENANT_MODELS.has(model)) return query(args);
        if (['findMany', 'findFirst', 'findFirstOrThrow', 'count', 'aggregate', 'groupBy', 'updateMany', 'deleteMany'].includes(operation)) {
          args.where = { ...(args.where || {}), workspaceId: ws };
          return query(args);
        }
        if (operation === 'findUnique' || operation === 'findUniqueOrThrow') {
          const r = await query(args);
          if (r && r.workspaceId && r.workspaceId !== ws) { if (operation === 'findUniqueOrThrow') throw new Error('Not found'); return null; }
          return r;
        }
        if (operation === 'create') { args.data = { ...args.data, workspaceId: ws }; return query(args); }
        if (operation === 'createMany') { if (Array.isArray(args.data)) args.data = args.data.map((d) => ({ ...d, workspaceId: ws })); return query(args); }
        if (operation === 'update' || operation === 'delete') {
          const owned = await delegateOf(model).findFirst({ where: { ...(args.where || {}), workspaceId: ws }, select: { id: true } });
          if (!owned) throw new Error('Record not found in this workspace');
          return query(args);
        }
        if (operation === 'upsert') { args.create = { ...args.create, workspaceId: ws }; return query(args); }
        return query(args);
      },
    },
  },
});
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const path = require('path');
// Where locally-uploaded files are written. A relative path resolves against the
// process CWD — which on a container is part of the image and is wiped on every
// deploy, taking every uploaded plan, drawing and photo with it. In production
// point UPLOAD_DIR at a mounted volume (e.g. /data/uploads), or configure
// S3_BUCKET so uploads go to object storage and never touch the container disk.
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || 'uploads');
// Keep the original file extension so the static server sends the right
// Content-Type (otherwise images upload but won't render in the browser).
// Multer creates the directory itself when destination is a plain string.
const uploadStorage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${path.extname(file.originalname || '')}`),
});
// Cap the request size explicitly. Without a limit multer accepts anything, and
// a phone photo burst or a 300MB drawing set would be accepted, buffered, and
// then die halfway with a socket error the browser reports only as "network
// error". A stated limit produces a clear, actionable message instead.
// 25 MB, matching the client-side cap (see useFileUpload.ts). Photos are
// downscaled in the browser, so this is really a ceiling for PDFs and drawings.
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 25);
const upload = multer({ storage: uploadStorage, limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 25 } });
// Multer reports storage failures (read-only filesystem, disk full, bad path) to
// the Express error handler, which answers with an HTML page — so the browser
// could only ever show a generic "Upload failed". Wrap it to return the real
// reason as JSON, and log it, so a broken upload is diagnosable from the client.
const multerMessage = (err) => {
  if (!err) return 'Upload failed';
  if (err.code === 'LIMIT_FILE_SIZE') return `That file is larger than the ${MAX_UPLOAD_MB}MB limit`;
  if (err.code === 'LIMIT_FILE_COUNT') return 'Too many files in one request — upload them in smaller batches';
  if (err.code === 'LIMIT_UNEXPECTED_FILE') return `Unexpected form field "${err.field}" — expected the file under "file"`;
  if (err.code === 'ENOENT' || err.code === 'EACCES' || err.code === 'EROFS') {
    return `The server cannot write to its upload directory (${UPLOAD_DIR}). Configure S3_BUCKET or point UPLOAD_DIR at a writable volume.`;
  }
  return err.message || 'Upload failed';
};
const singleFile = (field) => (req, res, next) => upload.single(field)(req, res, (err) => {
  if (err) {
    console.error(`[upload] ${field} failed:`, (err && (err.stack || err.message)) || err);
    return res.status(400).json({ error: multerMessage(err) });
  }
  return next();
});
// Same wrapper for batch uploads. `file` is accepted as well as `files` so a
// single endpoint serves both the one-at-a-time and the multi-select callers.
const manyFiles = (field) => (req, res, next) => upload.array(field, 25)(req, res, (err) => {
  if (err) {
    console.error(`[upload] ${field}[] failed:`, (err && (err.stack || err.message)) || err);
    return res.status(400).json({ error: multerMessage(err) });
  }
  return next();
});
const AUTH_REQUIRED = process.env.AUTH_REQUIRED === 'true';

// Email (Resend) — optional. With no key, links/passwords are logged to the
// console so local development works without sending real mail. 🔌 Add the key
// in production to actually deliver invite & password-reset emails.
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const EMAIL_FROM = process.env.EMAIL_FROM || 'Buildsasa <onboarding@resend.dev>';
const APP_URL = (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '');

const s3 = process.env.S3_BUCKET
  ? new AWS.S3({
      region: process.env.AWS_REGION,
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      signatureVersion: 'v4',
      // Cloudflare R2, Backblaze B2 and other S3-compatible stores need a custom
      // endpoint. Path-style addressing is what those providers expect.
      ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT, s3ForcePathStyle: true } : {}),
    })
  : null;

// The public URL a stored object is readable at. Order matters:
//   1. S3_PUBLIC_BASE — an explicit CDN or custom domain, always wins.
//   2. A custom endpoint (B2, R2, MinIO) — path-style, matching s3ForcePathStyle.
//   3. Real AWS — virtual-hosted style.
// Case 2 previously fell through to the AWS pattern, so a Backblaze or R2 upload
// was recorded as an amazonaws.com link that could never load. Any file stored
// while that was live has a broken URL in the database.
const publicUrlFor = (key) => {
  if (process.env.S3_PUBLIC_BASE) return `${process.env.S3_PUBLIC_BASE.replace(/\/$/, '')}/${key}`;
  if (process.env.S3_ENDPOINT) return `${process.env.S3_ENDPOINT.replace(/\/$/, '')}/${process.env.S3_BUCKET}/${key}`;
  return `https://${process.env.S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
};
const storageKeyFor = (filename) => `${process.env.S3_UPLOAD_PREFIX || 'uploads/'}${Date.now()}-${String(filename || 'file').replace(/[^\w.\-]/g, '_')}`;

// CORS — comma-separated ALLOWED_ORIGINS env var restricts browser access to
// the listed frontends. When unset, all origins are allowed (dev fallback).
const ALLOWED_ORIGINS = String(process.env.ALLOWED_ORIGINS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);
if (ALLOWED_ORIGINS.length) {
  app.use(cors({
    origin: (origin, cb) => {
      // No Origin header = non-browser client (curl, server-to-server) — allow.
      if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
  }));
} else {
  console.warn('[cors] ALLOWED_ORIGINS not set — allowing all origins (fine for dev, set it in production)');
  app.use(cors());
}
app.use(express.json());
// Plain-English errors. Hundreds of routes answer failures with
// `res.status(500).json({ error: e.message })`, which put raw database text —
// "Invalid `prisma.user.create()` invocation … Unique constraint failed on the
// fields: (`email`)" — in front of users. Rather than touch every route, every
// JSON error leaving the API passes through here: known database failures get a
// specific, actionable message (and the right status), anything else technical
// becomes a calm generic one, and the original is logged for us.
const FIELD_NAMES = {
  email: 'email address', code: 'project code', invoiceNumber: 'invoice number', quoteNumber: 'quote number',
  number: 'number', publicToken: 'link', portalToken: 'link', name: 'name', phone: 'phone number',
};
const TECHNICAL = /prisma|invocation|constraint|ECONN|ETIMEDOUT|ENOTFOUND|socket hang up|Cannot read prop|is not a function|is not defined|undefined|Unexpected token|SQL|relation "|column "|violates|Argument `|PrismaClient|stack|at \w+ \(/i;
function friendlyError(message) {
  const msg = String(message || '');
  const unique = msg.match(/Unique constraint failed on the (?:fields|constraint): \(?`?([\w,` ]+?)`?\)?$/m) || msg.match(/Unique constraint failed on the fields: \(`(\w+)`/);
  if (unique) {
    const field = unique[1].split(',')[0].replace(/[`\s]/g, '').replace(/^\w+_(\w+)_key$/, '$1');
    const label = FIELD_NAMES[field] || field.replace(/([A-Z])/g, ' $1').toLowerCase();
    return { status: 409, error: `That ${label} is already in use. Please use a different one.` };
  }
  if (/Record to (update|delete) does not exist|No record was found|Record not found|not found in this workspace|P2025/i.test(msg)) {
    return { status: 404, error: 'This item no longer exists. It may have been deleted by someone else. Refresh the page and try again.' };
  }
  if (/Foreign key constraint|P2003/i.test(msg)) {
    return { status: 409, error: 'This item is linked to other records, so it can\'t be changed or removed yet. Remove those links first.' };
  }
  if (/Invalid `prisma\.\w+\.\w+\(\)` invocation[\s\S]*(Argument|Unknown arg|Expected|Invalid value)/i.test(msg)) {
    return { status: 400, error: 'Some of the details entered aren\'t valid. Check the form and try again.' };
  }
  if (/Can't reach database|ECONNREFUSED|P1001|P1002|timed out/i.test(msg)) {
    return { status: 503, error: 'We couldn\'t reach the server just now. Please try again in a moment.' };
  }
  if (TECHNICAL.test(msg) || msg.length > 240) {
    return { status: null, error: 'Something went wrong on our side. Please try again. If it keeps happening, contact support on WhatsApp +254 782 223 749.' };
  }
  return null;
}
app.use((req, res, next) => {
  const json = res.json.bind(res);
  res.json = (body) => {
    if (body && typeof body === 'object' && typeof body.error === 'string' && (res.statusCode >= 400 || TECHNICAL.test(body.error))) {
      const f = friendlyError(body.error);
      if (f) {
        console.error(`[api error] ${req.method} ${req.originalUrl} → ${body.error.slice(0, 500)}`);
        if (f.status && res.statusCode >= 500) res.status(f.status);
        body = { ...body, error: f.error };
      }
    }
    return json(body);
  };
  next();
});
// Serve locally-uploaded files (used when S3/R2 is not configured).
// crossOriginResourcePolicy is relaxed because the frontend is served from a
// different origin than the API — without it some browsers refuse to paint the
// image and the upload looks like it failed. A long immutable cache is safe:
// stored filenames are unique per upload and never rewritten.
app.use('/uploads', express.static(UPLOAD_DIR, {
  maxAge: '365d',
  immutable: true,
  setHeaders: (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  },
}));
// Make sure the directory exists at boot rather than at first upload, so a
// misconfigured/read-only volume is reported in the deploy logs instead of
// surfacing later as a mysterious failed upload.
try {
  require('fs').mkdirSync(UPLOAD_DIR, { recursive: true });
} catch (e) {
  console.error(`[upload] CANNOT CREATE upload dir ${UPLOAD_DIR}:`, (e && e.message) || e);
}
// Say plainly at boot where uploads land — this is the first thing worth knowing
// when files upload "successfully" but later cannot be found.
if (s3) {
  console.log(`[upload] object storage -> bucket ${process.env.S3_BUCKET}${process.env.S3_ENDPOINT ? ` @ ${process.env.S3_ENDPOINT}` : ' @ AWS'} · public URLs like ${publicUrlFor('<key>')}`);
} else {
  console.log(`[upload] local disk -> ${UPLOAD_DIR}${process.env.UPLOAD_DIR ? '' : ' (EPHEMERAL — wiped on every deploy; set UPLOAD_DIR to a mounted volume or configure S3_BUCKET)'}`);
}

// In-memory user stub (replace with real users)
// Safety net: never let one failed request crash the whole backend.
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', (e && e.message) || e));
process.on('uncaughtException', (e) => console.error('[uncaughtException]', (e && e.message) || e));

const demoUser = {
  id: 'user-1',
  email: 'manager@example.com',
  name: 'Site Manager',
  role: 'Contractor',
  passwordHash: bcrypt.hashSync('password', 8),
};

const CAN_GENERATE_CHECKLISTS = ['Contractor', 'Executive', 'Project Manager', 'Superintendent'];
const CAN_ASSIGN_TASKS = ['Contractor', 'Executive', 'Project Manager', 'Superintendent', 'Trade Lead'];
const CAN_VIEW_CHECKLISTS = ['Contractor', 'Executive', 'Project Manager', 'Superintendent', 'Architect', 'Quantity Surveyor', 'Owner'];
const CAN_FILL_CHECKLISTS = ['Contractor', 'Executive', 'Project Manager', 'Superintendent', 'Trade Lead', 'Worker'];

function requireRole(allowedRoles) {
  return (req, res, next) => {
    const userRole = req.user?.role || demoUser.role;
    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({ error: `Forbidden: ${userRole} does not have permission for this action` });
    }
    next();
  };
}

// Auth middleware. If AUTH_REQUIRED is false, defaults to demo user when no/invalid token.
// Client accounts (homeowners, landowners) have no workspace. With no workspace
// the tenant extension does not scope queries at all, so a client token must
// never reach a workspace route: only these prefixes are open to them, and every
// handler under them checks ownership explicitly (src/client-routes.js).
const CLIENT_ALLOWED = ['/api/client/', '/api/me', '/api/upload', '/api/auth/', '/api/public/'];
function auth(req, res, next) {
  // Run the rest of the request inside the workspace context so the Prisma
  // engine scopes every query to this user's company.
  const run = () => {
    if (req.user && req.user.role === 'Client') {
      const p = String(req.originalUrl || req.url || '').split('?')[0];
      if (!CLIENT_ALLOWED.some((a) => p === a.replace(/\/$/, '') || p.startsWith(a))) return res.status(403).json({ error: 'This page is for company accounts. You are signed in as a client.' });
    }
    return wsStore.run({ ws: (req.user && req.user.ws) || null }, next);
  };
  const header = req.headers.authorization;
  if (header) {
    const token = header.replace('Bearer ', '');
    try {
      req.user = jwt.verify(token, JWT_SECRET);
      return run();
    } catch (e) {
      if (AUTH_REQUIRED) return res.status(401).json({ error: 'Invalid token' });
    }
  }
  if (!AUTH_REQUIRED) {
    req.user = { id: demoUser.id, sub: demoUser.id, role: demoUser.role, name: demoUser.name };
    return run();
  }
  return res.status(401).json({ error: 'Missing auth token' });
}

// Login stub
const ACCESS_TTL = process.env.ACCESS_TTL || '2h';
const REFRESH_TTL = process.env.REFRESH_TTL || '30d';
const issueToken = (u) => jwt.sign({ sub: u.id, role: u.role, name: u.name, email: u.email, ws: u.workspaceId || null }, JWT_SECRET, { expiresIn: ACCESS_TTL });
const issueRefreshToken = (u) => jwt.sign({ sub: u.id, type: 'refresh' }, JWT_SECRET, { expiresIn: REFRESH_TTL });
const authTokens = (u) => ({ token: issueToken(u), refreshToken: issueRefreshToken(u) });
// ===== PLATFORM STAFF (Buildsasa side, not customer workspace roles) =====
// Only these emails may perform billing overrides such as manually marking a
// subscription invoice as paid (e.g. for an offline bank transfer). Set via the
// PLATFORM_ADMIN_EMAILS env var, comma-separated. A customer being the "owner"
// of their own workspace does NOT make them platform staff.
// The founding staff accounts are baked in so a deploy can never lock us out of
// the admin panel — or start charging us — because an env var was missed on the
// host. PLATFORM_ADMIN_EMAILS adds to this list, it does not replace it.
const BUILTIN_PLATFORM_ADMINS = [
  'samuelnjugunanyagikuyu2021@gmail.com',
  'denniskasuku@gmail.com',
  'williamkeisy39@gmail.com',
];
const PLATFORM_ADMIN_EMAILS = [...new Set([
  ...BUILTIN_PLATFORM_ADMINS,
  ...String(process.env.PLATFORM_ADMIN_EMAILS || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
])];

// ===== FREE / COMPED ACCESS =====
// Emails listed here always bypass the subscription paywall — they use the
// product for free, without ever paying or subscribing. Set via the
// FREE_ACCESS_EMAILS env var, comma-separated (e.g. "vip@acme.com,dev@x.io").
// Platform admins are comped automatically; see hasFreeAccess below.
const FREE_ACCESS_EMAILS = String(process.env.FREE_ACCESS_EMAILS || '')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

// DB-managed admins (added from the panel) are cached in memory so
// isPlatformAdmin can stay synchronous — it runs on every login and admin
// request. Loaded at startup, refreshed whenever an admin is added/removed, and
// re-synced on a timer so a change on one instance reaches the others.
const dbAdminEmails = new Set();
async function refreshDbAdmins() {
  try {
    const rows = await prismaBase.platformAdmin.findMany({ select: { email: true } });
    dbAdminEmails.clear();
    for (const r of rows) dbAdminEmails.add(String(r.email).toLowerCase());
  } catch (e) {
    console.error('[ADMIN] refresh DB admins failed:', e && e.message);
  }
}
refreshDbAdmins();
setInterval(refreshDbAdmins, 60 * 1000).unref();

// Built-in and env-var admins are the immutable "root" set — they cannot be
// removed from the panel, which guarantees there is always a way back in.
const isRootAdmin = (email) => !!email && PLATFORM_ADMIN_EMAILS.includes(String(email).toLowerCase());
const isPlatformAdmin = (email) => {
  const e = String(email || '').toLowerCase();
  return !!e && (PLATFORM_ADMIN_EMAILS.includes(e) || dbAdminEmails.has(e));
};

// Platform staff never pay for the product they run: every admin — built-in,
// env-listed, or added later from the admin panel — is comped, on top of anyone
// explicitly listed in FREE_ACCESS_EMAILS. Defined after isPlatformAdmin so the
// dependency reads in order; both are only ever called per-request.
const hasFreeAccess = (email) => {
  const e = String(email || '').toLowerCase();
  return !!e && (FREE_ACCESS_EMAILS.includes(e) || isPlatformAdmin(e));
};

const publicUser = (u) => ({ id: u.id, name: u.name, role: u.role, email: u.email, platformAdmin: isPlatformAdmin(u.email), freeAccess: hasFreeAccess(u.email), isClient: u.role === 'Client' });
// Filled in when client-routes mounts (it needs helpers defined further down).
const clientRouteDeps = {};

// ===== GOOGLE OAUTH (Sign in with Google) =====
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL || '';
const FRONTEND_URL = process.env.APP_URL || 'http://localhost:5173';

// Step 1 — send the user to Google's consent screen.
app.get('/api/auth/google', (req, res) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CALLBACK_URL) return res.redirect(`${FRONTEND_URL}/?auth_error=google_not_configured`);
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_CALLBACK_URL,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'online',
    prompt: 'select_account',
  });
  res.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + params.toString());
});

// Single-use OAuth handoff codes: code -> { expires, payload }. In memory, like
// the rate limiter, which is fine for a single instance; move it to Redis before
// running more than one. Entries are deleted on first read and swept on expiry.
const OAUTH_HANDOFFS = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of OAUTH_HANDOFFS) if (v.expires < now) OAUTH_HANDOFFS.delete(k);
}, 60_000).unref();

// Step 2 — Google redirects back here with a code; exchange it, find/create the
// user (linked by email), issue our own session token, and bounce to the frontend.
app.get('/api/auth/google/callback', async (req, res) => {
  try {
    const code = req.query.code;
    if (!code) return res.redirect(`${FRONTEND_URL}/?auth_error=google`);
    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, redirect_uri: GOOGLE_CALLBACK_URL, grant_type: 'authorization_code' }),
    });
    const tokenJson = await tokenResp.json();
    if (!tokenJson.access_token) throw new Error(tokenJson.error_description || 'Token exchange failed');
    const profResp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${tokenJson.access_token}` } });
    const profile = await profResp.json();
    const email = String(profile.email || '').toLowerCase();
    if (!email) throw new Error('No email returned from Google');
    // Link by email: existing account logs in; new one is created with a default role.
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      // Multi-tenant: a new Google account creates its own isolated company.
      const gws = await prisma.workspace.create({ data: { name: `${profile.name || email.split('@')[0]}'s company` } });
      user = await prisma.user.create({ data: { email, name: profile.name || email.split('@')[0], role: 'Contractor', avatar: profile.picture || null, workspaceId: gws.id } });
    } else if (!user.avatar && profile.picture) {
      try { user = await prisma.user.update({ where: { id: user.id }, data: { avatar: profile.picture } }); } catch { /* ignore */ }
    }
    recordAccess(req, user);
    // Hand the session over via a single-use code, NOT the tokens themselves.
    // Putting a JWT and its refresh token in the redirect URL writes both into
    // browser history, into the Referer header of anything the landing page
    // loads, and into every proxy and server access log along the way — and the
    // back button walks straight back onto them. The code below is worthless
    // sixty seconds later and worthless twice.
    const handoff = crypto.randomBytes(32).toString('hex');
    OAUTH_HANDOFFS.set(handoff, {
      expires: Date.now() + 60_000,
      payload: { token: issueToken(user), refreshToken: issueRefreshToken(user), user: publicUser(user) },
    });
    res.redirect(`${FRONTEND_URL}/?handoff=${handoff}`);
  } catch (e) {
    console.error('[google oauth] failed:', e.message);
    res.redirect(`${FRONTEND_URL}/?auth_error=google`);
  }
});

// Step 3 — the frontend trades the one-time code for the actual session. POST so
// the code never lands in a URL, and it is consumed on first use: a replayed
// code (from history, a log, or a shared link) gets nothing.
app.post('/api/auth/google/exchange', (req, res) => {
  const code = String((req.body && req.body.handoff) || '');
  const entry = code && OAUTH_HANDOFFS.get(code);
  if (!entry) return res.status(400).json({ error: 'This sign-in link has already been used or has expired. Please sign in again.' });
  OAUTH_HANDOFFS.delete(code);
  if (entry.expires < Date.now()) return res.status(400).json({ error: 'This sign-in link has expired. Please sign in again.' });
  res.json(entry.payload);
});

// Send transactional email via Resend. Falls back to console logging (and
// returns sent:false) when no API key is configured, so dev never blocks.
// RFC 2606 reserves these for documentation and testing, so they can never
// receive mail. Seeded demo accounts carry such addresses and Resend rejects the
// request outright (422), which fills the log with what look like real delivery
// failures. Skip them instead of spending an API call to be told no.
function isUndeliverableAddress(addr) {
  const domain = String(addr || '').split('@')[1];
  if (!domain || !String(addr).includes('@')) return true;
  const d = domain.toLowerCase();
  return /(^|\.)example\.(com|net|org|edu)$/.test(d) || /\.(test|invalid|localhost|example)$/.test(d);
}

async function sendEmail({ to, subject, html, attachments }) {
  if (isUndeliverableAddress(to)) {
    console.log(`[EMAIL] skipped — "${to}" is a reserved/undeliverable test address | ${subject}`);
    return { sent: false, skipped: true };
  }
  if (!RESEND_API_KEY) {
    console.log(`[EMAIL] (no RESEND_API_KEY — not sent) To: ${to} | ${subject}${attachments && attachments.length ? ` | ${attachments.length} attachment(s)` : ''}`);
    console.log('[EMAIL] body:', html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    return { sent: false, reason: 'not_configured' };
  }
  try {
    const payload = { from: EMAIL_FROM, to: [to], subject, html };
    if (attachments && attachments.length) payload.attachments = attachments;
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const t = await r.text();
      console.error('[EMAIL] Resend rejected the send:', r.status, t);
      // 403 from Resend almost always means the From domain is not verified, which
      // is the one failure people spend hours on. Name it.
      const hint = r.status === 403 && /domain/i.test(t)
        ? `Resend rejected "${EMAIL_FROM}" — verify that domain at resend.com/domains, or use onboarding@resend.dev while testing.`
        : `Resend returned ${r.status}.`;
      return { sent: false, reason: 'send_failed', error: hint };
    }
    return { sent: true };
  } catch (e) {
    console.error('[EMAIL] send error:', e && e.message);
    return { sent: false, reason: 'send_failed', error: e && e.message };
  }
}

// Is outbound email actually usable, and if not, what is missing? Surfaced to the
// UI so "share the password yourself" can say WHY instead of leaving the owner to
// guess whether it is a missing key, an unverified domain, or a silent failure.
function emailStatus() {
  const usingTestSender = /onboarding@resend.dev/i.test(EMAIL_FROM);
  return {
    configured: !!RESEND_API_KEY,
    from: EMAIL_FROM,
    // Resend's shared test sender only delivers to the address that owns the
    // Resend account. It looks configured and then quietly reaches nobody else.
    testSenderOnly: !!RESEND_API_KEY && usingTestSender,
    appUrl: APP_URL,
    missing: [
      !RESEND_API_KEY && 'RESEND_API_KEY',
      !process.env.EMAIL_FROM && 'EMAIL_FROM',
      !process.env.APP_URL && 'APP_URL',
    ].filter(Boolean),
  };
}

// Tiny on-brand email wrapper.
function emailShell(title, bodyHtml) {
  // The logo is a remote image, and most clients block those until the reader
  // allows them. The alt text is therefore the wordmark itself, styled in the
  // brand orange, so a blocked image degrades to "Buildsasa" in the right colour
  // rather than a broken-image icon.
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#11161D">
    <img src="${APP_URL}/Buildsasa.png" width="40" height="40" alt="Buildsasa"
         style="display:block;width:40px;height:40px;border:0;outline:none;text-decoration:none;font-size:18px;font-weight:600;color:#FF6B1A" />
    <div style="font-size:18px;font-weight:600;color:#FF6B1A;margin-top:8px">Buildsasa</div>
    <div style="font-size:12px;color:#8A95A5;margin-top:2px">Building tomorrow, empowered by AI</div>
    <h2 style="font-size:18px;margin:16px 0 8px">${title}</h2>
    ${bodyHtml}
    <p style="font-size:12px;color:#8A95A5;margin-top:24px;border-top:1px solid #E7EBF0;padding-top:12px">If you didn't expect this email, you can safely ignore it.</p>
  </div>`;
}

function button(href, label) {
  return `<a href="${href}" style="display:inline-block;background:#FF6B1A;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:14px;margin:12px 0">${label}</a>`;
}

// Platform admin panel + public marketing-site endpoints. Mounted here (rather
// than defined inline) to keep this file from growing further. It is handed
// prismaBase deliberately: admins work across every workspace, so they must not
// go through the tenant-scoping extension. See src/admin-routes.js.
require('./admin-routes')(app, { prismaBase, auth, isPlatformAdmin, isRootAdmin, refreshDbAdmins, platformAdminEnv: PLATFORM_ADMIN_EMAILS, bcrypt, sendEmail, emailShell });

// Email each assignee that work was assigned to them. Fire-and-forget so it
// never blocks the request; uses real user emails (assignment now uses real
// user ids). With no RESEND key set, sendEmail just logs to the console.
async function notifyAssignment(userIds, { subject, intro, link }) {
  try {
    let ids = userIds;
    if (typeof ids === 'string') { try { ids = JSON.parse(ids); } catch { ids = ids ? [ids] : []; } }
    if (!Array.isArray(ids) || ids.length === 0) return;
    const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { email: true, name: true } });
    for (const u of users) {
      if (!u.email) continue;
      const html = emailShell(subject, `<p style="font-size:14px;color:#11161D">Hi ${u.name || ''}, ${intro}</p>${link ? button(link, 'Open in Buildsasa') : ''}`);
      sendEmail({ to: u.email, subject, html }).catch(() => {});
    }
  } catch (e) { console.error('[NOTIFY] failed:', e && e.message); }
}

// Send an email-verification link to a user. Fire-and-forget; catches its own
// errors so it never blocks the request that triggered it.
async function sendVerifyEmail(user) {
  try {
    if (!user || !user.email) return;
    const token = jwt.sign({ sub: user.id, purpose: 'verify' }, JWT_SECRET, { expiresIn: '2d' });
    const link = `${FRONTEND_URL}/?verify=${encodeURIComponent(token)}`;
    const html = emailShell('Verify your email', `<p style="font-size:14px;color:#11161D">Hi ${user.name || ''}, welcome to Buildsasa. Please confirm your email address to secure your account.</p>${button(link, 'Verify email')}<p style="font-size:12px;color:#8A95A5">This link expires in 2 days.</p>`);
    sendEmail({ to: user.email, subject: 'Verify your Buildsasa email', html }).catch(() => {});
  } catch (e) { console.error('[VERIFY] failed:', e && e.message); }
}

// Record who signed in, when, from which IP — with best-effort geo lookup.
// Never blocks auth: failures are swallowed and geo runs in the background.
async function recordAccess(req, u) {
  try {
    const https2 = require('https');
    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || '';
    const ua = req.headers['user-agent'] || '';
    const log = await prisma.accessLog.create({ data: { userId: u.id, name: u.name, role: u.role, ip, userAgent: ua } });
    if (ip && !/^(127\.|::1|10\.|192\.168\.|172\.)/.test(ip)) {
      https2.get(`https://ipapi.co/${ip}/json/`, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => { try { const j = JSON.parse(d); prisma.accessLog.update({ where: { id: log.id }, data: { city: j.city || null, country: j.country_name || null } }).catch(() => {}); } catch { /* noop */ } }); }).on('error', () => {});
    }
  } catch (e) { /* logging must never break login */ }
}

app.get('/api/access-logs', auth, async (_req, res) => {
  try { res.json(await prisma.accessLog.findMany({ orderBy: { createdAt: 'desc' }, take: 100 })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/signup', async (req, res) => {
  try {
    const { name, email, password, role, company, accountType, phone, country } = req.body || {};
    if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required' });
    if (String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    const existing = await prisma.user.findUnique({ where: { email: String(email).toLowerCase() } });
    if (existing) return res.status(409).json({ error: 'An account with this email already exists' });
    // A client (homeowner, landowner, investor) gets an account with no company:
    // they follow sites contractors share with them and use Buildsasa services.
    if (accountType === 'client') {
      const user = await prismaBase.user.create({ data: {
        name: String(name).trim().slice(0, 120), email: String(email).toLowerCase(), passwordHash: bcrypt.hashSync(password, 10), role: 'Client', workspaceId: null,
        phone: phone ? String(phone).trim().slice(0, 40) : null, country: country ? String(country).trim().slice(0, 80) : null,
      } });
      if (clientRouteDeps.claimClientInvites) await clientRouteDeps.claimClientInvites(user);
      sendVerifyEmail(user);
      recordAccess(req, user); return res.json({ ...authTokens(user), user: publicUser(user) });
    }
    // Multi-tenant: each new signup creates its own isolated company (workspace) and owns it.
    const ws = await prisma.workspace.create({ data: { name: (company && String(company).trim()) || `${name}'s company` } });
    const user = await prisma.user.create({ data: { name, email: String(email).toLowerCase(), passwordHash: bcrypt.hashSync(password, 10), role: role || 'Contractor', workspaceId: ws.id } });
    sendVerifyEmail(user);
    recordAccess(req, user); res.json({ ...authTokens(user), user: publicUser(user) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Exchange a valid refresh token for a fresh access token (public — no auth).
app.post('/api/auth/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body || {};
    if (!refreshToken) return res.status(401).json({ error: 'Missing refresh token' });
    let payload;
    try { payload = jwt.verify(refreshToken, JWT_SECRET); } catch { return res.status(401).json({ error: 'Session expired' }); }
    if (payload.type !== 'refresh' || !payload.sub) return res.status(401).json({ error: 'Invalid refresh token' });
    const user = await prismaBase.user.findUnique({ where: { id: payload.sub } });
    if (!user) return res.status(401).json({ error: 'User not found' });
    res.json({ ...authTokens(user), user: publicUser(user) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Confirm an email address from the link in the verification email (public — no auth).
app.post('/api/auth/verify-email', async (req, res) => {
  try {
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ error: 'Missing token' });
    let payload;
    try { payload = jwt.verify(token, JWT_SECRET); } catch { return res.status(400).json({ error: 'This verification link is invalid or has expired' }); }
    if (payload.purpose !== 'verify' || !payload.sub) return res.status(400).json({ error: 'Invalid verification link' });
    await prismaBase.user.update({ where: { id: payload.sub }, data: { emailVerified: true } });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Resend the verification email to the currently logged-in user.
app.post('/api/auth/resend-verification', auth, async (req, res) => {
  try {
    const user = await prismaBase.user.findUnique({ where: { id: req.user.sub } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.emailVerified) return res.json({ ok: true, alreadyVerified: true });
    sendVerifyEmail(user);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const em = String(email || '').toLowerCase();
    const user = await prisma.user.findUnique({ where: { email: em } });
    if (!user || !user.passwordHash || !bcrypt.compareSync(password || '', user.passwordHash)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    // Suspended by a platform admin. Checked here (and not only in the panel) so
    // that suspension actually locks the account out of the product.
    if (user.status === 'suspended') {
      return res.status(403).json({ error: 'This account has been suspended. Please contact support.' });
    }
    // Removed from the workspace. Their history is deliberately kept so past
    // approvals and submissions still read correctly, but the account must not
    // be able to sign back in.
    if (user.status === 'removed') {
      return res.status(403).json({ error: 'This account no longer has access to the workspace.' });
    }
    recordAccess(req, user); res.json({ ...authTokens(user), user: publicUser(user) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const ME_SELECT = { id: true, name: true, role: true, email: true, phone: true, age: true, gender: true, qualifications: true, emergencyContact: true, emergencyPhone: true, trade: true, avatar: true };

app.get('/api/me', auth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.sub }, select: ME_SELECT });
    res.json(user || { id: req.user.sub, name: req.user.name, role: req.user.role, email: req.user.email });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Update your own profile. Role/email are intentionally NOT editable here.
app.put('/api/me', auth, async (req, res) => {
  try {
    const b = req.body || {};
    const data = {};
    for (const f of ['name', 'phone', 'gender', 'qualifications', 'emergencyContact', 'emergencyPhone', 'trade', 'avatar']) {
      if (b[f] !== undefined) data[f] = b[f] === '' ? null : b[f];
    }
    if (b.age !== undefined) data.age = b.age == null || b.age === '' ? null : Math.max(0, Math.min(120, Math.round(Number(b.age)) || 0));
    if (data.name === null) delete data.name; // name is required — ignore blank
    const user = await prisma.user.update({ where: { id: req.user.sub }, data, select: ME_SELECT });
    res.json(user);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Change your own password. Verifies the current password (when one is set).
app.post('/api/me/password', auth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!newPassword || String(newPassword).length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
    const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
    if (!user) return res.status(404).json({ error: 'Not found' });
    if (user.passwordHash && !bcrypt.compareSync(String(currentPassword || ''), user.passwordHash)) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: bcrypt.hashSync(String(newPassword), 10) } });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== PASSWORD RESET (stateless, JWT-based — no schema changes needed) =====
// Request a reset link. Always responds ok so we never reveal which emails
// have accounts. When no email key is set, returns devLink for local testing.
app.post('/api/auth/forgot', async (req, res) => {
  try {
    const em = String(req.body?.email || '').toLowerCase();
    if (em) {
      const user = await prisma.user.findUnique({ where: { email: em } });
      if (user) {
        const token = jwt.sign({ sub: user.id, purpose: 'reset' }, JWT_SECRET, { expiresIn: '1h' });
        const link = `${APP_URL}/?reset=${encodeURIComponent(token)}`;
        const html = emailShell('Reset your password',
          `<p style="font-size:14px;color:#11161D">Hi ${user.name || ''}, we received a request to reset your Buildsasa password. This link expires in 1 hour.</p>
           ${button(link, 'Reset password')}
           <p style="font-size:12px;color:#8A95A5">Or paste this link into your browser:<br/><a href="${link}" style="color:#FF6B1A;word-break:break-all">${link}</a></p>`);
        const mail = await sendEmail({ to: em, subject: 'Reset your Buildsasa password', html });
        if (!mail.sent) return res.json({ ok: true, devLink: link });
      }
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Complete the reset with the token from the email link.
app.post('/api/auth/reset', async (req, res) => {
  try {
    const { token, password } = req.body || {};
    if (!token || !password || String(password).length < 6) {
      return res.status(400).json({ error: 'A valid link and a password of at least 6 characters are required' });
    }
    let payload;
    try { payload = jwt.verify(token, JWT_SECRET); } catch { return res.status(400).json({ error: 'This reset link is invalid or has expired' }); }
    if (!payload || payload.purpose !== 'reset') return res.status(400).json({ error: 'Invalid reset link' });
    const user = await prisma.user.update({ where: { id: payload.sub }, data: { passwordHash: bcrypt.hashSync(String(password), 10) } });
    res.json({ ok: true, email: user.email });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== TEAM / USER MANAGEMENT (invite teammates with roles) =====
app.get('/api/users', auth, async (_req, res) => {
  try { res.json(await prisma.user.findMany({ select: { id: true, name: true, email: true, role: true, trade: true, status: true, createdAt: true }, orderBy: { createdAt: 'asc' } })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/users/invite', auth, async (req, res) => {
  try {
    const { name, email, role, trade, password } = req.body || {};
    // A client must create their own login (Client tab invite), never get one
    // made by the contractor: their account, password and chats are theirs.
    if (role === 'Client') return res.status(400).json({ error: 'Clients create their own free account. Invite them from the project\'s Client tab instead, so you never handle their password.' });
    if (!name || !email || !role) return res.status(400).json({ error: 'Name, email and role are required' });
    const em = String(email).toLowerCase();
    // prismaBase: the scoped client only sees this company, so an email used in
    // another company passed this check and then failed at the database.
    const existing = await prismaBase.user.findUnique({ where: { email: em }, select: { workspaceId: true, role: true } });
    // A client account is not a company account. Clients follow projects from the
    // client panel, so point the owner to the project's Client tab instead.
    if (existing && existing.role === 'Client') return res.status(409).json({ error: "This person has a Buildsasa client account. To share a project with them, open the project and invite this email from its Client tab. They'll see it in their client panel straight away." });
    if (existing) return res.status(409).json({ error: existing.workspaceId && existing.workspaceId === req.user?.ws
      ? 'This person is already on your team.'
      : 'This email already has a Buildsasa account with another company. Ask them for a different email address, or contact support to move their account to your company.' });
    // Owner sets a password or we generate a temporary one.
    const tempPassword = password && String(password).length >= 6 ? password : Math.random().toString(36).slice(2, 10);
    // Invited users JOIN the inviter's workspace (they don't start a new one).
    const user = await prisma.user.create({ data: { name, email: em, role, trade: trade || null, passwordHash: bcrypt.hashSync(tempPassword, 10), workspaceId: req.user?.ws || null } });
    const inviter = req.user?.name || 'Your team';
    const html = emailShell('You\'ve been invited to Buildsasa',
      `<p style="font-size:14px;color:#11161D">Hi ${name}, ${inviter} added you to their Buildsasa workspace as <b>${role}</b>.</p>
       <p style="font-size:14px;color:#11161D">Sign in with your email and this temporary password, then change it under your account:</p>
       <p style="font-size:14px"><b>Email:</b> ${em}<br/><b>Temporary password:</b> <code style="background:#F4F6FA;padding:2px 6px;border-radius:4px">${tempPassword}</code></p>
       ${button(`${APP_URL}/`, 'Open Buildsasa')}`);
    const mail = await sendEmail({ to: em, subject: 'You\'ve been invited to Buildsasa', html });
    // Only return the temp password to the UI when we could NOT email it
    // (i.e. dev / no key) so the owner can still share it manually.
    res.json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      emailed: mail.sent,
      tempPassword: mail.sent ? undefined : tempPassword,
      emailReason: mail.sent ? undefined : (mail.reason || 'send_failed'),
      emailError: mail.sent ? undefined : mail.error,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/users/:id/role', auth, async (req, res) => {
  try { const u = await prisma.user.update({ where: { id: req.params.id }, data: { role: req.body.role } }); res.json({ id: u.id, role: u.role }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
// Remove a teammate from the workspace.
//
// This used to be a bare prisma.user.delete(), which fails the moment the person
// has any history: Assignment, Message and Attendance all hold a required
// foreign key onto User with Prisma's default Restrict. So anyone who had
// actually used the product could never be removed, and the UI reported a flat
// "Could not remove" with no reason.
//
// Hard-deleting them would be worse than the bug. This product's value rests on
// its audit trail — who approved a change order, who reported 60% progress, who
// submitted a checklist. Erasing the person turns all of that into "Unknown".
// So: revoke access and detach from projects, but keep the record of what they
// did. Only someone with no history at all is deleted outright.
app.delete('/api/users/:id', auth, async (req, res) => {
  try {
    if (req.params.id === req.user.sub) {
      return res.status(400).json({ error: 'You cannot remove your own account. Ask another workspace owner to do it.' });
    }
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) return res.status(404).json({ error: 'That teammate no longer exists' });

    // Project roles are access, not history — always detach.
    await prisma.assignment.deleteMany({ where: { userId: user.id } });

    const [messages, attendance] = await Promise.all([
      prisma.message.count({ where: { userId: user.id } }),
      prisma.attendance.count({ where: { userId: user.id } }),
    ]);

    if (messages === 0 && attendance === 0) {
      try {
        await prisma.user.delete({ where: { id: user.id } });
        return res.json({ ok: true, mode: 'deleted', message: `${user.name} was removed.` });
      } catch (e) {
        // Some other relation still references them. Fall through to deactivation
        // rather than failing — the caller asked for them gone either way.
        console.warn('[USERS] hard delete blocked, deactivating instead:', e && e.message);
      }
    }

    await prisma.user.update({ where: { id: user.id }, data: { status: 'removed' } });
    res.json({
      ok: true,
      mode: 'deactivated',
      message: `${user.name} can no longer sign in and has been taken off all projects. Their name is kept on past approvals and submissions so your records stay readable.`,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// Is email working? Tells you what is missing rather than leaving you to infer it
// from invites quietly not arriving. Auth-gated: it names configuration, not
// secrets — the API key itself is never returned.
app.get('/api/email/status', auth, (_req, res) => res.json(emailStatus()));

// Send a real test email to yourself to prove the whole path works end to end.
app.post('/api/email/test', auth, async (req, res) => {
  const to = String(req.body?.to || req.user?.email || '').trim();
  if (!to) return res.status(400).json({ error: 'No address to send to' });
  const st = emailStatus();
  if (!st.configured) {
    return res.status(400).json({ error: 'Email is not configured. Set RESEND_API_KEY on the backend service, then redeploy.', status: st });
  }
  const r = await sendEmail({
    to,
    subject: 'Buildsasa email test',
    html: emailShell('Email is working', '<p>If you are reading this, invites and notifications will reach your team.</p>'),
  });
  if (!r.sent) return res.status(502).json({ error: r.error || 'The provider refused the send.', status: st });
  res.json({ ok: true, to, status: st });
});
// Simple health check
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// Projects
//
// `images` is stored as a JSON array of URLs in a text column but is exposed to
// the client as a real array, so no caller has to know about the encoding. A
// legacy row holding a single bare URL still parses to a one-item array rather
// than blowing up.
const parseImages = (raw) => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((u) => typeof u === 'string' && u);
    return typeof parsed === 'string' && parsed ? [parsed] : [];
  } catch { return typeof raw === 'string' && raw ? [raw] : []; }
};
// Never persist an in-browser blob:/data: URL. It renders once in the tab that
// created it and is dead everywhere else, so storing one produces a permanently
// broken image that looks exactly like a lost upload.
const serializeImages = (value) => {
  const arr = Array.isArray(value) ? value : parseImages(value);
  const durable = arr.filter((u) => typeof u === 'string' && u && !/^(blob:|data:)/i.test(u));
  return durable.length ? JSON.stringify(durable) : null;
};
const projectDto = (p) => ({
  ...p,
  images: parseImages(p.images),
  changeOrderCount: p._count?.changeOrders ?? p.changeOrderCount ?? 0,
});

app.get('/api/projects', auth, async (_req, res) => {
  try {
    const projects = await prisma.project.findMany({
      include: { assignments: true, _count: { select: { changeOrders: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json((projects || []).map(projectDto));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// A single project with everything the detail page needs, in one round trip.
app.get('/api/projects/:projectId', auth, async (req, res) => {
  try {
    const p = await prisma.project.findUnique({
      where: { id: req.params.projectId },
      include: { assignments: true, _count: { select: { changeOrders: true } } },
    });
    if (!p) return res.status(404).json({ error: 'Project not found' });
    res.json(projectDto(p));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/projects', auth, async (req, res) => {
  try {
    const { code, name, city, lat, lng, value, status, progress, exposure, description, images, startDate, targetEndDate, contractSumKES } = req.body;
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Project name is required' });
    const data = {
      code, name, city: city || '—', value: value || '', status: status || 'Planning',
      progress: Number(progress) || 0, exposure, description: description || null,
      images: serializeImages(images),
    };
    if (contractSumKES != null && contractSumKES !== '') data.contractSumKES = Number(contractSumKES) || null;
    if (lat != null) data.lat = Number(lat);
    if (lng != null) data.lng = Number(lng);
    if (startDate) data.startDate = new Date(startDate);
    if (targetEndDate) data.targetEndDate = new Date(targetEndDate);
    const project = await prisma.project.create({ data });
    res.json(projectDto(project));
  } catch (e) {
    // A duplicate code is a user-fixable mistake, not a server fault — say which
    // field clashed instead of returning an opaque 500 the UI then swallows.
    if (e.code === 'P2002') return res.status(409).json({ error: `A project with code "${req.body?.code}" already exists — pick a different code` });
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/projects/:projectId', auth, async (req, res) => {
  try {
    const { code, name, city, lat, lng, value, status, progress, exposure, description, images, startDate, targetEndDate, contractSumKES } = req.body;
    // Only assign what the caller actually sent. A blanket assignment wiped
    // fields that were merely absent from a partial update.
    const data = {};
    if (contractSumKES !== undefined) data.contractSumKES = contractSumKES == null || contractSumKES === '' ? null : (Number(contractSumKES) || null);
    for (const [k, v] of Object.entries({ code, name, city, value, status, exposure })) {
      if (v !== undefined) data[k] = v;
    }
    if (progress !== undefined) data.progress = Number(progress) || 0;
    if (description !== undefined) data.description = description || null;
    if (images !== undefined) data.images = serializeImages(images);
    if (lat !== undefined) data.lat = lat != null ? Number(lat) : null;
    if (lng !== undefined) data.lng = lng != null ? Number(lng) : null;
    if (startDate !== undefined) data.startDate = startDate ? new Date(startDate) : null;
    if (targetEndDate !== undefined) data.targetEndDate = targetEndDate ? new Date(targetEndDate) : null;
    const project = await prisma.project.update({ where: { id: req.params.projectId }, data });
    res.json(projectDto(project));
  } catch (e) {
    if (e.code === 'P2002') return res.status(409).json({ error: `A project with code "${req.body?.code}" already exists — pick a different code` });
    if (e.code === 'P2025') return res.status(404).json({ error: 'Project not found' });
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/projects/:projectId', auth, async (req, res) => {
  try {
    await prisma.project.delete({ where: { id: req.params.projectId } });
    res.json({ ok: true });
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ error: 'Project not found' });
    res.status(500).json({ error: e.message });
  }
});

// Everything the project detail dashboard needs, aggregated server-side.
// Doing this in one request instead of a dozen from the browser keeps the page
// fast on a site connection, and every count is derived from real rows rather
// than being estimated in the UI. Each section degrades to empty/zero on its own
// so one failing table can't blank the whole dashboard.
app.get('/api/projects/:projectId/overview', auth, async (req, res) => {
  const projectId = req.params.projectId;
  const safe = async (fn, fallback) => { try { return await fn(); } catch { return fallback; } };
  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { assignments: true, _count: { select: { changeOrders: true } } },
    });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const [
      schedule, drawings, dailyLogs, punchItems, changeOrders, inspections,
      safetyIncidents, checklists, documents, expenses, ledger, commitments,
      invoices, crews, equipment,
    ] = await Promise.all([
      safe(() => prisma.scheduleItem.findMany({ where: { projectId }, orderBy: { startDate: 'asc' } }), []),
      safe(() => prisma.drawing.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' }, take: 12 }), []),
      safe(() => prisma.dailyLog.findMany({ where: { projectId }, orderBy: { date: 'desc' }, take: 10 }), []),
      safe(() => prisma.punchItem.findMany({ where: { projectId } }), []),
      safe(() => prisma.changeOrder.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' }, take: 10 }), []),
      safe(() => prisma.inspection.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' }, take: 10 }), []),
      safe(() => prisma.safetyIncident.findMany({ where: { projectId }, orderBy: { date: 'desc' }, take: 10 }), []),
      safe(() => prisma.checklist.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' }, take: 10 }), []),
      // `updated` is a display string, not a date — order by the real timestamp.
      safe(() => prisma.document.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' }, take: 10 }), []),
      safe(() => prisma.expenseCategory.findMany({ where: { projectId } }), []),
      safe(() => prisma.ledgerEntry.findMany({ where: { projectId }, orderBy: { date: 'desc' } }), []),
      safe(() => prisma.commitment.findMany({ where: { projectId } }), []),
      safe(() => prisma.invoice.findMany({ where: { projectId }, orderBy: { issueDate: 'desc' } }), []),
      // Crews link by projectId now, but rows created before that column existed
      // only carry the project name — match either so nothing is missed.
      safe(() => prisma.crew.findMany({ where: { OR: [{ projectId }, { project: project.name }] } }), []),
      safe(() => prisma.equipment.findMany({ where: { projectId } }), []),
    ]);

    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    const cashIn = ledger.filter((l) => l.type === 'in').reduce((s, l) => s + num(l.amountUSD), 0);
    const cashOut = ledger.filter((l) => l.type === 'out').reduce((s, l) => s + num(l.amountUSD), 0);
    // Schedule-weighted completion. Falls back to the manually-entered project
    // progress when there is no schedule yet, so the figure is never a blank.
    const scheduleProgress = schedule.length
      ? Math.round(schedule.reduce((s, i) => s + num(i.percent), 0) / schedule.length)
      : null;
    const today = new Date();
    const openPunch = punchItems.filter((p) => !['closed', 'resolved', 'Closed', 'Resolved'].includes(p.status)).length;

    res.json({
      project: projectDto(project),
      progress: {
        reported: num(project.progress),
        schedule: scheduleProgress,
        scheduleItems: schedule.length,
        milestonesDone: schedule.filter((i) => i.type === 'milestone' && num(i.percent) >= 100).length,
        milestonesTotal: schedule.filter((i) => i.type === 'milestone').length,
        overdueItems: schedule.filter((i) => i.endDate && new Date(i.endDate) < today && num(i.percent) < 100).length,
        blockedItems: schedule.filter((i) => i.status === 'blocked').length,
      },
      counts: {
        drawings: await safe(() => prisma.drawing.count({ where: { projectId } }), drawings.length),
        dailyLogs: await safe(() => prisma.dailyLog.count({ where: { projectId } }), dailyLogs.length),
        punchTotal: punchItems.length,
        punchOpen: openPunch,
        changeOrders: project._count?.changeOrders ?? changeOrders.length,
        inspections: inspections.length,
        safetyIncidents: safetyIncidents.length,
        checklists: checklists.length,
        documents: documents.length,
        commitments: commitments.length,
        invoices: invoices.length,
        equipment: equipment.length,
        crews: crews.length,
      },
      financials: {
        cashIn, cashOut, net: cashIn - cashOut,
        budget: expenses.reduce((s, e) => s + num(e.budgetUSD), 0),
        actual: expenses.reduce((s, e) => s + num(e.actualUSD), 0),
        committed: commitments.reduce((s, c) => s + num(c.contractValue), 0),
        invoicedTotal: invoices.reduce((s, i) => s + num(i.amount), 0),
        invoicedUnpaid: invoices.filter((i) => i.status !== 'paid').reduce((s, i) => s + num(i.amount), 0),
        expenses,
      },
      schedule: schedule.slice(0, 40),
      recent: { drawings, dailyLogs, changeOrders, inspections, safetyIncidents, checklists, documents, invoices },
      team: project.assignments || [],
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Assignments
app.post('/api/projects/:projectId/assignments', auth, async (req, res) => {
  try {
    const { role, userId } = req.body;
    const assignment = await prisma.assignment.create({ data: { role, userId, projectId: req.params.projectId } });
    res.json(assignment);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Set a project's team in one call: for each role sent, replace whoever held it.
//
// The project form used to POST a fresh assignment per role on every save. Because
// POST only ever CREATES, changing the PM left the old PM row in place and added a
// second one. The UI reads a role with `assignments.find(a => a.role === 'PM')`,
// which returned the ORIGINAL row — so the newly picked member never appeared and
// the Team section looked like it had not saved. Nor could a member be removed,
// since there was no path that deleted anything.
//
// Body: { assignments: [{ role, userId }] }. A null/empty/"None" userId clears
// that role. Roles absent from the payload are left untouched.
app.put('/api/projects/:projectId/assignments', auth, async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const incoming = Array.isArray(req.body?.assignments) ? req.body.assignments : null;
    if (!incoming) return res.status(400).json({ error: 'assignments array required' });

    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    // Validate every id BEFORE touching anything, so a bad one cannot leave the
    // team half-written. Assignment.userId is a foreign key onto User.id; the
    // project form used to send job-title strings ("Lead Architect"), which
    // surfaced as a raw `Assignment_userId_fkey` violation. Name the offending
    // role instead so the message is actionable.
    const wanted = [];
    for (const entry of incoming) {
      const role = String(entry?.role || '').trim();
      if (!role) continue;
      const userId = entry?.userId && entry.userId !== 'None' ? String(entry.userId) : null;
      if (userId) {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) return res.status(400).json({ error: `No such teammate for ${role} — pick someone from your workspace, or set it to None` });
      }
      wanted.push({ role, userId });
    }

    for (const { role, userId } of wanted) {
      // Clear the role, then set it — keeps exactly one row per role.
      await prisma.assignment.deleteMany({ where: { projectId, role } });
      if (userId) await prisma.assignment.create({ data: { projectId, role, userId } });
    }

    const rows = await prisma.assignment.findMany({ where: { projectId } });
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/projects/:projectId/assignments/:assignmentId', auth, async (req, res) => {
  try {
    const { role, userId } = req.body;
    const assignment = await prisma.assignment.update({
      where: { id: req.params.assignmentId },
      data: { role, userId },
    });
    res.json(assignment);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/projects/:projectId/assignments/:assignmentId', auth, async (req, res) => {
  try {
    await prisma.assignment.delete({ where: { id: req.params.assignmentId } });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Messages per project
app.get('/api/projects/:projectId/messages', auth, async (req, res) => {
  try {
    const messages = await prisma.message.findMany({
      where: { projectId: req.params.projectId },
      orderBy: { createdAt: 'asc' },
      include: { user: true },
    });
    res.json(messages || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/projects/:projectId/messages', auth, async (req, res) => {
  try {
    const { text, attachment } = req.body;
    const msg = await prisma.message.create({
      data: {
        text,
        attachment,
        projectId: req.params.projectId,
        // The signed-in author, not the built-in demo user. This was hardcoded to
        // demoUser.id, so every project message — whoever sent it — was stored and
        // displayed as coming from "Site Manager".
        userId: (req.user && (req.user.sub || req.user.id)) || demoUser.id,
      },
    });
    res.json(msg);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Ledger per project
app.get('/api/projects/:projectId/ledger', auth, async (req, res) => {
  try {
    const entries = await prisma.ledgerEntry.findMany({
      where: { projectId: req.params.projectId },
      orderBy: { date: 'asc' },
    });
    res.json(entries || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/projects/:projectId/ledger', auth, async (req, res) => {
  try {
    const { date, desc, type, category, amountUSD, vendorId, commitmentId, applicationId, costCodeId, status, invoiceNumber, poNumber, subcontractNumber, changeOrderNumber } = req.body;
    const entry = await prisma.ledgerEntry.create({
      data: {
        date: new Date(date), desc, type, category, amountUSD: Number(amountUSD), projectId: req.params.projectId,
        vendorId, commitmentId, applicationId, costCodeId, status, invoiceNumber, poNumber, subcontractNumber, changeOrderNumber,
      },
    });
    if (entry.commitmentId) await recomputeCommitment(entry.commitmentId);
    res.json(entry);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/projects/:projectId/ledger/:entryId', auth, async (req, res) => {
  try {
    const { date, desc, type, category, amountUSD, vendorId, commitmentId, applicationId, costCodeId, status, invoiceNumber, poNumber, subcontractNumber, changeOrderNumber } = req.body;
    const data = { desc, type, category };
    if (date !== undefined) data.date = new Date(date);
    if (amountUSD !== undefined) data.amountUSD = Number(amountUSD);
    for (const [k, v] of Object.entries({ vendorId, commitmentId, applicationId, costCodeId, status, invoiceNumber, poNumber, subcontractNumber, changeOrderNumber })) {
      if (v !== undefined) data[k] = v;
    }
    const entry = await prisma.ledgerEntry.update({ where: { id: req.params.entryId }, data });
    if (entry.commitmentId) await recomputeCommitment(entry.commitmentId);
    res.json(entry);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/projects/:projectId/ledger/:entryId', auth, async (req, res) => {
  try {
    await prisma.ledgerEntry.delete({ where: { id: req.params.entryId } });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Expenses per project
app.get('/api/projects/:projectId/expenses', auth, async (req, res) => {
  try {
    const rows = await prisma.expenseCategory.findMany({ where: { projectId: req.params.projectId } });
    res.json(rows || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/projects/:projectId/expenses', auth, async (req, res) => {
  try {
    const { name, budgetUSD, actualUSD } = req.body;
    const row = await prisma.expenseCategory.create({
      data: { name, budgetUSD: Number(budgetUSD), actualUSD: Number(actualUSD), projectId: req.params.projectId },
    });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/projects/:projectId/expenses/:expenseId', auth, async (req, res) => {
  try {
    const { name, budgetUSD, actualUSD } = req.body;
    const row = await prisma.expenseCategory.update({
      where: { id: req.params.expenseId },
      data: { name, budgetUSD: Number(budgetUSD), actualUSD: Number(actualUSD) },
    });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/projects/:projectId/expenses/:expenseId', auth, async (req, res) => {
  try {
    await prisma.expenseCategory.delete({ where: { id: req.params.expenseId } });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Daily Log
app.get('/api/projects/:projectId/daily-log', auth, async (req, res) => {
  try {
    const rows = await prisma.dailyLog.findMany({ where: { projectId: req.params.projectId }, orderBy: { date: 'desc' } });
    res.json(rows || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/projects/:projectId/daily-log', auth, async (req, res) => {
  try {
    const { date, crew, crewId, headcount, location, notes, weather, labour, plant, materials, photos, videos, lat, lng, clientVisible, placeName } = req.body;
    if (!crew || !String(crew).trim()) return res.status(400).json({ error: 'Pick or type the crew on site' });
    // An absent/invalid date used to become `Invalid Date` and be rejected by
    // Postgres with an opaque error; default to today instead.
    const when = date ? new Date(date) : new Date();
    const row = await prisma.dailyLog.create({
      data: {
        date: isNaN(when.getTime()) ? new Date() : when,
        crew, crewId: crewId || null, headcount: Number(headcount) || 0,
        location: location || '', notes: notes || '', weather: weather || null,
        labour: labour || null, plant: plant || null, materials: materials || null,
        photos: Array.isArray(photos) ? JSON.stringify(photos) : (photos || null),
        videos: Array.isArray(videos) && videos.length ? JSON.stringify(videos) : null,
        lat: lat == null || lat === '' ? null : Number(lat), lng: lng == null || lng === '' ? null : Number(lng),
        clientVisible: clientVisible === undefined ? true : !!clientVisible,
        placeName: placeName ? String(placeName).slice(0, 300) : null,
        projectId: req.params.projectId,
      },
    });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/projects/:projectId/daily-log/:id', auth, async (req, res) => {
  try {
    const { date, crew, crewId, headcount, location, notes, weather, labour, plant, materials, photos, videos, lat, lng, clientVisible, placeName } = req.body;
    const data = {};
    if (videos !== undefined) data.videos = Array.isArray(videos) && videos.length ? JSON.stringify(videos) : null;
    if (lat !== undefined) data.lat = lat == null || lat === '' ? null : Number(lat);
    if (lng !== undefined) data.lng = lng == null || lng === '' ? null : Number(lng);
    if (clientVisible !== undefined) data.clientVisible = !!clientVisible;
    if (placeName !== undefined) data.placeName = placeName ? String(placeName).slice(0, 300) : null;
    if (date !== undefined) { const w = new Date(date); if (!isNaN(w.getTime())) data.date = w; }
    for (const [k, v] of Object.entries({ crew, crewId, location, notes, weather, labour, plant, materials })) {
      if (v !== undefined) data[k] = v;
    }
    if (photos !== undefined) data.photos = Array.isArray(photos) ? JSON.stringify(photos) : (photos || null);
    if (headcount !== undefined) data.headcount = Number(headcount) || 0;
    const row = await prisma.dailyLog.update({ where: { id: req.params.id }, data });
    res.json(row);
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ error: 'Daily log not found' });
    res.status(500).json({ error: e.message });
  }
});
app.delete('/api/projects/:projectId/daily-log/:id', auth, async (req, res) => {
  try {
    await prisma.dailyLog.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Punch List
app.get('/api/projects/:projectId/punch', auth, async (req, res) => {
  try {
    const rows = await prisma.punchItem.findMany({ where: { projectId: req.params.projectId }, orderBy: { createdAt: 'desc' } });
    res.json(rows || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/projects/:projectId/punch', auth, async (req, res) => {
  try {
    const { code, area, desc, status, photos, videos, assignedTo, location, drawingRef, linkedTaskId } = req.body;
    const row = await prisma.punchItem.create({ data: { code, area, desc, status, photos: photos ? JSON.stringify(photos) : null, videos: videos ? JSON.stringify(videos) : null, assignedTo, location, drawingRef: drawingRef ? JSON.stringify(drawingRef) : null, linkedTaskId, projectId: req.params.projectId } });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/projects/:projectId/punch/:id', auth, async (req, res) => {
  try {
    const { code, area, desc, status, photos, videos, assignedTo, location, drawingRef, linkedTaskId } = req.body;
    const data = { code, area, desc, status, assignedTo, location, linkedTaskId };
    if (photos !== undefined) data.photos = photos ? JSON.stringify(photos) : null;
    if (videos !== undefined) data.videos = videos ? JSON.stringify(videos) : null;
    if (drawingRef !== undefined) data.drawingRef = drawingRef ? JSON.stringify(drawingRef) : null;
    const row = await prisma.punchItem.update({ where: { id: req.params.id }, data });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/projects/:projectId/punch/:id', auth, async (req, res) => {
  try {
    await prisma.punchItem.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== PUNCH LIST (rich, item-centric, Procore-inspired) =====
const PUNCH_FIELDS = ['code', 'area', 'desc', 'status', 'location', 'title', 'category', 'trade', 'priority', 'punchManagerId', 'finalApproverId', 'dueDate', 'createdById', 'costImpact', 'scheduleImpact', 'costCode', 'reference', 'isPrivate', 'linkedTaskId', 'linkedDrawingId', 'projectId'];
const PUNCH_JSON = ['photos', 'videos', 'assignees', 'distribution', 'drawingRef', 'drawingCoordinates'];
const PUNCH_STATUSES = ['open', 'in_progress', 'ready_for_review', 'resolved', 'closed', 'rejected'];
const pickPunch = (body) => {
  const data = {};
  for (const f of PUNCH_FIELDS) if (body[f] !== undefined) data[f] = body[f];
  for (const f of PUNCH_JSON) if (body[f] !== undefined) data[f] = body[f] == null ? null : (typeof body[f] === 'string' ? body[f] : JSON.stringify(body[f]));
  return data;
};

// List + filter — query: projectId, status, trade, priority, assignee, q
app.get('/api/punch', auth, async (req, res) => {
  try {
    const { projectId, status, trade, priority, assignee, q } = req.query;
    const where = {};
    if (projectId) where.projectId = projectId;
    if (status) where.status = status;
    if (trade) where.trade = trade;
    if (priority) where.priority = priority;
    let rows = await prisma.punchItem.findMany({ where, orderBy: { createdAt: 'desc' } });
    if (assignee) rows = rows.filter((r) => (r.assignees || '').includes(assignee) || r.assignedTo === assignee);
    if (q) { const s = String(q).toLowerCase(); rows = rows.filter((r) => [r.title, r.desc, r.reference, r.code].filter(Boolean).some((v) => v.toLowerCase().includes(s))); }
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Single item with comments / attachments / activity
app.get('/api/punch/:id', auth, async (req, res) => {
  try {
    const row = await prisma.punchItem.findUnique({ where: { id: req.params.id }, include: { comments: { orderBy: { createdAt: 'asc' } }, attachments: true, activity: { orderBy: { createdAt: 'desc' } } } });
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Punch items linked to a drawing (drives the viewer pin layer)
app.get('/api/drawings/:drawingId/punch', auth, async (req, res) => {
  try { res.json(await prisma.punchItem.findMany({ where: { linkedDrawingId: req.params.drawingId }, orderBy: { createdAt: 'desc' } })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Create (auto code, logs activity)
app.post('/api/punch', auth, async (req, res) => {
  try {
    const data = pickPunch(req.body);
    if (!data.projectId) return res.status(400).json({ error: 'projectId required' });
    if (!data.status) data.status = 'open';
    if (!data.code) data.code = 'PL-' + Math.floor(1000 + Math.random() * 9000);
    if (!data.area) data.area = req.body.location || '—';
    if (!data.desc) data.desc = req.body.description || req.body.title || '';
    data.createdById = data.createdById || (req.user && req.user.sub) || null;
    const row = await prisma.punchItem.create({ data });
    await prisma.punchItemActivity.create({ data: { punchItemId: row.id, actorId: data.createdById, actionType: 'created', after: row.status } });
    notifyAssignment(row.assignees, {
      subject: 'You have been assigned a punch item',
      intro: `you've been assigned punch item ${row.code || ''} — "${row.title || row.desc || ''}". Open Buildsasa to action it.`,
      link: APP_URL,
    });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Update fields (logs an edit)
app.put('/api/punch/:id', auth, async (req, res) => {
  try {
    const row = await prisma.punchItem.update({ where: { id: req.params.id }, data: pickPunch(req.body) });
    await prisma.punchItemActivity.create({ data: { punchItemId: row.id, actorId: req.user && req.user.sub, actionType: 'field_edit', after: 'updated' } });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Status transition with workflow validation (role: creator | assignee | manager | approver)
app.post('/api/punch/:id/status', auth, async (req, res) => {
  try {
    const { status, role } = req.body;
    if (!PUNCH_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const item = await prisma.punchItem.findUnique({ where: { id: req.params.id } });
    if (!item) return res.status(404).json({ error: 'Not found' });
    if (['closed', 'rejected'].includes(status) && !['manager', 'approver'].includes(role)) return res.status(403).json({ error: 'Only a Punch Manager or Final Approver can close or reject items' });
    if (status === 'resolved' && !['assignee', 'manager', 'approver'].includes(role)) return res.status(403).json({ error: 'Only the assignee can mark an item resolved' });
    const before = item.status;
    const row = await prisma.punchItem.update({ where: { id: req.params.id }, data: { status } });
    await prisma.punchItemActivity.create({ data: { punchItemId: row.id, actorId: req.user && req.user.sub, actionType: 'status_change', field: 'status', before, after: status } });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/punch/:id/comments', auth, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'text required' });
    const authorId = (req.user && req.user.sub) || 'demo-user';
    const c = await prisma.punchItemComment.create({ data: { punchItemId: req.params.id, text, authorId } });
    await prisma.punchItemActivity.create({ data: { punchItemId: req.params.id, actorId: authorId, actionType: 'comment' } });
    res.json(c);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/punch/:id/attachments', auth, async (req, res) => {
  try {
    const { fileUrl, type } = req.body;
    if (!fileUrl) return res.status(400).json({ error: 'fileUrl required' });
    const createdById = (req.user && req.user.sub) || 'demo-user';
    const a = await prisma.punchItemAttachment.create({ data: { punchItemId: req.params.id, fileUrl, type: type || 'image', createdById } });
    await prisma.punchItemActivity.create({ data: { punchItemId: req.params.id, actorId: createdById, actionType: 'attachment' } });
    res.json(a);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/punch/:id', auth, async (req, res) => {
  try { await prisma.punchItem.delete({ where: { id: req.params.id } }); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== CHANGE ORDERS =====
const CO_FIELDS = ['number', 'title', 'area', 'description', 'status', 'trigger', 'rfi', 'costUSD', 'amountKES', 'scheduleImpactDays', 'requestedBy', 'submittedDate', 'projectId'];
// Who may create/edit a change order, and who may approve/reject one. Mirrors
// the role permissions used in the UI (createCO / approveAny).
const CAN_CREATE_CO = ['Contractor', 'Quantity Surveyor', 'Executive', 'Project Manager', 'Superintendent', 'Trade Lead'];
const CAN_APPROVE_CO = ['Contractor', 'Owner', 'Executive', 'Project Manager'];
const hasRole = (req, list) => !!(req.user && list.includes(req.user.role));
const pickCO = (body) => {
  const d = {};
  for (const f of CO_FIELDS) if (body[f] !== undefined) d[f] = body[f];
  // The Change Orders module edits the dollar figure; the project hub reads the
  // shilling one. Whichever side moved, the other follows so they never disagree.
  const rate = Number(process.env.USD_TO_KES) || 130;
  if (d.amountKES !== undefined) { d.amountKES = Number(d.amountKES) || 0; if (d.costUSD === undefined) d.costUSD = Math.round(d.amountKES / rate); }
  else if (d.costUSD !== undefined) { d.costUSD = Number(d.costUSD) || 0; d.amountKES = Math.round(d.costUSD * rate * 100) / 100; }
  if (body.assignees !== undefined) d.assignees = body.assignees == null ? null : (typeof body.assignees === 'string' ? body.assignees : JSON.stringify(body.assignees));
  return d;
};
async function logCO(req, changeOrderId, data) {
  try {
    await prisma.changeOrderActivity.create({ data: {
      changeOrderId,
      userId: req.user?.sub || null,
      userName: req.user?.name || null,
      userRole: req.user?.role || null,
      ...data,
    } });
  } catch (e) { console.error('[CO activity] failed:', e.message); }
}

app.get('/api/change-orders', auth, async (req, res) => {
  try { const { projectId, status } = req.query; const where = {}; if (projectId) where.projectId = projectId; if (status) where.status = status; res.json(await prisma.changeOrder.findMany({ where, orderBy: { createdAt: 'desc' } })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Real, data-driven dashboard insight for the current workspace. Returns null when
// there's nothing to report (e.g. a brand-new company). Computes the key finding
// deterministically (always works), then asks the AI to phrase it; falls back to
// the deterministic version if no AI provider is configured or the call fails.
app.get('/api/dashboard/insight', auth, async (req, res) => {
  try {
    const USD_TO_KES = Number(process.env.USD_TO_KES) || 130;
    const cos = await prisma.changeOrder.findMany({ orderBy: { createdAt: 'desc' } });
    if (!cos.length) return res.json(null);
    const daysSince = (d) => (d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : 0);
    const open = cos.filter((c) => ['drafted', 'pm_review', 'owner_approval'].includes(c.status));
    const pendingApproval = open
      .filter((c) => c.status === 'owner_approval')
      .sort((a, b) => daysSince(b.submittedDate) - daysSince(a.submittedDate));
    const stale = open
      .filter((c) => daysSince(c.submittedDate) > 7)
      .sort((a, b) => daysSince(b.submittedDate) - daysSince(a.submittedDate));
    const focus = pendingApproval[0] || stale[0] || open[0] || null;
    const totalOpenValueKES = Math.round(open.reduce((s, c) => s + (Number(c.costUSD) || 0) * USD_TO_KES, 0));
    const fmtKES = (n) => 'KSh' + Number(n || 0).toLocaleString('en-KE');

    // Deterministic baseline insight.
    let insight;
    if (pendingApproval.length) {
      insight = {
        title: `${pendingApproval.length} change order${pendingApproval.length > 1 ? 's' : ''} awaiting owner approval`,
        detail: `${fmtKES(totalOpenValueKES)} in open change orders. Oldest: ${focus.number} open ${daysSince(focus.submittedDate)} day(s).`,
        changeOrderId: focus ? focus.id : undefined,
      };
    } else if (stale.length) {
      insight = {
        title: `${stale.length} change order${stale.length > 1 ? 's' : ''} open for over a week`,
        detail: `Review ${focus.number}${focus.title ? ` — ${focus.title}` : ''}.`,
        changeOrderId: focus ? focus.id : undefined,
      };
    } else {
      insight = {
        title: `${open.length} open change order${open.length === 1 ? '' : 's'} in progress`,
        detail: `${fmtKES(totalOpenValueKES)} in flight across your projects.`,
        changeOrderId: focus ? focus.id : undefined,
      };
    }

    // Try to enhance the phrasing with AI; keep the deterministic version on any failure.
    try {
      const summary = {
        totalChangeOrders: cos.length,
        open: open.length,
        pendingOwnerApproval: pendingApproval.length,
        staleOver7Days: stale.length,
        totalOpenValueKES,
        focus: focus ? { number: focus.number, title: focus.title, status: focus.status, daysOpen: daysSince(focus.submittedDate), costKES: Math.round((Number(focus.costUSD) || 0) * USD_TO_KES) } : null,
      };
      const text = await callAi([
        { role: 'system', content: 'You are a construction project analyst. Given a JSON summary of one company\'s change orders, return ONE concise, specific insight as strict JSON only: {"title": string up to 90 chars stating the key finding, "detail": string up to 140 chars with the recommended action and numbers}. Use KES currency. No markdown, JSON object only.' },
        { role: 'user', content: JSON.stringify(summary) },
      ], { temperature: 0.3, max_tokens: 300 });
      const m = text && text.match(/\{[\s\S]*\}/);
      if (m) {
        const j = JSON.parse(m[0]);
        if (j && j.title) {
          insight = {
            title: String(j.title).slice(0, 120),
            detail: j.detail ? String(j.detail).slice(0, 200) : insight.detail,
            changeOrderId: focus ? focus.id : undefined,
          };
        }
      }
    } catch (e) { /* keep deterministic insight */ }

    res.json(insight);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/projects/:projectId/change-orders', auth, async (req, res) => {
  try { res.json(await prisma.changeOrder.findMany({ where: { projectId: req.params.projectId }, orderBy: { createdAt: 'desc' } })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/change-orders/:id', auth, async (req, res) => {
  try { const row = await prisma.changeOrder.findUnique({ where: { id: req.params.id } }); if (!row) return res.status(404).json({ error: 'Not found' }); res.json(row); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
// Activity log for a change order (newest first).
app.get('/api/change-orders/:id/activity', auth, async (req, res) => {
  try { res.json(await prisma.changeOrderActivity.findMany({ where: { changeOrderId: req.params.id }, orderBy: { createdAt: 'desc' } })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
// Post a comment onto a change order's activity log.
app.post('/api/change-orders/:id/activity', auth, async (req, res) => {
  try {
    const message = String(req.body?.message || '').trim();
    if (!message) return res.status(400).json({ error: 'message required' });
    await logCO(req, req.params.id, { type: 'comment', message });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/change-orders', auth, async (req, res) => {
  try {
    if (!hasRole(req, CAN_CREATE_CO)) return res.status(403).json({ error: `Forbidden: ${req.user?.role || 'this role'} cannot create change orders` });
    const d = pickCO(req.body);
    if (!d.projectId) return res.status(400).json({ error: 'projectId required' });
    if (!d.number) d.number = 'CO-' + Math.floor(1000 + Math.random() * 9000);
    if (!d.status) d.status = 'drafted';
    const row = await prisma.changeOrder.create({ data: d });
    await logCO(req, row.id, { type: 'created', toStatus: row.status, message: `Created ${row.number}` });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/change-orders/:id', auth, async (req, res) => {
  try {
    const existing = await prisma.changeOrder.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const d = pickCO(req.body);
    const newStatus = d.status;
    const isDecision = (newStatus === 'approved' || newStatus === 'rejected') && newStatus !== existing.status;
    if (isDecision) {
      if (!hasRole(req, CAN_APPROVE_CO)) return res.status(403).json({ error: `Forbidden: ${req.user?.role || 'this role'} cannot approve or reject change orders` });
    } else if (!hasRole(req, CAN_CREATE_CO) && !hasRole(req, CAN_APPROVE_CO)) {
      return res.status(403).json({ error: `Forbidden: ${req.user?.role || 'this role'} cannot edit change orders` });
    }
    const row = await prisma.changeOrder.update({ where: { id: req.params.id }, data: d });
    if (newStatus && newStatus !== existing.status) {
      await logCO(req, row.id, { type: 'status', fromStatus: existing.status, toStatus: newStatus, message: `Status changed to ${newStatus}` });
    } else {
      await logCO(req, row.id, { type: 'edited', message: 'Updated change order details' });
    }
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/change-orders/:id', auth, async (req, res) => {
  try {
    if (!hasRole(req, CAN_CREATE_CO) && !hasRole(req, CAN_APPROVE_CO)) return res.status(403).json({ error: `Forbidden: ${req.user?.role || 'this role'} cannot delete change orders` });
    await prisma.changeOrder.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== SCHEDULE (Gantt timeline) =====
const SCHED_FIELDS = ['name', 'type', 'status', 'trade', 'color', 'notes', 'sortOrder'];
const pickSched = (b) => {
  const d = {};
  for (const f of SCHED_FIELDS) if (b[f] !== undefined) d[f] = b[f];
  if (b.startDate !== undefined) d.startDate = new Date(b.startDate);
  if (b.endDate !== undefined) d.endDate = new Date(b.endDate);
  if (b.percent !== undefined) d.percent = Math.max(0, Math.min(100, Math.round(Number(b.percent)) || 0));
  if (b.assignees !== undefined) d.assignees = b.assignees == null ? null : (typeof b.assignees === 'string' ? b.assignees : JSON.stringify(b.assignees));
  return d;
};
app.get('/api/projects/:projectId/schedule', auth, async (req, res) => {
  try { res.json(await prisma.scheduleItem.findMany({ where: { projectId: req.params.projectId }, orderBy: [{ startDate: 'asc' }, { sortOrder: 'asc' }] })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/projects/:projectId/schedule', auth, async (req, res) => {
  try {
    const d = pickSched(req.body);
    if (!d.name) return res.status(400).json({ error: 'name required' });
    if (!d.startDate) d.startDate = new Date();
    if (!d.endDate) d.endDate = d.startDate;
    d.projectId = req.params.projectId;
    d.createdBy = req.user.sub;
    res.json(await prisma.scheduleItem.create({ data: d }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/schedule/:id', auth, async (req, res) => {
  try { res.json(await prisma.scheduleItem.update({ where: { id: req.params.id }, data: pickSched(req.body) })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/schedule/:id', auth, async (req, res) => {
  try { await prisma.scheduleItem.delete({ where: { id: req.params.id } }); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
// AI-draft a whole schedule for a project. Returns offsets which we turn into
// real dates from the given start, then bulk-create the items.
app.post('/api/projects/:projectId/schedule/generate', auth, async (req, res) => {
  try {
    const { prompt, startDate, durationWeeks } = req.body || {};
    const start = startDate ? new Date(startDate) : new Date();
    if (isNaN(+start)) return res.status(400).json({ error: 'Invalid start date' });
    const weeks = Math.max(1, Math.min(260, Number(durationWeeks) || 16));
    const sys = 'You are a senior construction planner. You produce realistic project schedules as ONLY valid JSON — no markdown, no commentary.';
    const user = `Create a construction project schedule.
Project: "${String(prompt || 'general construction project').trim()}".
Total duration: about ${weeks} weeks.
Return ONLY a JSON object: { "items": Item[] }.
Each Item has EXACTLY: { "name": string, "type": "phase"|"task"|"milestone", "trade": string, "startOffsetDays": number (whole days from project start, >= 0), "durationDays": number (0 for milestones) }.
Rules: 12-24 items in a logical construction sequence (mobilization, substructure, superstructure, MEP first/second fix, finishes, external works, handover); include 3-6 milestones at key gates (e.g. "Foundation complete", "Roof watertight", "Practical completion"); use real trades (General, Concrete, Electrical, Plumbing, HVAC, Roofing, Masonry, Carpentry, Painting, Drywall, Landscaping); keep everything within the total duration. Return ONLY the JSON object.`;
    const raw = await callAiDeepSeekFirst([{ role: 'system', content: sys }, { role: 'user', content: user }], { temperature: 0.4, max_tokens: 3000 });
    let data = {};
    try { data = JSON.parse(String(raw).replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()); } catch { data = {}; }
    const arr = Array.isArray(data.items) ? data.items : [];
    if (!arr.length) return res.status(422).json({ error: 'The AI did not return a schedule — try a more specific description.' });
    const created = [];
    let i = 0;
    for (const it of arr.slice(0, 40)) {
      const off = Math.max(0, Math.round(Number(it.startOffsetDays) || 0));
      const dur = it.type === 'milestone' ? 0 : Math.max(1, Math.round(Number(it.durationDays) || 1));
      const s = new Date(+start + off * 86400000);
      const e = new Date(+s + dur * 86400000);
      const row = await prisma.scheduleItem.create({ data: {
        projectId: req.params.projectId,
        name: String(it.name || 'Activity').slice(0, 200),
        type: ['phase', 'task', 'milestone'].includes(it.type) ? it.type : 'task',
        startDate: s, endDate: e, percent: 0, status: 'not_started',
        trade: it.trade ? String(it.trade).slice(0, 40) : null,
        sortOrder: i++, createdBy: req.user.sub,
      } });
      created.push(row);
    }
    res.json({ items: created, count: created.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== CONSTRUCTION FINANCE (PAYABLES) =====
// Reuses the existing change-order role model: PM/manager-capable roles may
// create/review/submit; financial/owner-capable roles may approve/markPaid/release.
const CAN_REVIEW_FINANCE = CAN_CREATE_CO;   // Contractor, Quantity Surveyor, Executive, Project Manager, Superintendent, Trade Lead
const CAN_APPROVE_FINANCE = CAN_APPROVE_CO; // Contractor, Owner, Executive, Project Manager
const num = (v) => (v == null || v === '' ? null : Number(v));

// Record an audit-trail row. Best-effort: never blocks the main action.
async function logApproval(req, entityType, entityId, action, comments) {
  try {
    await prisma.approval.create({ data: {
      entityType, entityId, action,
      actorId: req.user?.sub || null,
      actorName: req.user?.name || null,
      comments: comments || null,
    } });
  } catch (e) { console.error('[approval log] failed:', e.message); }
}

// Recalculate a commitment's running totals from its paid payment applications
// and its paid/linked ledger entries. invoicedToDate counts all non-rejected
// applications' requested amounts; paidToDate / retentionHeld come from paid ones.
async function recomputeCommitment(commitmentId) {
  try {
    const commitment = await prisma.commitment.findUnique({ where: { id: commitmentId } });
    if (!commitment) return null;
    const apps = await prisma.paymentApplication.findMany({ where: { commitmentId } });
    const ledger = await prisma.ledgerEntry.findMany({ where: { commitmentId } });
    const invoicedToDate = apps
      .filter((a) => a.status !== 'rejected' && a.status !== 'draft')
      .reduce((s, a) => s + (Number(a.requestedAmount) || 0), 0);
    const paidApps = apps.filter((a) => a.status === 'paid');
    const paidFromApps = paidApps.reduce((s, a) => s + (Number(a.netPayable) || 0), 0);
    const paidFromLedger = ledger
      .filter((l) => l.status === 'paid')
      .reduce((s, l) => s + (Number(l.amountUSD) || 0), 0);
    const paidToDate = paidFromApps + paidFromLedger;
    const retentionHeld = paidApps.reduce((s, a) => s + (Number(a.retentionAmount) || 0), 0);
    const base = (Number(commitment.contractValue) || 0) + (Number(commitment.approvedVariations) || 0);
    const balanceRemaining = base - paidToDate;
    return await prisma.commitment.update({
      where: { id: commitmentId },
      data: { invoicedToDate, paidToDate, retentionHeld, balanceRemaining },
    });
  } catch (e) { console.error('[recomputeCommitment] failed:', e.message); return null; }
}

// Commitments (payables)
const COMMITMENT_FIELDS = ['vendor', 'scope', 'amount', 'due', 'costCodeId', 'contractValue', 'approvedVariations', 'invoicedToDate', 'paidToDate', 'retentionPct', 'retentionHeld', 'balanceRemaining', 'status'];
const pickCommitment = (body) => {
  const d = {};
  for (const f of COMMITMENT_FIELDS) {
    if (body[f] === undefined) continue;
    d[f] = ['contractValue', 'approvedVariations', 'invoicedToDate', 'paidToDate', 'retentionPct', 'retentionHeld', 'balanceRemaining'].includes(f) ? num(body[f]) : body[f];
  }
  return d;
};
app.get('/api/projects/:projectId/commitments', auth, async (req, res) => {
  try {
    const rows = await prisma.commitment.findMany({ where: { projectId: req.params.projectId }, orderBy: { createdAt: 'desc' } });
    res.json(rows || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/projects/:projectId/commitments/:id', auth, async (req, res) => {
  try {
    const row = await prisma.commitment.findUnique({
      where: { id: req.params.id },
      include: { paymentApplications: true, retentionRecords: true },
    });
    if (!row) return res.status(404).json({ error: 'Not found' });
    const ledgerEntries = await prisma.ledgerEntry.findMany({ where: { commitmentId: req.params.id }, orderBy: { date: 'asc' } });
    res.json({ ...row, ledgerEntries });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/projects/:projectId/commitments', auth, async (req, res) => {
  try {
    if (!hasRole(req, CAN_REVIEW_FINANCE)) return res.status(403).json({ error: `Forbidden: ${req.user?.role || 'this role'} cannot create commitments` });
    const data = pickCommitment(req.body);
    data.projectId = req.params.projectId;
    if (data.vendor === undefined) return res.status(400).json({ error: 'vendor required' });
    const row = await prisma.commitment.create({ data });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/projects/:projectId/commitments/:id', auth, async (req, res) => {
  try {
    if (!hasRole(req, CAN_REVIEW_FINANCE)) return res.status(403).json({ error: `Forbidden: ${req.user?.role || 'this role'} cannot edit commitments` });
    const row = await prisma.commitment.update({ where: { id: req.params.id }, data: pickCommitment(req.body) });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/projects/:projectId/commitments/:id', auth, async (req, res) => {
  try {
    if (!hasRole(req, CAN_APPROVE_FINANCE)) return res.status(403).json({ error: `Forbidden: ${req.user?.role || 'this role'} cannot delete commitments` });
    await prisma.commitment.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// Recompute a commitment's running totals on demand.
app.post('/api/projects/:projectId/commitments/:id/recompute', auth, async (req, res) => {
  try {
    const row = await recomputeCommitment(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== PAYMENT APPLICATIONS =====
// Auto-derive retentionAmount/netPayable from requestedAmount + retentionPct.
const calcPaymentApp = (data) => {
  const requested = num(data.requestedAmount) || 0;
  const pct = num(data.retentionPct) || 0;
  const retentionAmount = +(requested * pct / 100).toFixed(2);
  data.retentionAmount = retentionAmount;
  data.netPayable = +(requested - retentionAmount).toFixed(2);
  return data;
};
const PA_FIELDS = ['commitmentId', 'number', 'period', 'periodStart', 'periodEnd', 'workCompletedThisPeriod', 'previousCertified', 'requestedAmount', 'retentionPct', 'costCodeId', 'comments', 'fileUrl'];
const pickPaymentApp = (body) => {
  const d = {};
  for (const f of PA_FIELDS) {
    if (body[f] === undefined) continue;
    if (['workCompletedThisPeriod', 'previousCertified', 'requestedAmount', 'retentionPct'].includes(f)) d[f] = num(body[f]);
    else if (['periodStart', 'periodEnd'].includes(f)) d[f] = body[f] ? new Date(body[f]) : null;
    else d[f] = body[f];
  }
  return d;
};
app.get('/api/projects/:projectId/payment-applications', auth, async (req, res) => {
  try {
    const where = { projectId: req.params.projectId };
    if (req.query.commitmentId) where.commitmentId = req.query.commitmentId;
    if (req.query.status) where.status = req.query.status;
    res.json(await prisma.paymentApplication.findMany({ where, orderBy: { createdAt: 'desc' } }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/projects/:projectId/payment-applications/:id', auth, async (req, res) => {
  try {
    const row = await prisma.paymentApplication.findUnique({ where: { id: req.params.id } });
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/projects/:projectId/payment-applications', auth, async (req, res) => {
  try {
    if (!hasRole(req, CAN_REVIEW_FINANCE)) return res.status(403).json({ error: `Forbidden: ${req.user?.role || 'this role'} cannot create payment applications` });
    const data = pickPaymentApp(req.body);
    if (!data.number) return res.status(400).json({ error: 'number required' });
    data.projectId = req.params.projectId;
    data.status = 'draft';
    calcPaymentApp(data);
    const row = await prisma.paymentApplication.create({ data });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/projects/:projectId/payment-applications/:id', auth, async (req, res) => {
  try {
    if (!hasRole(req, CAN_REVIEW_FINANCE)) return res.status(403).json({ error: `Forbidden: ${req.user?.role || 'this role'} cannot edit payment applications` });
    const existing = await prisma.paymentApplication.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const data = pickPaymentApp(req.body);
    // Recalc derived amounts from the merged values.
    const merged = { requestedAmount: existing.requestedAmount, retentionPct: existing.retentionPct, ...data };
    calcPaymentApp(merged);
    data.retentionAmount = merged.retentionAmount;
    data.netPayable = merged.netPayable;
    const row = await prisma.paymentApplication.update({ where: { id: req.params.id }, data });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/projects/:projectId/payment-applications/:id', auth, async (req, res) => {
  try {
    if (!hasRole(req, CAN_APPROVE_FINANCE)) return res.status(403).json({ error: `Forbidden: ${req.user?.role || 'this role'} cannot delete payment applications` });
    await prisma.paymentApplication.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// Transition: submit (draft/rejected -> submitted)
app.post('/api/projects/:projectId/payment-applications/:id/submit', auth, async (req, res) => {
  try {
    if (!hasRole(req, CAN_REVIEW_FINANCE)) return res.status(403).json({ error: `Forbidden: ${req.user?.role || 'this role'} cannot submit payment applications` });
    const row = await prisma.paymentApplication.update({ where: { id: req.params.id }, data: { status: 'submitted' } });
    await logApproval(req, 'paymentApplication', row.id, 'submitted', req.body?.comments);
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// Transition: approve (-> approved). Requires financial/owner capability.
app.post('/api/projects/:projectId/payment-applications/:id/approve', auth, async (req, res) => {
  try {
    if (!hasRole(req, CAN_APPROVE_FINANCE)) return res.status(403).json({ error: `Forbidden: ${req.user?.role || 'this role'} cannot approve payment applications` });
    const row = await prisma.paymentApplication.update({
      where: { id: req.params.id },
      data: { status: 'approved', approvedById: req.user?.sub || null, approvedAt: new Date() },
    });
    await logApproval(req, 'paymentApplication', row.id, 'approved', req.body?.comments);
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// Transition: reject (-> rejected).
app.post('/api/projects/:projectId/payment-applications/:id/reject', auth, async (req, res) => {
  try {
    if (!hasRole(req, CAN_APPROVE_FINANCE)) return res.status(403).json({ error: `Forbidden: ${req.user?.role || 'this role'} cannot reject payment applications` });
    const comments = req.body?.comments || null;
    const row = await prisma.paymentApplication.update({
      where: { id: req.params.id },
      data: { status: 'rejected', rejectedById: req.user?.sub || null, rejectedAt: new Date(), comments },
    });
    await logApproval(req, 'paymentApplication', row.id, 'rejected', comments);
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// Transition: markPaid (approved -> paid only). Updates the linked commitment.
app.post('/api/projects/:projectId/payment-applications/:id/mark-paid', auth, async (req, res) => {
  try {
    if (!hasRole(req, CAN_APPROVE_FINANCE)) return res.status(403).json({ error: `Forbidden: ${req.user?.role || 'this role'} cannot mark payment applications paid` });
    const existing = await prisma.paymentApplication.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (existing.status !== 'approved') return res.status(400).json({ error: 'Payment application must be approved before it can be marked paid' });
    const row = await prisma.paymentApplication.update({ where: { id: req.params.id }, data: { status: 'paid' } });
    if (row.commitmentId) await recomputeCommitment(row.commitmentId);
    await logApproval(req, 'paymentApplication', row.id, 'paid', req.body?.comments);
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== RETENTION RECORDS =====
app.get('/api/projects/:projectId/retention', auth, async (req, res) => {
  try {
    const where = {};
    if (req.query.commitmentId) where.commitmentId = req.query.commitmentId;
    else {
      // Scope to the project's commitments when no specific commitment is given.
      const commitments = await prisma.commitment.findMany({ where: { projectId: req.params.projectId }, select: { id: true } });
      where.commitmentId = { in: commitments.map((c) => c.id) };
    }
    res.json(await prisma.retentionRecord.findMany({ where, orderBy: { createdAt: 'desc' } }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/projects/:projectId/retention', auth, async (req, res) => {
  try {
    if (!hasRole(req, CAN_REVIEW_FINANCE)) return res.status(403).json({ error: `Forbidden: ${req.user?.role || 'this role'} cannot create retention records` });
    const { commitmentId, amountHeld } = req.body;
    if (!commitmentId) return res.status(400).json({ error: 'commitmentId required' });
    const held = num(amountHeld) || 0;
    const row = await prisma.retentionRecord.create({ data: { commitmentId, amountHeld: held, amountReleased: 0, remaining: held, status: 'held' } });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// Explicit release action: releases (part of) the held retention.
app.post('/api/projects/:projectId/retention/:id/release', auth, async (req, res) => {
  try {
    if (!hasRole(req, CAN_APPROVE_FINANCE)) return res.status(403).json({ error: `Forbidden: ${req.user?.role || 'this role'} cannot release retention` });
    const existing = await prisma.retentionRecord.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (existing.status === 'released') return res.status(400).json({ error: 'That retention has already been released' });
    const held = Number(existing.amountHeld) || 0;
    const outstanding = Math.max(0, held - (Number(existing.amountReleased) || 0));
    const releaseAmount = req.body?.amount !== undefined ? (num(req.body.amount) || 0) : outstanding;
    if (!(releaseAmount > 0)) return res.status(400).json({ error: 'Enter an amount greater than zero' });
    // Releasing more than is outstanding would invent money. It used to be
    // possible: the amount was added to amountReleased with no ceiling.
    if (releaseAmount > outstanding + 0.01) return res.status(400).json({ error: 'Only ' + outstanding + ' is still held on this record' });
    const amountReleased = Math.round(((Number(existing.amountReleased) || 0) + releaseAmount) * 100) / 100;
    const remaining = Math.round(Math.max(0, held - amountReleased) * 100) / 100;
    const row = await prisma.retentionRecord.update({
      where: { id: req.params.id },
      // releaseDate is the date it FALLS DUE and is set when the schedule is
      // created; overwriting it with today erased that. releasedAt records when it
      // was actually paid, which is a different fact.
      data: { amountReleased, remaining, status: remaining <= 0.009 ? 'released' : 'due', releasedAt: new Date(), releasedById: req.user.sub, note: req.body?.comments || existing.note || null },
    });
    // The subcontract must stop showing money it no longer holds.
    if (existing.commitmentId) {
      const c = await prisma.commitment.findUnique({ where: { id: existing.commitmentId } });
      if (c) {
        const nextHeld = Math.max(0, Math.round(((Number(c.retentionHeld) || 0) - releaseAmount) * 100) / 100);
        await prisma.commitment.update({ where: { id: existing.commitmentId }, data: { retentionHeld: nextHeld } });
      }
    }
    await logApproval(req, 'retentionRecord', row.id, 'released', req.body?.comments);
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== COST CODES =====
app.get('/api/cost-codes', auth, async (_req, res) => {
  try { res.json(await prisma.costCode.findMany({ orderBy: { code: 'asc' } })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/cost-codes', auth, async (req, res) => {
  try {
    const { code, description } = req.body;
    if (!code) return res.status(400).json({ error: 'code required' });
    res.json(await prisma.costCode.create({ data: { code, description } }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/cost-codes/:id', auth, async (req, res) => {
  try {
    const { code, description } = req.body;
    const data = {};
    if (code !== undefined) data.code = code;
    if (description !== undefined) data.description = description;
    res.json(await prisma.costCode.update({ where: { id: req.params.id }, data }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/cost-codes/:id', auth, async (req, res) => {
  try { await prisma.costCode.delete({ where: { id: req.params.id } }); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== APPROVALS (audit trail) =====
app.get('/api/approvals', auth, async (req, res) => {
  try {
    const { entityType, entityId } = req.query;
    const where = {};
    if (entityType) where.entityType = entityType;
    if (entityId) where.entityId = entityId;
    res.json(await prisma.approval.findMany({ where, orderBy: { createdAt: 'desc' } }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Documents (global or per-project)
app.get('/api/documents', auth, async (req, res) => {
  try {
    const where = {};
    if (req.query.projectId) where.projectId = String(req.query.projectId);
    // Documents uploaded before files were filed per project have no projectId,
    // so they appear in no project's folders. ?unfiled=1 finds them.
    else if (req.query.unfiled === '1') where.projectId = null;
    if (req.query.category) where.category = String(req.query.category);
    const rows = await prisma.document.findMany({ where, orderBy: { updatedAt: 'desc' } });
    res.json(rows || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/documents', auth, async (req, res) => {
  try {
    const { name, url, size, updated, projectId, category, linkedType, linkedId, note } = req.body;
    const row = await prisma.document.create({ data: {
      name, url, size, updated, projectId: projectId || null,
      category: category || 'general', linkedType: linkedType || null, linkedId: linkedId || null, note: note || null,
      uploadedBy: (req.user && (req.user.name || req.user.email)) || null,
    } });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/documents/:id', auth, async (req, res) => {
  try {
    await prisma.document.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// The absolute, browser-loadable URL for a locally-stored file. Returning a
// bare "/uploads/x.jpg" made every caller responsible for prefixing the API
// origin, and the ones that forgot produced a path resolved against the
// FRONTEND origin — a 404 that looked exactly like "the upload did nothing".
// PUBLIC_API_URL wins when set (custom domain / proxy in front of the API);
// otherwise the request's own host is correct by construction.
const localFileUrl = (req, filename) => {
  const base = process.env.PUBLIC_API_URL
    ? String(process.env.PUBLIC_API_URL).replace(/\/$/, '')
    : `${req.headers['x-forwarded-proto'] || req.protocol}://${req.headers['x-forwarded-host'] || req.get('host')}`;
  return `${base}/uploads/${filename}`;
};

// Store one staged multer file and return its public URL. Shared by the single
// and batch endpoints so both behave identically.
// What may be uploaded, and how big. The browser checks the same limits
// (src/app/services/uploadPolicy.ts) but a script can skip the browser, so the
// server refuses too. A daily allowance per account stops anyone using Buildsasa
// as free bulk storage; it lives in memory and resets each day per instance,
// which is enough to stop abuse without bothering anyone with real work to do.
const UPLOAD_TYPES = /^(image\/|video\/|application\/pdf$|application\/(msword|vnd\.openxmlformats-officedocument\.|vnd\.ms-excel|vnd\.ms-powerpoint)|text\/(csv|plain)$)/i;
const UPLOAD_EXT = /\.(jpe?g|png|webp|heic|heif|gif|mp4|mov|webm|m4v|3gp|pdf|docx?|xlsx?|pptx?|csv|txt|dwg|dxf|ifc|zip)$/i;
const UPLOAD_CAP_MB = { image: 15, video: 20, other: MAX_UPLOAD_MB };
const DAILY_UPLOAD_MB = { team: Number(process.env.DAILY_UPLOAD_MB || 1000), client: Number(process.env.DAILY_UPLOAD_MB_CLIENT || 300) };
const uploadUsage = new Map(); // `${userId}:${day}` -> bytes
function uploadRejectReason(req, file) {
  const mb = file.size / (1024 * 1024);
  const kind = /^image\//i.test(file.mimetype) ? 'image' : /^video\//i.test(file.mimetype) ? 'video' : 'other';
  if (!UPLOAD_TYPES.test(file.mimetype || '') && !UPLOAD_EXT.test(file.originalname || '')) return `${file.originalname}: this type of file can't be uploaded. Use photos, short videos, PDFs, Office documents or drawings.`;
  if (mb > UPLOAD_CAP_MB[kind]) return kind === 'video'
    ? `${file.originalname} is ${mb.toFixed(0)} MB. Videos must be under ${UPLOAD_CAP_MB.video} MB: record a shorter clip (30–60 seconds).`
    : `${file.originalname} is ${mb.toFixed(0)} MB. ${kind === 'image' ? 'Photos' : 'Files'} must be under ${UPLOAD_CAP_MB[kind]} MB.`;
  const who = (req.user && (req.user.sub || req.user.id)) || 'anon';
  const k = `${who}:${new Date().toISOString().slice(0, 10)}`;
  const used = uploadUsage.get(k) || 0;
  const cap = (req.user && req.user.role === 'Client' ? DAILY_UPLOAD_MB.client : DAILY_UPLOAD_MB.team) * 1024 * 1024;
  if (used + file.size > cap) return `You've reached today's upload allowance (${Math.round(cap / 1048576)} MB). Try again tomorrow, or contact Buildsasa support if you need more.`;
  uploadUsage.set(k, used + file.size);
  if (uploadUsage.size > 5000) for (const key of uploadUsage.keys()) if (!key.endsWith(new Date().toISOString().slice(0, 10))) uploadUsage.delete(key);
  return null;
}

async function storeUploadedFile(req, file) {
  const fs = require('fs');
  const why = uploadRejectReason(req, file);
  if (why) { fs.unlink(file.path, () => {}); const e = new Error(why); e.status = 400; throw e; }
  // With object storage configured the browser never talks to the bucket: multer
  // stages the file on disk, this forwards it, and the temp copy is deleted. No
  // bucket CORS policy is needed, and nothing durable is left on the container
  // filesystem — which a deploy would wipe anyway.
  if (s3) {
    const Key = storageKeyFor(file.originalname);
    try {
      await s3.putObject({
        Bucket: process.env.S3_BUCKET,
        Key,
        Body: fs.createReadStream(file.path),
        ContentType: file.mimetype || 'application/octet-stream',
      }).promise();
      return { url: publicUrlFor(Key), key: Key, name: file.originalname, size: file.size, type: file.mimetype };
    } finally {
      fs.unlink(file.path, () => {});
    }
  }
  // Local disk. Confirm the bytes actually landed — a silent write failure here
  // is the difference between a working URL and a 404 discovered days later.
  if (!fs.existsSync(file.path)) throw new Error('the file was not written to disk');
  return { url: localFileUrl(req, file.filename), key: file.filename, name: file.originalname, size: file.size, type: file.mimetype };
}

app.post('/api/upload', auth, singleFile('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file was received — the form field must be named "file"' });
  try {
    const stored = await storeUploadedFile(req, req.file);
    res.json(stored);
  } catch (e) {
    if (e && e.status === 400) return res.status(400).json({ error: e.message });
    console.error('[upload] store failed:', (e && e.code) || '', (e && e.message) || e);
    res.status(502).json({ error: `Could not store ${req.file.originalname}: ${(e && e.message) || 'unknown error'}` });
  }
});

// Batch upload. One request instead of N means a multi-photo pick from a phone
// is a single round trip, and a partial failure is reported per file rather than
// aborting the whole set.
app.post('/api/upload/batch', auth, manyFiles('file'), async (req, res) => {
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'No files were received — the form field must be named "file"' });
  const uploaded = [];
  const failed = [];
  for (const f of files) {
    try { uploaded.push(await storeUploadedFile(req, f)); }
    catch (e) {
      console.error('[upload] store failed:', (e && e.message) || e);
      failed.push({ name: f.originalname, error: (e && e.message) || 'unknown error' });
    }
  }
  if (!uploaded.length) return res.status(502).json({ error: `No file could be stored: ${failed.map((f) => `${f.name} (${f.error})`).join(', ')}`, failed });
  res.json({ uploaded, failed });
});

// S3 presign endpoint (use when S3_BUCKET is configured)
app.post('/api/upload/presign', auth, async (req, res) => {
  if (!s3 || !process.env.S3_BUCKET) return res.status(500).json({ error: 'S3 not configured' });
  const { filename, contentType } = req.body;
  if (!filename || !contentType) return res.status(400).json({ error: 'filename and contentType required' });
  const Key = storageKeyFor(filename);
  const params = {
    Bucket: process.env.S3_BUCKET,
    Key,
    Expires: 300,
    ContentType: contentType,
  };
  try {
    const url = await s3.getSignedUrlPromise('putObject', params);
    res.json({ url, publicUrl: publicUrlFor(Key), fields: {} });
  } catch (e) {
    console.error('[upload] presign failed:', (e && e.message) || e);
    res.status(500).json({ error: `Failed to presign upload: ${(e && e.message) || 'unknown error'}` });
  }
});

// Storage self-test — platform staff only. Answers "is object storage actually
// working?" with a real round trip rather than a guess: it writes a small object,
// reads it back over the public URL, then deletes it. Each step is reported
// separately, so a signing/credential failure, a private bucket, and a wrong
// public URL are told apart instead of all surfacing as "upload failed".
app.get('/api/admin/storage-check', auth, async (req, res) => {
  if (!isPlatformAdmin(req.user && req.user.email)) return res.status(403).json({ error: 'Platform admin only' });
  const out = {
    mode: s3 ? 'object-storage' : 'local-disk',
    bucket: process.env.S3_BUCKET || null,
    endpoint: process.env.S3_ENDPOINT || null,
    region: process.env.AWS_REGION || null,
    publicBase: process.env.S3_PUBLIC_BASE || null,
    uploadDir: s3 ? null : UPLOAD_DIR,
    localDiskIsEphemeral: !s3 && !process.env.UPLOAD_DIR,
    steps: {},
  };
  if (!s3) {
    out.steps.note = 'S3_BUCKET is not set, so uploads are written to the container disk.';
    return res.json(out);
  }
  const Key = `${process.env.S3_UPLOAD_PREFIX || 'uploads/'}_storage-check-${Date.now()}.txt`;
  const url = publicUrlFor(Key);
  out.testUrl = url;
  try {
    await s3.putObject({ Bucket: process.env.S3_BUCKET, Key, Body: 'buildsasa storage check', ContentType: 'text/plain' }).promise();
    out.steps.write = 'ok';
  } catch (e) {
    out.steps.write = `FAILED — ${(e && e.code) || ''} ${(e && e.message) || e}`.trim();
    return res.json(out); // nothing else is meaningful once the write failed
  }
  try {
    const r = await fetch(url);
    out.steps.publicRead = r.ok
      ? 'ok'
      : `FAILED — HTTP ${r.status}. The object was stored, but is not publicly readable at this URL. Either make the bucket public or set S3_PUBLIC_BASE to the correct host.`;
  } catch (e) {
    out.steps.publicRead = `FAILED — ${(e && e.message) || e}`;
  }
  try {
    await s3.deleteObject({ Bucket: process.env.S3_BUCKET, Key }).promise();
    out.steps.cleanup = 'ok';
  } catch (e) {
    out.steps.cleanup = `left behind — ${(e && e.message) || e}`;
  }
  res.json(out);
});

// ===== BIDS =====
app.get('/api/projects/:projectId/bids', auth, async (req, res) => {
  try {
    const rows = await prisma.bid.findMany({ where: { projectId: req.params.projectId }, orderBy: { createdAt: 'desc' } });
    res.json(rows || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/projects/:projectId/bids', auth, async (req, res) => {
  try {
    const { subcontractor, trade, amount, status, notes, fileUrl, submittedAt } = req.body;
    const row = await prisma.bid.create({ data: { subcontractor, trade, amount: Number(amount), status, notes, fileUrl, submittedAt, projectId: req.params.projectId } });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/projects/:projectId/bids/:id', auth, async (req, res) => {
  try {
    const { subcontractor, trade, amount, status, notes, fileUrl, submittedAt } = req.body;
    const row = await prisma.bid.update({ where: { id: req.params.id }, data: { subcontractor, trade, amount: Number(amount), status, notes, fileUrl, submittedAt } });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/projects/:projectId/bids/:id', auth, async (req, res) => {
  try {
    await prisma.bid.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== BID PACKAGES (internal tendering) =====
// A company posts a tender (bid package) on a project, shares a public bid link
// so subcontractors can submit without an account, receives bids, and awards one.
// Who may create/edit/delete/award a bid package. Mirrors the create-CO role
// list (owners are Contractors/Executives here) plus the explicit Owner role.
// MIRRORS BID_MANAGER_ROLES / BID_AWARDER_ROLES in
// src/app/components/constructai/roles.ts. Keep them in step: the UI gates its
// buttons on those lists and this gates the API. They previously disagreed, so an
// Architect and a Quantity Surveyor were shown tender controls that always 403d.
//
// Running a tender (write, publish, log offline bids, shortlist, decline) is
// tender administration — a QS or Architect does this in normal practice.
const CAN_MANAGE_BIDS = ['Contractor', 'Owner', 'Executive', 'Project Manager', 'Superintendent', 'Quantity Surveyor', 'Architect'];
// Awarding commits the company to a contract, so it stays with the principals.
// A QS or Architect recommends; they do not sign.
const CAN_AWARD_BIDS = ['Contractor', 'Owner', 'Executive', 'Project Manager', 'Superintendent'];
const BID_PKG_FIELDS = ['projectId', 'title', 'trade', 'description', 'dueDate', 'status'];

// Has the tender's deadline passed? dueDate is a plain "YYYY-MM-DD" string, so
// bids are accepted up to the end of that day. No dueDate = no deadline.
function isTenderClosed(dueDate) {
  if (!dueDate) return false;
  const end = new Date(`${String(dueDate).slice(0, 10)}T23:59:59.999Z`);
  if (Number.isNaN(end.getTime())) return false; // unparseable: don't block anyone
  return Date.now() > end.getTime();
}
const pickBidPackage = (b) => {
  const d = {};
  for (const f of BID_PKG_FIELDS) if (b[f] !== undefined) d[f] = b[f];
  if (b.budgetKES !== undefined) d.budgetKES = b.budgetKES == null || b.budgetKES === '' ? null : Number(b.budgetKES);
  return d;
};

// List packages (filter by ?projectId=), newest first.
app.get('/api/bid-packages', auth, async (req, res) => {
  try {
    const { projectId } = req.query;
    const where = {};
    if (projectId) where.projectId = projectId;
    res.json(await prisma.bidPackage.findMany({ where, orderBy: { createdAt: 'desc' }, include: { bids: true } }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Single package, including its bids.
app.get('/api/bid-packages/:id', auth, async (req, res) => {
  try {
    const row = await prisma.bidPackage.findUnique({ where: { id: req.params.id }, include: { bids: { orderBy: { createdAt: 'desc' } } } });
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/bid-packages', auth, async (req, res) => {
  try {
    if (!hasRole(req, CAN_MANAGE_BIDS)) return res.status(403).json({ error: `Forbidden: ${req.user?.role || 'this role'} cannot create bid packages` });
    const d = pickBidPackage(req.body);
    if (!d.projectId) return res.status(400).json({ error: 'projectId required' });
    if (!d.title) return res.status(400).json({ error: 'title required' });
    if (!d.status) d.status = 'open';
    res.json(await prisma.bidPackage.create({ data: d }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/bid-packages/:id', auth, async (req, res) => {
  try {
    if (!hasRole(req, CAN_MANAGE_BIDS)) return res.status(403).json({ error: `Forbidden: ${req.user?.role || 'this role'} cannot edit bid packages` });
    res.json(await prisma.bidPackage.update({ where: { id: req.params.id }, data: pickBidPackage(req.body) }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/bid-packages/:id', auth, async (req, res) => {
  try {
    if (!hasRole(req, CAN_MANAGE_BIDS)) return res.status(403).json({ error: `Forbidden: ${req.user?.role || 'this role'} cannot delete bid packages` });
    await prisma.bidPackage.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Generate (or return existing) a public bid link for the package.
app.post('/api/bid-packages/:id/share', auth, async (req, res) => {
  try {
    if (!hasRole(req, CAN_MANAGE_BIDS)) return res.status(403).json({ error: `Forbidden: ${req.user?.role || 'this role'} cannot share bid packages` });
    const pkg = await prisma.bidPackage.findUnique({ where: { id: req.params.id } });
    if (!pkg) return res.status(404).json({ error: 'Not found' });
    const token = pkg.publicToken || require('crypto').randomBytes(9).toString('base64url');
    const updated = pkg.publicToken ? pkg : await prisma.bidPackage.update({ where: { id: pkg.id }, data: { publicToken: token } });
    res.json({ token: updated.publicToken, url: `${APP_URL}/?bid=${updated.publicToken}` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Internally log an (offline) bid against a package.
app.post('/api/bid-packages/:id/bids', auth, async (req, res) => {
  try {
    if (!hasRole(req, CAN_MANAGE_BIDS)) return res.status(403).json({ error: `Forbidden: ${req.user?.role || 'this role'} cannot add bids` });
    const pkg = await prisma.bidPackage.findUnique({ where: { id: req.params.id } });
    if (!pkg) return res.status(404).json({ error: 'Not found' });
    const { subcontractor, contactName, trade, amount, status, notes, fileUrl, submittedAt, contactEmail, contactPhone } = req.body || {};
    const row = await prisma.bid.create({ data: {
      subcontractor: subcontractor || contactName || 'Unknown',
      trade: trade || pkg.trade || 'General',
      amount: Number(amount) || 0,
      status: status || 'submitted',
      notes: notes || null,
      fileUrl: fileUrl || null,
      submittedAt: submittedAt || new Date().toISOString(),
      contactName: contactName || null,
      contactEmail: contactEmail || null,
      contactPhone: contactPhone || null,
      bidPackageId: pkg.id,
      projectId: pkg.projectId,
    } });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Award a bid: marks the package awarded, the chosen bid awarded, the rest rejected.
app.post('/api/bid-packages/:id/award', auth, async (req, res) => {
  try {
    if (!hasRole(req, CAN_AWARD_BIDS)) return res.status(403).json({ error: `Forbidden: ${req.user?.role || 'this role'} cannot award bids. Awarding a contract is limited to ${CAN_AWARD_BIDS.join(', ')}.` });
    const { bidId } = req.body || {};
    if (!bidId) return res.status(400).json({ error: 'bidId required' });
    const pkg = await prisma.bidPackage.findUnique({ where: { id: req.params.id }, include: { bids: true } });
    if (!pkg) return res.status(404).json({ error: 'Not found' });
    const winner = pkg.bids.find((b) => b.id === bidId);
    if (!winner) return res.status(400).json({ error: 'That bid does not belong to this package' });
    for (const b of pkg.bids) {
      // Losing bids are marked 'declined', matching the /respond route. The two
      // paths used to write different words ('rejected' here, 'declined' there)
      // for the same outcome.
      await prisma.bid.update({ where: { id: b.id }, data: { status: b.id === bidId ? 'awarded' : 'declined' } });
    }
    const updated = await prisma.bidPackage.update({ where: { id: pkg.id }, data: { awardedBidId: bidId, status: 'awarded' }, include: { bids: { orderBy: { createdAt: 'desc' } } } });

    // Awarding used to end here: statuses changed, emails went out, and the winner
    // existed nowhere else in the system. The tender dead-ended — nobody was
    // actually engaged, there was no contract to invoice against, and the winning
    // company was not even in the directory. An award now creates the two records
    // the rest of the product needs:
    //
    //   1. a Commitment — the subcontract itself, which Financials tracks and
    //      payment applications draw against;
    //   2. a DirectoryContact — so the company is a real contact, not just a name
    //      on a bid.
    //
    // Both are idempotent-ish and reported back rather than silently swallowed, so
    // re-awarding does not stack duplicates and a failure is visible.
    const vendorName = winner.subcontractor || winner.contactName || 'Awarded bidder';
    let commitment = null;
    let contact = null;
    try {
      const already = await prisma.commitment.findFirst({ where: { projectId: pkg.projectId, vendor: vendorName, scope: pkg.title } });
      commitment = already || await prisma.commitment.create({ data: {
        vendor: vendorName,
        scope: pkg.title,
        amount: String(winner.amount ?? 0),
        due: pkg.dueDate || '',
        contractValue: Number(winner.amount) || 0,
        balanceRemaining: Number(winner.amount) || 0,
        status: 'active',
        projectId: pkg.projectId,
      } });
    } catch (e) { console.error('[BID] award -> commitment failed:', e && e.message); }
    try {
      const existing = winner.contactEmail
        ? await prisma.directoryContact.findFirst({ where: { email: winner.contactEmail } })
        : await prisma.directoryContact.findFirst({ where: { name: vendorName, category: 'Subcontractor' } });
      contact = existing || await prisma.directoryContact.create({ data: {
        name: vendorName,
        company: vendorName,
        role: winner.trade || pkg.trade || null,
        category: 'Subcontractor',
        phone: winner.contactPhone || null,
        email: winner.contactEmail || null,
      } });
    } catch (e) { console.error('[BID] award -> directory contact failed:', e && e.message); }
    // Notify bidders of the outcome. Each send is isolated so one failure never
    // breaks the response or stops the others.
    const fmtKES = (n) => 'KSh ' + Number(n || 0).toLocaleString('en-KE');
    for (const b of pkg.bids) {
      if (!b.contactEmail) continue;
      const isWinner = b.id === bidId;
      try {
        await sendEmail({
          to: b.contactEmail,
          subject: isWinner ? `Your bid for ${pkg.title} was accepted` : `Update on your bid for ${pkg.title} — not selected this time`,
          html: emailShell(
            isWinner ? 'Your bid was accepted' : 'Update on your bid',
            isWinner
              ? `<p>Good news — your bid of ${fmtKES(b.amount)} for <strong>${pkg.title}</strong> has been accepted. The team will be in touch with next steps.</p>${button(APP_URL, 'View details')}`
              : `<p>Thank you for bidding on <strong>${pkg.title}</strong>. After review, your bid was not selected this time. We appreciate your effort and hope to work with you on a future tender.</p>`
          ),
        });
      } catch (e) { console.error('[BID] award outcome email failed:', e && e.message); }
    }
    // Report what the award created so the UI can say so plainly, rather than the
    // caller having to guess whether the follow-on records exist.
    res.json({ ...updated, awardedTo: vendorName, commitmentId: commitment?.id || null, contactId: contact?.id || null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Respond to an individual bid: shortlist, decline (with optional reason), or
// reset to submitted. Manage-gated like award. Declines email the bidder.
app.post('/api/bid-packages/:id/bids/:bidId/respond', auth, async (req, res) => {
  try {
    if (!hasRole(req, CAN_MANAGE_BIDS)) return res.status(403).json({ error: `Forbidden: ${req.user?.role || 'this role'} cannot respond to bids` });
    const { status, reason } = req.body || {};
    const ALLOWED = ['submitted', 'shortlisted', 'declined'];
    if (!ALLOWED.includes(status)) return res.status(400).json({ error: `status must be one of: ${ALLOWED.join(', ')}` });
    const pkg = await prisma.bidPackage.findUnique({ where: { id: req.params.id }, include: { bids: true } });
    if (!pkg) return res.status(404).json({ error: 'Not found' });
    const bid = pkg.bids.find((b) => b.id === req.params.bidId);
    if (!bid) return res.status(400).json({ error: 'That bid does not belong to this package' });
    const data = { status };
    if (reason && String(reason).trim()) {
      const line = `[Decline reason] ${String(reason).trim()}`;
      data.notes = bid.notes ? `${bid.notes}\n${line}` : line;
    }
    const updated = await prisma.bid.update({ where: { id: bid.id }, data });
    if (status === 'declined' && updated.contactEmail) {
      try {
        await sendEmail({
          to: updated.contactEmail,
          subject: `Update on your bid for ${pkg.title} — not selected`,
          html: emailShell(
            'Update on your bid',
            `<p>Thank you for bidding on <strong>${pkg.title}</strong>. After review, your bid was not selected.</p>${reason && String(reason).trim() ? `<p><strong>Reason:</strong> ${String(reason).trim()}</p>` : ''}<p>We appreciate your effort and hope to work with you on a future tender.</p>`
          ),
        });
      } catch (e) { console.error('[BID] decline email failed:', e && e.message); }
    }
    res.json(updated);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ----- PUBLIC bid endpoints (NO auth) -----
// Mirrors the public-forms pattern: there is no auth middleware, so wsStore has
// no store and currentWs() is null — the Prisma tenant extension passes through
// (behaves like prismaBase). The package is resolved by its unguessable token,
// and on create we explicitly stamp the package's workspaceId + projectId since
// nothing else will. Reads only ever return the single token-matched package, so
// no other tenant's data can leak.

// Public: fetch a shared bid package by token. Only when it's open for bidding.
app.get('/api/public/bids/:token', async (req, res) => {
  try {
    const pkg = await prisma.bidPackage.findUnique({ where: { publicToken: req.params.token } });
    if (!pkg || pkg.status !== 'open') return res.status(404).json({ error: 'This tender is not available.' });
    let companyName = null;
    if (pkg.workspaceId) {
      const ws = await prismaBase.workspace.findUnique({ where: { id: pkg.workspaceId }, select: { name: true } });
      companyName = ws ? ws.name : null;
    }
    res.json({
      title: pkg.title,
      trade: pkg.trade,
      description: pkg.description,
      budgetKES: pkg.budgetKES,
      dueDate: pkg.dueDate,
      status: pkg.status,
      companyName,
      // Told to the bidder up front, so a closed tender explains itself instead of
      // presenting a form that will be refused on submit.
      closed: isTenderClosed(pkg.dueDate),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Public: submit a bid against a shared package. Only when it's open AND the
// deadline has not passed.
app.post('/api/public/bids/:token', async (req, res) => {
  try {
    const pkg = await prisma.bidPackage.findUnique({ where: { publicToken: req.params.token } });
    if (!pkg || pkg.status !== 'open') return res.status(404).json({ error: 'This tender is not accepting bids.' });
    // The deadline was stored and displayed but never enforced, so a tender could
    // take bids indefinitely after the date it advertised. A late bid arriving
    // after others have been opened is exactly the unfairness a deadline exists to
    // prevent. Bids are accepted up to the END of the due date.
    if (isTenderClosed(pkg.dueDate)) {
      return res.status(409).json({ error: 'The deadline for this tender has passed, so it is no longer accepting bids.' });
    }
    const b = req.body || {};
    const name = b.subcontractor || b.contactName;
    if (!name) return res.status(400).json({ error: 'Your name or company is required' });
    if (b.amount == null || b.amount === '') return res.status(400).json({ error: 'A bid amount is required' });
    const row = await prismaBase.bid.create({ data: {
      subcontractor: String(name).slice(0, 200),
      trade: (b.trade || pkg.trade || 'General'),
      amount: Number(b.amount) || 0,
      status: 'submitted',
      notes: b.notes ? String(b.notes) : null,
      fileUrl: b.fileUrl ? String(b.fileUrl) : null,
      submittedAt: new Date().toISOString(),
      contactName: b.contactName ? String(b.contactName).slice(0, 200) : (b.subcontractor ? String(b.subcontractor).slice(0, 200) : null),
      contactEmail: b.contactEmail ? String(b.contactEmail).slice(0, 200) : null,
      contactPhone: b.contactPhone ? String(b.contactPhone).slice(0, 60) : null,
      bidPackageId: pkg.id,
      projectId: pkg.projectId,
      workspaceId: pkg.workspaceId,
    } });
    // Notifications. This is a PUBLIC route with no ws context, so use prismaBase
    // and the package's workspaceId. Each send is isolated in its own try/catch so
    // an email failure can never break the public bid submission.
    const fmtKES = (n) => 'KSh ' + Number(n || 0).toLocaleString('en-KE');
    const bidderLabel = row.subcontractor || row.contactName || 'a subcontractor';
    // (a) Notify the company's bid managers.
    try {
      if (pkg.workspaceId) {
        const managers = await prismaBase.user.findMany({ where: { workspaceId: pkg.workspaceId, role: { in: CAN_MANAGE_BIDS } }, select: { email: true, name: true } });
        for (const m of managers) {
          if (!m.email) continue;
          try {
            await sendEmail({
              to: m.email,
              subject: `New bid received for ${pkg.title} from ${bidderLabel} — ${fmtKES(row.amount)}`,
              html: emailShell(
                'New bid received',
                `<p><strong>${bidderLabel}</strong> submitted a bid of ${fmtKES(row.amount)} for <strong>${pkg.title}</strong>.</p>${button(APP_URL, 'Review bids')}`
              ),
            });
          } catch (e) { console.error('[BID] manager notify email failed:', e && e.message); }
        }
      }
    } catch (e) { console.error('[BID] manager lookup failed:', e && e.message); }
    // (b) Confirm receipt to the bidder.
    try {
      if (row.contactEmail) {
        await sendEmail({
          to: row.contactEmail,
          subject: `We've received your bid for ${pkg.title}`,
          html: emailShell(
            'Bid received',
            `<p>Thank you, ${bidderLabel}. We've received your bid of ${fmtKES(row.amount)} for <strong>${pkg.title}</strong> and it's now under review. We'll be in touch about the outcome.</p>`
          ),
        });
      }
    } catch (e) { console.error('[BID] bidder confirmation email failed:', e && e.message); }
    res.json({ ok: true, id: row.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== INVOICES =====
app.get('/api/projects/:projectId/invoices', auth, async (req, res) => {
  try {
    const rows = await prisma.invoice.findMany({ where: { projectId: req.params.projectId }, orderBy: { createdAt: 'desc' } });
    res.json(rows || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// Coerce a numeric field: empty string / null / undefined -> null, else Number.
const invNum = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
app.post('/api/projects/:projectId/invoices', auth, async (req, res) => {
  try {
    const b = req.body;
    const row = await prisma.invoice.create({
      data: {
        invoiceNumber: b.invoiceNumber,
        clientName: b.clientName,
        amount: Math.round(Number(b.amount) || 0),
        status: b.status,
        issueDate: b.issueDate,
        dueDate: b.dueDate,
        items: b.items,
        notes: b.notes,
        billToAddress: b.billToAddress,
        shipTo: b.shipTo,
        poNumber: b.poNumber,
        paymentTerms: b.paymentTerms,
        terms: b.terms,
        taxRate: invNum(b.taxRate),
        discount: invNum(b.discount),
        shipping: invNum(b.shipping),
        subtotal: invNum(b.subtotal),
        paidAmount: b.paidAmount === undefined ? null : Math.round(Number(b.paidAmount) || 0),
        paidDate: b.paidDate,
        projectId: req.params.projectId,
      },
    });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/projects/:projectId/invoices/:id', auth, async (req, res) => {
  try {
    // Partial update — only touch provided fields (so "record payment" doesn't wipe others).
    const data = {};
    for (const f of ['invoiceNumber', 'clientName', 'status', 'issueDate', 'dueDate', 'items', 'notes', 'paidDate', 'billToAddress', 'shipTo', 'poNumber', 'paymentTerms', 'terms']) if (req.body[f] !== undefined) data[f] = req.body[f];
    for (const f of ['taxRate', 'discount', 'shipping', 'subtotal']) if (req.body[f] !== undefined) data[f] = invNum(req.body[f]);
    if (req.body.amount !== undefined) data.amount = Math.round(Number(req.body.amount) || 0);
    if (req.body.paidAmount !== undefined) data.paidAmount = req.body.paidAmount === null ? null : Math.round(Number(req.body.paidAmount) || 0);
    const row = await prisma.invoice.update({ where: { id: req.params.id }, data });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/projects/:projectId/invoices/:id', auth, async (req, res) => {
  try {
    await prisma.invoice.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== COMPANY PROFILE =====
// The workspace's own name, logo and contact details, printed on quotes and
// invoices and shown on the client's quote page and portal.
const CAN_EDIT_COMPANY = ['Contractor', 'Executive'];
const COMPANY_FIELDS = ['name', 'logoUrl', 'phone', 'email', 'address', 'kraPin', 'paymentDetails', 'quoteTerms', 'services', 'about'];
const companyPublic = (w) => (w ? { name: w.name, logoUrl: w.logoUrl, phone: w.phone, email: w.email, address: w.address, kraPin: w.kraPin, paymentDetails: w.paymentDetails } : null);
async function companyFor(workspaceId) {
  if (!workspaceId) return null;
  return prismaBase.workspace.findUnique({ where: { id: workspaceId } });
}

app.get('/api/company', auth, async (req, res) => {
  try {
    const w = await companyFor(currentWs());
    if (!w) return res.status(404).json({ error: 'No company for this account' });
    const out = {};
    for (const k of COMPANY_FIELDS) out[k] = w[k] ?? null;
    res.json({ ...out, canEdit: hasRole(req, CAN_EDIT_COMPANY) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/company', auth, async (req, res) => {
  try {
    if (!hasRole(req, CAN_EDIT_COMPANY)) return res.status(403).json({ error: 'Only the company owner or an executive can edit the company profile' });
    const ws = currentWs();
    if (!ws) return res.status(404).json({ error: 'No company for this account' });
    const b = req.body || {};
    const data = {};
    for (const k of COMPANY_FIELDS) {
      if (b[k] === undefined) continue;
      const v = b[k] == null ? '' : String(b[k]).trim();
      data[k] = v ? v.slice(0, ['quoteTerms', 'paymentDetails', 'address', 'services', 'about'].includes(k) ? 2000 : 300) : null;
    }
    if (data.name === null) return res.status(400).json({ error: 'The company name cannot be empty' });
    if (data.logoUrl && /^(blob:|data:)/i.test(data.logoUrl)) return res.status(400).json({ error: 'Upload the logo first' });
    const w = await prismaBase.workspace.update({ where: { id: ws }, data });
    const out = {};
    for (const k of COMPANY_FIELDS) out[k] = w[k] ?? null;
    res.json({ ...out, canEdit: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// The logo as a data URL, for PDFs built in the browser. Fetched here because
// the storage bucket does not send CORS headers, so the browser can't read the
// image bytes itself.
app.get('/api/company/logo-data', auth, async (req, res) => {
  try {
    const w = await companyFor(currentWs());
    if (!w || !w.logoUrl) return res.json({ dataUrl: null });
    let url = w.logoUrl;
    if (url.startsWith('/')) url = `${req.protocol}://${req.get('host')}${url}`;
    const r = await fetch(url);
    if (!r.ok) return res.json({ dataUrl: null });
    const type = (r.headers.get('content-type') || '').split(';')[0];
    if (!/^image\/(png|jpe?g)$/.test(type)) return res.json({ dataUrl: null, reason: 'Logo must be a PNG or JPG to appear on PDFs' });
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 3 * 1024 * 1024) return res.json({ dataUrl: null, reason: 'Logo is too large for PDFs' });
    res.json({ dataUrl: `data:${type};base64,${buf.toString('base64')}` });
  } catch (e) { res.json({ dataUrl: null }); }
});

// ===== QUOTES =====
// Priced offers made before a project exists. The client opens a share link
// (/?quote=<token>) to accept or decline; an accepted quote converts into a
// project whose BOQ is the quote's lines, plus a deposit invoice.
const CAN_MANAGE_QUOTES = ['Contractor', 'Owner', 'Executive', 'Project Manager', 'Superintendent', 'Quantity Surveyor', 'Architect'];
const QUOTE_FIELDS = ['title', 'clientName', 'clientPhone', 'clientEmail', 'clientAddress', 'validUntil', 'notes', 'terms'];
const quoteNum = (v) => (v === undefined || v === null || v === '' ? null : Number(v) || 0);

// Lines are re-priced here, never trusted from the client, so the stored totals
// and the PDF/public page always agree with the lines they show.
function priceQuote(rawItems, discount, taxRate) {
  const items = (Array.isArray(rawItems) ? rawItems : [])
    .map((i) => ({
      section: String(i.section || '').trim().slice(0, 120),
      description: String(i.description || '').trim().slice(0, 1000),
      unit: String(i.unit || 'item').trim().slice(0, 20) || 'item',
      quantity: Number(i.quantity) || 0,
      rate: Number(i.rate) || 0,
    }))
    .filter((i) => i.description);
  const subtotal = items.reduce((s, i) => s + i.quantity * i.rate, 0);
  const disc = Math.max(0, Number(discount) || 0);
  const tax = Math.max(0, Number(taxRate) || 0);
  const total = Math.max(0, (subtotal - disc) * (1 + tax / 100));
  return { items, subtotal: Math.round(subtotal * 100) / 100, total: Math.round(total * 100) / 100 };
}

// A sent quote past its valid-until date reads as expired; nothing is stored.
const isExpired = (q) => q.status === 'sent' && q.validUntil && q.validUntil < new Date().toISOString().slice(0, 10);
const quoteDto = (q) => ({ ...q, items: (() => { try { return JSON.parse(q.items || '[]'); } catch { return []; } })(), status: isExpired(q) ? 'expired' : q.status });

async function nextQuoteNumber() {
  const rows = await prisma.quote.findMany({ select: { quoteNumber: true } });
  const max = rows.reduce((m, r) => Math.max(m, Number(String(r.quoteNumber).replace(/\D/g, '')) || 0), 0);
  return 'Q-' + String(max + 1).padStart(4, '0');
}

app.get('/api/quotes', auth, async (req, res) => {
  try {
    const rows = await prisma.quote.findMany({ orderBy: { createdAt: 'desc' } });
    // The company name heads the quote PDF the browser builds.
    const ws = await companyFor(currentWs());
    res.json({ companyName: ws ? ws.name : null, company: companyPublic(ws), defaultTerms: ws ? ws.quoteTerms : null, quotes: rows.map(quoteDto) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/quotes', auth, async (req, res) => {
  try {
    if (!hasRole(req, CAN_MANAGE_QUOTES)) return res.status(403).json({ error: 'Your role cannot create quotes' });
    const b = req.body || {};
    if (!String(b.title || '').trim() || !String(b.clientName || '').trim()) return res.status(400).json({ error: 'A job title and client name are required' });
    const priced = priceQuote(b.items, b.discount, b.taxRate);
    if (!priced.items.length) return res.status(400).json({ error: 'Add at least one line item' });
    const data = { status: 'draft' };
    for (const k of QUOTE_FIELDS) data[k] = b[k] ? String(b[k]).trim() : null;
    Object.assign(data, { items: JSON.stringify(priced.items), subtotal: priced.subtotal, total: priced.total, discount: quoteNum(b.discount), taxRate: quoteNum(b.taxRate), depositPercent: quoteNum(b.depositPercent) });
    // Two people saving at once can race to the same number; retry.
    for (let attempt = 0; ; attempt++) {
      try {
        const row = await prisma.quote.create({ data: { ...data, quoteNumber: await nextQuoteNumber() } });
        return res.json(quoteDto(row));
      } catch (e) { if (e.code !== 'P2002' || attempt > 1) throw e; }
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/quotes/:id', auth, async (req, res) => {
  try {
    if (!hasRole(req, CAN_MANAGE_QUOTES)) return res.status(403).json({ error: 'Your role cannot edit quotes' });
    const cur = await prisma.quote.findUnique({ where: { id: req.params.id } });
    if (!cur) return res.status(404).json({ error: 'Quote not found' });
    if (cur.status === 'accepted') return res.status(409).json({ error: 'The client has accepted this quote, so it can no longer be changed. Duplicate it to make a new version.' });
    const b = req.body || {};
    const data = {};
    for (const k of QUOTE_FIELDS) if (b[k] !== undefined) data[k] = b[k] ? String(b[k]).trim() : null;
    if (data.title === null || data.clientName === null) return res.status(400).json({ error: 'A job title and client name are required' });
    for (const k of ['discount', 'taxRate', 'depositPercent']) if (b[k] !== undefined) data[k] = quoteNum(b[k]);
    if (b.items !== undefined || b.discount !== undefined || b.taxRate !== undefined) {
      const priced = priceQuote(
        b.items !== undefined ? b.items : JSON.parse(cur.items || '[]'),
        data.discount !== undefined ? data.discount : cur.discount,
        data.taxRate !== undefined ? data.taxRate : cur.taxRate,
      );
      if (!priced.items.length) return res.status(400).json({ error: 'Add at least one line item' });
      Object.assign(data, { items: JSON.stringify(priced.items), subtotal: priced.subtotal, total: priced.total });
    }
    // Editing a declined quote reopens it as a draft to be re-sent.
    if (cur.status === 'declined') Object.assign(data, { status: 'draft', declineReason: null, respondedAt: null });
    const row = await prisma.quote.update({ where: { id: cur.id }, data });
    res.json(quoteDto(row));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/quotes/:id', auth, async (req, res) => {
  try {
    if (!hasRole(req, CAN_MANAGE_QUOTES)) return res.status(403).json({ error: 'Your role cannot delete quotes' });
    await prisma.quote.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Issue (or reuse) the share link and mark the quote sent.
app.post('/api/quotes/:id/share', auth, async (req, res) => {
  try {
    if (!hasRole(req, CAN_MANAGE_QUOTES)) return res.status(403).json({ error: 'Your role cannot send quotes' });
    const cur = await prisma.quote.findUnique({ where: { id: req.params.id } });
    if (!cur) return res.status(404).json({ error: 'Quote not found' });
    const data = { publicToken: cur.publicToken || crypto.randomBytes(12).toString('base64url') };
    if (cur.status === 'draft') Object.assign(data, { status: 'sent', sentAt: new Date() });
    const row = await prisma.quote.update({ where: { id: cur.id }, data });
    res.json(quoteDto(row));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Manual status for quotes agreed outside the link (phone, in person, paper).
app.post('/api/quotes/:id/status', auth, async (req, res) => {
  try {
    if (!hasRole(req, CAN_MANAGE_QUOTES)) return res.status(403).json({ error: 'Your role cannot update quotes' });
    const status = req.body?.status;
    if (!['accepted', 'declined', 'sent'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const cur = await prisma.quote.findUnique({ where: { id: req.params.id } });
    if (!cur) return res.status(404).json({ error: 'Quote not found' });
    if (cur.projectId) return res.status(409).json({ error: 'This quote is already a project' });
    const data = { status, respondedAt: status === 'sent' ? null : new Date() };
    if (status === 'accepted') data.acceptedBy = String(req.body?.acceptedBy || cur.clientName).slice(0, 120);
    if (status === 'sent' && !cur.sentAt) data.sentAt = new Date();
    const row = await prisma.quote.update({ where: { id: cur.id }, data });
    res.json(quoteDto(row));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Turn an accepted quote into a project: BOQ from its lines, plus a deposit invoice.
app.post('/api/quotes/:id/convert', auth, async (req, res) => {
  try {
    if (!hasRole(req, CAN_MANAGE_QUOTES)) return res.status(403).json({ error: 'Your role cannot convert quotes' });
    const q = await prisma.quote.findUnique({ where: { id: req.params.id } });
    if (!q) return res.status(404).json({ error: 'Quote not found' });
    if (q.projectId) return res.status(409).json({ error: 'This quote is already a project' });
    if (q.status !== 'accepted') return res.status(409).json({ error: 'Only an accepted quote can become a project. Mark it accepted first.' });
    const items = JSON.parse(q.items || '[]');
    const ws = currentWs();
    const project = await prisma.project.create({ data: {
      code: q.quoteNumber + '-' + crypto.randomBytes(2).toString('hex').toUpperCase(),
      name: q.title,
      city: req.body?.city ? String(req.body.city).slice(0, 120) : '—',
      value: String(Math.round(q.total)),
      contractSumKES: Math.round(q.total),
      status: 'Planning',
      progress: 0,
      description: [q.notes, 'Client: ' + q.clientName + (q.clientPhone ? ' · ' + q.clientPhone : '')].filter(Boolean).join('\n\n'),
    } });
    // Group lines by section so the BOQ keeps the quote's structure.
    const groups = new Map();
    for (const i of items) {
      const k = i.section || 'Quoted works';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(i);
    }
    let pos = 0;
    for (const [title, lines] of groups) {
      pos += 1;
      await prisma.boqSection.create({ data: {
        workspaceId: ws, projectId: project.id, code: String(pos), title, position: pos - 1,
        items: { create: lines.map((i, idx) => ({
          workspaceId: ws, code: pos + '.' + (idx + 1), description: i.description, unit: i.unit || 'item',
          quantity: Number(i.quantity) || 0, rate: Number(i.rate) || 0,
          amount: (Number(i.quantity) || 0) * (Number(i.rate) || 0), position: idx,
        })) },
      } });
    }
    let invoice = null;
    const pct = Number(q.depositPercent) || 0;
    if (pct > 0) {
      const amount = Math.round(q.total * pct / 100);
      const today = new Date().toISOString().slice(0, 10);
      invoice = await prisma.invoice.create({ data: {
        invoiceNumber: 'DEP-' + q.quoteNumber + '-' + crypto.randomBytes(2).toString('hex').toUpperCase(),
        clientName: q.clientName, billToAddress: q.clientAddress, amount, status: 'draft',
        issueDate: today, dueDate: today, paymentTerms: 'Due on receipt', subtotal: amount,
        items: JSON.stringify([{ description: pct + '% deposit for ' + q.title + ' (quote ' + q.quoteNumber + ')', quantity: 1, rate: amount }]),
        notes: 'Deposit on accepted quote ' + q.quoteNumber + '.',
        projectId: project.id,
      } });
    }
    const row = await prisma.quote.update({ where: { id: q.id }, data: { projectId: project.id, invoiceId: invoice ? invoice.id : null } });
    res.json({ quote: quoteDto(row), project: projectDto(project), invoice });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Public: the client's view of a shared quote. No workspace context here, so the
// tenant extension passes through; the unguessable token is the only key, and
// only client-facing fields are returned.
app.get('/api/public/quotes/:token', async (req, res) => {
  try {
    const q = await prisma.quote.findUnique({ where: { publicToken: req.params.token } });
    if (!q) return res.status(404).json({ error: 'This quote is not available.' });
    if (!q.viewedAt) await prisma.quote.update({ where: { id: q.id }, data: { viewedAt: new Date() } }).catch(() => {});
    const ws = await companyFor(q.workspaceId);
    const d = quoteDto(q);
    res.json({
      companyName: ws ? ws.name : null,
      company: companyPublic(ws),
      quoteNumber: d.quoteNumber, title: d.title, clientName: d.clientName, clientAddress: d.clientAddress,
      items: d.items, subtotal: d.subtotal, discount: d.discount, taxRate: d.taxRate, total: d.total,
      depositPercent: d.depositPercent, validUntil: d.validUntil, notes: d.notes, terms: d.terms,
      status: d.status, acceptedBy: d.acceptedBy, respondedAt: d.respondedAt, issuedAt: d.sentAt || d.createdAt,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/public/quotes/:token/respond', async (req, res) => {
  try {
    const q = await prisma.quote.findUnique({ where: { publicToken: req.params.token } });
    if (!q) return res.status(404).json({ error: 'This quote is not available.' });
    if (q.status === 'accepted' || q.status === 'declined') return res.status(409).json({ error: 'This quote has already been ' + q.status + '.' });
    if (q.status === 'draft') return res.status(409).json({ error: 'This quote is being revised. Please wait for the updated version.' });
    if (isExpired(q)) return res.status(409).json({ error: 'This quote has expired. Please contact us for an updated quote.' });
    const accept = req.body?.decision === 'accept';
    const name = String(req.body?.name || '').trim().slice(0, 120);
    if (accept && !name) return res.status(400).json({ error: 'Please type your name to accept.' });
    const row = await prisma.quote.update({ where: { id: q.id }, data: accept
      ? { status: 'accepted', acceptedBy: name, respondedAt: new Date() }
      : { status: 'declined', declineReason: String(req.body?.reason || '').trim().slice(0, 1000) || null, respondedAt: new Date() } });
    res.json({ ok: true, status: row.status });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== CLIENT PORTAL =====
// One private link per project (/?portal=<token>) that the client opens without
// an account to follow progress, see site photos and invoices, and approve or
// reject change orders waiting on them. Only client-safe fields leave the
// server: no costs to the contractor, no internal notes, no team details.
const CAN_SHARE_PORTAL = CAN_MANAGE_QUOTES;
const coKES = (c) => (c.amountKES != null ? Number(c.amountKES) : Math.round((Number(c.costUSD) || 0) * (Number(process.env.USD_TO_KES) || 130)));

app.post('/api/projects/:projectId/portal', auth, async (req, res) => {
  try {
    if (!hasRole(req, CAN_SHARE_PORTAL)) return res.status(403).json({ error: 'Your role cannot share the client portal' });
    const p = await prisma.project.findUnique({ where: { id: req.params.projectId } });
    if (!p) return res.status(404).json({ error: 'Project not found' });
    if (p.portalToken) return res.json({ portalToken: p.portalToken, portalSharedAt: p.portalSharedAt });
    const row = await prisma.project.update({ where: { id: p.id }, data: { portalToken: crypto.randomBytes(12).toString('base64url'), portalSharedAt: new Date() } });
    res.json({ portalToken: row.portalToken, portalSharedAt: row.portalSharedAt });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Turning the portal off kills the old link for good; sharing again issues a new one.
app.delete('/api/projects/:projectId/portal', auth, async (req, res) => {
  try {
    if (!hasRole(req, CAN_SHARE_PORTAL)) return res.status(403).json({ error: 'Your role cannot change the client portal' });
    await prisma.project.update({ where: { id: req.params.projectId }, data: { portalToken: null, portalSharedAt: null } });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const parseJsonArr = (raw) => { try { const v = JSON.parse(raw || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };

async function portalPayload(p) {
    const [ws, schedule, logs, cos, invoices, selections] = await Promise.all([
      companyFor(p.workspaceId),
      prisma.scheduleItem.findMany({ where: { projectId: p.id }, orderBy: [{ startDate: 'asc' }, { sortOrder: 'asc' }] }),
      prisma.dailyLog.findMany({ where: { projectId: p.id, clientVisible: true }, orderBy: { date: 'desc' }, take: 60 }),
      prisma.changeOrder.findMany({ where: { projectId: p.id, status: { in: ['owner_approval', 'approved', 'rejected'] } }, orderBy: { createdAt: 'desc' } }),
      prisma.invoice.findMany({ where: { projectId: p.id, status: { not: 'draft' } }, orderBy: { createdAt: 'desc' } }),
      prisma.selection.findMany({ where: { projectId: p.id, status: { not: 'draft' } }, orderBy: [{ room: 'asc' }, { position: 'asc' }, { createdAt: 'asc' }] }),
    ]);
    return {
      companyName: ws ? ws.name : null,
      company: companyPublic(ws),
      project: {
        name: p.name, city: p.city, status: p.status, progress: p.progress,
        startDate: p.startDate, targetEndDate: p.targetEndDate, practicalCompletionAt: p.practicalCompletionAt,
        description: p.description, images: parseImages(p.images),
      },
      schedule: schedule.map((s) => ({ name: s.name, type: s.type, startDate: s.startDate, endDate: s.endDate, percent: s.percent, status: s.status })),
      // Site photos only: the diary's notes are written for the site team and can
      // carry internal matters, so they stay inside the workspace.
      photos: logs
        .map((l) => ({
          date: l.date, location: l.location,
          photos: parseJsonArr(l.photos).filter((u) => typeof u === 'string' && u && !/^(blob:|data:)/i.test(u)),
          videos: parseJsonArr(l.videos).filter((u) => typeof u === 'string' && u && !/^(blob:|data:)/i.test(u)),
        }))
        .filter((l) => l.photos.length || l.videos.length),
      changeOrders: cos.map((c) => ({
        id: c.id, number: c.number, title: c.title, area: c.area, description: c.description,
        amountKES: coKES(c), scheduleImpactDays: c.scheduleImpactDays, status: c.status, submittedDate: c.submittedDate, updatedAt: c.updatedAt,
      })),
      // The supplier stays internal; notes are written for the client. The price is the allowance.
      selections: selections.map((x) => ({
        id: x.id, room: x.room, category: x.category, name: x.name, spec: x.spec, quantity: x.quantity, unit: x.unit,
        unitPriceKES: x.unitPriceKES, imageUrl: x.imageUrl, link: x.link, notes: x.notes, status: x.status, clientComment: x.clientComment, decidedBy: x.decidedBy, decidedAt: x.decidedAt,
      })),
      invoices: invoices.map((i) => ({
        invoiceNumber: i.invoiceNumber, amount: i.amount, paidAmount: i.paidAmount || 0, status: i.status,
        issueDate: i.issueDate, dueDate: i.dueDate, items: parseJsonArr(i.items),
      })),
    };
}

app.get('/api/public/portal/:token', async (req, res) => {
  try {
    const p = await prisma.project.findUnique({ where: { portalToken: req.params.token } });
    if (!p) return res.status(404).json({ error: 'This project link is no longer active. Please ask your contractor for a new one.' });
    res.json(await portalPayload(p));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/public/portal/:token/change-orders/:id', async (req, res) => {
  try {
    const p = await prisma.project.findUnique({ where: { portalToken: req.params.token } });
    if (!p) return res.status(404).json({ error: 'This project link is no longer active.' });
    const co = await prisma.changeOrder.findUnique({ where: { id: req.params.id } });
    if (!co || co.projectId !== p.id) return res.status(404).json({ error: 'Change order not found' });
    if (co.status !== 'owner_approval') return res.status(409).json({ error: 'This change order is no longer waiting for your decision.' });
    const approve = req.body?.decision === 'approve';
    const name = String(req.body?.name || '').trim().slice(0, 120);
    const comment = String(req.body?.comment || '').trim().slice(0, 1000);
    if (!name) return res.status(400).json({ error: 'Please type your name.' });
    if (!approve && !comment) return res.status(400).json({ error: 'Please say why, so the team can revise it.' });
    const toStatus = approve ? 'approved' : 'rejected';
    const row = await prisma.changeOrder.update({ where: { id: co.id }, data: { status: toStatus } });
    // No workspace context on a public request, so the activity row is stamped
    // with the project's workspace explicitly.
    await prisma.changeOrderActivity.create({ data: {
      workspaceId: p.workspaceId, changeOrderId: co.id, userId: null, userName: name, userRole: 'Client (portal)',
      type: 'status', fromStatus: co.status, toStatus,
      message: `${approve ? 'Approved' : 'Rejected'} by ${name} in the client portal${comment ? `: "${comment}"` : ''}`,
    } }).catch((e) => console.error('[portal] CO activity failed:', e.message));
    res.json({ ok: true, status: row.status });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== FINISH SELECTIONS =====
// Finishes chosen per room (tiles, paint, fittings…) that the client approves in
// the portal before anything is ordered. Team flow: draft → send to client →
// approved / changes requested → ordered → installed. Changing what was shown
// to the client sends the item back to draft, so an approval always refers to
// exactly what the client saw.
const SELECTION_STATUSES = ['draft', 'awaiting_client', 'approved', 'changes_requested', 'ordered', 'installed'];
const SELECTION_TEXT = ['room', 'category', 'name', 'spec', 'supplier', 'unit', 'imageUrl', 'link', 'notes'];
const SELECTION_CLIENT_FACING = ['room', 'category', 'name', 'spec', 'quantity', 'unit', 'unitPriceKES', 'imageUrl', 'link', 'notes'];
const pickSelection = (b) => {
  const d = {};
  for (const k of SELECTION_TEXT) if (b[k] !== undefined) d[k] = b[k] == null || String(b[k]).trim() === '' ? null : String(b[k]).trim().slice(0, k === 'notes' ? 2000 : 500);
  for (const k of ['quantity', 'unitPriceKES']) if (b[k] !== undefined) d[k] = b[k] === null || b[k] === '' ? null : (Number(b[k]) || 0);
  if (b.position !== undefined) d.position = Number(b.position) || 0;
  return d;
};

app.get('/api/projects/:projectId/selections', auth, async (req, res) => {
  try {
    res.json(await prisma.selection.findMany({ where: { projectId: req.params.projectId }, orderBy: [{ room: 'asc' }, { position: 'asc' }, { createdAt: 'asc' }] }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/projects/:projectId/selections', auth, async (req, res) => {
  try {
    if (!hasRole(req, CAN_MANAGE_QUOTES)) return res.status(403).json({ error: 'Your role cannot add selections' });
    const project = await prisma.project.findUnique({ where: { id: req.params.projectId }, select: { id: true } });
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const d = pickSelection(req.body || {});
    if (!d.room || !d.category || !d.name) return res.status(400).json({ error: 'Room, category and item name are required' });
    const row = await prisma.selection.create({ data: { ...d, projectId: project.id, status: 'draft' } });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/selections/:id', auth, async (req, res) => {
  try {
    if (!hasRole(req, CAN_MANAGE_QUOTES)) return res.status(403).json({ error: 'Your role cannot edit selections' });
    const cur = await prisma.selection.findUnique({ where: { id: req.params.id } });
    if (!cur) return res.status(404).json({ error: 'Selection not found' });
    const b = req.body || {};
    const d = pickSelection(b);
    if (d.room === null || d.category === null || d.name === null) return res.status(400).json({ error: 'Room, category and item name are required' });
    const changedForClient = SELECTION_CLIENT_FACING.some((k) => d[k] !== undefined && d[k] !== cur[k]);
    if (b.status !== undefined) {
      if (!SELECTION_STATUSES.includes(b.status)) return res.status(400).json({ error: 'Invalid status' });
      d.status = b.status;
      // Recording an approval given in person, by phone or on paper.
      if (b.status === 'approved' && cur.status !== 'approved') Object.assign(d, { decidedBy: `Recorded by ${req.user?.name || 'the team'}`, decidedAt: new Date(), clientComment: null });
      if (b.status === 'draft' || b.status === 'awaiting_client') Object.assign(d, { decidedBy: null, decidedAt: null });
    } else if (changedForClient && ['awaiting_client', 'approved', 'changes_requested'].includes(cur.status)) {
      Object.assign(d, { status: 'draft', decidedBy: null, decidedAt: null });
    }
    const row = await prisma.selection.update({ where: { id: cur.id }, data: d });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/selections/:id', auth, async (req, res) => {
  try {
    if (!hasRole(req, CAN_MANAGE_QUOTES)) return res.status(403).json({ error: 'Your role cannot delete selections' });
    await prisma.selection.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Send every draft in the project to the client in one go.
app.post('/api/projects/:projectId/selections/send', auth, async (req, res) => {
  try {
    if (!hasRole(req, CAN_MANAGE_QUOTES)) return res.status(403).json({ error: 'Your role cannot send selections' });
    const r = await prisma.selection.updateMany({ where: { projectId: req.params.projectId, status: 'draft' }, data: { status: 'awaiting_client', clientComment: null } });
    res.json({ sent: r.count });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/public/portal/:token/selections/:id', async (req, res) => {
  try {
    const p = await prisma.project.findUnique({ where: { portalToken: req.params.token } });
    if (!p) return res.status(404).json({ error: 'This project link is no longer active.' });
    const s = await prisma.selection.findUnique({ where: { id: req.params.id } });
    if (!s || s.projectId !== p.id) return res.status(404).json({ error: 'Selection not found' });
    if (s.status !== 'awaiting_client') return res.status(409).json({ error: 'This item is no longer waiting for your decision.' });
    const approve = req.body?.decision === 'approve';
    const name = String(req.body?.name || '').trim().slice(0, 120);
    const comment = String(req.body?.comment || '').trim().slice(0, 1000);
    if (!name) return res.status(400).json({ error: 'Please type your name.' });
    if (!approve && !comment) return res.status(400).json({ error: 'Please describe what you would like changed.' });
    const row = await prisma.selection.update({ where: { id: s.id }, data: {
      status: approve ? 'approved' : 'changes_requested', decidedBy: name, decidedAt: new Date(), clientComment: comment || null,
    } });
    res.json({ ok: true, status: row.status });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== JOBS BOARD =====
// Platform staff post jobs (admin panel); every subscribed company sees the open
// ones in the console and can place one bid each, editable until the deadline.
// Job and JobBid are deliberately outside the tenant extension: a job belongs to
// the platform, so every query here uses prismaBase and scopes bids by hand.
const JOB_STATUSES = ['open', 'closed', 'awarded'];
const BID_STATUSES = ['submitted', 'shortlisted', 'awarded', 'rejected'];
const jobText = (v, max = 4000) => (v == null || String(v).trim() === '' ? null : String(v).trim().slice(0, max));
const jobFiles = (v) => {
  const arr = Array.isArray(v) ? v : (() => { try { return JSON.parse(v || '[]'); } catch { return []; } })();
  const clean = arr.filter((f) => f && typeof f.url === 'string' && /^https?:|^\//.test(f.url)).slice(0, 20).map((f) => ({ name: String(f.name || 'File').slice(0, 200), url: f.url }));
  return clean.length ? JSON.stringify(clean) : null;
};
const parseFiles = (v) => { try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
const jobClosed = (j) => j.status !== 'open' || (j.deadline && j.deadline < new Date().toISOString().slice(0, 10));
const jobDto = (j) => ({ ...j, attachments: parseFiles(j.attachments), acceptingBids: !jobClosed(j) });
const requireAdmin = (req, res, next) => (isPlatformAdmin(req.user && req.user.email) ? next() : res.status(403).json({ error: 'Only Buildsasa staff can manage jobs.' }));

// --- Admin (platform staff) ---
app.get('/api/admin/jobs', auth, requireAdmin, async (req, res) => {
  try {
    const rows = await prismaBase.job.findMany({ orderBy: { createdAt: 'desc' }, include: { _count: { select: { bids: true } } } });
    const targets = await prismaBase.workspace.findMany({ where: { id: { in: rows.map((j) => j.targetWorkspaceId).filter(Boolean) } }, select: { id: true, name: true } });
    const name = Object.fromEntries(targets.map((w) => [w.id, w.name]));
    res.json(rows.map((j) => ({ ...jobDto(j), bidCount: j._count.bids, targetCompany: j.targetWorkspaceId ? name[j.targetWorkspaceId] || 'A company' : null })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const pickJob = (b) => {
  const d = {};
  for (const k of ['title', 'category', 'location', 'clientName', 'externalSource']) if (b[k] !== undefined) d[k] = jobText(b[k], 300);
  // Only a real web address, so a pasted note can't become a broken or unsafe link.
  if (b.externalUrl !== undefined) { const u = String(b.externalUrl || '').trim(); d.externalUrl = /^https?:\/\/[^\s]+$/i.test(u) ? u.slice(0, 1000) : null; }
  if (b.description !== undefined) d.description = jobText(b.description, 8000);
  if (b.deadline !== undefined) d.deadline = /^\d{4}-\d{2}-\d{2}$/.test(String(b.deadline || '')) ? b.deadline : null;
  if (b.budgetKES !== undefined) d.budgetKES = b.budgetKES === '' || b.budgetKES == null ? null : (Number(b.budgetKES) || null);
  if (b.attachments !== undefined) d.attachments = jobFiles(b.attachments);
  if (b.status !== undefined && JOB_STATUSES.includes(b.status)) d.status = b.status;
  if (b.approval !== undefined && ['pending', 'approved', 'rejected'].includes(b.approval)) d.approval = b.approval;
  return d;
};

app.post('/api/admin/jobs', auth, requireAdmin, async (req, res) => {
  try {
    const d = pickJob(req.body || {});
    if (!d.title || !d.description || !d.category) return res.status(400).json({ error: 'A job needs a title, a category and a description.' });
    const row = await prismaBase.job.create({ data: { ...d, status: d.status || 'open', createdBy: req.user?.email || null } });
    res.json(jobDto(row));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/jobs/:id', auth, requireAdmin, async (req, res) => {
  try {
    const d = pickJob(req.body || {});
    if (d.title === null || d.description === null || d.category === null) return res.status(400).json({ error: 'A job needs a title, a category and a description.' });
    const before = await prismaBase.job.findUnique({ where: { id: req.params.id } });
    const row = await prismaBase.job.update({ where: { id: req.params.id }, data: d });
    // Tell the client who posted it when Buildsasa approves or turns it down.
    if (before && row.clientEmail && d.approval && d.approval !== before.approval && d.approval !== 'pending') {
      const ok = d.approval === 'approved';
      sendEmail({ to: row.clientEmail, subject: ok ? `Your job is live: ${row.title}` : `About your job: ${row.title}`, html: emailShell(ok ? 'Your job is live' : 'Your job was not approved', `<p style="font-size:14px;color:#11161D">${ok ? `“${row.title}” is now visible to ${row.targetWorkspaceId ? 'the company you chose' : 'contractors on Buildsasa'}. Bids will appear in your Buildsasa client account.` : `We couldn't publish “${row.title}” as it is. Our team will contact you to adjust it.`}</p>`) }).catch(() => {});
    }
    res.json(jobDto(row));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/jobs/:id', auth, requireAdmin, async (req, res) => {
  try { await prismaBase.job.delete({ where: { id: req.params.id } }); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/jobs/:id/bids', auth, requireAdmin, async (req, res) => {
  try {
    const bids = await prismaBase.jobBid.findMany({ where: { jobId: req.params.id }, orderBy: { amountKES: 'asc' } });
    res.json(bids.map((b) => ({ ...b, attachments: parseFiles(b.attachments) })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/admin/job-bids/:id', auth, requireAdmin, async (req, res) => {
  try {
    const status = req.body?.status;
    if (!BID_STATUSES.includes(status)) return res.status(400).json({ error: 'Unknown bid status' });
    const bid = await prismaBase.jobBid.update({ where: { id: req.params.id }, data: { status } });
    // Awarding a bid awards the job and closes it to further bids.
    if (status === 'awarded') await prismaBase.job.update({ where: { id: bid.jobId }, data: { status: 'awarded' } });
    res.json({ ...bid, attachments: parseFiles(bid.attachments) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Subscribers (console) ---
// Open jobs, plus any job this company has bid on (so it can follow the outcome).
// Companies without an active plan can BROWSE the Jobs Board (it's what brings
// them in from the website), but the details that let them apply — the original
// post's link and the documents — and bidding itself are for subscribers.
const wsSubscribed = async (ws) => !!ws && !!clientRouteDeps.activeWorkspaceIds && (await clientRouteDeps.activeWorkspaceIds()).includes(ws);

app.get('/api/jobs', auth, async (req, res) => {
  try {
    const ws = currentWs();
    const subscribed = await wsSubscribed(ws) || hasFreeAccess(req.user && req.user.email);
    const myBids = ws ? await prismaBase.jobBid.findMany({ where: { workspaceId: ws } }) : [];
    const mine = new Set(myBids.map((b) => b.jobId));
    const jobs = await prismaBase.job.findMany({ where: { OR: [{ status: 'open', approval: 'approved', OR: [{ targetWorkspaceId: null }, { targetWorkspaceId: ws || '-' }] }, { id: { in: [...mine] } }] }, orderBy: { createdAt: 'desc' } });
    const byJob = Object.fromEntries(myBids.map((b) => [b.jobId, { ...b, attachments: parseFiles(b.attachments) }]));
    // The client's own contact details stay with Buildsasa until a bid is awarded.
    res.json(jobs.map((j) => {
      const dto = { ...jobDto(j), createdBy: undefined, clientEmail: undefined, clientPhone: undefined, clientUserId: undefined, forYou: !!j.targetWorkspaceId, myBid: byJob[j.id] || null, canApply: subscribed, isExternal: !!j.externalUrl };
      if (!subscribed) { dto.externalUrl = null; dto.attachments = []; }
      return dto;
    }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/jobs/:id/bid', auth, async (req, res) => {
  try {
    const ws = currentWs();
    if (!ws) return res.status(400).json({ error: 'Your account isn\'t linked to a company, so it can\'t bid.' });
    const job = await prismaBase.job.findUnique({ where: { id: req.params.id } });
    if (!job) return res.status(404).json({ error: 'This job is no longer available.' });
    if (job.approval !== 'approved' || (job.targetWorkspaceId && job.targetWorkspaceId !== ws)) return res.status(404).json({ error: 'This job is no longer available.' });
    if (job.externalUrl) return res.status(409).json({ error: 'This job is taken on another site. Use "Apply on the original site" to apply there.' });
    if (!(await wsSubscribed(ws)) && !hasFreeAccess(req.user && req.user.email)) return res.status(402).json({ error: 'Subscribe to Buildsasa to apply for jobs. You can browse every job for free.' });
    if (jobClosed(job)) return res.status(409).json({ error: job.status === 'awarded' ? 'This job has already been awarded.' : 'Bids for this job have closed.' });
    const b = req.body || {};
    const amount = Number(b.amountKES);
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Enter your bid amount in KES.' });
    const contactName = jobText(b.contactName, 120) || req.user?.name;
    if (!contactName) return res.status(400).json({ error: 'Add a contact name.' });
    const company = await prismaBase.workspace.findUnique({ where: { id: ws }, select: { name: true, phone: true, email: true } });
    const data = {
      userId: req.user?.sub || null,
      companyName: company?.name || 'Company', contactName,
      phone: jobText(b.phone, 40) || company?.phone || null,
      email: jobText(b.email, 200) || company?.email || req.user?.email || null,
      amountKES: amount, timelineDays: b.timelineDays ? Math.max(1, parseInt(b.timelineDays, 10) || 0) || null : null,
      message: jobText(b.message, 4000), attachments: jobFiles(b.attachments),
    };
    const existing = await prismaBase.jobBid.findUnique({ where: { jobId_workspaceId: { jobId: job.id, workspaceId: ws } } });
    if (existing && existing.status !== 'submitted') return res.status(409).json({ error: 'Your bid is already being reviewed, so it can\'t be changed now.' });
    const bid = existing
      ? await prismaBase.jobBid.update({ where: { id: existing.id }, data })
      : await prismaBase.jobBid.create({ data: { ...data, jobId: job.id, workspaceId: ws } });
    if (!existing && process.env.LEADS_NOTIFY_EMAIL) {
      sendEmail({
        to: process.env.LEADS_NOTIFY_EMAIL,
        subject: `New bid on "${job.title}"`,
        html: emailShell('New bid on the jobs board', `<p style="font-size:14px;color:#11161D"><b>${data.companyName}</b> bid <b>KES ${Math.round(amount).toLocaleString('en-KE')}</b> on "${job.title}". Review it in the admin panel under Jobs.</p>`),
      }).catch(() => {});
    }
    res.json({ ...bid, attachments: parseFiles(bid.attachments) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/jobs/:id/bid', auth, async (req, res) => {
  try {
    const ws = currentWs();
    const existing = ws ? await prismaBase.jobBid.findUnique({ where: { jobId_workspaceId: { jobId: req.params.id, workspaceId: ws } } }) : null;
    if (!existing) return res.status(404).json({ error: 'You haven\'t bid on this job.' });
    if (existing.status !== 'submitted') return res.status(409).json({ error: 'Your bid is already being reviewed, so it can\'t be withdrawn here. Contact Buildsasa support.' });
    await prismaBase.jobBid.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// ===== PUBLIC JOBS TEASER (website /jobs) =====
// Two open jobs, picked at random, show their full card; every other job sends
// only what a blurred card needs (type of work, area, closing date). Titles,
// descriptions, budgets and links of locked jobs never leave the server, so the
// blur can't be undone by reading the page source. Every card leads to sign-up.
app.get('/api/public/jobs', async (_req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const jobs = await prismaBase.job.findMany({
      where: { status: 'open', approval: 'approved', targetWorkspaceId: null, OR: [{ deadline: null }, { deadline: { gte: today } }] },
      orderBy: { createdAt: 'desc' }, take: 60,
    });
    // Two open cards picked at random, plus up to four locked ones: a taste, not the list.
    const shuffled = [...jobs].sort(() => Math.random() - 0.5);
    const open = new Set(shuffled.slice(0, 2).map((j) => j.id));
    const shown = [...shuffled.slice(0, 2), ...shuffled.slice(2).slice(0, 4)];
    res.set('Cache-Control', 'no-store');
    res.json({
      total: jobs.length,
      jobs: shown.map((j) => open.has(j.id)
        ? { id: j.id, open: true, title: j.title, category: j.category, location: j.location, budgetKES: j.budgetKES, deadline: j.deadline, summary: String(j.description || '').slice(0, 220), external: !!j.externalUrl, createdAt: j.createdAt }
        : { id: j.id, open: false, category: j.category, location: j.location ? String(j.location).split(/[,(]/)[0].trim() : null, deadline: j.deadline, external: !!j.externalUrl, createdAt: j.createdAt }),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== PROJECT REQUESTS (website "Request a project") =====
// Anyone can ask for construction work on buildsasa.com. The request lands in
// the admin panel; staff can post it to the Jobs Board in one step, where
// subscribed contractors bid. Public endpoint: rate-limited per IP, honeypot,
// and free text that looks like markup is refused rather than stored.
const PR_STATUSES = ['new', 'reviewing', 'posted', 'closed'];
const prHits = new Map();
const prLimited = (ip) => {
  const now = Date.now();
  const hits = (prHits.get(ip) || []).filter((t) => now - t < 60 * 60 * 1000);
  hits.push(now); prHits.set(ip, hits);
  if (prHits.size > 5000) prHits.clear();
  return hits.length > 5;
};
const prText = (v, max) => (v == null || String(v).trim() === '' ? null : String(v).trim().slice(0, max));
const prMarkup = (v) => /<[a-z!\/?]|javascript:|on[a-z]+\s*=/i.test(String(v || ''));

app.post('/api/public/project-requests', async (req, res) => {
  try {
    const b = req.body || {};
    if (prText(b.website, 200)) return res.json({ ok: true }); // honeypot: bots fill it, people never see it
    const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
    if (prLimited(ip)) return res.status(429).json({ error: 'Too many requests from this connection. Please try again in an hour, or call us on +254 782 223 749.' });
    const d = {
      name: prText(b.name, 120), email: prText(b.email, 200), phone: prText(b.phone, 40), company: prText(b.company, 160),
      projectType: prText(b.projectType, 120), location: prText(b.location, 300), budget: prText(b.budget, 80), timeline: prText(b.timeline, 80),
      description: prText(b.description, 5000),
    };
    if (!d.name || !d.email || !d.phone || !d.projectType || !d.location || !d.description) return res.status(400).json({ error: 'Please fill in your name, email, phone, the type of project, its location and a short description.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
    if (!/^[+\d][\d\s()-]{6,}$/.test(d.phone)) return res.status(400).json({ error: 'Please enter a valid phone number, e.g. 0712 345 678.' });
    if (d.description.length < 20) return res.status(400).json({ error: 'Please describe the project in a little more detail (a sentence or two).' });
    for (const [k, v] of Object.entries(d)) if (v && prMarkup(v)) return res.status(400).json({ error: `Please remove any code or HTML from the ${k === 'projectType' ? 'project type' : k} field.` });
    const row = await prismaBase.projectRequest.create({ data: { ...d, email: d.email.toLowerCase(), pageUrl: prText(b.pageUrl, 400), ip } });
    const notify = String(process.env.LEADS_NOTIFY_EMAIL || '').trim();
    if (notify) {
      const esc = (v) => String(v || '').replace(/</g, '&lt;');
      sendEmail({
        to: notify,
        subject: `New project request: ${d.projectType} in ${d.location}`,
        html: emailShell('New project request', `<table cellpadding="6">${[['Name', d.name], ['Phone', d.phone], ['Email', d.email], ['Company', d.company], ['Project', d.projectType], ['Location', d.location], ['Budget', d.budget], ['Timeline', d.timeline], ['Details', d.description]].filter(([, v]) => v).map(([k, v]) => `<tr><td><strong>${k}</strong></td><td>${esc(v)}</td></tr>`).join('')}</table><p style="font-size:13px">Review it in the admin panel under Project requests.</p>`),
      }).catch((e) => console.error('[project request] notify failed:', e.message));
    }
    // A short acknowledgement to the person who asked.
    sendEmail({
      to: d.email,
      subject: 'We received your project request',
      html: emailShell('Thanks, we have your request', `<p style="font-size:14px;color:#11161D">Hi ${String(d.name).replace(/</g, '&lt;')}, thank you for telling us about your ${String(d.projectType).toLowerCase().replace(/</g, '&lt;')} in ${String(d.location).replace(/</g, '&lt;')}. A member of the Buildsasa team will call you within one working day to understand the work and connect you with suitable contractors.</p><p style="font-size:14px;color:#11161D">Questions? WhatsApp us on +254 782 223 749.</p>`),
    }).catch(() => {});
    res.json({ ok: true, id: row.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const prAdmin = (req, res, next) => (isPlatformAdmin(req.user && req.user.email) ? next() : res.status(403).json({ error: 'Only Buildsasa staff can see project requests.' }));

app.get('/api/admin/project-requests', auth, prAdmin, async (_req, res) => {
  try { res.json(await prismaBase.projectRequest.findMany({ orderBy: { createdAt: 'desc' }, take: 300 })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/admin/project-requests/:id', auth, prAdmin, async (req, res) => {
  try {
    const data = {};
    if (req.body?.status !== undefined) { if (!PR_STATUSES.includes(req.body.status)) return res.status(400).json({ error: 'Unknown status' }); data.status = req.body.status; }
    if (req.body?.adminNote !== undefined) data.adminNote = prText(req.body.adminNote, 2000);
    res.json(await prismaBase.projectRequest.update({ where: { id: req.params.id }, data }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/project-requests/:id', auth, prAdmin, async (req, res) => {
  try { await prismaBase.projectRequest.delete({ where: { id: req.params.id } }); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Post a request to the Jobs Board. The admin can edit the wording first; the
// client's contact details are never published (only the area and the work).
app.post('/api/admin/project-requests/:id/post-job', auth, prAdmin, async (req, res) => {
  try {
    const r = await prismaBase.projectRequest.findUnique({ where: { id: req.params.id } });
    if (!r) return res.status(404).json({ error: 'Request not found' });
    if (r.jobId) return res.status(409).json({ error: 'This request is already on the Jobs Board.' });
    const b = req.body || {};
    const title = prText(b.title, 300) || `${r.projectType} in ${r.location}`;
    const description = prText(b.description, 8000) || [r.description, r.timeline ? `Timeline: ${r.timeline}` : null, r.budget ? `Client budget: ${r.budget}` : null].filter(Boolean).join('\n\n');
    const deadline = /^\d{4}-\d{2}-\d{2}$/.test(String(b.deadline || '')) ? b.deadline : new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
    const job = await prismaBase.job.create({ data: {
      title, description, category: prText(b.category, 120) || 'Building construction', location: prText(b.location, 300) || r.location,
      budgetKES: b.budgetKES ? Number(b.budgetKES) || null : null, deadline, clientName: prText(b.clientName, 160), status: 'open', createdBy: req.user?.email || null,
    } });
    const updated = await prismaBase.projectRequest.update({ where: { id: r.id }, data: { jobId: job.id, status: 'posted' } });
    res.json({ request: updated, job });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== INSPECTIONS =====
const INSPECTION_STATUSES = ['draft', 'pending_consultant', 'in_review', 'approved', 'rejected', 'rework_required', 'closed'];
const VALID_TRANSITIONS = {
  draft: ['pending_consultant', 'closed'],
  pending_consultant: ['in_review', 'rejected', 'closed'],
  in_review: ['approved', 'rejected', 'rework_required', 'closed'],
  approved: ['closed'],
  rejected: ['draft', 'closed'],
  rework_required: ['pending_consultant', 'closed'],
  closed: [],
};

function canTransition(from, to) {
  return VALID_TRANSITIONS[from]?.includes(to);
}

app.get('/api/projects/:projectId/inspections', auth, async (req, res) => {
  try {
    const rows = await prisma.inspection.findMany({
      where: { projectId: req.params.projectId },
      orderBy: { createdAt: 'desc' },
      include: { approvals: { orderBy: { createdAt: 'desc' } } },
    });
    res.json(rows || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/inspections/:id', auth, async (req, res) => {
  try {
    const row = await prisma.inspection.findUnique({
      where: { id: req.params.id },
      include: { approvals: { orderBy: { createdAt: 'desc' } } },
    });
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/projects/:projectId/inspections', auth, async (req, res) => {
  try {
    const { type, inspector, date, status, notes, checklist, photos, videos, readinessPhotos, assignedTo, createdBy, checklistId, templateId, drawingRef } = req.body;
    const initialStatus = status && INSPECTION_STATUSES.includes(status) ? status : 'draft';
    const row = await prisma.inspection.create({
      data: {
        type, inspector, date,
        status: initialStatus,
        notes, checklist,
        photos: photos ? JSON.stringify(photos) : null,
        videos: videos ? JSON.stringify(videos) : null,
        readinessPhotos: readinessPhotos ? JSON.stringify(readinessPhotos) : null,
        assignedTo, createdBy: createdBy || req.user.sub,
        checklistId, templateId,
        drawingRef: drawingRef ? JSON.stringify(drawingRef) : null,
        projectId: req.params.projectId,
      },
    });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/projects/:projectId/inspections/:id', auth, async (req, res) => {
  try {
    const existing = await prisma.inspection.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const { type, inspector, date, status, notes, checklist, photos, videos, readinessPhotos, assignedTo, checklistId, templateId, drawingRef } = req.body;
    if (status && status !== existing.status && !canTransition(existing.status, status)) {
      return res.status(400).json({ error: `Invalid status transition from ${existing.status} to ${status}` });
    }
    const data = { type, inspector, date, status, notes, checklist, assignedTo, checklistId, templateId };
    if (photos !== undefined) data.photos = photos ? JSON.stringify(photos) : null;
    if (videos !== undefined) data.videos = videos ? JSON.stringify(videos) : null;
    if (readinessPhotos !== undefined) data.readinessPhotos = readinessPhotos ? JSON.stringify(readinessPhotos) : null;
    if (drawingRef !== undefined) data.drawingRef = drawingRef ? JSON.stringify(drawingRef) : null;
    const row = await prisma.inspection.update({ where: { id: req.params.id }, data });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/projects/:projectId/inspections/:id', auth, async (req, res) => {
  try {
    await prisma.inspection.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Inspection approvals (consultant workflow)
app.post('/api/inspections/:id/approvals', auth, async (req, res) => {
  try {
    const { status, comments } = req.body;
    if (!['approved', 'rejected', 'rework_required'].includes(status)) {
      return res.status(400).json({ error: 'Invalid approval status' });
    }
    const inspection = await prisma.inspection.findUnique({ where: { id: req.params.id } });
    if (!inspection) return res.status(404).json({ error: 'Inspection not found' });
    if (!['in_review', 'pending_consultant'].includes(inspection.status)) {
      return res.status(400).json({ error: `Cannot approve/reject inspection in status ${inspection.status}` });
    }
    const approval = await prisma.inspectionApproval.create({
      data: { status, comments: comments || null, approvedBy: req.user.sub, inspectionId: req.params.id },
    });
    let newStatus = inspection.status;
    if (status === 'approved') newStatus = 'approved';
    else if (status === 'rejected') newStatus = 'rejected';
    else if (status === 'rework_required') newStatus = 'rework_required';
    await prisma.inspection.update({ where: { id: req.params.id }, data: { status: newStatus } });
    res.json({ approval, inspectionStatus: newStatus });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/inspections/:id/approvals', auth, async (req, res) => {
  try {
    const rows = await prisma.inspectionApproval.findMany({ where: { inspectionId: req.params.id }, orderBy: { createdAt: 'desc' } });
    res.json(rows || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== SAFETY INCIDENTS =====
app.get('/api/projects/:projectId/safety-incidents', auth, async (req, res) => {
  try {
    const rows = await prisma.safetyIncident.findMany({ where: { projectId: req.params.projectId }, orderBy: { createdAt: 'desc' } });
    res.json(rows || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/projects/:projectId/safety-incidents', auth, async (req, res) => {
  try {
    const { date, incidentType, severity, description, reporter, witnesses, correctiveAction, status } = req.body;
    const row = await prisma.safetyIncident.create({ data: { date, incidentType, severity, description, reporter, witnesses, correctiveAction, status, projectId: req.params.projectId } });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/projects/:projectId/safety-incidents/:id', auth, async (req, res) => {
  try {
    const { date, incidentType, severity, description, reporter, witnesses, correctiveAction, status } = req.body;
    const row = await prisma.safetyIncident.update({ where: { id: req.params.id }, data: { date, incidentType, severity, description, reporter, witnesses, correctiveAction, status } });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/projects/:projectId/safety-incidents/:id', auth, async (req, res) => {
  try {
    await prisma.safetyIncident.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== EQUIPMENT =====
app.get('/api/equipment', auth, async (_req, res) => {
  try {
    const rows = await prisma.equipment.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(rows || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// Build the equipment data payload from a request body. `partial` controls
// update semantics: when true (PUT), fields that are `undefined` in the body are
// left out entirely so existing values are untouched; when false (POST) every
// field is included. Date fields are coerced to Date, numeric fields via Number.
function buildEquipmentData(body, { partial } = { partial: false }) {
  const dateFields = ['hireStartDate', 'hireEndDate', 'insuranceExpiry', 'inspectionExpiry'];
  const numberFields = ['hireRate', 'purchaseCost', 'currentValue', 'meterHours', 'lastServiceHours', 'serviceIntervalHours'];
  const stringFields = [
    'name', 'category', 'serialNumber', 'manufacturer', 'purchaseDate', 'status',
    'lastService', 'nextService', 'location', 'notes', 'projectId',
    'assetTag', 'condition', 'operator', 'ownership', 'hireVendor', 'hireRateUnit',
    'photoUrl', 'documents',
  ];
  const data = {};
  const setField = (key, value) => {
    if (partial && value === undefined) return; // leave untouched on update
    data[key] = value;
  };
  for (const key of stringFields) setField(key, body[key]);
  for (const key of numberFields) {
    const v = body[key];
    setField(key, v === undefined ? undefined : (v === null || v === '' ? null : Number(v)));
  }
  for (const key of dateFields) {
    const v = body[key];
    setField(key, v === undefined ? undefined : (v === null || v === '' ? null : new Date(v)));
  }
  return data;
}
app.post('/api/equipment', auth, async (req, res) => {
  try {
    const data = buildEquipmentData(req.body, { partial: false });
    const row = await prisma.equipment.create({ data });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/equipment/:id', auth, async (req, res) => {
  try {
    const data = buildEquipmentData(req.body, { partial: true });
    const row = await prisma.equipment.update({ where: { id: req.params.id }, data });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/equipment/:id', auth, async (req, res) => {
  try {
    await prisma.equipment.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== INVENTORY (construction materials + stock-movement ledger) =====
// Viewing is open to any authenticated user. Creating/editing/deleting items and
// recording movements is limited to the site/management roles that run material
// stock (mirrors CAN_ASSIGN_TASKS: site supervisors, PM, contractor, etc.).
const CAN_MANAGE_INVENTORY = ['Contractor', 'Executive', 'Project Manager', 'Superintendent', 'Trade Lead'];
const INVENTORY_FIELDS = ['projectId', 'name', 'category', 'unit', 'reorderLevel', 'unitCostKES', 'supplier', 'location', 'notes', 'status', 'sku', 'minLevel', 'maxLevel', 'reorderQty', 'leadTimeDays', 'supplierContact', 'wasteAllowancePct'];
const INVENTORY_NUMERIC_FIELDS = ['reorderLevel', 'unitCostKES', 'minLevel', 'maxLevel', 'reorderQty', 'leadTimeDays', 'wasteAllowancePct'];
const pickInventory = (b) => {
  const d = {};
  for (const f of INVENTORY_FIELDS) if (b[f] !== undefined) d[f] = b[f];
  // Numeric coercion for the float/int fields (empty -> null). Strings (sku,
  // supplier, supplierContact, etc.) are persisted as-is.
  for (const f of INVENTORY_NUMERIC_FIELDS) {
    if (d[f] !== undefined) d[f] = d[f] == null || d[f] === '' ? null : Number(d[f]);
  }
  return d;
};

// List items (optional ?projectId= and ?type= filters; type filters by items that
// have at least one movement of that type). Newest first.
app.get('/api/inventory', auth, async (req, res) => {
  try {
    const { projectId, type } = req.query;
    const where = {};
    if (projectId) where.projectId = projectId;
    if (type) where.movements = { some: { type } };
    res.json(await prisma.inventoryItem.findMany({ where, orderBy: { createdAt: 'desc' } }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Items at or below their reorder level (only when a reorder level is set > 0).
app.get('/api/inventory/low-stock', auth, async (_req, res) => {
  try {
    const rows = await prisma.inventoryItem.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(rows.filter((r) => r.reorderLevel != null && r.reorderLevel > 0 && r.currentStock <= r.reorderLevel));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Single item including its movement ledger (newest first).
app.get('/api/inventory/:id', auth, async (req, res) => {
  try {
    const row = await prisma.inventoryItem.findUnique({ where: { id: req.params.id }, include: { movements: { orderBy: { date: 'desc' } } } });
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/inventory', auth, requireRole(CAN_MANAGE_INVENTORY), async (req, res) => {
  try {
    const d = pickInventory(req.body);
    if (!d.name) return res.status(400).json({ error: 'name required' });
    if (!d.unit) return res.status(400).json({ error: 'unit required' });
    if (req.body.currentStock !== undefined) d.currentStock = Number(req.body.currentStock) || 0; // optional opening balance
    res.json(await prisma.inventoryItem.create({ data: d }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Update item fields. currentStock is deliberately ignored here — it only changes
// via movements, so direct edits can't silently desync the cached balance.
app.put('/api/inventory/:id', auth, requireRole(CAN_MANAGE_INVENTORY), async (req, res) => {
  try {
    res.json(await prisma.inventoryItem.update({ where: { id: req.params.id }, data: pickInventory(req.body) }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/inventory/:id', auth, requireRole(CAN_MANAGE_INVENTORY), async (req, res) => {
  try {
    await prisma.inventoryItem.delete({ where: { id: req.params.id } }); // cascades movements
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Movement ledger for one item (newest first).
app.get('/api/inventory/:id/movements', auth, async (req, res) => {
  try {
    res.json(await prisma.inventoryMovement.findMany({ where: { itemId: req.params.id }, orderBy: { date: 'desc' } }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const WASTE_REASONS = ['damaged', 'offcut', 'spoiled', 'theft', 'over_order', 'rework', 'weather', 'other'];

// Record a movement and apply the stock logic to the item's cached currentStock:
//   in     -> currentStock += quantity
//   out    -> currentStock -= quantity   (issued to the works)
//   waste  -> currentStock -= quantity   (bought but never became building)
//   adjust -> currentStock = quantity    (stock take sets the absolute value)
app.post('/api/inventory/:id/movements', auth, requireRole(CAN_MANAGE_INVENTORY), async (req, res) => {
  try {
    const { type, quantity, reference, notes, date, reason, projectId, unitCostKES } = req.body || {};
    if (!['in', 'out', 'waste', 'adjust'].includes(type)) return res.status(400).json({ error: 'type must be in | out | waste | adjust' });
    const qty = Number(quantity);
    if (!Number.isFinite(qty)) return res.status(400).json({ error: 'quantity must be a number' });
    if (qty < 0) return res.status(400).json({ error: 'quantity cannot be negative — the movement type says which way stock moves' });
    // Waste MUST carry a reason. An unattributed waste figure tells you money
    // disappeared but nothing about how to stop it happening again, which is the
    // whole point of recording it.
    if (type === 'waste' && !WASTE_REASONS.includes(String(reason || ''))) {
      return res.status(400).json({ error: 'waste needs a reason: ' + WASTE_REASONS.join(', ') });
    }
    const item = await prisma.inventoryItem.findUnique({ where: { id: req.params.id } });
    if (!item) return res.status(404).json({ error: 'Not found' });

    let newStock;
    if (type === 'in') newStock = item.currentStock + qty;
    else if (type === 'out' || type === 'waste') newStock = item.currentStock - qty;
    else newStock = qty; // adjust = absolute correction

    // Price the movement AT THE TIME it happens. unitCostKES on the item moves
    // with the market, so valuing a movement later at today's price misstates
    // what it actually cost. The caller may override for a delivery at a new price.
    const unitCost = Number.isFinite(Number(unitCostKES)) ? Number(unitCostKES) : (item.unitCostKES != null ? item.unitCostKES : null);
    // For an adjust, what matters financially is the DELTA, not the new total: a
    // stock take finding 80 bags where the system said 100 is a 20-bag loss.
    const valuedQty = type === 'adjust' ? Math.abs(newStock - item.currentStock) : qty;
    const valueKES = unitCost != null ? Math.round(valuedQty * unitCost * 100) / 100 : null;

    const movement = await prisma.inventoryMovement.create({ data: {
      itemId: item.id,
      type,
      quantity: qty,
      balanceAfter: newStock,
      date: date ? new Date(date) : undefined,
      reference: reference || null,
      notes: notes || null,
      // For a stock take, record WHICH WAY it went. balanceAfter equals quantity
      // on an adjust, so the delta cannot be recovered from the row afterwards —
      // and a count that comes up short (shrinkage, theft, unrecorded issues) needs
      // a different response from one that comes up long.
      reason: type === 'waste'
        ? String(reason)
        : type === 'adjust'
          ? (newStock < item.currentStock ? 'shrinkage' : newStock > item.currentStock ? 'surplus' : 'no_change')
          : (reason || null),
      unitCostKES: unitCost,
      valueKES,
      projectId: projectId || item.projectId || null,
      actorId: (req.user && req.user.sub) || null,
      actorName: (req.user && req.user.name) || null,
    } });
    const updated = await prisma.inventoryItem.update({ where: { id: item.id }, data: { currentStock: newStock } });
    res.json({ movement, item: updated });
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// ===== WASTAGE REPORT =====
// Answers the question the ledger alone cannot: how much material did we buy that
// never became building, what was it, why did it go, on which project, and what
// did it cost. Everything here is derived from recorded movements — nothing is
// estimated or invented.
//
// ?from=YYYY-MM-DD &to=YYYY-MM-DD &projectId=
app.get('/api/inventory/wastage', auth, async (req, res) => {
  try {
    const { from, to, projectId } = req.query;
    const where = { type: { in: ['out', 'waste', 'adjust'] } };
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = new Date(String(from));
      if (to) { const t = new Date(String(to)); t.setHours(23, 59, 59, 999); where.date.lte = t; }
    }
    if (projectId) where.projectId = String(projectId);

    const movements = await prisma.inventoryMovement.findMany({ where, orderBy: { date: 'desc' } });
    const itemIds = [...new Set(movements.map((m) => m.itemId))];
    const items = itemIds.length
      ? await prisma.inventoryItem.findMany({ where: { id: { in: itemIds } } })
      : [];
    const byId = new Map(items.map((i) => [i.id, i]));

    const waste = movements.filter((m) => m.type === 'waste');
    const issued = movements.filter((m) => m.type === 'out');
    // A stock take that finds LESS than the system expected is unexplained loss —
    // shrinkage, theft or unrecorded issues. It is reported separately from
    // declared waste because the two need different responses.
    const shrinkage = movements.filter((m) => m.type === 'adjust' && m.reason === 'shrinkage');

    const sum = (rows, f) => Math.round(rows.reduce((a, r) => a + (Number(f(r)) || 0), 0) * 100) / 100;
    const wasteValue = sum(waste, (m) => m.valueKES);
    const issuedValue = sum(issued, (m) => m.valueKES);

    // Waste by reason — where the money actually goes.
    const byReason = {};
    for (const m of waste) {
      const k = m.reason || 'other';
      if (!byReason[k]) byReason[k] = { reason: k, quantity: 0, valueKES: 0, movements: 0 };
      byReason[k].quantity += Number(m.quantity) || 0;
      byReason[k].valueKES += Number(m.valueKES) || 0;
      byReason[k].movements += 1;
    }

    // Waste by material, with each item's own allowance so "is this normal?" is
    // answerable rather than a judgement call.
    const byItem = {};
    for (const m of movements) {
      const item = byId.get(m.itemId);
      if (!item) continue;
      if (!byItem[m.itemId]) {
        byItem[m.itemId] = {
          itemId: m.itemId, name: item.name, unit: item.unit, category: item.category || null,
          wasteAllowancePct: item.wasteAllowancePct ?? null,
          wastedQty: 0, wastedValueKES: 0, issuedQty: 0, issuedValueKES: 0,
        };
      }
      const b = byItem[m.itemId];
      if (m.type === 'waste') { b.wastedQty += Number(m.quantity) || 0; b.wastedValueKES += Number(m.valueKES) || 0; }
      if (m.type === 'out') { b.issuedQty += Number(m.quantity) || 0; b.issuedValueKES += Number(m.valueKES) || 0; }
    }
    const items_ = Object.values(byItem).map((b) => {
      // Waste rate = wasted / (issued + wasted): of everything that left the
      // store for this material, what share never became building.
      const consumed = b.issuedQty + b.wastedQty;
      const wastePct = consumed > 0 ? Math.round((b.wastedQty / consumed) * 1000) / 10 : 0;
      const allowance = b.wasteAllowancePct;
      return {
        ...b,
        wastedQty: Math.round(b.wastedQty * 100) / 100,
        wastedValueKES: Math.round(b.wastedValueKES * 100) / 100,
        issuedQty: Math.round(b.issuedQty * 100) / 100,
        issuedValueKES: Math.round(b.issuedValueKES * 100) / 100,
        wastePct,
        // Only a claim when there IS an allowance to measure against.
        overAllowance: allowance != null ? wastePct > allowance : null,
        overBy: allowance != null && wastePct > allowance ? Math.round((wastePct - allowance) * 10) / 10 : 0,
      };
    }).sort((a, b) => b.wastedValueKES - a.wastedValueKES);

    const totalConsumedValue = wasteValue + issuedValue;
    res.json({
      totals: {
        wasteValueKES: wasteValue,
        issuedValueKES: issuedValue,
        shrinkageValueKES: sum(shrinkage, (m) => m.valueKES),
        wastePctOfConsumed: totalConsumedValue > 0 ? Math.round((wasteValue / totalConsumedValue) * 1000) / 10 : 0,
        wasteMovements: waste.length,
      },
      byReason: Object.values(byReason)
        .map((r) => ({ ...r, quantity: Math.round(r.quantity * 100) / 100, valueKES: Math.round(r.valueKES * 100) / 100 }))
        .sort((a, b) => b.valueKES - a.valueKES),
      byItem: items_,
      // How much of this is unpriced. A total built from movements with no unit
      // cost understates the loss, and saying so is better than quietly showing a
      // number that is too small.
      unpricedMovements: movements.filter((m) => m.valueKES == null).length,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== SCHEDULED REPORT RUNNER =====
// Scheduled reports were stored with a nextRunAt and then never executed — the
// only timer in this file refreshed the admin cache. A schedule could be created,
// its date would pass, and nothing was generated or sent. The Scheduled tab
// described a recurring email that did not exist.
//
// Every figure below is counted from real rows. Nothing is estimated, and a
// section with no data says so rather than showing a zero that looks like a fact.

const REPORT_PERIOD_DAYS = { daily: 1, weekly: 7, monthly: 30 };

function advanceRunDate(from, frequency) {
  const d = new Date(from);
  if (frequency === 'daily') d.setDate(d.getDate() + 1);
  else if (frequency === 'monthly') d.setMonth(d.getMonth() + 1);
  else d.setDate(d.getDate() + 7); // weekly is the default
  return d;
}

const fmtKES = (n) => 'KSh ' + Math.round(Number(n) || 0).toLocaleString('en-KE');

function reportRow(label, value) {
  return `<tr>
    <td style="padding:6px 0;font-size:13px;color:#475569">${label}</td>
    <td style="padding:6px 0;font-size:13px;color:#0F172A;text-align:right;font-weight:600">${value}</td>
  </tr>`;
}

// Build the body from actual rows in the report's own workspace.
async function buildScheduledReportBody(report) {
  const ws = report.workspaceId || undefined;
  const since = new Date(Date.now() - (REPORT_PERIOD_DAYS[report.frequency] || 7) * 864e5);
  const scope = ws ? { workspaceId: ws } : {};
  const projectScope = report.projectId ? { projectId: report.projectId } : {};
  const type = String(report.reportType || '').toLowerCase();
  const rows = [];

  if (type.includes('financial')) {
    const [cos, commitments, invoices] = await Promise.all([
      prismaBase.changeOrder.findMany({ where: { ...scope, ...projectScope, createdAt: { gte: since } } }),
      prismaBase.commitment.findMany({ where: { ...scope, ...projectScope } }),
      prismaBase.invoice.findMany({ where: { ...scope, ...projectScope } }),
    ]);
    const coValue = cos.reduce((a, c) => a + (Number(c.costUSD) || 0) * USD_TO_KES, 0);
    rows.push(reportRow('Change orders raised', cos.length));
    rows.push(reportRow('Their value', fmtKES(coValue)));
    rows.push(reportRow('Awaiting approval', cos.filter((c) => !['approved', 'rejected', 'void'].includes(c.status)).length));
    rows.push(reportRow('Active commitments', commitments.filter((c) => c.status === 'active').length));
    rows.push(reportRow('Unpaid invoices', invoices.filter((i) => i.status !== 'paid').length));
  } else if (type.includes('operational')) {
    const [checklists, punch, logs] = await Promise.all([
      prismaBase.checklist.findMany({ where: { ...scope, ...projectScope } }),
      prismaBase.punchItem.findMany({ where: { ...scope, ...projectScope } }),
      prismaBase.dailyLog.findMany({ where: { ...scope, ...projectScope, date: { gte: since } } }),
    ]);
    rows.push(reportRow('Checklists submitted', checklists.filter((c) => c.status === 'submitted').length));
    rows.push(reportRow('Still out with the team', checklists.filter((c) => c.status === 'assigned' || c.status === 'in_progress').length));
    rows.push(reportRow('Open punch items', punch.filter((p) => p.status === 'open').length));
    rows.push(reportRow('Daily logs in this period', logs.length));
  } else {
    const [projects, cos, punch] = await Promise.all([
      prismaBase.project.findMany({ where: scope }),
      prismaBase.changeOrder.findMany({ where: { ...scope, createdAt: { gte: since } } }),
      prismaBase.punchItem.findMany({ where: scope }),
    ]);
    rows.push(reportRow('Active projects', projects.filter((p) => p.status !== 'Archived').length));
    rows.push(reportRow('Change orders this period', cos.length));
    rows.push(reportRow('Open punch items', punch.filter((p) => p.status === 'open').length));
  }

  const period = report.frequency === 'daily' ? 'the last day' : report.frequency === 'monthly' ? 'the last month' : 'the last week';
  return `<p style="font-size:14px;color:#11161D">Covering ${period}, to ${new Date().toLocaleDateString('en-KE')}.</p>
    <table style="width:100%;border-collapse:collapse;margin:12px 0;border-top:1px solid #E7EBF0">${rows.join('')}</table>
    ${button(APP_URL + '/', 'Open Buildsasa')}`;
}

async function runDueScheduledReports() {
  let due;
  try {
    due = await prismaBase.scheduledReport.findMany({ where: { active: true, nextRunAt: { lte: new Date() } } });
  } catch (e) {
    console.error('[REPORTS] could not read the schedule:', e && e.message);
    return;
  }
  for (const report of due) {
    // Move the next run forward FIRST. If the send throws, a schedule that is
    // already overdue must not be retried in a tight loop every cycle.
    const next = advanceRunDate(new Date(), report.frequency);
    try {
      await prismaBase.scheduledReport.update({ where: { id: report.id }, data: { lastRunAt: new Date(), nextRunAt: next } });
    } catch (e) {
      console.error('[REPORTS] could not advance schedule', report.id, e && e.message);
      continue;
    }
    const to = String(report.recipients || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!to.length) { console.warn('[REPORTS]', report.name, 'has no recipients — nothing sent'); continue; }
    let body;
    try { body = await buildScheduledReportBody(report); }
    catch (e) { console.error('[REPORTS] could not build', report.name, e && e.message); continue; }
    for (const addr of to) {
      try {
        await sendEmail({ to: addr, subject: `${report.name} — Buildsasa report`, html: emailShell(report.name, body) });
      } catch (e) { console.error('[REPORTS] send failed to', addr, e && e.message); }
    }
    console.log('[REPORTS] ran', report.name, '->', to.length, 'recipient(s); next', next.toISOString());
  }
}

// Checked every five minutes. NOTE: this assumes a single running instance, which
// is how this service is deployed; more than one would each send a copy.
setInterval(runDueScheduledReports, 5 * 60 * 1000).unref();
setTimeout(runDueScheduledReports, 30 * 1000).unref();


// ============================================================================
// PROJECT CLOSEOUT — handover, defects liability, final account
// ============================================================================
// A project ran Planning -> ... -> Closing -> Archived, which skipped the period
// that matters most for liability: the works are handed over, the client is using
// the building, and the contractor is still answerable for defects. None of that
// was recorded, so nobody could answer "are we still liable on this job?".

// Derived, but stored, so it can be queried and sorted without recomputing.
function computeDefectsEnd(practicalCompletionAt, months) {
  if (!practicalCompletionAt || !months) return null;
  const d = new Date(practicalCompletionAt);
  d.setMonth(d.getMonth() + Number(months));
  return d;
}

app.get('/api/projects/:id/closeout', auth, async (req, res) => {
  try {
    const p = await prisma.project.findUnique({ where: { id: req.params.id } });
    if (!p) return res.status(404).json({ error: 'Project not found' });
    const now = Date.now();
    const inDefects = !!(p.practicalCompletionAt && p.defectsEndAt && now < new Date(p.defectsEndAt).getTime());
    const defectsExpired = !!(p.defectsEndAt && now >= new Date(p.defectsEndAt).getTime());
    const openPunch = await prisma.punchItem.count({ where: { projectId: p.id, status: { notIn: ['closed', 'resolved'] } } });
    const retention = await prisma.retentionRecord.findMany({ where: { commitment: { projectId: p.id } } });
    const outstanding = (r) => Number(r.remaining == null ? r.amountHeld : r.remaining) || 0;
    const stillHeld = retention.filter((r) => r.status !== 'released').reduce((a, r) => a + outstanding(r), 0);

    // Saying WHAT blocks closeout is more use than a bare status. Open snagging is
    // the usual reason a final account stalls, so it is surfaced here rather than
    // discovered later.
    const blockers = [];
    if (!p.practicalCompletionAt) blockers.push('Practical completion has not been recorded');
    if (openPunch > 0) blockers.push(openPunch + ' punch item' + (openPunch === 1 ? '' : 's') + ' still open');
    if (stillHeld > 0) blockers.push('Retention is still held');

    res.json({
      practicalCompletionAt: p.practicalCompletionAt,
      defectsLiabilityMonths: p.defectsLiabilityMonths,
      defectsEndAt: p.defectsEndAt,
      finalAccountAt: p.finalAccountAt,
      closeoutNotes: p.closeoutNotes,
      phase: p.finalAccountAt ? 'closed'
        : defectsExpired ? 'defects_expired'
        : inDefects ? 'defects_liability'
        : p.practicalCompletionAt ? 'handed_over'
        : 'in_progress',
      openPunchItems: openPunch,
      retentionStillHeld: Math.round(stillHeld * 100) / 100,
      blockers,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/projects/:id/closeout', auth, async (req, res) => {
  try {
    if (!hasRole(req, CAN_MANAGE_BIDS)) return res.status(403).json({ error: 'Forbidden: ' + ((req.user && req.user.role) || 'this role') + ' cannot change closeout dates' });
    const b = req.body || {};
    const existing = await prisma.project.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Project not found' });

    const data = {};
    if (b.practicalCompletionAt !== undefined) data.practicalCompletionAt = b.practicalCompletionAt ? new Date(b.practicalCompletionAt) : null;
    if (b.defectsLiabilityMonths !== undefined) data.defectsLiabilityMonths = (b.defectsLiabilityMonths == null || b.defectsLiabilityMonths === '') ? null : Number(b.defectsLiabilityMonths);
    if (b.finalAccountAt !== undefined) data.finalAccountAt = b.finalAccountAt ? new Date(b.finalAccountAt) : null;
    if (b.closeoutNotes !== undefined) data.closeoutNotes = b.closeoutNotes || null;

    const pc = data.practicalCompletionAt !== undefined ? data.practicalCompletionAt : existing.practicalCompletionAt;
    const months = data.defectsLiabilityMonths !== undefined ? data.defectsLiabilityMonths : existing.defectsLiabilityMonths;
    data.defectsEndAt = computeDefectsEnd(pc, months);

    const row = await prisma.project.update({ where: { id: req.params.id }, data });

    // Recording practical completion is what makes the first half of retention
    // payable, so the schedule is written here rather than left to be remembered.
    if (data.practicalCompletionAt && !existing.practicalCompletionAt) {
      await scheduleRetentionRelease(req.params.id, data.practicalCompletionAt, row.defectsEndAt);
    }
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================================================
// RETENTION RELEASE
// ============================================================================
// Retention was held and never came back: a releaseDate could pass with the row
// still marked "held", because nothing ever read it. The money stayed on the books
// indefinitely and nobody was told it had become payable.

// Half at practical completion, half at the end of the defects period — the
// standard split. Existing stages are skipped, so re-saving a handover date does
// not duplicate the schedule.
async function scheduleRetentionRelease(projectId, practicalCompletionAt, defectsEndAt) {
  const commitments = await prisma.commitment.findMany({ where: { projectId, retentionHeld: { gt: 0 } } });
  for (const c of commitments) {
    const held = Number(c.retentionHeld) || 0;
    if (held <= 0) continue;
    const existing = await prisma.retentionRecord.findMany({ where: { commitmentId: c.id } });
    const half = Math.round((held / 2) * 100) / 100;
    const stages = [
      { stage: 'practical_completion', amount: half, releaseDate: practicalCompletionAt },
      { stage: 'defects_expiry', amount: Math.round((held - half) * 100) / 100, releaseDate: defectsEndAt },
    ];
    for (const st of stages) {
      if (!st.releaseDate) continue;
      if (existing.some((r) => r.stage === st.stage)) continue;
      await prisma.retentionRecord.create({ data: {
        commitmentId: c.id,
        amountHeld: st.amount,
        amountReleased: 0,
        remaining: st.amount,
        releaseDate: new Date(st.releaseDate),
        stage: st.stage,
        status: 'held',
      } });
    }
  }
}

// Anything past its release date becomes payable. On a timer so the money surfaces
// on its own instead of waiting to be noticed by someone.
async function markDueRetention() {
  try {
    const r = await prismaBase.retentionRecord.updateMany({
      where: { status: 'held', releaseDate: { lte: new Date() } },
      data: { status: 'due' },
    });
    if (r.count) console.log('[RETENTION] ' + r.count + ' record(s) became due');
  } catch (e) { console.error('[RETENTION] sweep failed:', e && e.message); }
}
setInterval(markDueRetention, 6 * 60 * 60 * 1000).unref();
setTimeout(markDueRetention, 45 * 1000).unref();

// Cross-project view: what is held, what has fallen due, across every job. The
// project-scoped GET above answers "on this job"; this one answers "anywhere".
app.get('/api/retention/due', auth, async (req, res) => {
  try {
    const where = {};
    if (req.query.projectId) where.commitment = { projectId: String(req.query.projectId) };
    if (req.query.status) where.status = String(req.query.status);
    const rows = await prisma.retentionRecord.findMany({
      where,
      orderBy: { releaseDate: 'asc' },
      include: { commitment: { select: { vendor: true, scope: true, projectId: true } } },
    });
    const outstanding = (r) => Number(r.remaining == null ? r.amountHeld : r.remaining) || 0;
    const due = rows.filter((r) => r.status === 'due' || (r.status === 'held' && r.releaseDate && new Date(r.releaseDate) <= new Date()));
    res.json({
      records: rows,
      totals: {
        held: Math.round(rows.filter((r) => r.status !== 'released').reduce((a, r) => a + outstanding(r), 0) * 100) / 100,
        dueNow: Math.round(due.reduce((a, r) => a + outstanding(r), 0) * 100) / 100,
        released: Math.round(rows.reduce((a, r) => a + (Number(r.amountReleased) || 0), 0) * 100) / 100,
      },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});



// ============================================================================
// ADVANCE RECOVERY
// ============================================================================
// A mobilisation advance is money paid before any work is done, recovered from
// later payment claims. It could be recorded as a payment, but nothing ever
// recovered it — so it sat on the books as though it had been earned, and the
// balance outstanding on the subcontract was overstated for the life of the job.

// How much of a claim repays the advance. Never more than is still outstanding,
// and never more than the claim itself, so a recovery cannot push a claim negative
// or repay more than was advanced.
function computeAdvanceRecovery(commitment, grossClaim) {
  const advance = Number(commitment && commitment.advanceAmount) || 0;
  const recovered = Number(commitment && commitment.advanceRecovered) || 0;
  const pct = Number(commitment && commitment.advanceRecoveryPct) || 0;
  const outstanding = Math.max(0, advance - recovered);
  if (outstanding <= 0 || pct <= 0) return 0;
  const wanted = (Number(grossClaim) || 0) * (pct / 100);
  return Math.round(Math.min(wanted, outstanding, Number(grossClaim) || 0) * 100) / 100;
}

// What a claim is actually worth once retention is held back and the advance is
// repaid. Kept in one place so the figure on the claim, the figure on the
// subcontract and the figure paid can never disagree.
function settleClaim(commitment, grossClaim, retentionPct) {
  const gross = Number(grossClaim) || 0;
  const retention = Math.round(gross * ((Number(retentionPct) || 0) / 100) * 100) / 100;
  const advanceRecovery = computeAdvanceRecovery(commitment, gross);
  const netPayable = Math.round((gross - retention - advanceRecovery) * 100) / 100;
  return { gross, retentionAmount: retention, advanceRecovery, netPayable };
}

// Preview the numbers before committing to them, so a QS can see what a claim will
// actually pay out before it is raised.
app.post('/api/commitments/:id/claim-preview', auth, async (req, res) => {
  try {
    const c = await prisma.commitment.findUnique({ where: { id: req.params.id } });
    if (!c) return res.status(404).json({ error: 'Subcontract not found' });
    const gross = Number((req.body || {}).grossClaim) || 0;
    if (gross <= 0) return res.status(400).json({ error: 'Enter the amount being claimed' });
    const retentionPct = (req.body || {}).retentionPct != null ? Number(req.body.retentionPct) : (Number(c.retentionPct) || 0);
    const result = settleClaim(c, gross, retentionPct);
    const advance = Number(c.advanceAmount) || 0;
    const recovered = Number(c.advanceRecovered) || 0;
    res.json({
      ...result,
      retentionPct,
      advanceOutstandingBefore: Math.round(Math.max(0, advance - recovered) * 100) / 100,
      advanceOutstandingAfter: Math.round(Math.max(0, advance - recovered - result.advanceRecovery) * 100) / 100,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Record a claim: holds retention, recovers part of the advance, and moves the
// subcontract's running totals in one place.
app.post('/api/commitments/:id/claims', auth, async (req, res) => {
  try {
    if (!hasRole(req, CAN_MANAGE_BIDS)) return res.status(403).json({ error: 'Forbidden: ' + ((req.user && req.user.role) || 'this role') + ' cannot certify claims' });
    const c = await prisma.commitment.findUnique({ where: { id: req.params.id } });
    if (!c) return res.status(404).json({ error: 'Subcontract not found' });
    const body = req.body || {};
    const gross = Number(body.grossClaim) || 0;
    if (gross <= 0) return res.status(400).json({ error: 'Enter the amount being claimed' });

    const retentionPct = body.retentionPct != null ? Number(body.retentionPct) : (Number(c.retentionPct) || 0);
    const s = settleClaim(c, gross, retentionPct);

    const number = String(body.number || ('PA-' + Date.now().toString(36).toUpperCase()));
    const app_ = await prisma.paymentApplication.create({ data: {
      projectId: c.projectId,
      commitmentId: c.id,
      number,
      period: body.period || null,
      workCompletedThisPeriod: s.gross,
      previousCertified: Number(c.invoicedToDate) || 0,
      requestedAmount: s.gross,
      retentionPct,
      retentionAmount: s.retentionAmount,
      advanceRecovery: s.advanceRecovery,
      netPayable: s.netPayable,
      status: body.status || 'submitted',
    } });

    const updated = await prisma.commitment.update({ where: { id: c.id }, data: {
      invoicedToDate: Math.round(((Number(c.invoicedToDate) || 0) + s.gross) * 100) / 100,
      retentionHeld: Math.round(((Number(c.retentionHeld) || 0) + s.retentionAmount) * 100) / 100,
      advanceRecovered: Math.round(((Number(c.advanceRecovered) || 0) + s.advanceRecovery) * 100) / 100,
      balanceRemaining: Math.round((((Number(c.contractValue) || 0) - (Number(c.invoicedToDate) || 0) - s.gross)) * 100) / 100,
    } });

    res.json({ application: app_, commitment: updated });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================================================
// BILL OF QUANTITIES / ESTIMATING
// ============================================================================
// The product could tender a job and manage it, but never PRICE one. The budget
// had no origin: expense categories carried a figure typed from nowhere, so
// "budget vs actual" compared actuals against a guess. A BOQ is the priced
// breakdown of the works; its total is a budget that can be defended.

const boqAmount = (qty, rate) => Math.round((Number(qty) || 0) * (Number(rate) || 0) * 100) / 100;

app.get('/api/projects/:projectId/boq', auth, async (req, res) => {
  try {
    const sections = await prisma.boqSection.findMany({
      where: { projectId: req.params.projectId },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      include: { items: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] } },
    });
    const withTotals = sections.map((s) => ({
      ...s,
      total: Math.round(s.items.reduce((a, i) => a + (Number(i.amount) || 0), 0) * 100) / 100,
    }));
    const total = Math.round(withTotals.reduce((a, s) => a + s.total, 0) * 100) / 100;
    const itemCount = withTotals.reduce((a, s) => a + s.items.length, 0);
    // An unpriced line contributes nothing to the total, so a BOQ that looks
    // complete can still be missing money. Say how many, rather than letting the
    // total imply more certainty than it has.
    const unpriced = withTotals.reduce((a, s) => a + s.items.filter((i) => !Number(i.rate)).length, 0);
    res.json({ sections: withTotals, total, itemCount, unpricedItems: unpriced });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/projects/:projectId/boq/sections', auth, async (req, res) => {
  try {
    if (!hasRole(req, CAN_MANAGE_BIDS)) return res.status(403).json({ error: 'Forbidden: ' + ((req.user && req.user.role) || 'this role') + ' cannot edit the bill of quantities' });
    const b = req.body || {};
    if (!String(b.title || '').trim()) return res.status(400).json({ error: 'A section needs a title' });
    const count = await prisma.boqSection.count({ where: { projectId: req.params.projectId } });
    const row = await prisma.boqSection.create({ data: {
      projectId: req.params.projectId,
      code: b.code || null,
      title: String(b.title).trim(),
      position: b.position == null ? count : Number(b.position),
    } });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/boq/sections/:id', auth, async (req, res) => {
  try {
    if (!hasRole(req, CAN_MANAGE_BIDS)) return res.status(403).json({ error: 'Not allowed' });
    const b = req.body || {};
    const data = {};
    if (b.title !== undefined) data.title = b.title;
    if (b.code !== undefined) data.code = b.code || null;
    if (b.position !== undefined) data.position = Number(b.position) || 0;
    res.json(await prisma.boqSection.update({ where: { id: req.params.id }, data }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/boq/sections/:id', auth, async (req, res) => {
  try {
    if (!hasRole(req, CAN_MANAGE_BIDS)) return res.status(403).json({ error: 'Not allowed' });
    await prisma.boqSection.delete({ where: { id: req.params.id } }); // items cascade
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/boq/sections/:sectionId/items', auth, async (req, res) => {
  try {
    if (!hasRole(req, CAN_MANAGE_BIDS)) return res.status(403).json({ error: 'Not allowed' });
    const b = req.body || {};
    if (!String(b.description || '').trim()) return res.status(400).json({ error: 'An item needs a description' });
    const count = await prisma.boqItem.count({ where: { sectionId: req.params.sectionId } });
    const row = await prisma.boqItem.create({ data: {
      sectionId: req.params.sectionId,
      code: b.code || null,
      description: String(b.description).trim(),
      unit: b.unit || 'item',
      quantity: Number(b.quantity) || 0,
      rate: Number(b.rate) || 0,
      // Stored, not derived on read, so a historical line keeps the figure it was
      // actually priced at even if the rate is edited later.
      amount: boqAmount(b.quantity, b.rate),
      costCodeId: b.costCodeId || null,
      position: b.position == null ? count : Number(b.position),
    } });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/boq/items/:id', auth, async (req, res) => {
  try {
    if (!hasRole(req, CAN_MANAGE_BIDS)) return res.status(403).json({ error: 'Not allowed' });
    const existing = await prisma.boqItem.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const b = req.body || {};
    const data = {};
    if (b.code !== undefined) data.code = b.code || null;
    if (b.description !== undefined) data.description = b.description;
    if (b.unit !== undefined) data.unit = b.unit;
    if (b.quantity !== undefined) data.quantity = Number(b.quantity) || 0;
    if (b.rate !== undefined) data.rate = Number(b.rate) || 0;
    if (b.costCodeId !== undefined) data.costCodeId = b.costCodeId || null;
    if (b.position !== undefined) data.position = Number(b.position) || 0;
    // Recompute whenever either side of the multiplication moved.
    const qty = data.quantity !== undefined ? data.quantity : existing.quantity;
    const rate = data.rate !== undefined ? data.rate : existing.rate;
    data.amount = boqAmount(qty, rate);
    res.json(await prisma.boqItem.update({ where: { id: req.params.id }, data }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/boq/items/:id', auth, async (req, res) => {
  try {
    if (!hasRole(req, CAN_MANAGE_BIDS)) return res.status(403).json({ error: 'Not allowed' });
    await prisma.boqItem.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Turn the priced BOQ into the project's budget, so budget-vs-actual finally
// compares actuals against something that was actually estimated. Sections become
// expense categories; existing ones are updated rather than duplicated.
app.post('/api/projects/:projectId/boq/apply-budget', auth, async (req, res) => {
  try {
    if (!hasRole(req, CAN_MANAGE_BIDS)) return res.status(403).json({ error: 'Forbidden: ' + ((req.user && req.user.role) || 'this role') + ' cannot set the budget' });
    const sections = await prisma.boqSection.findMany({
      where: { projectId: req.params.projectId },
      include: { items: true },
    });
    if (!sections.length) return res.status(400).json({ error: 'There is no bill of quantities to apply' });

    const existing = await prisma.expenseCategory.findMany({ where: { projectId: req.params.projectId } });
    let created = 0; let updated = 0;
    for (const s of sections) {
      const totalKES = Math.round(s.items.reduce((a, i) => a + (Number(i.amount) || 0), 0));
      if (totalKES <= 0) continue;
      // ExpenseCategory.budgetUSD is stored in USD like the rest of the ledger.
      const budgetUSD = Math.round(totalKES / USD_TO_KES);
      const match = existing.find((e) => e.name.toLowerCase() === s.title.toLowerCase());
      if (match) {
        await prisma.expenseCategory.update({ where: { id: match.id }, data: { budgetUSD } });
        updated += 1;
      } else {
        await prisma.expenseCategory.create({ data: { name: s.title, budgetUSD, actualUSD: 0, projectId: req.params.projectId } });
        created += 1;
      }
    }
    const total = Math.round(sections.reduce((a, s) => a + s.items.reduce((x, i) => x + (Number(i.amount) || 0), 0), 0) * 100) / 100;
    res.json({ ok: true, created, updated, totalKES: total });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== ATTENDANCE =====
app.get('/api/attendance', auth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const { date, userId: queryUserId, all } = req.query;
    const where = {};
    // all=1 → team-wide (for managers' manpower view); otherwise the user's own.
    if (all === '1') { if (queryUserId) where.userId = queryUserId; }
    else { where.userId = queryUserId || userId; }
    if (date) where.date = date;
    const rows = await prisma.attendance.findMany({ where, orderBy: { date: 'desc' }, include: { user: { select: { name: true, role: true, email: true } } } });
    res.json(rows || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// Resolve the request's user to a REAL row so attendance's foreign key holds.
// Handles the demo account / token users whose row may not exist yet.
async function resolveAttendanceUser(req) {
  const u = req.user || {};
  if (u.sub) { const byId = await prisma.user.findUnique({ where: { id: u.sub } }); if (byId) return byId.id; }
  if (u.email) { const byEmail = await prisma.user.findUnique({ where: { email: String(u.email).toLowerCase() } }); if (byEmail) return byEmail.id; }
  let email = (u.email && String(u.email).toLowerCase()) || `${u.sub || 'user'}@local.buildflex`;
  if (await prisma.user.findUnique({ where: { email } })) email = `${u.sub || 'user'}-${Date.now()}@local.buildflex`;
  const created = await prisma.user.create({ data: { ...(u.sub ? { id: u.sub } : {}), email, name: u.name || 'User', role: u.role || 'Worker', workspaceId: u.ws || null } });
  return created.id;
}
app.post('/api/attendance', auth, async (req, res) => {
  try {
    // A supervisor/manager can record for a team member by passing userId;
    // otherwise it's the requester's own check-in.
    let userId;
    if (req.body.userId) {
      const t = await prisma.user.findUnique({ where: { id: req.body.userId } });
      userId = t ? t.id : await resolveAttendanceUser(req);
    } else {
      userId = await resolveAttendanceUser(req);
    }
    const { date, checkIn, checkOut, location, breakStart, breakEnd, breakDuration, status, notes } = req.body;
    const row = await prisma.attendance.create({ data: { userId, date, checkIn, checkOut, location, breakStart, breakEnd, breakDuration: breakDuration ? Number(breakDuration) : null, status, notes } });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/attendance/:id', auth, async (req, res) => {
  try {
    const { checkIn, checkOut, location, breakStart, breakEnd, breakDuration, status, notes } = req.body;
    const row = await prisma.attendance.update({ where: { id: req.params.id }, data: { checkIn, checkOut, location, breakStart, breakEnd, breakDuration: breakDuration ? Number(breakDuration) : null, status, notes } });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/attendance/:id', auth, async (req, res) => {
  try { await prisma.attendance.delete({ where: { id: req.params.id } }); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== CHECKLIST TEMPLATES =====
app.get('/api/checklist-templates', auth, async (req, res) => {
  try {
    const where = {};
    if (req.query.isGlobal === 'true') where.isGlobal = true;
    if (req.query.status) where.status = req.query.status;
    const rows = await prisma.checklistTemplate.findMany({ where, orderBy: { createdAt: 'desc' } });
    res.json(rows || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/checklist-templates', auth, async (req, res) => {
  try {
    const { title, trade, category, items, isGlobal, status } = req.body;
    const row = await prisma.checklistTemplate.create({
      data: {
        title, trade, category,
        items: typeof items === 'string' ? items : JSON.stringify(items || []),
        isGlobal: !!isGlobal,
        status: status || 'active',
        createdBy: req.user.sub,
      }
    });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/checklist-templates/:id', auth, async (req, res) => {
  try {
    const { title, trade, category, items, isGlobal, status } = req.body;
    const data = {};
    if (title !== undefined) data.title = title;
    if (trade !== undefined) data.trade = trade;
    if (category !== undefined) data.category = category;
    if (items !== undefined) data.items = typeof items === 'string' ? items : JSON.stringify(items || []);
    if (isGlobal !== undefined) data.isGlobal = !!isGlobal;
    if (status !== undefined) data.status = status;
    const row = await prisma.checklistTemplate.update({ where: { id: req.params.id }, data });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/checklist-templates/:id', auth, async (req, res) => {
  try {
    await prisma.checklistTemplate.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== SHAREABLE FORM LINKS =====
// Enable/disable a shareable link for a template and set public/private.
// Public = fillable by anyone with the link (no auth). Private = link inactive.
app.post('/api/checklist-templates/:id/share', auth, async (req, res) => {
  try {
    const { public: isPublic } = req.body || {};
    const tpl = await prisma.checklistTemplate.findUnique({ where: { id: req.params.id } });
    if (!tpl) return res.status(404).json({ error: 'Template not found' });
    const token = tpl.shareToken || (require('crypto').randomBytes(9).toString('base64url'));
    const updated = await prisma.checklistTemplate.update({
      where: { id: req.params.id },
      data: { shareToken: token, sharePublic: !!isPublic },
    });
    res.json({ token: updated.shareToken, public: updated.sharePublic, url: `${APP_URL}/?form=${updated.shareToken}` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// List responses submitted to a template's public link (auth required).
app.get('/api/checklist-templates/:id/submissions', auth, async (req, res) => {
  try {
    const rows = await prisma.formSubmission.findMany({ where: { templateId: req.params.id }, orderBy: { createdAt: 'desc' }, take: 1000 });
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Public: fetch a shared form by token (NO auth). Only works when public.
app.get('/api/public/forms/:token', async (req, res) => {
  try {
    const tpl = await prisma.checklistTemplate.findUnique({ where: { shareToken: req.params.token } });
    if (!tpl || !tpl.sharePublic) return res.status(404).json({ error: 'This form is not available.' });
    res.json({ id: tpl.id, title: tpl.title, trade: tpl.trade, category: tpl.category, items: tpl.items });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Public: submit a filled form (NO auth). Only works when public.
app.post('/api/public/forms/:token/submit', async (req, res) => {
  try {
    const { respondentName, respondentEmail, data } = req.body || {};
    const tpl = await prisma.checklistTemplate.findUnique({ where: { shareToken: req.params.token } });
    if (!tpl || !tpl.sharePublic) return res.status(404).json({ error: 'This form is not accepting responses.' });
    await prisma.formSubmission.create({
      data: {
        templateId: tpl.id,
        respondentName: respondentName ? String(respondentName).slice(0, 200) : null,
        respondentEmail: respondentEmail ? String(respondentEmail).slice(0, 200) : null,
        data: typeof data === 'string' ? data : JSON.stringify(data || {}),
      },
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// CSV / AI upload to create a checklist template
app.post('/api/checklist-templates/from-csv', auth, async (req, res) => {
  try {
  const { title, trade, category, csvText, source } = req.body;
  if (!csvText || !title) return res.status(400).json({ error: 'title and csvText required' });

  // Smart CSV parser
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) return res.status(400).json({ error: 'CSV must have at least a header and one row' });
  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const qIdx = headers.findIndex((h) => h.includes('question') || h.includes('item') || h.includes('task') || h.includes('title'));
  const typeIdx = headers.findIndex((h) => h.includes('type') || h.includes('format') || h.includes('answer'));
  const reqIdx = headers.findIndex((h) => h.includes('required') || h.includes('mandatory'));
  const optIdx = headers.findIndex((h) => h.includes('option') || h.includes('choice'));

  const items = [];
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].trim();
    if (!row) continue;
    const cols = row.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    const questionText = cols[Math.max(qIdx, 0)] || `Item ${i}`;
    let qType = 'text';
    if (typeIdx >= 0) {
      const raw = cols[typeIdx]?.toLowerCase() || '';
      if (raw.includes('yes') || raw.includes('no') || raw.includes('pass') || raw.includes('fail')) qType = 'yes_no';
      else if (raw.includes('photo') || raw.includes('image') || raw.includes('picture')) qType = 'photo';
      else if (raw.includes('sign')) qType = 'signature';
      else if (raw.includes('number') || raw.includes('measure')) qType = 'number';
      else if (raw.includes('date')) qType = 'date';
      else if (raw.includes('dropdown') || raw.includes('select')) qType = 'dropdown';
      else if (raw.includes('check')) qType = 'checkbox';
    }
    const required = reqIdx >= 0 ? /yes|true|1/.test(cols[reqIdx]?.toLowerCase() || '') : false;
    let options = [];
    if (optIdx >= 0 && cols[optIdx]) {
      options = cols[optIdx].split(/;|\|/).map((o) => o.trim()).filter(Boolean);
    }
    items.push({ question: questionText, questionType: qType, required, position: i - 1, options });
  }

  const template = await prisma.checklistTemplate.create({
    data: {
      title,
      trade: trade || 'General',
      category: category || 'custom',
      items: JSON.stringify(items),
      source: source || 'upload',
      createdBy: req.user.sub,
    }
  });
  res.json({ template, parsedItems: items });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Parse uploaded file (.csv or .xlsx) and return preview + suggested column mappings
app.post('/api/checklist-templates/parse-file', auth, singleFile('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const ext = (req.file.originalname || '').toLowerCase();
    let rows = [];
    let headers = [];

    if (ext.endsWith('.xlsx') || ext.endsWith('.xls')) {
      const workbook = xlsx.readFile(req.file.path);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const data = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      if (data.length < 2) return res.status(400).json({ error: 'Excel sheet must have at least a header and one row' });
      headers = data[0].map((h) => String(h).trim());
      rows = data.slice(1).map((r) => headers.map((_, i) => String(r[i] ?? '').trim()));
    } else {
      // CSV
      const content = require('fs').readFileSync(req.file.path, 'utf-8');
      const delimiter = content.includes('\t') ? '\t' : (content.includes(';') ? ';' : ',');
      const parsed = csvParse(content, { columns: false, delimiter, trim: true, skip_empty_lines: true });
      if (parsed.length < 2) return res.status(400).json({ error: 'CSV must have at least a header and one row' });
      headers = parsed[0].map((h) => String(h).trim());
      rows = parsed.slice(1).map((r) => r.map((c) => String(c ?? '').trim()));
    }

    // Suggest column mappings based on header keywords
    const suggest = (keywords) => {
      const idx = headers.findIndex((h) => keywords.some((k) => h.toLowerCase().includes(k)));
      return idx >= 0 ? idx : null;
    };
    const suggestedMappings = {
      question: suggest(['question', 'item', 'task', 'title', 'description', 'check', 'inspection']),
      type: suggest(['type', 'format', 'answer', 'response', 'input']),
      required: suggest(['required', 'mandatory', 'must', 'compulsory']),
      options: suggest(['option', 'choice', 'select', 'dropdown', 'list']),
    };

    // Build preview rows (first 6 data rows)
    const previewRows = rows.slice(0, 6);

    // Clean up temp file
    try { require('fs').unlinkSync(req.file.path); } catch {}

    res.json({ headers, previewRows, suggestedMappings, rowCount: rows.length });
  } catch (err) {
    console.error('Parse file error:', err);
    res.status(500).json({ error: 'Failed to parse file', message: err.message });
  }
});

// Create template from user-confirmed parsed data
app.post('/api/checklist-templates/from-parsed', auth, async (req, res) => {
  try {
  const { title, trade, category, rows, mappings } = req.body;
  if (!title || !Array.isArray(rows) || !mappings) return res.status(400).json({ error: 'title, rows, and mappings required' });

  const qIdx = mappings.question ?? 0;
  const typeIdx = mappings.type;
  const reqIdx = mappings.required;
  const optIdx = mappings.options;

  const items = rows.map((cols, i) => {
    const questionText = String(cols[qIdx] ?? '').trim() || `Item ${i + 1}`;
    let qType = 'text';
    if (typeIdx !== null && typeIdx !== undefined && cols[typeIdx]) {
      const raw = String(cols[typeIdx]).toLowerCase();
      if (raw.includes('yes') || raw.includes('no') || raw.includes('pass') || raw.includes('fail')) qType = 'yes_no';
      else if (raw.includes('photo') || raw.includes('image') || raw.includes('picture')) qType = 'photo';
      else if (raw.includes('sign')) qType = 'signature';
      else if (raw.includes('number') || raw.includes('measure') || raw.includes('count') || raw.includes('qty')) qType = 'number';
      else if (raw.includes('date') || raw.includes('time')) qType = 'date';
      else if (raw.includes('dropdown') || raw.includes('select')) qType = 'dropdown';
      else if (raw.includes('check') || raw.includes('multi')) qType = 'checkbox';
    }
    const required = reqIdx !== null && reqIdx !== undefined ? /yes|true|1|y/.test(String(cols[reqIdx] ?? '').toLowerCase()) : false;
    let options = [];
    if (optIdx !== null && optIdx !== undefined && cols[optIdx]) {
      options = String(cols[optIdx]).split(/;|\||,/).map((o) => o.trim()).filter(Boolean);
    }
    return { question: questionText, questionType: qType, required, position: i, options };
  });

  const template = await prisma.checklistTemplate.create({
    data: {
      title,
      trade: trade || 'General',
      category: category || 'custom',
      items: JSON.stringify(items),
      source: 'upload',
      createdBy: req.user.sub,
    }
  });
  res.json({ template, parsedItems: items });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Create checklist from template
// Extra per-question fields carried from the upload template (kept for integrity).
function qExtra(q) {
  return {
    questionGroup: q.questionGroup || null,
    defaultAnswer: q.defaultAnswer || null,
    photoAvailable: q.photoAvailable || 'No',
    correctiveOption: q.correctiveOption || null,
    correctiveActions: Array.isArray(q.correctiveActions) ? JSON.stringify(q.correctiveActions) : (q.correctiveActions || null),
    policy: q.policy || null,
  };
}

app.post('/api/checklists/from-template/:templateId', auth, async (req, res) => {
  try {
  const template = await prisma.checklistTemplate.findUnique({ where: { id: req.params.templateId } });
  if (!template) return res.status(404).json({ error: 'Template not found' });

  const parsedItems = (() => { try { return JSON.parse(template.items || '[]'); } catch { return []; } })();
  const { title, description, category, projectId, dueDate } = req.body;

  const checklist = await prisma.checklist.create({
    data: {
      title: title || template.title,
      description: description || `Created from template: ${template.title}`,
      category: category || template.category || template.trade,
      trade: template.trade || null,
      source: 'template',
      status: 'draft',
      templateId: template.id,
      projectId: projectId || undefined,
      dueDate: dueDate ? new Date(dueDate) : undefined,
      createdBy: req.user.sub,
    },
    include: { questions: true },
  });

  // Two-pass creation to handle parentId (tempId -> realId mapping)
  const tempToReal = new Map();
  const itemsWithoutParent = parsedItems.filter((q) => !q.parentId);
  const itemsWithParent = parsedItems.filter((q) => !!q.parentId);

  // Pass 1: create all questions without parentId
  for (const q of itemsWithoutParent) {
    const created = await prisma.checklistQuestion.create({
      data: {
        checklistId: checklist.id,
        question: q.question || 'Question',
        questionType: q.questionType || 'text',
        required: !!q.required,
        position: q.position ?? 0,
        options: Array.isArray(q.options) ? JSON.stringify(q.options) : (q.options || '[]'),
        ...qExtra(q),
      },
    });
    if (q.tempId) tempToReal.set(q.tempId, created.id);
    if (q.parentId && tempToReal.has(q.parentId)) {
      // If somehow parentId maps directly to an existing real id, use it
      tempToReal.set(q.tempId || q.question, created.id);
    }
  }

  // Also map any items that already have a real parentId (from existing templates)
  for (const q of itemsWithParent) {
    if (!tempToReal.has(q.parentId)) {
      // parentId might already be a real UUID from a previous template; keep it as-is if valid
      // We'll create these in pass 2
    }
  }

  // Pass 2: create questions with parentId (now that parents exist)
  for (const q of itemsWithParent) {
    let realParentId = tempToReal.get(q.parentId) || null;
    if (!realParentId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q.parentId)) {
      realParentId = q.parentId; // Already a real UUID
    }
    const created = await prisma.checklistQuestion.create({
      data: {
        checklistId: checklist.id,
        question: q.question || 'Question',
        questionType: q.questionType || 'text',
        required: !!q.required,
        position: q.position ?? 0,
        options: Array.isArray(q.options) ? JSON.stringify(q.options) : (q.options || '[]'),
        parentId: realParentId,
        ...qExtra(q),
      },
    });
    if (q.tempId) tempToReal.set(q.tempId, created.id);
  }

  const full = await prisma.checklist.findUnique({
    where: { id: checklist.id },
    include: { questions: { orderBy: { position: 'asc' } } },
  });
  res.json(full);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== CHECKLISTS =====
app.get('/api/checklists', auth, async (req, res) => {
  try {
    const where = {};
    if (req.query.projectId) where.projectId = req.query.projectId;
    if (req.query.status) where.status = req.query.status;
    const rows = await prisma.checklist.findMany({ where, orderBy: { createdAt: 'desc' }, include: { questions: { orderBy: { position: 'asc' } }, responses: true } });
    res.json(rows || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/checklists', auth, requireRole(CAN_GENERATE_CHECKLISTS), async (req, res) => {
  try {
    const { title, description, category, trade, source, questions, assignee, assignedTo, templateId, dueDate, projectId } = req.body;
    const checklist = await prisma.checklist.create({
      data: {
        title,
        description,
        category,
        trade: trade || undefined,
        source: source || 'manual',
        status: 'draft',
        assignee: assignee || undefined,
        assignedTo: assignedTo ? JSON.stringify(assignedTo) : undefined,
        templateId: templateId || undefined,
        dueDate: dueDate ? new Date(dueDate) : undefined,
        projectId: projectId || undefined,
        createdBy: req.user.sub,
        questions: { create: (questions || []).map((q, i) => ({ question: q.question, questionType: q.questionType, required: !!q.required, position: q.position ?? i, options: typeof q.options === 'string' ? q.options : JSON.stringify(q.options || []), parentId: q.parentId || null, ...qExtra(q) })) }
      },
      include: { questions: { orderBy: { position: 'asc' } } },
    });
    res.json(checklist);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/checklists/:id', auth, async (req, res) => {
  try {
    const row = await prisma.checklist.findUnique({ where: { id: req.params.id }, include: { questions: { orderBy: { position: 'asc' } }, responses: true } });
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/checklists/:id', auth, requireRole(CAN_ASSIGN_TASKS), async (req, res) => {
  try {
    const { title, description, category, trade, reportedProgress, status, assigned, assignee, assignedTo, templateId, dueDate, projectId } = req.body;
    const data = {};
    if (title !== undefined) data.title = title;
    if (trade !== undefined) data.trade = trade || null;
    if (reportedProgress !== undefined) data.reportedProgress = reportedProgress == null ? null : Math.max(0, Math.min(100, Math.round(Number(reportedProgress))));
    if (description !== undefined) data.description = description;
    if (category !== undefined) data.category = category;
    if (status !== undefined) data.status = status;
    if (assigned !== undefined) data.assigned = assigned;
    if (assignee !== undefined) data.assignee = assignee || undefined;
    if (assignedTo !== undefined) data.assignedTo = Array.isArray(assignedTo) ? JSON.stringify(assignedTo) : assignedTo;
    if (templateId !== undefined) data.templateId = templateId || undefined;
    if (dueDate !== undefined) data.dueDate = dueDate ? new Date(dueDate) : undefined;
    if (projectId !== undefined) data.projectId = projectId || undefined;
    const row = await prisma.checklist.update({ where: { id: req.params.id }, data });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/checklists/:id', auth, async (req, res) => {
  try {
    await prisma.checklist.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Assign checklist to users
app.post('/api/checklists/:id/assign', auth, requireRole(CAN_ASSIGN_TASKS), async (req, res) => {
  try {
    const { userIds, projectId } = req.body;
    if (!Array.isArray(userIds) || userIds.length === 0) return res.status(400).json({ error: 'userIds array required' });
    // The project is set as part of assigning, in the same write. It used to be
    // settable only at creation time from one of the two entry points, so most
    // checklists ended up with no project — which silently excluded them from the
    // project progress roll-up and from the project's own dashboard.
    // `undefined` leaves it alone; `null` clears it.
    const data = { assigned: true, assignedTo: JSON.stringify(userIds), status: 'assigned' };
    if (projectId !== undefined) data.projectId = projectId || null;
    const row = await prisma.checklist.update({
      where: { id: req.params.id },
      data,
    });
    notifyAssignment(userIds, {
      subject: 'You have been assigned a checklist',
      intro: `you've been assigned the checklist "${row.title}"${row.dueDate ? ` (due ${row.dueDate})` : ''}. Open Buildsasa to complete it.`,
      link: APP_URL,
    });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Contractor-reported field progress (0-100) for a work item. This is the
// assignee's estimate of how far the actual work is, separate from QA
// completion (answered/total). Advancing it nudges the status to in_progress.
app.post('/api/checklists/:id/progress', auth, requireRole(CAN_FILL_CHECKLISTS), async (req, res) => {
  try {
    let pct = Number(req.body?.progress);
    if (!Number.isFinite(pct)) return res.status(400).json({ error: 'progress (0-100) required' });
    pct = Math.max(0, Math.min(100, Math.round(pct)));
    const existing = await prisma.checklist.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Not found' });
    // Stamp WHO reported it and WHEN. Without this the figure was anonymous, yet
    // it is averaged into the project's headline progress — a manager confirming
    // that roll-up had no way to tell whose estimate they were signing off.
    const data = { reportedProgress: pct, reportedProgressBy: req.user.sub, reportedProgressAt: new Date() };
    if (existing.status === 'assigned' && pct > 0) data.status = 'in_progress';
    const row = await prisma.checklist.update({ where: { id: req.params.id }, data });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Submit checklist responses
app.post('/api/checklists/:id/submit', auth, requireRole(CAN_FILL_CHECKLISTS), async (req, res) => {
  try {
    const { responses } = req.body; // [{ questionId, value }]
    if (!Array.isArray(responses)) return res.status(400).json({ error: 'responses array required' });

    const checklist = await prisma.checklist.findUnique({ where: { id: req.params.id } });
    if (!checklist) return res.status(404).json({ error: 'Not found' });

    // Upsert each response
    const created = [];
    for (const r of responses) {
      if (!r.questionId) continue;
      const existing = await prisma.checklistResponse.findFirst({
        where: { checklistId: req.params.id, questionId: r.questionId, userId: req.user.sub },
      });
      if (existing) {
        const updated = await prisma.checklistResponse.update({
          where: { id: existing.id },
          data: { value: String(r.value || ''), status: 'submitted' },
        });
        created.push(updated);
      } else {
        const newRow = await prisma.checklistResponse.create({
          data: { value: String(r.value || ''), questionId: r.questionId, checklistId: req.params.id, userId: req.user.sub, status: 'submitted' },
        });
        created.push(newRow);
      }
    }

    // Update checklist status to submitted
    const updatedChecklist = await prisma.checklist.update({
      where: { id: req.params.id },
      data: { status: 'submitted', submittedAt: new Date(), submittedBy: req.user.sub },
    });

    // Tell the person who is waiting for it. A submission previously changed a
    // status and nothing else — whoever created or assigned the checklist had no
    // idea it had come back, so completed work sat unreviewed until someone
    // happened to open the page. Best-effort: an email failure must never fail
    // the submission the field team just made.
    try {
      const submitter = await prisma.user.findUnique({ where: { id: req.user.sub }, select: { name: true } });
      // Everyone with a reason to know: whoever created the checklist, plus the
      // project's PM and site lead. Notifying only the creator meant a checklist
      // raised by one person and managed by another came back to someone who was
      // not watching for it. The submitter is excluded — they know.
      const pmIds = checklist.projectId
        ? (await prisma.assignment.findMany({
            where: { projectId: checklist.projectId, role: { in: ['PM', 'Superintendent'] } },
            select: { userId: true },
          })).map((a) => a.userId)
        : [];
      const watcherIds = [...new Set([checklist.createdBy, ...pmIds].filter(Boolean))]
        .filter((id) => id !== req.user.sub);
      const watchers = watcherIds.length
        ? await prisma.user.findMany({ where: { id: { in: watcherIds } }, select: { email: true } })
        : [];
      const answered = created.filter((r) => String(r.value || '').trim() !== '').length;
      for (const w of watchers) {
        if (!w.email) continue;
        try {
          await sendEmail({
            to: w.email,
            subject: `${submitter?.name || 'Someone'} submitted "${checklist.title}"`,
            html: emailShell(
              'A checklist came back',
              `<p><strong>${submitter?.name || 'Someone'}</strong> submitted <strong>${checklist.title}</strong> with ${answered} answer${answered === 1 ? '' : 's'}. It is waiting for your review.</p>${button(APP_URL, 'Review it')}`
            ),
          });
        } catch (e) { console.error('[CHECKLIST] submit notify failed:', e && e.message); }
      }
    } catch (e) { console.error('[CHECKLIST] submit notify lookup failed:', e && e.message); }

    res.json({ checklist: updatedChecklist, responses: created });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Checklist questions
app.post('/api/checklists/:id/questions', auth, async (req, res) => {
  try {
    const { question, questionType, required, position, options, parentId } = req.body;
    const row = await prisma.checklistQuestion.create({
      data: { question, questionType, required: !!required, position: position ?? 0, options: typeof options === 'string' ? options : JSON.stringify(options || []), parentId: parentId || null, checklistId: req.params.id, ...qExtra(req.body) },
    });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/checklists/:id/questions/:questionId', auth, async (req, res) => {
  try {
    // PATCH semantics: only touch fields the caller actually sent.
    //
    // This used to assign `parentId: parentId || null` unconditionally. The
    // editor does not send parentId, so every edit wrote null and PROMOTED a
    // sub-question to a top-level question — the nesting silently vanished and
    // it looked like the edit had not saved at all. Same hazard for the other
    // columns: an omitted field must stay as it is, not be blanked.
    const { question, questionType, required, position, options, parentId } = req.body;
    const data = {};
    if (question !== undefined) data.question = question;
    if (questionType !== undefined) data.questionType = questionType;
    if (required !== undefined) data.required = !!required;
    if (position !== undefined) data.position = position;
    if (options !== undefined) data.options = typeof options === 'string' ? options : JSON.stringify(options || []);
    if (parentId !== undefined) data.parentId = parentId || null;
    const row = await prisma.checklistQuestion.update({
      where: { id: req.params.questionId },
      data,
    });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/checklists/:id/questions/:questionId', auth, async (req, res) => {
  try {
    await prisma.checklistQuestion.delete({ where: { id: req.params.questionId } });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Checklist responses
app.get('/api/checklists/:id/responses', auth, requireRole(CAN_VIEW_CHECKLISTS), async (req, res) => {
  try {
    const rows = await prisma.checklistResponse.findMany({ where: { checklistId: req.params.id }, orderBy: { createdAt: 'desc' } });
    res.json(rows || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/checklists/:id/responses', auth, requireRole(CAN_FILL_CHECKLISTS), async (req, res) => {
  try {
    const { questionId, value, status } = req.body;
    const row = await prisma.checklistResponse.create({
      data: { value: String(value), questionId, checklistId: req.params.id, userId: req.user.sub, status: status || 'submitted' },
    });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/checklists/:id/responses/:responseId', auth, requireRole(CAN_VIEW_CHECKLISTS), async (req, res) => {
  try {
    const { value, status, reviewNote } = req.body;
    const data = {};
    if (value !== undefined) data.value = String(value);
    if (status !== undefined) data.status = status;
    if (reviewNote !== undefined) data.reviewNote = reviewNote;
    if (status === 'needs_correction') data.reviewerId = req.user.sub;
    const row = await prisma.checklistResponse.update({ where: { id: req.params.responseId }, data });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/checklists/:id/responses/:responseId', auth, requireRole(CAN_FILL_CHECKLISTS), async (req, res) => {
  try {
    await prisma.checklistResponse.delete({ where: { id: req.params.responseId } });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== CHAT / INBOX =====
// currentUserId: a real token carries `sub`; the demo fallback also sets `id`.
// Reading only `id` broke every one of these routes for signed-in users while
// working perfectly in demo mode, which is how it shipped unnoticed.
const currentUserId = (req) => (req.user && (req.user.sub || req.user.id)) || null;

app.get('/api/conversations', auth, async (req, res) => {
  try {
    const userId = currentUserId(req);
    const rows = await prisma.conversation.findMany({
      where: { members: { some: { userId } } },
      include: {
        members: true,
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { updatedAt: 'desc' },
    });
    res.json(rows || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/conversations/:id/messages', auth, async (req, res) => {
  try {
    const rows = await prisma.chatMessage.findMany({
      where: { conversationId: req.params.id },
      orderBy: { createdAt: 'asc' },
    });
    res.json(rows || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/conversations', auth, async (req, res) => {
  try {
    const { name, type, memberIds } = req.body;
    const userId = currentUserId(req);
    if (!userId) return res.status(401).json({ error: 'Not signed in' });
    // Groups only, for now. One-to-one messaging is deliberately off: a decision
    // taken in a private thread leaves no record for the people it affects.
    // Enforced HERE and not only in the UI — hiding a button is a suggestion,
    // not a rule, and the endpoint is callable directly.
    if (type && type !== 'group') {
      return res.status(400).json({ error: 'Direct messages are turned off. Create a group so the conversation stays with the team.' });
    }
    if (!String(name || '').trim()) return res.status(400).json({ error: 'A group needs a name' });
    const row = await prisma.conversation.create({
      data: {
        name: name || undefined,
        type: 'group',
        creatorId: userId,
        members: {
          create: [
            { userId, role: 'admin' },
            ...(memberIds || []).filter((id) => id !== userId).map((id) => ({ userId: id, role: 'member' })),
          ],
        },
      },
      include: { members: true },
    });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/conversations/:id/messages', auth, async (req, res) => {
  try {
    const { text, attachment, replyToId, taskId, taskTitle } = req.body;
    const userId = currentUserId(req);
    if (!userId) return res.status(401).json({ error: 'Not signed in' });
    const row = await prisma.chatMessage.create({
      data: {
        text: text || '',
        attachment: attachment || undefined,
        replyToId: replyToId || undefined,
        taskId: taskId || undefined,
        taskTitle: taskTitle || undefined,
        userId,
        conversationId: req.params.id,
      },
    });
    await prisma.conversation.update({ where: { id: req.params.id }, data: { updatedAt: new Date() } });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/conversations/:id', auth, async (req, res) => {
  try {
    await prisma.conversation.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/conversations/:id/name', auth, async (req, res) => {
  try {
    const { name } = req.body;
    const row = await prisma.conversation.update({ where: { id: req.params.id }, data: { name } });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/conversations/:id/members', auth, async (req, res) => {
  try {
    const { userId: memberId } = req.body;
    const row = await prisma.conversationMember.create({
      data: { conversationId: req.params.id, userId: memberId, role: 'member' },
    });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/conversations/:id/members/:memberId', auth, async (req, res) => {
  try {
    await prisma.conversationMember.deleteMany({
      where: { conversationId: req.params.id, userId: req.params.memberId },
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/conversations/:id/read', auth, async (req, res) => {
  try {
    await prisma.chatMessage.updateMany({
      where: { conversationId: req.params.id, userId: { not: currentUserId(req) }, read: false },
      data: { read: true },
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== WEBSOCKET =====
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const clients = new Map(); // userId -> ws

function broadcastToConversation(conversationId, payload, excludeUserId) {
  const data = JSON.stringify(payload);
  for (const [userId, ws] of clients) {
    if (excludeUserId && userId === excludeUserId) continue;
    if (ws.readyState === 1) ws.send(data);
  }
}

wss.on('connection', (ws, req) => {
  let userId = null;

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'auth') {
        userId = msg.userId;
        clients.set(userId, ws);
        ws.send(JSON.stringify({ type: 'connected', userId }));
        return;
      }
      if (!userId) return;

      if (msg.type === 'message') {
        const { conversationId, text, attachment, replyToId, taskId, taskTitle } = msg;
        const row = await prisma.chatMessage.create({
          data: { text: text || '', attachment: attachment || undefined, replyToId: replyToId || undefined, taskId: taskId || undefined, taskTitle: taskTitle || undefined, userId, conversationId },
        });
        await prisma.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
        broadcastToConversation(conversationId, { type: 'message', data: row });
      }

      if (msg.type === 'typing') {
        broadcastToConversation(msg.conversationId, { type: 'typing', userId, conversationId: msg.conversationId }, userId);
      }
    } catch (e) {
      ws.send(JSON.stringify({ type: 'error', message: e.message }));
    }
  });

  ws.on('close', () => {
    if (userId) clients.delete(userId);
  });
});

// ===== PLAN MARKUPS =====
app.get('/api/projects/:projectId/markups', auth, async (req, res) => {
  try {
    const rows = await prisma.planMarkup.findMany({ where: { projectId: req.params.projectId }, orderBy: { createdAt: 'desc' } });
    res.json(rows || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/projects/:projectId/markups', auth, async (req, res) => {
  try {
    const { drawingId, type, x, y, w, h, text, color } = req.body;
    if (!drawingId) return res.status(400).json({ error: 'Which drawing is this markup on?' });
    const row = await prisma.planMarkup.create({ data: {
      drawingId, type: type || 'pin', x: Number(x) || 0, y: Number(y) || 0,
      w: w == null ? null : Number(w), h: h == null ? null : Number(h), text: text || null, color: color || '#FF6B1A',
      createdBy: req.user?.name || 'Team member', projectId: req.params.projectId,
    } });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/projects/:projectId/markups/:id', auth, async (req, res) => {
  try {
    const { x, y, w, h, text, color, type, status } = req.body;
    const data = {};
    if (w !== undefined) data.w = w == null ? null : Number(w);
    if (h !== undefined) data.h = h == null ? null : Number(h);
    if (status !== undefined) data.status = status === 'resolved' ? 'resolved' : 'open';
    if (x !== undefined) data.x = x;
    if (y !== undefined) data.y = y;
    if (text !== undefined) data.text = text;
    if (color !== undefined) data.color = color;
    if (type !== undefined) data.type = type;
    const row = await prisma.planMarkup.update({ where: { id: req.params.id }, data });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/projects/:projectId/markups/:id', auth, async (req, res) => {
  try {
    await prisma.planMarkup.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Everything the drawing viewer needs in one call: the sheet, every revision of
// it (each upload of the same sheet number is its own Drawing row), and the
// team's markups on those revisions. Replaces an in-browser mock that invented
// revisions and kept markups in one browser's local storage.
app.get('/api/drawings/:id/viewer', auth, async (req, res) => {
  try {
    const d = await prisma.drawing.findUnique({ where: { id: req.params.id } });
    if (!d) return res.status(404).json({ error: 'This drawing no longer exists.' });
    const [revisions, project] = await Promise.all([
      prisma.drawing.findMany({ where: { projectId: d.projectId, number: d.number }, orderBy: [{ rev: 'desc' }, { createdAt: 'desc' }] }),
      prisma.project.findUnique({ where: { id: d.projectId }, select: { name: true } }),
    ]);
    const markups = await prisma.planMarkup.findMany({ where: { drawingId: { in: revisions.map((r) => r.id) } }, orderBy: { createdAt: 'asc' } });
    res.json({ drawing: d, projectName: project ? project.name : '', revisions, markups });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== DRAWING VERSIONS =====
app.get('/api/projects/:projectId/drawing-versions', auth, async (req, res) => {
  try {
    const rows = await prisma.drawingVersion.findMany({ where: { projectId: req.params.projectId }, orderBy: { createdAt: 'desc' } });
    res.json(rows || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/projects/:projectId/drawing-versions', auth, async (req, res) => {
  try {
    const { drawingId, rev, url, uploadedBy } = req.body;
    const row = await prisma.drawingVersion.create({ data: { drawingId, rev, url, uploadedBy, projectId: req.params.projectId } });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== DRAWINGS (uploaded sheets) =====
// Sheets used to exist only in the browser's memory: an upload pushed a row into
// React state and was gone on the next refresh, so the register always read zero.
app.get('/api/drawings', auth, async (req, res) => {
  try {
    const where = req.query.projectId ? { projectId: String(req.query.projectId) } : {};
    const rows = await prisma.drawing.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { project: { select: { id: true, name: true } } },
    });
    res.json(rows || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/projects/:projectId/drawings', auth, async (req, res) => {
  try {
    const { number, title, discipline, fileUrl, fileName, fileSize, rev, status } = req.body || {};
    if (!fileUrl) return res.status(400).json({ error: 'fileUrl is required' });
    if (!title && !number) return res.status(400).json({ error: 'number or title is required' });
    const project = await prisma.project.findUnique({ where: { id: req.params.projectId } });
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const row = await prisma.drawing.create({
      data: {
        number: String(number || title).slice(0, 120),
        title: String(title || number).slice(0, 300),
        discipline: discipline || 'Architectural',
        rev: Number.isFinite(Number(rev)) ? Number(rev) : 1,
        status: status || 'Draft',
        fileUrl,
        fileName: fileName || null,
        fileSize: Number.isFinite(Number(fileSize)) ? Number(fileSize) : null,
        uploadedBy: req.user && req.user.email ? req.user.email : null,
        projectId: project.id,
      },
      include: { project: { select: { id: true, name: true } } },
    });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/drawings/:id', auth, async (req, res) => {
  try {
    const { title, discipline, status, rev } = req.body || {};
    const data = {};
    if (title != null) data.title = String(title);
    if (discipline != null) data.discipline = String(discipline);
    if (status != null) data.status = String(status);
    if (rev != null && Number.isFinite(Number(rev))) data.rev = Number(rev);
    const row = await prisma.drawing.update({ where: { id: req.params.id }, data, include: { project: { select: { id: true, name: true } } } });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/drawings/:id', auth, async (req, res) => {
  try {
    await prisma.drawing.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== SCHEDULED REPORTS =====
app.get('/api/scheduled-reports', auth, async (_req, res) => {
  try {
    const rows = await prisma.scheduledReport.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(rows || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/scheduled-reports', auth, async (req, res) => {
  try {
    const { name, reportType, frequency, recipients, projectId } = req.body;
    const nextRunAt = new Date();
    if (frequency === 'daily') nextRunAt.setDate(nextRunAt.getDate() + 1);
    if (frequency === 'weekly') nextRunAt.setDate(nextRunAt.getDate() + 7);
    if (frequency === 'monthly') nextRunAt.setMonth(nextRunAt.getMonth() + 1);
    const row = await prisma.scheduledReport.create({ data: { name, reportType, frequency, recipients, projectId: projectId || null, nextRunAt } });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/scheduled-reports/:id', auth, async (req, res) => {
  try {
    const { name, reportType, frequency, recipients, active, projectId } = req.body;
    const data = { name, reportType, frequency, recipients, active, projectId: projectId || null };
    const row = await prisma.scheduledReport.update({ where: { id: req.params.id }, data });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/scheduled-reports/:id', auth, async (req, res) => {
  try {
    await prisma.scheduledReport.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== FORM TEMPLATES =====
app.get('/api/form-templates', auth, async (_req, res) => {
  try {
    const rows = await prisma.formTemplate.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(rows || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/form-templates', auth, async (req, res) => {
  try {
    const { name, description, category, source, fields, projectId } = req.body;
    const row = await prisma.formTemplate.create({ data: { name, description, category, source, fields: typeof fields === 'string' ? fields : JSON.stringify(fields), projectId: projectId || null } });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/form-templates/:id', auth, async (req, res) => {
  try {
    // PATCH semantics, same reasoning as the checklist-question route: this used
    // to write every column unconditionally, so a partial update (renaming a
    // template, say) blanked its description, category and — worst of all — its
    // `fields`, destroying the form's questions.
    const { name, description, category, source, fields, projectId } = req.body;
    const data = {};
    if (name !== undefined) data.name = name;
    if (description !== undefined) data.description = description;
    if (category !== undefined) data.category = category;
    if (source !== undefined) data.source = source;
    if (fields !== undefined) data.fields = typeof fields === 'string' ? fields : JSON.stringify(fields);
    if (projectId !== undefined) data.projectId = projectId || null;
    const row = await prisma.formTemplate.update({ where: { id: req.params.id }, data });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/form-templates/:id', auth, async (req, res) => {
  try {
    await prisma.formTemplate.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== TASK-LINKED MESSAGES =====
app.get('/api/projects/:projectId/messages', auth, async (req, res) => {
  try {
    const rows = await prisma.message.findMany({ where: { projectId: req.params.projectId }, include: { user: { select: { name: true, role: true } } }, orderBy: { createdAt: 'desc' }, take: 200 });
    res.json(rows || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/projects/:projectId/messages', auth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const { text, attachment, taskType, taskId } = req.body;
    const row = await prisma.message.create({ data: { text, attachment, taskType, taskId, projectId: req.params.projectId, userId } });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== SASA CREDITS (AI usage) =====
// Every company gets a monthly allowance of Sasa Credits with its plan (the
// package's aiCredits; a trial amount before subscribing) and can buy top-up
// packs that never expire. AI actions cost credits; plan credits are spent
// first. Support chats (Suzy, Shemmy) are free. Prices, pack sizes and the
// trial amount are edited in the admin panel and stored in SiteContent.
const CREDIT_DEFAULTS = {
  costs: { assistant: 1, checklist: 5, extract: 5, design: 20, design_photos: 30 },
  packs: [
    { id: 'starter', name: 'Starter pack', credits: 100, kes: 500 },
    { id: 'builder', name: 'Builder pack', credits: 300, kes: 1350 },
    { id: 'pro', name: 'Pro pack', credits: 1000, kes: 4000 },
  ],
  trialCredits: 50,   // a month's allowance before the company subscribes
  compCredits: 500,   // comped (free-access) companies
};
const CREDIT_ACTION_LABEL = { assistant: 'Buildsasa AI question', checklist: 'AI checklist', extract: 'AI document reading', design: 'AI design', design_photos: 'AI design from photos' };
let creditSettingsCache = null;
async function creditSettings() {
  if (creditSettingsCache && Date.now() - creditSettingsCache.at < 60000) return creditSettingsCache.value;
  let value = CREDIT_DEFAULTS;
  try {
    const row = await prismaBase.siteContent.findUnique({ where: { key: 'ai_credits' } });
    if (row) {
      const v = JSON.parse(row.value);
      value = { ...CREDIT_DEFAULTS, ...v, costs: { ...CREDIT_DEFAULTS.costs, ...(v.costs || {}) }, packs: Array.isArray(v.packs) && v.packs.length ? v.packs : CREDIT_DEFAULTS.packs };
    }
  } catch (e) { console.error('[credits] settings load failed:', e.message); }
  creditSettingsCache = { at: Date.now(), value };
  return value;
}
const forgetCreditSettings = () => { creditSettingsCache = null; };

class CreditError extends Error { constructor(msg, needed, balance) { super(msg); this.status = 402; this.needed = needed; this.balance = balance; } }

/** The monthly allowance this company is entitled to right now. */
async function monthlyAllowance(ws, ownerEmail) {
  const s = await creditSettings();
  if (ownerEmail && (hasFreeAccess(ownerEmail) || isPlatformAdmin(ownerEmail))) return s.compCredits;
  const sub = await prismaBase.subscription.findFirst({ where: { workspaceId: ws, status: 'active' }, orderBy: { createdAt: 'desc' } });
  if (!sub) return s.trialCredits;
  const plan = await planById(sub.plan);
  return plan && plan.aiCredits != null ? plan.aiCredits : 200;
}

/** Load the company's credits, refilling the monthly bucket when the period has rolled over. */
async function ensureCredits(ws, ownerEmail) {
  let w = await prismaBase.workspace.findUnique({ where: { id: ws } });
  if (!w) return null;
  if (!w.aiCreditsResetAt || w.aiCreditsResetAt < new Date()) {
    const allowance = await monthlyAllowance(ws, ownerEmail);
    const resetAt = new Date(Date.now() + 30 * 864e5);
    const firstTime = !w.aiCreditsResetAt;
    w = await prismaBase.workspace.update({ where: { id: ws }, data: { aiPlanCredits: allowance, aiCreditsResetAt: resetAt } });
    await prismaBase.aiCreditTxn.create({ data: { workspaceId: ws, delta: allowance, bucket: 'plan', kind: 'monthly', note: firstTime ? 'Your first month of Sasa Credits' : 'Monthly Sasa Credits renewed (unused plan credits from last month expired)' } });
  }
  return w;
}

async function creditCost(action) { const s = await creditSettings(); return Math.max(0, Number(s.costs[action]) || 0); }

/** Refuse (402) when the company can't afford the action. Call before doing the work. */
async function requireCredits(req, action) {
  const ws = currentWs();
  if (!ws) return 0;
  const cost = await creditCost(action);
  if (!cost) return 0;
  const w = await ensureCredits(ws, req.user?.email);
  const balance = (w?.aiPlanCredits || 0) + (w?.aiTopupCredits || 0);
  if (balance < cost) {
    throw new CreditError(`You need ${cost} Sasa Credits for this, and your company has ${balance} left. Buy more credits under Billing → Sasa Credits${balance === 0 ? '' : ', or wait for your monthly credits to renew'}.`, cost, balance);
  }
  return cost;
}

/** Spend credits after the action succeeded (plan credits first, then top-ups). */
async function chargeCredits(req, action, note) {
  const ws = currentWs();
  if (!ws) return null;
  const cost = await creditCost(action);
  if (!cost) return null;
  const w = await ensureCredits(ws, req.user?.email);
  if (!w) return null;
  const fromPlan = Math.min(cost, w.aiPlanCredits);
  const fromTopup = Math.min(cost - fromPlan, w.aiTopupCredits);
  const updated = await prismaBase.workspace.update({ where: { id: ws }, data: { aiPlanCredits: { decrement: fromPlan }, aiTopupCredits: { decrement: fromTopup } } });
  const base = { workspaceId: ws, kind: 'usage', action, note: note ? String(note).slice(0, 200) : CREDIT_ACTION_LABEL[action], userId: req.user?.sub || null, userName: req.user?.name || null };
  if (fromPlan) await prismaBase.aiCreditTxn.create({ data: { ...base, delta: -fromPlan, bucket: 'plan' } });
  if (fromTopup) await prismaBase.aiCreditTxn.create({ data: { ...base, delta: -fromTopup, bucket: 'topup' } });
  return { spent: fromPlan + fromTopup, balance: updated.aiPlanCredits + updated.aiTopupCredits };
}

/** Express helper: answer a CreditError as a 402 the app can act on. */
function sendCreditError(res, e) {
  return res.status(402).json({ error: e.message, code: 'NO_CREDITS', needed: e.needed, balance: e.balance });
}

app.get('/api/ai-credits', auth, async (req, res) => {
  try {
    const ws = currentWs();
    const s = await creditSettings();
    if (!ws) return res.json({ balance: 0, plan: 0, topup: 0, costs: s.costs, packs: s.packs, history: [], payments: !!PAYSTACK_SECRET });
    const w = await ensureCredits(ws, req.user?.email);
    const allowance = await monthlyAllowance(ws, req.user?.email);
    const history = await prismaBase.aiCreditTxn.findMany({ where: { workspaceId: ws }, orderBy: { createdAt: 'desc' }, take: 40 });
    res.json({
      balance: w.aiPlanCredits + w.aiTopupCredits, plan: w.aiPlanCredits, topup: w.aiTopupCredits, allowance,
      resetsAt: w.aiCreditsResetAt, costs: s.costs, labels: CREDIT_ACTION_LABEL, packs: s.packs, history, payments: !!PAYSTACK_SECRET,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Buy a top-up pack through Paystack (M-Pesa or card).
app.post('/api/ai-credits/checkout', auth, async (req, res) => {
  try {
    const ws = currentWs();
    if (!ws) return res.status(400).json({ error: 'Your account isn\'t linked to a company.' });
    const s = await creditSettings();
    const pack = s.packs.find((p) => p.id === req.body?.packId);
    if (!pack) return res.status(400).json({ error: 'Choose a credit pack.' });
    if (!PAYSTACK_SECRET) return res.status(400).json({ error: 'Online payments aren\'t set up yet. Contact Buildsasa support to buy credits.' });
    const init = await paystackRequest('/transaction/initialize', 'POST', {
      email: req.user.email || 'owner@buildsasa.com', amount: Math.round(Number(pack.kes) * 100), currency: 'KES',
      callback_url: `${process.env.APP_URL || 'http://localhost:5173'}?credits=1`,
      metadata: { kind: 'ai_credits', workspaceId: ws, packId: pack.id, credits: pack.credits, userId: req.user.sub },
    });
    if (!init.status) return res.status(502).json({ error: init.message || 'The payment couldn\'t be started. Please try again.' });
    res.json({ authorizationUrl: init.data.authorization_url, reference: init.data.reference });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/** Credit a paid top-up exactly once (verify and webhook can both arrive). */
async function applyCreditPurchase(data) {
  const md = data.metadata || {};
  if (md.kind !== 'ai_credits' || !md.workspaceId || !data.reference) return null;
  const credits = Math.max(0, parseInt(md.credits, 10) || 0);
  if (!credits) return null;
  try {
    await prismaBase.aiCreditTxn.create({ data: { workspaceId: md.workspaceId, delta: credits, bucket: 'topup', kind: 'topup', note: `Bought ${credits} credits (KES ${Math.round((data.amount || 0) / 100).toLocaleString('en-KE')})`, userId: md.userId || null, paystackRef: data.reference } });
  } catch (e) {
    if (e.code === 'P2002') return { already: true }; // this payment was already credited
    throw e;
  }
  await prismaBase.workspace.update({ where: { id: md.workspaceId }, data: { aiTopupCredits: { increment: credits } } });
  return { credited: credits };
}

app.post('/api/ai-credits/verify', auth, async (req, res) => {
  try {
    if (!PAYSTACK_SECRET) return res.status(400).json({ error: 'Payments aren\'t configured.' });
    const ref = String(req.body?.reference || '');
    const v = await paystackRequest(`/transaction/verify/${encodeURIComponent(ref)}`, 'GET');
    if (!(v.status && v.data && v.data.status === 'success')) return res.json({ ok: false, status: v.data?.status || 'failed' });
    if (v.data.metadata?.workspaceId !== currentWs()) return res.status(403).json({ error: 'This payment belongs to another company.' });
    const r = await applyCreditPurchase(v.data);
    res.json({ ok: true, ...r });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- Admin (platform staff) ----
const creditAdmin = (req, res, next) => (isPlatformAdmin(req.user && req.user.email) ? next() : res.status(403).json({ error: 'Only Buildsasa staff can manage Sasa Credits.' }));

app.get('/api/admin/ai-credits/settings', auth, creditAdmin, async (_req, res) => {
  try { forgetCreditSettings(); res.json({ ...(await creditSettings()), labels: CREDIT_ACTION_LABEL }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/ai-credits/settings', auth, creditAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    const cur = await creditSettings();
    const costs = { ...cur.costs };
    for (const k of Object.keys(CREDIT_DEFAULTS.costs)) if (b.costs && b.costs[k] !== undefined) costs[k] = Math.max(0, Math.min(1000, parseInt(b.costs[k], 10) || 0));
    let packs = cur.packs;
    if (Array.isArray(b.packs)) {
      packs = b.packs.map((p, i) => ({
        id: String(p.id || p.name || `pack-${i}`).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) || `pack-${i}`,
        name: String(p.name || 'Credit pack').slice(0, 60),
        credits: Math.max(1, parseInt(p.credits, 10) || 0),
        kes: Math.max(1, parseInt(p.kes, 10) || 0),
      })).filter((p) => p.credits > 0 && p.kes > 0).slice(0, 6);
      if (!packs.length) return res.status(400).json({ error: 'Keep at least one credit pack.' });
      if (new Set(packs.map((p) => p.id)).size !== packs.length) return res.status(400).json({ error: 'Each pack needs a different name.' });
    }
    const value = {
      costs, packs,
      trialCredits: b.trialCredits !== undefined ? Math.max(0, parseInt(b.trialCredits, 10) || 0) : cur.trialCredits,
      compCredits: b.compCredits !== undefined ? Math.max(0, parseInt(b.compCredits, 10) || 0) : cur.compCredits,
    };
    await prismaBase.siteContent.upsert({ where: { key: 'ai_credits' }, create: { key: 'ai_credits', value: JSON.stringify(value), updatedBy: req.user?.email || null }, update: { value: JSON.stringify(value), updatedBy: req.user?.email || null } });
    forgetCreditSettings();
    res.json({ ...value, labels: CREDIT_ACTION_LABEL });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Every company's balance and this month's usage, heaviest users first.
app.get('/api/admin/ai-credits/usage', auth, creditAdmin, async (_req, res) => {
  try {
    const since = new Date(Date.now() - 30 * 864e5);
    const [workspaces, usage, bought] = await Promise.all([
      prismaBase.workspace.findMany({ select: { id: true, name: true, aiPlanCredits: true, aiTopupCredits: true, aiCreditsResetAt: true, createdAt: true } }),
      prismaBase.aiCreditTxn.groupBy({ by: ['workspaceId'], where: { kind: 'usage', createdAt: { gte: since } }, _sum: { delta: true } }),
      prismaBase.aiCreditTxn.groupBy({ by: ['workspaceId'], where: { kind: 'topup', createdAt: { gte: since } }, _sum: { delta: true } }),
    ]);
    const used = Object.fromEntries(usage.map((u) => [u.workspaceId, -(u._sum.delta || 0)]));
    const paid = Object.fromEntries(bought.map((u) => [u.workspaceId, u._sum.delta || 0]));
    const rows = workspaces.map((w) => ({
      id: w.id, name: w.name, balance: w.aiPlanCredits + w.aiTopupCredits, plan: w.aiPlanCredits, topup: w.aiTopupCredits,
      resetsAt: w.aiCreditsResetAt, used30d: used[w.id] || 0, bought30d: paid[w.id] || 0,
    })).sort((a, b) => b.used30d - a.used30d || a.name.localeCompare(b.name));
    const totals = { used30d: rows.reduce((s, r) => s + r.used30d, 0), bought30d: rows.reduce((s, r) => s + r.bought30d, 0), companies: rows.length, outOfCredits: rows.filter((r) => r.resetsAt && r.balance === 0).length };
    res.json({ rows, totals });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/ai-credits/:workspaceId/history', auth, creditAdmin, async (req, res) => {
  try { res.json(await prismaBase.aiCreditTxn.findMany({ where: { workspaceId: req.params.workspaceId }, orderBy: { createdAt: 'desc' }, take: 100 })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Give (or take back) credits — trials, goodwill, refunds, offline payments.
app.post('/api/admin/ai-credits/:workspaceId/grant', auth, creditAdmin, async (req, res) => {
  try {
    const credits = parseInt(req.body?.credits, 10) || 0;
    if (!credits || Math.abs(credits) > 100000) return res.status(400).json({ error: 'Enter how many credits to add (or a negative number to remove).' });
    const w = await prismaBase.workspace.findUnique({ where: { id: req.params.workspaceId } });
    if (!w) return res.status(404).json({ error: 'Company not found' });
    const delta = credits < 0 ? -Math.min(-credits, w.aiTopupCredits) : credits;
    if (!delta) return res.status(400).json({ error: 'This company has no top-up credits to remove.' });
    const updated = await prismaBase.workspace.update({ where: { id: w.id }, data: { aiTopupCredits: { increment: delta } } });
    await prismaBase.aiCreditTxn.create({ data: { workspaceId: w.id, delta, bucket: 'topup', kind: 'grant', note: String(req.body?.note || (delta > 0 ? 'Credits added by Buildsasa' : 'Credits removed by Buildsasa')).slice(0, 200), userName: 'Buildsasa team' } });
    res.json({ balance: updated.aiPlanCredits + updated.aiTopupCredits, topup: updated.aiTopupCredits });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/** Route guard: refuse when the company can't afford the action; charge only
 *  when the handler answers successfully, so a failed AI call costs nothing. */
const withCredits = (action) => async (req, res, next) => {
  const act = typeof action === 'function' ? action(req) : action;
  try { await requireCredits(req, act); }
  catch (e) { if (e instanceof CreditError) return sendCreditError(res, e); return res.status(500).json({ error: e.message }); }
  const json = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode < 400) chargeCredits(req, act).catch((err) => console.error('[credits] charge failed:', err.message));
    return json(body);
  };
  next();
};


// ===== DEEPSEEK AI =====
const https = require('https');
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

function deepSeekRequest(messages, { temperature = 0.7, max_tokens = 2048 } = {}) {
  return new Promise((resolve, reject) => {
    if (!DEEPSEEK_API_KEY) return reject(new Error('DEEPSEEK_API_KEY not configured'));
    const payload = JSON.stringify({ model: DEEPSEEK_MODEL, messages, temperature, max_tokens });
    const req = https.request({ hostname: 'api.deepseek.com', path: '/v1/chat/completions', method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DEEPSEEK_API_KEY}`, 'Content-Length': Buffer.byteLength(payload) } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          if (j.error) return reject(new Error(`DeepSeek: ${j.error.message || j.error}`));
          if (res.statusCode && res.statusCode >= 400) return reject(new Error(`DeepSeek HTTP ${res.statusCode}`));
          resolve(j.choices?.[0]?.message?.content || '');
        } catch (e) {
          reject(new Error(`DeepSeek returned an unreadable response (HTTP ${res.statusCode || '?'})`));
        }
      });
    });
    // Fail fast instead of hanging on a slow/large generation.
    req.setTimeout(90000, () => req.destroy(new Error('DeepSeek request timed out after 90s')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// Unified chat helper: prefer OpenAI (GPT-4o) when configured, else DeepSeek.
// Previously these endpoints called DeepSeek directly, so with only OPENAI_API_KEY
// set every AI request failed and the UI fell back to canned answers.
async function callAi(messages, { temperature = 0.5, max_tokens = 2048 } = {}) {
  if (typeof openai !== 'undefined' && openai) {
    try {
      const completion = await openai.chat.completions.create({ model: 'gpt-4o', messages, temperature, max_tokens });
      return completion.choices?.[0]?.message?.content || '';
    } catch (err) {
      // Surface the real reason in the server console (invalid key, quota, model access, etc.)
      console.error('[AI] OpenAI call failed:', err.status || '', err.message || err);
      // Fall back to DeepSeek only if it's configured; otherwise rethrow so the route reports it.
      if (DEEPSEEK_API_KEY) return await deepSeekRequest(messages);
      throw err;
    }
  }
  if (DEEPSEEK_API_KEY) return await deepSeekRequest(messages);
  throw new Error('No AI provider configured (set OPENAI_API_KEY or DEEPSEEK_API_KEY)');
}

// Form/checklist generation prefers DeepSeek (cost-effective for structured JSON),
// falling back to OpenAI if DeepSeek isn't set or errors. Everything else uses callAi (OpenAI-first).
async function callAiDeepSeekFirst(messages, { temperature = 0.3, max_tokens = 4096 } = {}) {
  if (DEEPSEEK_API_KEY) {
    try { return await deepSeekRequest(messages, { temperature, max_tokens }); }
    catch (err) { console.error('[AI] DeepSeek call failed, falling back to OpenAI:', err.message || err); }
  }
  return await callAi(messages, { temperature, max_tokens });
}

app.post('/api/ai/chat', async (req, res) => {
  try {
    const { question } = req.body;
    if (!question) return res.status(400).json({ error: 'question required' });
    const answer = await callAi([{ role: 'system', content: 'You are Buildsasa AI, a construction management assistant. Be concise, practical, and actionable. Use bullet points for steps.' }, { role: 'user', content: question }], { temperature: 0.7 });
    res.json({ answer });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Shemmy — public customer-support chatbot. Mirrors /api/ai/chat (no auth) but
// keeps a short rolling conversation so follow-up questions have context.
const SUPPORT_WHATSAPP = process.env.SUPPORT_WHATSAPP || '+254782223749';
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'hello@buildsasa.com';
const SHEMMY_SYSTEM_PROMPT = `You are Shemmy, the friendly customer-support assistant for Buildsasa — a construction project-management software built for contractors, project managers and site teams in Kenya and East Africa (currency KES, payments via Paystack/M-Pesa). Help users understand and use the product, troubleshoot, and answer billing/account questions. Be warm, concise, and practical; use simple language; sentence case. Buildsasa's features include: Dashboard with AI insights; Projects; Change Orders with an approval pipeline; Checklists & digitized forms (with an Assignments by trade tab); Schedule (Gantt, dates, milestones); Daily Log (photos, short videos, weather filled from the forecast, location by GPS or map); Punch List; Plans & Drawings; Inspections; Safety Incidents; Observations (each with corrective actions); Coordination Issues; Financials (cash flow ledger, budget vs actual, commitments/payables, payment applications/progress claims with retention, cost codes); Client portal (share a private link per project so the client, with no account, can follow progress, the timeline, site photos and invoices, approve or reject change orders, and approve finish selections); Finish selections (tiles, paint, fittings and fixtures chosen room by room with photos, approved by the client in the portal, then tracked as ordered and installed); Quotes (price a job from templates like kitchen or bathroom remodels, send a link the client accepts or declines online, download a PDF, then turn an accepted quote into a project with its BOQ and a deposit invoice); Invoicing (line-item invoices with PDF download + emailed receipts); Jobs Board (work opportunities posted by Buildsasa that subscribed companies can bid on from the console); Bidding/Tendering (post bid packages, share a public bid link, receive and award bids); Inventory (materials with a stock-movement ledger plus an equipment register with hire/service/compliance tracking); Documents; Directory; Crews; Team & Role Manager; Attendance; Reports; and a Buildsasa AI assistant. Client accounts: property owners, landowners and investors (including Kenyans abroad) sign up free as a client at https://console.buildsasa.com by choosing "I'm a client". A contractor invites them to a project by email from the project's Client tab; the client then sees progress updates tagged by stage (land purchase, survey and beaconing, land clearing, fencing, gate, borehole and water, foundation, walling, roofing, plumbing and electrical, finishes, solar, CCTV and security, landscaping and gardening, garbage and clean-up, handover) with photos and short videos, shared daily logs (photos, weather and headcount), shared inspections, change orders, finish selections and invoices, and chats with the contractor in a team chat or a private chat with one team member, sending single or bulk photos and short videos. Contractors can also share their own weekly or monthly site reports, drawings and proposals as documents. Clients can comment on anything shared with them (updates, daily logs, inspections, change orders, finish selections) to ask for a change or improvement, attaching photos, and see quotes sent to their email under Quotes & proposals, where they can ask questions before accepting. A contractor invites a client by email or by sending the invite link on WhatsApp; the client signs up free with that email and the project appears. Clients can browse companies with an active Buildsasa subscription, rate companies they have worked with, post a job (fencing, borehole drilling, solar, CCTV, gates, landscaping, garbage collection, land clearing, a house and more) to all contractors or one chosen company, which Buildsasa approves before contractors see it, and award a bid on their own job to a company with an active subscription. Buildsasa neutral site reporting: a client who wants independent, unbiased reports can request it in their client account (or read https://buildsasa.com/site-reporting); Buildsasa staff visit the site anywhere in Kenya and post honest photo and video reports of every stage. It costs 10% of the total project cost, spread over the months of reporting and paid monthly, plus the reporter's transport and lunch on each visit day; the client agrees to this fee when requesting, then the Buildsasa team calls them and arranges payment directly (M-Pesa, bank or international transfer). Nothing is paid inside the app. Clients who do not want it can simply follow their site through their contractor's Buildsasa subscription at no cost to them. Billing is per company (workspace): every new company gets a 14-day free trial with full access and no card needed, then chooses a plan to continue; plans can include a number of team members with a price per extra member, and clients never count; plans are paid in KES via Paystack. When a question needs account-specific action you can't do (refunds, data changes, bugs), tell them to contact our team on WhatsApp at ${SUPPORT_WHATSAPP} or by email at ${SUPPORT_EMAIL}, or use the in-app billing page. Never invent features that aren't listed; if unsure, say so and offer to connect them to the team. Keep answers short unless asked for detail.`;

app.post('/api/support/chat', async (req, res) => {
  try {
    const incoming = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const recent = incoming
      .filter((m) => m && m.content && (m.role === 'user' || m.role === 'assistant'))
      .slice(-10)
      .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content).slice(0, 2000) }));
    const messages = [{ role: 'system', content: SHEMMY_SYSTEM_PROMPT }, ...recent];
    const reply = await callAi(messages, { temperature: 0.4, max_tokens: 700 });
    res.json({ reply });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Suzy — the buildsasa.com website assistant. Unlike Shemmy (signed-in users), her
// audience is mostly prospects, so she also answers sales questions and steers
// people to a demo, pricing or sign-up. Public, so it is rate limited per IP.
const SUZY_SYSTEM_PROMPT = `You are Suzy, the friendly assistant on the Buildsasa website (buildsasa.com). Buildsasa Technologies is a Kenyan tech company that builds ERP systems, custom software and ICT solutions; its main product, Buildsasa, is construction project-management software for contractors, project managers, quantity surveyors, architects, developers and county/government project teams in Kenya and East Africa (currency KES, payments via Paystack/M-Pesa). It can run in Buildsasa's cloud or be installed on the client's own servers. Visitors are mostly people evaluating the product, plus some existing customers needing help. Answer questions about what Buildsasa does, who it is for, how it helps, and how to get started; help existing users with how-to questions. Buildsasa's features include: Dashboard; Projects; Daily Log (work done, deliveries, delays, photos and short videos, weather filled from the forecast, location by GPS or map); Site weather forecast on the dashboard; Attendance (present/late/absent); Checklists & digitized forms, shareable by public link, with an Assignments by trade tab; Inspections; Safety Incidents; Observations (each with corrective actions); Punch List with PDF export; Schedule (Gantt, milestones); Plans & Drawings with revisions; Change Orders with an approval pipeline; Bill of quantities with a rate library; Jobs Board (work opportunities posted by Buildsasa that subscribed companies can bid on); Bidding/Tendering with a public bid link; Commitments (subcontracts and orders) with a claim calculator that deducts retention and recovers advances; Financials (budget vs actual, cost codes, payment applications with retention, cash flow); Client portal (share a private link per project so the client, with no account, can follow progress, the timeline, site photos and invoices, approve or reject change orders, and approve finish selections); Finish selections (tiles, paint, fittings and fixtures chosen room by room with photos, approved by the client in the portal, then tracked as ordered and installed); Quotes (price a job from templates such as kitchen, bathroom, tiling, painting or electrical works, send the client a link to accept online, and turn an accepted quote into a project with a deposit invoice); Invoicing with PDF; Inventory (materials stock ledger) and an equipment register; Documents; Correspondence; Coordination Issues; Directory; Subcontractors; Crews; Team & Role Manager (control who sees what); Reports with Excel export; and Buildsasa AI. Client accounts: property owners, landowners and investors (including Kenyans abroad) sign up free as a client at https://console.buildsasa.com by choosing "I'm a client". A contractor invites them to a project by email from the project's Client tab; the client then sees progress updates tagged by stage (land purchase, survey and beaconing, land clearing, fencing, gate, borehole and water, foundation, walling, roofing, plumbing and electrical, finishes, solar, CCTV and security, landscaping and gardening, garbage and clean-up, handover) with photos and short videos, shared daily logs (photos, weather and headcount), shared inspections, change orders, finish selections and invoices, and chats with the contractor in a team chat or a private chat with one team member, sending single or bulk photos and short videos. Contractors can also share their own weekly or monthly site reports, drawings and proposals as documents. Clients can comment on anything shared with them (updates, daily logs, inspections, change orders, finish selections) to ask for a change or improvement, attaching photos, and see quotes sent to their email under Quotes & proposals, where they can ask questions before accepting. A contractor invites a client by email or by sending the invite link on WhatsApp; the client signs up free with that email and the project appears. Clients can browse companies with an active Buildsasa subscription, rate companies they have worked with, post a job (fencing, borehole drilling, solar, CCTV, gates, landscaping, garbage collection, land clearing, a house and more) to all contractors or one chosen company, which Buildsasa approves before contractors see it, and award a bid on their own job to a company with an active subscription. Buildsasa neutral site reporting: a client who wants independent, unbiased reports can request it in their client account (or read https://buildsasa.com/site-reporting); Buildsasa staff visit the site anywhere in Kenya and post honest photo and video reports of every stage. It costs 10% of the total project cost, spread over the months of reporting and paid monthly, plus the reporter's transport and lunch on each visit day; the client agrees to this fee when requesting, then the Buildsasa team calls them and arranges payment directly (M-Pesa, bank or international transfer). Nothing is paid inside the app. Clients who do not want it can simply follow their site through their contractor's Buildsasa subscription at no cost to them. If the visitor is a homeowner, business or anyone who wants construction work done (rather than a contractor looking for software), invite them to request their project at https://buildsasa.com/request-project, where the Buildsasa team connects them with vetted contractors. If they are building from abroad or worry about being taken advantage of, also tell them about neutral site reporting at https://buildsasa.com/site-reporting, and that they can create a free client account at https://console.buildsasa.com/?as=client. Every new company gets a 14-day free trial with full access and no card needed. Pages to point to: pricing at https://buildsasa.com/pricing, book a demo at https://buildsasa.com/contact, sign up or log in at https://console.buildsasa.com. For exact prices, custom ERP/software projects, government or enterprise deals, refunds, account changes or bugs, offer to connect them with the team on WhatsApp at ${SUPPORT_WHATSAPP} or email ${SUPPORT_EMAIL}. End every answer about Buildsasa (what it does, features, who it is for, how it helps, pricing, how to start) with a short call to action on its own line inviting them to get started at https://console.buildsasa.com — e.g. \"Get started at https://console.buildsasa.com\". You may also offer a free demo at https://buildsasa.com/contact. Skip the call to action only for replies that are not about Buildsasa (such as a polite refusal) or when you have already handed them to the team for an account issue. Be warm, concise and plain-spoken — many visitors are not technical; avoid jargon; short paragraphs or a few bullets; sentence case; no markdown headings. Never invent features, prices, clients or guarantees that aren't stated here; if unsure, say so and offer the team's contact. Politely decline questions unrelated to Buildsasa, construction or the company's services.`;

const suzyHits = new Map();
function suzyRateLimited(ip) {
  const now = Date.now();
  const hits = (suzyHits.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  hits.push(now);
  suzyHits.set(ip, hits);
  if (suzyHits.size > 5000) suzyHits.clear();
  return hits.length > 30;
}

app.post('/api/website/chat', async (req, res) => {
  try {
    const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
    if (suzyRateLimited(ip)) {
      return res.status(429).json({ error: `You're sending messages quickly — please wait a few minutes, or reach us on WhatsApp at ${SUPPORT_WHATSAPP}.` });
    }
    const incoming = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const recent = incoming
      .filter((m) => m && m.content && (m.role === 'user' || m.role === 'assistant'))
      .slice(-10)
      .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content).slice(0, 2000) }));
    if (!recent.length) return res.status(400).json({ error: 'messages required' });
    const messages = [{ role: 'system', content: SUZY_SYSTEM_PROMPT }, ...recent];
    const reply = await callAi(messages, { temperature: 0.4, max_tokens: 600 });
    res.json({ reply });
  } catch (e) {
    console.error('[suzy]', e.message || e);
    res.status(500).json({ error: 'Suzy is unavailable right now.' });
  }
});

app.post('/api/ai/generate-checklist', auth, withCredits('checklist'), async (req, res) => {
  try {
    const { trade, projectType, scope } = req.body;
    const prompt = `Generate a comprehensive construction QA/QC checklist for ${trade} work on a ${projectType}${scope ? ` — ${scope}` : ''}. Return ONLY a JSON array of objects with fields: id (string), title (string), description (string), answerType (one of: text, number, percentage, photo, yes_no, checkbox), required (boolean), unit (string or null), options (string array or null for checkbox), and an optional subItems array.

Rules:
- Include 8-15 main items covering SAFETY, QUALITY, COMPLIANCE, and DOCUMENTATION.
- Use real-world construction terminology and reference industry standards where applicable (e.g., OSHA, ASTM, ACI, NEC, SMACNA, MUTCD, AWWA).
- Each item must have a clear, actionable title and a detailed description explaining what to verify.
- For numeric measurements, always include the correct unit (mm, MPa, bar, degC, Ohms, CFM, etc.).
- For "yes_no" items, the description should explain what PASS looks like.
- For "photo" items, the description should specify what must be photographed.
- Include 2-4 subItems per main item where follow-up measurements or corrective actions are needed. SubItems should be practical follow-ups, not generic notes.
- The checklist should feel like something a site inspector or QC manager would actually use on-site.

Trade-specific guidance:
- Electrical: Include conduit fill %, ground fault testing, arc-flash labeling, panel schedules, cable pulling tensions.
- Plumbing: Include water pressure testing, backflow prevention, grease trap sizing, venting adequacy, thermal expansion.
- HVAC: Include duct leakage (SMACNA), refrigerant charge, economizer operation, CO2 sensors, balancing reports.
- Concrete: Include slump, air content, temperature, cylinder breaks at 7/28 days, curing compound coverage.
- Masonry: Include mortar cube tests, wall ties, weep holes, movement joints, efflorescence check.
- Roofing: Include membrane seams, fastener pull-out, uplift resistance, warranty documentation.
- Earthwork/Grading: Include Proctor density, proof rolling, subgrade CBR, moisture content.
- Bridge: Include falsework inspection, bearing pad rotation, deck crack mapping, post-tensioning grout.
- Traffic Control: Include MUTCD sign sizes, taper lengths, buffer spaces, TCP plan compliance.
- General: Include daily toolbox talks, SDS availability, site security, waste segregation.

Return ONLY valid JSON. No markdown, no explanations.`;
    const raw = await callAi([{ role: 'system', content: 'You are a construction QA expert. Always respond with valid JSON arrays only, no markdown or explanation.' }, { role: 'user', content: prompt }], { temperature: 0.3, max_tokens: 4096 });
    let items = [];
    try {
      const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      items = JSON.parse(cleaned);
    } catch { items = []; }
    if (!Array.isArray(items)) items = [];
    res.json({ title: `${trade} — ${projectType}${scope ? ` (${scope})` : ''}`, items });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Generate checklist items in the Form Builder's exact model from a free-text
// chat request. Returns { title, items } where each item matches the builder.
app.post('/api/ai/build-checklist', auth, withCredits('checklist'), async (req, res) => {
  try {
    const { prompt, trade, category, current, history } = req.body || {};
    if (!prompt || !String(prompt).trim()) return res.status(400).json({ error: 'prompt required' });
    const hasCurrent = Array.isArray(current) && current.length > 0;
    const sys = 'You are Buildsasa AI, a friendly construction QA/QC expert who designs AND edits digital inspection checklists in a conversation. Use the prior turns for context (remember what was asked and built). Respond with ONLY valid JSON — no markdown, no commentary.';
    // Prior conversation for continuity (mapped to chat roles, capped & trimmed).
    const hist = (Array.isArray(history) ? history : [])
      .filter((h) => h && h.content)
      .slice(-12)
      .map((h) => ({ role: (h.role === 'assistant' || h.role === 'ai') ? 'assistant' : 'user', content: String(h.content).slice(0, 1500) }));
    const user = `${hasCurrent
      ? `Here is the current checklist as JSON:\n${JSON.stringify(current)}\n\nApply this request to it and return the COMPLETE updated checklist. Keep items the request does not touch unchanged (same wording, order, options, corrective rules). Edit, add, remove, reorder, translate, or rewrite ONLY as the request implies. Request: "${String(prompt).trim()}".`
      : `Build a construction checklist from this request: "${String(prompt).trim()}".`}${trade ? ` Trade: ${trade}.` : ''}${category ? ` Category: ${category}.` : ''}

Return ONLY a JSON object: { "title": string, "reply": string, "items": Item[] }.
"reply" is a short, friendly 1-2 sentence message to the user: acknowledge what you built or changed (referencing the conversation so far) and suggest a natural next step or ask a clarifying question.
Each Item has EXACTLY these fields:
- questionGroup: string  (section heading, e.g. "Formwork", "Reinforcement", "Safety")
- caption: string        (the check/question — clear and actionable)
- questionType: one of "text" | "number" | "percentage" | "yes_no" | "checkbox" | "photo"
- answerOptions: string[] (for yes_no use ["Yes","No"]; for checkbox the choices; otherwise [])
- defaultAnswer: string  ("" if none)
- photoAvailable: "Yes" | "No"
- correctiveOption: string (the answer that triggers a corrective action, e.g. "No" or "Fail"; "" if none)
- correctiveActions: string[] (actions to take when triggered; [] if none)
- policy: string         (governing standard/spec/drawing, e.g. "ACI 318", "NEC 250"; "" if none)
- required: boolean

Rules: 6-14 items grouped into 2-5 logical groups; real construction terminology and standards (OSHA, ASTM, ACI, NEC, SMACNA, MUTCD, AWWA); for yes_no items where a failure needs follow-up, set correctiveOption to "No" and add 1-2 correctiveActions; reference a relevant standard in policy where applicable. Return ONLY the JSON object.`;
    const raw = await callAiDeepSeekFirst([{ role: 'system', content: sys }, ...hist, { role: 'user', content: user }], { temperature: 0.4, max_tokens: 4096 });
    let data = {};
    try { data = JSON.parse(String(raw).replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()); } catch { data = {}; }
    const items = Array.isArray(data.items) ? data.items : (Array.isArray(data) ? data : []);
    res.json({ title: data.title || '', reply: data.reply || '', items });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/ai/assistant', auth, withCredits('assistant'), async (req, res) => {
  try {
    const userId = req.user.sub;
    const { question, history } = req.body;
    if (!question) return res.status(400).json({ error: 'question required' });

    const [user, projects, checklists, inspections, punchItems, safetyIncidents, dailyLogs, equipment, ledger, expenses, commitments, invoices, bids, changeOrders] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, role: true, email: true } }),
      prisma.project.findMany({ orderBy: { updatedAt: 'desc' }, take: 12, select: { id: true, name: true, code: true, status: true, progress: true, city: true, value: true, exposure: true } }),
      prisma.checklist.findMany({ orderBy: { createdAt: 'desc' }, take: 8, select: { title: true, category: true, source: true, assigned: true, status: true } }),
      prisma.inspection.findMany({ orderBy: { createdAt: 'desc' }, take: 8, select: { type: true, inspector: true, date: true, status: true, projectId: true } }),
      prisma.punchItem.findMany({ orderBy: { createdAt: 'desc' }, take: 12, select: { code: true, area: true, desc: true, status: true, projectId: true } }),
      prisma.safetyIncident.findMany({ orderBy: { createdAt: 'desc' }, take: 8, select: { incidentType: true, severity: true, status: true, date: true, projectId: true } }),
      prisma.dailyLog.findMany({ orderBy: { date: 'desc' }, take: 5, select: { date: true, crew: true, headcount: true, location: true, notes: true } }),
      prisma.equipment.findMany({ orderBy: { updatedAt: 'desc' }, take: 8, select: { name: true, category: true, status: true, location: true } }),
      prisma.ledgerEntry.findMany({ orderBy: { date: 'desc' }, take: 400, select: { type: true, amountUSD: true, category: true, projectId: true, date: true } }),
      prisma.expenseCategory.findMany({ take: 200, select: { name: true, budgetUSD: true, actualUSD: true, projectId: true } }),
      prisma.commitment.findMany({ take: 60, select: { vendor: true, scope: true, amount: true, due: true, projectId: true } }),
      prisma.invoice.findMany({ orderBy: { createdAt: 'desc' }, take: 60, select: { invoiceNumber: true, clientName: true, amount: true, status: true, dueDate: true, projectId: true } }),
      prisma.bid.findMany({ orderBy: { createdAt: 'desc' }, take: 60, select: { subcontractor: true, trade: true, amount: true, status: true, projectId: true } }),
      (prisma.changeOrder ? prisma.changeOrder.findMany({ orderBy: { createdAt: 'desc' }, take: 40, select: { number: true, title: true, status: true, trigger: true, costUSD: true, scheduleImpactDays: true, projectId: true } }).catch(() => []) : Promise.resolve([])),
    ]);

    const fmt = (n) => '$' + Math.round(n || 0).toLocaleString('en-US');
    const group = (arr) => { const m = {}; (arr || []).forEach((r) => { (m[r.projectId] = m[r.projectId] || []).push(r); }); return m; };
    const expByP = group(expenses), ledByP = group(ledger);
    const pName = (id) => projects.find((p) => p.id === id)?.name || 'Unknown project';

    // ---- Safe (non-financial) context — available to all roles ----
    const safeLines = [];
    safeLines.push(`User: ${user?.name || 'Unknown'} (${user?.role || 'Unknown'})`);
    if (projects.length) safeLines.push('PROJECTS:\n' + projects.map((p) => `  - ${p.name} (${p.code}) | ${p.status} | ${p.progress}% complete | ${p.city}`).join('\n'));
    if (checklists.length) safeLines.push('CHECKLISTS:\n' + checklists.map((c) => `  - ${c.title} | ${c.category || 'N/A'} | ${c.status || c.source} | assigned: ${c.assigned}`).join('\n'));
    if (inspections.length) safeLines.push('INSPECTIONS:\n' + inspections.map((i) => `  - ${i.type} | ${i.inspector} | ${i.date} | ${i.status}`).join('\n'));
    if (punchItems.length) safeLines.push('PUNCH ITEMS:\n' + punchItems.map((p) => `  - ${p.code} | ${p.area} | ${p.status} | ${p.desc}`).join('\n'));
    if (safetyIncidents.length) safeLines.push('SAFETY INCIDENTS:\n' + safetyIncidents.map((s) => `  - ${s.incidentType} | ${s.severity} | ${s.status} | ${s.date}`).join('\n'));
    if (dailyLogs.length) safeLines.push('DAILY LOGS:\n' + dailyLogs.map((d) => `  - ${d.date.toISOString().split('T')[0]} | ${d.crew} | ${d.headcount} crew | ${d.location} | ${d.notes}`).join('\n'));
    if (equipment.length) safeLines.push('EQUIPMENT:\n' + equipment.map((e) => `  - ${e.name} | ${e.category} | ${e.status} | ${e.location || 'N/A'}`).join('\n'));

    // ---- Financial context — managers only ----
    const finLines = [];
    const totBudget = (expenses || []).reduce((s, e) => s + (e.budgetUSD || 0), 0);
    const totActual = (expenses || []).reduce((s, e) => s + (e.actualUSD || 0), 0);
    const totIn = (ledger || []).filter((l) => l.type === 'in').reduce((s, l) => s + (l.amountUSD || 0), 0);
    const totOut = (ledger || []).filter((l) => l.type === 'out').reduce((s, l) => s + (l.amountUSD || 0), 0);
    finLines.push(`PORTFOLIO FINANCIALS (USD): Total budget ${fmt(totBudget)} | Cost-to-date ${fmt(totActual)} | Budget variance ${fmt(totBudget - totActual)} (${totActual > totBudget ? 'OVER' : 'under'}) | Cash in ${fmt(totIn)} | Cash out ${fmt(totOut)} | Net cash ${fmt(totIn - totOut)}`);
    if (projects.length) finLines.push('PROJECT FINANCIALS:\n' + projects.map((p) => {
      const exp = expByP[p.id] || [], led = ledByP[p.id] || [];
      const b = exp.reduce((s, e) => s + (e.budgetUSD || 0), 0), a = exp.reduce((s, e) => s + (e.actualUSD || 0), 0);
      const ci = led.filter((l) => l.type === 'in').reduce((s, l) => s + l.amountUSD, 0), co = led.filter((l) => l.type === 'out').reduce((s, l) => s + l.amountUSD, 0);
      return `  - ${p.name} (${p.code}): contract ${p.value} | exposure ${p.exposure || 'n/a'} | budget ${fmt(b)} | spent ${fmt(a)} | variance ${fmt(b - a)} | cash in ${fmt(ci)} / out ${fmt(co)} | ${p.progress}% complete`;
    }).join('\n'));
    if (expenses.length) {
      const ranked = expenses.map((e) => ({ ...e, d: (e.actualUSD || 0) - (e.budgetUSD || 0) })).sort((x, y) => y.d - x.d).slice(0, 8);
      finLines.push('COST CATEGORIES (variance):\n' + ranked.map((e) => `  - ${pName(e.projectId)} / ${e.name}: budget ${fmt(e.budgetUSD)} vs actual ${fmt(e.actualUSD)} → ${e.d >= 0 ? 'OVER' : 'under'} ${fmt(Math.abs(e.d))}`).join('\n'));
    }
    if (commitments.length) finLines.push('COMMITMENTS (subcontracts/POs):\n' + commitments.slice(0, 12).map((c) => `  - ${c.vendor} | ${c.scope} | ${c.amount} | due ${c.due} | ${pName(c.projectId)}`).join('\n'));
    if (invoices.length) {
      const outstanding = invoices.filter((i) => i.status !== 'paid');
      finLines.push(`INVOICES / ACCOUNTS RECEIVABLE: ${invoices.length} total, ${outstanding.length} outstanding worth ${fmt(outstanding.reduce((s, i) => s + (i.amount || 0), 0))}.\n` + invoices.slice(0, 8).map((i) => `  - ${i.invoiceNumber} | ${i.clientName} | ${fmt(i.amount)} | ${i.status} | due ${i.dueDate}`).join('\n'));
    }
    if (bids.length) finLines.push('BIDS:\n' + bids.slice(0, 8).map((b) => `  - ${b.subcontractor} | ${b.trade} | ${fmt(b.amount)} | ${b.status} | ${pName(b.projectId)}`).join('\n'));
    if (changeOrders && changeOrders.length) {
      const coTotal = changeOrders.reduce((s, c) => s + (c.costUSD || 0), 0);
      const coDays = changeOrders.reduce((s, c) => s + (c.scheduleImpactDays || 0), 0);
      const pending = changeOrders.filter((c) => !['approved', 'rejected', 'void'].includes(c.status));
      finLines.push(`CHANGE ORDERS: ${changeOrders.length} total | net cost impact ${fmt(coTotal)} | net schedule impact ${coDays} day(s) | ${pending.length} pending approval.\n` + changeOrders.slice(0, 12).map((c) => `  - ${c.number} | ${c.title} | ${pName(c.projectId)} | ${c.status} | ${fmt(c.costUSD)} | ${c.scheduleImpactDays >= 0 ? '+' : ''}${c.scheduleImpactDays}d | trigger: ${c.trigger || 'n/a'}`).join('\n'));
    } else {
      finLines.push('CHANGE ORDERS: none recorded yet.');
    }

    const userRole = user?.role || 'Unknown';
    const isWorker = userRole === 'Worker' || userRole === 'Trade Lead';

    let systemPrompt;
    if (isWorker) {
      systemPrompt = `You are Buildsasa AI, a construction site assistant for field workers and trade leads. Help with how-to guidance, tools, safety/PPE, trade techniques, reading plans, and understanding assigned checklists.
- Do NOT discuss budgets, financials, change orders, billing, invoices, reports, or subcontractor pricing. If asked, reply: "I can help with how-to and safety questions. For financials or reports, please ask your Project Manager or Superintendent."

PROJECT CONTEXT (for how-to help only):
${safeLines.join('\n\n')}`;
    } else {
      systemPrompt = `You are Buildsasa AI, the management assistant for a construction company. You have the user's REAL project and financial data below (all money in USD). Use it to give specific, numbers-backed answers and reports.

You can produce on request:
- Project status & health reports (progress, status, exposure, open risks).
- Financial reports: budget-vs-actual variance, spend, and cash flow (cash in/out, net) — per project and portfolio-wide.
- Accounts-receivable / invoice summaries (outstanding, overdue).
- Commitment (subcontract/PO) and bid summaries.
- Risk flags: over-budget categories, negative cash, overdue invoices, open safety incidents, open/high-priority punch items.

Formatting: when asked for a "report", use short clear headers and bulleted figures; always cite the actual numbers from the data; round money sensibly; be concise and decision-useful. If something isn't in the data, say so plainly instead of inventing it.

DATA:
${safeLines.concat(finLines).join('\n\n')}`;
    }

    // Prior conversation for continuity (mapped to chat roles, capped & trimmed).
    const hist = (Array.isArray(history) ? history : [])
      .filter((h) => h && h.content)
      .slice(-10)
      .map((h) => ({ role: (h.role === 'assistant' || h.role === 'ai') ? 'assistant' : 'user', content: String(h.content).slice(0, 1500) }));
    const answer = await callAi([
      { role: 'system', content: systemPrompt },
      ...hist,
      { role: 'user', content: question }
    ], { temperature: 0.5 });
    res.json({ answer });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== AI CHECKLIST DOCUMENT EXTRACTION =====
const { OpenAI } = require('openai');
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

// ===== AI DESIGN STUDIO =====
// Concept designs from a prompt, optionally guided by photos the user uploads or
// takes (a site, a room, a sketch): 2D floor plans, 3D renders, architectural
// concepts and interior designs, each with written recommendations. The images
// are AI concepts for discussing ideas with a client, not construction drawings,
// and the studio says so. Generated images are copied into our own storage so
// they outlive the provider's temporary links.
const DESIGN_MODES = {
  plan2d: 'A clean 2D architectural floor plan drawing, top-down orthographic view, black linework on a white background, walls drawn as thick lines, doors with swing arcs, windows marked, every room labelled with its name and approximate dimensions in metres, furniture shown in simple outline, a north arrow and a scale bar. Professional architectural drafting style, no perspective, no shading.',
  render3d: 'A photorealistic 3D architectural visualisation, natural daylight, realistic materials and landscaping, eye-level or slight aerial perspective, high detail, suitable for presenting to a client.',
  architectural: 'An architectural concept design presentation: exterior elevation or massing study with clear form, materials and proportions, presented as a polished architect\'s concept board.',
  interior: 'A photorealistic interior design visualisation of the space, with a coherent style, realistic lighting, materials, finishes and furniture, styled like a professional interior design portfolio image.',
};
const DESIGN_SIZES = { square: '1024x1024', landscape: '1536x1024', portrait: '1024x1536' };
const IMAGE_MODEL = process.env.AI_IMAGE_MODEL || 'gpt-image-1';
const DESIGN_DAILY_LIMIT = Number(process.env.AI_DESIGN_DAILY_LIMIT || 200); // abuse guard; Sasa Credits are the real limit
const designUsage = new Map(); // workspace -> { day, count }

function designQuotaLeft(ws) {
  const day = new Date().toISOString().slice(0, 10);
  const u = designUsage.get(ws || 'none');
  return !u || u.day !== day ? DESIGN_DAILY_LIMIT : DESIGN_DAILY_LIMIT - u.count;
}
function noteDesignUse(ws) {
  const day = new Date().toISOString().slice(0, 10);
  const u = designUsage.get(ws || 'none');
  designUsage.set(ws || 'none', !u || u.day !== day ? { day, count: 1 } : { day, count: u.count + 1 });
}

/** Write bytes to storage the same way an upload is stored; returns the public URL. */
async function storeBuffer(req, buffer, name, mime) {
  const fs = require('fs');
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${path.extname(name) || '.png'}`;
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const filePath = path.join(UPLOAD_DIR, filename);
  fs.writeFileSync(filePath, buffer);
  const stored = await storeUploadedFile(req, { path: filePath, filename, originalname: name, mimetype: mime, size: buffer.length });
  return stored.url;
}

/** Fetch a reference photo (our storage or a local upload) as a file for the image API. */
async function fetchReference(req, url, i) {
  let u = String(url || '');
  if (u.startsWith('/')) u = `${req.protocol}://${req.get('host')}${u}`;
  const r = await fetch(u);
  if (!r.ok) throw new Error('A reference photo could not be read. Upload it again.');
  const type = (r.headers.get('content-type') || 'image/png').split(';')[0];
  if (!/^image\/(png|jpe?g|webp)$/.test(type)) throw new Error('Reference images must be photos (JPG, PNG or WebP).');
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 20 * 1024 * 1024) throw new Error('A reference photo is too large (over 20 MB).');
  const { toFile } = require('openai');
  return toFile(buf, `reference-${i}.${type.split('/')[1].replace('jpeg', 'jpg')}`, { type });
}

const providerMessage = (e) => {
  const m = String(e?.message || e || '');
  if (/safety|content policy|moderation|rejected/i.test(m)) return 'That request was declined by the AI\'s safety filter. Rephrase the prompt and try again.';
  if (/billing|quota|insufficient/i.test(m)) return 'AI design generation is unavailable right now (the AI account has run out of credit). Please contact Buildsasa support.';
  if (/verif|organization must be|not have access|model_not_found|does not exist/i.test(m)) return 'MODEL_ACCESS';
  if (/timed? ?out|ETIMEDOUT|ECONNRESET/i.test(m)) return 'The AI took too long to respond. Please try again.';
  return 'The design couldn\'t be generated. Please try again.';
};

app.post('/api/ai/design', auth, withCredits((req) => (Array.isArray(req.body?.images) && req.body.images.filter(Boolean).length ? 'design_photos' : 'design')), async (req, res) => {
  try {
    if (!openai) return res.status(503).json({ error: 'AI design generation isn\'t set up on this server yet.' });
    const ws = currentWs();
    if (designQuotaLeft(ws) <= 0) return res.status(429).json({ error: `Your company has generated ${DESIGN_DAILY_LIMIT} designs today, the daily safety limit. Try again tomorrow.` });
    const b = req.body || {};
    const mode = DESIGN_MODES[b.mode] ? b.mode : 'render3d';
    const prompt = String(b.prompt || '').trim().slice(0, 2000);
    if (prompt.length < 8) return res.status(400).json({ error: 'Describe what you want in a sentence or two, e.g. "3-bedroom bungalow, open-plan kitchen, 120 m²".' });
    const refs = (Array.isArray(b.images) ? b.images : []).filter(Boolean).slice(0, 4);
    const size = DESIGN_SIZES[b.aspect] || (mode === 'plan2d' ? '1024x1024' : '1536x1024');
    const style = b.style ? ` Style: ${String(b.style).slice(0, 80)}.` : '';
    const guide = refs.length
      ? ` Use the attached photo${refs.length > 1 ? 's' : ''} as the reference for the existing space, site or sketch: keep its layout and proportions where relevant and transform it as described.`
      : '';
    const fullPrompt = `${DESIGN_MODES[mode]}${style}${guide} Brief from the client: ${prompt}. Context: a project in Kenya / East Africa; use locally sensible materials and climate-appropriate design.`;

    const generate = async (model) => {
      if (refs.length) {
        const files = await Promise.all(refs.map((u, i) => fetchReference(req, u, i)));
        return openai.images.edit({ model, image: files.length === 1 ? files[0] : files, prompt: fullPrompt, size });
      }
      const params = { model, prompt: fullPrompt, n: 1, size };
      if (model === 'dall-e-3') { params.size = size === '1024x1024' ? '1024x1024' : '1792x1024'; params.response_format = 'b64_json'; params.quality = 'hd'; }
      else params.quality = b.quality === 'high' ? 'high' : 'medium';
      return openai.images.generate(params);
    };

    // Written recommendations run alongside the image (vision when photos are given).
    const adviceTask = (async () => {
      try {
        const content = [{ type: 'text', text: `You are a senior architect and interior designer advising a contractor in Kenya. Mode: ${mode}. Brief: ${prompt}.${refs.length ? ' Photos of the existing space/site are attached.' : ''} Give concise, practical recommendations in plain text with short headings and bullet points: layout/design ideas, materials and finishes available in Kenya, indicative considerations (ventilation, natural light, climate, building code/NCA approvals where relevant), and 3 things to confirm with the client. Under 220 words. No markdown symbols other than "- " bullets.` }];
        for (const u of refs.slice(0, 2)) content.push({ type: 'image_url', image_url: { url: u.startsWith('/') ? `${req.protocol}://${req.get('host')}${u}` : u } });
        const c = await openai.chat.completions.create({ model: 'gpt-4o', messages: [{ role: 'user', content }], temperature: 0.5, max_tokens: 500 });
        return c.choices?.[0]?.message?.content || null;
      } catch (e) { console.error('[design] advice failed:', e.message); return null; }
    })();

    let result;
    try { result = await generate(IMAGE_MODEL); }
    catch (e) {
      // Accounts without access to the newest model fall back to DALL·E 3 for
      // prompt-only designs (it can't work from reference photos).
      if (providerMessage(e) === 'MODEL_ACCESS' && !refs.length && IMAGE_MODEL !== 'dall-e-3') {
        console.warn('[design] falling back to dall-e-3:', e.message);
        result = await generate('dall-e-3');
      } else {
        console.error('[design] generation failed:', e.message);
        const msg = providerMessage(e);
        return res.status(502).json({ error: msg === 'MODEL_ACCESS' ? 'Working from photos needs the newer AI image model, which isn\'t enabled on this account yet. Try without photos, or contact Buildsasa support.' : msg });
      }
    }
    const item = result?.data?.[0];
    let buffer = item?.b64_json ? Buffer.from(item.b64_json, 'base64') : null;
    if (!buffer && item?.url) buffer = Buffer.from(await (await fetch(item.url)).arrayBuffer());
    if (!buffer) return res.status(502).json({ error: 'The AI didn\'t return an image. Please try again.' });
    noteDesignUse(ws);
    const imageUrl = await storeBuffer(req, buffer, `ai-${mode}.png`, 'image/png');
    const notes = await adviceTask;
    const row = await prisma.aiDesign.create({ data: { userId: req.user?.sub || null, mode, prompt, imageUrl, sourceImages: refs.length ? JSON.stringify(refs) : null, notes } });
    res.json({ ...row, sourceImages: refs, remainingToday: designQuotaLeft(ws) });
  } catch (e) {
    console.error('[design]', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/ai/designs', auth, async (req, res) => {
  try {
    const rows = await prisma.aiDesign.findMany({ orderBy: { createdAt: 'desc' }, take: 60 });
    res.json({ designs: rows.map((r) => ({ ...r, sourceImages: (() => { try { return JSON.parse(r.sourceImages || '[]'); } catch { return []; } })() })), remainingToday: designQuotaLeft(currentWs()), enabled: !!openai });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/ai/designs/:id', auth, async (req, res) => {
  try { await prisma.aiDesign.delete({ where: { id: req.params.id } }); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// File a design into a project's drawings as an "AI Concept" sheet, so it sits
// with the project's other drawings, opens in the viewer and can be marked up.
const DESIGN_LABEL = { plan2d: '2D floor plan concept', render3d: '3D render concept', architectural: 'Architectural concept', interior: 'Interior design concept' };
app.post('/api/ai/designs/:id/save', auth, async (req, res) => {
  try {
    const d = await prisma.aiDesign.findUnique({ where: { id: req.params.id } });
    if (!d) return res.status(404).json({ error: 'This design no longer exists.' });
    const projectId = String(req.body?.projectId || '');
    const project = projectId ? await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, name: true } }) : null;
    if (!project) return res.status(400).json({ error: 'Choose the project to save this design to.' });
    const title = String(req.body?.title || '').trim().slice(0, 200) || DESIGN_LABEL[d.mode] || 'AI concept';
    const count = await prisma.drawing.count({ where: { projectId: project.id, discipline: 'AI Concept' } });
    const drawing = await prisma.drawing.create({ data: {
      projectId: project.id, number: `AI-${String(count + 1).padStart(3, '0')}`, title, discipline: 'AI Concept', rev: 1, status: 'Concept',
      fileUrl: d.imageUrl, fileName: `${title}.png`, uploadedBy: req.user?.name || req.user?.email || null,
    } });
    await prisma.aiDesign.update({ where: { id: d.id }, data: { projectId: project.id, drawingId: drawing.id } });
    res.json({ drawing, projectName: project.name });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const extractTextFromFile = async (file) => {
  const ext = (file.originalname || '').split('.').pop().toLowerCase();
  const mime = file.mimetype || '';

  // Images: return null so we can use vision API instead
  if (mime.startsWith('image/')) return null;

  const buffer = require('fs').readFileSync(file.path);

  if (ext === 'pdf' || mime === 'application/pdf') {
    const data = await pdfParse(buffer);
    return data.text || '';
  }

  if (ext === 'docx' || ext === 'doc' || mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const result = await mammoth.extractRawText({ buffer });
    return result.value || '';
  }

  if (ext === 'csv' || mime === 'text/csv') {
    try {
      const rows = csvParse(buffer.toString('utf-8'), { columns: true, skip_empty_lines: true });
      return JSON.stringify(rows, null, 2);
    } catch (csvErr) {
      console.error('CSV parse error:', csvErr.message);
      return buffer.toString('utf-8');
    }
  }

  if (ext === 'xlsx' || ext === 'xls' || mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
    const XLSX = require('xlsx');
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    let text = '';
    workbook.SheetNames.forEach((name) => {
      const sheet = workbook.Sheets[name];
      const csv = XLSX.utils.sheet_to_csv(sheet);
      text += `\n--- Sheet: ${name} ---\n${csv}`;
    });
    return text;
  }

  // Plain text / fallback
  return buffer.toString('utf-8');
};

const MAX_TEXT_CHARS = 6000;

const buildExtractionPrompt = (content) => {
  const truncated = content.length > MAX_TEXT_CHARS
    ? content.slice(0, MAX_TEXT_CHARS) + '\n\n[DOCUMENT TRUNCATED DUE TO LENGTH]'
    : content;
  return `You are a construction document parser. Convert the following checklist document content into a structured digital checklist.

Return ONLY valid JSON with this exact structure:
{
  "title": "Checklist Title",
  "questions": [
    {
      "question": "Question text",
      "questionType": "text",
      "required": true,
      "options": ["option1", "option2"],
      "subQuestions": [
        { "question": "Sub-question text", "questionType": "text", "required": false, "options": [] }
      ]
    }
  ]
}

questionType must be exactly one of: text, number, yes_no, pass_fail, dropdown, checkbox, date, photo, signature.

Here is an example of the expected output:
{
  "title": "Concrete Pour Checklist",
  "questions": [
    {
      "question": "Has the concrete mix design been approved?",
      "questionType": "yes_no",
      "required": true,
      "options": [],
      "subQuestions": [
        { "question": "Upload approved mix design document", "questionType": "photo", "required": true, "options": [] }
      ]
    },
    {
      "question": "What is the measured slump?",
      "questionType": "number",
      "required": true,
      "options": [],
      "subQuestions": []
    }
  ]
}

Rules:
- Detect the main checklist title from the document header.
- Map each checklist item to a question.
- Detect answer/input types:
  - "yes_no" for pass/fail, yes/no, comply/non-comply items.
  - "checkbox" for multiple-select or check-all-that-apply items.
  - "dropdown" for single-select from a list.
  - "number" for measurements, quantities, percentages.
  - "photo" for items asking to attach/take a photo.
  - "signature" for sign-off fields.
  - "date" for date fields.
  - "text" for general remarks, descriptions, or when no specific type is clear.
- A single question may require multiple inputs (e.g., "describe and attach photo"). In that case, create a sub-question for the secondary input.
- Detect hierarchical relationships: if a document uses indentation, bullets, or numbering like 1, 1.1, 1.2, treat indented/follow-up items as subQuestions of the parent.
- Required should be true for mandatory fields, false for optional.
- Include options array only for dropdown and checkbox types.
- Return ONLY valid JSON. No markdown, no explanations, no code blocks.

Document content:
${truncated}`;
};

const callAiForExtraction = async (messages) => {
  // Prefer OpenAI (GPT-4o) if available
  if (openai) {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages,
      temperature: 0.2,
      max_tokens: 8192,
    });
    return completion.choices[0].message.content || '';
  }
  // Fallback to DeepSeek
  return await deepSeekRequest(messages);
};

// Extract the outermost JSON object or array from a string
function extractJSON(str) {
  str = str.trim();
  const firstChar = str[0];
  if (firstChar === '[') {
    // Find matching closing bracket
    let depth = 0;
    for (let i = 0; i < str.length; i++) {
      if (str[i] === '[') depth++;
      else if (str[i] === ']') {
        depth--;
        if (depth === 0) return str.slice(0, i + 1);
      }
    }
  }
  if (firstChar === '{') {
    let depth = 0;
    for (let i = 0; i < str.length; i++) {
      if (str[i] === '{') depth++;
      else if (str[i] === '}') {
        depth--;
        if (depth === 0) return str.slice(0, i + 1);
      }
    }
  }
  // Fallback regex
  const objMatch = str.match(/\{[\s\S]*\}/);
  if (objMatch) return objMatch[0];
  const arrMatch = str.match(/\[[\s\S]*\]/);
  if (arrMatch) return arrMatch[0];
  return str;
}

app.post('/api/ai/extract-checklist-from-document', auth, withCredits('extract'), singleFile('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No file uploaded' });

    let textContent = '';
    let imageBase64 = null;

    const ext = (file.originalname || '').split('.').pop().toLowerCase();
    const mime = file.mimetype || '';

    console.log('[AI Extract] file:', file.originalname, 'mime:', mime, 'size:', file.size);

    if (mime.startsWith('image/')) {
      imageBase64 = require('fs').readFileSync(file.path).toString('base64');
    } else {
      textContent = await extractTextFromFile(file);
    }

    // Clean up uploaded file
    try { require('fs').unlinkSync(file.path); } catch {}

    console.log('[AI Extract] text length:', textContent.length, 'image:', imageBase64 ? 'yes' : 'no');

    // Reject empty text documents
    if (!imageBase64 && (!textContent || textContent.trim().length === 0)) {
      return res.status(400).json({ error: 'Could not extract text from this file. It may be a scanned/image-based PDF. Try uploading an image instead.' });
    }

    const systemPrompt = 'You are a construction document parser. Always respond with valid JSON only, no markdown or explanation.';
    let raw = '';

    if (imageBase64) {
      const messages = [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'text', text: buildExtractionPrompt('This is an image of a checklist document. Extract the title, questions, sub-questions, and answer types.') },
            { type: 'image_url', image_url: { url: `data:${mime};base64,${imageBase64}` } },
          ],
        },
      ];
      raw = await callAiForExtraction(messages);
    } else {
      const prompt = buildExtractionPrompt(textContent);
      raw = await callAiForExtraction([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ]);
    }

    console.log('[AI Extract] raw response (first 800 chars):', raw.substring(0, 800));

    let parsed = null;
    let parseError = null;
    try {
      const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      const jsonStr = extractJSON(cleaned);
      parsed = JSON.parse(jsonStr);
    } catch (parseErr) {
      parseError = parseErr.message;
      console.error('[AI Extract] JSON parse error:', parseErr.message);
    }

    // Handle AI returning just an array of questions directly
    if (Array.isArray(parsed)) {
      parsed = { title: '', questions: parsed };
    }

    if (!parsed || !Array.isArray(parsed.questions)) {
      console.log('[AI Extract] parsed has no questions array. parsed keys:', Object.keys(parsed || {}));
      return res.status(422).json({ error: 'AI returned unparseable response', raw: raw.substring(0, 2000), parseError });
    }

    console.log('[AI Extract] returning', parsed.questions.length, 'questions');
    res.json(parsed);
  } catch (e) {
    console.error('Extract checklist error:', e);
    res.status(500).json({ error: e.message || 'Extraction failed' });
  }
});

// ===== PROJECT HUB (one page per project: documents, drawings, BOQ, variations,
// certificates, site diary, cost control) — see src/project-hub.js =====
require('./project-hub')(app, {
  prisma, auth, hasRole, CAN_MANAGE_BIDS, CAN_REVIEW_FINANCE, CAN_CREATE_CO,
  logCO, recomputeCommitment, boqAmount, projectDto,
});

// ===== GENERIC SECTION CRUD (Observations, Coordination, Action Plans, etc.) =====
// Registers list/create/update/delete for a Prisma model. Only whitelisted
// fields are accepted; jsonFields are stringified on the way in.
function crudRoutes(path, model, fields, jsonFields = []) {
  const pick = (body) => {
    const data = {};
    for (const f of fields) {
      if (body[f] === undefined) continue;
      data[f] = (jsonFields.includes(f) && typeof body[f] !== 'string') ? JSON.stringify(body[f]) : body[f];
    }
    return data;
  };
  app.get(`/api/${path}`, auth, async (req, res) => {
    try {
      // ?projectId= scopes the list to one project, which is what the project
      // detail page needs. Absent, it lists everything as before.
      const where = req.query.projectId && fields.includes('projectId') ? { projectId: String(req.query.projectId) } : {};
      res.json((await prisma[model].findMany({ where, orderBy: { createdAt: 'desc' } })) || []);
    }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post(`/api/${path}`, auth, async (req, res) => {
    try { res.json(await prisma[model].create({ data: pick(req.body) })); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.put(`/api/${path}/:id`, auth, async (req, res) => {
    try { res.json(await prisma[model].update({ where: { id: req.params.id }, data: pick(req.body) })); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.delete(`/api/${path}/:id`, auth, async (req, res) => {
    try { await prisma[model].delete({ where: { id: req.params.id } }); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
}

// `projectId` is whitelisted alongside `project` on every module that links to
// one, so the record keeps a real reference and not just a display name.
crudRoutes('observations', 'observation',
  ['title', 'type', 'status', 'priority', 'location', 'project', 'projectId', 'assignee', 'date', 'description', 'photos']);
crudRoutes('coordination-issues', 'coordinationIssue',
  ['title', 'type', 'status', 'priority', 'raisedBy', 'assignedTo', 'project', 'projectId', 'date', 'description', 'comments'], ['comments']);
crudRoutes('action-plans', 'actionPlan',
  ['title', 'source', 'owner', 'due', 'status', 'project', 'projectId', 'items'], ['items']);
crudRoutes('correspondence', 'correspondence',
  ['subject', 'type', 'direction', 'status', 'fromParty', 'toParty', 'project', 'projectId', 'date', 'body', 'attachments'], ['attachments']);
crudRoutes('crews', 'crew',
  ['name', 'trade', 'foreman', 'project', 'projectId', 'location', 'shift', 'status', 'members'], ['members']);
crudRoutes('directory-contacts', 'directoryContact',
  ['name', 'company', 'role', 'category', 'phone', 'email', 'projects'], ['projects']);
crudRoutes('company-docs', 'companyDoc',
  ['name', 'category', 'type', 'size', 'uploadedBy', 'date', 'url']);
crudRoutes('announcements', 'announcement',
  ['title', 'body', 'author', 'authorRole', 'date', 'pinned', 'priority', 'audience', 'project', 'roles', 'recipients', 'attachments', 'requireAck', 'ackCount', 'readBy', 'totalRecipients'], ['roles', 'recipients', 'attachments']);

// ===== BILLING / SUBSCRIPTIONS (Paystack) =====
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY || '';
const USD_TO_KES = Number(process.env.USD_TO_KES || 130);
// Live pricing. KES amounts are derived from USD via USD_TO_KES so there is a
// single source of truth; pin the rate with the USD_TO_KES env var.
// Fallback catalogue — used only when the SubscriptionPackage table is empty or
// unreachable, so billing keeps working through a bad deploy or an empty
// catalogue. The live catalogue is admin-editable and lives in the DB.
const PLANS_FALLBACK = [
  { id: 'standard-monthly', name: 'Buildsasa Standard — Monthly', cycle: 'monthly', usd: 250, kes: Math.round(250 * USD_TO_KES), days: 30, note: 'Billed every month. Cancel anytime.', aiCredits: 200 },
  { id: 'standard-yearly', name: 'Buildsasa Standard — Yearly', cycle: 'yearly', usd: 2500, kes: Math.round(2500 * USD_TO_KES), days: 365, note: 'Billed once a year — save $500 (2 months free).', aiCredits: 300 },
];

// Map a SubscriptionPackage row to the plan shape the SaaS pricing screen and
// checkout expect. `kes` is derived here so it always tracks the current rate.
function planShape(row) {
  let features;
  if (row.features) { try { features = JSON.parse(row.features); } catch { /* ignore bad JSON */ } }
  return {
    id: row.id, name: row.name, cycle: row.cycle, usd: row.usd, kes: Math.round((row.usd || 0) * USD_TO_KES), days: row.days, note: row.note || undefined, features, aiCredits: row.aiCredits ?? 200,
    includedUsers: row.includedUsers || 0, perUserUsd: row.perUserUsd || 0, perUserKes: Math.round((row.perUserUsd || 0) * USD_TO_KES),
  };
}

// ── Per-user pricing ──
// Users = active team members of the company. Clients (property owners) never
// count, nor do removed or suspended accounts.
async function seatsFor(workspaceId) {
  if (!workspaceId) return 1;
  return Math.max(1, await prismaBase.user.count({ where: { workspaceId, status: 'active', role: { not: 'Client' } } }));
}
// What a plan costs for a team of `seats`. A plan with no included-user limit is flat.
function quotePlan(p, seats) {
  const perUser = p.includedUsers > 0 && p.perUserUsd > 0;
  const extra = perUser ? Math.max(0, seats - p.includedUsers) : 0;
  const usd = Math.round(((p.usd || 0) + extra * (p.perUserUsd || 0)) * 100) / 100;
  return { seats, perUser, included: p.includedUsers || 0, extra, perUserUsd: p.perUserUsd || 0, perUserKes: p.perUserKes || 0, usd, kes: Math.round(usd * USD_TO_KES) };
}
const seatLine = (p, q) => (q.perUser ? ` · ${q.seats} user${q.seats === 1 ? '' : 's'} (${q.included} included${q.extra ? ` + ${q.extra} extra × KES ${q.perUserKes.toLocaleString('en-KE')}` : ''})` : '');

// Load the plan catalogue from the DB (admin-managed), newest-ordered. Falls
// back to the hardcoded list on empty/error so billing never breaks.
async function loadPlans({ includeInactive = false } = {}) {
  try {
    const rows = await prisma.subscriptionPackage.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    if (rows.length) return rows.map(planShape);
  } catch (e) {
    console.error('[PLANS] DB load failed, using fallback:', e && e.message);
  }
  return PLANS_FALLBACK;
}
async function planById(id) { const plans = await loadPlans({ includeInactive: true }); return plans.find((p) => p.id === id); }
async function planDays(id) { const p = await planById(id); return (p && p.days) || 30; }

function paystackRequest(path, method, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const r = https.request({ hostname: 'api.paystack.co', path, method, headers: { Authorization: `Bearer ${PAYSTACK_SECRET}`, 'Content-Type': 'application/json', ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}) } }, (resp) => {
      let data = ''; resp.on('data', (c) => (data += c)); resp.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    });
    r.on('error', reject); if (payload) r.write(payload); r.end();
  });
}

app.get('/api/billing/plans', async (_req, res) => {
  try {
    const plans = await loadPlans();
    res.json({ plans, usdToKes: USD_TO_KES, configured: !!PAYSTACK_SECRET });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/billing/seats', auth, async (req, res) => {
    try {
      const seats = await seatsFor(currentWs());
      const plans = await loadPlans();
      const active = await prisma.subscription.findFirst({ where: { status: 'active' }, orderBy: { createdAt: 'desc' } });
      const quotes = plans.map((p) => ({ planId: p.id, name: p.name, cycle: p.cycle, now: quotePlan(p, seats), plusOne: quotePlan(p, seats + 1) }));
      res.json({ seats, currentPlanId: active ? active.plan : null, comp: hasFreeAccess(req.user?.email) || isPlatformAdmin(req.user?.email), quotes });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Free trial: every new company gets full access for TRIAL_DAYS (default 14)
// from the day it signed up, with no card. Set TRIAL_DAYS=0 to switch it off.
// It is counted from the workspace's creation date, so it can't be restarted.
const TRIAL_DAYS = Math.max(0, parseInt(process.env.TRIAL_DAYS ?? '14', 10) || 0);
async function trialFor(workspaceId) {
  if (!TRIAL_DAYS || !workspaceId) return null;
  const ws = await prismaBase.workspace.findUnique({ where: { id: workspaceId }, select: { createdAt: true } });
  if (!ws) return null;
  const endsAt = new Date(new Date(ws.createdAt).getTime() + TRIAL_DAYS * 864e5);
  return { endsAt, active: endsAt.getTime() > Date.now(), daysLeft: Math.max(0, Math.ceil((endsAt.getTime() - Date.now()) / 864e5)) };
}
clientRouteDeps.trialDays = TRIAL_DAYS;

app.get('/api/billing/subscription', auth, async (req, res) => {
  try {
    // Comped accounts (FREE_ACCESS_EMAILS) and platform admins always report an
    // active subscription so the paywall never engages. Admins run this product;
    // locking them out of it behind its own checkout is nonsense, and it used to
    // happen because only FREE_ACCESS_EMAILS was checked here.
    if (hasFreeAccess(req.user?.email) || isPlatformAdmin(req.user?.email)) {
      return res.json({ status: 'active', plan: 'comp', comp: true, isBillingOwner: true, currentPeriodEnd: new Date(Date.now() + 3650 * 864e5) });
    }
    // Prefer an ACTIVE subscription over merely the newest row. Every abandoned
    // checkout writes an 'inactive' row, so taking the latest by date meant one
    // half-finished payment attempt could paywall a workspace that had already
    // paid — and every member of it.
    const active = await prisma.subscription.findFirst({ where: { status: 'active' }, orderBy: { createdAt: 'desc' } });
    const sub = active || await prisma.subscription.findFirst({ where: {}, orderBy: { createdAt: 'desc' } });
    // Who actually handles billing for this workspace. Everyone else rides on the
    // workspace's status and is never sent to a checkout they cannot complete.
    // With no subscription row yet (a workspace that has never checked out) there
    // is nobody to compare against, and answering `false` told the one person who
    // CAN pay to go ask someone else — the paywall then had no way out. Fall back
    // to the account role: a Contractor owns the workspace and its billing.
    const isBillingOwner = sub ? sub.userId === req.user.sub : req.user?.role === 'Contractor';
    // No paid plan yet, but still inside the free trial: full access, with the end date.
    let trialEnded = false;
    if (!active) {
      const t = await trialFor(currentWs());
      if (t && t.active) return res.json({ status: 'active', plan: 'trial', trial: true, trialEndsAt: t.endsAt, trialDaysLeft: t.daysLeft, isBillingOwner });
      trialEnded = !!t;
    }
    res.json(sub ? { ...sub, isBillingOwner, trialEnded } : { status: 'inactive', isBillingOwner, trialEnded });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- Service invoices (auto-issued from the plan; paid via Paystack or marked manually) ----
function nextInvoiceNumber() { return 'INV-' + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 900 + 100); }
async function issueInvoice(userId, planId, ref, opts = {}) {
  const p = (await planById(planId)) || (await loadPlans())[0] || { id: planId, usd: 0, kes: 0, name: 'Subscription' };
  const dueDays = opts.dueDays == null ? 7 : opts.dueDays;
  const owner = await prismaBase.user.findUnique({ where: { id: userId }, select: { workspaceId: true } }).catch(() => null);
  const q = quotePlan(p, await seatsFor(owner && owner.workspaceId));
  return prisma.billingInvoice.create({ data: {
    userId,
    number: nextInvoiceNumber(),
    plan: p.id || null,
    description: (opts.description || `${(p.name || p.id || 'Subscription')} subscription`) + seatLine(p, q),
    amountUSD: q.usd || 0,
    amountKES: q.kes || 0,
    currency: opts.currency === 'USD' ? 'USD' : 'KES',
    status: 'unpaid',
    dueDate: new Date(Date.now() + dueDays * 864e5),
    paystackRef: ref || null,
  } });
}

// Send a branded receipt when an invoice is paid. Fully guarded so a failure
// here can never break the payment flow; sendEmail no-ops/logs without Resend.
// Generate a one-page branded PDF invoice as a Buffer. Lazily requires pdfkit so
// the server still runs (emailing the HTML receipt only) if the dependency isn't
// installed yet. Returns null on any problem.
async function buildInvoicePdfBuffer(invoice, billedToName, billedToEmail) {
  let PDFDocument;
  try { PDFDocument = require('pdfkit'); } catch { return null; }
  return new Promise((resolve) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', () => resolve(null));
      const paid = invoice.status === 'paid';
      const money = invoice.currency !== 'USD'
        ? `KSh ${Math.round(invoice.amountKES || 0).toLocaleString()}`
        : `$${Math.round(invoice.amountUSD || 0).toLocaleString()}`;
      doc.fillColor('#FF6B1A').font('Helvetica-Bold').fontSize(22).text('Buildsasa', 50, 50);
      doc.fillColor('#11161D').fontSize(16).text('INVOICE', 50, 52, { width: 495, align: 'right' });
      doc.font('Helvetica').fontSize(10).fillColor(paid ? '#22C55E' : '#F59E0B').text(paid ? 'PAID' : 'UNPAID', 50, 73, { width: 495, align: 'right' });
      doc.moveTo(50, 92).lineTo(545, 92).strokeColor('#DCE0E6').stroke();
      doc.fillColor('#11161D').font('Helvetica-Bold').fontSize(12).text(`Invoice ${invoice.number}`, 50, 106);
      doc.font('Helvetica').fontSize(10).fillColor('#5A6675');
      let y = 126;
      doc.text(`Issued: ${invoice.issuedAt ? new Date(invoice.issuedAt).toLocaleDateString() : '—'}`, 50, y); y += 15;
      doc.text(`Due: ${invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : '—'}`, 50, y); y += 15;
      if (invoice.paidAt) { doc.text(`Paid: ${new Date(invoice.paidAt).toLocaleDateString()}`, 50, y); y += 15; }
      if (billedToName || billedToEmail) {
        doc.fillColor('#11161D').font('Helvetica-Bold').text('Billed to', 350, 106, { width: 195, align: 'right' });
        doc.font('Helvetica').fillColor('#5A6675');
        if (billedToName) doc.text(billedToName, 350, 126, { width: 195, align: 'right' });
        if (billedToEmail) doc.text(billedToEmail, 350, 141, { width: 195, align: 'right' });
      }
      const top = Math.max(y, 168) + 10;
      doc.rect(50, top, 495, 22).fill('#FF6B1A');
      doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(10).text('Description', 58, top + 7);
      doc.fillColor('#FFFFFF').text('Amount', 50, top + 7, { width: 487, align: 'right' });
      doc.fillColor('#11161D').font('Helvetica').text(invoice.description || 'Subscription', 58, top + 32, { width: 380 });
      doc.text(money, 50, top + 32, { width: 487, align: 'right' });
      doc.moveTo(50, top + 52).lineTo(545, top + 52).strokeColor('#DCE0E6').stroke();
      doc.font('Helvetica-Bold').fontSize(12).fillColor('#11161D').text('Total', 58, top + 62);
      doc.text(money, 50, top + 62, { width: 487, align: 'right' });
      doc.font('Helvetica').fontSize(10).fillColor('#5A6675').text('Thank you for your business', 50, 770);
      doc.fillColor('#FF6B1A').font('Helvetica-Bold').text('Buildsasa', 50, 785);
      doc.end();
    } catch { resolve(null); }
  });
}

async function emailInvoiceReceipt(invoice, toEmail) {
  try {
    if (!invoice || !toEmail) return;
    const amount = invoice.currency !== 'USD'
      ? `KSh ${(invoice.amountKES || 0).toLocaleString()}`
      : `$${(invoice.amountUSD || 0).toLocaleString()}`;
    const issued = invoice.issuedAt ? new Date(invoice.issuedAt).toLocaleDateString() : '—';
    const paid = invoice.paidAt ? new Date(invoice.paidAt).toLocaleDateString() : new Date().toLocaleDateString();
    const html = emailShell('Payment received', `
      <p style="font-size:14px;color:#11161D">We've received your payment — thank you. Here is your receipt.</p>
      <table style="font-size:14px;color:#11161D;border-collapse:collapse;margin:8px 0">
        <tr><td style="padding:4px 16px 4px 0;color:#8A95A5">Invoice</td><td style="padding:4px 0">${invoice.number}</td></tr>
        <tr><td style="padding:4px 16px 4px 0;color:#8A95A5">Description</td><td style="padding:4px 0">${invoice.description || 'Subscription'}</td></tr>
        <tr><td style="padding:4px 16px 4px 0;color:#8A95A5">Amount</td><td style="padding:4px 0">${amount}</td></tr>
        <tr><td style="padding:4px 16px 4px 0;color:#8A95A5">Issued</td><td style="padding:4px 0">${issued}</td></tr>
        <tr><td style="padding:4px 16px 4px 0;color:#8A95A5">Paid</td><td style="padding:4px 0">${paid}</td></tr>
      </table>
      <p style="font-size:14px;font-weight:600;color:#22C55E;margin:8px 0">PAID</p>
      ${button(APP_URL, 'View in Buildsasa')}
    `);
    const pdf = await buildInvoicePdfBuffer(invoice, '', toEmail);
    const attachments = pdf ? [{ filename: `Invoice_${invoice.number}.pdf`, content: pdf.toString('base64') }] : undefined;
    await sendEmail({ to: toEmail, subject: `Your Buildsasa receipt — invoice ${invoice.number}`, html, attachments });
  } catch (e) {
    console.error('[RECEIPT] failed:', e && e.message);
  }
}

app.get('/api/billing/invoices', auth, async (req, res) => {
  try {
    // Comped accounts never owe anything — report no invoices so the overdue
    // paywall can never engage for them.
    if (hasFreeAccess(req.user?.email) || isPlatformAdmin(req.user?.email)) return res.json([]);
    // Lazy renewal: if the active subscription has lapsed and there's no open
    // invoice, auto-issue one due now so the user is prompted to pay & continue.
    const sub = await prisma.subscription.findFirst({ where: {}, orderBy: { createdAt: 'desc' } });
    const openInvoice = await prisma.billingInvoice.findFirst({ where: { userId: req.user.sub, status: 'unpaid' } });
    if (sub && sub.status === 'active' && sub.currentPeriodEnd && new Date(sub.currentPeriodEnd) < new Date() && !openInvoice) {
      await issueInvoice(req.user.sub, sub.plan, null, { currency: sub.currency, dueDays: 0, description: `${sub.plan} renewal` });
    }
    const rows = await prisma.billingInvoice.findMany({ where: { userId: req.user.sub }, orderBy: { issuedAt: 'desc' } });
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Begin paying a specific invoice via Paystack (demo response when not configured).
app.post('/api/billing/invoices/:id/pay', auth, async (req, res) => {
  try {
    // Comped accounts owe nothing — never send one to Paystack, even if an old
    // invoice from before they were comped is still sitting in the table.
    if (hasFreeAccess(req.user?.email)) {
      return res.json({ comp: true, message: 'This account has free access — no payment is required.' });
    }
    const inv = await prisma.billingInvoice.findUnique({ where: { id: req.params.id } });
    if (!inv || inv.userId !== req.user.sub) return res.status(404).json({ error: 'Invoice not found' });
    if (inv.status === 'paid') return res.json({ ok: true, alreadyPaid: true });
    const cur = inv.currency === 'USD' ? 'USD' : 'KES';
    if (!PAYSTACK_SECRET) return res.json({ demo: true, message: 'Paystack not set — add PAYSTACK_SECRET_KEY in backend/.env, or have the owner mark this invoice paid.' });
    const amount = Math.round((cur === 'USD' ? inv.amountUSD : inv.amountKES) * 100);
    const init = await paystackRequest('/transaction/initialize', 'POST', { email: req.user.email || 'owner@buildsasa.com', amount, currency: cur, callback_url: process.env.APP_URL || 'http://localhost:5173', metadata: { userId: inv.userId, planId: inv.plan, invoiceId: inv.id } });
    if (!init.status) return res.status(502).json({ error: init.message || 'Paystack init failed' });
    await prisma.billingInvoice.update({ where: { id: inv.id }, data: { paystackRef: init.data.reference } });
    res.json({ authorizationUrl: init.data.authorization_url, reference: init.data.reference });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Manual fallback: mark an invoice paid (owner), which (re)activates the subscription.
// Manual override for offline payments (bank transfer, cash). BUILDSASA STAFF ONLY.
// Never open this to customers: a workspace owner marking their own invoice paid
// would activate their subscription without paying.
app.post('/api/billing/invoices/:id/mark-paid', auth, async (req, res) => {
  try {
    if (!isPlatformAdmin(req.user.email)) {
      return res.status(403).json({ error: 'Not allowed. Pay the invoice to activate your workspace.' });
    }
    const inv = await prisma.billingInvoice.findUnique({ where: { id: req.params.id } });
    if (!inv || inv.userId !== req.user.sub) return res.status(404).json({ error: 'Invoice not found' });
    const paidInv = await prisma.billingInvoice.update({ where: { id: inv.id }, data: { status: 'paid', paidAt: new Date() } });
    // Email a receipt — recipient is the authed user, falling back to the invoice owner.
    let receiptEmail = req.user.email;
    if (!receiptEmail) {
      const owner = await prismaBase.user.findUnique({ where: { id: paidInv.userId } });
      receiptEmail = owner && owner.email;
    }
    if (receiptEmail) await emailInvoiceReceipt(paidInv, receiptEmail);
    const end = new Date(Date.now() + ((await planDays(inv.plan)) * 864e5));
    const sub = await prisma.subscription.findFirst({ where: {}, orderBy: { createdAt: 'desc' } });
    if (sub) await prisma.subscription.update({ where: { id: sub.id }, data: { status: 'active', currentPeriodEnd: end } });
    else await prisma.subscription.create({ data: { userId: req.user.sub, plan: inv.plan || 'standard-monthly', status: 'active', amountUSD: inv.amountUSD, currency: inv.currency, currentPeriodEnd: end } });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Start checkout. With no Paystack key it runs in DEMO mode so the UI still works.
app.post('/api/billing/checkout', auth, async (req, res) => {
  try {
    const userId = req.user.sub;
    // Comped accounts must never be able to start a charge — not even by hitting
    // this endpoint directly. Report it as already covered instead of erroring.
    if (hasFreeAccess(req.user?.email)) {
      return res.json({ comp: true, message: 'This account has free access — no payment is required.' });
    }
    const { planId, email, currency } = req.body;
    const plan = await planById(planId);
    if (!plan) return res.status(400).json({ error: 'Unknown plan' });
    const cur = currency === 'USD' ? 'USD' : 'KES';
    if (!PAYSTACK_SECRET) {
      return res.status(400).json({ error: 'Payments are not configured. Set PAYSTACK_SECRET_KEY in backend/.env.' });
    }
    const q = quotePlan(plan, await seatsFor(currentWs()));
    const amount = Math.round((cur === 'USD' ? q.usd : q.kes) * 100); // lowest unit, for the team's size
    const init = await paystackRequest('/transaction/initialize', 'POST', { email: email || req.user.email || 'owner@buildsasa.com', amount, currency: cur, callback_url: process.env.APP_URL || 'http://localhost:5173', metadata: { userId, planId: plan.id } });
    if (!init.status) return res.status(502).json({ error: init.message || 'Paystack init failed' });
    await prisma.subscription.create({ data: { userId, email: email || null, plan: plan.id, status: 'inactive', amountUSD: Math.round(q.usd), currency: cur, paystackRef: init.data.reference } });
    await issueInvoice(userId, plan.id, init.data.reference, { currency: cur });
    res.json({ authorizationUrl: init.data.authorization_url, reference: init.data.reference });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Verify a reference after the Paystack redirect and activate the subscription.
app.post('/api/billing/verify', auth, async (req, res) => {
  try {
    const { reference } = req.body;
    if (!PAYSTACK_SECRET) return res.status(400).json({ error: 'Paystack not configured' });
    const v = await paystackRequest(`/transaction/verify/${encodeURIComponent(reference)}`, 'GET');
    if (v.status && v.data && v.data.status === 'success') {
      const planId = v.data.metadata?.planId || 'standard-monthly';
      const end = new Date(Date.now() + (await planDays(planId)) * 864e5);
      await prisma.subscription.updateMany({ where: { paystackRef: reference }, data: { status: 'active', currentPeriodEnd: end } });
      // Capture which invoices we're about to mark paid so we can email receipts.
      const toPay = await prisma.billingInvoice.findMany({ where: { paystackRef: reference, status: 'unpaid' } });
      await prisma.billingInvoice.updateMany({ where: { paystackRef: reference, status: 'unpaid' }, data: { status: 'paid', paidAt: new Date() } });
      if (toPay.length) {
        // Recipient: the authed user, falling back to the invoice owner.
        let receiptEmail = req.user.email;
        if (!receiptEmail) {
          const owner = await prismaBase.user.findUnique({ where: { id: toPay[0].userId } });
          receiptEmail = owner && owner.email;
        }
        if (receiptEmail) for (const iv of toPay) await emailInvoiceReceipt({ ...iv, status: 'paid', paidAt: new Date() }, receiptEmail);
      }
      return res.json({ ok: true, status: 'active' });
    }
    res.json({ ok: false, status: v.data?.status || 'failed' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Client accounts, sharing with clients, client jobs and Buildsasa site reporting.
Object.assign(clientRouteDeps, { prisma, prismaBase, auth, currentWs, hasRole, CAN_SHARE_PORTAL, sendEmail, emailShell, button, paystackRequest, PAYSTACK_SECRET, isPlatformAdmin, portalPayload, companyPublic, APP_URL, freeAccessEmails: () => [...new Set([...FREE_ACCESS_EMAILS, ...PLATFORM_ADMIN_EMAILS, ...dbAdminEmails])] });
require('./client-routes')(app, clientRouteDeps);

// Paystack webhook — activates on charge.success. (Signature checked when key is set.)
app.post('/api/billing/webhook', async (req, res) => {
  try {
    if (PAYSTACK_SECRET) {
      const crypto = require('crypto');
      const hash = crypto.createHmac('sha512', PAYSTACK_SECRET).update(JSON.stringify(req.body)).digest('hex');
      if (hash !== req.headers['x-paystack-signature']) return res.status(401).end();
    }
    const evt = req.body;
    if (evt.event === 'charge.success' && evt.data && evt.data.metadata && evt.data.metadata.kind === 'site_reporting') {
      await clientRouteDeps.applyReportingPayment(evt.data);
      return res.json({ received: true });
    }
    if (evt.event === 'charge.success' && evt.data && evt.data.metadata && evt.data.metadata.kind === 'ai_credits') {
      await applyCreditPurchase(evt.data);
      return res.json({ received: true });
    }
    if (evt.event === 'charge.success' && evt.data && evt.data.reference) {
      const planId = (evt.data.metadata && evt.data.metadata.planId) || 'standard-monthly';
      const end = new Date(Date.now() + (await planDays(planId)) * 864e5);
      await prisma.subscription.updateMany({ where: { paystackRef: evt.data.reference }, data: { status: 'active', currentPeriodEnd: end } });
      // Capture invoices being paid so we can email receipts (no auth context here).
      const toPay = await prisma.billingInvoice.findMany({ where: { paystackRef: evt.data.reference, status: 'unpaid' } });
      await prisma.billingInvoice.updateMany({ where: { paystackRef: evt.data.reference, status: 'unpaid' }, data: { status: 'paid', paidAt: new Date() } });
      for (const iv of toPay) {
        const owner = await prismaBase.user.findUnique({ where: { id: iv.userId } });
        if (owner && owner.email) await emailInvoiceReceipt({ ...iv, status: 'paid', paidAt: new Date() }, owner.email);
      }
    }
    res.json({ received: true });
  } catch (e) { res.status(200).json({ received: true }); }
});

server.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);
  console.log(`WebSocket running on ws://localhost:${PORT}/ws`);
  console.log(`AI extraction: OpenAI=${!!openai}, DeepSeek=${!!DEEPSEEK_API_KEY}`);
});
