import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const base = 'http://localhost:4000';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cookies = new Map();

function storeCookies(res) {
  const raw = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  for (const c of raw) {
    const part = c.split(';')[0];
    const eq = part.indexOf('=');
    if (eq > 0) cookies.set(part.slice(0, eq), part.slice(eq + 1));
  }
  // Fallback single set-cookie
  const single = res.headers.get('set-cookie');
  if (single && raw.length === 0) {
    const part = single.split(';')[0];
    const eq = part.indexOf('=');
    if (eq > 0) cookies.set(part.slice(0, eq), part.slice(eq + 1));
  }
}

function cookieHeader() {
  return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

async function req(method, urlPath, { body, formData } = {}) {
  const headers = {};
  const ch = cookieHeader();
  if (ch) headers.Cookie = ch;
  let payload = undefined;
  if (formData) {
    payload = formData;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${base}${urlPath}`, { method, headers, body: payload });
  storeCookies(res);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

const results = [];
function ok(name, cond, detail) {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

try {
  const health = await req('GET', '/api/health');
  ok('health', health.data?.ok === true);

  const login = await req('POST', '/api/auth/login', {
    body: { username: 'admin', password: 'changeme' },
  });
  ok('login', login.status === 200 && login.data?.ok, JSON.stringify(login.data));
  ok('cookie', cookies.has('connect.sid'), [...cookies.keys()].join(','));

  const me = await req('GET', '/api/auth/me');
  ok('me', me.status === 200 && me.data?.user?.username === 'admin', JSON.stringify(me.data));

  const fd = new FormData();
  fd.append(
    'file',
    new Blob(
      [
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
          'base64'
        ),
      ],
      { type: 'image/png' }
    ),
    'test.png'
  );
  const upload = await req('POST', '/api/media/upload', { formData: fd });
  ok('upload', upload.status === 201 && upload.data?.media?.id, JSON.stringify(upload.data));
  const mediaId = upload.data?.media?.id;

  const pub = await req('POST', '/api/admin/publish', { body: { mediaId } });
  ok('publish', pub.status === 200 && pub.data?.version >= 1, JSON.stringify(pub.data));

  const current = await req('GET', '/api/screen/current');
  ok(
    'current',
    current.data?.version >= 1 && String(current.data?.url || '').includes('/uploads/'),
    JSON.stringify(current.data)
  );

  const pair = await req('POST', '/api/devices/pairing-code', { body: {} });
  ok('pairing-code', !!pair.data?.pairingCode, JSON.stringify(pair.data));

  const reg = await req('POST', '/api/devices/register', {
    body: { pairingCode: pair.data?.pairingCode, name: 'Main Store TV' },
  });
  ok('register', !!reg.data?.device?.deviceId, JSON.stringify(reg.data));

  const hb = await req('POST', '/api/screen/heartbeat', {
    body: {
      deviceId: reg.data?.device?.deviceId,
      currentVersion: current.data?.version || 1,
      appVersion: '1.0.0',
    },
  });
  ok('heartbeat', hb.data?.ok === true, JSON.stringify(hb.data));

  const status = await req('GET', '/api/admin/status');
  ok('status-online', status.data?.screens?.online >= 1, JSON.stringify(status.data?.screens));

  const badFd = new FormData();
  badFd.append('file', new Blob(['not-an-image'], { type: 'text/plain' }), 'bad.txt');
  const bad = await req('POST', '/api/media/upload', { formData: badFd });
  ok('reject-bad', bad.status >= 400, JSON.stringify(bad.data));
} catch (err) {
  console.error(err);
  process.exit(1);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
