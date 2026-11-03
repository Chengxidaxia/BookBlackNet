/* ============================================================
   books.js — 全部书籍页（books.html）
   ------------------------------------------------------------
   与首页的区别：
     · 不分分类 Tab，而是一次列出全部，带搜索 / 分类 / 排序；
     · 分页（每页 24 本），状态同步到 URL（?q=&cat=&sort=&page=），可分享、可后退；
     · 默认按「最近更新」排序。
   ============================================================ */
(function () {
  'use strict';

  const B = window.BKN;
  const { util, api } = B;
  const { el, num, debounce } = util;
  const gid = id => document.getElementById(id);
  const CFG = window.BOOK || {};
  const PAGE_SIZE = 24;

  const els = {
    grid: gid('lib-grid'), sub: gid('lib-sub'),
    q: gid('lib-q'), cats: gid('lib-cats'), sort: gid('lib-sort'),
    pager: gid('lib-pager'), empty: gid('lib-empty'),
    emptyTitle: gid('lib-empty-title'), emptyDesc: gid('lib-empty-desc')
  };

  const S = { q: '', cat: '全部', sort: 'updated', page: 1 };
  let all = [];

  /* ---------------- 封面 ---------------- */
  function coverStyle(cov) {
    if (!cov) return { background: 'linear-gradient(150deg,#6b5340,#31241a)' };
    if (cov.type === 'image' && cov.url) {
      return { backgroundImage: 'url("' + cov.url + '")', backgroundSize: 'cover', backgroundPosition: 'center' };
    }
    return { background: 'linear-gradient(150deg,' + (cov.from || '#6b5340') + ',' + (cov.to || '#31241a') + ')' };
  }

  /* ---------------- 筛选 ---------------- */
  function filtered() {
    const q = S.q.trim().toLowerCase();
    let list = all.slice();
    if (S.cat !== '全部') list = list.filter(b => b.category === S.cat);
    if (q) {
      list = list.filter(b => {
        const hay = [b.title, b.author, b.intro, (b.tags || []).join(' ')].join(' ').toLowerCase();
        return hay.indexOf(q) >= 0;
      });
    }
    if (S.sort === 'words') list.sort((a, b) => (+b.words || 0) - (+a.words || 0));
    else if (S.sort === 'title') list.sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'zh'));
    else if (S.sort === 'created') list.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    else list.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    return list;
  }

  /* ---------------- 分类 chips ---------------- */
  function renderChips() {
    const seen = [];
    all.forEach(b => {
      const c = b.category;
      if (c && seen.indexOf(c) < 0) seen.push(c);
    });
    seen.sort((a, b) => {
      const ia = CFG.CATEGORIES.indexOf(a), ib = CFG.CATEGORIES.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    els.cats.innerHTML = '';
    ['全部'].concat(seen).forEach(c => {
      const chip = el('button.chip' + (c === S.cat ? '.on' : ''), { type: 'button', text: c });
      chip.addEventListener('click', () => {
        S.cat = c; S.page = 1; syncURL(); renderChips(); render();
      });
      els.cats.appendChild(chip);
    });
  }

  /* ---------------- 卡片 ---------------- */
  function card(b) {
    const cov = B.crypto.coverOf(b);
    const node = el('div.book-card',
      el('div.bc-cover', { style: coverStyle(cov) },
        (b.status === 'done' ? el('span.bc-badge.bc-done', { text: '完结' }) : null),
        (b.visibility === 'private' ? el('span.bc-badge.bc-priv', { text: '私密' }) : null),
        el('div.bc-letter', { text: cov.type === 'image' ? '' : (cov.text || B.crypto.firstChar(b.title)) }),
        el('div.bc-title-on', { text: b.title || '未命名作品' })
      ),
      el('div.bc-body',
        el('div.bc-name.clamp-2', { text: b.title || '未命名作品' }),
        el('div.bc-sub',
          el('span', { text: b.author || '佚名' }),
          el('span.sep', { text: '·' }),
          el('span', { text: num(+b.words || 0) + ' 字' }),
          b.category ? [el('span.sep', { text: '·' }), el('span', { text: b.category })] : null
        )
      )
    );
    node.addEventListener('click', () => { location.href = 'book.html?id=' + encodeURIComponent(b.id); });
    return node;
  }

  /* ---------------- 分页 ---------------- */
  function pagerHTML(totalPages) {
    if (totalPages <= 1) return '';
    const btn = (label, page, opts) => {
      const o = opts || {};
      const b = el('button', { type: 'button', text: label, disabled: !!o.disabled });
      if (o.active) b.classList.add('on');
      if (!o.disabled && !o.active) b.addEventListener('click', () => go(page));
      return b;
    };
    const frag = document.createDocumentFragment();
    frag.appendChild(btn('‹', S.page - 1, { disabled: S.page <= 1 }));

    const pages = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      let start = Math.max(2, S.page - 1);
      let end = Math.min(totalPages - 1, S.page + 1);
      if (S.page <= 3) { start = 2; end = 4; }
      if (S.page >= totalPages - 2) { start = totalPages - 3; end = totalPages - 1; }
      if (start > 2) pages.push('…');
      for (let i = start; i <= end; i++) pages.push(i);
      if (end < totalPages - 1) pages.push('…');
      pages.push(totalPages);
    }
    pages.forEach(p => {
      if (p === '…') frag.appendChild(el('span.lib-gap', { text: '…' }));
      else frag.appendChild(btn(String(p), p, { active: p === S.page }));
    });

    frag.appendChild(btn('›', S.page + 1, { disabled: S.page >= totalPages }));
    return frag;
  }

  function go(page) {
    S.page = page;
    syncURL();
    render();
    const top = document.querySelector('.lib-tools');
    if (top) top.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------------- 渲染 ---------------- */
  function render() {
    const list = filtered();
    const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    if (S.page > totalPages) S.page = totalPages;
    const start = (S.page - 1) * PAGE_SIZE;
    const pageItems = list.slice(start, start + PAGE_SIZE);

    els.sub.textContent = list.length
      ? '共 ' + list.length + ' 本' + (S.cat !== '全部' ? ' · ' + S.cat : '') + (S.q ? ' · 搜索「' + S.q + '」' : '')
      : '共 0 本';

    els.grid.innerHTML = '';
    els.pager.innerHTML = '';

    if (!list.length) {
      els.grid.classList.add('hidden');
      els.empty.classList.remove('hidden');
      els.emptyTitle.textContent = all.length ? '没有匹配的作品' : '书库还空着';
      els.emptyDesc.textContent = all.length ? '换个关键词，或者选「全部」分类看看。' : '发布第一本书之后，它就会出现在这里。';
      return;
    }

    els.empty.classList.add('hidden');
    els.grid.classList.remove('hidden');
    pageItems.forEach(b => els.grid.appendChild(card(b)));

    const frag = pagerHTML(totalPages);
    if (frag) els.pager.appendChild(frag);
  }

  /* ---------------- URL 同步 ---------------- */
  function syncURL() {
    const p = new URLSearchParams();
    if (S.q) p.set('q', S.q);
    if (S.cat !== '全部') p.set('cat', S.cat);
    if (S.sort !== 'updated') p.set('sort', S.sort);
    if (S.page > 1) p.set('page', String(S.page));
    const qs = p.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : ''));
  }

  function readURL() {
    const u = new URLSearchParams(location.search);
    S.q = u.get('q') || '';
    S.cat = u.get('cat') || '全部';
    S.sort = u.get('sort') || 'updated';
    S.page = Math.max(1, parseInt(u.get('page') || '1', 10) || 1);
  }

  /* ---------------- 启动 ---------------- */
  async function boot() {
    readURL();
    els.q.value = S.q;
    els.sort.value = S.sort;

    let idx = { books: [], source: 'none' };
    try { idx = await api.loadIndex(); } catch (e) { idx = { books: [], source: 'none' }; }
    all = (idx.books || []).filter(b => b && b.id);
    document.documentElement.dataset.bookSource = idx.source;

    renderChips();
    render();

    const onQ = debounce(() => { S.q = els.q.value; S.page = 1; syncURL(); render(); }, 240);
    els.q.addEventListener('input', onQ);
    els.sort.addEventListener('change', () => {
      S.sort = els.sort.value; S.page = 1; syncURL(); render();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
