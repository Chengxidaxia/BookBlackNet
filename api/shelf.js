// ============================================================
// shelf.js — Vercel Function：账号书架（收藏 + 阅读进度）云端存储
// 路由：GET /api/shelf   → { ok, shelf }
//       POST /api/shelf  → { ok }
//
// 身份（二者其一）：
//   ① 邮箱账号：Authorization: Bearer <bbn.email.token>
//      会话查 Upstash 的 sess:<token>（与 /api/auth 共用同一份数据）
//   ② 群档案 GitHub 会话：Cookie github_token（Domain=.blacknet.cc.cd）
//      服务端拿它问 api.github.com/user，取 login 作为身份
//
// 存储：Upstash Redis（与 auth 同一套环境变量），键 bshelf:<uid>。
// 单用户上限 512KB —— 书架只是「id + 标题 + 封面 + 进度」，远小于此。
// 隐私：只存书籍编号与进度，不存正文。
// ============================================================

const MAX_BYTES = 512 * 1024;
const ALLOWED_ORIGINS = [
  'https://book.blacknet.cc.cd',
  'https://grp.blacknet.cc.cd',
  'http://localhost:8123',
  'http://127.0.0.1:8123',
];

function makeStore(env) {
  const base = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL || env.KV_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN || env.KV_REST_API_READ_ONLY_TOKEN;
  if (!base || !token) return null;
  const cmd = async (...args) => {
    const r = await fetch(base + '/' + args.map((a) => encodeURIComponent(a)).join('/'), {
      headers: { Authorization: 'Bearer ' + token },
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    return j.result;
  };
  return {
    get: (k) => cmd('get', k),
    set: (k, v) => cmd('set', k, v),
  };
}

function readCookie(header, name) {
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}

/** 解析身份 → 'email:xx@yy' / 'gh:login' / '' */
async function identify(req, store) {
  const auth = req.headers['authorization'] || '';
  if (auth.startsWith('Bearer ')) {
    const raw = await store.get('sess:' + auth.slice(7));
    if (raw) {
      try {
        const sess = JSON.parse(raw);
        if (sess && sess.email && (!sess.exp || sess.exp > Date.now())) return 'email:' + String(sess.email).toLowerCase();
      } catch (e) { /* 会话损坏当作未登录 */ }
    }
  }
  const gh = readCookie(req.headers['cookie'], 'github_token');
  if (gh) {
    const r = await fetch('https://api.github.com/user', {
      headers: { Authorization: 'Bearer ' + gh, 'User-Agent': 'BookBlackNet-Shelf' },
    });
    if (r.ok) {
      const u = await r.json();
      if (u && u.login) return 'gh:' + String(u.login).toLowerCase();
    }
  }
  return '';
}

function cors(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.indexOf(origin) >= 0) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Cache-Control', 'no-store');
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const txt = Buffer.concat(chunks).toString('utf8');
  if (!txt) return null;
  try { return JSON.parse(txt); } catch (e) { return null; }
}

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }

  try {
    const store = makeStore(process.env);
    if (!store) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(JSON.stringify({ error: '存储未配置：请在 Vercel 面板创建 Upstash Redis 并 Connect 本项目' }));
    }

    const uid = await identify(req, store);
    if (!uid) {
      res.statusCode = 401;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(JSON.stringify({ error: '未登录：书架只在登录后同步，本机数据不受影响' }));
    }

    const key = 'bshelf:' + uid;

    if (req.method === 'GET') {
      const raw = await store.get(key);
      let shelf = null;
      if (raw) { try { shelf = JSON.parse(raw); } catch (e) { shelf = null; } }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(JSON.stringify({ ok: true, shelf }));
    }

    if (req.method === 'POST') {
      const body = await readBody(req);
      if (!body || typeof body !== 'object') {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: '请求体不是有效 JSON' }));
      }
      const fav = Array.isArray(body.fav) ? body.fav.slice(0, 200) : [];
      const progress = body.progress && typeof body.progress === 'object' ? body.progress : {};
      const clean = {
        format: 'bookblacknet.shelf',
        v: 1,
        at: new Date().toISOString(),
        fav: fav.map((x) => ({
          id: String(x.id || '').slice(0, 80),
          title: String(x.title || '').slice(0, 120),
          author: String(x.author || '').slice(0, 60),
          cover: x.cover && typeof x.cover === 'object' ? x.cover : null,
          at: String(x.at || '').slice(0, 40),
        })).filter((x) => x.id),
        progress: Object.keys(progress).slice(0, 200).reduce((acc, id) => {
          const p = progress[id] || {};
          acc[String(id).slice(0, 80)] = {
            c: +p.c || 0,
            ratio: Math.max(0, Math.min(1, +p.ratio || 0)),
            at: String(p.at || '').slice(0, 40),
          };
          return acc;
        }, {}),
      };

      const text = JSON.stringify(clean);
      if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) {
        res.statusCode = 413;
        return res.end(JSON.stringify({ error: '书架数据过大，请清理一部分收藏后重试' }));
      }

      await store.set(key, text);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(JSON.stringify({ ok: true, at: clean.at, fav: clean.fav.length }));
    }

    res.statusCode = 405;
    res.end(JSON.stringify({ error: 'Method Not Allowed' }));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: String((e && e.message) || e) }));
  }
}
