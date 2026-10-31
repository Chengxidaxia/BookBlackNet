/* ============================================================
   write.js — 写作台书架（write.html）
   只管书架：列表 / 搜索 / 筛选 / 排序 / 导入 / 备份 / 新建 / 删除。
   写作在独立编辑器页 editor.html?id=<bookId>。
   ============================================================ */
(function () {
  'use strict';

  const B = window.BKN;
  const { util, md, store, api } = B;
  const { $, el, toast, esc, words, num, dateStr, safeJSON } = util;
  const { dialog, confirmBox, promptDialog } = B.ui;
  const CFG = window.BOOK || {};

  const els = {};
  const IDS = ['shelf-view', 'desk-list', 'shelf-q', 'shelf-cats', 'shelf-status', 'shelf-sort',
    'btn-new', 'btn-import', 'btn-backup', 'btn-settings', 'file-hidden'];
  IDS.forEach(id => { els[id.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = document.getElementById(id); });

  /* ---------------- 筛选状态（持久化） ---------------- */
  const F = Object.assign({ q: '', cat: '', status: '', sort: 'updated' },
    util.store.get('bbn.shelf.filter', {}));

  /* ============================================================
     纯函数过滤：实现在 core/shelf.js（可单测）
     ============================================================ */
  const shelfFilter = B.shelf.shelfFilter;
  const bookWords = b => B.shelf.bookWords(b);
  B.shelf.shelfFilter = shelfFilter; // 兼容引用

  /* ============================================================
     书架渲染
     ============================================================ */
  let allBooks = [];

  async function renderShelf() {
    document.title = '写作台 · BookBlackNet';
    allBooks = await store.list();
    renderCats();
    renderList();
  }

  function renderCats() {
    const cats = [];
    allBooks.forEach(b => {
      const c = b.meta && b.meta.category;
      if (c && cats.indexOf(c) < 0) cats.push(c);
    });
    cats.sort((a, b) => CFG.CATEGORIES.indexOf(a) - CFG.CATEGORIES.indexOf(b));
    const box = els.shelfCats;
    box.innerHTML = '';
    const mk = (val, label) => {
      const chip = el('button.chip' + (F.cat === val ? '.on' : ''), { text: label, type: 'button', on: { click: () => { F.cat = val; saveF(); renderCats(); renderList(); } } });
      box.appendChild(chip);
    };
    mk('', '全部');
    cats.forEach(c => mk(c, c));
  }

  function renderList() {
    const list = shelfFilter(allBooks, F);
    els.deskList.innerHTML = '';

    if (!allBooks.length) {
      els.deskList.appendChild(el('div.empty', { style: { gridColumn: '1 / -1' } },
        el('div.empty-mark', { html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v18H6.5A2.5 2.5 0 0 1 4 18.5v-13z"/><path d="M8 7h7M8 11h7"/></svg>' }),
        el('div.empty-title', { text: '还没有书稿' }),
        el('div.empty-desc', { text: '新建一本书，草稿会自动存在这台设备上；写够了再发布到书库。' })
      ));
      return;
    }
    if (!list.length) {
      els.deskList.appendChild(el('div.empty', { style: { gridColumn: '1 / -1' } },
        el('div.empty-title', { text: '没有符合条件的书稿' }),
        el('div.empty-desc', { text: '换个关键词，或清空筛选条件试试。' })
      ));
      return;
    }

    list.forEach(book => {
      const m = book.meta || {};
      const cov = B.crypto.coverOf(m);
      const wc = bookWords(book);
      const tagRow = el('div.desk-tags',
        el('span.badge.' + (book.published ? 'badge-live' : 'badge-draft'), { text: book.published ? '已发布' : '草稿' }),
        m.visibility === 'private' ? el('span.badge.badge-priv', { text: '私密' }) : null,
        m.category ? el('span.tag', { text: m.category }) : null
      );
      (m.tags || []).slice(0, 4).forEach(t => {
        tagRow.appendChild(el('button.tag.tag-act', {
          text: t, title: '编辑标签', type: 'button',
          on: { click: e => { e.stopPropagation(); editTags(book); } }
        }));
      });
      if ((m.tags || []).length > 4) tagRow.appendChild(el('span.tag', { text: '+' + (m.tags.length - 4) }));
      tagRow.appendChild(el('button.tag.tag-add', { text: '＋标签', title: '编辑标签', type: 'button', on: { click: e => { e.stopPropagation(); editTags(book); } } }));

      const card = el('div.desk-card', { data: { id: book.id }, on: { click: () => { location.href = 'editor.html?id=' + encodeURIComponent(book.id); } } },
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
          tagRow
        ),
        el('button.desk-del', {
          title: '删除书稿',
          html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg>',
          on: {
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
          }
        })
      );
      els.deskList.appendChild(card);
    });

    // 「新建」卡片放最后
    const newCard = el('div.desk-card.new',
      el('div', { text: '＋' }),
      el('div', { text: '新建作品' })
    );
    newCard.addEventListener('click', createBook);
    els.deskList.appendChild(newCard);
  }

  /* ---------------- 标签快捷编辑 ---------------- */
  function editTags(book) {
    const input = el('input.input', {
      value: ((book.meta && book.meta.tags) || []).join('，'),
      placeholder: '用逗号分隔，最多 6 个'
    });
    dialog({
      title: '《' + ((book.meta && book.meta.title) || '未命名') + '》的标签',
      body: el('div.stack.gap-10',
        el('div.field', el('label.label', { text: '标签' }), input),
        el('div.hint', { text: '标签会显示在书架卡片与书库条目上，便于检索。' })
      ),
      actions: [
        { label: '取消', onClick: ({ close }) => close() },
        { label: '保存', cls: 'primary', onClick: ({ close }) => {
          book.meta.tags = input.value.split(/[,，\s]+/).map(s => s.trim()).filter(Boolean).slice(0, 6);
          close();
          store.save(book).then(() => { toast('标签已更新', 'ok'); renderShelf(); });
        } }
      ]
    });
  }

  /* ---------------- 筛选条事件 ---------------- */
  function saveF() { util.store.set('bbn.shelf.filter', F); }

  function bindBar() {
    const qDeb = util.debounce(() => { F.q = els.shelfQ.value.trim(); saveF(); renderList(); }, 220);
    els.shelfQ.addEventListener('input', qDeb);
    els.shelfStatus.addEventListener('change', () => { F.status = els.shelfStatus.value; saveF(); renderList(); });
    els.shelfSort.addEventListener('change', () => { F.sort = els.shelfSort.value; saveF(); renderList(); });
    // 恢复持久化的筛选值
    els.shelfQ.value = F.q || '';
    els.shelfStatus.value = F.status || '';
    els.shelfSort.value = F.sort || 'updated';
  }

  /* ============================================================
     新建 / 导入 / 备份
     ============================================================ */
  async function createBook() {
    const book = store.blankBook({
      author: safeJSON(localStorage.getItem('bbn.author') || '""', '') || ''
    });
    book.chapters[0].title = '第一章';
    await store.save(book);
    location.href = 'editor.html?id=' + encodeURIComponent(book.id);
  }

  async function importFile(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.md') || name.endsWith('.txt')) return importMarkdownAsBook(file);
    if (name.endsWith('.json') && !name.endsWith('.book')) {
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
        location.href = 'editor.html?id=' + encodeURIComponent(book.id);
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

  async function importMarkdownAsBook(file) {
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

    const book = store.blankBook({ title: file.name.replace(/\.(md|txt)$/i, ''), author: '' });
    book.chapters = chapters;
    await store.save(book);
    toast('已导入 ' + chapters.length + ' 章', 'ok');
    location.href = 'editor.html?id=' + encodeURIComponent(book.id);
  }

  /* ============================================================
     绑定 + 启动
     ============================================================ */
  function bind() {
    els.btnNew.addEventListener('click', createBook);
    els.btnSettings.addEventListener('click', () => B.settings.open());
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
    els.fileHidden.addEventListener('change', async () => {
      const f = els.fileHidden.files && els.fileHidden.files[0];
      if (!f) return;
      try { await importFile(f); }
      catch (e) { console.error(e); toast('导入失败：' + e.message, 'err'); }
    });
    bindBar();
  }

  async function boot() {
    bind();
    // 兼容老的 ?id= / ?d= 直达编辑器入口
    const id = util.qs('id') || util.qs('d');
    if (id) {
      const b = await store.get(id);
      if (b) { location.replace('editor.html?id=' + encodeURIComponent(id)); return; }
      toast('本机没有这本书的草稿', 'err');
    }
    renderShelf();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
