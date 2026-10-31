/* ============================================================
   editor.js — 编辑器（独立页面 editor.html?id=<bookId>）
   书稿数据在 IndexedDB；发布时打包 .book 推到书籍仓库。
   跳转：write.html（书架）→ editor.html?id=…；返回用浏览器后退或返回按钮。
   ============================================================ */
(function () {
  'use strict';

  const B = window.BKN;
  const { util, md, store, api } = B;
  const { el, toast, words, num, dateStr, debounce, safeJSON } = util;
  const { dialog, confirmBox, promptDialog } = B.ui;
  const CFG = window.BOOK || {};

  /* ---------------- DOM ---------------- */
  const els = {};
  const IDS = ['editor-view', 'btn-back', 'book-title', 'pub-badge', 'ed-stats', 'btn-meta',
    'btn-preview', 'btn-publish', 'ed-chapters', 'chap-mask', 'btn-toc-ch', 'chap-list', 'chap-count',
    'btn-add-chap', 'btn-import-md', 'ed-tools', 'ch-title', 'ed-text', 'ed-preview', 'preview-body',
    'preview-count', 'foot-state', 'foot-count', 'gist-state', 'btn-focus', 'btn-del-chap',
    'btn-settings', 'save-hint', 'file-md-hidden'];
  IDS.forEach(id => { els[id.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = document.getElementById(id); });

  /* ---------------- 状态 ---------------- */
  const S = {
    book: null,
    chId: null,
    preview: false,
    focus: false,
    saving: false,
    lastSaved: null,
    user: null                 // 群档案账号（boot 时登录检测填充）
  };

  let undo = null; // core/undo.js

  /* ============================================================
     1. 打开 / 章节管理
     ============================================================ */
  async function openEditor(id) {
    const book = await store.get(id);
    if (!book) { toast('本机没有这本书的草稿', 'err'); setTimeout(() => { location.href = 'write.html'; }, 900); return; }

    S.book = book;
    book.chapters = book.chapters || [];
    if (!book.chapters.length) book.chapters.push({ id: util.uid('ch_'), title: '第一章', content: '' });
    if (!book.meta) book.meta = {};

    const lastId = util.store.get('bbn.lastChapter.' + book.id, null);
    const pick = book.chapters.find(c => c.id === lastId) || book.chapters[0];
    S.chId = pick.id;

    // 统一地址为 ?id=（兼容老的 ?d= 入口）
    if (!util.qs('id')) history.replaceState(null, '', '?id=' + encodeURIComponent(book.id));

    document.title = (book.meta.title || '未命名作品') + ' · 编辑器';
    els.bookTitle.value = book.meta.title || '';
    els.chTitle.value = pick.title || '';
    els.edText.value = pick.content || '';
    if (undo) undo.clear();

    renderChapters();
    refreshStats();
    refreshBadge();
    refreshSaveHint();
    setFoot('就绪');

    setTimeout(() => els.edText.focus(), 60);
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
      const item = el('li.chap-item' + (c.id === S.chId ? '.on' : ''), { data: { id: c.id },
        on: { click: () => selectChapter(c.id) }
      },
        el('span.no', { text: String(i + 1).padStart(2, '0') }),
        el('span.nm', { text: c.title || '未命名' }),
        el('span.wc', { text: wc ? num(wc) : '' })
      );
      if (c.id === S.chId) {
        item.appendChild(el('span.chap-tools',
          el('button', { title: '上移', text: '↑', on: { click: e => { e.stopPropagation(); moveChapter(i, -1); } } }),
          el('button', { title: '下移', text: '↓', on: { click: e => { e.stopPropagation(); moveChapter(i, 1); } } })
        ));
      }
      els.chapList.appendChild(item);
    });

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
    if (undo) undo.clear();
    if (S.preview) renderPreview();
    els.edText.focus();
    closeToc();
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
    if (undo) undo.clear();
    util.store.set('bbn.lastChapter.' + S.book.id, c.id);
    renderChapters();
    refreshStats();
    scheduleSave();
    closeToc();
    els.chTitle.focus();
    els.chTitle.select();
  }

  function removeChapter() {
    if (S.book.chapters.length <= 1) { toast('至少保留一章', 'err'); return; }
    const cur = currentChapter();
    const doRemove = () => {
      const i = S.book.chapters.findIndex(c => c.id === S.chId);
      S.book.chapters.splice(i, 1);
      const next = S.book.chapters[Math.max(0, i - 1)];
      S.chId = next.id;
      els.chTitle.value = next.title;
      els.edText.value = next.content;
      if (undo) undo.clear();
      renderChapters();
      refreshStats();
      scheduleSave();
      toast('已删除章节', 'ok');
    };
    if (!B.prefs.get('editor.confirmDelete', true)) return doRemove();
    confirmBox('删除「' + (cur.title || '未命名') + '」？', '这一章的内容会被删除，无法撤销。', '删除', doRemove);
  }

  /* ---------------- 移动端章节抽屉 ---------------- */
  function toggleToc(force) {
    const open = force === undefined ? !els.edChapters.classList.contains('open') : force;
    els.edChapters.classList.toggle('open', open);
    els.chapMask.classList.toggle('hidden', !open);
  }
  function closeToc() {
    if (els.edChapters.classList.contains('open')) toggleToc(false);
  }

  /* ============================================================
     2. 保存
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
    savingTimer = setTimeout(() => flushSave(), B.prefs ? B.prefs.get('editor.autosaveMs', 700) : 700);
  }

  async function flushSave() {
    if (!S.book || S.saving) return;
    if (savingTimer) { clearTimeout(savingTimer); savingTimer = null; }
    syncCurrent();
    S.saving = true;
    try {
      const t = els.bookTitle.value.trim();
      if (t !== S.book.meta.title) S.book.meta.title = t;
      S.book.meta.updatedAt = new Date().toISOString();
      await store.save(S.book);
      S.lastSaved = Date.now();
      setFoot('已自动保存', 'ok');
      refreshSaveHint();
      refreshStats();
      if (B.gist) B.gist.onBookSaved(S.book);   // 云同步（阶段 4 接入，无 gist.js 时为空操作）
    } catch (e) {
      console.error(e);
      setFoot('保存失败：' + e.message, 'err');
      toast('本地保存失败：' + e.message, 'err');
    } finally {
      S.saving = false;
    }
  }

  /* 尽快落盘：关页/切后台时调用（fire-and-forget，IDB 写入一旦发起即可完成） */
  function saveNow() {
    if (!S.book) return;
    try {
      syncCurrent();
      const t = els.bookTitle.value.trim();
      if (t !== S.book.meta.title) S.book.meta.title = t;
      S.book.meta.updatedAt = new Date().toISOString();
      store.save(S.book).catch(() => {});
    } catch (e) {}
  }

  /* ============================================================
     3. 统计 / 预览 / 专注
     ============================================================ */
  function refreshStats() {
    if (!S.book) return;
    const arr = S.book.chapters;
    const total = arr.reduce((n, c) => n + words(c.content), 0);
    const cur = words(currentChapter() ? currentChapter().content : els.edText.value);
    els.edStats.textContent = '本章 ' + num(cur) + ' · 全书 ' + num(total);
    let foot = arr.length + ' 章 · ' + num(total) + ' 字';
    if (B.stats && B.prefs.get('editor.showStats', true)) {
      const goal = B.prefs.get('editor.dailyGoal', 1000);
      const today = B.stats.today();
      const pct = goal ? Math.min(100, Math.round(today / goal * 100)) : 0;
      foot = '今日 ' + num(today) + ' 字（' + pct + '%） · 连续 ' + B.stats.streak() + ' 天 · ' + foot;
      if (B.stats.tick) B.stats.tick(S.book.id, total);
    }
    els.footCount.textContent = foot;
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
    if (S.preview) renderPreview();
  }

  function toggleFocus(force) {
    S.focus = force === undefined ? !S.focus : force;
    document.body.classList.toggle('focus', S.focus);
    if (S.focus) { els.edText.focus(); setFoot('专注模式 · Esc 退出'); }
    else { setFoot('就绪'); refreshStats(); }
  }

  /* ============================================================
     4. 工具栏
     ============================================================ */
  function surround(before, after, placeholder) {
    const ta = els.edText;
    const s = ta.selectionStart, e = ta.selectionEnd;
    const val = ta.value;
    let sel = val.slice(s, e) || placeholder || '';
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
    if (undo) undo.push(true);   // 程序化改值：强制入栈（Bug D 修复配套）
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
    if (undo) undo.push(true);
  }

  function insertText(txt) {
    const ta = els.edText;
    const s = ta.selectionStart, e = ta.selectionEnd;
    ta.value = ta.value.slice(0, s) + txt + ta.value.slice(e);
    ta.setSelectionRange(s + txt.length, s + txt.length);
    ta.focus();
    onInput();
    if (undo) undo.push(true);
  }

  function runCmd(cmd) {
    const ta = els.edText;
    switch (cmd) {
      case 'undo': if (undo) { undo.undo(); onInput(); } break;
      case 'redo': if (undo) { undo.redo(); onInput(); } break;
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
        const pos = ta.selectionStart;
        const after = ta.value.slice(pos);
        const m = /\]\(https:\/\/\)/.exec(after);
        if (m) ta.setSelectionRange(pos + m.index + 3, pos + m.index + 11);
        break;
      }
      case 'image': promptUrl(); break;
    }
  }

  function promptUrl() {
    const input = el('input.input', { placeholder: 'https://… 图片地址', type: 'url' });
    const upFile = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif' });
    upFile.classList.add('hidden');
    const upBtn = el('button.btn.btn-sm', { text: '或从本地上传（存到主站图床）', on: { click: () => upFile.click() } });
    upFile.addEventListener('change', async () => {
      const file = upFile.files && upFile.files[0];
      if (!file) return;
      upBtn.disabled = true;
      upBtn.textContent = '上传中…';
      try {
        const u = await B.upload.uploadImage(file);
        input.value = u;
        toast('已上传到图床', 'ok');
      } catch (e) {
        toast(e.message, 'err');
      } finally {
        upBtn.disabled = false;
        upBtn.textContent = '或从本地上传（存到主站图床）';
        upFile.value = '';
      }
    });
    dialog({
      title: '插入图片',
      body: el('div.stack.gap-10',
        el('div.field', el('label.label', { text: '图片地址' }), input),
        el('div.row.gap-8.align-center', upBtn, upFile),
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

  /* 估算光标纵向位置（textarea 无 caret API，按行号近似） */
  function getCaretY(ta) {
    const upTo = ta.value.slice(0, ta.selectionStart);
    const lines = upTo.split('\n').length - 1;
    const lineH = parseFloat(getComputedStyle(ta).lineHeight) || 32;
    const pt = parseFloat(getComputedStyle(ta).paddingTop) || 0;
    return pt + lines * lineH;
  }

  /* ============================================================
     5. 输入事件
     ============================================================ */
  function onInput() {
    refreshStats();
    scheduleSave();
    if (S.preview) renderPreview();
  }

  /* ============================================================
     6. 元数据（作品信息）
     ============================================================ */
  function openMetaDialog() {
    if (!S.book) return;
    const m = S.book.meta;
    const f = {
      title: el('input.input', { value: m.title || '', maxlength: '60' }),
      author: el('input.input', { value: m.author || (S.user ? S.user.name : ''), maxlength: '30', placeholder: S.user ? ('留空则署名「' + S.user.name + '」') : '笔名' }),
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
    function paintCover() {
      if (m.cover && m.cover.url) {
        coverPrev.textContent = '';
        coverPrev.style.background = 'url("' + m.cover.url + '") center / cover no-repeat';
      }
    }
    paintCover();
    const coverFile = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif' });
    coverFile.classList.add('hidden');
    const coverHint = el('div.small.muted', { text: '未上传封面时，按书名自动生成书法色卡封面（不占体积）。' });
    const coverBtn = el('button.btn.btn-sm', { text: '上传封面图', on: { click: () => coverFile.click() } });
    const coverDel = el('button.btn.btn-sm', { text: '恢复自动封面', on: { click: () => {
      m.cover = null;
      const c = B.crypto.coverOf({ title: m.title });
      coverPrev.textContent = B.crypto.firstChar(m.title || '书');
      coverPrev.style.background = 'linear-gradient(155deg,' + c.from + ',' + c.to + ')';
      toast('已恢复自动封面', 'ok');
    } } });
    coverFile.addEventListener('change', async () => {
      const file = coverFile.files && coverFile.files[0];
      if (!file) return;
      coverBtn.disabled = true;
      coverHint.textContent = '上传中…';
      try {
        const url = await B.upload.uploadImage(file);
        m.cover = { type: 'image', url: url };
        paintCover();
        coverHint.textContent = '封面已上传，保存后生效。';
        toast('封面图已上传', 'ok');
      } catch (e) {
        coverHint.textContent = e.message;
        toast(e.message, 'err');
      } finally {
        coverBtn.disabled = false;
        coverFile.value = '';
      }
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
          el('div.stack.gap-8', coverBtn, coverDel, coverHint)
        ),
        coverFile
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
            document.title = m.title + ' · 编辑器';
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
     7. 发布
     ============================================================ */
  function openPublishDialog() {
    if (!S.book) return;
    syncCurrent();
    const m = S.book.meta;
    const chapCount = S.book.chapters.length;
    const total = S.book.chapters.reduce((n, c) => n + words(c.content), 0);

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
    const status = el('div.pub-status', el('span.dot'), el('span', { text: '准备就绪。发布后约 1 分钟生效。' }));
    const linkBox = el('div.hidden');

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

    dialog({
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
              // 账号署名：默认笔名 = 昵称；account/signed 由登录态生成
              if (S.user) {
                if (!m.author) m.author = S.user.name;
                m.account = S.user.login;
                m.signed = S.user.login + '@' + new Date().toISOString();
              }
              const packed = await buildPacked();
              const entry = {
                id: S.book.id, title: m.title, author: m.author || '佚名', intro: m.intro,
                category: m.category, tags: m.tags, status: m.status, visibility: m.visibility,
                account: m.account || '', cover: S.book.meta.cover, chapters: chapCount, words: total
              };
              const res = await api.publish(packed, entry);

              S.book.published = {
                at: new Date().toISOString(), mode: res.mode, sha: res.sha || null,
                file: packed.fileName, words: total, chapters: chapCount
              };
              S.book.meta.updatedAt = S.book.published.at;
              await store.save(S.book);
              refreshBadge();

              const url = CFG.SITE_URL
                ? CFG.SITE_URL.replace(/\/$/, '') + '/read.html?id=' + encodeURIComponent(S.book.id)
                : new URL('read.html?id=' + encodeURIComponent(S.book.id), location.href).href;
              status.className = 'pub-status ok';
              status.lastChild.textContent = '发布成功（' + res.mode + '）。页面通常 1 分钟内生效。';
              linkBox.classList.remove('hidden');
              linkBox.innerHTML = '';
              linkBox.appendChild(el('div.field',
                el('label.label', { text: '阅读地址' }),
                el('div.row.gap-8',
                  el('input.input', { value: url, readOnly: true, style: { fontSize: '12px' } }),
                  el('button.btn.btn-sm', { text: '复制', on: { click: () => { util.copy(url); toast('链接已复制', 'ok'); } } })
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
     8. 导入 Markdown 拆章
     ============================================================ */
  async function importMarkdown(file) {
    const text = await file.text();
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

    // 追加到当前书末尾（比旧版更直觉：当前书 + 导入的章节）
    syncCurrent();
    const startNo = S.book.chapters.length;
    S.book.chapters = S.book.chapters.concat(chapters);
    toast('已导入 ' + chapters.length + ' 章' + (startNo ? '（追加为第 ' + (startNo + 1) + ' 章起）' : ''), 'ok');
    scheduleSave();
    renderChapters();
    refreshStats();
  }

  /* ============================================================
     9. 绑定
     ============================================================ */
  function bind() {
    els.btnBack.addEventListener('click', async () => { await flushSave(); location.href = 'write.html'; });
    els.btnAddChap.addEventListener('click', addChapter);
    els.btnDelChap.addEventListener('click', removeChapter);
    els.btnMeta.addEventListener('click', openMetaDialog);
    els.btnPublish.addEventListener('click', openPublishDialog);
    els.btnSettings.addEventListener('click', () => B.settings.open());
    els.btnFocus.addEventListener('click', () => toggleFocus());
    els.btnPreview.addEventListener('click', () => togglePreview());
    els.btnTocCh.addEventListener('click', () => toggleToc());
    els.chapMask.addEventListener('click', () => toggleToc(false));

    // 云同步状态条（Gist）
    if (B.gist) {
      const label = s => '云：' + (B.gist.STATUS_LABEL[s] || s);
      B.gist.onStatus(s => { els.gistState.textContent = label(s); els.gistState.style.color = s === 'err' ? 'var(--err)' : s === 'ok' ? 'var(--ok)' : ''; });
      els.gistState.addEventListener('click', async () => {
        await flushSave();
        B.gist.syncNow(S.book, B.gist.askConflict);
      });
    }

    els.btnImportMd.addEventListener('click', () => {
      els.fileMdHidden.value = '';
      els.fileMdHidden.click();
    });
    els.fileMdHidden.addEventListener('change', async () => {
      const f = els.fileMdHidden.files && els.fileMdHidden.files[0];
      if (!f) return;
      try { await importMarkdown(f); }
      catch (e) { console.error(e); toast('导入失败：' + e.message, 'err'); }
    });

    // 标题输入
    els.bookTitle.addEventListener('input', () => {
      if (!S.book) return;
      S.book.meta.title = els.bookTitle.value;
      document.title = (els.bookTitle.value || '未命名作品') + ' · 编辑器';
      scheduleSave();
    });

    // 章节标题
    els.chTitle.addEventListener('input', () => {
      const c = currentChapter();
      if (!c) return;
      c.title = els.chTitle.value;
      scheduleSave();
      const item = els.chapList.querySelector('.chap-item.on .nm');
      if (item) item.textContent = c.title || '未命名';
    });

    // 撤销栈（Bug D）
    undo = B.undo.attach(els.edText, { limit: B.prefs.get('editor.undoLimit', 200) });

    // 偏好应用 + 变更即时生效
    B.prefs.applyEditor();
    B.prefs.onChange(p => { if (String(p).indexOf('editor.') === 0) B.prefs.applyEditor(); });

    // 打字机滚动
    els.edText.addEventListener('input', () => {
      if (!B.prefs.get('editor.typewriter')) return;
      const ta = els.edText;
      const caretY = getCaretY(ta);
      const r = ta.getBoundingClientRect();
      if (caretY != null) {
        ta.scrollTop = Math.max(0, caretY - r.height / 2);
      }
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
      if (!S.book) return;
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        // 输入框在弹窗里时不拦截
        if (e.target === els.edText || e.target === els.chTitle) { e.preventDefault(); runCmd('undo'); }
      } else if ((mod && e.shiftKey && e.key.toLowerCase() === 'z') || (mod && e.key.toLowerCase() === 'y')) {
        if (e.target === els.edText || e.target === els.chTitle) { e.preventDefault(); runCmd('redo'); }
      } else if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        flushSave().then(() => toast('已保存到本机', 'ok'));
      } else if (mod && e.key.toLowerCase() === 'b') {
        if (e.target === els.edText) { e.preventDefault(); runCmd('bold'); }
      } else if (mod && e.key.toLowerCase() === 'i') {
        if (e.target === els.edText) { e.preventDefault(); runCmd('italic'); }
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault(); togglePreview();
      }
    });

    // 尽快落盘（Bug C）：切后台 / 离开页面时同步保存
    document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });
    window.addEventListener('pagehide', saveNow);
    window.addEventListener('beforeunload', saveNow);

    // 移动端：点正文区收起章节抽屉
    els.edText.addEventListener('focus', closeToc);

    // 专注模式退出按钮
    const exit = el('button.focus-exit', { text: 'Esc 退出专注', on: { click: () => toggleFocus(false) } });
    document.body.appendChild(exit);
  }

  /* ============================================================
     10. 启动
     ============================================================ */
  async function boot() {
    bind();
    const id = util.qs('id') || util.qs('d');   // Bug B：兼容 ?d= 入口
    if (!id) { location.replace('write.html'); return; }
    // 写作需登录群档案账号（Cookie Domain=.blacknet.cc.cd 自动携带）
    const user = await B.auth.me();
    if (!user) { showLoginGate(id, user === null ? 'notlogin' : 'unknown'); return; }
    S.user = user;
    await openEditor(id);
  }

  /* 登录门：未登录不给进编辑器（GitHub 会话 或 邮箱账号） */
  function showLoginGate(id, why) {
    let regMode = false;
    const fEmail = el('input.input', { type: 'email', placeholder: '邮箱', autocomplete: 'email' });
    const fName = el('input.input', { placeholder: '昵称（注册用，留空取邮箱名）', maxlength: '30' });
    const fPass = el('input.input', { type: 'password', placeholder: '口令（至少 8 位）', autocomplete: 'current-password' });
    const nameField = el('div.field.hidden', el('label.label', { text: '昵称' }), fName);
    const err = el('div.small', { style: { color: 'var(--err)', minHeight: '18px' } });
    const goBtn = el('button.btn.primary', { text: '登录', style: { minWidth: '96px' } });
    const switchBtn = el('button.btn', { text: '没有账号？去注册' });

    function setMode(reg) {
      regMode = reg;
      nameField.classList.toggle('hidden', !reg);
      goBtn.textContent = reg ? '注册并登录' : '登录';
      switchBtn.textContent = reg ? '已有账号？去登录' : '没有账号？去注册';
      err.textContent = '';
    }
    switchBtn.addEventListener('click', () => setMode(!regMode));

    async function submit() {
      const email = fEmail.value.trim();
      const pass = fPass.value;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { err.textContent = '邮箱格式不正确'; return; }
      if (pass.length < 8) { err.textContent = '口令至少 8 位'; return; }
      goBtn.disabled = true;
      err.textContent = '…';
      try {
        await (regMode ? B.auth.emailRegister(email, pass, fName.value.trim()) : B.auth.emailLogin(email, pass));
        location.reload();
      } catch (e) {
        err.textContent = e.message;
        goBtn.disabled = false;
      }
    }
    goBtn.addEventListener('click', submit);
    fPass.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });

    const msg = el('div.stack.gap-12.login-gate',
      el('h2', { text: '写作前请先登录' }),
      el('div.muted', { text: why === 'notlogin'
        ? '支持两种方式：群档案账号（与主站共用 GitHub 登录），或本站邮箱账号。作品发布时以账号署名。'
        : '登录状态检查失败（网络原因）。可改用邮箱账号登录，或稍后重试。' }),
      el('div.stack.gap-8.gate-form',
        el('div.field', el('label.label', { text: '邮箱' }), fEmail),
        nameField,
        el('div.field', el('label.label', { text: '口令' }), fPass),
        err,
        el('div.row.gap-8',
          goBtn, switchBtn,
          el('button.btn', { text: '群档案账号登录', on: { click: () => B.auth.login(location.href) } }),
          el('button.btn', { text: '重试', on: { click: () => location.reload() } }),
          el('a.btn', { href: 'write.html', text: '返回书架' })
        )
      )
    );
    document.body.appendChild(msg);
    document.body.classList.add('gate-locked');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
