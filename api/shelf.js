// ============================================================
// shelf.js — Vercel Function：账号书架（收藏 + 阅读进度）云端存储
// 路由：GET /api/shelf   → { ok, shelf }
//       POST /api/shelf  → { ok }
//
// 身份（只有一种）：
//   群档案 GitHub 会话：Cookie github_token（Domain=.blacknet.cc.cd）
//   服务端拿它问 api.github.com/user，取 login 作为身份。
//   （2026-11 起邮箱账号已停用，sess: 会话不再写入。）
//
// 存储：Upstash Redis，键 bshelf:gh:<login>。
// 传参：一律 POST body（`["set",key,value]`），不再把值拼进 URL ——
//       书架整包 JSON 拼 URL 会被中间层按 URL 长度直接拒掉（414/431）。
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
  // Upstash REST：POST body 传命令数组，值多大都不经过 URL
  const cmd = async (...args) => {
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

/** 解析身份 → 'gh:<login>' / '' */
async function identify(req) {
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

    const uid = await identify(req);
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
