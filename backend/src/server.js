require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const AWS = require('aws-sdk');
const http = require('http');
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
  'Observation', 'CoordinationIssue', 'ActionPlan', 'Correspondence', 'WorkTask', 'ScheduleItem', 'Crew',
  'DirectoryContact', 'CompanyDoc', 'Announcement', 'FormTemplate', 'Conversation',
  'PaymentApplication', 'RetentionRecord', 'CostCode', 'Approval',
  'InventoryItem', 'InventoryMovement',
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
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 100);
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
function auth(req, res, next) {
  // Run the rest of the request inside the workspace context so the Prisma
  // engine scopes every query to this user's company.
  const run = () => wsStore.run({ ws: (req.user && req.user.ws) || null }, next);
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

const publicUser = (u) => ({ id: u.id, name: u.name, role: u.role, email: u.email, platformAdmin: isPlatformAdmin(u.email), freeAccess: hasFreeAccess(u.email) });

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
    const token = issueToken(user);
    const refreshToken = issueRefreshToken(user);
    const userParam = encodeURIComponent(JSON.stringify(publicUser(user)));
    res.redirect(`${FRONTEND_URL}/?token=${encodeURIComponent(token)}&refresh=${encodeURIComponent(refreshToken)}&user=${userParam}`);
  } catch (e) {
    console.error('[google oauth] failed:', e.message);
    res.redirect(`${FRONTEND_URL}/?auth_error=google`);
  }
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
    return { sent: false };
  }
  try {
    const payload = { from: EMAIL_FROM, to: [to], subject, html };
    if (attachments && attachments.length) payload.attachments = attachments;
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!r.ok) { const t = await r.text(); console.error('[EMAIL] Resend failed:', r.status, t); return { sent: false, error: t }; }
    return { sent: true };
  } catch (e) {
    console.error('[EMAIL] send error:', e && e.message);
    return { sent: false, error: e && e.message };
  }
}

