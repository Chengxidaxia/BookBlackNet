/* ============================================================
   read.js — 阅读器
   ============================================================ */
(function () {
  'use strict';

  const B = window.BKN;
  const { util, md, api } = B;
  const { $, el, toast, esc, words, num, safeJSON, store: LS } = util;
  const CFG = window.BOOK || {};

  const els = {};
  ['reader-bar', 'rb-title', 'rb-progress', 'btn-toc', 'btn-toc-close', 'btn-font', 'btn-theme',
    'toc', 'toc-mask', 'toc-list', 'toc-count', 'toc-name', 'toc-author', 'toc-cover',
    'rd-panel', 'seg-size', 'val-size', 'reader-main', 'reader-state', 'reader-art',
    'book-head', 'bh-cover', 'bh-title', 'bh-meta', 'bh-intro', 'bh-tags',
    'chap-title', 'chap-body', 'chap-nav', 'btn-prev', 'btn-next', 'btn-toc2'
  ].forEach(id => { els[id.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = document.getElementById(id); });

  const S = {
    bookId: null,
    file: null,
    data: null,       // {meta, chapters}
    idx: 0,
    reader: Object.assign({}, CFG.READER, LS.get('bbn.reader', {}) || {}),
    baseTitle: '阅读'
  };

  /* ============================================================
     阅读设置
     ============================================================ */
  function applyReader() {
    const r = S.reader;
    const root = document.body;
    root.style.setProperty('--rw', r.width + 'px');
    root.style.setProperty('--rfs', r.fontSize + 'px');
    root.style.setProperty('--rlh', r.lineHeight);
    root.style.setProperty('--rfont', r.font === 'sans' ? 'var(--sans)' : 'var(--serif)');
    root.setAttribute('data-theme', r.theme || 'paper');
    els.valSize.textContent = r.fontSize;
    document.querySelectorAll('#seg-lh button').forEach(b => b.classList.toggle('on', +b.dataset.v === +r.lineHeight));
    document.querySelectorAll('#seg-width button').forEach(b => b.classList.toggle('on', +b.dataset.v === +r.width));
    document.querySelectorAll('#seg-font button').forEach(b => b.classList.toggle('on', b.dataset.v === r.font));
    document.querySelectorAll('#seg-theme button').forEach(b => b.classList.toggle('on', b.dataset.v === r.theme));
  }

  function saveReader() {
    LS.set('bbn.reader', S.reader);
    applyReader();
  }

  function bindReaderPanel() {
    document.querySelectorAll('#seg-size button').forEach(b => {
      b.addEventListener('click', () => {
        const d = +b.dataset.v;
        S.reader.fontSize = Math.max(14, Math.min(30, (S.reader.fontSize || 19) + d));
        saveReader();
        refreshProgress();
      });
    });
    document.querySelectorAll('#seg-lh button').forEach(b => {
      b.addEventListener('click', () => { S.reader.lineHeight = +b.dataset.v; saveReader(); refreshProgress(); });
    });
    document.querySelectorAll('#seg-width button').forEach(b => {
      b.addEventListener('click', () => { S.reader.width = +b.dataset.v; saveReader(); refreshProgress(); });
    });
    document.querySelectorAll('#seg-font button').forEach(b => {
      b.addEventListener('click', () => { S.reader.font = b.dataset.v; saveReader(); });
    });
    document.querySelectorAll('#seg-theme button').forEach(b => {
      b.addEventListener('click', () => { S.reader.theme = b.dataset.v; saveReader(); });
    });
    els.btnFont.addEventListener('click', e => {
      e.stopPropagation();
      els.rdPanel.classList.toggle('open');
    });
    els.btnTheme.addEventListener('click', () => {
      const order = ['paper', 'sepia', 'night'];
      const i = order.indexOf(S.reader.theme || 'paper');
      S.reader.theme = order[(i + 1) % order.length];
      saveReader();
      toast('主题：' + ({ paper: '纸白', sepia: '米黄', night: '夜间' })[S.reader.theme], 'ok', 1400);
    });
    document.addEventListener('click', e => {
      if (!els.rdPanel.classList.contains('open')) return;
      if (els.rdPanel.contains(e.target) || els.btnFont.contains(e.target)) return;
      els.rdPanel.classList.remove('open');
    });
  }

  /* ============================================================
     目录
     ============================================================ */
  function openToc(open) {
    const on = open === undefined ? !els.toc.classList.contains('open') : open;
    els.toc.classList.toggle('open', on);
    els.tocMask.classList.toggle('on', on);
  }

  function renderToc() {
    const list = S.data.chapters;
    els.tocCount.textContent = list.length + ' 章';
    els.tocList.innerHTML = '';
    list.forEach((c, i) => {
      const item = el('li.toc-item' + (i === S.idx ? '.on' : ''),
        el('span.no', { text: String(i + 1).padStart(2, '0') }),
        el('span.nm', { text: c.title || ('第 ' + (i + 1) + ' 章') })
      );
      item.addEventListener('click', () => { goChap(i); openToc(false); });
      els.tocList.appendChild(item);
    });
    const on = els.tocList.querySelector('.on');
    if (on) on.scrollIntoView({ block: 'center' });
  }

  /* ============================================================
     渲染
     ============================================================ */
  function renderHead() {
    const m = S.data.meta;
    const cov = B.crypto.coverOf(m);
    els.bhTitle.textContent = m.title || '未命名作品';

    if (cov.type === 'image') {
      els.bhCover.textContent = '';
      els.bhCover.style.background = 'none';
      els.bhCover.style.backgroundImage = 'url("' + cov.url + '")';
      els.bhCover.style.backgroundSize = 'cover';
      els.bhCover.style.backgroundPosition = 'center';
      els.tocCover.textContent = '';
      els.tocCover.style.backgroundImage = 'url("' + cov.url + '")';
    } else {
      const bg = 'linear-gradient(155deg,' + cov.from + ',' + cov.to + ')';
      els.bhCover.textContent = cov.text || '书';
      els.bhCover.style.backgroundImage = 'none';
      els.bhCover.style.background = bg;
      els.tocCover.textContent = cov.text || '书';
      els.tocCover.style.background = bg;
    }

    const bits = [
      m.author ? el('span', { text: m.author }) : null,
      el('span', { text: m.category || '其他' }),
      el('span.dotsep', { text: '·' }),
      el('span', { text: num(S.data.words) + ' 字' }),
      el('span.dotsep', { text: '·' }),
      el('span', { text: (m.status === 'done' ? '已完结' : '连载中') }),
      m.visibility === 'private' ? el('span.badge.badge-priv', { text: '私密' }) : null
    ].filter(Boolean);
    els.bhMeta.innerHTML = '';
    bits.forEach(b => els.bhMeta.appendChild(b));

    els.bhIntro.textContent = m.intro || '';
    els.bhIntro.style.display = m.intro ? '' : 'none';

    els.bhTags.innerHTML = '';
    (m.tags || []).forEach(t => els.bhTags.appendChild(el('span.tag', { text: t })));

    els.tocName.textContent = m.title || '未命名作品';
    els.tocAuthor.textContent = (m.author || '佚名') + ' · ' + num(S.data.words) + ' 字';
    document.title = (m.title || '阅读') + ' · BookBlackNet';
    S.baseTitle = m.title || '阅读';
    els.rbTitle.textContent = m.title || '阅读';
  }

  function renderChapter(i, restoreRatio) {
    const list = S.data.chapters;
    if (!list.length) {
      els.chapTitle.textContent = '';
      els.chapBody.innerHTML = '<p class="muted" style="text-align:center;text-indent:0">这本书还没有章节。</p>';
      return;
    }
    S.idx = Math.max(0, Math.min(list.length - 1, i));
    const c = list[S.idx];

    els.chapTitle.textContent = c.title || ('第 ' + (S.idx + 1) + ' 章');
    els.chapBody.innerHTML = md.render(c.content) ||
      '<p class="muted" style="text-indent:0">（本章暂时没有内容）</p>';

    // 首章且无进度才展示书籍信息头
    const showHead = S.idx === 0 && !(restoreRatio > 0.02);
    els.bookHead.style.display = showHead ? '' : 'none';

    els.btnPrev.disabled = S.idx <= 0;
    els.btnNext.disabled = S.idx >= list.length - 1;

    renderToc();
    document.title = (c.title || '') + ' · ' + S.baseTitle;
    els.chapNav.style.display = list.length > 1 ? '' : 'none';

    // 更新 URL（不产生历史记录）
    const q = new URLSearchParams(location.search);
    q.set('c', String(S.idx + 1));
    history.replaceState(null, '', location.pathname + '?' + q.toString());

    if (restoreRatio > 0.02) {
      requestAnimationFrame(() => {
        const h = document.documentElement.scrollHeight - window.innerHeight;
        window.scrollTo(0, Math.round(h * restoreRatio));
        refreshProgress();
      });
    } else {
      window.scrollTo(0, 0);
      refreshProgress();
    }
  }

  function goChap(i) {
    if (!S.data) return;
    renderChapter(i, 0);
    saveProgress();
  }

  /* ============================================================
     进度
     ============================================================ */
  function progressKey() { return 'bbn.progress.' + S.bookId; }

  function refreshProgress() {
    const h = document.documentElement.scrollHeight - window.innerHeight;
    const ratio = h > 0 ? Math.min(1, Math.max(0, window.scrollY / h)) : 0;
    els.rbProgress.style.width = (ratio * 100).toFixed(1) + '%';
    return ratio;
  }

  function saveProgress() {
    if (!S.bookId || !S.data) return;
    const ratio = refreshProgress();
    LS.set(progressKey(), { c: S.idx, ratio: ratio, at: new Date().toISOString() });
    // 最近阅读（首页「继续阅读」用）
    const shelf = LS.get('bbn.shelf', []) || [];
    const m = S.data.meta;
    const item = {
      id: S.bookId, title: m.title, author: m.author,
      cover: B.crypto.coverOf(m), at: new Date().toISOString(),
      chapter: S.idx + 1, chapterTitle: (S.data.chapters[S.idx] || {}).title || ''
    };
    const next = [item].concat(shelf.filter(x => x && x.id !== S.bookId)).slice(0, 24);
    LS.set('bbn.shelf', next);
  }

  /* ============================================================
     加载
     ============================================================ */
  function showState(node) {
    els.readerState.innerHTML = '';
    els.readerState.style.display = '';
    els.readerArt.classList.add('hidden');
    if (node) els.readerState.appendChild(node);
  }

  function showError(msg, extra) {
    const box = el('div.stack.gap-14', { style: { alignItems: 'center' } },
      el('div.empty-mark', { html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.01"/></svg>' }),
      el('div.empty-title', { text: '打不开这本书' }),
      el('div.empty-desc', { text: msg }),
      el('div.row.gap-8',
        extra || null,
        el('a.btn.btn-sm', { href: 'index.html', text: '返回书库' })
      )
    );
    showState(box);
    const sp = els.readerState.querySelector('.spinner');
    if (sp) sp.remove();
  }

  async function resolveFile() {
    const id = util.qs('id');
    const f = util.qs('f');
    if (f) return { file: f, id: id || f.replace(/^.*\//, '').replace(/\.book$/, '') };
    if (!id) return null;

    const idx = await api.loadIndex();
    document.documentElement.dataset.bookSource = idx.source;
    const hit = (idx.books || []).find(b => b && b.id === id);
    if (hit && hit.file) return { file: CFG.BOOKS_DIR + '/' + hit.file, id: id, entry: hit };
    if (hit) return { file: api.bookPath(id), id: id, entry: hit };
    // 索引里没有，直接猜文件名
    return { file: api.bookPath(id), id: id };
  }

  async function promptPass(fileInfo) {
    const input = el('input.input', { type: 'password', placeholder: '阅读口令' });
    const status = el('div.small.muted', { text: '这是一本私密作品，需要作者设置的阅读口令。' });
    const btn = el('button.btn.btn-primary', { text: '打开' });

    const box = el('div.stack.gap-12', { style: { width: 'min(360px, 88vw)', alignItems: 'stretch' } },
      el('div.empty-mark', { style: { margin: '0 auto' }, html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="4" y="10" width="16" height="10" rx="2.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>' }),
      el('div.empty-title', { text: '私密作品', style: { textAlign: 'center' } }),
      status,
      input,
      btn
    );
    showState(box);

    const attempt = async () => {
      const pass = input.value.trim();
      if (!pass) { input.focus(); return; }
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> 解密中';
      try {
        const text = await api.fetchBook(fileInfo.id);
        const data = await B.crypto.unpack(text, { secret: pass });
        await start(data, fileInfo);
      } catch (e) {
        status.textContent = e.message || '口令不正确';
        status.style.color = 'var(--err)';
        btn.disabled = false;
        btn.textContent = '打开';
        input.select();
      }
    };
    btn.addEventListener('click', attempt);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') attempt(); });
    setTimeout(() => input.focus(), 60);
  }

  async function start(data, info) {
    S.data = data;
    S.bookId = info.id;
    S.idx = 0;

    els.readerState.style.display = 'none';
    els.readerArt.classList.remove('hidden');

    renderHead();

    const saved = LS.get(progressKey(), null);
    const qc = parseInt(util.qs('c'), 10);
    let chapter = 0, ratio = 0;
    if (!isNaN(qc) && qc > 0) chapter = qc - 1;
    else if (saved && typeof saved.c === 'number') { chapter = saved.c; ratio = saved.ratio || 0; }

    renderChapter(chapter, ratio);
    saveProgress();
  }

  async function boot() {
    applyReader();
    bindReaderPanel();
    els.btnToc.addEventListener('click', () => openToc());
    els.btnToc2.addEventListener('click', () => openToc(true));
    els.btnTocClose.addEventListener('click', () => openToc(false));
    els.tocMask.addEventListener('click', () => openToc(false));
    els.btnPrev.addEventListener('click', () => goChap(S.idx - 1));
    els.btnNext.addEventListener('click', () => goChap(S.idx + 1));

    // 顶栏：滚动时隐藏 / 显示
    let lastY = window.scrollY;
    let ticking = false;
    window.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        els.readerBar.classList.toggle('solid', y > 8);
        if (Math.abs(y - lastY) > 6) {
          els.readerBar.classList.toggle('hide', y > lastY && y > 260);
        }
        if (y < 40) els.readerBar.classList.remove('hide');
        lastY = y;
        refreshProgress();
        ticking = false;
      });
    }, { passive: true });

    // 进度节流保存
    let pt = null;
    window.addEventListener('scroll', () => {
      if (pt) return;
      pt = setTimeout(() => { pt = null; saveProgress(); }, 1200);
    }, { passive: true });

    document.addEventListener('keydown', e => {
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      if (e.key === 'ArrowLeft') { if (!els.btnPrev.disabled) goChap(S.idx - 1); }
      else if (e.key === 'ArrowRight') { if (!els.btnNext.disabled) goChap(S.idx + 1); }
      else if (e.key === 'Escape') { openToc(false); els.rdPanel.classList.remove('open'); }
      else if (e.key.toLowerCase() === 't' && !e.ctrlKey && !e.metaKey) openToc();
    });

    // 解析书籍
    let info = null;
    try { info = await resolveFile(); } catch (e) { info = null; }
    if (!info) {
      showError('链接里没有指定作品。请从书库进入，或在地址后加上 ?id=书籍编号。');
      return;
    }
    S.file = info.file;
    S.bookId = info.id;

    try {
      const text = await api.fetchBook(info.id);
      const raw = safeJSON(text, null);
      if (!raw) { showError('书籍文件解析失败，可能上传不完整。'); return; }

      if (raw.crypto && raw.crypto.wrap === 'pass') {
        // 已经有口令缓存？暂不缓存，每次都问
        return promptPass(info);
      }
      const data = await B.crypto.unpack(text, { secret: CFG.SITE_KEY });
      await start(data, info);
    } catch (e) {
      console.error(e);
      const msg = /Failed to fetch|NetworkError/i.test(e.message)
        ? '网络请求失败：书籍文件可能尚未上传，或仓库路径不对（' + CFG.BOOKS_DIR + '）。'
        : e.message;
      showError(msg);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
