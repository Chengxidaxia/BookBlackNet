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
          el('span', { text: entry.author || '佚名' }),
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
