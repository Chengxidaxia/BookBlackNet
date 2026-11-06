// ============================================================
// content.js — Vercel Function：书阁内容（作品分类）
// ------------------------------------------------------------
// 存储：Upstash Redis（与书阁共用同一个库），键 bn:content
//
//   {
//     "categories": { "grp": [{id,name,hue}…], "bn": ["玄幻", …] },
//     "announcements": [{ "title": "…", "url": "" }]
//   }
//
// 读取优先级：
//   ① CONTENT_JSON 环境变量（应急覆盖，整段 JSON）
//   ② Upstash 的 bn:content
//   ③ 内置 DEFAULT（与 assets/data/*.json 一致）
//
// 首次读到空键会自动把 DEFAULT 播种进 Redis，所以不需要手工初始化。
// 改内容两种方式：
//   · Upstash 控制台 → Data Browser → bn:content 直接编辑
//   · PUT /api/content（需群档案 GitHub 登录，且 login 在 CONTENT_ADMIN 名单里）
//
// 书阁只取 categories.bn（作品分类）；主站 /api/content 读同一个键。
// 两个项目需要配同一套 Upstash 环境变量（同一个库）。
// ============================================================

const KEY = 'bn:content';

const DEFAULT = {
  categories: {
    grp: [
      { id: 1, name: '公告', hue: 30 },
      { id: 2, name: '新闻', hue: 352 },
      { id: 3, name: '资讯', hue: 214 },
      { id: 4, name: '技术', hue: 168 },
      { id: 5, name: '活动', hue: 32 },
      { id: 6, name: '随笔', hue: 276 },
    ],
    bn: ['玄幻', '仙侠', '都市', '历史', '科幻', '悬疑', '言情', '游戏', '其他'],
  },
  announcements: [
    { title: '群档案正式上线：关于记录、连接与一点点执念', url: '' },
    { title: '编辑部招募：欢迎加入内容共建计划', url: '' },
  ],
};

/* ---------------- Upstash REST ---------------- */
// REST 命令一律走 POST body（`["get",key]`），值再大也不进 URL。
function makeKV(env) {
  const base = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL || env.KV_URL || '';
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN
    || env.KV_REST_API_READ_ONLY_TOKEN || '';
  if (!base || !token) return null;
  let host = '';
  try { host = new URL(base).host; } catch (e) { host = ''; }
  const cmd = async (...args) => {
    const r = await fetch(base, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    const j = await r.json().catch(() => ({}));
    if (j && j.error) throw new Error(j.error);
    return j ? j.result : null;
  };
  return { host, get: (k) => cmd('get', k), set: (k, v) => cmd('set', k, v) };
}

function parseEnv(env) {
  const raw = (env && (env.CONTENT_JSON || env.SITE_CONTENT)) || '';
  if (!raw) return null;
  try { const j = JSON.parse(raw); return (j && typeof j === 'object') ? j : null; } catch (e) { return null; }
}

function parseRaw(raw) {
  if (!raw) return null;
  try { const j = JSON.parse(raw); return (j && typeof j === 'object') ? j : null; } catch (e) { return null; }
}

/** 只保留认识的字段，顺便挡掉脏数据 */
function normalize(data) {
  if (!data || typeof data !== 'object') return null;
  const cats = data.categories || {};
  const grp = Array.isArray(cats.grp) && cats.grp.length ? cats.grp : DEFAULT.categories.grp;
  const bn = Array.isArray(cats.bn) && cats.bn.length ? cats.bn : DEFAULT.categories.bn;
  return {
    categories: { grp, bn },
    announcements: Array.isArray(data.announcements) ? data.announcements : [],
    updatedAt: data.updatedAt || '',
  };
}

/* ---------------- 管理员鉴权（写） ---------------- */
function readCookie(header, name) {
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}

async function adminLogin(req) {
  const raw = String((req.headers && (req.headers.cookie || req.headers.Cookie)) || '');
  const gh = readCookie(raw, 'github_token');
  if (!gh) return '';
  const r = await fetch('https://api.github.com/user', {
    headers: { Authorization: 'Bearer ' + gh, 'User-Agent': 'GroupBlackNet-Content' },
  });
  if (!r.ok) return '';
  const u = await r.json().catch(() => null);
  if (!u || !u.login) return '';
  const login = String(u.login);
  const allow = String(process.env.CONTENT_ADMIN || 'Chengxidaxia')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return allow.indexOf(login.toLowerCase()) >= 0 ? login : '';
}

function readBody(req) {
  return new Promise((resolve) => {
    if (req.body && typeof req.body === 'object') return resolve(req.body);
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 256 * 1024) req.destroy(); });
    req.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')); } catch (e) { resolve(null); }
    });
    req.on('error', () => resolve(null));
  });
}

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.end(JSON.stringify(obj));
}

