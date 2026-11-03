/* ============================================================
   nav.js — 移动端导航抽屉
   ------------------------------------------------------------
   桌面用 .nav-links 横排；≤760px 时 base.css 会把它隐藏，此前就
   只剩品牌和头像，写作台 / 我的书架 / 格式转换 / 赞助 / 主站全都
   点不到。这里在不改 HTML 结构的前提下，自动：
     1. 往 .nav-in 末尾插一个汉堡按钮；
     2. 克隆 .nav-links 的链接生成右侧抽屉（当前页保持高亮）；
     3. 把 .nav-actions 里的主按钮（开始写作 / 去书库）放进抽屉底部。
   交互：点击遮罩 / 按 Esc / 点链接 / 放大到桌面宽度 都会关闭，
   打开时锁住页面滚动。
   ============================================================ */
window.BKN = window.BKN || {};

(function (B) {
  'use strict';

  let drawer = null;
  let mask = null;
  let burger = null;
  let opened = false;
  let lastFocus = null;

  function setOpen(v) {
    if (!drawer || v === opened) return;
    opened = v;
    drawer.classList.toggle('open', v);
    mask.classList.toggle('on', v);
    burger.classList.toggle('x', v);
    burger.setAttribute('aria-expanded', v ? 'true' : 'false');
    drawer.setAttribute('aria-hidden', v ? 'false' : 'true');
    document.body.classList.toggle('mnav-open', v);

    if (v) {
      // 关闭软键盘可能残留的焦点
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      lastFocus = document.activeElement;
      const first = drawer.querySelector('.mnav-link, .mnav-cta');
      if (first && first.focus) setTimeout(() => first.focus({ preventScroll: true }), 60);
    } else if (lastFocus && lastFocus.focus) {
      lastFocus.focus({ preventScroll: true });
      lastFocus = null;
    }
  }

  function build() {
    if (drawer) return true;
    const bar = document.querySelector('.nav');
    if (!bar) return false;
    const links = bar.querySelector('.nav-links');
    if (!links) return false;

    const navIn = bar.querySelector('.nav-in') || bar;

    /* ---- 汉堡 ---- */
    burger = document.createElement('button');
    burger.type = 'button';
    burger.className = 'nav-burger';
    burger.id = 'nav-burger';
    burger.setAttribute('aria-label', '打开导航');
    burger.setAttribute('aria-expanded', 'false');
    burger.setAttribute('aria-controls', 'mnav');
    for (let i = 0; i < 3; i++) burger.appendChild(document.createElement('span'));
    navIn.appendChild(burger);

    /* ---- 遮罩 ---- */
    mask = document.createElement('div');
    mask.className = 'mnav-mask';

    /* ---- 抽屉 ---- */
    drawer = document.createElement('aside');
    drawer.className = 'mnav';
    drawer.id = 'mnav';
    drawer.setAttribute('aria-hidden', 'true');

    const head = document.createElement('div');
    head.className = 'mnav-head';
    const title = document.createElement('span');
    title.className = 'mnav-title';
    title.textContent = '导航';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'mnav-close';
    close.setAttribute('aria-label', '关闭导航');
    close.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
      '<path d="M6 6l12 12M18 6L6 18"/></svg>';
    head.appendChild(title);
    head.appendChild(close);

    const body = document.createElement('div');
    body.className = 'mnav-body';
    Array.prototype.forEach.call(links.querySelectorAll('a'), a => {
      const item = document.createElement('a');
      item.className = 'mnav-link' + (a.classList.contains('on') ? ' on' : '');
      item.href = a.getAttribute('href') || '#';
      item.textContent = (a.textContent || '').trim();
      if (a.title) item.title = a.title;
      if (/^https?:/i.test(item.href)) { item.target = '_blank'; item.rel = 'noopener'; }
      body.appendChild(item);
    });

    drawer.appendChild(head);
    drawer.appendChild(body);

    /* ---- 主按钮（开始写作 / 去书库） ---- */
    const cta = bar.querySelector('.nav-actions .btn-primary');
    if (cta) {
      const foot = document.createElement('div');
      foot.className = 'mnav-foot';
      const b = document.createElement('a');
      b.className = 'btn btn-primary mnav-cta';
      b.href = cta.getAttribute('href') || '#';
      b.textContent = (cta.textContent || '').trim() || '开始写作';
      foot.appendChild(b);
      drawer.appendChild(foot);
    }

    document.body.appendChild(mask);
    document.body.appendChild(drawer);

    /* ---- 事件 ---- */
    burger.addEventListener('click', () => setOpen(!opened));
    close.addEventListener('click', () => setOpen(false));
    mask.addEventListener('click', () => setOpen(false));
    drawer.addEventListener('click', e => {
      const a = e.target && e.target.closest ? e.target.closest('a') : null;
      if (a) setTimeout(() => setOpen(false), 40);   // 让默认跳转先生效
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && opened) setOpen(false);
    });

    const mq = window.matchMedia ? window.matchMedia('(max-width: 760px)') : null;
    if (mq) {
      const onChange = () => { if (!mq.matches) setOpen(false); };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange);
    }

    // 横屏 / 系统字号变化后抽屉内容可能超高，允许整体滚动由 CSS 负责
    return true;
  }

  function init() {
    try { build(); }
    catch (e) { B.navError = String((e && e.stack) || e); console.error('nav: 初始化失败', e); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  B.nav = { open: () => setOpen(true), close: () => setOpen(false), isOpen: () => opened };
})(window.BKN);
