// ============================================================
// content.js — Vercel Function：站点内容（Global Config / Edge Config）
// ------------------------------------------------------------
// 数据源与 vercel-proxy 用的是同一个服务：Vercel Global Config
// （旧名 Edge Config）。面板 → Storage → Global Config → 直接编辑 JSON：
//
//   key: content
//   {
//     "categories": { "grp": [{id,name,hue}…], "bn": ["玄幻", …] },
//     "announcements": [{ "title": "…", "url": "" }]
//   }
//
// 读取走 Global Config endpoint（带 CDN、无速率限制）：
//   GET <connectionString>/item/content
// 连接串来自环境变量 GLOBAL_CONFIG（新）或 EDGE_CONFIG（旧），形如
//   https://global-config.vercel.com/<id>?token=<read token>
//
// 没配 / 读失败 → 回退内置默认值，前端永不空转。
// 书阁只读（作品分类）；写入请直接在 Vercel 面板改 JSON（与 proxy 一致）。
// ============================================================

const KEY = 'content';

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
  announcements: [],
};

function connectionString(env) {
  return env.GLOBAL_CONFIG || env.EDGE_CONFIG || '';
}

/** 从连接串里拆出 endpoint 与 token */
function parseConn(cs) {
  try {
    const u = new URL(cs);
    const id = u.pathname.replace(/^\/+|\/+$/g, '');
    if (!id) return null;
    return { origin: u.origin, id, token: u.searchParams.get('token') || '' };
  } catch (e) {
    return null;
  }
}

function parseEnv(env) {
  const raw = (env && (env.CONTENT_JSON || env.SITE_CONTENT)) || '';
  if (!raw) return null;
  try { const j = JSON.parse(raw); return (j && typeof j === 'object') ? j : null; } catch (e) { return null; }
}

async function readItem(env, key) {
  const conn = parseConn(connectionString(env));
  if (!conn) return null;
  const url = conn.origin + '/' + conn.id + '/item/' + encodeURIComponent(key);
  const headers = {};
  if (conn.token) headers.Authorization = 'Bearer ' + conn.token;
  const r = await fetch(url, { headers });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('Global Config 读取失败 HTTP ' + r.status);
  return await r.json();
}

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.end(JSON.stringify(obj));
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'GET') return send(res, 405, { error: 'Method Not Allowed' });

  try {
    const envData = parseEnv(process.env);
    const data = envData || await readItem(process.env, KEY);
    if (!data || typeof data !== 'object') {
      return send(res, 200, Object.assign({ source: 'default' }, DEFAULT));
    }
    const out = {
      categories: {
        grp: (data.categories && Array.isArray(data.categories.grp) && data.categories.grp.length)
          ? data.categories.grp : DEFAULT.categories.grp,
        bn: (data.categories && Array.isArray(data.categories.bn) && data.categories.bn.length)
          ? data.categories.bn : DEFAULT.categories.bn,
      },
      announcements: Array.isArray(data.announcements) ? data.announcements : [],
      updatedAt: data.updatedAt || '',
      source: envData ? 'env' : 'global-config',
    };
    return send(res, 200, out);
  } catch (e) {
    return send(res, 200, Object.assign({ source: 'default', error: String((e && e.message) || e) }, DEFAULT));
  }
}