function corsPreflight(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.statusCode = 204;
  res.end();
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return corsPreflight(res);

  const kv = makeKV(process.env);
  const envData = parseEnv(process.env);
  const diag = {
    hasKV: !!kv,
    kvHost: kv ? kv.host : '',
    envOverride: !!envData,
    key: KEY,
  };

  /* ---------------- 写 ---------------- */
  if (req.method === 'PUT' || req.method === 'POST') {
    if (!kv) return send(res, 503, { error: '未配置 Upstash（UPSTASH_REDIS_REST_URL / _TOKEN）', diag });
    let who = '';
    try { who = await adminLogin(req); } catch (e) { who = ''; }
    if (!who) {
      return send(res, 401, { error: '需要群档案 GitHub 登录，且账号在 CONTENT_ADMIN 名单里', diag });
    }
    const body = await readBody(req);
    const bad = (msg) => send(res, 400, { error: msg });
    if (!body || typeof body !== 'object' || Array.isArray(body)) return bad('body 必须是 JSON 对象');
    const c = body.categories;
    if (c != null && (typeof c !== 'object' || Array.isArray(c))) return bad('categories 必须是对象');
    if (c && c.grp != null && !Array.isArray(c.grp)) return bad('categories.grp 必须是数组');
    if (c && c.bn != null && !Array.isArray(c.bn)) return bad('categories.bn 必须是数组');
    if (c && Array.isArray(c.grp) && c.grp.some((x) => !x || typeof x !== 'object' || !(x.name || x.label))) {
      return bad('categories.grp 每项需要 name');
    }
    if (c && Array.isArray(c.bn) && c.bn.some((x) => typeof x !== 'string' || !x.trim())) {
      return bad('categories.bn 每项需要非空字符串');
    }
    if (body.announcements != null && !Array.isArray(body.announcements)) return bad('announcements 必须是数组');
    if (Array.isArray(body.announcements) && body.announcements.some((x) => !x || typeof x !== 'object' || !x.title)) {
      return bad('announcements 每项需要 title');
    }

    // 局部更新：没传的字段沿用库里现有值，避免「只想改 bn 却把 grp 冲掉」
    let base = normalize(DEFAULT);
    try { base = normalize(parseRaw(await kv.get(KEY))) || base; } catch (e) { /* 读失败就按默认值补全 */ }
    const doc = {
      categories: {
        grp: c && Array.isArray(c.grp) && c.grp.length ? c.grp : base.categories.grp,
        bn: c && Array.isArray(c.bn) && c.bn.length ? c.bn : base.categories.bn,
      },
      announcements: Array.isArray(body.announcements) ? body.announcements : base.announcements,
      updatedAt: new Date().toISOString(),
    };
    try {
      await kv.set(KEY, JSON.stringify(doc));
      return send(res, 200, { ok: true, by: who, updatedAt: doc.updatedAt, source: 'upstash' });
    } catch (e) {
      return send(res, 500, { error: '写入 Upstash 失败：' + String((e && e.message) || e) });
    }
  }

  if (req.method !== 'GET') return send(res, 405, { error: 'Method Not Allowed' });

  /* ---------------- 读 ---------------- */
  try {
    if (envData) {
      return send(res, 200, Object.assign({ source: 'env' }, normalize(envData)));
    }
    let reason = '';
    if (!kv) reason = 'no-upstash-env';
    else {
      try {
        const raw = await kv.get(KEY);
        const data = parseRaw(raw);
        if (data) return send(res, 200, Object.assign({ source: 'upstash' }, normalize(data)));
        // 空键 → 播种一次，之后面板里就能直接改
        reason = 'key-missing';
        const seed = Object.assign({}, DEFAULT, { updatedAt: new Date().toISOString() });
        try { await kv.set(KEY, JSON.stringify(seed)); reason = 'seeded'; } catch (e) { /* 只读 token：忽略 */ }
        return send(res, 200, Object.assign({ source: 'default', reason }, normalize(seed)));
      } catch (e) {
        reason = String((e && e.message) || e);
      }
    }
    return send(res, 200, Object.assign({ source: 'default', reason, diag }, normalize(DEFAULT)));
  } catch (e) {
    return send(res, 200, Object.assign({ source: 'default', reason: String((e && e.message) || e), diag }, normalize(DEFAULT)));
  }
}
