/* ============================================================
   stats.js — 写作统计（今日字数 / 连续天数 / 累计）
   存储：bbn.stats.v1 = { days: { 'YYYY-MM-DD': { byBook: { id: 当日最高字数 } } } }
   口径：按「当日见过的最高全书字数」计正增量，删字不会倒扣当天总量。
   API：
     stats.tick(bookId, totalWords)   编辑器统计刷新时调用
     stats.today()                    今日新增字数
     stats.streak()                   连续写作天数
     stats.total()                    累计新增字数
   ============================================================ */
window.BKN = window.BKN || {};

(function (B) {
  'use strict';

  const KEY = 'bbn.stats.v1';

  function todayKey() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; }
    catch (e) { return {}; }
  }
  function save(s) {
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {}
  }

  function tick(bookId, totalWords) {
    if (!bookId) return;
    const s = load();
    const day = todayKey();
    s.days = s.days || {};
    s.days[day] = s.days[day] || { byBook: {} };
    const d = s.days[day];
    const prev = d.byBook[bookId] || 0;
    if (totalWords > prev) {
      d.byBook[bookId] = totalWords;
      save(s);
    }
  }

  function daySum(s, k) {
    const d = s.days && s.days[k];
    if (!d) return 0;
    return Object.keys(d.byBook || {}).reduce((n, id) => n + (d.byBook[id] || 0), 0);
  }

  function today() {
    const s = load();
    return daySum(s, todayKey());
  }

  function total() {
    const s = load();
    return Object.keys(s.days || {}).reduce((n, k) => n + daySum(s, k), 0);
  }

  /* 连续天数：从今天（或昨天）往回数每天总量 > 0 */
  function streak() {
    const s = load();
    let n = 0;
    const d = new Date();
    // 今天还没写不算断签：从昨天起算
    if (daySum(s, fmt(d)) === 0) d.setDate(d.getDate() - 1);
    while (daySum(s, fmt(d)) > 0) {
      n++;
      d.setDate(d.getDate() - 1);
      if (n > 3650) break;
    }
    return n;
  }
  function fmt(d) {
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  B.stats = { tick, today, streak, total };
})(window.BKN);
