/* ============================================================
   account.js — 顶栏账号区 + 登录对话框（全站共用）
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
    let regMode = false;

    const fEmail = el('input.input', { type: 'email', placeholder: 'you@example.com', autocomplete: 'email' });
    const fPass = el('input.input', { type: 'password', placeholder: '口令（至少 8 位）', autocomplete: 'current-password' });
    const fName = el('input.input', { placeholder: '昵称（留空取邮箱前缀）', maxlength: '30' });
    const nameField = el('div.field.hidden', el('label.label', { text: '昵称' }), fName);
    const err = el('div.small', { style: { color: 'var(--err)', minHeight: '18px' } });

    const goBtn = el('button.btn.primary', { text: '登录', style: { minWidth: '88px' } });
    const switchBtn = el('button.btn', { text: '没有账号？去注册' });
    const ghBtn = el('button.btn', { text: '用群档案账号登录' });

    async function go() {
      err.textContent = '';
      goBtn.disabled = true;
      try {
        await (regMode
          ? B.auth.emailRegister(fEmail.value.trim(), fPass.value, fName.value.trim())
          : B.auth.emailLogin(fEmail.value.trim(), fPass.value));
        toast(regMode ? '注册成功，已登录' : '登录成功', 'ok');
        dlg.close();
        if (opts.afterLogin) opts.afterLogin();
        else setTimeout(() => location.reload(), 320);
      } catch (e) {
        err.textContent = e.message || '登录失败';
        goBtn.disabled = false;
      }
    }
    goBtn.addEventListener('click', go);
    fPass.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    switchBtn.addEventListener('click', () => {
      regMode = !regMode;
      goBtn.textContent = regMode ? '注册' : '登录';
      switchBtn.textContent = regMode ? '已有账号？去登录' : '没有账号？去注册';
      nameField.classList.toggle('hidden', !regMode);
    });
    ghBtn.addEventListener('click', () => B.auth.login(opts.next || location.href));

    const dlg = B.ui.dialog({
      title: '登录',
      body: el('div.stack.gap-12',
        el('p.small.muted', { text: '登录后，收藏与阅读进度会同步到账号；换设备也能接着读。不登录也能用，数据只存在本机浏览器。' }),
        el('div.field', el('label.label', { text: '邮箱' }), fEmail),
        nameField,
        el('div.field', el('label.label', { text: '口令' }), fPass),
        err,
        el('div.row.gap-8', goBtn, switchBtn),
        el('div.hint', { text: '也可以用群档案的 GitHub 账号登录（与主站共用会话）。' }),
        el('div.row.gap-8', ghBtn)
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
    menu.appendChild(link('shelf.html', '我的书架'));
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
