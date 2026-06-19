#!/usr/bin/env node
/* ===========================================================================
 * Buildflex API smoke test
 * ---------------------------------------------------------------------------
 * Runs the invite -> forgot -> reset -> login flow against a LIVE backend.
 * No extra dependencies — uses Node's built-in fetch (Node 18+).
 *
 * Usage (from the backend folder, with the backend running):
 *     node smoke-test.js
 *     node smoke-test.js http://localhost:5000        # custom URL
 *     API_URL=https://api.yourdomain.com node smoke-test.js
 *
 * It creates a throwaway user, exercises every endpoint, then deletes it.
 * Exit code 0 = all good, 1 = something failed.
 *
 * Note: the password-reset steps rely on the backend returning a "devLink"
 * (which it only does when RESEND_API_KEY is blank). If you've configured a
 * real email key, those steps are skipped with a notice — check the inbox
 * instead.
 * ======================================================================== */

const BASE = process.argv[2] || process.env.API_URL || 'http://localhost:5000';
const stamp = Date.now();
const TEST_EMAIL = `smoketest+${stamp}@example.com`;
const TEST_NAME = 'Smoke Test User';
const TEST_ROLE = 'Site Engineer';

let passed = 0, failed = 0, skipped = 0;
const ok = (m) => { passed++; console.log(`  \x1b[32mPASS\x1b[0m ${m}`); };
const bad = (m, detail) => { failed++; console.log(`  \x1b[31mFAIL\x1b[0m ${m}${detail ? `\n       ↳ ${detail}` : ''}`); };
const skip = (m) => { skipped++; console.log(`  \x1b[33mSKIP\x1b[0m ${m}`); };

async function call(method, path, body, token) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let data = null;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, ok: res.ok, data };
}

function tokenFromResetLink(link) {
  try { return new URL(link).searchParams.get('reset'); }
  catch { const m = /[?&]reset=([^&]+)/.exec(link || ''); return m ? decodeURIComponent(m[1]) : null; }
}

(async () => {
  console.log(`\nBuildflex API smoke test → ${BASE}\n`);

  // 0) Health
  try {
    const h = await call('GET', '/api/health');
    h.ok && h.data?.status === 'ok' ? ok('backend is up (/api/health)')
      : bad('health check', `status ${h.status}`);
  } catch (e) {
    bad('cannot reach backend', e.message);
    console.log('\nIs the backend running? Start it with `npm start` in the backend folder.\n');
    process.exit(1);
  }

  // 1) Owner session (demo account; fall back to a fresh signup)
  let ownerToken = null;
  let login = await call('POST', '/api/login', { email: 'manager@example.com', password: 'password' });
  if (login.ok && login.data?.token) {
    ownerToken = login.data.token;
    ok('owner login (demo account)');
  } else {
    const su = await call('POST', '/api/signup', { name: 'Smoke Owner', email: `owner+${stamp}@example.com`, password: 'password', role: 'Contractor' });
    if (su.ok && su.data?.token) { ownerToken = su.data.token; ok('owner signup (demo login unavailable)'); }
    else bad('could not establish an owner session', JSON.stringify(su.data));
  }

  // 2) Invite a member
  let tempPassword = null, emailed = false, memberId = null;
  const inv = await call('POST', '/api/users/invite', { name: TEST_NAME, email: TEST_EMAIL, role: TEST_ROLE }, ownerToken);
  if (inv.ok && inv.data?.user?.id) {
    memberId = inv.data.user.id;
    emailed = !!inv.data.emailed;
    tempPassword = inv.data.tempPassword || null;
    ok(`invite created (${inv.data.user.email}, role ${inv.data.user.role})`);
    emailed ? ok('invite reported as emailed (email key configured)')
            : (tempPassword ? ok('temp password returned (email not configured — dev mode)')
                            : bad('no temp password and not emailed — member could not sign in'));
  } else {
    bad('invite member', `status ${inv.status}: ${JSON.stringify(inv.data)}`);
  }

  // 3) Member logs in with the temp password (only possible in dev mode)
  if (tempPassword) {
    const ml = await call('POST', '/api/login', { email: TEST_EMAIL, password: tempPassword });
    ml.ok && ml.data?.token ? ok('member can log in with temp password')
      : bad('member login with temp password', `status ${ml.status}`);
  } else if (emailed) {
    skip('member temp-password login (password was emailed, not returned)');
  }

  // 4) Forgot password → get reset token from devLink
  let resetToken = null;
  const fp = await call('POST', '/api/auth/forgot', { email: TEST_EMAIL });
  if (fp.ok && fp.data?.ok) {
    ok('forgot-password request accepted');
    if (fp.data.devLink) { resetToken = tokenFromResetLink(fp.data.devLink); resetToken ? ok('reset link returned (dev mode)') : bad('reset link present but token unparseable', fp.data.devLink); }
    else skip('reset link not returned (email key set — check the inbox)');
  } else {
    bad('forgot-password request', `status ${fp.status}`);
  }

  // 4b) forgot for an unknown email should STILL return ok (no account enumeration)
  const fpUnknown = await call('POST', '/api/auth/forgot', { email: `nobody+${stamp}@example.com` });
  fpUnknown.ok && fpUnknown.data?.ok && !fpUnknown.data?.devLink
    ? ok('forgot-password does not leak whether an unknown email exists')
    : bad('account-enumeration guard', JSON.stringify(fpUnknown.data));

  // 5) Reset the password using the token
  const NEW_PW = 'brandNewPw123';
  if (resetToken) {
    const rp = await call('POST', '/api/auth/reset', { token: resetToken, password: NEW_PW });
    rp.ok && rp.data?.ok ? ok('password reset succeeded')
      : bad('password reset', `status ${rp.status}: ${JSON.stringify(rp.data)}`);

    // bad token rejected
    const rpBad = await call('POST', '/api/auth/reset', { token: resetToken + 'x', password: NEW_PW });
    rpBad.status === 400 ? ok('tampered reset token rejected (400)') : bad('tampered token should be 400', `got ${rpBad.status}`);

    // 6) Login with the NEW password works
    const nl = await call('POST', '/api/login', { email: TEST_EMAIL, password: NEW_PW });
    nl.ok && nl.data?.token ? ok('member can log in with the NEW password')
      : bad('login with new password', `status ${nl.status}`);

    // 7) Login with the OLD temp password fails
    if (tempPassword) {
      const ol = await call('POST', '/api/login', { email: TEST_EMAIL, password: tempPassword });
      ol.status === 401 ? ok('old temp password no longer works (401)') : bad('old password should be rejected', `got ${ol.status}`);
    }
  } else {
    skip('password reset + post-reset login (no reset token available)');
  }

  // 8) Cleanup — remove the throwaway member
  if (memberId) {
    const del = await call('DELETE', `/api/users/${memberId}`, null, ownerToken);
    del.ok ? ok('cleanup: test member deleted') : bad('cleanup: delete test member', `status ${del.status}`);
  }

  // Summary
  console.log(`\n${'─'.repeat(48)}`);
  console.log(`  ${passed} passed · ${failed} failed · ${skipped} skipped`);
  console.log(`${'─'.repeat(48)}\n`);
  process.exit(failed ? 1 : 0);
})();
