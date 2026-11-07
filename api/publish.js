// ============================================================
// publish.js — Vercel Function：服务端代写发布（任意 GitHub 登录用户）
// ------------------------------------------------------------
// 为什么要有它：浏览器直调 GitHub Contents API 时，用的是「用户自己的
// 令牌」，没有该仓库写权限的账号必然 403 —— 于是只有协作者能发书。
// 这里改成服务端持一把 BOT_GH_TOKEN 代提交，用户只负责提供身份。
//
// 路由（同一个 Function，按 body 分发）：
//   POST { file, seq, total, text }                → 上传第 seq 片
//   POST { file, final: 1, total, size, entry }    → 写清单 + 清旧片 + 更新索引
//
// 环境变量（Vercel → Settings → Environment Variables）：
//   BOT_GH_TOKEN   对书籍仓库有 contents:write 的令牌（缺失时退回调用者令牌）
//   BOOKS_REPO     owner/repo，默认 Chengxidaxia/BookBlackNet
//   BOOKS_BRANCH   默认 main
//   BOOKS_DIR      默认 docs/books
//   BOOKS_INDEX    默认 docs/books/index.json
//
// 归属：index 条目里的 account 由服务端写入（login），客户端传什么都会被覆盖。
//       已有 account 且与当前账号不符 → 403（不能改别人的书）。
// ============================================================

import { identify, cors, sendJSON, readBody, ghToken, makeStore } from '../lib/cloud.mjs';
import {
  makeGh, isValidFile, partName, partNames, staleOf, manifestOf, mergeIndex, ownerOfBook,
} from '../lib/gh-publish.mjs';

const MAX_PART_BYTES = 3 * 1024 * 1024;   // 单片上限（base64 后 ~4MB，留余量给 4.5MB body 限制）
const MAX_TAGS = 12;                      // 标签上限，与 assets/js/config.js 的 MAX_TAGS 保持一致

const REPO = process.env.BOOKS_REPO || 'Chengxidaxia/BookBlackNet';
const BRANCH = process.env.BOOKS_BRANCH || 'main';
const BOOKS_DIR = process.env.BOOKS_DIR || 'docs/books';
const INDEX_FILE = process.env.BOOKS_INDEX || 'docs/books/index.json';

const [OWNER, NAME] = REPO.split('/');

