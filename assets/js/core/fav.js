/* ============================================================
   fav.js — 「我的书架」数据层：收藏 + 最近阅读进度
   ------------------------------------------------------------
   存储：
     本机  bbn.fav            → [{ id, title, author, cover, at }]
     本机  bbn.progress.<id>  → { c, ratio, at }          （read.js 写入）
     本机  bbn.shelf          → 最近阅读条目（read.js 写入，最多 24）

   账号（可选）：
     GET/POST /api/shelf      → { format:'bookblacknet.shelf', v:1, at, fav, progress }
     认证：邮箱 Bearer 令牌，或群档案 GitHub 会话（Cookie）；
     两者都没有时本模块只在本地工作，UI 上明确提示「仅保存在本机」。

   合并规则：按 id 取 at 较新的一份；收藏与进度都各自合并，
   所以「未登录时收藏了几本 → 登录后」不会丢，云端多出来的也会补到本机。
   ============================================================ */
window.BKN = window.BKN || {};

(function (B) {
  'use strict';

  const { util, toast } = B;
  const LS = util.store;
  const CFG = window.BOOK || {};

  const FAV_KEY = 'bbn.fav';
  const PROG_PREFIX = 'bbn.progress.';
  const ENDPOINT = (CFG.SHELF_URL || '/api/shelf');
  const FAV_MAX = 200;
  const PROG_MAX = 200;

  let status = 'idle';          // idle | syncing | ok | local | err
  let lastSyncAt = '';
  const listeners = [];
  let pushTimer = 0;
  let syncing = false;

  function emit() {
    listeners.forEach(fn => { try { fn(status, lastSyncAt); } catch (e) {} });
  }
  function onChange(fn) { listeners.push(fn); fn(status, lastSyncAt); }

  /* ---------------- 收藏 ---------------- */
  function list() {
    const arr = LS.get(FAV_KEY, []);
    return Array.isArray(arr) ? arr.filter(x => x && x.id) : [];
  }
  function save(arr) {
    const clean = arr.filter(x => x && x.id)
      .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
      .slice(0, FAV_MAX);
    LS.set(FAV_KEY, clean);
    emit();
    queuePush();
    return clean;
  }
  function has(id) { return list().some(x => x.id === id); }

  function add(book) {
    if (!book || !book.id) return false;
    const item = {
      id: book.id,
      title: book.title || '未命名作品',
      author: book.author || '',
      cover: book.cover || null,
      at: new Date().toISOString()
    };
    save([item].concat(list().filter(x => x.id !== book.id)));
    return true;
  }
  function remove(id) {
    save(list().filter(x => x.id !== id));
  }
  function toggle(book) {
    if (has(book.id)) { remove(book.id); return false; }
    add(book); return true;
  }

  /* ---------------- 阅读进度 ---------------- */
  function progressMap() {
    const out = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || k.indexOf(PROG_PREFIX) !== 0) continue;
        const id = k.slice(PROG_PREFIX.length);
        const v = LS.get(k, null);
        if (v && typeof v === 'object') out[id] = v;
      }
    } catch (e) {}
    return out;
  }

  function saveProgressMap(map) {
    const ids = Object.keys(map)
      .sort((a, b) => String(map[b].at || '').localeCompare(String(map[a].at || '')))
      .slice(0, PROG_MAX);
    ids.forEach(id => LS.set(PROG_PREFIX + id, map[id]));
  }

  /** read.js 每次存进度后调用：触发本地事件 + 延迟上云 */
  function progressChanged() {
    queuePush();
  }

  /* ---------------- 最近阅读（书架页用） ---------------- */
  function recent(limit) {
    const prog = progressMap();
    const seen = {};
    const items = [];

    // ① read.js 维护的最近阅读顺序
    (LS.get('bbn.shelf', []) || []).forEach(it => {
      if (!it || !it.id || seen[it.id]) return;
      seen[it.id] = 1;
      items.push(Object.assign({}, it, { progress: prog[it.id] || null }));
    });
    // ② 只有进度、没进 shelf 的（例如导入书后直接读）
    Object.keys(prog).forEach(id => {
      if (seen[id]) return;
      seen[id] = 1;
      items.push({ id: id, title: '', progress: prog[id] });
    });

    items.sort((a, b) => {
      const ta = (a.progress && a.progress.at) || a.at || '';
      const tb = (b.progress && b.progress.at) || b.at || '';
      return String(tb).localeCompare(String(ta));
    });
    return limit ? items.slice(0, limit) : items;
  }

  /** 用书目索引补全最近阅读里缺失的标题/封面（read.js 只存了 id 的情况） */
  function enrich(items, books) {
    const byId = {};
    (books || []).forEach(b => { if (b && b.id) byId[b.id] = b; });
    return (items || []).map(it => {
      const b = byId[it.id];
      if (!b) return it;
      return Object.assign({}, it, {
        title: it.title || b.title,
        author: it.author || b.author,
        cover: it.cover || B.crypto.coverOf(b)
      });
    });
  }

  /* ---------------- 云端 ---------------- */
  function localBundle() {
    return {
      format: 'bookblacknet.shelf', v: 1,
      at: new Date().toISOString(),
      fav: list(),
      progress: progressMap()
    };
  }

  async function req(method, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (B.auth && B.auth.emailToken) {
      const t = B.auth.emailToken();
      if (t) headers['Authorization'] = 'Bearer ' + t;
    }
    const res = await fetch(ENDPOINT, {
      method: method,
      credentials: 'include',
      headers: headers,
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || ('HTTP ' + res.status));
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function merge(local, remote) {
    const fav = {};
    (local.fav || []).forEach(x => { if (x && x.id) fav[x.id] = x; });
    (remote.fav || []).forEach(x => {
      if (!x || !x.id) return;
      const cur = fav[x.id];
      if (!cur || String(x.at || '') > String(cur.at || '')) fav[x.id] = x;
    });
    const progress = Object.assign({}, remote.progress || {});
    Object.keys(local.progress || {}).forEach(id => {
      const a = progress[id], b = local.progress[id];
      if (!a || String(b.at || '') > String(a.at || '')) progress[id] = b;
    });

    const favList = Object.keys(fav).map(k => fav[k])
      .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
      .slice(0, FAV_MAX);
    return {
      format: 'bookblacknet.shelf', v: 1,
      at: new Date().toISOString(),
      fav: favList,
      progress: progress
    };
  }

  /** 登录状态变化时调用：拉云端 → 合并 → 写回两端 */
  async function sync(opts) {
    const silent = opts && opts.silent;
    if (syncing) return { ok: false, reason: 'busy' };
    let user = null;
    try { user = (B.auth && await B.auth.me()) || null; } catch (e) { user = null; }
    if (!user) { status = 'local'; emit(); return { ok: false, reason: 'anonymous' }; }

    syncing = true;
    status = 'syncing'; emit();
    try {
      const local = localBundle();
      let remote = null;
      try {
        const got = await req('GET');
        remote = got && got.shelf ? got.shelf : null;
      } catch (e) {
        // 404 / 500（后端未部署 Upstash）→ 纯本地
        if (e.status === 404 || e.status === 500) {
          status = 'local'; emit();
          return { ok: false, reason: 'server', error: e.message };
        }
        throw e;
      }

      const merged = merge(local, remote || { fav: [], progress: {} });
      LS.set(FAV_KEY, merged.fav);
      saveProgressMap(merged.progress);

      await req('POST', merged);
      status = 'ok';
      lastSyncAt = new Date().toISOString();
      emit();
      if (!silent) toast('书架已同步到账号', 'ok');
      return { ok: true, fav: merged.fav.length, progress: Object.keys(merged.progress).length };
    } catch (e) {
      status = 'err'; emit();
      if (!silent) toast('同步失败：' + e.message + '（数据仍保存在本机）', 'err');
      return { ok: false, reason: 'error', error: e.message };
    } finally {
      syncing = false;
    }
  }

  /** 只推不拉：本地改动后的轻量同步 */
  async function push() {
    if (syncing) { queuePush(); return; }
    let user = null;
    try { user = (B.auth && await B.auth.me()) || null; } catch (e) { user = null; }
    if (!user) return;
    syncing = true;
    try {
      await req('POST', localBundle());
      status = 'ok'; lastSyncAt = new Date().toISOString(); emit();
    } catch (e) {
      status = 'err'; emit();
    } finally { syncing = false; }
  }

  function queuePush() {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => { push(); }, 1500);
  }

  B.fav = {
    list, has, add, remove, toggle, save,
    progressMap, saveProgressMap, progressChanged,
    recent, enrich,
    sync, push, onChange,
    get status() { return status; },
    get lastSyncAt() { return lastSyncAt; },
    localBundle, FAV_KEY
  };
})(window.BKN);
