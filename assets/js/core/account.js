/* ============================================================
   account.js — 顶栏账号区 + 登录对话框（仅 GitHub）（全站共用）
   ------------------------------------------------------------
   用法：页面里放一个空的 .nav-actions（已存在），本脚本自动追加
         <div class="nav-user">；未登录显示「登录」，已登录显示
         头像 + 昵称 + 下拉菜单（我的书架 / 我的书稿 / 同步 / 设置 / 登出）。
   依赖：config.js → util.js → ui.js → auth.js
   导出：B.account.mount() / B.account.openLogin(opts) / B.account.user()
   ============================================================ */
window.BKN = window.BKN || {};

(function (B) {
  'use strict';

  const { el, toast } = B.util;
  const CFG = window.BOOK || {};
  let current = null;

  /* ---------------- 登录对话框 ---------------- */
  function openLogin(opts) {
    opts = opts || {};
    const dlg = B.ui.dialog({
      title: '登录',
      body: el('div.stack.gap-12',
        el('p.small.muted', { text: '群书阁只支持群档案的 GitHub 账号登录。登录后，收藏、阅读进度、作品与作品集都跟账号走，换设备也能接着写、接着读。' }),
        el('div.row.gap-8',
          el('button.btn.primary', {
            text: '用群档案 GitHub 账号登录',
            on: { click: () => B.auth.login(opts.next || location.href) }
          })
        ),
        el('p.hint', { text: '未登录也能读书、也能写稿，只是数据只存在这台机器的浏览器里。' })
      ),
      actions: [{ label: '关闭', onClick: ({ close }) => close() }]
    });
    return dlg;
  }

  /* ---------------- 顶栏 ---------------- */
  function avatarNode(u, size) {
    const initial = (u.name || u.login || '?').trim().charAt(0).toUpperCase();
    if (u.avatar) {
      const img = el('img', { src: u.avatar, alt: '', loading: 'lazy' });
      img.addEventListener('error', () => { img.replaceWith(el('span.acct-initial', { text: initial })); });
      return el('span.acct-avatar' + (size === 'lg' ? '.lg' : ''), img);
    }
    return el('span.acct-avatar' + (size === 'lg' ? '.lg' : ''), el('span.acct-initial', { text: initial }));
  }

  function render(u) {
    const host = document.getElementById('navUser');
    if (!host) return;
    host.innerHTML = '';
    current = u;

    if (!u) {
      host.appendChild(el('button.btn.btn-ghost.btn-sm.nav-login', {
        text: '登录',
        on: { click: () => openLogin() }
      }));
      return;
    }

    const menu = el('div.acct-menu.hidden');
    const link = (href, text, cls) => el('a' + (cls ? '.' + cls : ''), { href: href, text: text });
    menu.appendChild(link('author.html', '账号资料'));
    menu.appendChild(link('shelf.html', '我的书架'));
    menu.appendChild(link('works.html', '作品管理'));
    menu.appendChild(link('write.html', '我的书稿'));
    menu.appendChild(el('button.acct-item', {
      text: '同步书架',
      on: { click: async () => {
        menu.classList.add('hidden');
        if (B.fav) await B.fav.sync();
        else toast('本页未加载书架模块', 'err');
      } }
    }));
    menu.appendChild(el('button.acct-item', {
      text: '设置',
      on: { click: () => {
        menu.classList.add('hidden');
        if (B.settings) B.settings.open('editor');
        else location.href = 'write.html';
      } }
    }));
    menu.appendChild(el('button.acct-item.danger', {
      text: '登出',
      on: { click: async () => {
        menu.classList.add('hidden');
        try { await B.auth.logout(); } catch (e) {}
        toast('已登出', 'ok');
        setTimeout(() => location.reload(), 300);
      } }
    }));

    const btn = el('button.acct-btn', { type: 'button', title: u.name || u.login },
      avatarNode(u),
      el('span.acct-name', { text: B.auth.displayName(u) }),
      el('span.acct-caret', { text: '▾' })
    );
    btn.addEventListener('click', e => {
      e.stopPropagation();
      menu.classList.toggle('hidden');
    });
    document.addEventListener('click', () => menu.classList.add('hidden'));

    host.appendChild(el('div.acct', btn, menu));
  }

  /** 会话缓存里的账号（auth.js 写入），用于首帧先画出头像，避免空窗 */
  function cachedUser() {
    try {
      const j = JSON.parse(sessionStorage.getItem('bbn.auth.me.v1') || 'null');
      return j && j.u ? j.u : null;
    } catch (e) { return null; }
  }

  async function mount() {
    const actions = document.querySelector('.nav-actions');
    if (!actions) return;
    if (!document.getElementById('navUser')) {
      actions.appendChild(el('div.nav-user#navUser'));
    } else {
      // 已存在（页面预置）→ 清空占位
      document.getElementById('navUser').innerHTML = '';
    }

    // 先用缓存画一帧：未登录显示「登录」，已登录直接出头像
    render(cachedUser());

    // auth.me() 在本地预览/后端不可达时可能等很久，最多等 3.5s
    let u = null;
    try {
      u = await Promise.race([
        (B.auth && B.auth.me()) || Promise.resolve(null),
        new Promise(r => setTimeout(() => r(null), 3500))
      ]);
    } catch (e) { u = null; }
    render(u || null);

    // 登录后自动把本机的收藏 / 进度并到账号
    if (u && B.fav) {
      try { await B.fav.sync({ silent: true }); } catch (e) {}
    }
    document.dispatchEvent(new CustomEvent('bbn:account', { detail: u }));
  }

  B.account = { mount, openLogin, get user() { return current; } };

  function boot() {
    if (!B.auth) return;
    mount();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window.BKN);
