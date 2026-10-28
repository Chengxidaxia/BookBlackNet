/* ============================================================
   write.js — 写作台
   一本书 = meta + chapters[]，长期保存在 IndexedDB；
   发布时才打包成 .book（加密）并推到书籍仓库。
   ============================================================ */
(function () {
  'use strict';

  const B = window.BKN;
  const { util, md, store, api } = B;
  const { $, el, toast, esc, words, num, dateStr, debounce, safeJSON } = util;
  const CFG = window.BOOK || {};

  /* ---------------- DOM ---------------- */
  const els = {};
  const IDS = ['shelf-view', 'desk-list', 'editor-view', 'btn-back', 'book-title', 'pub-badge',
    'ed-stats', 'btn-meta', 'btn-preview', 'btn-publish', 'ed-chapters', 'chap-list', 'chap-count',
    'btn-add-chap', 'btn-import-md', 'ed-tools', 'ch-title', 'ed-text', 'ed-preview', 'preview-body',
    'preview-count', 'foot-state', 'foot-count', 'btn-new', 'btn-import', 'btn-backup', 'btn-settings',
    'file-hidden', 'save-hint', 'btn-focus', 'btn-del-chap'];
  IDS.forEach(id => { els[id.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = document.getElementById(id); });

  /* ---------------- 状态 ---------------- */
  const S = {
    book: null,
    chId: null,
    preview: false,
    focus: false,
    saving: false,
    lastSaved: null
  };

  /* ============================================================
     0. 通用：弹窗
     ============================================================ */
  function dialog(opt) {
    const host = el('div.modal-host');
    const close = () => { host.remove(); document.removeEventListener('keydown', onKey); };
    function onKey(e) { if (e.key === 'Escape') close(); }

    const x = el('button.modal-x', {
      html: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg>'
    }, { on: { click: close } });

    const head = el('div.modal-head', el('h3.modal-title', { text: opt.title || '' }), x);
    const body = el('div.modal-body');
    if (opt.body) body.appendChild(opt.body);
    const box = el('div.modal', head, body);

    if (opt.actions && opt.actions.length) {
      const foot = el('div.modal-foot');
      opt.actions.forEach(a => {
        const b = el('button.btn' + (a.cls ? '.' + a.cls.replace(/\s+/g, '.') : ''), { text: a.label });
        b.addEventListener('click', () => a.onClick && a.onClick({ close, btn: b }));
        foot.appendChild(b);
      });
      box.appendChild(foot);
    }

    host.appendChild(box);
    host.addEventListener('mousedown', e => { if (e.target === host) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(host);
    setTimeout(() => { const f = box.querySelector('input,textarea,button.btn-primary'); if (f) f.focus(); }, 40);
    return { close, box, body };
  }

  function confirmBox(title, text, okLabel, onOk) {
    dialog({
      title: title,
      body: el('p.muted.small', { text: text, style: { lineHeight: '1.7', margin: '0 0 4px' } }),
      actions: [
        { label: '取消', onClick: ({ close }) => close() },
        { label: okLabel || '确定', cls: 'danger', onClick: ({ close }) => { close(); onOk(); } }
      ]
    });
  }

  /* ============================================================
     1. 工作台
     ============================================================ */
  async function renderShelf() {
    els.shelfView.classList.remove('hidden');
    els.editorView.classList.add('hidden');
    document.body.classList.remove('editing', 'focus');
    document.title = '写作台 · BookBlackNet';
    if (location.search) history.replaceState(null, '', location.pathname);

    const list = await store.list();
    els.deskList.innerHTML = '';

    if (!list.length) {
      els.deskList.appendChild(el('div.empty', { style: { gridColumn: '1 / -1' } },
        el('div.empty-mark', { html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v18H6.5A2.5 2.5 0 0 1 4 18.5v-13z"/><path d="M8 7h7M8 11h7"/></svg>' }),
        el('div.empty-title', { text: '还没有书稿' }),
        el('div.empty-desc', { text: '新建一本书，草稿会自动存在这台设备上；写够了再发布到书库。' })
      ));
    }

    list.forEach(book => {
      const m = book.meta || {};
      const cov = B.crypto.coverOf(m);
      const wc = (book.chapters || []).reduce((n, c) => n + words(c.content), 0);
      const card = el('div.desk-card', { data: { id: book.id } },
        el('div.desk-cover', {
          text: cov.type === 'image' ? '' : (cov.text || '书'),
          style: cov.type === 'image'
            ? { backgroundImage: 'url("' + cov.url + '")', backgroundSize: 'cover', backgroundPosition: 'center' }
            : { background: 'linear-gradient(155deg,' + cov.from + ',' + cov.to + ')' }
        }),
        el('div.desk-meta',
          el('div.desk-name.truncate', { text: m.title || '未命名作品' }),
          el('div.desk-info', { text: (book.chapters || []).length + ' 章 · ' + num(wc) + ' 字 · ' + (book.updatedAt ? util.timeAgo(book.updatedAt) : '') }),
          el('div.desk-intro.clamp-2', { text: md.plain(m.intro, 46) || '还没有简介' }),
          el('div.desk-tags',
            el('span.badge.' + (book.published ? 'badge-live' : 'badge-draft'), { text: book.published ? '已发布' : '草稿' }),
            m.visibility === 'private' ? el('span.badge.badge-priv', { text: '私密' }) : null,
            m.category ? el('span.tag', { text: m.category }) : null
          )
        ),
        el('button.desk-del', {
          title: '删除书稿',
          html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg>'
        }, { on: {
          click: e => {
            e.stopPropagation();
            confirmBox('删除《' + (m.title || '未命名') + '》？',
              '只删除本机草稿，已发布到仓库的文件不受影响。删除后无法恢复。',
              '删除', async () => {
                await store.remove(book.id);
                toast('已删除', 'ok');
                renderShelf();
              });
          }
        } })
      );
      card.addEventListener('click', () => openEditor(book.id));
      els.deskList.appendChild(card);
    });

    const newCard = el('div.desk-card.new',
      el('div', { text: '＋' }),
      el('div', { text: '新建作品' })
    );
    newCard.addEventListener('click', createBook);
    els.deskList.appendChild(newCard);
  }

  async function createBook() {
    const book = store.blankBook({
      author: safeJSON(localStorage.getItem('bbn.author') || '""', '') || ''
    });
    book.chapters[0].title = '第一章';
    await store.save(book);
    openEditor(book.id, true);
  }

  /* ============================================================
     2. 打开编辑器
     ============================================================ */
  async function openEditor(id, isNew) {
    const book = await store.get(id);
    if (!book) { toast('书稿不存在', 'err'); return renderShelf(); }

    S.book = book;
    book.chapters = book.chapters || [];
    if (!book.chapters.length) book.chapters.push({ id: util.uid('ch_'), title: '第一章', content: '' });
    if (!book.meta) book.meta = {};

    const lastId = util.store.get('bbn.lastChapter.' + book.id, null);
    const pick = book.chapters.find(c => c.id === lastId) || book.chapters[0];
    S.chId = pick.id;

    els.shelfView.classList.add('hidden');
    els.editorView.classList.remove('hidden');
    document.body.classList.add('editing');
    document.title = (book.meta.title || '未命名作品') + ' · 写作台';
    history.replaceState(null, '', '?id=' + encodeURIComponent(book.id));

    els.bookTitle.value = book.meta.title || '';
    els.chTitle.value = pick.title || '';
    els.edText.value = pick.content || '';

    renderChapters();
    refreshStats();
    refreshBadge();
    refreshSaveHint();
    setFoot('就绪');

    // 首屏渲染预览（若上次是预览态）
    if (S.preview) renderPreview();
    setTimeout(() => {
      if (isNew) els.bookTitle.select();
      else els.edText.focus();
    }, 60);
  }

  function refreshBadge() {
    const b = S.book;
    if (!b) return;
    const pub = b.published;
    els.pubBadge.className = 'badge ' + (pub ? 'badge-live' : 'badge-draft');
    els.pubBadge.textContent = pub ? '已发布' : '草稿';
    els.pubBadge.title = pub ? ('发布于 ' + dateStr(pub.at)) : '尚未发布';
    if (b.meta && b.meta.visibility === 'private') {
      els.pubBadge.className = 'badge badge-priv';
      els.pubBadge.textContent = pub ? '私密 · 已发布' : '私密草稿';
    }
  }

  /* ============================================================
     3. 章节
     ============================================================ */
  function currentChapter() {
    if (!S.book) return null;
    return S.book.chapters.find(c => c.id === S.chId) || S.book.chapters[0];
  }

  function renderChapters() {
    const list = S.book.chapters;
    els.chapList.innerHTML = '';
    els.chapCount.textContent = list.length + ' 章';

    list.forEach((c, i) => {
      const wc = words(c.content);
      const item = el('li.chap-item' + (c.id === S.chId ? '.on' : ''), { data: { id: c.id } },
        el('span.no', { text: String(i + 1).padStart(2, '0') }),
        el('span.nm', { text: c.title || '未命名' }),
        el('span.wc', { text: wc ? num(wc) : '' })
      );
      if (c.id === S.chId) {
        const tools = el('span.chap-tools',
          el('button', { title: '上移', text: '↑' }, { on: { click: e => { e.stopPropagation(); moveChapter(i, -1); } } }),
          el('button', { title: '下移', text: '↓' }, { on: { click: e => { e.stopPropagation(); moveChapter(i, 1); } } })
        );
        item.appendChild(tools);
      }
      item.addEventListener('click', () => selectChapter(c.id));
      els.chapList.appendChild(item);
    });

    // 让当前章节可见
    const on = els.chapList.querySelector('.chap-item.on');
    if (on) on.scrollIntoView({ block: 'nearest' });
  }

  function selectChapter(id) {
    if (id === S.chId) return;
    syncCurrent();
    const c = S.book.chapters.find(x => x.id === id);
    if (!c) return;
    S.chId = id;
    els.chTitle.value = c.title || '';
    els.edText.value = c.content || '';
    els.edText.scrollTop = 0;
    util.store.set('bbn.lastChapter.' + S.book.id, id);
    renderChapters();
    refreshStats();
    if (S.preview) renderPreview();
    els.edText.focus();
  }

  function moveChapter(i, dir) {
    const arr = S.book.chapters;
    const j = i + dir;
    if (j < 0 || j >= arr.length) return;
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    scheduleSave();
    renderChapters();
    toast('已调整顺序', 'ok');
  }

  function addChapter() {
    syncCurrent();
    const c = { id: util.uid('ch_'), title: '第' + (S.book.chapters.length + 1) + '章', content: '' };
    S.book.chapters.push(c);
    S.chId = c.id;
    els.chTitle.value = c.title;
    els.edText.value = '';
    util.store.set('bbn.lastChapter.' + S.book.id, c.id);
    renderChapters();
    refreshStats();
    scheduleSave();
    els.chTitle.focus();
    els.chTitle.select();
  }

  function removeChapter() {
    if (S.book.chapters.length <= 1) { toast('至少保留一章', 'err'); return; }
    const cur = currentChapter();
    confirmBox('删除「' + (cur.title || '未命名') + '」？', '这一章的内容会被删除，无法撤销。', '删除', () => {
      const i = S.book.chapters.findIndex(c => c.id === S.chId);
      S.book.chapters.splice(i, 1);
      const next = S.book.chapters[Math.max(0, i - 1)];
      S.chId = next.id;
      els.chTitle.value = next.title;
      els.edText.value = next.content;
      renderChapters();
      refreshStats();
      scheduleSave();
      toast('已删除章节', 'ok');
    });
  }

  /* ============================================================
     4. 保存
     ============================================================ */
  function syncCurrent() {
    if (!S.book) return;
    const c = currentChapter();
    if (!c) return;
    const t = els.chTitle.value.trim();
    if (t !== c.title) c.title = t;
    if (els.edText.value !== c.content) c.content = els.edText.value;
  }

  function setFoot(text, cls) {
    els.footState.textContent = text;
    els.footState.style.color = cls === 'err' ? 'var(--err)' : cls === 'ok' ? 'var(--ok)' : '';
  }

  function refreshSaveHint() {
    if (!S.lastSaved) { els.saveHint.textContent = ''; return; }
    const d = new Date(S.lastSaved);
    const p = n => String(n).padStart(2, '0');
    els.saveHint.textContent = '已保存 ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  let savingTimer = null;
  function scheduleSave() {
    setFoot('未保存…');
    if (savingTimer) clearTimeout(savingTimer);
    savingTimer = setTimeout(() => flushSave(), 700);
  }

  async function flushSave() {
    if (!S.book || S.saving) return;
    if (savingTimer) { clearTimeout(savingTimer); savingTimer = null; }
    syncCurrent();
    S.saving = true;
    try {
      // meta.title 跟随顶部输入
      const t = els.bookTitle.value.trim();
      if (t !== S.book.meta.title) S.book.meta.title = t;
      S.book.meta.updatedAt = new Date().toISOString();
      await store.save(S.book);
      S.lastSaved = Date.now();
      setFoot('已自动保存', 'ok');
      refreshSaveHint();
      refreshStats();
    } catch (e) {
      console.error(e);
      setFoot('保存失败：' + e.message, 'err');
      toast('本地保存失败：' + e.message, 'err');
    } finally {
      S.saving = false;
    }
  }

  /* ============================================================
     5. 统计 / 预览
     ============================================================ */
  function refreshStats() {
    if (!S.book) return;
    const arr = S.book.chapters;
    const total = arr.reduce((n, c) => n + words(c.content), 0);
    const cur = words(currentChapter() ? currentChapter().content : els.edText.value);
    els.edStats.textContent = '本章 ' + num(cur) + ' · 全书 ' + num(total);
    els.footCount.textContent = arr.length + ' 章 · ' + num(total) + ' 字';
    if (S.preview) els.previewCount.textContent = num(cur) + ' 字';
  }

  const renderPreview = debounce(function () {
    if (!S.book) return;
    const c = currentChapter();
    const text = c ? c.content : '';
    els.previewBody.innerHTML = md.render(text) ||
      '<p class="muted" style="font-size:13px;font-family:var(--sans)">这一章还是空的。</p>';
    els.previewCount.textContent = num(words(text)) + ' 字';
  }, 180);

  function togglePreview(force) {
    S.preview = force === undefined ? !S.preview : force;
    els.editorView.classList.toggle('preview', S.preview);
    els.btnPreview.setAttribute('aria-pressed', S.preview ? 'true' : 'false');
    els.btnPreview.classList.toggle('btn-primary', false);
    if (S.preview) renderPreview();
  }

  function toggleFocus(force) {
    S.focus = force === undefined ? !S.focus : force;
    document.body.classList.toggle('focus', S.focus);
    if (S.focus) { els.edText.focus(); setFoot('专注模式 · Esc 退出'); }
    else { setFoot('就绪'); refreshStats(); }
  }

  /* ============================================================
     6. 工具栏
     ============================================================ */
  function surround(before, after, placeholder) {
    const ta = els.edText;
    const s = ta.selectionStart, e = ta.selectionEnd;
    const val = ta.value;
    let sel = val.slice(s, e) || placeholder || '';
    // 已包裹则取消
    if (val.slice(s - before.length, s) === before && val.slice(e, e + after.length) === after) {
      ta.value = val.slice(0, s - before.length) + val.slice(s, e) + val.slice(e + after.length);
      ta.setSelectionRange(s - before.length, e - before.length);
    } else {
      ta.value = val.slice(0, s) + before + sel + after + val.slice(e);
      const a = s + before.length, b = a + sel.length;
      ta.setSelectionRange(a, b);
    }
    ta.focus();
    onInput();
  }

  function prefixLines(fn) {
    const ta = els.edText;
    const val = ta.value;
    const s = ta.selectionStart, e = ta.selectionEnd;
    const start = val.lastIndexOf('\n', s - 1) + 1;
    let end = val.indexOf('\n', e);
    if (end < 0) end = val.length;
    const block = val.slice(start, end);
    const lines = block.split('\n');
    let n = 0;
    const out = lines.map(l => fn(l, n++)).join('\n');
    ta.value = val.slice(0, start) + out + val.slice(end);
    ta.setSelectionRange(start, start + out.length);
    ta.focus();
    onInput();
  }

  function insertText(txt) {
    const ta = els.edText;
    const s = ta.selectionStart, e = ta.selectionEnd;
    ta.value = ta.value.slice(0, s) + txt + ta.value.slice(e);
    ta.setSelectionRange(s + txt.length, s + txt.length);
    ta.focus();
    onInput();
  }

  function runCmd(cmd) {
    const ta = els.edText;
    if (cmd !== 'undo' && cmd !== 'redo') ta.focus();
    switch (cmd) {
      case 'undo': case 'redo':
        document.execCommand(cmd); onInput(); break;
      case 'h2': prefixLines(l => '## ' + l.replace(/^#{1,6}\s+/, '')); break;
      case 'bold': surround('**', '**', '粗体'); break;
      case 'italic': surround('*', '*', '斜体'); break;
      case 'strike': surround('~~', '~~', '删除线'); break;
      case 'quote': prefixLines(l => '> ' + l.replace(/^>\s?/, '')); break;
      case 'ul': prefixLines(l => '- ' + l.replace(/^[-*+]\s+/, '')); break;
      case 'ol': prefixLines((l, i) => (i + 1) + '. ' + l.replace(/^\d+[.)]\s+/, '')); break;
      case 'divider': insertText('\n\n---\n\n'); break;
      case 'link': {
        const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd) || '链接文字';
        surround('[', '](https://)', sel);
        // 选中 URL 占位，方便直接粘贴
        const pos = ta.selectionStart;
        const after = ta.value.slice(pos);
        const m = /\]\(https:\/\/\)/.exec(after);
        if (m) ta.setSelectionRange(pos + m.index + 3, pos + m.index + 11);
        break;
      }
      case 'image': {
        promptUrl();
        break;
      }
    }
  }

  function promptUrl() {
    const input = el('input.input', { placeholder: 'https://… 图片地址', type: 'url' });
    dialog({
      title: '插入图片',
      body: el('div.stack.gap-10',
        el('div.field', el('label.label', { text: '图片地址' }), input),
        el('div.hint', { text: '支持外链图片；图片不会存进 .book 文件，请确保链接长期可访问。' })
      ),
      actions: [
        { label: '取消', onClick: ({ close }) => close() },
        {
          label: '插入', cls: 'primary', onClick: ({ close }) => {
            let u = input.value.trim();
            if (!u) return;
            if (!/^(https?:)?\/\//.test(u)) { toast('请填写完整图片地址', 'err'); return; }
            close();
            const ta = els.edText;
            const s = ta.selectionStart;
            const needNl = s > 0 && ta.value[s - 1] !== '\n';
            insertText((needNl ? '\n\n' : '') + '![](' + u + ')\n\n');
          }
        }
      ]
    });
  }

  /* ============================================================
     7. 输入事件
     ============================================================ */
  function onInput() {
    const c = currentChapter();
    if (c) {
      c.content = els.edText.value;
      c.title = c.title; // 标题由 ch-title 单独维护
    }
    refreshStats();
    scheduleSave();
    if (S.preview) renderPreview();
  }

  /* ============================================================
     8. 元数据
     ============================================================ */
  function openMetaDialog() {
    if (!S.book) return;
    const m = S.book.meta;
    const f = {
      title: el('input.input', { value: m.title || '', maxlength: '60' }),
      author: el('input.input', { value: m.author || '', maxlength: '30', placeholder: '笔名' }),
      category: el('select.select', CFG.CATEGORIES.map(c => el('option', { value: c, text: c })).concat(
        CFG.CATEGORIES.indexOf(m.category) < 0 && m.category ? [el('option', { value: m.category, text: m.category, selected: true })] : []
      )),
      status: el('select.select',
        el('option', { value: 'ongoing', text: '连载中' }),
        el('option', { value: 'done', text: '已完结' })
      ),
      tags: el('input.input', { value: (m.tags || []).join('，'), placeholder: '用逗号分隔，最多 6 个' }),
      intro: el('textarea.textarea', { rows: '4', maxlength: '500', placeholder: '一段能让人想点开的简介' }),
      private: el('input', { type: 'checkbox', checked: m.visibility === 'private' })
    };
    f.category.value = m.category || '玄幻';
    f.status.value = m.status === 'done' ? 'done' : 'ongoing';
    f.intro.value = m.intro || '';

    const coverPrev = el('div.cover-prev', {
      text: B.crypto.firstChar(m.title || '书'),
      style: (() => { const c = B.crypto.coverOf(m); return { background: 'linear-gradient(155deg,' + c.from + ',' + c.to + ')' }; })()
    });

    const body = el('div.stack.gap-14',
      el('div.form-grid',
        el('div.field.full', el('label.label', { text: '作品名' }), f.title),
        el('div.field', el('label.label', { text: '笔名' }), f.author),
        el('div.field', el('label.label', { text: '分类' }), f.category),
        el('div.field', el('label.label', { text: '连载状态' }), f.status),
        el('div.field', el('label.label', { text: '标签' }), f.tags),
        el('div.field.full', el('label.label', { text: '简介' }), f.intro)
      ),
      el('div.field',
        el('label.label', { text: '封面' }),
        el('div.cover-row', coverPrev,
          el('div.small.muted', { text: '未上传封面时，按书名自动生成书法色卡封面（不占体积）。' })
        )
      ),
      el('label.switch',
        f.private,
        el('span.track'),
        el('span', { text: '私密作品：发布后需要用阅读口令才能打开' })
      ),
      el('div.hint', { text: '私密作品会用你设置的阅读口令加密正文；公开作品用站点密钥加密，读者打开即读。' })
    );

    ['input', 'change'].forEach(ev => {
      f.title.addEventListener(ev, () => {
        coverPrev.textContent = B.crypto.firstChar(f.title.value || '书');
        const c = B.crypto.coverOf({ title: f.title.value });
        coverPrev.style.background = 'linear-gradient(155deg,' + c.from + ',' + c.to + ')';
      });
    });

    dialog({
      title: '作品信息',
      body: body,
      actions: [
        { label: '取消', onClick: ({ close }) => close() },
        {
          label: '保存', cls: 'primary', onClick: ({ close }) => {
            m.title = f.title.value.trim() || '未命名作品';
            m.author = f.author.value.trim();
            m.category = f.category.value;
            m.status = f.status.value;
            m.tags = f.tags.value.split(/[,，\s]+/).map(s => s.trim()).filter(Boolean).slice(0, 6);
            m.intro = f.intro.value.trim();
            m.visibility = f.private.checked ? 'private' : 'public';
            if (m.author) { try { localStorage.setItem('bbn.author', JSON.stringify(m.author)); } catch (e) {} }
            els.bookTitle.value = m.title;
            document.title = m.title + ' · 写作台';
            close();
            flushSave();
            refreshBadge();
            toast('作品信息已更新', 'ok');
          }
        }
      ]
    });
  }

  /* ============================================================
     9. 发布
     ============================================================ */
  function openPublishDialog() {
    if (!S.book) return;
    syncCurrent();
    const m = S.book.meta;
    const chapCount = S.book.chapters.length;
    const total = S.book.chapters.reduce((n, c) => n + words(c.content), 0);

    // 先补全必要信息
    if (!m.title || m.title === '未命名作品') {
      toast('先给作品起个名字', 'err');
      openMetaDialog();
      return;
    }
    if (total < 10) { toast('正文还太短，先写点内容', 'err'); return; }

    const hasToken = !!api.auth.get();
    const modeSel = el('select.select',
      el('option', { value: 'github', text: 'GitHub 令牌（浏览器直连）' }),
      (CFG.API_BASE ? el('option', { value: 'worker', text: '自建后端（Worker）' }) : null)
    );
    modeSel.value = api.auth.mode() === 'worker' && CFG.API_BASE ? 'worker' : 'github';

    const tokenInput = el('input.input', { type: 'password', placeholder: 'ghp_… 或 github_pat_…', value: hasToken ? '••••••••••••' : '' });
    const tokenWrap = el('div.field', el('label.label', { text: '访问令牌' }), tokenInput);
    const passInput = el('input.input', { type: 'password', placeholder: '读者打开这本书时要输入的口令' });
    const passWrap = el('div.field' + (m.visibility === 'private' ? '' : '.hidden'),
      el('label.label', { text: '阅读口令' }), passInput,
      el('div.hint', { text: '口令不会上传，只用于加密。忘记口令 = 这本书永久打不开，请自行保管。' })
    );
    const status = el('div.pub-status', el('span.dot'), el('span', { text: '准备就绪。发布后约 1 分钟 GitHub Pages 生效。' }));
    const linkBox = el('div.hidden');

    // 切换通道时显示/隐藏令牌
    modeSel.addEventListener('change', () => {
      api.auth.setMode(modeSel.value);
      tokenWrap.classList.toggle('hidden', modeSel.value !== 'github' || hasToken);
    });

    const body = el('div.stack.gap-12',
      el('div.small', { style: { lineHeight: '1.7' } },
        '将发布《', el('strong', { text: m.title }), '》 · ', chapCount + ' 章 · ' + num(total) + ' 字'
      ),
      el('div.form-grid',
        el('div.field.full', el('label.label', { text: '发布通道' }), modeSel),
        el('div.field.full', tokenWrap),
        passWrap
      ),
      el('div.hint', { text: '令牌需要仓库 ' + CFG.REPO_OWNER + '/' + CFG.REPO_NAME + ' 的 contents 写入权限；只保存在本机浏览器，不会上传。' }),
      status,
      linkBox
    );
    tokenWrap.classList.toggle('hidden', modeSel.value !== 'github' || hasToken);

    const dlg = dialog({
      title: '发布作品',
      body: body,
      actions: [
        {
          label: '仅下载 .book', onClick: async ({ btn }) => {
            try {
              btn.disabled = true;
              const packed = await buildPacked();
              util.download(packed.fileName, new Blob([packed.json], { type: 'application/json' }));
              status.className = 'pub-status ok';
              status.lastChild.textContent = '已生成 ' + packed.fileName + '（' + (packed.bytes / 1024).toFixed(1) + ' KB），可手动放进 ' + CFG.BOOKS_DIR + '/';
              toast('已下载 .book', 'ok');
            } catch (e) {
              status.className = 'pub-status err';
              status.lastChild.textContent = e.message;
            } finally { btn.disabled = false; }
          }
        },
        {
          label: '发布', cls: 'primary', onClick: async ({ btn }) => {
            if (modeSel.value === 'github') {
              const t = tokenInput.value.trim();
              if (t && t.indexOf('•') < 0) api.auth.set(t);
              if (!api.auth.get()) { toast('请填写 GitHub 访问令牌', 'err'); tokenInput.focus(); return; }
            }
            if (m.visibility === 'private' && !passInput.value.trim()) {
              toast('私密作品需要设置阅读口令', 'err'); passInput.focus(); return;
            }
            btn.disabled = true;
            const old = btn.innerHTML;
            btn.innerHTML = '<span class="spinner"></span> 发布中';
            status.className = 'pub-status';
            status.lastChild.textContent = '正在加密并上传…';
            try {
              const packed = await buildPacked();
              const entry = {
                id: S.book.id, title: m.title, author: m.author || '佚名', intro: m.intro,
                category: m.category, tags: m.tags, status: m.status, visibility: m.visibility,
                cover: S.book.meta.cover, chapters: chapCount, words: total
              };
              const res = await api.publish(packed, entry);

              S.book.published = {
                at: new Date().toISOString(), mode: res.mode, sha: res.sha || null,
                file: packed.fileName, words: total, chapters: chapCount
              };
              S.book.meta.updatedAt = S.book.published.at;
              await store.save(S.book);
              refreshBadge();

              const url = new URL('read.html?id=' + encodeURIComponent(S.book.id), location.href).href;
              status.className = 'pub-status ok';
              status.lastChild.textContent = '发布成功（' + res.mode + '）。GitHub Pages 通常 1 分钟内生效。';
              linkBox.classList.remove('hidden');
              linkBox.innerHTML = '';
              linkBox.appendChild(el('div.field',
                el('label.label', { text: '阅读地址' }),
                el('div.row.gap-8',
                  el('input.input', { value: url, readOnly: true, style: { fontSize: '12px' } }),
                  el('button.btn.btn-sm', { text: '复制' }, { on: { click: () => { util.copy(url); toast('链接已复制', 'ok'); } } })
                )
              ));
              toast('发布成功', 'ok');
            } catch (e) {
              console.error(e);
              status.className = 'pub-status err';
              status.lastChild.textContent = e.message;
              toast('发布失败：' + e.message, 'err');
            } finally {
              btn.disabled = false;
              btn.innerHTML = old;
            }
          }
        }
      ]
    });

    async function buildPacked() {
      const priv = m.visibility === 'private';
      const secret = priv ? passInput.value.trim() : CFG.SITE_KEY;
      if (!secret) throw new Error(priv ? '缺少阅读口令' : '站点密钥未配置（config.js）');
      if (!B.crypto.hasSubtle()) throw new Error('当前环境不支持 WebCrypto，请用 https 或 localhost 打开');
      syncCurrent();
      return await B.crypto.pack(S.book, { secret: secret, wrap: priv ? 'pass' : 'site' });
    }
  }

  /* ============================================================
     10. 设置
     ============================================================ */
  function openSettings() {
    const tokenInput = el('input.input', { type: 'password', placeholder: hasToken() ? '已保存，输入新值可覆盖' : 'ghp_…' });
    const modeSel = el('select.select',
      el('option', { value: 'github', text: 'GitHub 令牌（浏览器直连）' }),
      CFG.API_BASE ? el('option', { value: 'worker', text: '自建后端（Worker）' }) : null
    );
    modeSel.value = api.auth.mode();

    const status = el('div.pub-status', el('span.dot'), el('span', { text: '未校验' }));

    const body = el('div.stack.gap-14',
      el('div.field', el('label.label', { text: '发布通道' }), modeSel),
      el('div.field', el('label.label', { text: 'GitHub 访问令牌' }), tokenInput,
        el('div.hint', { text: 'Fine-grained token 需勾选 Contents: Read and write；只存本机。' })),
      el('div.row.gap-8',
        el('button.btn.btn-sm', { text: '校验令牌' }, { on: { click: async (e) => {
          const t = tokenInput.value.trim();
          if (t) api.auth.set(t);
          status.className = 'pub-status';
          status.lastChild.textContent = '校验中…';
          try {
            const r = await api.checkToken();
            status.className = 'pub-status ok';
            status.lastChild.textContent = '已连接 ' + r.user + ' · ' + r.repo + (r.private ? '（私有）' : '（公开）') + (r.push ? ' · 可写入' : ' · 只读，无法发布');
          } catch (err) {
            status.className = 'pub-status err';
            status.lastChild.textContent = err.message;
          }
        } } }),
        el('button.btn.btn-sm', { text: '清除令牌' }, { on: { click: () => { api.auth.clear(); tokenInput.value = ''; toast('已清除令牌', 'ok'); } } })
      ),
      status,
      el('hr'),
      el('div.small.muted', { style: { lineHeight: '1.7' } },
        '站点密钥（内置，用于公开书自动解密）：',
        el('code', { text: String(CFG.SITE_KEY || '').slice(0, 10) + '…' })
      ),
      el('div.row.gap-8',
        el('button.btn.btn-sm.btn-danger', { text: '清空本机全部书稿' }, { on: { click: () => {
          confirmBox('清空本机书稿？', '所有未发布草稿都会消失，已发布的仓库文件不受影响。', '清空', async () => {
            const list = await store.list();
            for (const b of list) await store.remove(b.id);
            toast('已清空', 'ok');
            renderShelf();
          });
        } } })
      )
    );

    dialog({ title: '设置', body: body, actions: [{ label: '完成', cls: 'primary', onClick: ({ close }) => {
      const t = tokenInput.value.trim();
      if (t) api.auth.set(t);
      api.auth.setMode(modeSel.value);
      close();
    } }] });
  }
  function hasToken() { return !!api.auth.get(); }

  /* ============================================================
     11. 导入
     ============================================================ */
  async function importFile(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.md') || name.endsWith('.txt')) return importMarkdown(file);
    if (name.endsWith('.json') && !name.endsWith('.book')) {
      // 备份或 .book（JSON 内容）
      const text = await file.text();
      const j = safeJSON(text, null);
      if (j && j.format === 'bookblacknet.workspace') {
        const n = await store.importAll(text);
        toast('已恢复 ' + n + ' 本书稿', 'ok');
        renderShelf();
        return;
      }
      if (j && j.format === 'bookblacknet.book') return importBookJSON(text, file);
      toast('无法识别的文件', 'err');
      return;
    }
    const text = await file.text();
    return importBookJSON(text, file);
  }

  async function importBookJSON(text, file) {
    let parsed;
    try { parsed = JSON.parse(text); } catch (e) { toast('文件不是有效的 JSON', 'err'); return; }
    if (!parsed || parsed.format !== 'bookblacknet.book') { toast('不是 .book 文件', 'err'); return; }

    const isPriv = parsed.crypto && parsed.crypto.wrap === 'pass';
    const passInput = el('input.input', { type: 'password', placeholder: '阅读口令' });
    const status = el('div.pub-status', el('span.dot'), el('span', { text: '' }));

    const doImport = async (secret, close) => {
      try {
        status.className = 'pub-status';
        status.lastChild.textContent = '解密中…';
        const data = await B.crypto.unpack(text, { secret: secret });
        const book = {
          id: data.meta.id || util.uid('bk_'),
          meta: data.meta,
          chapters: data.chapters,
          createdAt: data.meta.createdAt,
          updatedAt: new Date().toISOString(),
          published: { at: new Date().toISOString(), file: file.name, words: data.words, chapters: data.chapters.length, imported: true }
        };
        await store.save(book);
        toast('已导入《' + book.meta.title + '》', 'ok');
        close();
        openEditor(book.id);
      } catch (e) {
        status.className = 'pub-status err';
        status.lastChild.textContent = e.message;
      }
    };

    if (!isPriv) { await doImport(CFG.SITE_KEY, { close() {} }); return; }

    dialog({
      title: '导入私密作品',
      body: el('div.stack.gap-12',
        el('div.small', { text: '《' + (parsed.meta && parsed.meta.title) + '》需要阅读口令。' }),
        el('div.field', el('label.label', { text: '阅读口令' }), passInput),
        status
      ),
      actions: [
        { label: '取消', onClick: ({ close }) => close() },
        { label: '解密导入', cls: 'primary', onClick: ({ close }) => doImport(passInput.value.trim(), { close }) }
      ]
    });
  }

  async function importMarkdown(file) {
    const text = await file.text();
    // 按一级/二级标题或「第X章」拆分
    const parts = [];
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    let cur = { title: '', buf: [] };
    const isHead = l => /^#{1,2}\s+\S/.test(l) || /^\s*第[0-9零一二三四五六七八九十百千]+\s*[章节回][\s、.．:：]/.test(l);

    lines.forEach(l => {
      if (isHead(l)) {
        if (cur.buf.join('').trim() || cur.title) parts.push(cur);
        cur = { title: l.replace(/^#{1,2}\s+/, '').trim(), buf: [] };
      } else cur.buf.push(l);
    });
    if (cur.buf.join('').trim() || cur.title) parts.push(cur);

    const chapters = parts.filter(p => p.title || p.buf.join('').trim())
      .map((p, i) => ({ id: util.uid('ch_'), title: p.title || ('第 ' + (i + 1) + ' 章'), content: p.buf.join('\n').trim() }));

    if (!chapters.length) { toast('没有解析出章节', 'err'); return; }

    const book = store.blankBook({ title: file.name.replace(/\.(md|txt)$/i, ''), author: '' });
    book.chapters = chapters;
    await store.save(book);
    toast('已导入 ' + chapters.length + ' 章', 'ok');
    openEditor(book.id);
  }

  /* ============================================================
     12. 绑定
     ============================================================ */
  function bind() {
    els.btnNew.addEventListener('click', createBook);
    els.btnBack.addEventListener('click', async () => { await flushSave(); renderShelf(); });
    els.btnAddChap.addEventListener('click', addChapter);
    els.btnDelChap.addEventListener('click', removeChapter);
    els.btnMeta.addEventListener('click', openMetaDialog);
    els.btnPublish.addEventListener('click', openPublishDialog);
    els.btnSettings.addEventListener('click', openSettings);
    els.btnFocus.addEventListener('click', () => toggleFocus());
    els.btnPreview.addEventListener('click', () => togglePreview());

    els.btnImport.addEventListener('click', () => {
      els.fileHidden.accept = '.book,.json,.md,.txt';
      els.fileHidden.value = '';
      els.fileHidden.click();
    });
    els.btnBackup.addEventListener('click', async () => {
      const txt = await store.exportAll();
      util.download('bookblacknet-workspace-' + dateStr(new Date()) + '.json', new Blob([txt], { type: 'application/json' }));
      toast('已导出工作区备份', 'ok');
    });
    els.btnImportMd.addEventListener('click', () => {
      els.fileHidden.accept = '.md,.txt';
      els.fileHidden.value = '';
      els.fileHidden.click();
    });

    els.fileHidden.addEventListener('change', async () => {
      const f = els.fileHidden.files && els.fileHidden.files[0];
      if (!f) return;
      try { await importFile(f); }
      catch (e) { console.error(e); toast('导入失败：' + e.message, 'err'); }
    });

    // 标题输入
    els.bookTitle.addEventListener('input', () => {
      if (!S.book) return;
      S.book.meta.title = els.bookTitle.value;
      document.title = (els.bookTitle.value || '未命名作品') + ' · 写作台';
      scheduleSave();
    });

    // 章节标题
    els.chTitle.addEventListener('input', () => {
      const c = currentChapter();
      if (!c) return;
      c.title = els.chTitle.value;
      scheduleSave();
      // 只更新列表中对应项文字，避免整表重建丢焦点
      const item = els.chapList.querySelector('.chap-item.on .nm');
      if (item) item.textContent = c.title || '未命名';
    });

    els.edText.addEventListener('input', onInput);
    els.edText.addEventListener('keydown', e => {
      if (e.key === 'Tab') {
        e.preventDefault();
        insertText('  ');
      }
    });

    // 工具栏
    els.edTools.addEventListener('click', e => {
      const btn = e.target.closest('[data-cmd]');
      if (btn) { e.preventDefault(); runCmd(btn.dataset.cmd); }
    });

    // 全局快捷键
    document.addEventListener('keydown', e => {
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === 'Escape' && S.focus) { toggleFocus(false); return; }
      if (!S.book || els.editorView.classList.contains('hidden')) return;
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        flushSave().then(() => toast('已保存到本机', 'ok'));
      } else if (mod && e.key.toLowerCase() === 'b') {
        e.preventDefault(); runCmd('bold');
      } else if (mod && e.key.toLowerCase() === 'i') {
        e.preventDefault(); runCmd('italic');
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault(); togglePreview();
      }
    });

    // 离开前保存
    window.addEventListener('beforeunload', () => {
      if (S.book) {
        syncCurrent();
        try { store.save(S.book); } catch (e) {}
      }
    });

    // 移动端：点正文区收起章节栏
    els.edText.addEventListener('focus', () => els.edChapters.classList.remove('open'));

    // 专注模式退出按钮
    const exit = el('button.focus-exit', { text: 'Esc 退出专注' });
    exit.addEventListener('click', () => toggleFocus(false));
    document.body.appendChild(exit);
  }

  /* ============================================================
     13. 启动
     ============================================================ */
  async function boot() {
    bind();
    const id = util.qs('id');
    if (id) {
      const b = await store.get(id);
      if (b) return openEditor(id);
      toast('本机没有这本书的草稿', 'err');
    }
    renderShelf();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
