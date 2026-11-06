// ============================================================
// cloud.mjs — 书阁服务端公共层（Upstash / 身份 / CORS / 响应）
// ------------------------------------------------------------
// 被 api/works.js、api/collections.js、api/publish.js、api/content.js 共用。
//
// 存储：Upstash Redis REST。大 value 必须走 POST body（GET 形式会把
//       整个值塞进 URL，几百 KB 直接被中间层拒掉）。
// 身份：只有群档案 GitHub Cookie github_token → 问 api.github.com/user
//       （2026-11 起邮箱账号已停用，不再有 Bearer/sess: 通道）
// ============================================================

export const ALLOWED_ORIGINS = [
  'https://book.blacknet.cc.cd',
  'https://grp.blacknet.cc.cd',
  'http://localhost:8123',
  'http://127.0.0.1:8123',
];

export function makeStore(env) {
  const base = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL || env.KV_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  if (!base || !token) return null;

  const call = async (args) => {
    const r = await fetch(base, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
    });
    const j = await r.json().catch(() => ({}));
    if (j && j.error) throw new Error(j.error);
    return j ? j.result : null;
  };

  return {
    cmd: call,
    get: (k) => call(['GET', k]),
    set: (k, v) => call(['SET', k, v]),
    del: (k) => call(['DEL', k]),
    mget: (...keys) => call(['MGET', ...keys]),
  };
}

export function readCookie(header, name) {
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}

/** Cookie 里的 GitHub 令牌（发布回退通道用；没有则空串） */
export function ghToken(req) {
  return readCookie(req.headers && req.headers['cookie'], 'github_token');
}

/** 解析身份 → {uid, provider, login, name, avatar} 或 null（仅 GitHub Cookie） */
export async function identify(req, store) {
  const tok = ghToken(req);
  if (tok) {
    const r = await fetch('https://api.github.com/user', {
      headers: { Authorization: 'Bearer ' + tok, 'User-Agent': 'BookBlackNet-Cloud' },
    });
    if (r.ok) {
      const u = await r.json();
      if (u && u.login) {
        return {
          uid: 'gh:' + String(u.login).toLowerCase(),
          provider: 'github',
          login: u.login,
          name: u.name || u.login,
          avatar: u.avatar_url || '',
        };
      }
    }
  }
  return null;
}

export function cors(req, res) {
  const origin = (req.headers && req.headers.origin) || '';
  if (ALLOWED_ORIGINS.indexOf(origin) >= 0) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Cache-Control', 'no-store');
}

export function sendJSON(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(obj));
}

export async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (e) { return null; }
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const txt = Buffer.concat(chunks).toString('utf8');
  if (!txt) return null;
  try { return JSON.parse(txt); } catch (e) { return null; }
}

export function jsonGet(raw, fallback) {
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch (e) { return fallback; }
}

/** 统一的「存储未配置」响应 */
export function noStore(res) {
  sendJSON(res, 500, {
    error: '存储未配置：请在 Vercel 项目里创建 Upstash Redis（Environment Variables 需要 UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN）',
  });
}
