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

  /* 令牌解析顺序：
     ① 本机 PAT（localStorage）
     ② 群档案登录态 —— 同源 /api/token Function 读取 HttpOnly Cookie
        github_token（Domain=.blacknet.cc.cd）并原样返回给本人。
        结果做会话级缓存，避免每次 API 调用都多一跳。 */
  let _ghTok = null;
  async function resolveToken(force) {
    const pat = auth.get();
    if (pat) return pat;
    if (!force && _ghTok) return _ghTok;
    try {
      const r = await net.fetch('/api/token', { credentials: 'include' });
      if (r.ok) {
        const j = await r.json();
        if (j && j.token) { _ghTok = j.token; return _ghTok; }
      }
    } catch (e) { /* 本地预览无 Function、或未登录 */ }
    return '';
  }

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

  /* ---------------- 分块（chunked .book） ----------------
     仓库里每个文件不超过 10MiB（GitHub / Pages / jsDelivr 对单文件都更
     友好）。约定：
       <id>.book          → 清单（小 JSON，明文，含 parts 文件名列表）
       <id>.book.p001...  → 正文 JSON 的字符串切片（按顺序拼接即原文）
     加载端：取到清单后逐块取回并拼接；遇到旧版单文件 .book 也兼容。 */
  const CHUNK_MAX = 10 * 1024 * 1024;   // 每块上限（UTF-8 字节数）

  /** 字符串的 UTF-8 字节长度（含代理对处理） */
  function utf8Len(str) {
    let n = 0;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xD800 && c <= 0xDBFF) n += 4;   // 增补平面字符（代理对整体 4 字节）
      else if (c >= 0xDC00 && c <= 0xDFFF) { /* 低代理已计入高位 */ }
      else n += 3;
    }
    return n;
  }

  /** 把字符串切成若干 UTF-8 字节数 ≤ max 的片。不在代理对中间切断。 */
  function splitChunks(str, max) {
    const parts = [];
    let start = 0, n = 0;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      let b = c < 0x80 ? 1 : c < 0x800 ? 2 : (c >= 0xD800 && c <= 0xDBFF) ? 4 : (c >= 0xDC00 && c <= 0xDFFF) ? 0 : 3;
      if (n + b > max) {
        let cut = i;
        if (str.charCodeAt(i - 1) >= 0xD800 && str.charCodeAt(i - 1) <= 0xDBFF) cut = i - 1; // 别拆散代理对
        parts.push(str.slice(start, cut));
        start = cut; n = 0;
      }
      n += b;
    }
    if (start < str.length) parts.push(str.slice(start));
    return parts;
  }

  /** 生成清单对象与分块文件名 */
  function makeChunks(json, fileName) {
    const parts = splitChunks(json, CHUNK_MAX);
    const names = parts.map((_, i) => fileName + '.p' + String(i + 1).padStart(3, '0'));
    const manifest = JSON.stringify({
      format: 'bookblacknet.chunks', v: 1,
      parts: names, size: utf8Len(json),
      updatedAt: new Date().toISOString()
    });
    return { manifest, parts, names };
  }
  const isManifest = txt => {
    try { const j = JSON.parse(txt); return (j && j.format === 'bookblacknet.chunks') ? j : null; }
    catch (e) { return null; }
  };
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

  /** 按既定层级取单个路径的文本，返回 {txt, layer}；全挂则抛错 */
  async function fetchLayer(p, v) {
    try {
      return { txt: await getText(p + '?v=' + v, siteTimeout()), layer: 'site' };
    } catch (e) { /* 下一层 */ }
    try {
      const hit = await raceText(cdnBases().map(b => ({ url: b + '/' + p + '?v=' + v, src: 'cdn' })));
      return { txt: hit.txt, layer: 'cdn', url: hit.url };
    } catch (e) { /* 下一层 */ }
    return { txt: await getText(rawUrl(p) + '?v=' + v), layer: 'raw' };
  }

  /** 取回 .book 全文（自动识别分块清单并拼接）。层级与 loadIndex 一致。 */
  async function fetchBook(id, ver) {
    const p = bookPath(id);
    const v = ver || verOf(id) || stamp();
    const dir = p.slice(0, p.lastIndexOf('/') + 1);

    // 逐层尝试：某层拿到清单后，同层取分块；分块失败再落到下一层
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      let r;
      try { r = await fetchLayer(p, v); }
      catch (e) { throw new Error('无法获取书籍文件（同源 / jsDelivr / raw 均失败）'); }

      const man = isManifest(r.txt);
      if (!man) return r.txt;                       // 旧版单文件，直接返回

      try {
        const segs = [];
        for (const name of man.parts) {             // 顺序取，避免打爆 CDN
          const pp = dir + name;
          let t;
          if (r.layer === 'site') t = await getText(pp + '?v=' + v, siteTimeout());
          else if (r.layer === 'cdn') {
            const hit = await raceText(cdnBases().map(b => ({ url: b + '/' + pp + '?v=' + v, src: 'cdn' })));
            t = hit.txt;
          } else t = await getText(rawUrl(pp) + '?v=' + v);
          segs.push(t);
        }
        const full = segs.join('');
        if (looksJSON(full)) return full;
        throw new Error('分块拼接后不是有效 JSON');
      } catch (e) { lastErr = e; /* 换一层重试 */ }
    }
    throw new Error('书籍分块下载失败：' + ((lastErr && lastErr.message) || '所有数据源均不可用'));
  }

  /* ---------------- GitHub 底层 ---------------- */
  async function gh(path, opt) {
    const token = await resolveToken();
    if (!token) throw new Error('尚未填写 GitHub 访问令牌（或未在群档案登录 GitHub 账号）');
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
    const token = await resolveToken(true);
    if (!token) throw new Error('尚未填写令牌，且未在群档案登录');
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

    // 分块：每个仓库文件 ≤ 10MiB。正文切块，清单写在原 .book 路径。
    const { manifest, parts, names } = makeChunks(packed.json, packed.fileName);

    // 旧清单里的分块名（发布后要清掉不再使用的块）
    const old = await ghGet(bpath);
    let staleParts = [];
    if (old && old.content) {
      const m = isManifest(old.content);
      if (m) staleParts = (m.parts || []).filter(n => names.indexOf(n) === -1);
    }

    // ① 先写分块（读者拿到新清单时块必须已就位）
    for (let i = 0; i < parts.length; i++) {
      const pp = CFG.BOOKS_DIR + '/' + names[i];
      const po = await ghGet(pp);
      await ghPut(pp, parts[i], 'book part ' + (i + 1) + '/' + parts.length + ': ' + (meta.title || meta.id), po && po.sha);
    }
    // ② 再写清单（原子切换到新版本）
    await ghPut(bpath, manifest, 'book: ' + (meta.title || meta.id) + ' (publish, ' + parts.length + ' part' + (parts.length > 1 ? 's' : '') + ')', old && old.sha);
    // ③ 清理旧版本遗留块
    for (const name of staleParts) {
      const po = await ghGet(CFG.BOOKS_DIR + '/' + name);
      if (po) {
        await gh('/contents/' + encodeURI(CFG.BOOKS_DIR + '/' + name), {
          method: 'DELETE',
          body: JSON.stringify({ message: 'book: drop stale part ' + name, sha: po.sha, branch: BRANCH })
        }).catch(() => {});
      }
    }

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
    entry.chunks = names.length;
    list = list.filter(b => b && b.id !== entry.id);
    list.unshift(entry);
    list = list.slice(0, 500);
    const idxText = JSON.stringify({ format: 'bookblacknet.index', v: 1, updatedAt: new Date().toISOString(), books: list }, null, 2);
    await ghPut(CFG.INDEX_FILE, idxText, 'index: publish ' + (meta.title || entry.id), idx && idx.sha);

    return { mode: 'github', url: bookPath(meta.id), parts: names.length };
  }

  async function publishViaWorker(packed, meta) {
    const base = (CFG.API_BASE || '').replace(/\/$/, '');
    if (!base) throw new Error('未配置 API_BASE，无法使用 Worker 通道');
    if (utf8Len(packed.json) > CHUNK_MAX) {
      throw new Error('本书超过 10MiB，Worker 通道暂不支持分块，请改用 GitHub 令牌发布');
    }
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
    // 先删分块（若有），再删清单
    const m = old.content ? isManifest(old.content) : null;
    if (m && m.parts && m.parts.length) {
      for (const name of m.parts) {
        const po = await ghGet(CFG.BOOKS_DIR + '/' + name);
        if (po) {
          await gh('/contents/' + encodeURI(CFG.BOOKS_DIR + '/' + name), {
            method: 'DELETE',
            body: JSON.stringify({ message: 'book: unpublish part ' + name, sha: po.sha, branch: BRANCH })
          }).catch(() => {});
        }
      }
    }
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
            checkToken, auth, resolveToken, utf8ToB64, b64ToUtf8, ghGet, ghPut,
            cdnBases, stamp, bustCdn, verOf, net };
})(window.BKN);
