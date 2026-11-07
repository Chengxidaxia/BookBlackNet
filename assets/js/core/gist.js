/* ============================================================
   gist.js — 云端草稿 & 阅读进度同步（GitHub secret Gist）
   ------------------------------------------------------------
   数据结构：一个 secret gist（描述 BookBlackNet workspace v1）
     bbn-book-<bookId>.json = { format:'bookblacknet.gist', v:1,
                                bookId, updatedAt, book:{...} }
     bbn-progress.json      = { format:'bookblacknet.progress', v:1,
                                updatedAt, progress:{ <id>:{c,ratio,at,bookmarks} } }
   每书一文件：PATCH 只推脏文件，最省限流；删书即删文件；
   单本书可达数 MB 也不会拖垮整包。

   令牌：设置里填「GitHub 访问令牌」即可（classic token 需 gist
   scope；fine-grained 不支持 gist）。也可单独存 bbn.gist.pat。
   403 / 断网 → status='err'/'off'，静默降级纯本地，不打扰写作。

   冲突协议（按 updatedAt 比对）：
     dirty = 本地 updatedAt > 本地记录的 lastSyncedAt[bookId]
     本地新        → push
     云新+本地干净  → 静默拉取 + toast
     云新+本地脏   → 三选弹窗（用云端 / 保留本地 / 两份都留）
     无本地        → 提示拉取入库
   ============================================================ */
window.BKN = window.BKN || {};

