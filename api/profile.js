// ============================================================
// profile.js — Vercel Function：作者资料（昵称 / 简介）
// ------------------------------------------------------------
// 与作品、作品集同一套通道：产物进书籍仓库，服务端 bot 代写。
//   docs/authors/<login>.json
//     { format:"bookblacknet.author", v:1, login, name, bio, updatedAt }
//
//   GET  /api/profile?u=<login>   读（公开，无需登录）
//   POST /api/profile             { name, bio }  写自己的（需登录）
//
// 归属：路径里的 login 由服务端身份决定，客户端不能指定别人。
//      —— 这就是「文章（作品）鉴权对应作者账号，而不是发 push 的账号」：
//         commit 由 bot 提交，但文件与索引里记的是作者本人。
// ============================================================

import { identify, cors, sendJSON, readBody, ghToken } from '../lib/cloud.mjs';
import { makeGh } from '../lib/gh-publish.mjs';

const REPO = process.env.BOOKS_REPO || 'Chengxidaxia/BookBlackNet';
const BRANCH = process.env.BOOKS_BRANCH || 'main';
const DIR = process.env.AUTHORS_DIR || 'docs/authors';
const [OWNER, NAME] = REPO.split('/');

const NAME_MAX = 30;
const BIO_MAX = 300;
const LOGIN_RE = /^[A-Za-z0-9-]{1,39}$/;

const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);

function blank(login) {
  return { format: 'bookblacknet.author', v: 1, login: login, name: '', bio: '', updatedAt: '' };
}

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }

  try {
    /* ---------------- 读 ---------------- */
    if (req.method === 'GET') {
      const u = new URL(req.url, 'http://x').searchParams.get('u') || '';
      if (!LOGIN_RE.test(u)) return sendJSON(res, 400, { error: '账号名不合法' });

      const token = process.env.BOT_GH_TOKEN || ghToken(req);
      if (!token) return sendJSON(res, 200, blank(u));      // 没令牌就返回空壳，前端仍能渲染

      const gh = makeGh({ token, owner: OWNER, repo: NAME, branch: BRANCH });
      const f = await gh.getFile(DIR + '/' + u + '.json').catch(() => null);
      if (!f || !f.text) return sendJSON(res, 200, blank(u));

      let j = null;
      try { j = JSON.parse(f.text); } catch (e) { j = null; }
      return sendJSON(res, 200, j && typeof j === 'object' ? j : blank(u));
    }

    /* ---------------- 写 ---------------- */
    if (req.method !== 'POST') return sendJSON(res, 405, { error: 'Method Not Allowed' });

    const me = await identify(req, null);
    if (!me) return sendJSON(res, 401, { error: '请先登录群档案 GitHub 账号' });
    if (me.provider !== 'github') return sendJSON(res, 403, { error: '作者资料需要 GitHub 账号' });
    if (!LOGIN_RE.test(me.login)) return sendJSON(res, 400, { error: '账号名不合法' });

    const token = process.env.BOT_GH_TOKEN || ghToken(req);
    if (!token) return sendJSON(res, 500, { error: '服务端未配置 BOT_GH_TOKEN，无法保存资料' });

    const body = await readBody(req);
    if (!body) return sendJSON(res, 400, { error: '请求体不是有效 JSON' });

    const doc = {
      format: 'bookblacknet.author',
      v: 1,
      login: me.login,                       // 只认服务端身份
      name: clean(body.name, NAME_MAX),
      bio: clean(body.bio, BIO_MAX),
      updatedAt: new Date().toISOString(),
    };

    const gh = makeGh({ token, owner: OWNER, repo: NAME, branch: BRANCH });
    const path = DIR + '/' + me.login + '.json';
    const old = await gh.getFile(path).catch(() => null);
    await gh.putFile(path, JSON.stringify(doc, null, 2) + '\n',
      'author: ' + (doc.name || doc.login), old && old.sha);

    return sendJSON(res, 200, { ok: true, profile: doc, mode: process.env.BOT_GH_TOKEN ? 'bot' : 'self' });
  } catch (e) {
    const status = e && e.status === 403 ? 403 : (e && e.status === 401 ? 401 : 500);
    return sendJSON(res, status, { error: String((e && e.message) || e) });
  }
}