function cleanEntry(e, login, file, total) {
  const src = e || {};
  return {
    id: String(src.id || '').replace(/[^\w-]/g, '').slice(0, 60),
    title: String(src.title || '未命名作品').slice(0, 60),
    author: String(src.author || src.account || login).slice(0, 30),
    intro: String(src.intro || '').slice(0, 500),
    category: String(src.category || '其他').slice(0, 20),
    tags: Array.isArray(src.tags) ? src.tags.filter((t) => typeof t === 'string').slice(0, MAX_TAGS) : [],
    status: src.status === 'done' ? 'done' : 'ongoing',
    visibility: src.visibility === 'private' ? 'private' : 'public',
    cover: src.cover && typeof src.cover === 'object' ? src.cover : null,
    chapters: +src.chapters || 0,
    words: +src.words || 0,
    createdAt: String(src.createdAt || '').slice(0, 40) || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    account: login,                   // 只认服务端身份
    file: file,
    chunks: total,
  };
}

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'POST') return sendJSON(res, 405, { error: 'Method Not Allowed' });

  const store = makeStore(process.env);
  let me = null;
  try { me = await identify(req, store); } catch (e) { me = null; }
  if (!me) return sendJSON(res, 401, { error: '请先登录群档案 GitHub 账号再发布' });
  if (me.provider !== 'github') {
    return sendJSON(res, 403, { error: '发布作品需要 GitHub 账号登录（邮箱账号只能保存云端草稿）' });
  }

  const bot = process.env.BOT_GH_TOKEN || '';
  const userTok = ghToken(req);
  const token = bot || userTok;
  if (!token) return sendJSON(res, 401, { error: '没有可用的发布令牌：服务端未配置 BOT_GH_TOKEN，且你的会话里没有 GitHub 令牌' });
  if (!OWNER || !NAME) return sendJSON(res, 500, { error: 'BOOKS_REPO 配置不正确，应为 owner/repo' });

  const gh = makeGh({ token, owner: OWNER, repo: NAME, branch: BRANCH });

  try {
    const body = await readBody(req);
    if (!body) return sendJSON(res, 400, { error: '请求体不是有效 JSON' });

    const file = String(body.file || '');
    if (!isValidFile(file)) return sendJSON(res, 400, { error: '文件名不合法（应为 bk_xxx.book）' });
    const id = file.replace(/\.book$/, '');

    /* ---------------- 收尾：写清单 ---------------- */
    if (body.final) {
      const total = Math.max(1, Math.min(200, +body.total || 1));
      const size = Math.max(0, +body.size || 0);
      const entry = cleanEntry(body.entry, me.login, file, total);
      if (entry.id !== id) return sendJSON(res, 400, { error: 'entry.id 与文件名不一致' });

      // 章节数 / 字数以正文明文头为准，不信任客户端传来的 entry。
      // .book 的 meta 是明文（crypto.pack 用 chapters.length 写入），第一片
      // 就包含它，所以这里直接读 .p001 的头部即可，无需解密。
      try {
        const p1 = await gh.getFile(BOOKS_DIR + '/' + partName(file, 1));
        if (p1 && p1.text) {
          const head = p1.text.slice(0, 8000);
          const mc = /"chapters"\s*:\s*(\d+)/.exec(head);
          const mw = /"words"\s*:\s*(\d+)/.exec(head);
          if (mc && +mc[1] > 0) {
            entry.chapters = +mc[1];
            if (mw && +mw[1] > 0) entry.words = +mw[1];
          }
        }
      } catch (e) { /* 读不到就沿用客户端值，不因此让发布失败 */ }

      // 归属校验：已有 account 且不是本人 → 拒绝
      const idx = await gh.getFile(INDEX_FILE);
      let prevList = [];
      if (idx && idx.text) {
        try {
          const j = JSON.parse(idx.text);
          prevList = Array.isArray(j) ? j : (j.books || []);
        } catch (e) { prevList = []; }
      }
      const owner = ownerOfBook(prevList, entry.id);
      if (owner && owner.toLowerCase() !== me.login.toLowerCase()) {
        return sendJSON(res, 403, { error: '这本书属于另一个账号（' + owner + '），不能覆盖' });
      }

      const bpath = BOOKS_DIR + '/' + file;
      const old = await gh.getFile(bpath);
      const names = partNames(file, total);

      // ① 清单（分片此时已全部就位）
      await gh.putFile(bpath, manifestOf(names, size),
        'book: ' + (entry.title || entry.id) + ' (publish via server, ' + total + ' part' + (total > 1 ? 's' : '') + ')',
        old && old.sha);

      // ② 清旧版本多余的分片
      const stale = staleOf(old && old.text, names);
      for (const name of stale) {
        const po = await gh.getFile(BOOKS_DIR + '/' + name);
        if (po) await gh.deleteFile(BOOKS_DIR + '/' + name, 'book: drop stale part ' + name, po.sha).catch(() => {});
      }

      // ③ 更新索引
      const merged = mergeIndex(idx && idx.text, entry);
      await gh.putFile(INDEX_FILE, merged.text, 'index: publish ' + (entry.title || entry.id), idx && idx.sha);

      return sendJSON(res, 200, { ok: true, mode: 'server', id: entry.id, file, parts: total, account: entry.account });
    }

    /* ---------------- 上传一片 ---------------- */
    const seq = Math.max(1, Math.min(200, +body.seq || 0));
    const total = Math.max(1, Math.min(200, +body.total || 1));
    const text = typeof body.text === 'string' ? body.text : '';
    if (!seq) return sendJSON(res, 400, { error: '缺少 seq' });
    if (!text) return sendJSON(res, 400, { error: '分片内容为空' });
    if (Buffer.byteLength(text, 'utf8') > MAX_PART_BYTES) {
      return sendJSON(res, 413, { error: '分片过大（上限 3MB），请减小切片尺寸' });
    }

    // 同上做一次归属校验，避免有人往别人的书里灌分片
    const idx0 = await gh.getFile(INDEX_FILE);
    let list0 = [];
    if (idx0 && idx0.text) {
      try {
        const j = JSON.parse(idx0.text);
        list0 = Array.isArray(j) ? j : (j.books || []);
      } catch (e) { list0 = []; }
    }
    const owner0 = ownerOfBook(list0, id);
    if (owner0 && owner0.toLowerCase() !== me.login.toLowerCase()) {
      return sendJSON(res, 403, { error: '这本书属于另一个账号（' + owner0 + '），不能覆盖' });
    }

    const pp = BOOKS_DIR + '/' + partName(file, seq);
    const po = await gh.getFile(pp);
    await gh.putFile(pp, text, 'book part ' + seq + '/' + total + ': ' + id, po && po.sha);

    return sendJSON(res, 200, { ok: true, seq, total, bytes: Buffer.byteLength(text, 'utf8'), usingBot: !!bot });
  } catch (e) {
    const status = e && e.status === 403 ? 403 : (e && e.status === 401 ? 401 : 500);
    return sendJSON(res, status, { error: String((e && e.message) || e) });
  }
}
