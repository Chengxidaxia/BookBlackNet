/* ============================================================
   home.js — 书库首页
   ============================================================ */
(function () {
  'use strict';

  const B = window.BKN;
  const { util, api } = B;
  const { $, el, toast, num, timeAgo, safeJSON, store: LS } = util;
  const CFG = window.BOOK || {};

  const els = {};
  ['book-grid', 'cat-chips', 'sort-sel', 'search-form', 'search-input', 'hero-stats',
    'stat-books', 'stat-words', 'stat-chaps', 'book-stack', 'shelf-empty', 'empty-title',
    'empty-desc', 'continue-sec', 'continue-row', 'shelf-desc'
  ].forEach(id => { els[id.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = document.getElementById(id); });

  const S = {
    all: [],
    cat: '全部',
    sort: 'updated',
    q: '',
    source: 'site'
  };

  /* ---------------- 渲染工具 ---------------- */
  function coverStyle(cov) {
    if (!cov) return { background: 'linear-gradient(150deg,#6b5340,#31241a)' };
    if (cov.type === 'image' && cov.url) {
      return { backgroundImage: 'url("' + cov.url + '")', backgroundSize: 'cover', backgroundPosition: 'center' };
    }
    return { background: 'linear-gradient(150deg,' + (cov.from || '#6b5340') + ',' + (cov.to || '#31241a') + ')' };
  }

  function stat() {
    const books = S.all;
    const w = books.reduce((n, b) => n + (+b.words || 0), 0);
    const c = books.reduce((n, b) => n + (+b.chapters || 0), 0);
    els.statBooks.textContent = books.length;
    els.statWords.textContent = num(w);
    els.statChaps.textContent = c;
  }

  function renderStack() {
    const picks = S.all.slice(0, 3);
    const host = els.bookStack;
    if (!picks.length) return;
    host.innerHTML = '';
    // 从后往前叠：第 3 本在最底下
    [2, 1, 0].forEach(n => {
      const b = picks[n];
      if (!b) return;
      const cov = B.crypto.coverOf(b);
      const node = el('div.bk.bk-' + (n + 1),
        el('i', { text: B.crypto.firstChar(b.title) })
      );
      const st = coverStyle(cov);
      Object.assign(node.style, st);
      host.appendChild(node);
    });
  }

  function renderChips() {
    const cats = ['全部'];
    const seen = [];
    S.all.forEach(b => {
      const c = b.category || '其他';
      if (!seen.includes(c)) seen.push(c);
    });
    seen.sort((a, b) => {
      const ia = CFG.CATEGORIES.indexOf(a), ib = CFG.CATEGORIES.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    cats.push.apply(cats, seen);

    els.catChips.innerHTML = '';
    cats.forEach(c => {
      const chip = el('button.chip' + (c === S.cat ? '.on' : ''), { text: c });
      chip.addEventListener('click', () => { S.cat = c; renderChips(); renderShelf(); });
      els.catChips.appendChild(chip);
    });
  }

  function filtered() {
    const q = S.q.trim().toLowerCase();
    let list = S.all.slice();
    if (S.cat !== '全部') list = list.filter(b => (b.category || '其他') === S.cat);
    if (q) {
      list = list.filter(b => {
        const hay = [b.title, b.author, b.intro, (b.tags || []).join(' ')].join(' ').toLowerCase();
        return hay.indexOf(q) >= 0;
      });
    }
    if (S.sort === 'words') list.sort((a, b) => (+b.words || 0) - (+a.words || 0));
    else if (S.sort === 'title') list.sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'zh'));
    else list.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    return list;
  }

  function renderShelf() {
    const list = filtered();
    els.bookGrid.innerHTML = '';
    els.shelfEmpty.classList.add('hidden');

    if (!S.all.length) {
      els.bookGrid.classList.add('hidden');
      els.shelfEmpty.classList.remove('hidden');
      els.emptyTitle.textContent = '书库还空着';
      els.emptyDesc.textContent = S.source === 'none'
        ? '没有读到书目索引（' + CFG.INDEX_FILE + '）。如果刚发布，等 GitHub Pages 构建完成再刷新。'
        : '发布第一本书之后，它就会出现在这里。';
      els.shelfDesc.textContent = '全部作品';
      return;
    }
    els.bookGrid.classList.remove('hidden');

    if (!list.length) {
      els.shelfEmpty.classList.remove('hidden');
      els.emptyTitle.textContent = '没有匹配的作品';
      els.emptyDesc.textContent = '换个关键词，或者选「全部」分类看看。';
      els.shelfDesc.textContent = '0 本';
      return;
    }

    els.shelfDesc.textContent = list.length + ' 本' + (S.cat !== '全部' ? ' · ' + S.cat : '') + (S.q ? ' · 搜索「' + S.q + '」' : '');

    list.forEach(b => {
      const cov = B.crypto.coverOf(b);
      const card = el('div.book-card', { data: { id: b.id } },
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
            (b.category ? [el('span.sep', { text: '·' }), el('span', { text: b.category })] : null)
          )
        )
      );
      card.addEventListener('click', () => { location.href = 'read.html?id=' + encodeURIComponent(b.id); });
      els.bookGrid.appendChild(card);
    });
  }

  /* ---------------- 继续阅读 ---------------- */
  function renderContinue() {
    const shelf = (LS.get('bbn.shelf', []) || []).filter(x => x && x.id);
    const items = shelf.filter(x => {
      const p = LS.get('bbn.progress.' + x.id, null);
      return p && (p.ratio > 0.02 || p.c > 0);
    }).slice(0, 12);

    if (!items.length) { els.continueSec.classList.add('hidden'); return; }
    els.continueSec.classList.remove('hidden');
    els.continueRow.innerHTML = '';

    items.forEach(it => {
      const p = LS.get('bbn.progress.' + it.id, null) || {};
      const cov = it.cover || {};
      const pct = Math.round((p.ratio || 0) * 100);
      const card = el('div.cont-card',
        el('div.cont-cover', { style: coverStyle(cov), text: cov.type === 'image' ? '' : (cov.text || B.crypto.firstChar(it.title)) }),
        el('div.cont-body',
          el('div.cont-name.truncate', { text: it.title || '未命名作品' }),
          el('div.cont-ch', { text: (it.chapter ? '第 ' + it.chapter + ' 章' : '') + (pct ? ' · ' + pct + '%' : '') }),
          el('div.cont-bar', el('i', { style: { width: Math.max(3, pct) + '%' } }))
        )
      );
      card.addEventListener('click', () => {
        location.href = 'read.html?id=' + encodeURIComponent(it.id) + (p.c ? '&c=' + (p.c + 1) : '');
      });
      els.continueRow.appendChild(card);
    });
  }

  /* ---------------- 启动 ---------------- */
  async function boot() {
    els.sortSel.value = S.sort;
    els.sortSel.addEventListener('change', () => { S.sort = els.sortSel.value; renderShelf(); });

    els.searchForm.addEventListener('submit', e => {
      e.preventDefault();
      S.q = els.searchInput.value;
      renderShelf();
      document.getElementById('shelf').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    els.searchInput.addEventListener('input', util.debounce(() => {
      S.q = els.searchInput.value;
      renderShelf();
    }, 260));

    const res = await api.loadIndex();
    S.all = (res.books || []).filter(b => b && b.id);
    S.source = res.source;
    // 排查用：<html data-book-source="site|cdn|raw|none">
    document.documentElement.dataset.bookSource = S.source;

    stat();
    renderStack();
    renderChips();
    renderShelf();
    renderContinue();

    // 深链：?q= 或 ?cat=
    const q = util.qs('q'), cat = util.qs('cat');
    if (q) { S.q = q; els.searchInput.value = q; renderShelf(); }
    if (cat) { S.cat = cat; renderChips(); renderShelf(); }

    if (S.source === 'none') {
      console.warn('书目索引未读到：' + CFG.INDEX_FILE);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
