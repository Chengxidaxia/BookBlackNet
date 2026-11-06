/* ============================================================
   cloud.js — 云端能力客户端（作品 / 作品集 / 站点内容）
   ------------------------------------------------------------
   三类数据三种通道，别混：

     书稿草稿  /api/works        Upstash（长篇正文，分块上传）
     作品集    docs/collections/  书籍仓库静态文件；写走 /api/collections 代写
     分类公告  /api/content      Vercel Global Config（与 proxy 同一服务）

   身份：邮箱账号走 Authorization: Bearer（localStorage）；
        群档案 GitHub 会话走 Cookie（credentials: include）。
        两者服务端都能识别，见 lib/cloud.mjs → identify()。
   ============================================================ */
window.BKN = window.BKN || {};

(function (B) {
  'use strict';

  const CFG = window.BOOK || {};

  function stamp() {
    try {
      const b = sessionStorage.getItem('bbn.bust');
      if (b) return 'b' + b;
    } catch (e) {}
    return 't' + Math.floor(Date.now() / 180000);
  }

  function headers(extra) {
    const h = Object.assign({ 'Content-Type': 'application/json' }, extra || {});
    const t = (B.auth && B.auth.emailToken) ? B.auth.emailToken() : '';
    if (t) h.Authorization = 'Bearer ' + t;
    return h;
  }

  async function api(path, init) {
    const opt = Object.assign({ credentials: 'include', cache: 'no-store' }, init || {});
    opt.headers = headers(opt.headers || {});
    const r = await fetch(path, opt);
    let data = {};
    try { data = await r.json(); } catch (e) { data = {}; }
    if (!r.ok) {
      const err = new Error(data.error || ('HTTP ' + r.status));
      err.status = r.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  /* ---------------- 站点内容（分类 / 公告） ---------------- */
  let _content = null;
  async function content(force) {
    if (_content && !force) return _content;
    try {
      _content = await api('/api/content', { method: 'GET' });
      if (!_content || !_content.categories) throw new Error('内容格式不对');
    } catch (e) {
      // 后端不可用（本地预览 / GC 未配）→ 用 config.js 里的兜底
      _content = {
        categories: { grp: [], bn: (CFG.CATEGORIES || []).slice() },
        announcements: [],
        source: 'fallback',
      };
    }
    return _content;
  }

  /* ---------------- 书稿（Upstash 云端草稿） ---------------- */
  const works = {
    async list() {
      const d = await api('/api/works', { method: 'GET' });
      return Array.isArray(d.books) ? d.books : [];
    },
    async get(id) {
      const d = await api('/api/works?id=' + encodeURIComponent(id), { method: 'GET' });
      return d.book || null;
    },
    /** book = { id, meta, chapters, published } */
    async save(book) {
      return api('/api/works', { method: 'POST', body: JSON.stringify({ book: book }) });
    },
    async remove(id) {
      return api('/api/works?id=' + encodeURIComponent(id), { method: 'DELETE' });
    },
  };

  /* ---------------- 作品集（仓库文件 + 服务端代写） ---------------- */
  function collectionsBase() {
    return (CFG.COLLECTIONS_DIR || 'docs/collections') + '/';
  }

  async function getJSON(path) {
    // 同源优先（Vercel 直出，快且不会被墙）
    try {
      const r = await fetch(path + '?v=' + stamp(), { cache: 'no-store', credentials: 'omit' });
      if (r.ok) {
        const txt = await r.text();
        if (txt && txt.trim()[0] === '{') return JSON.parse(txt);
      }
    } catch (e) { /* 下一层 */ }
    // raw 兜底（GitHub Pages / 本地静态服务器没有 v 参数也能取）
    const raw = 'https://raw.githubusercontent.com/' + CFG.REPO_OWNER + '/' + CFG.REPO_NAME
      + '/' + (CFG.BRANCH || 'main') + '/' + path;
    const r2 = await fetch(raw + '?v=' + stamp(), { cache: 'no-store' });
    if (!r2.ok) throw new Error('无法获取 ' + path);
    return await r2.json();
  }

  const collections = {
    /** 公开列表（只读索引，不含正文） */
    async list() {
      const d = await getJSON(collectionsBase() + 'index.json').catch(() => null);
      const items = d && Array.isArray(d.items) ? d.items : (Array.isArray(d) ? d : []);
      return items;
    },
    async get(id) {
      const one = await getJSON(collectionsBase() + encodeURIComponent(id) + '.json').catch(() => null);
      return one || null;
    },
    /** 新建或更新；服务端按 account 判归属 */
    async save(col) {
      const d = await api('/api/collections', { method: 'POST', body: JSON.stringify({ collection: col }) });
      try { B.api && B.api.bustCdn && B.api.bustCdn(); } catch (e) {}
      return d.collection;
    },
    async remove(id) {
      const d = await api('/api/collections?id=' + encodeURIComponent(id), { method: 'DELETE' });
      try { B.api && B.api.bustCdn && B.api.bustCdn(); } catch (e) {}
      return d;
    },
  };

  B.cloud = { content, works, collections, api, stamp };

  /* 作品分类统一到 Global Config（与主站同一份 JSON）：拿到后就地替换
     config.js 里的兜底列表。拉不到就保持原样，页面不受影响。 */
  (function bootCategories() {
    const run = () => {
      content().then((d) => {
        const bn = d && d.categories && d.categories.bn;
        if (Array.isArray(bn) && bn.length && CFG) CFG.CATEGORIES = bn.slice();
      }).catch(() => {});
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
    else run();
  })();
})(window.BKN);
