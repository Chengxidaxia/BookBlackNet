/* ============================================================
   store.js — 本地书稿仓库（IndexedDB）
   * 未发布的书籍、以及所有书稿的编辑态都存在这里；
   * 长篇小说正文动辄几 MB，localStorage 装不下，必须用 IDB。
   ============================================================ */
window.BKN = window.BKN || {};

(function (B) {
  'use strict';

  const DB_NAME = 'bookblacknet';
  const DB_VER = 1;
  const S_BOOKS = 'books';
  const S_PROG = 'progress';

  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error('浏览器不支持 IndexedDB'));
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(S_BOOKS)) {
          const s = db.createObjectStore(S_BOOKS, { keyPath: 'id' });
          s.createIndex('updatedAt', 'updatedAt');
        }
        if (!db.objectStoreNames.contains(S_PROG)) {
          db.createObjectStore(S_PROG, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('本地数据库打开失败'));
      req.onblocked = () => reject(new Error('本地数据库被其他标签页占用'));
    });
    return dbp;
  }

  function tx(storeName, mode) {
    return open().then(db => db.transaction(storeName, mode).objectStore(storeName));
  }

  function wrap(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /* ---------------- 书稿 ---------------- */
  async function list() {
    const st = await tx(S_BOOKS, 'readonly');
    const all = await wrap(st.getAll());
    return (all || []).sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  }

  async function get(id) {
    const st = await tx(S_BOOKS, 'readonly');
    return wrap(st.get(id));
  }

  async function save(book) {
    if (!book || !book.id) throw new Error('书稿缺少 id');
    book.updatedAt = new Date().toISOString();
    const st = await tx(S_BOOKS, 'readwrite');
    await wrap(st.put(book));
    return book;
  }

  async function remove(id) {
    const st = await tx(S_BOOKS, 'readwrite');
    return wrap(st.delete(id));
  }

  async function count() {
    const st = await tx(S_BOOKS, 'readonly');
    return wrap(st.count());
  }

  /* ---------------- 阅读进度 ---------------- */
  async function getProgress(id) {
    try {
      const st = await tx(S_PROG, 'readonly');
      return await wrap(st.get(id));
    } catch (e) { return null; }
  }
  async function setProgress(id, data) {
    try {
      const st = await tx(S_PROG, 'readwrite');
      await wrap(st.put(Object.assign({ id: id, at: new Date().toISOString() }, data)));
    } catch (e) { /* 进度丢了不影响阅读 */ }
  }
  async function listProgress() {
    try {
      const st = await tx(S_PROG, 'readonly');
      return (await wrap(st.getAll())) || [];
    } catch (e) { return []; }
  }

  /* ---------------- 新建书稿 ---------------- */
  function blankBook(meta) {
    const now = new Date().toISOString();
    const id = B.util.uid('bk_');
    return {
      id: id,
      meta: Object.assign({
        id: id,
        title: '未命名作品',
        author: '',
        intro: '',
        category: '玄幻',
        tags: [],
        status: 'ongoing',
        visibility: 'public',
        cover: null,
        createdAt: now,
        updatedAt: now
      }, meta || {}),
      chapters: [
        { id: B.util.uid('ch_'), title: '第一章', content: '' }
      ],
      createdAt: now,
      updatedAt: now,
      published: null      // { at, sha, fileName, words, chapters }
    };
  }

  /* ---------------- 导出 / 备份 ---------------- */
  async function exportAll() {
    const books = await list();
    return JSON.stringify({ format: 'bookblacknet.workspace', v: 1, at: new Date().toISOString(), books: books }, null, 2);
  }

  async function importAll(text) {
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.books)) throw new Error('备份文件格式不正确');
    let n = 0;
    for (const b of data.books) {
      if (!b || !b.id) continue;
      await save(b);
      n++;
    }
    return n;
  }

  B.store = { open, list, get, save, remove, count, blankBook,
              getProgress, setProgress, listProgress, exportAll, importAll };
})(window.BKN);
