/* ============================================================
   myshelf.js — 我的书架页（shelf.html）
   ------------------------------------------------------------
   两个视图：
     收藏      —— bbn.fav（本机；登录后同步到账号）
     最近阅读  —— bbn.shelf + bbn.progress.<id>（read.js 写入）
   书籍元信息以书目索引为准；索引里查不到（已下架）时用收藏时留下的快照。
   ============================================================ */
(function () {
  'use strict';

  const B = window.BKN;
  const { util, api, fav } = B;
  const { el, toast, num, timeAgo } = util;
  const gid = id => document.getElementById(id);
  const CFG = window.BOOK || {};

  const els = {
    state: gid('sh-state'), sync: gid('sh-sync'),
    favBox: gid('sh-fav'), favEmpty: gid('sh-fav-empty'), favCount: gid('sh-fav-count'),
    recentBox: gid('sh-recent'), recentEmpty: gid('sh-recent-empty'), recentCount: gid('sh-recent-count'),
    tabs: Array.prototype.slice.call(document.querySelectorAll('.sh-tab'))
  };

  let books = [];
  let user = null;
  let tab = 'fav';

  function coverStyle(cov) {
    if (!cov) return { background: 'linear-gradient(150deg,#6b5340,#31241a)' };
    if (cov.type === 'image' && cov.url) {
      return { backgroundImage: 'url("' + cov.url + '")', backgroundSize: 'cover', backgroundPosition: 'center' };
    }
    return { background: 'linear-gradient(150deg,' + (cov.from || '#6b5340') + ',' + (cov.to || '#31241a') + ')' };
  }

  function byId(id) {
    return books.find(b => b && b.id === id) || null;
  }

  /* ---------------- 状态行 ---------------- */
  function renderState() {
    if (!els.state) return;
    if (!user) {
      els.state.innerHTML = '';
      els.state.appendChild(el('span', { text: '收藏与阅读进度目前只保存在本机浏览器。' }));
      els.state.appendChild(el('button.link-btn', {
        text: '登录后可同步到账号',
        type: 'button',
        on: { click: () => B.account && B.account.openLogin({ afterLogin: () => B.fav.sync() }) }
      }));
      els.sync.classList.add('hidden');
      return;
    }
    const st = fav.status;
    const who = B.auth.displayName(user);
    const at = fav.lastSyncAt;
    const txt = st === 'syncing' ? '正在同步…'
      : st === 'err' ? '上次同步失败，数据仍在本机'
      : at ? '已登录 ' + who + ' · 上次同步 ' + timeAgo(at)
      : '已登录 ' + who + ' · 尚未同步';
    els.state.textContent = txt;
    els.sync.classList.remove('hidden');
  }

  /* ---------------- 收藏 ---------------- */
  function renderFav() {
    const list = fav.list();
    els.favCount.textContent = list.length;
    els.favBox.innerHTML = '';

    if (!list.length) {
      els.favBox.classList.add('hidden');
      els.favEmpty.classList.remove('hidden');
      return;
    }
    els.favEmpty.classList.add('hidden');
    els.favBox.classList.remove('hidden');

    list.forEach(item => {
      const live = byId(item.id);
      const title = (live && live.title) || item.title || '未命名作品';
      const author = (live && live.author) || item.author || '佚名';
      const cov = live ? B.crypto.coverOf(live) : (item.cover || null);
      const gone = !live;

      const del = el('button.sh-del', {
        type: 'button', title: '从书架移除',
        html: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg>',
        on: { click: (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
          fav.remove(item.id);
          toast('已从书架移除', 'ok');
          renderFav();
        } }
      });

      const card = el('div.book-card.sh-card', { data: { id: item.id } },
        el('div.bc-cover', { style: coverStyle(cov) },
          del,
          gone ? el('span.bc-badge.bc-priv', { text: '已下架' }) : null,
          el('div.bc-letter', { text: cov && cov.type === 'image' ? '' : ((cov && cov.text) || B.crypto.firstChar(title)) }),
          el('div.bc-title-on', { text: title })
        ),
        el('div.bc-body',
          el('div.bc-name.clamp-2', { text: title }),
          el('div.bc-sub',
            el('span', { text: author }),
            el('span.sep', { text: '·' }),
            live ? el('span', { text: num(+live.words || 0) + ' 字' }) : el('span', { text: '书目里已找不到' })
          )
        )
      );
      card.addEventListener('click', () => {
        if (gone) { toast('这本书已下架，无法打开', 'err'); return; }
        location.href = 'book.html?id=' + encodeURIComponent(item.id);
      });
      els.favBox.appendChild(card);
    });
  }

  /* ---------------- 最近阅读 ---------------- */
  function renderRecent() {
    const items = fav.enrich(fav.recent(60), books);
    els.recentCount.textContent = items.length;
    els.recentBox.innerHTML = '';

    if (!items.length) {
      els.recentBox.classList.add('hidden');
      els.recentEmpty.classList.remove('hidden');
      return;
    }
    els.recentEmpty.classList.add('hidden');
    els.recentBox.classList.remove('hidden');

    items.forEach(it => {
      const p = it.progress || {};
      const pct = Math.round((p.ratio || 0) * 100);
      const title = it.title || '未命名作品';
      const cov = it.cover || null;
      const chLabel = it.chapterTitle
        ? '第 ' + it.chapter + ' 章 · ' + it.chapterTitle
        : (typeof it.chapter === 'number' ? '第 ' + it.chapter + ' 章' : '');

      const row = el('a.sh-row', { href: 'read.html?id=' + encodeURIComponent(it.id) + (p.c ? '&c=' + (p.c + 1) : '') },
        el('div.sh-cover', { style: coverStyle(cov), text: cov && cov.type === 'image' ? '' : B.crypto.firstChar(title) }),
        el('div.sh-main',
          el('div.sh-name.truncate', { text: title }),
          el('div.sh-meta',
            el('span', { text: it.author || '佚名' }),
            chLabel ? [el('span.sep', { text: '·' }), el('span', { text: chLabel })] : null,
            p.at ? [el('span.sep', { text: '·' }), el('span', { text: timeAgo(p.at) })] : null
          ),
          el('div.sh-bar', el('i', { style: { width: Math.max(2, pct) + '%' } }))
        ),
        el('div.sh-pct', { text: pct ? pct + '%' : '未开始' }),
        el('span.sh-go', { text: pct ? '继续' : '开始' })
      );
      els.recentBox.appendChild(row);
    });
  }

  /* ---------------- 交互 ---------------- */
  function switchTab(name) {
    tab = name;
    els.tabs.forEach(b => b.classList.toggle('on', b.dataset.tab === name));
    const favN = fav.list().length;
    const recN = fav.recent(1).length;
    if (name === 'fav') {
      els.favBox.classList.toggle('hidden', favN === 0);
      els.favEmpty.classList.toggle('hidden', favN > 0);
      els.recentBox.classList.add('hidden');
      els.recentEmpty.classList.add('hidden');
    } else {
      els.favBox.classList.add('hidden');
      els.favEmpty.classList.add('hidden');
      els.recentBox.classList.toggle('hidden', recN === 0);
      els.recentEmpty.classList.toggle('hidden', recN > 0);
    }
  }

  els.tabs.forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  if (els.sync) {
    els.sync.addEventListener('click', async () => {
      if (!user) { B.account && B.account.openLogin({ afterLogin: () => B.fav.sync() }); return; }
      els.sync.disabled = true;
      els.sync.textContent = '同步中…';
      await fav.sync();
      els.sync.disabled = false;
      els.sync.textContent = '同步到账号';
      renderState();
      renderFav();
      renderRecent();
    });
  }

  fav.onChange(() => { renderState(); });

  /* ---------------- 启动 ---------------- */
  async function boot() {
    renderState();
    try { user = (B.auth && await B.auth.me()) || null; } catch (e) { user = null; }
    renderState();

    try {
      const res = await api.loadIndex();
      books = (res.books || []).filter(b => b && b.id);
      document.documentElement.dataset.bookSource = res.source;
    } catch (e) {
      books = [];
    }

    if (user) await fav.sync({ silent: true });

    renderFav();
    renderRecent();
    switchTab('fav');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
