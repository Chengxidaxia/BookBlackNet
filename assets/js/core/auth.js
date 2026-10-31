/* ============================================================
   core/auth.js — 群档案账号（复用主站 OAuth 会话，后端零改动）

   原理：
   · 主站登录后 Cookie github_token 的 Domain=.blacknet.cc.cd，
     book 子域的同源请求会自动携带；
   · 本模块经站点同源反代调 oauth.blacknet.cc.cd/me（绕开
     后端单一 CORS 白名单的限制），拿到当前登录用户；
   · 登录跳转经主站中转一次：book → grp?login-next=<book地址>
     → oauth /login → GitHub 回调 → 主站解析后跳回 book。
   ============================================================ */
(function () {
  'use strict';
  const B = (window.BKN = window.BKN || {});
  const ME_URL = 'https://oauth.blacknet.cc.cd/me';
  const LOGOUT_URL = 'https://oauth.blacknet.cc.cd/logout';
  const MAIN_SITE = 'https://grp.blacknet.cc.cd';
  const CACHE_KEY = 'bbn.auth.me.v1';
  const CACHE_MS = 30 * 60 * 1000;          // 登录态缓存 30 分钟

  // 注意：net 实例由 api.js 创建（晚于本文件），调用时再取
  const netFetch = (...a) => ((B.net && B.net.fetch) ? B.net.fetch(...a) : fetch(...a));

  function readCache() {
    try {
      const j = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
      if (j && Date.now() - j.t < CACHE_MS) return j.u;
      if (j) sessionStorage.removeItem(CACHE_KEY);
    } catch (e) {}
    return null;
  }

  function writeCache(u) {
    try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), u: u })); } catch (e) {}
  }

  function clearCache() {
    try { sessionStorage.removeItem(CACHE_KEY); } catch (e) {}
  }

  /** 当前登录用户；未登录返回 null，网络异常返回 undefined（未知） */
  async function me(force) {
    if (!force) {
      if (cached !== undefined) return cached;
      const c = readCache();
      if (c) { cached = c; return c; }
    }
    try {
      const r = await netFetch(ME_URL, { credentials: 'include' });
      if (r.ok) {
        const u = await r.json();
        cached = (u && u.login) ? { login: u.login, name: u.name || u.login, avatar: u.avatar_url || '' } : null;
        if (cached) writeCache(cached); else clearCache();
      } else if (r.status === 401) {
        cached = null;
        clearCache();
      } else {
        // 5xx / 代理不可用：按「未知」处理，不误锁
        cached = readCache();
      }
    } catch (e) {
      cached = readCache();                  // 断网时用缓存兜底
    }
    return cached;
  }

  let cached;                                 // 会话内 memo

  /** 跳主站中转登录，登录完成后回到 next（默认当前页） */
  function login(next) {
    const back = next || location.href;
    location.href = MAIN_SITE + '/?login-next=' + encodeURIComponent(back);
  }

  /** 登出（清 book 侧缓存；Cookie 由主站 logout 接口清除） */
  async function logout() {
    clearCache();
    cached = null;
    try { await netFetch(LOGOUT_URL, { method: 'POST', credentials: 'include' }); } catch (e) {}
  }

  /** 展示用署名：优先昵称，其次登录名 */
  function displayName(u) {
    return u ? (u.name || u.login || '佚名') : '佚名';
  }

  B.auth = { me, login, logout, displayName, clearCache };
})();
