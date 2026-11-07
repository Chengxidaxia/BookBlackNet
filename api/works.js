// ============================================================
// works.js — Vercel Function：账号书稿云同步（换设备接着写）
// ------------------------------------------------------------
// 路由（同一个 Function，按方法与 query 分发）：
//   GET    /api/works            → 书目列表（只有元信息，不含正文）
//   GET    /api/works?id=bk_xxx  → 单本全文（分块拼回）
//   POST   /api/works            → 保存一本书（body: { book })
//   DELETE /api/works?id=bk_xxx  → 删除一本书（含所有分块）
//
// 存储（Upstash Redis）：
//   bu:<uid>:books          书目索引（JSON 数组，上限 100 本）
//   bu:<uid>:b:<id>:<n>     正文分块（每块 ≤ 12 万字符，中文约 360KB）
//
// 为什么分块：Upstash REST 单请求 body 上限 1MB，长篇正文轻松超。
// 归属：key 前缀就是 uid —— 别人的书在物理上就读不到，不靠前端判断。
// ============================================================

import { makeStore, identify, cors, sendJSON, readBody, jsonGet, noStore } from '../lib/cloud.mjs';

const MAX_BOOKS = 100;
const CHUNK_CHARS = 120000;      // 单块字符上限（中文 ~360KB）
const MAX_CHUNKS = 24;           // 单本上限 ≈ 8.6MB 中文
const MAX_INDEX_BYTES = 256 * 1024;

const idxKey = (uid) => 'bu:' + uid + ':books';
const chunkKey = (uid, id, n) => 'bu:' + uid + ':b:' + id + ':' + n;

/** 按字符切块，不在代理对中间下刀 */
function splitText(str, max) {
  const out = [];
  let start = 0;
  while (start < str.length) {
    let end = Math.min(start + max, str.length);
    if (end < str.length) {
      const c = str.charCodeAt(end - 1);
      if (c >= 0xd800 && c <= 0xdbff) end -= 1;   // 别把高位代理留在块尾
    }
    out.push(str.slice(start, end));
    start = end;
  }
  return out.length ? out : [''];
}

const MAX_TAGS = 12;                      // 标签上限，与 assets/js/config.js 的 MAX_TAGS 保持一致

function cleanMeta(m, id) {
  const src = m || {};
  return {
    id: String(src.id || id).replace(/[^\w-]/g, '').slice(0, 60),
    title: String(src.title || '未命名作品').slice(0, 60),
    author: String(src.author || '').slice(0, 30),
    intro: String(src.intro || '').slice(0, 500),
    category: String(src.category || '').slice(0, 20),
    tags: Array.isArray(src.tags) ? src.tags.filter((t) => typeof t === 'string').slice(0, MAX_TAGS) : [],
    status: src.status === 'done' ? 'done' : 'ongoing',
    visibility: src.visibility === 'private' ? 'private' : 'public',
    cover: src.cover && typeof src.cover === 'object' ? src.cover : null,
    account: String(src.account || '').slice(0, 60),
    createdAt: String(src.createdAt || '').slice(0, 40),
    updatedAt: String(src.updatedAt || '').slice(0, 40),
  };
}

