/* ============================================================
   author.js — 作者页（author.html?u=<login>）
   ------------------------------------------------------------
   一个页面承担两件事：
     · 别人看：简介 + 作品 + 作品集；
     · 自己看：多一个「编辑资料」，改昵称与简介（写进书籍仓库
       docs/authors/<login>.json，服务端 bot 代提交，归属是本人）。
   不传 ?u= 时默认当前登录用户，所以账号菜单里的「账号资料」
   直接指向本页即可。
   ============================================================ */
(function () {
  'use strict';

  const B = window.BKN;
  const { el, toast, qs } = B.util;
  const root = document.getElementById('au-root');

  const state = { me: null, login: '', profile: null, books: [], cols: [] };

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function coverStyle(b) {
    const c = (b && b.cover) || {};
    if (c.type === 'image' && c.url) return 'background-image:url(' + esc(c.url) + ');background-size:cover;background-position:center';
    const from = c.from || '#6b5340', to = c.to || '#31241a';
    return 'background:linear-gradient(135deg,' + from + ',' + to + ')';
  }

  function coverText(b) {
    const c = (b && b.cover) || {};
    if (c.type === 'image' && c.url) return '';
    return (c.text || (b.title || '书')).slice(0, 1);
  }

  async function getJSON(url) {
    try {
      const r = await fetch(url, { credentials: 'include' });
      if (!r.ok) return null;
      return await r.json();
    } catch (e) { return null; }
  }

  function sameAccount(a, b) {
    return String(a || '').toLowerCase() === String(b || '').toLowerCase();
  }

  /* ---------------- 渲染 ---------------- */
  function render() {
    const p = state.profile || {};
    const isMe = state.me && sameAccount(state.me.login, state.login);
    const name = p.name || (state.me && isMe ? state.me.name : '') || state.login;
    const av = state.me && sameAccount(state.me.login, state.login) ? (state.me.avatar || '') : '';
    const initial = String(name).trim().charAt(0).toUpperCase();

    const head = el('section.au-card',
      av
        ? el('img.au-av', { src: av, alt: '', loading: 'lazy' })
        : el('div.au-av', { text: initial }),
      el('div.au-main',
        el('h1.au-name', { text: name }),
        el('div.au-login', { text: '@' + state.login }),
        el('p.au-bio', { text: p.bio || (isMe ? '还没有写简介。点右边「编辑资料」补一句。' : '这位作者还没有写简介。') })
      ),
      isMe ? el('button.btn.btn-sm', { text: '编辑资料', on: { click: openEdit } }) : null
    );

    const books = el('section',
      el('div.au-sec', el('h2', { text: '作品' }), el('span', { text: state.books.length + ' 部' })),
      state.books.length
        ? el('div.au-grid', state.books.map((b) =>
            el('article.au-b', {
              on: { click: () => { location.href = 'book.html?id=' + encodeURIComponent(b.id); } }
            },
              el('div.au-b-cov', { style: coverStyle(b), text: coverText(b) }),
              el('div.au-b-in',
                el('h3.au-b-t', { text: b.title || '未命名作品' }),
                el('div.au-b-m', { text: (b.status === 'done' ? '已完结' : '连载中') + ' · ' + (b.words || 0) + ' 字' })
              )
            )
          ))
        : el('div.au-empty', { text: '还没有发布作品。' })
    );

    const cols = el('section',
      el('div.au-sec', el('h2', { text: '作品集' }), el('span', { text: state.cols.length + ' 个' })),
      state.cols.length
        ? el('div.au-cl', state.cols.map((c) =>
            el('div.au-cl-i', {
              on: { click: () => { location.href = 'collections.html?id=' + encodeURIComponent(c.id); } }
            },
              el('b', { text: c.title || '未命名作品集' }),
              el('span', { text: (c.count || 0) + ' 部' }),
              el('span', { text: c.desc || '' })
            )
          ))
        : el('div.au-empty', { text: '还没有作品集。' })
    );

    root.innerHTML = '';
    root.appendChild(el('div.stack.gap-24', head, books, cols));
  }

  /* ---------------- 编辑资料 ---------------- */
  function openEdit() {
    const p = state.profile || {};
    const fName = el('input.input', { value: p.name || '', maxlength: '30', placeholder: '昵称，留空则显示 GitHub 用户名' });
    const fBio = el('textarea.textarea', { rows: '5', maxlength: '300', placeholder: '一句话介绍你自己、在写什么、更新节奏…' });
    fBio.value = p.bio || '';

    const dlg = B.ui.dialog({
      title: '编辑资料',
      body: el('div.stack.gap-12',
        el('div.field', el('label.label', { text: '昵称' }), fName),
        el('div.field', el('label.label', { text: '简介' }), fBio),
        el('p.hint', { text: '资料会随作品一起存进书籍仓库，任何访客都能看到。' })
      ),
      actions: [
        { label: '取消', onClick: ({ close }) => close() },
        {
          label: '保存', primary: true,
          onClick: async ({ close }) => {
            try {
              const r = await fetch('/api/profile', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: fName.value.trim(), bio: fBio.value.trim() })
              });
              const d = await r.json().catch(() => ({}));
              if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
              state.profile = d.profile || state.profile;
              toast('资料已保存', 'ok');
              close();
              render();
            } catch (e) {
              toast(e.message || '保存失败', 'err');
            }
          }
        }
      ]
    });
    return dlg;
  }

  /* ---------------- 启动 ---------------- */
  async function boot() {
    state.me = await B.auth.me().catch(() => null);

    const want = qs('u') || (state.me && state.me.login) || '';
    if (!want) {
      root.innerHTML = '';
      root.appendChild(el('div.au-empty',
        el('p', { text: '没有指定作者，而且你还没有登录。' }),
        el('button.btn.btn-primary', { text: '登录', on: { click: () => B.auth.login(location.href) } })
      ));
      return;
    }
    state.login = want;
    document.title = want + ' · 作者 · BookBlackNet';

    // 三路并发：资料 / 书籍索引 / 作品集索引
    const [prof, bIdx, cIdx] = await Promise.all([
      getJSON('/api/profile?u=' + encodeURIComponent(want)),
      getJSON('docs/books/index.json'),
      getJSON('docs/collections/index.json')
    ]);

    state.profile = prof || {};
    const books = (bIdx && (bIdx.books || bIdx)) || [];
    state.books = (Array.isArray(books) ? books : []).filter((b) => b && sameAccount(b.account, want));
    const items = (cIdx && cIdx.items) || [];
    state.cols = (Array.isArray(items) ? items : []).filter((c) => c && sameAccount(c.account, want));

    render();
  }

  boot();
})();
