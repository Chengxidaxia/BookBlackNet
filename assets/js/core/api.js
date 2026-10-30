/* ============================================================
   api.js — 书库读取 + 发布到 GitHub 仓库
   ------------------------------------------------------------
   读取：书籍索引与 .book 文件走站点相对路径（GitHub Pages 同源），
        不经过任何后端，天然免 CORS。
   写入：两种通道
        github —— 浏览器持有 PAT，直接调 Contents API；
        worker —— POST 给自建 Worker，由它代为提交。
   ============================================================ */
window.BKN = window.BKN || {};

(function (B) {
  'use strict';

  const CFG = window.BOOK || {};
  const TOKEN_KEY = 'bbn.pat';
  const MODE_KEY = 'bbn.publishMode';

  /* 跨域请求统一走网络层：站点配了同源反代就走反代，没有就直连。
     只作用于 CFG.PROXY.hosts 白名单内的地址；同源与 jsDelivr 保持直连。
     net.js 没加载时退回原生 fetch，功能不受影响。 */
  const net = (window.BNNET && window.BNNET.create)
    ? window.BNNET.create(CFG.PROXY)
    : { fetch: fetch, state: { mode: 'off' }, canProxy: () => false };

  /* ---------------- 基础 ---------------- */
  const enc = new TextEncoder();

  function utf8ToB64(str) {
    const bytes = enc.encode(str);
    let bin = '';
    const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    return btoa(bin);
  }
  function b64ToUtf8(b64) {
    const bin = atob(String(b64).replace(/\s/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  const OWNER = CFG.REPO_OWNER;
  const REPO = CFG.REPO_NAME;
  const BRANCH = CFG.BRANCH || 'main';

  const repoPath = p => 'https://api.github.com/repos/' + OWNER + '/' + REPO + p;
  const rawUrl = p => 'https://raw.githubusercontent.com/' + OWNER + '/' + REPO + '/' + BRANCH + '/' + p;

  /* ---------------- CDN / 数据源 ---------------- */
  /** jsDelivr 的 gh 基地址列表（可被 CFG.CDN.base 覆盖） */
  function cdnBases() {
    const c = CFG.CDN || {};
    if (c.base) return [String(c.base).replace(/\/+$/, '')];
    if (c.enabled === false) return [];
    const hosts = (c.hosts && c.hosts.length) ? c.hosts : ['cdn.jsdelivr.net'];
    const tail = '/gh/' + OWNER + '/' + REPO + '@' + BRANCH;
    return hosts
      .map(h => String(h).replace(/^https?:\/\//i, '').replace(/\/+$/, ''))
      .filter(Boolean)
      .map(h => 'https://' + h + tail);
  }

  const BUST_KEY = 'bbn.bust';

  /** 版本戳：默认 3 分钟分桶（命中 CDN 缓存）；发布后换唯一戳以立刻拿到新文件 */
  function stamp() {
    let b = 0;
    try { b = +(sessionStorage.getItem(BUST_KEY) || 0); } catch (e) {}
    return b ? 'b' + b : 't' + Math.floor(Date.now() / 180000);
  }

  /** 发布成功后调用：本会话内所有数据请求换新戳，绕过 CDN 旧缓存 */
  function bustCdn() {
    try { sessionStorage.setItem(BUST_KEY, String(Date.now())); } catch (e) {}
  }

  const siteTimeout = () => (CFG.CDN && CFG.CDN.siteTimeout) || 5000;

  /** 带超时的文本 GET（一个源卡住不会拖死整页） */
  async function getText(url, timeout) {
    const ms = timeout || (CFG.CDN && CFG.CDN.timeout) || 8000;
    const hasAC = typeof AbortController === 'function';
    const ac = hasAC ? new AbortController() : null;
    const timer = ac ? setTimeout(() => ac.abort(), ms) : null;
    try {
      const res = await net.fetch(url, {
        cache: 'no-store',
        credentials: 'omit',
        signal: ac ? ac.signal : undefined
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.text();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /* ---------------- 令牌 ---------------- */
  const auth = {
    get() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } },
    set(t) { try { localStorage.setItem(TOKEN_KEY, t || ''); } catch (e) {} },
    clear() { try { localStorage.removeItem(TOKEN_KEY); } catch (e) {} },
    mode() { try { return localStorage.getItem(MODE_KEY) || CFG.PUBLISH_MODE || 'github'; } catch (e) { return 'github'; } },
    setMode(m) { try { localStorage.setItem(MODE_KEY, m); } catch (e) {} }
  };

  /* ---------------- 书库读取 ---------------- */
  let _idx = [];   // 最近一次成功读到的书目，供版本戳复用

  /** 内容像不像一个 JSON 文件（挡掉 404 页 / SPA 的 HTML 兜底页） */
  const looksJSON = txt => !!txt && txt.replace(/^\uFEFF/, '').trim()[0] === '{';

  /**
   * CDN 多节点并发竞速：谁先成功就用谁。
   * 实测国内 cdn.jsdelivr.net / fastly 经常整段超时，串行会白等十几秒；
   * 并发之后总耗时 = 最快节点的耗时，慢节点不影响。
   */
  function raceText(list) {
    if (!list.length) return Promise.reject(new Error('未配置 CDN 节点'));
    return Promise.any(list.map(async c => ({
      url: c.url,
      src: c.src,
      txt: await getText(c.url)
    })));
  }

  function parseIndex(txt) {
    const data = JSON.parse(txt);
    const books = Array.isArray(data) ? data : (data && data.books);
    return Array.isArray(books) ? books.filter(b => b && b.id) : null;
  }

  /**
   * 读取书目索引：同源 →（jsDelivr 各节点并发）→ raw.githubusercontent。
   * @param {{stamp?:string}} [opt] 传入固定戳可强制走某个缓存版本
   * @returns {Promise<{books:Array, source:string, url:string}>}
   */
  async function loadIndex(opt) {
    const st = (opt && opt.stamp) || stamp();

    // ① 同源：几毫秒就有结果，失败也很快
    const siteUrl = CFG.INDEX_FILE + '?v=' + st;
    try {
      const books = parseIndex(await getText(siteUrl, siteTimeout()));
      if (books) { _idx = books; return { books, source: 'site', url: siteUrl }; }
    } catch (e) { /* 下一层 */ }

    // ② CDN 并发竞速
    const cdnList = cdnBases().map(b => ({ url: b + '/' + CFG.INDEX_FILE + '?v=' + st, src: 'cdn' }));
    try {
      const hit = await raceText(cdnList);
      const books = parseIndex(hit.txt);
      if (books) { _idx = books; return { books, source: 'cdn', url: hit.url }; }
    } catch (e) { /* 下一层 */ }

    // ③ raw 兜底
    const rawU = rawUrl(CFG.INDEX_FILE) + '?v=' + st;
    try {
      const books = parseIndex(await getText(rawU));
      if (books) { _idx = books; return { books, source: 'raw', url: rawU }; }
    } catch (e) { /* 全挂 */ }

    _idx = [];
    return { books: [], source: 'none', url: '' };
  }

  function bookPath(id) {
    return CFG.BOOKS_DIR + '/' + String(id).replace(/[^\w.-]/g, '') + '.book';
  }
  /** 书籍文件的版本戳：优先用索引里的 updatedAt（内容寻址，缓存友好） */
  function verOf(id) {
    const hit = _idx.find(b => b && b.id === id);
    if (hit && hit.updatedAt) {
      const v = String(hit.updatedAt).replace(/[^\d]/g, '');
      if (v) return v;
    }
    return '';
  }
  const bookUrl = id => bookPath(id) + '?v=' + (verOf(id) || stamp());

  /** 取回 .book 文本。层级与 loadIndex 一致。 */
  async function fetchBook(id, ver) {
    const p = bookPath(id);
    const v = ver || verOf(id) || stamp();

    const siteUrl = p + '?v=' + v;
    try {
      const txt = await getText(siteUrl, siteTimeout());
      if (looksJSON(txt)) return txt;
    } catch (e) { /* 下一层 */ }

    try {
      const hit = await raceText(cdnBases().map(b => ({ url: b + '/' + p + '?v=' + v, src: 'cdn' })));
      if (looksJSON(hit.txt)) return hit.txt;
    } catch (e) { /* 下一层 */ }

    try {
      const txt = await getText(rawUrl(p) + '?v=' + v);
      if (looksJSON(txt)) return txt;
    } catch (e) { /* 全挂 */ }

    throw new Error('无法获取书籍文件（同源 / jsDelivr / raw 均失败）');
  }

  /* ---------------- GitHub 底层 ---------------- */
  async function gh(path, opt) {
    const token = auth.get();
    if (!token) throw new Error('尚未填写 GitHub 访问令牌');
    const o = Object.assign({
      headers: {
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    }, opt || {});
    const res = await net.fetch(repoPath(path), o);
    if (res.status === 401) throw new Error('令牌无效或已过期（401）');
    if (res.status === 403) throw new Error('权限不足或被限流（403），请确认令牌含 repo / contents:write 权限');
    if (res.status === 404) throw new Error('仓库或路径不存在（404）：' + CFG.REPO_OWNER + '/' + CFG.REPO_NAME);
    if (!res.ok) {
      let msg = 'HTTP ' + res.status;
      try { const j = await res.json(); if (j && j.message) msg += ' · ' + j.message; } catch (e) {}
      throw new Error(msg);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  async function ghGet(path) {
    try {
      const j = await gh('/contents/' + encodeURI(path) + '?ref=' + (CFG.BRANCH || 'main'));
      if (!j || !j.sha) return null;
      return { sha: j.sha, content: j.content ? b64ToUtf8(j.content) : '' };
    } catch (e) {
      if (/404/.test(e.message)) return null;
      throw e;
    }
  }

  async function ghPut(path, text, message, sha) {
    const body = {
      message: message,
      content: utf8ToB64(text),
      branch: CFG.BRANCH || 'main'
    };
    if (sha) body.sha = sha;
    return gh('/contents/' + encodeURI(path), {
      method: 'PUT',
      body: JSON.stringify(body)
    });
  }

  /** 校验令牌 + 仓库可写 */
  async function checkToken() {
    const token = auth.get();
    if (!token) throw new Error('尚未填写令牌');
    const res = await net.fetch('https://api.github.com/user', {
      headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json' }
    });
    if (!res.ok) throw new Error('令牌校验失败（' + res.status + '）');
    const user = await res.json();
    const repo = await gh('').catch(e => { throw new Error(e.message); });
    return { user: user.login, repo: repo.full_name, private: repo.private, push: !!(repo.permissions && repo.permissions.push) };
  }

  /* ---------------- 发布 ---------------- */
  /**
   * @param {Object} packed  {json, fileName}
   * @param {Object} meta    书籍元数据（用于更新索引）
   * @returns {Promise<{mode:string, sha?:string, url?:string}>}
   */
  async function publish(packed, meta) {
    const mode = auth.mode();
    const r = mode === 'worker'
      ? await publishViaWorker(packed, meta)
      : await publishViaGitHub(packed, meta);
    bustCdn();          // 发布成功：本会话立刻读新文件，不吃 CDN 旧缓存
    return r;
  }

  async function publishViaGitHub(packed, meta) {
    const bpath = CFG.BOOKS_DIR + '/' + packed.fileName;
    const old = await ghGet(bpath);
    const put = await ghPut(bpath, packed.json, 'book: ' + (meta.title || meta.id) + ' (publish)', old && old.sha);

    // 更新索引：读 → 合并 → 写
    const idx = await ghGet(CFG.INDEX_FILE);
    let list = [];
    if (idx && idx.content) {
      try { const j = JSON.parse(idx.content); list = Array.isArray(j) ? j : (j.books || []); } catch (e) { list = []; }
    }
    const entry = B.crypto.summaryOf(Object.assign({}, meta, {
      chapters: meta.chapters, words: meta.words, updatedAt: new Date().toISOString()
    }));
    entry.file = packed.fileName;
    list = list.filter(b => b && b.id !== entry.id);
    list.unshift(entry);
    list = list.slice(0, 500);
    const idxText = JSON.stringify({ format: 'bookblacknet.index', v: 1, updatedAt: new Date().toISOString(), books: list }, null, 2);
    await ghPut(CFG.INDEX_FILE, idxText, 'index: publish ' + (meta.title || entry.id), idx && idx.sha);

    return { mode: 'github', sha: put && put.content && put.content.sha, url: bookPath(meta.id) };
  }

  async function publishViaWorker(packed, meta) {
    const base = (CFG.API_BASE || '').replace(/\/$/, '');
    if (!base) throw new Error('未配置 API_BASE，无法使用 Worker 通道');
    const res = await fetch(base + '/publish', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file: CFG.BOOKS_DIR + '/' + packed.fileName,
        index: CFG.INDEX_FILE,
        content: packed.json,
        entry: Object.assign(B.crypto.summaryOf(meta), { file: packed.fileName })
      })
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.ok) throw new Error(j.error || ('发布失败（HTTP ' + res.status + '）'));
    return { mode: 'worker', sha: j.sha, url: j.url || bookPath(meta.id) };
  }

  async function unpublish(id) {
    const bpath = bookPath(id);
    if (auth.mode() === 'worker') {
      const base = (CFG.API_BASE || '').replace(/\/$/, '');
      const res = await fetch(base + '/unpublish', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: id })
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) throw new Error(j.error || '下架失败');
      bustCdn();
      return true;
    }
    const old = await ghGet(bpath);
    if (!old) return true;
    await gh('/contents/' + encodeURI(bpath), {
      method: 'DELETE',
      body: JSON.stringify({ message: 'book: unpublish ' + id, sha: old.sha, branch: CFG.BRANCH || 'main' })
    });
    const idx = await ghGet(CFG.INDEX_FILE);
    if (idx && idx.content) {
      try {
        const j = JSON.parse(idx.content);
        const list = (Array.isArray(j) ? j : (j.books || [])).filter(b => b && b.id !== id);
        await ghPut(CFG.INDEX_FILE, JSON.stringify({ format: 'bookblacknet.index', v: 1, updatedAt: new Date().toISOString(), books: list }, null, 2),
          'index: remove ' + id, idx.sha);
      } catch (e) {}
    }
    bustCdn();
    return true;
  }

  B.api = { loadIndex, fetchBook, bookPath, bookUrl, publish, unpublish,
            checkToken, auth, utf8ToB64, b64ToUtf8, ghGet, ghPut,
            cdnBases, stamp, bustCdn, verOf, net };
})(window.BKN);