const words = (chapters) => (chapters || []).reduce((n, c) => n + String((c && c.content) || '').replace(/\s/g, '').length, 0);

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }

  const store = makeStore(process.env);
  if (!store) return noStore(res);

  let me;
  try {
    me = await identify(req, store);
  } catch (e) {
    return sendJSON(res, 502, { error: '身份校验失败：' + String((e && e.message) || e) });
  }
  if (!me) return sendJSON(res, 401, { error: '未登录：云端草稿只在登录后可用，本机草稿不受影响' });

  const url = new URL(req.url, 'http://localhost');
  const id = (url.searchParams.get('id') || '').replace(/[^\w-]/g, '');

  try {
    /* ---------------- 列表 ---------------- */
    if (req.method === 'GET' && !id) {
      const list = jsonGet(await store.get(idxKey(me.uid)), []);
      return sendJSON(res, 200, { ok: true, uid: me.uid, provider: me.provider, books: Array.isArray(list) ? list : [] });
    }

    /* ---------------- 单本 ---------------- */
    if (req.method === 'GET' && id) {
      const list = jsonGet(await store.get(idxKey(me.uid)), []);
      const hit = (Array.isArray(list) ? list : []).find((b) => b && b.id === id);
      if (!hit) return sendJSON(res, 404, { error: '云端没有这本书的草稿', id });

      const n = Math.max(1, +hit.chunks || 1);
      const keys = [];
      for (let i = 1; i <= n; i++) keys.push(chunkKey(me.uid, id, i));
      const segs = n === 1 ? [await store.get(keys[0])] : await store.mget(...keys);
      const text = (segs || []).filter((s) => s != null).join('');
      if (!text) return sendJSON(res, 500, { error: '分块丢失，云端草稿不完整' });

      let payload;
      try { payload = JSON.parse(text); } catch (e) {
        return sendJSON(res, 500, { error: '云端草稿损坏（分块拼不回 JSON）' });
      }
      return sendJSON(res, 200, { ok: true, book: payload, summary: hit });
    }

    /* ---------------- 保存 ---------------- */
    if (req.method === 'POST') {
      const body = await readBody(req);
      const book = body && body.book;
      if (!book || !book.id) return sendJSON(res, 400, { error: '请求体缺少 book.id' });

      const bid = String(book.id).replace(/[^\w-]/g, '').slice(0, 60);
      if (!bid) return sendJSON(res, 400, { error: 'book.id 不合法' });

      const meta = cleanMeta(book.meta, bid);
      const chapters = (Array.isArray(book.chapters) ? book.chapters : []).slice(0, 2000).map((c, i) => ({
        id: String((c && c.id) || 'c' + (i + 1)).slice(0, 40),
        title: String((c && c.title) || '第 ' + (i + 1) + ' 章').slice(0, 120),
        content: String((c && c.content) || ''),
      }));

      const payload = JSON.stringify({
        format: 'bookblacknet.workspace.book',
        v: 1,
        at: new Date().toISOString(),
        id: bid,
        meta: Object.assign({}, meta, { words: words(chapters), chapters: chapters.length }),
        chapters,
        published: book.published && typeof book.published === 'object' ? {
          at: String(book.published.at || '').slice(0, 40),
          mode: String(book.published.mode || '').slice(0, 20),
          file: String(book.published.file || '').slice(0, 120),
          words: +book.published.words || 0,
          chapters: +book.published.chapters || 0,
        } : null,
      });

      const parts = splitText(payload, CHUNK_CHARS);
      if (parts.length > MAX_CHUNKS) {
        return sendJSON(res, 413, {
          error: '这本书超过云端单本上限（约 8.6MB 正文），请用「备份」导出到本机，或用 Gist 同步',
        });
      }

      // 先写块（否则清单指向空块），再更新索引
      for (let i = 0; i < parts.length; i++) {
        await store.set(chunkKey(me.uid, bid, i + 1), parts[i]);
      }

      const old = jsonGet(await store.get(idxKey(me.uid)), []);
      const list = (Array.isArray(old) ? old : []).filter((b) => b && b.id !== bid);
      const entry = Object.assign({}, meta, {
        id: bid,
        words: words(chapters),
        chapters: chapters.length,
        updatedAt: meta.updatedAt || new Date().toISOString(),
        published: book.published && typeof book.published === 'object' ? book.published : null,
        bytes: Buffer.byteLength(payload, 'utf8'),
        chunks: parts.length,
        at: new Date().toISOString(),
      });
      list.unshift(entry);

      // 清掉旧版本多出来的块
      const prev = (Array.isArray(old) ? old : []).find((b) => b && b.id === bid);
      const prevChunks = prev ? +prev.chunks || 0 : 0;
      for (let i = parts.length + 1; i <= prevChunks; i++) {
        await store.del(chunkKey(me.uid, bid, i)).catch(() => {});
      }

      const trimmed = list.slice(0, MAX_BOOKS);
      const text = JSON.stringify(trimmed);
      if (Buffer.byteLength(text, 'utf8') > MAX_INDEX_BYTES) {
        return sendJSON(res, 413, { error: '书目索引过大，请先删除一些书稿' });
      }
      await store.set(idxKey(me.uid), text);

      return sendJSON(res, 200, { ok: true, id: bid, chunks: parts.length, bytes: entry.bytes, at: entry.at });
    }

    /* ---------------- 删除 ---------------- */
    if (req.method === 'DELETE') {
      if (!id) return sendJSON(res, 400, { error: '缺少 id' });
      const old = jsonGet(await store.get(idxKey(me.uid)), []);
      const list = Array.isArray(old) ? old : [];
      const hit = list.find((b) => b && b.id === id);
      const n = hit ? +hit.chunks || 1 : 1;
      for (let i = 1; i <= n; i++) await store.del(chunkKey(me.uid, id, i)).catch(() => {});
      await store.set(idxKey(me.uid), JSON.stringify(list.filter((b) => b && b.id !== id)));
      return sendJSON(res, 200, { ok: true, id });
    }

    return sendJSON(res, 405, { error: 'Method Not Allowed' });
  } catch (e) {
    return sendJSON(res, 500, { error: String((e && e.message) || e) });
  }
}