(function (B) {
  'use strict';

  const { el, toast } = B.util;
  const CFG = window.BOOK || {};
  const DESC = 'BookBlackNet workspace v1';
  const ID_KEY = 'bbn.gist.id';
  const TOK_KEY = 'bbn.gist.pat';
  const SYNCED_KEY = 'bbn.gist.syncedAt';
  const net = (window.BNNET && window.BNNET.create)
    ? window.BNNET.create(CFG.PROXY)
    : { fetch: fetch };

  let status = 'idle';   // off | idle | syncing | ok | err
  let lastErr = '';      // 最近一次失败原因（状态条点击时提示用）
  const statusCbs = [];
  function setStatus(s, why) {
    status = s;
    if (s === 'err' && why) lastErr = String(why);
    if (s === 'ok') lastErr = '';
    statusCbs.forEach(fn => { try { fn(s); } catch (e) {} });
  }
  function onStatus(fn) { statusCbs.push(fn); fn(status); }
  function lastError() { return lastErr; }

  /* ---------------- 令牌 ----------------
     解析顺序：
       ① 设置里单独填的 Gist 令牌（bbn.gist.pat）
       ② 发布令牌（bbn.pat，localStorage）
       ③ 群档案登录态换来的令牌（同源 /api/token 读 HttpOnly Cookie，会话级缓存）
     ③ 让「用群档案账号登录」的用户不需要再手动填令牌就能自动云同步。 */
  let _sessionTok = '';

  function token() {
    try {
      return localStorage.getItem(TOK_KEY) || (B.api && B.api.auth.get()) || _sessionTok || '';
    } catch (e) { return _sessionTok || ''; }
  }

  async function ensureToken() {
    if (token()) return token();
    if (B.api && B.api.resolveToken) {
      try { _sessionTok = (await B.api.resolveToken()) || ''; } catch (e) { _sessionTok = ''; }
    }
    return token();
  }
  function setToken(t) { try { localStorage.setItem(TOK_KEY, t || ''); } catch (e) {} }
  function clearToken() { try { localStorage.removeItem(TOK_KEY); } catch (e) {} }

  function enabled() {
    try { return !!token() && B.prefs.get('sync.autoGist', true); }
    catch (e) { return false; }
  }

  /* ---------------- GitHub Gist API ---------------- */
  async function gapi(path, opt) {
    const t = await ensureToken();
    if (!t) throw new Error('no-token');
    const o = Object.assign({
      headers: {
        'Authorization': 'Bearer ' + t,
        'Accept': 'application/vnd.github+json'
      }
    }, opt || {});
    const res = await net.fetch('https://api.github.com/gists' + path, o);
    if (res.status === 401) {
      const m = '登录已失效（401）：请重新用 GitHub 登录，或在设置里填写含 gist 权限的令牌';
      setStatus('err', m); throw new Error(m);
    }
    if (res.status === 403) {
      // 最常见的原因：授权时没申请 gist 域（旧版 OAuth 只申请了 public_repo）
      const m = '账号缺少 gist 权限（403）：请退出后用 GitHub 重新登录并同意 gist，或在设置里填写含 gist 的令牌';
      setStatus('err', m); throw new Error(m);
    }
    if (res.status === 404) { const m = 'Gist 不存在（404）'; setStatus('err', m); throw new Error(m); }
    if (!res.ok) { const m = 'Gist API ' + res.status; setStatus('err', m); throw new Error(m); }
    return res.json();
  }

  /* ---------------- 权限自检 ----------------
     GitHub 在任何鉴权请求的响应头里回 x-oauth-scopes。旧令牌（授权时
     还没申请 gist 域）要等到第一次写 gist 才 403，用户只看到「同步失败」。
     这里在页面预热令牌后就问一次，提前把「需要重新授权」说清楚。
     · 响应头被代理吞掉（拿不到）时一律当作通过，不做误报；
     · 每个页面只查一次，不额外消耗限流。 */
  let _scopeChecked = false;
  let _scopes = null;

  async function checkScope(force) {
    if (_scopeChecked && !force) return _scopes ? _scopes.indexOf('gist') >= 0 : true;
    const t = await ensureToken();
    if (!t) return false;
    _scopeChecked = true;
    try {
      const res = await net.fetch('https://api.github.com/user', {
        headers: { 'Authorization': 'Bearer ' + t, 'Accept': 'application/vnd.github+json' }
      });
      const raw = res.headers.get('x-oauth-scopes');
      if (raw === null) return true;                       // 无法判断 → 不拦
      _scopes = raw.split(',').map(s => s.trim()).filter(Boolean);
      const ok = _scopes.indexOf('gist') >= 0;
      if (!ok && status !== 'err') {
        setStatus('err', '令牌缺少 gist 权限（当前：' + (_scopes.join(', ') || '无') +
          '）：请先退出登录，再用 GitHub 重新登录并同意 gist，或在设置里填写含 gist 的令牌');
      }
      return ok;
    } catch (e) { return true; }
  }

  /** 找到或创建 workspace gist，返回 gist id */
  async function ensureGist() {
    const saved = localStorage.getItem(ID_KEY);
    if (saved) {
      try { await gapi('/' + saved); return saved; }
      catch (e) { localStorage.removeItem(ID_KEY); }  // 失效则重建
    }
    // 从自己的 gist 列表里找
    try {
      const list = await gapi('?per_page=100');
      const hit = (Array.isArray(list) ? list : []).find(g => g.description === DESC);
      if (hit) { localStorage.setItem(ID_KEY, hit.id); return hit.id; }
    } catch (e) { /* 列表失败不阻断创建 */ }
    const created = await gapi('', {
      method: 'POST',
      body: JSON.stringify({
        description: DESC,
        public: false,
        files: { 'bbn-progress.json': { content: JSON.stringify({ format: 'bookblacknet.progress', v: 1, updatedAt: new Date().toISOString(), progress: {} }) } }
      })
    });
    localStorage.setItem(ID_KEY, created.id);
    return created.id;
  }

  /* ---------------- 同步时间戳 ---------------- */
  function syncedMap() { return B.util.store.get(SYNCED_KEY, {}); }
  function markSynced(id) {
    const m = syncedMap();
    m[id] = new Date().toISOString();
    B.util.store.set(SYNCED_KEY, m);
  }

  /* ---------------- 书稿同步 ---------------- */
  const bookFile = id => 'bbn-book-' + String(id).replace(/[^\w.-]/g, '') + '.json';

  /** 推一本书（脏才推） */
  async function syncBook(book, force) {
    await ensureToken();
    if (!enabled()) { setStatus('off'); return false; }
    const m = syncedMap();
    const dirty = force || !m[book.id] || String(book.updatedAt || '') > String(m[book.id] || '');
    if (!dirty) return false;
    setStatus('syncing');
    try {
      const gid = await ensureGist();
      const wrap = {
        format: 'bookblacknet.gist', v: 1,
        bookId: book.id, updatedAt: book.updatedAt || new Date().toISOString(),
        book: book
      };
      await gapi('/' + gid, {
        method: 'PATCH',
        body: JSON.stringify({ files: { [bookFile(book.id)]: { content: JSON.stringify(wrap) } } })
      });
      markSynced(book.id);
      setStatus('ok');
      return true;
    } catch (e) {
      if (e.message !== 'no-token') console.warn('[gist] push', book.id, e.message);
      setStatus('err', e.message === 'no-token' ? '未登录：请先用 GitHub 登录或在设置里填写令牌' : e.message);
      return false;
    }
  }

  /** 删书时同步删 gist 文件 */
  async function removeBook(id) {
    await ensureToken();
    if (!enabled()) return false;
    try {
      const gid = localStorage.getItem(ID_KEY);
      if (!gid) return false;
      await gapi('/' + gid, {
        method: 'PATCH',
        body: JSON.stringify({ files: { [bookFile(id)]: null } })
      });
      const m = syncedMap(); delete m[id]; B.util.store.set(SYNCED_KEY, m);
      return true;
    } catch (e) { setStatus('err'); return false; }
  }

  /**
   * 启动时全量核对：拉取云端书目，与本地逐本比对。
   * onAsk(bookMeta, choice) 由调用方注入三选弹窗；
   * 缺省时云新+本地脏 → 保留本地（安全侧）。
   * @returns {Promise<{pulled:string[], pushed:string[], conflicts:number}>}
   */
  async function pullAll(onAsk) {
    const out = { pulled: [], pushed: [], conflicts: 0 };
    await ensureToken();
    if (!enabled()) { setStatus('off'); return out; }
    setStatus('syncing');
    let files;
    try {
      const gid = await ensureGist();
      const g = await gapi('/' + gid);
      files = g.files || {};
    } catch (e) {
      setStatus('err', e.message);
      return out;
    }
    for (const name of Object.keys(files)) {
      if (!name.startsWith('bbn-book-') || !files[name] || !files[name].content) continue;
      let wrap;
      try { wrap = JSON.parse(files[name].content); } catch (e) { continue; }
      if (!wrap || wrap.format !== 'bookblacknet.gist' || !wrap.book) continue;
      const cloud = wrap.book;
      const local = await B.store.get(cloud.id);
      const m = syncedMap();
      const dirty = local && (!m[cloud.id] || String(local.updatedAt || '') > String(m[cloud.id] || ''));

      if (!local) {
        // 云端有、本地没有：直接拉取入库（原本机删掉的书会复活，可接受：
        // gist 是备份区，不承担删除语义；真要删用「删除书稿」触发 removeBook）
        await B.store.save(cloud);
        markSynced(cloud.id);
        out.pulled.push(cloud.meta && cloud.meta.title || cloud.id);
        continue;
      }
      const cloudNewer = String(cloud.updatedAt || '') > String(local.updatedAt || '');
      if (cloudNewer && !dirty) {
        await B.store.save(cloud);
        markSynced(cloud.id);
        out.pulled.push(cloud.meta && cloud.meta.title || cloud.id);
      } else if (cloudNewer && dirty) {
        out.conflicts++;
        let choice = 'local';
        if (onAsk) {
          choice = await onAsk(cloud, local);
        }
        if (choice === 'cloud') {
          await B.store.save(cloud);
          markSynced(cloud.id);
          out.pulled.push(cloud.meta && cloud.meta.title || cloud.id);
        } else if (choice === 'both') {
          const copy = JSON.parse(JSON.stringify(cloud));
          copy.id = cloud.id + '_c';
          if (copy.meta) copy.meta.id = copy.id;
          await B.store.save(copy);
          out.pulled.push((copy.meta && copy.meta.title || copy.id) + '（副本）');
        } else {
          await syncBook(local, true);   // 保留本地并强推
          out.pushed.push(local.meta && local.meta.title || local.id);
        }
      } else if (!cloudNewer && dirty) {
        await syncBook(local, true);
        out.pushed.push(local.meta && local.meta.title || local.id);
      } else {
        markSynced(local.id);  // 两边一致（云端可能更新过）
      }
    }
    setStatus('ok');
    return out;
  }

  /* ---------------- 阅读进度 ---------------- */
  async function pushProgress(progressMap) {
    await ensureToken();
    if (!enabled()) return false;
    try {
      const gid = await ensureGist();
      await gapi('/' + gid, {
        method: 'PATCH',
        body: JSON.stringify({
          files: { 'bbn-progress.json': { content: JSON.stringify({ format: 'bookblacknet.progress', v: 1, updatedAt: new Date().toISOString(), progress: progressMap }) } }
        })
      });
      return true;
    } catch (e) { setStatus('err', e.message); return false; }
  }
  async function pullProgress() {
    await ensureToken();
    if (!enabled()) return null;
    try {
      const gid = localStorage.getItem(ID_KEY) || await ensureGist();
      const g = await gapi('/' + gid);
      const f = g.files && g.files['bbn-progress.json'];
      if (!f || !f.content) return null;
      const j = JSON.parse(f.content);
      return (j && j.progress) ? j : null;
    } catch (e) { return null; }
  }

  /* ---------------- 编辑器自动同步 ---------------- */
  let pushTimer = null;
  let lastPush = 0;
  function delayedPush(book) {
    const gap = Date.now() - lastPush;
    if (gap < 10000) { setTimeout(() => delayedPush(book), 10000 - gap); return; }
    lastPush = Date.now();
    syncBook(book, false);
  }
  async function onBookSaved(book) {
    await ensureToken();
    if (!enabled() || !B.prefs.get('sync.autoGist', true)) { setStatus('off'); return; }
    if (pushTimer) clearTimeout(pushTimer);
    const delay = Math.max(3, B.prefs.get('sync.gistDelaySec', 8)) * 1000;
    pushTimer = setTimeout(() => delayedPush(book), delay);
  }

  /** 手动「立即同步」：推当前书 + 拉全量 */
  async function syncNow(book, onAsk) {
    await ensureToken();
    if (!enabled()) { toast('云同步未启用：请先在设置里填写含 gist 权限的令牌', 'err'); return null; }
    // 令牌在但不含 gist → 直接说清楚，不要等 PATCH 回来 403
    if (!(await checkScope())) {
      toast(B.gist.lastError() || '当前令牌缺少 gist 权限，请重新授权', 'err');
      return null;
    }
    setStatus('syncing');
    if (book) await syncBook(book, true);
    const r = await pullAll(onAsk).catch(() => null);
    if (r) toast('云同步完成' + (r.pulled.length ? '，拉取 ' + r.pulled.length + ' 本' : '') + (r.pushed.length ? '，推送 ' + r.pushed.length + ' 本' : ''), 'ok');
    return r;
  }

  /** 冲突三选弹窗：返回 'cloud' | 'local' | 'both' */
  function askConflict(cloud, local) {
    return new Promise(resolve => {
      const title = '《' + ((local.meta && local.meta.title) || local.id) + '》云端与本地都有改动';
      B.ui.dialog({
        title: title,
        body: el('div.stack.gap-10',
          el('div.small', { text: '云端更新于 ' + (cloud.updatedAt || '?').replace('T', ' ').slice(0, 16) + '；本机改动于 ' + (local.updatedAt || '?').replace('T', ' ').slice(0, 16) + '。' }),
          el('div.hint', { text: '选错不会丢数据：选「两份都留」最稳妥。' })
        ),
        actions: [
          { label: '用云端版本', cls: 'primary', onClick: ({ close }) => { close(); resolve('cloud'); } },
          { label: '保留本机', onClick: ({ close }) => { close(); resolve('local'); } },
          { label: '两份都留', onClick: ({ close }) => { close(); resolve('both'); } }
        ]
      });
    });
  }

  // 页面打开就预热一次令牌：群档案登录态 → Cookie 里的 GitHub 令牌，
  // 之后编辑器保存时 enabled() 直接为 true，自动同步无需用户再点任何东西。
  if (B.api && B.api.resolveToken) {
    ensureToken().then(t => {
      if (!t) return;
      if (status === 'idle') setStatus('idle');
      checkScope().catch(() => {});   // 缺 gist 时 checkScope 内部会把状态标红并写明原因
    }).catch(() => {});
  }

  B.gist = { enabled, ensureGist, syncBook, pullAll, pushProgress, pullProgress,
             removeBook, onBookSaved, syncNow, askConflict, token, setToken, clearToken,
             checkScope, scopes: () => _scopes,
             onStatus, lastError, get status() { return status; }, STATUS_LABEL: {
               off: '未启用', idle: '未同步', syncing: '同步中…', ok: '已同步', err: '同步失败'
             } };
})(window.BKN);
