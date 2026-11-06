/* ============================================================
   collections.js — 作品集（collections.html）
   ------------------------------------------------------------
   读取：同源 docs/collections/index.json（+ 单本 <id>.json）
   写入：POST /api/collections —— 服务端代写进书籍仓库，与作品发布同一条
         链路（BOT_GH_TOKEN + account 归属校验）。
   ============================================================ */
(function () {
  'use strict';

  const B = window.BKN;
  const { util, crypto } = B;
  const { el, toast, dateStr } = util;
  const { dialog, confirmBox } = B.ui;

  const elsList = document.getElementById('cl-list');
  const elsDetail = document.getElementById('cl-detail');
  const btnNew = document.getElementById('btn-new');

  let me = null;
  let books = [];

  const uid = () => (me ? String(me.login || '').toLowerCase() : '');
  const isMine = (c) => !!c && !!uid() && String(c.account || '').toLowerCase() === uid();

  /* ---------------- 封面 ---------------- */
  function bookCover(meta, cls) {
    const c = crypto.coverOf(meta || {});
    if (c.type === 'image' && c.url) {
      return el('div' + (cls ? '.' + cls : '') + '.cl-cover-mini',
        el('img', { src: c.url, alt: '', loading: 'lazy' }));
    }
    return el('div' + (cls ? '.' + cls : '') + '.cl-cover-mini', {
      style: { background: 'linear-gradient(150deg,' + (c.from || '#6b5340') + ',' + (c.to || '#31241a') + ')' },
      text: c.text || '书'
    });
  }

  /* ---------------- 列表 ---------------- */
  function listCard(c) {
    const mine = isMine(c);
    const cover = el('div.cl-cover',
      el('span.cl-cover-t', { text: (c.title || '集').slice(0, 1) }),
      el('span.cl-cover-n', { text: String(c.count || 0) + ' 部' })
    );
    const card = el('article.cl-card',
      cover,
      el('div.cl-main',
        el('div.cl-tline',
          el('h3.cl-t', { text: c.title || '未命名作品集' }),
          mine ? el('span.cl-tag', { text: '我的' }) : null
        ),
        el('p.cl-d', { text: c.desc || '（没有写简介）' }),
        el('div.cl-meta', { text: (c.author || c.account || '佚名') + ' · ' + (c.updatedAt ? dateStr(c.updatedAt) : '') })
      )
    );
    card.addEventListener('click', () => {
      location.href = 'collections.html?id=' + encodeURIComponent(c.id);
    });
    return card;
  }

  async function renderList() {
    elsList.innerHTML = '';
    elsDetail.classList.add('hidden');
    elsList.classList.remove('hidden');

    let items = [];
    try { items = await B.cloud.collections.list(); } catch (e) { items = []; }

    if (!items.length) {
      elsList.appendChild(el('div.cl-empty',
        el('div.cl-empty-t', { text: '还没有作品集' }),
        el('div.cl-empty-d', { text: '作品集不挑人，只要有想法：一个主题、一条线索、一段私人推荐都行。' }),
        el('button.btn.btn-primary', { text: '新建第一个', on: { click: () => startNew() } })
      ));
      return;
    }
    items.forEach((c) => elsList.appendChild(listCard(c)));
  }

  /* ---------------- 详情 ---------------- */
  async function renderDetail(id) {
    elsList.classList.add('hidden');
    elsDetail.classList.remove('hidden');
    elsDetail.innerHTML = '';
    elsDetail.appendChild(el('div.cl-loading', { text: '正在取作品集…' }));

    let col = null;
    try { col = await B.cloud.collections.get(id); } catch (e) { col = null; }
    elsDetail.innerHTML = '';

    if (!col) {
      elsDetail.appendChild(el('div.cl-empty',
        el('div.cl-empty-t', { text: '作品集不存在' }),
        el('div.cl-empty-d', { text: '可能已被删除，或者链接里的编号不对。' }),
        el('a.btn', { href: 'collections.html', text: '回到列表' })
      ));
      return;
    }

    const mine = isMine(col);
    const acts = el('div.row.gap-8.cl-dacts');
    acts.appendChild(el('a.btn.btn-sm', { href: 'collections.html', text: '全部作品集' }));
    if (mine) {
      acts.appendChild(el('button.btn.btn-sm.btn-primary', {
        text: '编辑',
        on: { click: () => openForm(col) }
      }));
      acts.appendChild(el('button.btn.btn-sm.danger', {
        text: '删除',
        on: { click: () => removeCol(col) }
      }));
    }

    const head = el('div.cl-dhead',
      el('div.cl-dhead-main',
        el('h1.cl-title', { text: col.title || '未命名作品集' }),
        el('div.cl-dmeta', { text: (col.author || col.account || '佚名') + ' · ' + (col.bookIds || []).length + ' 部作品 · ' + (col.updatedAt ? '更新于 ' + dateStr(col.updatedAt) : '') }),
        col.desc ? el('p.cl-desc', { text: col.desc }) : null
      ),
      acts
    );
    elsDetail.appendChild(head);

    const grid = el('div.cl-books');
    const ids = col.bookIds || [];
    const map = {};
    books.forEach((b) => { map[b.id] = b; });

    ids.forEach((bid) => {
      const b = map[bid];
      if (!b) {
        grid.appendChild(el('div.cl-book.cl-book-miss',
          el('div.cl-book-t', { text: '作品已下架' }),
          el('div.cl-book-meta', { text: bid })
        ));
        return;
      }
      grid.appendChild(el('a.cl-book', { href: 'book.html?id=' + encodeURIComponent(b.id) },
        bookCover(b, ''),
        el('div.cl-book-t', { text: b.title || '未命名作品' }),
        el('div.cl-book-meta', { text: (b.author || '佚名') + (b.words ? ' · ' + util.num(b.words) + ' 字' : '') })
      ));
    });

    if (!ids.length) {
      grid.appendChild(el('div.cl-empty-d', { text: '这个作品集里还没有作品。' }));
    }
    elsDetail.appendChild(grid);
  }

  /* ---------------- 表单 ---------------- */
  function openForm(col) {
    if (!me) {
      B.account.openLogin({ afterLogin: () => location.reload() });
      return;
    }
    const src = col || {};
    const chosen = new Set((src.bookIds || []).slice());

    const fTitle = el('input.input', {
      value: src.title || '', placeholder: '例如：长夜与守夜人', maxlength: '60'
    });
    const fDesc = el('textarea.input', {
      value: src.desc || '',
      placeholder: '这组作品为什么放在一起？两三句就够。',
      rows: '3',
      maxlength: '600',
      style: { resize: 'vertical', minHeight: '72px', fontFamily: 'inherit' }
    });
    const fSearch = el('input.input', { placeholder: '搜书名 / 笔名…', autocomplete: 'off' });
    const pickBox = el('div.cl-pick');
    const countTip = el('div.hint');

    function paintPick() {
      const q = fSearch.value.trim().toLowerCase();
      pickBox.innerHTML = '';
      const list = books.filter((b) => {
        if (!q) return true;
        return ((b.title || '') + ' ' + (b.author || '') + ' ' + (b.category || '')).toLowerCase().indexOf(q) >= 0;
      });
      if (!list.length) {
        pickBox.appendChild(el('div.cl-empty-d', { text: '没有匹配的作品' }));
      }
      list.forEach((b) => {
        const on = chosen.has(b.id);
        const row = el('label.cl-pick-row' + (on ? '.on' : ''),
          el('input', {
            type: 'checkbox',
            checked: on,
            on: {
              change: (e) => {
                if (e.target.checked) chosen.add(b.id);
                else chosen.delete(b.id);
                row.classList.toggle('on', e.target.checked);
                countTip.textContent = '已选 ' + chosen.size + ' 部' + (chosen.size ? '' : '（至少选一部）');
              }
            }
          }),
          bookCover(b, 'sm'),
          el('span.cl-pick-t', { text: b.title || '未命名作品' }),
          el('span.cl-pick-a', { text: b.author || '佚名' })
        );
        pickBox.appendChild(row);
      });
      countTip.textContent = '已选 ' + chosen.size + ' 部' + (chosen.size ? '' : '（至少选一部）');
    }

    fSearch.addEventListener('input', paintPick);
    paintPick();

    const body = el('div.stack.gap-12',
      el('div.field', el('label.label', { text: '名称' }), fTitle),
      el('div.field', el('label.label', { text: '简介' }), fDesc),
      el('div.field',
        el('label.label', { text: '收录作品' }), fSearch, pickBox, countTip
      )
    );

    dialog({
      title: col ? '编辑作品集' : '新建作品集',
      body: body,
      actions: [
        { label: '取消', onClick: ({ close }) => close() },
        {
          label: '发布', cls: 'primary',
          onClick: async ({ btn, close }) => {
            const title = fTitle.value.trim();
            if (!title) { toast('先给作品集起个名字', 'err'); fTitle.focus(); return; }
            if (!chosen.size) { toast('至少选一部作品', 'err'); return; }
            btn.disabled = true;
            const old = btn.innerHTML;
            btn.innerHTML = '<span class="spinner"></span> 发布中';
            try {
              const saved = await B.cloud.collections.save({
                id: src.id || '',
                title: title,
                desc: fDesc.value.trim(),
                bookIds: Array.from(chosen),
                author: me.name || me.login
              });
              close();
              toast(col ? '已更新' : '作品集已发布', 'ok');
              location.href = 'collections.html?id=' + encodeURIComponent(saved.id);
            } catch (e) {
              toast('发布失败：' + e.message, 'err');
              btn.disabled = false;
              btn.innerHTML = old;
            }
          }
        }
      ]
    });
  }

  function startNew() {
    if (!me) { B.account.openLogin({ afterLogin: () => location.reload() }); return; }
    openForm(null);
  }

  function removeCol(col) {
    confirmBox('删除《' + (col.title || '') + '》', '只删这份清单，书本身不受影响。删除后立刻从列表消失。', '删除', async () => {
      try {
        await B.cloud.collections.remove(col.id);
        toast('已删除', 'ok');
        location.href = 'collections.html';
      } catch (e) {
        toast('删除失败：' + e.message, 'err');
      }
    });
  }

  /* ---------------- 启动 ---------------- */
  async function boot() {
    const id = util.qs('id');
    const wantEdit = util.qs('edit') === '1';

    // 详情视图不需要那大段说明，只留「新建」按钮
    const headTxt = document.querySelector('.cl-head-txt');
    if (headTxt && id) headTxt.classList.add('hidden');
    if (headTxt && !id) headTxt.classList.remove('hidden');

    // 并行：账号 + 书目（作品集卡片要显示书名与封面）
    const [u, idx] = await Promise.all([
      B.auth.me().catch(() => null),
      B.api.loadIndex({ stamp: B.api.stamp() }).catch(() => ({ books: [] }))
    ]);
    me = u;
    books = (idx && idx.books) || [];

    btnNew.addEventListener('click', () => startNew());

    if (id) {
      await renderDetail(id);
      if (wantEdit) {
        if (!me) { B.account.openLogin({ afterLogin: location.href }); return; }
        const col = await B.cloud.collections.get(id).catch(() => null);
        if (col && isMine(col)) openForm(col);
      }
    } else {
      await renderList();
    }
  }

  document.addEventListener('bbn:account', (e) => {
    if (e.detail) me = e.detail;
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
