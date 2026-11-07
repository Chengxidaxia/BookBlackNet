/* ============================================================
   works.js — 作品管理（works.html）
   ------------------------------------------------------------
   三块：已发布作品 / 账号云端草稿 / 我的作品集。

   已发布作品的「继续写」按三个优先级取稿：
     ① 本机 IndexedDB（最快，也是最新）
     ② 账号云端 /api/works（换设备时的备份）
     ③ 仓库里的 .book 密文，解密回灌（最后的兜底）
   ============================================================ */
(function () {
  'use strict';

  const B = window.BKN;
  const { util, store, api, crypto } = B;
  const { el, toast, num, dateStr } = util;
  const { confirmBox, promptDialog } = B.ui;
  const CFG = window.BOOK || {};

  const els = {};
  ['mgr-gate', 'mgr-body', 'mgr-stat', 'list-pub', 'list-draft', 'list-col',
    'cnt-pub', 'cnt-draft', 'cnt-col', 'note-pub', 'gate-login', 'gate-gh']
    .forEach((id) => { els[id.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = document.getElementById(id); });

  let me = null;

  /* ---------------- 小工具 ---------------- */
  const login = () => (me ? String(me.login || '').toLowerCase() : '');

  function coverNode(meta, cls) {
    const c = crypto.coverOf(meta || {});
    if (c.type === 'image' && c.url) {
      return el('span' + (cls ? '.' + cls : '') + '.mgr-cover',
        el('img', { src: c.url, alt: '', loading: 'lazy' }));
    }
    const from = c.from || '#6b5340', to = c.to || '#31241a';
    return el('span' + (cls ? '.' + cls : '') + '.mgr-cover', {
      style: { background: 'linear-gradient(150deg,' + from + ',' + to + ')' },
      text: c.text || '书'
    });
  }

  function emptyBox(title, desc, action) {
    return el('div.mgr-empty',
      el('div.mgr-empty-t', { text: title }),
      el('div.mgr-empty-d', { text: desc }),
      action || null
    );
  }

  function statCard(label, value, sub) {
    return el('div.mgr-stat-item',
      el('div.mgr-stat-v', { text: String(value) }),
      el('div.mgr-stat-l', { text: label }),
      sub ? el('div.mgr-stat-s', { text: sub }) : null
    );
  }

  /* ---------------- 取稿（三级优先） ---------------- */
  function toBook(remote) {
    return {
      id: remote.id,
      meta: remote.meta || {},
      chapters: Array.isArray(remote.chapters) ? remote.chapters : [],
      published: remote.published || null,
      createdAt: (remote.meta && remote.meta.createdAt) || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  function askPass() {
    return new Promise((resolve) => {
      promptDialog('这本书设了阅读口令', '口令', {
        type: 'password',
        hint: '口令只在本地用于解密，不会上传。忘了就真的打不开了。',
        okLabel: '解密'
      }, (v) => resolve(v));
    });
  }

  async function ensureLocal(id, silent) {
    const local = await store.get(id).catch(() => null);
    if (local) return { book: local, from: 'local' };

    try {
      const remote = await B.cloud.works.get(id);
      if (remote) {
        const book = toBook(remote);
        await store.save(book).catch(() => {});
        return { book, from: 'cloud' };
      }
    } catch (e) { /* 未登录 / 云端没有 → 继续往下 */ }

    // 最后一级：从仓库把密文解回来
    const text = await api.fetchBook(id);
    let out;
    try {
      out = await crypto.unpack(text, { secret: CFG.SITE_KEY });
    } catch (e) {
      if (/口令/.test(e.message || '')) {
        const pass = await askPass();
        if (!pass) throw new Error('已取消');
        out = await crypto.unpack(text, { secret: pass });
      } else throw e;
    }
    const book = {
      id: out.meta.id || id,
      meta: out.meta,
      chapters: out.chapters,
      published: {
        at: out.meta.updatedAt || new Date().toISOString(),
        mode: 'restore',
        file: (out.meta.id || id) + '.book',
        words: out.words,
        chapters: out.chapters.length
      },
      createdAt: out.meta.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await store.save(book);
    return { book, from: 'repo' };
  }

  async function openEditor(id, btn) {
    const old = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '取稿中…'; }
    try {
      const r = await ensureLocal(id);
      if (r.from === 'cloud') toast('已从账号云端取回草稿', 'ok');
      if (r.from === 'repo') toast('已从仓库解密恢复，可以继续改', 'ok');
      location.href = 'editor.html?id=' + encodeURIComponent(id);
    } catch (e) {
      toast('打不开：' + e.message, 'err');
      if (btn) { btn.disabled = false; btn.textContent = old; }
    }
  }

  /* ---------------- 已发布 ---------------- */
  function pubCard(b) {
    const title = b.title || '未命名作品';
    const acts = el('div.mgr-acts');
    const btnEdit = el('button.btn.btn-sm.btn-primary', { text: '继续写' });
    btnEdit.addEventListener('click', () => openEditor(b.id, btnEdit));

    const btnRead = el('a.btn.btn-sm', { href: 'book.html?id=' + encodeURIComponent(b.id), text: '看详情' });

    const btnOff = el('button.btn.btn-sm.danger', { text: '下架' });
    btnOff.addEventListener('click', () => {
      confirmBox('下架《' + title + '》', '会从书库删除正文与索引条目，读者立刻读不到；本机草稿与云端草稿都会保留。', '确认下架', async () => {
        btnOff.disabled = true;
        btnOff.textContent = '处理中…';
        try {
          await api.unpublish(b.id);
          toast('已下架', 'ok');
          load();
        } catch (e) {
          toast('下架失败：' + e.message, 'err');
          btnOff.disabled = false;
          btnOff.textContent = '下架';
        }
      });
    });

    acts.appendChild(btnEdit);
    acts.appendChild(btnRead);
    acts.appendChild(btnOff);

    const metaBits = [
      b.author || '佚名',
      (b.words ? num(b.words) + ' 字' : ''),
      (b.chapters ? b.chapters + ' 章' : ''),
      b.category || ''
    ].filter(Boolean).join(' · ');

    return el('article.mgr-card',
      coverNode(b, ''),
      el('div.mgr-main',
        el('div.mgr-tline',
          el('h3.mgr-t', { text: title }),
          b.visibility === 'private' ? el('span.mgr-tag', { text: '私密' }) : null
        ),
        el('div.mgr-meta', { text: metaBits }),
        el('div.mgr-sub', { text: b.updatedAt ? '更新于 ' + dateStr(b.updatedAt) : '' }),
        acts
      )
    );
  }

  /* ---------------- 云端草稿 ---------------- */
  function draftCard(d) {
    const acts = el('div.mgr-acts');
    const btnEdit = el('button.btn.btn-sm.btn-primary', { text: '接着写' });
    btnEdit.addEventListener('click', () => openEditor(d.id, btnEdit));

    const btnPull = el('button.btn.btn-sm', { text: '拉回本机' });
    btnPull.addEventListener('click', async () => {
      btnPull.disabled = true;
      try {
        const remote = await B.cloud.works.get(d.id);
        if (!remote) throw new Error('云端没有这本书');
        await store.save(toBook(remote));
        toast('已写入本机，写作台里能看到', 'ok');
        btnPull.textContent = '已拉回';
      } catch (e) {
        toast('拉回失败：' + e.message, 'err');
        btnPull.disabled = false;
      }
    });

    const btnDel = el('button.btn.btn-sm.danger', { text: '删云端副本' });
    btnDel.addEventListener('click', () => {
      confirmBox('删除云端副本', '只删账号里的备份，本机草稿与已发布作品都不受影响。', '删除', async () => {
        try {
          await B.cloud.works.remove(d.id);
          toast('已删除云端副本', 'ok');
          load();
        } catch (e) { toast('删除失败：' + e.message, 'err'); }
      });
    });

    acts.appendChild(btnEdit);
    acts.appendChild(btnPull);
    acts.appendChild(btnDel);

    const metaBits = [
      d.words ? num(d.words) + ' 字' : '',
      d.chapters ? d.chapters + ' 章' : '',
      d.published ? '已发布' : '未发布'
    ].filter(Boolean).join(' · ');

    return el('article.mgr-card',
      coverNode(d, ''),
      el('div.mgr-main',
        el('div.mgr-tline',
          el('h3.mgr-t', { text: d.title || '未命名作品' }),
          d.published ? el('span.mgr-tag.mgr-tag-on', { text: '已发布' }) : el('span.mgr-tag', { text: '草稿' })
        ),
        el('div.mgr-meta', { text: metaBits }),
        el('div.mgr-sub', { text: d.at ? '备份于 ' + dateStr(d.at) : '' }),
        acts
      )
    );
  }

  /* ---------------- 作品集 ---------------- */
  function colCard(c) {
    const acts = el('div.mgr-acts');
    acts.appendChild(el('a.btn.btn-sm.btn-primary', { href: 'collections.html?id=' + encodeURIComponent(c.id), text: '打开' }));
    acts.appendChild(el('button.btn.btn-sm', {
      text: '编辑',
      on: { click: () => { location.href = 'collections.html?id=' + encodeURIComponent(c.id) + '&edit=1'; } }
    }));

    return el('article.mgr-card',
      el('span.mgr-cover.mgr-cover-col', { text: '集' }),
      el('div.mgr-main',
        el('div.mgr-tline', el('h3.mgr-t', { text: c.title || '未命名作品集' })),
        el('div.mgr-meta', { text: (c.count || 0) + ' 部作品 · ' + (c.author || c.account || '') }),
        el('div.mgr-sub', { text: c.desc || '' }),
        acts
      )
    );
  }

  /* ---------------- 装载 ---------------- */
  // load() 里有多个 await，若 boot() 被重复触发（例如登录后 bbn:account 事件），
  // 两次装载会交错 append 到同一批容器里，页面上就会出现「两份」。
  // 用序号守卫：只有最后一次装载允许继续往下写 DOM。
  let loadSeq = 0;

  async function load() {
    if (!me) return;
    const uid = login();
    const seq = ++loadSeq;
    const stale = () => seq !== loadSeq;

    els.listPub.innerHTML = '';
    els.listDraft.innerHTML = '';
    els.listCol.innerHTML = '';
    els.mgrStat.innerHTML = '';

    // 已发布：索引里 account 与当前登录名一致
    let books = [];
    try {
      const res = await api.loadIndex({ stamp: api.stamp() });
      books = res.books || [];
    } catch (e) { books = []; }
    if (stale()) return;

    const mine = books.filter((b) => b && String(b.account || '').toLowerCase() === uid && uid);
    const legacy = books.filter((b) => b && !b.account);

    mine.forEach((b) => els.listPub.appendChild(pubCard(b)));
    els.cntPub.textContent = String(mine.length);
    els.notePub.textContent = mine.length
      ? ''
      : (legacy.length
        ? '还没有归属到你账号的作品。' + legacy.length + ' 本早期发布的作品没有记录归属，在写作台重新发布一次即可认领。'
        : '还没有发布过作品。去写作台写一本，发布后会出现在这里。');

    // 云端草稿
    let drafts = [];
    try { drafts = await B.cloud.works.list(); } catch (e) { drafts = []; }
    if (stale()) return;
    drafts.forEach((d) => els.listDraft.appendChild(draftCard(d)));
    els.cntDraft.textContent = String(drafts.length);
    if (!drafts.length) {
      els.listDraft.appendChild(emptyBox('云端还没有草稿',
        '在编辑器里写过字之后，草稿会自动备份到账号；换设备登录就能接着写。'));
    }

    // 作品集
    let cols = [];
    try {
      cols = (await B.cloud.collections.list()).filter((c) => String(c.account || '').toLowerCase() === uid);
    } catch (e) { cols = []; }
    if (stale()) return;
    cols.forEach((c) => els.listCol.appendChild(colCard(c)));
    els.cntCol.textContent = String(cols.length);
    if (!cols.length) {
      els.listCol.appendChild(emptyBox('还没有作品集',
        '作品集是一份你自己策展的清单：起个名字、写段介绍，把几本书放进去。',
        el('a.btn.btn-sm.btn-primary', { href: 'collections.html', text: '去建一个' })));
    }

    const totalWords = mine.reduce((n, b) => n + (+b.words || 0), 0);
    els.mgrStat.appendChild(statCard('已发布作品', mine.length, '归属：' + (me.name || me.login)));
    els.mgrStat.appendChild(statCard('累计字数', num(totalWords)));
    els.mgrStat.appendChild(statCard('云端草稿', drafts.length));
    els.mgrStat.appendChild(statCard('作品集', cols.length));
  }

  async function boot() {
    me = await B.auth.me();
    if (!me) {
      els.mgrGate.classList.remove('hidden');
      els.mgrBody.classList.add('hidden');
      return;
    }
    els.mgrGate.classList.add('hidden');
    els.mgrBody.classList.remove('hidden');
    await load();
  }

  els.gateLogin.addEventListener('click', () => B.account.openLogin({ afterLogin: () => location.reload() }));
  els.gateGh.addEventListener('click', () => B.auth.login(location.href));

  document.addEventListener('bbn:account', (e) => {
    if (e.detail) { me = e.detail; boot(); }
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
