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
  const statusCbs = [];
  function setStatus(s) {
    status = s;
    statusCbs.forEach(fn => { try { fn(s); } catch (e) {} });
  }
  function onStatus(fn) { statusCbs.push(fn); fn(status); }

  /* ---------------- 令牌 ---------------- */
  function token() {
    try { return localStorage.getItem(TOK_KEY) || (B.api && B.api.auth.get()) || ''; }
    catch (e) { return ''; }
  }
  function setToken(t) { try { localStorage.setItem(TOK_KEY, t || ''); } catch (e) {} }
  function clearToken() { try { localStorage.removeItem(TOK_KEY); } catch (e) {} }

  function enabled() {
    try { return !!token() && B.prefs.get('sync.autoGist', true); }
    catch (e) { return false; }
  }

  /* ---------------- GitHub Gist API ---------------- */
  async function gapi(path, opt) {
    const t = token();
    if (!t) throw new Error('no-token');
    const o = Object.assign({
      headers: {
        'Authorization': 'Bearer ' + t,
        'Accept': 'application/vnd.github+json'
      }
    }, opt || {});
    const res = await net.fetch('https://api.github.com/gists' + path, o);
    if (res.status === 401) { setStatus('err'); throw new Error('令牌无效（401）'); }
    if (res.status === 403) { setStatus('err'); throw new Error('无 gist 权限或被限流（403）'); }
    if (res.status === 404) throw new Error('gist 不存在（404）');
    if (!res.ok) throw new Error('Gist API ' + res.status);
    return res.json();
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
      setStatus('err');
      return false;
    }
  }

  /** 删书时同步删 gist 文件 */
  async function removeBook(id) {
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
    if (!enabled()) { setStatus('off'); return out; }
    setStatus('syncing');
    let files;
    try {
      const gid = await ensureGist();
      const g = await gapi('/' + gid);
      files = g.files || {};
    } catch (e) {
      setStatus('err');
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
    } catch (e) { setStatus('err'); return false; }
  }
  async function pullProgress() {
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
  function onBookSaved(book) {
    if (!enabled() || !B.prefs.get('sync.autoGist', true)) { setStatus('off'); return; }
    if (pushTimer) clearTimeout(pushTimer);
    const delay = Math.max(3, B.prefs.get('sync.gistDelaySec', 8)) * 1000;
    pushTimer = setTimeout(() => delayedPush(book), delay);
  }

  /** 手动「立即同步」：推当前书 + 拉全量 */
  async function syncNow(book, onAsk) {
    if (!enabled()) { toast('云同步未启用：请先在设置里填写含 gist 权限的令牌', 'err'); return null; }
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

  B.gist = { enabled, ensureGist, syncBook, pullAll, pushProgress, pullProgress,
             removeBook, onBookSaved, syncNow, askConflict, token, setToken, clearToken,
             onStatus, get status() { return status; }, STATUS_LABEL: {
               off: '未启用', idle: '未同步', syncing: '同步中…', ok: '已同步', err: '同步失败'
             } };
})(window.BKN);