// Tiny on-brand email wrapper.
function emailShell(title, bodyHtml) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#11161D">
    <div style="font-size:18px;font-weight:600;color:#FF6B1A">Buildsasa</div>
    <h2 style="font-size:18px;margin:16px 0 8px">${title}</h2>
    ${bodyHtml}
    <p style="font-size:12px;color:#8A95A5;margin-top:24px">If you didn't expect this email, you can safely ignore it.</p>
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
    const { name, email, password, role, company } = req.body || {};
    if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required' });
    if (String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    const existing = await prisma.user.findUnique({ where: { email: String(email).toLowerCase() } });
    if (existing) return res.status(409).json({ error: 'An account with this email already exists' });
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
           <p style="font-size:12px;color:#8A95A5">Or paste this link into your browser:<br/>${link}</p>`);
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
  try { res.json(await prisma.user.findMany({ select: { id: true, name: true, email: true, role: true, trade: true, createdAt: true }, orderBy: { createdAt: 'asc' } })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/users/invite', auth, async (req, res) => {
  try {
    const { name, email, role, trade, password } = req.body || {};
    if (!name || !email || !role) return res.status(400).json({ error: 'Name, email and role are required' });
    const em = String(email).toLowerCase();
    if (await prisma.user.findUnique({ where: { email: em } })) return res.status(409).json({ error: 'A user with this email already exists' });
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
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/users/:id/role', auth, async (req, res) => {
  try { const u = await prisma.user.update({ where: { id: req.params.id }, data: { role: req.body.role } }); res.json({ id: u.id, role: u.role }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/users/:id', auth, async (req, res) => {
  try { await prisma.user.delete({ where: { id: req.params.id } }); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
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
    const { code, name, city, lat, lng, value, status, progress, exposure, description, images, startDate, targetEndDate } = req.body;
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Project name is required' });
    const data = {
      code, name, city: city || '—', value: value || '', status: status || 'Planning',
      progress: Number(progress) || 0, exposure, description: description || null,
      images: serializeImages(images),
    };
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
    const { code, name, city, lat, lng, value, status, progress, exposure, description, images, startDate, targetEndDate } = req.body;
    // Only assign what the caller actually sent. A blanket assignment wiped
    // fields that were merely absent from a partial update.
    const data = {};
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
    const { date, crew, crewId, headcount, location, notes, weather } = req.body;
    if (!crew || !String(crew).trim()) return res.status(400).json({ error: 'Pick a crew for this log' });
    // An absent/invalid date used to become `Invalid Date` and be rejected by
    // Postgres with an opaque error; default to today instead.
    const when = date ? new Date(date) : new Date();
    const row = await prisma.dailyLog.create({
      data: {
        date: isNaN(when.getTime()) ? new Date() : when,
        crew, crewId: crewId || null, headcount: Number(headcount) || 0,
        location: location || '', notes: notes || '', weather: weather || null,
        projectId: req.params.projectId,
      },
    });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/projects/:projectId/daily-log/:id', auth, async (req, res) => {
  try {
    const { date, crew, crewId, headcount, location, notes, weather } = req.body;
    const data = {};
    if (date !== undefined) { const w = new Date(date); if (!isNaN(w.getTime())) data.date = w; }
    for (const [k, v] of Object.entries({ crew, crewId, location, notes, weather })) {
      if (v !== undefined) data[k] = v;
    }
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
const CO_FIELDS = ['number', 'title', 'area', 'description', 'status', 'trigger', 'rfi', 'costUSD', 'scheduleImpactDays', 'requestedBy', 'submittedDate', 'projectId'];
// Who may create/edit a change order, and who may approve/reject one. Mirrors
// the role permissions used in the UI (createCO / approveAny).
const CAN_CREATE_CO = ['Contractor', 'Quantity Surveyor', 'Executive', 'Project Manager', 'Superintendent', 'Trade Lead'];
const CAN_APPROVE_CO = ['Contractor', 'Owner', 'Executive', 'Project Manager'];
const hasRole = (req, list) => !!(req.user && list.includes(req.user.role));
const pickCO = (body) => {
  const d = {};
  for (const f of CO_FIELDS) if (body[f] !== undefined) d[f] = body[f];
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
const PA_FIELDS = ['commitmentId', 'number', 'period', 'periodStart', 'periodEnd', 'workCompletedThisPeriod', 'previousCertified', 'requestedAmount', 'retentionPct', 'costCodeId', 'comments'];
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
    const held = Number(existing.amountHeld) || 0;
    const releaseAmount = req.body?.amount !== undefined ? (num(req.body.amount) || 0) : held - (Number(existing.amountReleased) || 0);
    const amountReleased = (Number(existing.amountReleased) || 0) + releaseAmount;
    const remaining = Math.max(0, held - amountReleased);
    const row = await prisma.retentionRecord.update({
      where: { id: req.params.id },
      data: { amountReleased, remaining, status: remaining <= 0 ? 'released' : 'held', releaseDate: new Date() },
    });
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
app.get('/api/documents', auth, async (_req, res) => {
  try {
    const rows = await prisma.document.findMany({ orderBy: { updatedAt: 'desc' } });
    res.json(rows || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/documents', auth, async (req, res) => {
  try {
    const { name, url, size, updated, projectId } = req.body;
    const row = await prisma.document.create({ data: { name, url, size, updated, projectId } });
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
async function storeUploadedFile(req, file) {
  const fs = require('fs');
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
const INVENTORY_FIELDS = ['projectId', 'name', 'category', 'unit', 'reorderLevel', 'unitCostKES', 'supplier', 'location', 'notes', 'status', 'sku', 'minLevel', 'maxLevel', 'reorderQty', 'leadTimeDays', 'supplierContact'];
const INVENTORY_NUMERIC_FIELDS = ['reorderLevel', 'unitCostKES', 'minLevel', 'maxLevel', 'reorderQty', 'leadTimeDays'];
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

// Record a movement and apply the stock logic to the item's cached currentStock:
//   in     -> currentStock += quantity
//   out    -> currentStock -= quantity (may go to/below 0; UI flags negatives)
//   adjust -> currentStock = quantity (a correction sets the absolute value)
app.post('/api/inventory/:id/movements', auth, requireRole(CAN_MANAGE_INVENTORY), async (req, res) => {
  try {
    const { type, quantity, reference, notes, date } = req.body || {};
    if (!['in', 'out', 'adjust'].includes(type)) return res.status(400).json({ error: 'type must be in | out | adjust' });
    const qty = Number(quantity);
    if (!Number.isFinite(qty)) return res.status(400).json({ error: 'quantity must be a number' });
    const item = await prisma.inventoryItem.findUnique({ where: { id: req.params.id } });
    if (!item) return res.status(404).json({ error: 'Not found' });
    let newStock;
    if (type === 'in') newStock = item.currentStock + qty;
    else if (type === 'out') newStock = item.currentStock - qty;
    else newStock = qty; // adjust = absolute correction
    const movement = await prisma.inventoryMovement.create({ data: {
      itemId: item.id,
      type,
      quantity: qty,
      balanceAfter: newStock,
      date: date ? new Date(date) : undefined,
      reference: reference || null,
      notes: notes || null,
      actorId: (req.user && req.user.sub) || null,
      actorName: (req.user && req.user.name) || null,
    } });
    const updated = await prisma.inventoryItem.update({ where: { id: item.id }, data: { currentStock: newStock } });
    res.json({ movement, item: updated });
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
    const { userIds } = req.body;
    if (!Array.isArray(userIds) || userIds.length === 0) return res.status(400).json({ error: 'userIds array required' });
    const row = await prisma.checklist.update({
      where: { id: req.params.id },
      data: { assigned: true, assignedTo: JSON.stringify(userIds), status: 'assigned' },
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
app.get('/api/conversations', auth, async (req, res) => {
  try {
    const userId = req.user.id;
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
    const userId = req.user.id;
    const row = await prisma.conversation.create({
      data: {
        name: name || undefined,
        type: type || 'group',
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
    const userId = req.user.id;
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
      where: { conversationId: req.params.id, userId: { not: req.user.id }, read: false },
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
    const { drawingId, type, x, y, text, color, createdBy } = req.body;
    const row = await prisma.planMarkup.create({ data: { drawingId, type, x, y, text, color, createdBy, projectId: req.params.projectId } });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/projects/:projectId/markups/:id', auth, async (req, res) => {
  try {
    const { x, y, text, color, type } = req.body;
    const data = {};
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
const SUPPORT_WHATSAPP = process.env.SUPPORT_WHATSAPP || '+254769041607';
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'hello@buildsasa.com';
const SHEMMY_SYSTEM_PROMPT = `You are Shemmy, the friendly customer-support assistant for Buildsasa — a construction project-management software built for contractors, project managers and site teams in Kenya and East Africa (currency KES, payments via Paystack/M-Pesa). Help users understand and use the product, troubleshoot, and answer billing/account questions. Be warm, concise, and practical; use simple language; sentence case. Buildsasa's features include: Dashboard with AI insights; Projects; Change Orders with an approval pipeline; Checklists & digitized forms; Tasks & Trades; Schedule (Gantt, dates, milestones); Daily Log; Punch List; Plans & Drawings; Inspections; Safety Incidents; Observations; Action Plans; Coordination Issues; Financials (cash flow ledger, budget vs actual, commitments/payables, payment applications/progress claims with retention, cost codes); Invoicing (line-item invoices with PDF download + emailed receipts); Bidding/Tendering (post bid packages, share a public bid link, receive and award bids); Inventory (materials with a stock-movement ledger plus an equipment register with hire/service/compliance tracking); Documents; Directory; Crews; Team & Role Manager; Attendance; Reports; and a Buildsasa AI assistant. Billing is per company (workspace) — new companies see a paywall until they choose a plan; plans are paid in KES via Paystack. When a question needs account-specific action you can't do (refunds, data changes, bugs), tell them to contact our team on WhatsApp at ${SUPPORT_WHATSAPP} or by email at ${SUPPORT_EMAIL}, or use the in-app billing page. Never invent features that aren't listed; if unsure, say so and offer to connect them to the team. Keep answers short unless asked for detail.`;

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

app.post('/api/ai/generate-checklist', auth, async (req, res) => {
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
app.post('/api/ai/build-checklist', auth, async (req, res) => {
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

app.post('/api/ai/assistant', auth, async (req, res) => {
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

app.post('/api/ai/extract-checklist-from-document', auth, singleFile('file'), async (req, res) => {
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
crudRoutes('work-tasks', 'workTask',
  ['title', 'description', 'trade', 'assignees', 'priority', 'status', 'dueDate', 'projectId', 'createdById'], ['assignees']);
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
  { id: 'standard-monthly', name: 'Buildsasa Standard — Monthly', cycle: 'monthly', usd: 250, kes: Math.round(250 * USD_TO_KES), days: 30, note: 'Billed every month. Cancel anytime.' },
  { id: 'standard-yearly', name: 'Buildsasa Standard — Yearly', cycle: 'yearly', usd: 2500, kes: Math.round(2500 * USD_TO_KES), days: 365, note: 'Billed once a year — save $500 (2 months free).' },
];

// Map a SubscriptionPackage row to the plan shape the SaaS pricing screen and
// checkout expect. `kes` is derived here so it always tracks the current rate.
function planShape(row) {
  let features;
  if (row.features) { try { features = JSON.parse(row.features); } catch { /* ignore bad JSON */ } }
  return { id: row.id, name: row.name, cycle: row.cycle, usd: row.usd, kes: Math.round((row.usd || 0) * USD_TO_KES), days: row.days, note: row.note || undefined, features };
}

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

app.get('/api/billing/subscription', auth, async (req, res) => {
  try {
    // Comped accounts (FREE_ACCESS_EMAILS) always report an active subscription
    // so the paywall never engages — they use the product for free.
    if (hasFreeAccess(req.user?.email)) {
      return res.json({ status: 'active', plan: 'comp', comp: true, currentPeriodEnd: new Date(Date.now() + 3650 * 864e5) });
    }
    const sub = await prisma.subscription.findFirst({ where: {}, orderBy: { createdAt: 'desc' } });
    res.json(sub || { status: 'inactive' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- Service invoices (auto-issued from the plan; paid via Paystack or marked manually) ----
function nextInvoiceNumber() { return 'INV-' + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 900 + 100); }
async function issueInvoice(userId, planId, ref, opts = {}) {
  const p = (await planById(planId)) || (await loadPlans())[0] || { id: planId, usd: 0, kes: 0, name: 'Subscription' };
  const dueDays = opts.dueDays == null ? 7 : opts.dueDays;
  return prisma.billingInvoice.create({ data: {
    userId,
    number: nextInvoiceNumber(),
    plan: p.id || null,
    description: opts.description || `${(p.name || p.id || 'Subscription')} subscription`,
    amountUSD: p.usd || 0,
    amountKES: p.kes || 0,
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
    if (hasFreeAccess(req.user?.email)) return res.json([]);
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
    const amount = Math.round((cur === 'USD' ? plan.usd : plan.kes) * 100); // lowest unit
    const init = await paystackRequest('/transaction/initialize', 'POST', { email: email || req.user.email || 'owner@buildsasa.com', amount, currency: cur, callback_url: process.env.APP_URL || 'http://localhost:5173', metadata: { userId, planId: plan.id } });
    if (!init.status) return res.status(502).json({ error: init.message || 'Paystack init failed' });
    await prisma.subscription.create({ data: { userId, email: email || null, plan: plan.id, status: 'inactive', amountUSD: plan.usd, currency: cur, paystackRef: init.data.reference } });
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

// Paystack webhook — activates on charge.success. (Signature checked when key is set.)
app.post('/api/billing/webhook', async (req, res) => {
  try {
    if (PAYSTACK_SECRET) {
      const crypto = require('crypto');
      const hash = crypto.createHmac('sha512', PAYSTACK_SECRET).update(JSON.stringify(req.body)).digest('hex');
      if (hash !== req.headers['x-paystack-signature']) return res.status(401).end();
    }
    const evt = req.body;
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
