// ============================================================
// auth-core.mjs — 邮箱注册/登录核心逻辑（与存储解耦，便于单测）
// 存储（store）约定三个方法：
//   get(key)  → 字符串或 null
//   put(key, value)
//   delete(key)
// ============================================================

const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const b64decode = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function hashPassword(password, saltBuf) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: saltBuf, iterations: 100000, hash: 'SHA-256' }, key, 256);
  return b64(bits);
}

function randToken() {
  return b64(crypto.getRandomValues(new Uint8Array(32)));
}

async function verifyPassword(password, saltB64, hashB64) {
  const h = await hashPassword(password, b64decode(saltB64).buffer);
  const a = new TextEncoder().encode(h), b = new TextEncoder().encode(hashB64);
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length && i < b.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

const userKey = email => 'user:' + email.toLowerCase();
const sessKey = token => 'sess:' + token;
const SESSION_TTL = 30 * 86400e3;

function publicUser(u) {
  return { email: u.email, name: u.name, createdAt: u.createdAt, provider: 'email' };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    },
  });
}

/** 解析 Bearer 令牌 */
function bearer(request) {
  const auth = request.headers.get('Authorization') || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : '';
}

/**
 * 主入口：传入 Request 与 store，返回 Response。
 * 路由: POST /register /login /logout, GET /me, OPTIONS *
 */
export async function handleAuth(request, store) {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  const url = new URL(request.url);
  const path = '/' + (url.pathname.replace(/\/+$/, '').split('/').pop() || '');

  try {
    // ---------- 注册 ----------
    if (path === '/register' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      const name = String(body.name || '').trim().slice(0, 30) || email.split('@')[0];
      if (!EMAIL_RE.test(email)) return json({ error: '邮箱格式不正确' }, 400);
      if (password.length < 8) return json({ error: '口令至少 8 位' }, 400);

      if (await store.get(userKey(email))) return json({ error: '该邮箱已注册，请直接登录' }, 409);

      const salt = crypto.getRandomValues(new Uint8Array(16));
      const user = {
        email, name,
        salt: b64(salt.buffer),
        hash: await hashPassword(password, salt.buffer),
        createdAt: new Date().toISOString(),
      };
      await store.put(userKey(email), JSON.stringify(user));

      const token = randToken();
      await store.put(sessKey(token), JSON.stringify({ email, name, exp: Date.now() + SESSION_TTL }));
      return json({ token, user: publicUser(user) });
    }

    // ---------- 登录 ----------
    if (path === '/login' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      const raw = await store.get(userKey(email));
      const user = raw ? JSON.parse(raw) : null;
      if (!user || !(await verifyPassword(password, user.salt, user.hash))) {
        return json({ error: '邮箱或口令不正确' }, 401);
      }
      const token = randToken();
      await store.put(sessKey(token), JSON.stringify({ email, name: user.name, exp: Date.now() + SESSION_TTL }));
      return json({ token, user: publicUser(user) });
    }

    // ---------- 当前用户 ----------
    if (path === '/me' && request.method === 'GET') {
      const token = bearer(request);
      const raw = token ? await store.get(sessKey(token)) : null;
      const sess = raw ? JSON.parse(raw) : null;
      if (!sess || sess.exp < Date.now()) return json({ error: '未登录' }, 401);
      return json({ user: { email: sess.email, name: sess.name, provider: 'email' } });
    }

    // ---------- 登出 ----------
    if (path === '/logout' && request.method === 'POST') {
      const token = bearer(request);
      if (token && (await store.get(sessKey(token)))) await store.delete(sessKey(token));
      return json({ ok: true });
    }

    return json({ error: 'Not found' }, 404);
  } catch (e) {
    return json({ error: '服务器错误', detail: String(e && e.message || e) }, 500);
  }
}
