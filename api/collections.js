// ============================================================
// collections.js — Vercel Function：作品集的发布与修改
// ------------------------------------------------------------
// 与「作品发布」同一套逻辑（用户要求）：
//   · 产物进书籍仓库，不是数据库里的临时记录；
//   · 服务端代写（BOT_GH_TOKEN），任何 GitHub 登录用户都能发；
//   · 归属写进文件（account），改别人的 → 403；
//   · 先写单个文件，最后写索引（原子切换，读者看不到半成品）。
//
// 文件布局（书籍仓库）：
//   docs/collections/index.json     摘要数组（列表页只读这一个）
//   docs/collections/<id>.json      单个作品集全文
//
// 读取不需要后端：前端直接读同源 docs/collections/*（与书库 index.json
// 一样，走同源 → CDN → raw 三层）。本 Function 只负责写与删。
//
//   POST   /api/collections   body { collection: { id?, title, desc, bookIds[], cover? } }
//   DELETE /api/collections?id=cl_xxx
// ============================================================

import { identify, cors, sendJSON, readBody, ghToken, makeStore } from '../lib/cloud.mjs';
import { makeGh } from '../lib/gh-publish.mjs';

const REPO = process.env.BOOKS_REPO || 'Chengxidaxia/BookBlackNet';
const BRANCH = process.env.BOOKS_BRANCH || 'main';
const DIR = process.env.COLLECTIONS_DIR || 'docs/collections';
const INDEX = DIR + '/index.json';
const MAX_BOOKS = 200;
const MAX_ITEMS = 300;

const [OWNER, NAME] = REPO.split('/');

const cleanId = (s) => String(s || '').replace(/[^\w-]/g, '').slice(0, 60);
const newId = () => 'cl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function clean(src, owner) {
  const ids = Array.isArray(src.bookIds) ? src.bookIds : [];
  return {
    format: 'bookblacknet.collection',
    v: 1,
    id: cleanId(src.id),
    title: String(src.title || '').trim().slice(0, 60),
    desc: String(src.desc || '').trim().slice(0, 600),
    account: owner,
    author: String(src.author || owner).trim().slice(0, 40),
    cover: src.cover && typeof src.cover === 'object' ? src.cover : null,
    bookIds: ids.map(cleanId).filter(Boolean).slice(0, MAX_BOOKS),
    createdAt: String(src.createdAt || '') || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function summaryOf(c) {
  return {
    id: c.id,
    title: c.title,
    desc: c.desc,
    account: c.account,
    author: c.author,
    cover: c.cover,
    count: (c.bookIds || []).length,
    updatedAt: c.updatedAt,
  };
}

function parseIndex(text) {
  if (!text) return { items: [], raw: null };
  try {
    const j = JSON.parse(text);
    const items = Array.isArray(j) ? j : (j.items || []);
    return { items: Array.isArray(items) ? items : [], raw: j };
  } catch (e) {
    return { items: [], raw: null };
  }
}

function indexText(items) {
  return JSON.stringify({
    format: 'bookblacknet.collections',
    v: 1,
    updatedAt: new Date().toISOString(),
    items: items.slice(0, MAX_ITEMS),
  }, null, 2);
}

const sameOwner = (me, account) => !!me && !!account
  && String(account).toLowerCase() === String(me.login).toLowerCase();

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return sendJSON(res, 405, { error: 'Method Not Allowed（读取请直接取 docs/collections/index.json）' });
  }

  const store = makeStore(process.env);
  let me = null;
  try { me = await identify(req, store); } catch (e) { me = null; }
  if (!me) return sendJSON(res, 401, { error: '请先登录群档案 GitHub 账号' });
  if (me.provider !== 'github') {
    return sendJSON(res, 403, { error: '发布作品集需要 GitHub 账号登录（邮箱账号只能用云端草稿与书架）' });
  }

  const token = process.env.BOT_GH_TOKEN || ghToken(req);
  if (!token) return sendJSON(res, 401, { error: '没有可用的发布令牌：服务端未配置 BOT_GH_TOKEN' });
  if (!OWNER || !NAME) return sendJSON(res, 500, { error: 'BOOKS_REPO 配置不正确' });

  const gh = makeGh({ token, owner: OWNER, repo: NAME, branch: BRANCH });

  try {
    const url = new URL(req.url, 'http://localhost');
    const id = cleanId(url.searchParams.get('id'));

    const idx = await gh.getFile(INDEX);
    const { items } = parseIndex(idx && idx.text);

    /* ---------------- 删除 ---------------- */
    if (req.method === 'DELETE') {
      if (!id) return sendJSON(res, 400, { error: '缺少 id' });
      const one = await gh.getFile(DIR + '/' + id + '.json');
      if (!one) return sendJSON(res, 200, { ok: true, id, already: true });

      let doc = null;
      try { doc = JSON.parse(one.text); } catch (e) { doc = null; }
      if (doc && doc.account && !sameOwner(me, doc.account)) {
        return sendJSON(res, 403, { error: '只能删自己的作品集' });
      }

      await gh.deleteFile(DIR + '/' + id + '.json', 'collection: remove ' + id, one.sha);
      await gh.putFile(INDEX, indexText(items.filter((x) => x && x.id !== id)),
        'collection: drop index ' + id, idx && idx.sha);
      return sendJSON(res, 200, { ok: true, id });
    }

    /* ---------------- 新建 / 更新 ---------------- */
    const body = await readBody(req);
    const src = body && body.collection;
    if (!src || typeof src !== 'object') return sendJSON(res, 400, { error: '请求体缺少 collection' });

    const wanted = cleanId(src.id);
    let existing = null;
    let oneSha = null;

    if (wanted) {
      const one = await gh.getFile(DIR + '/' + wanted + '.json');
      if (one) {
        oneSha = one.sha;
        try { existing = JSON.parse(one.text); } catch (e) { existing = null; }
      } else {
        return sendJSON(res, 404, { error: '作品集不存在（不要用别人的 id 新建）' });
      }
      if (existing && existing.account && !sameOwner(me, existing.account)) {
        return sendJSON(res, 403, { error: '只能改自己的作品集' });
      }
    }

    const doc = clean(Object.assign({}, src, {
      id: existing ? existing.id : newId(),
      createdAt: existing ? existing.createdAt : '',
    }), me.login);

    if (!doc.title) return sendJSON(res, 400, { error: '作品集需要一个名称' });
    if (!doc.bookIds.length) return sendJSON(res, 400, { error: '作品集至少要选一本作品' });

    // ① 单个文件
    await gh.putFile(DIR + '/' + doc.id + '.json', JSON.stringify(doc, null, 2),
      'collection: ' + (existing ? 'update ' : 'create ') + doc.title, oneSha || undefined);

    // ② 索引（原子切换的最后一步）
    const rest = items.filter((x) => x && x.id !== doc.id);
    rest.unshift(summaryOf(doc));
    await gh.putFile(INDEX, indexText(rest), 'collection: index ' + doc.title, idx && idx.sha);

    return sendJSON(res, 200, { ok: true, collection: doc, mode: process.env.BOT_GH_TOKEN ? 'bot' : 'self' });
  } catch (e) {
    const status = e && e.status === 403 ? 403 : (e && e.status === 401 ? 401 : 500);
    return sendJSON(res, status, { error: String((e && e.message) || e) });
  }
}
