/* ============================================================
   shelf.js — 书架筛选纯函数（无 DOM，可单测）
   ============================================================ */
window.BKN = window.BKN || {};

(function (B) {
  'use strict';

  function bookWords(b, words) {
    const w = words || B.util.words;
    return (b.chapters || []).reduce((n, c) => n + w(c.content), 0);
  }

  /**
   * shelfFilter(list, f)
   * f: { q, cat, status: ''|draft|published|private, sort: updated|created|title|words }
   */
  function shelfFilter(list, f) {
    f = f || {};
    let out = list.slice();
    const q = String(f.q || '').trim().toLowerCase();
    if (q) {
      out = out.filter(b => {
        const m = b.meta || {};
        const hay = [m.title, m.author, m.intro, (m.tags || []).join(' ')]
          .filter(Boolean).join(' ').toLowerCase();
        return hay.indexOf(q) >= 0;
      });
    }
    if (f.cat) out = out.filter(b => b.meta && b.meta.category === f.cat);
    if (f.status === 'draft') out = out.filter(b => !b.published);
    else if (f.status === 'published') out = out.filter(b => !!b.published);
    else if (f.status === 'private') out = out.filter(b => b.meta && b.meta.visibility === 'private');
    const sorters = {
      updated: (a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')),
      created: (a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')),
      title: (a, b) => String((a.meta && a.meta.title) || '').localeCompare(String((b.meta && b.meta.title) || ''), 'zh'),
      words: (a, b) => bookWords(b) - bookWords(a)
    };
    out.sort(sorters[f.sort] || sorters.updated);
    return out;
  }

  B.shelf = { shelfFilter, bookWords };
})(window.BKN);
