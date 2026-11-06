/* ============================================================
   core/auth.js — 群书阁账号（仅群档案 GitHub 会话）

   通道 A（github）：复用主站 OAuth 会话。
     · Cookie github_token 的 Domain=.blacknet.cc.cd，book 子域
       同源请求自动携带；经 net 代理调 oauth.blacknet.cc.cd/me；
     · 登录跳转经主站中转：book → grp?login-next=<地址> → 回跳。
   通道 B（email）：本站邮箱账号（auth.blacknet.cc.cd，KV 存储）。
     · 令牌存 localStorage（bbn.email.token），Bearer 调用；
     · 后端 PBKDF2 十万次迭代哈希口令，KV 存用户与会话。
   ============================================================ */
(function () {
  'use strict';
  const B = (window.BKN = window.BKN || {});
  const CFG = window.BOOK || {};
  const ME_URL = 'https://oauth.blacknet.cc.cd/me';
  const LOGOUT_URL = 'https://oauth.blacknet.cc.cd/logout';
  const MAIN_SITE = 'https://grp.blacknet.cc.cd';
  const AUTH_URL = CFG.AUTH_URL || '/api/auth';
  const AUTH_URL_FALLBACK = CFG.AUTH_URL_FALLBACK || 'https://auth.blacknet.cc.cd';
  const CACHE_KEY = 'bbn.auth.me.v1';
  const EMAIL_TOKEN_KEY = 'bbn.email.token';
  const EMAIL_USER_KEY = 'bbn.email.user';
  const CACHE_MS = 30 * 60 * 1000;

  // 注意：net 实例由 api.js 创建（晚于本文件），调用时再取
  const netFetch = (...a) => ((B.net && B.net.fetch) ? B.net.fetch(...a) : fetch(...a));

  /* ---------------- 通用缓存 ---------------- */
  let cached;
  function readCache() {
    try {
      const j = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
      if (j && Date.now() - j.t < CACHE_MS) return j.u;
      if (j) sessionStorage.removeItem(CACHE_KEY);
    } catch (e) {}
    return null;
  }
  function writeCache(u) { try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), u: u })); } catch (e) {} }
  function clearCache() { try { sessionStorage.removeItem(CACHE_KEY); } catch (e) {} }

  /* ---------------- 通道 A：群档案 GitHub ---------------- */
  const GH_LOCAL = '/api/gh';   // 同源 Netlify Function（快、零 CORS）；失败回退 CF oauth 直连

  async function ghMe() {
    // 主路径：同源 Function（服务端读 Cookie github_token 问 GitHub）
    try {
      const r = await netFetch(GH_LOCAL + '/me', { credentials: 'include' });
      if (r.ok) {
        const u = await r.json();
        return (u && u.login) ? { provider: 'github', login: u.login, name: u.name || u.login, avatar: u.avatar_url || '' } : null;
      }
      if (r.status === 401) return null;
    } catch (e) { /* 本地无 Function（GitHub Pages 镜像等）→ 回退 */ }
    // 兜底：直连 oauth Worker（需其 CORS 白名单包含本域）
    // 加超时：本地预览 / 后端不可达时不要一直挂着，最多等 4 秒
    const ac = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ac ? setTimeout(() => ac.abort(), 4000) : null;
    let r;
    try {
      r = await netFetch(ME_URL, { credentials: 'include', signal: ac ? ac.signal : undefined });
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (r.ok) {
      const u = await r.json();
      return (u && u.login) ? { provider: 'github', login: u.login, name: u.name || u.login, avatar: u.avatar_url || '' } : null;
    }
    if (r.status === 401) return null;
    throw new Error('HTTP ' + r.status);
  }

  function login(next) {
    const back = next || location.href;
    location.href = MAIN_SITE + '/?login-next=' + encodeURIComponent(back);
  }

  async function ghLogout() {
    try { await netFetch(GH_LOCAL + '/logout', { method: 'POST', credentials: 'include' }); } catch (e) {}
    try { await netFetch(LOGOUT_URL, { method: 'POST', credentials: 'include' }); } catch (e) {}
  }

  /* 邮箱账号已停用（2026-11）：只保留群档案 GitHub 会话。
     保留同名空实现，避免旧调用点抛 undefined。 */
  function emailLogin(){ return Promise.reject(new Error("邮箱账号已停用，请用群档案 GitHub 账号登录")); }
  function emailRegister(){ return emailLogin(); }
  function emailLogout(){ return Promise.resolve(); }
  function emailToken(){ return ""; }
  function emailUserCached(){ return null; }

  /* ---------------- 统一入口 ---------------- */
  /** 当前账号；null=未登录，undefined=检测失败（网络）。邮箱令牌优先。 */
  async function me(force) {
    if (!force) {
      if (cached && typeof cached.then === 'function') return cached;   // 复用在途请求
      const c = readCache();
      if (c) { cached = c; return c; }
    }
    const p = (async () => {
      // 2) 群档案 GitHub 会话
      try {
        const u = await ghMe();
        if (u) { writeCache(u); return u; }
        clearCache();
        return null;
      } catch (e) {
        return null;
      }
    })();
    cached = p;
    return p;
  }

  async function logout() {
    await ghLogout();
    clearCache();
    cached = null;
  }

  function displayName(u) {
    return u ? (u.name || u.login || '佚名') : '佚名';
  }

  B.auth = { me, login, logout, displayName,
    emailLogin, emailRegister, emailLogout, emailToken,
    clearCache };
})();
