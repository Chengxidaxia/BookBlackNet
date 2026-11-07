// ============================================================
// unpublish.js — Vercel Function：服务端代写下架（与 publish.js 同构）
// ------------------------------------------------------------
// 为什么要有它：下架原本只有两条路 —— 浏览器直调 GitHub Contents API
// （只有仓库协作者能删）或调一个并不存在的 /api/unpublish。结果是
// 普通用户点了「下架」必然失败，或者（在有权限的账号上）删除成功了
// 但前端读到的还是旧快照。
//
// 这里改成服务端持 BOT_GH_TOKEN 代删，用户只负责提供身份，并且：
//   · 归属校验：索引里 account 与当前账号不符 → 403
//   · 老数据没有 account → 只有 CONTENT_ADMIN 名单能删
//   · 顺序：先删正文分片，再删清单，最后改索引（读者不会读到半成品）
//
// 路由：
//   POST /api/unpublish  { id: "bk_xxx" }
//
// 环境变量：BOT_GH_TOKEN / BOOKS_REPO / BOOKS_BRANCH / BOOKS_DIR / BOOKS_INDEX
//           与 publish.js 完全共用。
// ============================================================

import { identify, cors, sendJSON, readBody, ghToken, makeStore } from '../lib/cloud.mjs';
import { makeGh } from '../lib/gh-publish.mjs';

const REPO = process.env.BOOKS_REPO || 'Chengxidaxia/BookBlackNet';
const BRANCH = process.env.BOOKS_BRANCH || 'main';
const BOOKS_DIR = process.env.BOOKS_DIR || 'docs/books';
const INDEX_FILE = process.env.BOOKS_INDEX || 'docs/books/index.json';

const [OWNER, NAME] = REPO.split('/');

const ID_RE = /^bk_[\w-]{1,60}$/;

/** 管理员名单（老数据没有 account 时用它兜底放行） */
function isAdmin(login) {
  const allow = String(process.env.CONTENT_ADMIN || 'Chengxidaxia')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return allow.indexOf(String(login || '').toLowerCase()) >= 0;
}

/** 从索引文本里取某本书的归属（没有则空串） */
function ownerIn(text, id) {
  if (!text) return '';
  try {
    const j = JSON.parse(text);
    const list = Array.isArray(j) ? j : (j.books || []);
    const hit = (Array.isArray(list) ? list : []).find((b) => b && b.id === id);
    return hit ? String(hit.account || '') : '';
  } catch (e) { return ''; }
}

/** 从清单文本里取正文分片名（旧版单体文件返回空数组） */
function partsOf(text) {
  if (!text) return [];
  try {
    const j = JSON.parse(text);
    if (!j || j.format !== 'bookblacknet.chunks' || !Array.isArray(j.parts)) return [];
    return j.parts.filter((n) => typeof n === 'string' && /^bk_[\w-]+\.book\.p\d{3}$/.test(n));
  } catch (e) { return []; }
}

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'POST') return sendJSON(res, 405, { error: 'Method Not Allowed' });

  const store = makeStore(process.env);
  let me = null;
  try { me = await identify(req, store); } catch (e) { me = null; }
  if (!me) return sendJSON(res, 401, { error: '请先登录群档案 GitHub 账号再下架' });
  if (me.provider !== 'github') {
    return sendJSON(res, 403, { error: '下架作品需要 GitHub 账号登录' });
  }

  const bot = process.env.BOT_GH_TOKEN || '';
  const token = bot || ghToken(req);
  if (!token) return sendJSON(res, 401, { error: '没有可用的令牌：服务端未配置 BOT_GH_TOKEN，且会话里没有 GitHub 令牌' });
  if (!OWNER || !NAME) return sendJSON(res, 500, { error: 'BOOKS_REPO 配置不正确，应为 owner/repo' });

  const gh = makeGh({ token, owner: OWNER, repo: NAME, branch: BRANCH });

  try {
    const body = await readBody(req);
    if (!body) return sendJSON(res, 400, { error: '请求体不是有效 JSON' });

    const id = String(body.id || '').replace(/\.book$/, '');
    if (!ID_RE.test(id)) return sendJSON(res, 400, { error: '作品编号不合法（应为 bk_xxx）' });

    const idx = await gh.getFile(INDEX_FILE);
    const owner = ownerIn(idx && idx.text, id);

    // 归属校验：有归属必须本人；没有归属只有管理员能动
    if (owner) {
      if (owner.toLowerCase() !== me.login.toLowerCase()) {
        return sendJSON(res, 403, { error: '这本书属于账号 ' + owner + '，你不能下架' });
      }
    } else if (!isAdmin(me.login)) {
      return sendJSON(res, 403, { error: '这本书没有记录归属，只有管理员可以下架' });
    }

    const bpath = BOOKS_DIR + '/' + id + '.book';
    const cur = await gh.getFile(bpath);

    // ① 先删正文分片（读者此时还能读到完整旧内容，只是不再单点引用）
    let removedParts = 0;
    const parts = partsOf(cur && cur.text);
    for (const p of parts) {
      const po = await gh.getFile(BOOKS_DIR + '/' + p);
      if (!po) continue;
      await gh.deleteFile(BOOKS_DIR + '/' + p, 'book: unpublish part ' + p, po.sha).catch(() => {});
      removedParts++;
    }

    // ② 删清单
    if (cur) {
      await gh.deleteFile(bpath, 'book: unpublish ' + id, cur.sha);
    }

    // ③ 从索引里摘掉（没有索引文件也要保证返回 ok）
    if (idx && idx.text) {
      try {
        const j = JSON.parse(idx.text);
        const list = (Array.isArray(j) ? j : (j.books || [])).filter((b) => b && b.id !== id);
        const text = JSON.stringify({
          format: 'bookblacknet.index',
          v: 1,
          updatedAt: new Date().toISOString(),
          books: list.slice(0, 500),
        }, null, 2);
        await gh.putFile(INDEX_FILE, text, 'index: remove ' + id, idx.sha);
      } catch (e) { /* 索引结构异常时不影响正文已删除 */ }
    }

    return sendJSON(res, 200, {
      ok: true,
      id,
      existed: !!cur,
      removedParts,
      account: owner || me.login,
    });
  } catch (e) {
    const status = e && e.status === 403 ? 403 : (e && e.status === 401 ? 401 : 500);
    return sendJSON(res, status, { error: String((e && e.message) || e) });
  }
}
