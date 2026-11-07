/* ============================================================
   detail.js — 书籍详情页（book.html?id=…）
   ------------------------------------------------------------
   只读索引条目（不下载 .book 全文），展示封面 / 简介 / 标签 /
   字数章节，并把「开始阅读 / 继续阅读」指向阅读页 read.html。
   ============================================================ */
window.BKN = window.BKN || {};

(function (B) {
  'use strict';

  const CFG = window.BOOK || {};
  const el = B.util && B.util.el ? B.util.el : (t, a, ...kids) => {
    const n = document.createElement(t);
    if (a) for (const [k, v] of Object.entries(a)) {
      if (k === 'text') n.textContent = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k === 'style' && v && typeof v === 'object') Object.assign(n.style, v);
      else if (k === 'data' && v && typeof v === 'object') for (const [dk, dv] of Object.entries(v)) n.dataset[dk] = dv;
      else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    kids.filter(Boolean).forEach(c => n.appendChild(c));
    return n;
  };
  const num = n => { n = +n || 0; return n >= 10000 ? (n / 10000).toFixed(n % 10000 ? 1 : 0) + ' 万' : String(n); };

  const wrap = document.getElementById('detail-wrap');
  const state = document.getElementById('detail-state');

  function showError(msg, extra) {
    const box = el('div.empty',
      el('div.empty-title', { text: '打不开这本书' }),
      el('div.empty-desc', { text: msg }),
      el('div.row.gap-8',
        extra || null,
        el('a.btn.btn-sm', { href: 'index.html', text: '返回书库' })
      )
    );
    state.innerHTML = '';
    state.appendChild(box);
    const sp = state.querySelector('.spinner');
    if (sp) sp.remove();
  }

  function coverStyle(cov) {
    if (cov && cov.type === 'image' && cov.url) {
      return { backgroundImage: 'url("' + cov.url + '")', backgroundSize: 'cover', backgroundPosition: 'center' };
    }
    return { background: 'linear-gradient(155deg,' + (cov.from || '#37506e') + ',' + (cov.to || '#1a283a') + ')' };
  }

  /** 收藏按钮：未登录也能用（存本机），登录后自动并入账号 */
  function favButton(entry) {
    const on = B.fav.has(entry.id);
    const btn = el('button.btn.btn-ghost', { type: 'button', text: on ? '★ 已收藏' : '☆ 收藏' });
    if (on) btn.classList.add('is-on');
    btn.addEventListener('click', () => {
      const added = B.fav.toggle({
        id: entry.id,
        title: entry.title,
        author: entry.author,
        cover: B.crypto.coverOf(entry)
      });
      btn.textContent = added ? '★ 已收藏' : '☆ 收藏';
      btn.classList.toggle('is-on', added);
      B.util.toast(added ? '已加入我的书架' : '已从我的书架移除', 'ok');
    });
    return btn;
  }

  function render(entry) {
    document.title = (entry.title || '书籍详情') + ' · BookBlackNet';

    const cov = B.crypto.coverOf(entry);
    const statusTxt = entry.status === 'done' ? '已完结' : '连载中';
    const d = new Date(entry.updatedAt || entry.createdAt || '');
    const updated = isNaN(d) ? '' : d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });

    // 进度 → 主按钮文案
    const prog = LS.get('bbn.progress.' + entry.id, null);
    const hasProg = prog && (typeof prog.c === 'number' && prog.c > 0 || prog.ratio > 0.02);
    const readHref = 'read.html?id=' + encodeURIComponent(entry.id) + (hasProg && prog.c ? '&c=' + (prog.c + 1) : '');

    const info = el('div.detail-in',
      /* 左：封面 */
      el('div.dt-cover-wrap',
        el('div.dt-cover', { style: coverStyle(cov) },
          (entry.status === 'done' ? el('span.bc-badge.bc-done', { text: '完结' }) : null),
          (entry.visibility === 'private' ? el('span.bc-badge.bc-priv', { text: '私密' }) : null),
          el('div.bc-letter', { text: cov.type === 'image' ? '' : (cov.text || B.crypto.firstChar(entry.title)) })
        )
      ),
      /* 右：信息 */
      el('div.dt-body',
        el('h1.dt-title', { text: entry.title || '未命名作品' }),
        el('div.dt-sub',
          (entry.account
            ? el('a', { href: 'author.html?u=' + encodeURIComponent(entry.account), text: entry.author || entry.account, style: { color: 'inherit', textDecoration: 'underline', textUnderlineOffset: '3px' } })
            : el('span', { text: entry.author || '佚名' })),
          el('span.sep', { text: '·' }),
          el('span.dt-status', { text: statusTxt }),
          entry.category ? [el('span.sep', { text: '·' }), el('span', { text: entry.category })] : null
        ),
        el('div.dt-tags',
          (entry.tags || []).map(t => el('span.tag', { text: t }))
        ),
        el('p.dt-intro', { text: entry.intro || '（作者还没有写简介）' }),
        el('div.dt-stats',
          el('div.dts', { text: num(entry.chapters) }, el('span', { text: '章' })),
          el('div.dts', { text: num(entry.words) }, el('span', { text: '字' })),
          updated ? el('div.dts.dts-dim', { text: updated }, el('span', { text: '更新' })) : null
        ),
        el('div.dt-actions',
          el('a.btn.btn-primary', { href: readHref },
            hasProg ? '继续阅读' : '开始阅读',
            hasProg && prog.c ? el('span.small', { text: '（第 ' + (prog.c + 1) + ' 章）', style: { marginLeft: '6px', opacity: '.85' } }) : null
          ),
          (B.fav ? favButton(entry) : null),
          el('button.btn.btn-ghost', {
            text: '下载 .bookp',
            // 注意：el() 只认 on:{click:fn}，写成 onclick:fn 会被 setAttribute
            // 转成函数源码字符串，点了没有任何反应（踩过）。
            on: {
              click: async (ev) => {
                const btn = ev.currentTarget;
                const old = btn.textContent;
                btn.disabled = true; btn.textContent = '打包中…';
                try {
                  const text = await B.api.fetchBook(entry.id);
                  const j = B.util.safeJSON(text, null);
                  if (!j || !j.crypto) throw new Error('书籍数据无效');
                  const name = String(entry.title || entry.id).replace(/[\\/:*?"<>|]/g, '_') + '.bookp';
                  B.util.download(name, new Blob([text], { type: 'application/json' }));
                  B.util.toast('已下载 ' + name, 'ok');
                } catch (e) { B.util.toast('下载失败：' + e.message, 'err'); }
                finally { btn.disabled = false; btn.textContent = old; }
              }
            }
          }),
          el('a.btn.btn-ghost', { href: 'index.html' }, '返回书库'),
          entry.visibility === 'private' ? el('span.small.muted', { text: '私密作品 · 阅读需口令', style: { alignSelf: 'center' } }) : null
        )
      )
    );

    state.remove();
    wrap.appendChild(info);

    // 目录放在信息区下方（不阻塞主信息渲染：先画骨架，再去取正文清单）
    renderChapters(entry);
  }

  /* ============================================================
     目录
     ------------------------------------------------------------
     索引里只有「章节数」，标题必须解包 .book 才拿得到，所以这里
     单独异步取一次（失败不影响上面的信息区）。
     20 章一页；网格列数固定，保证每行章数一致。
     ============================================================ */
  const PER_PAGE = 20;

  /** 目录标题缓存：同一本书同一次会话只解包一次（键带 updatedAt，书更新后自动失效） */
  function tocKey(entry) {
    return 'bbn.toc.' + entry.id + '.' + String(entry.updatedAt || entry.createdAt || '');
  }
  function tocGet(entry) {
    try {
      const v = sessionStorage.getItem(tocKey(entry));
      const j = v ? JSON.parse(v) : null;
      return Array.isArray(j) ? j : null;
    } catch (e) { return null; }
  }
  function tocSet(entry, titles) {
    try { sessionStorage.setItem(tocKey(entry), JSON.stringify(titles)); } catch (e) {}
  }

  function lastReadIndex(id) {
    const p = LS.get('bbn.progress.' + id, null);
    if (p && typeof p.c === 'number' && p.c >= 0) return p.c;
    return -1;
  }

  function renderChapters(entry) {
    const sec = el('section.dt-chaps', { id: 'dt-chaps' });
    const count = el('span.dtc-count', { text: '' });
    sec.appendChild(el('div.dtc-head',
      el('h2.dtc-title', { text: '目录' }),
      count
    ));
    const body = el('div.dtc-body',
      el('div.dtc-tip', el('span.spinner'), el('span', { text: '正在读取章节目录…' }))
    );
    sec.appendChild(body);
    wrap.appendChild(sec);

    if (entry.visibility === 'private') {
      body.innerHTML = '';
      body.appendChild(el('div.dtc-tip',
        el('span', { text: '这是一本私密作品，目录需要在阅读页输入口令后查看。' }),
        el('a.btn.btn-sm', { href: 'read.html?id=' + encodeURIComponent(entry.id), text: '去解锁' })
      ));
      count.textContent = entry.chapters ? num(entry.chapters) + ' 章' : '';
      return;
    }

    (async () => {
      let titles = tocGet(entry);
      if (!titles) {
        try {
          const text = await B.api.fetchBook(entry.id);
          const raw = B.util.safeJSON(text, null);
          if (raw && raw.crypto && raw.crypto.wrap === 'pass') {
            throw new Error('pass');
          }
          const data = await B.crypto.unpack(text, { secret: CFG.SITE_KEY });
          titles = (data.chapters || []).map(c => c.title || '');
          tocSet(entry, titles);
        } catch (e) {
          body.innerHTML = '';
          const locked = e && e.message === 'pass';
          body.appendChild(el('div.dtc-tip',
            el('span', { text: locked ? '这本书已加密，目录需要在阅读页输入口令后查看。' : '章节目录暂时读不出来（' + ((e && e.message) || '未知错误') + '）。' }),
            el('a.btn.btn-sm', { href: 'read.html?id=' + encodeURIComponent(entry.id), text: '打开阅读页' })
          ));
          count.textContent = entry.chapters ? num(entry.chapters) + ' 章' : '';
          return;
        }
      }

      const chapters = titles.map((t, i) => ({ title: t || ('第 ' + (i + 1) + ' 章') }));
      if (!chapters.length) {
        body.innerHTML = '';
        body.appendChild(el('div.dtc-tip', el('span', { text: '这本书还没有章节。' })));
        count.textContent = '';
        return;
      }

      const mark = lastReadIndex(entry.id);
      const pages = Math.ceil(chapters.length / PER_PAGE);
      // 默认落在「上次读到」那一页；没读过就第一页
      let page = mark >= 0 ? Math.floor(mark / PER_PAGE) : 0;
      page = Math.max(0, Math.min(pages - 1, page));

      count.textContent = chapters.length + ' 章' + (pages > 1 ? ' · 共 ' + pages + ' 页' : '');

      const grid = el('div.dtc-grid');
      const pager = el('div.dtc-pager');
      body.innerHTML = '';
      body.appendChild(grid);
      body.appendChild(pager);

      function drawPage(p) {
        page = p;
        grid.innerHTML = '';
        const from = page * PER_PAGE;
        const slice = chapters.slice(from, from + PER_PAGE);
        slice.forEach((c, i) => {
          const idx = from + i;
          const isMark = idx === mark;
          const a = el('a.dtc-item' + (isMark ? '.is-mark' : ''), {
            href: 'read.html?id=' + encodeURIComponent(entry.id) + '&c=' + (idx + 1),
            title: c.title || ('第 ' + (idx + 1) + ' 章'),
            'data-i': String(idx + 1)
          },
            el('span.dtc-no', { text: String(idx + 1).padStart(2, '0') }),
            el('span.dtc-nm', { text: c.title || ('第 ' + (idx + 1) + ' 章') }),
            isMark ? el('span.dtc-flag', { text: '读到这里' }) : null
          );
          grid.appendChild(a);
        });

        // —— 分页（只有一页时不显示） ——
        pager.innerHTML = '';
        if (pages <= 1) return;

        const mkBtn = (label, to, opt) => {
          const b = el('button.dtc-pg', { type: 'button', text: label });
          const o = opt || {};
          if (o.on) b.classList.add('on');
          if (o.disabled) b.disabled = true;
          if (!o.disabled) b.addEventListener('click', () => {
            drawPage(to);
            const top = sec.getBoundingClientRect().top + window.scrollY - 76;
            window.scrollTo({ top: top, behavior: 'smooth' });
          });
          return b;
        };
        pager.appendChild(mkBtn('‹', page - 1, { disabled: page === 0 }));
        pageNums(pages, page).forEach(n => {
          if (n === '…') pager.appendChild(el('span.dtc-pg-dots', { text: '…' }));
          else pager.appendChild(mkBtn(String(n + 1), n, { on: n === page }));
        });
        pager.appendChild(mkBtn('›', page + 1, { disabled: page === pages - 1 }));
      }

      drawPage(page);
    })();
  }

  /** 页码序列：页数多时首尾固定 + 当前页前后各 1，中间用 … 省略 */
  function pageNums(pages, cur) {
    if (pages <= 7) return Array.from({ length: pages }, (_, i) => i);
    const set = new Set([0, pages - 1, cur, cur - 1, cur + 1]);
    const list = [...set].filter(n => n >= 0 && n < pages).sort((a, b) => a - b);
    const out = [];
    list.forEach((n, i) => {
      if (i && n - list[i - 1] > 1) out.push('…');
      out.push(n);
    });
    return out;
  }

  async function boot() {
    try {
      const id = B.util.qs('id');
      if (!id) { showError('链接里没有指定作品。请从书库进入，或在地址后加上 ?id=书籍编号。'); return; }

      const idx = await B.api.loadIndex();
      document.documentElement.dataset.bookSource = idx.source;
      const hit = (idx.books || []).find(b => b && b.id === id);
      if (!hit) { showError('书库里没有这本书：它可能已下架，或编号不正确。'); return; }
      render(hit);
    } catch (e) {
      showError((e && e.message) || '加载书目索引失败，请稍后重试。');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window.BKN);
