/* ============================================================
   core/auth.js — 群书阁账号（双通道：群档案 GitHub 会话 / 邮箱）

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
  const AUTH_URL = CFG.AUTH_URL || 'https://auth.blacknet.cc.cd';
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
  async function ghMe() {
    const r = await netFetch(ME_URL, { credentials: 'include' });
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
    try { await netFetch(LOGOUT_URL, { method: 'POST', credentials: 'include' }); } catch (e) {}
  }

  /* ---------------- 通道 B：邮箱账号 ---------------- */
  function emailToken() { try { return localStorage.getItem(EMAIL_TOKEN_KEY) || ''; } catch (e) { return ''; } }

  async function authFetch(path, body) {
    const headers = { 'Content-Type': 'application/json' };
    const t = emailToken();
    if (t) headers['Authorization'] = 'Bearer ' + t;
    const r = await netFetch(AUTH_URL + path, {
      method: body ? 'POST' : 'GET',
      headers: headers,
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
    return data;
  }

  function saveEmailSession(token, user) {
    try {
      localStorage.setItem(EMAIL_TOKEN_KEY, token);
      localStorage.setItem(EMAIL_USER_KEY, JSON.stringify(user));
    } catch (e) {}
    const u = { provider: 'email', login: user.email, email: user.email, name: user.name, avatar: '' };
    writeCache(u);
    cached = u;
    return u;
  }

  async function emailLogin(email, password) {
    const d = await authFetch('/login', { email: email, password: password });
    return saveEmailSession(d.token, d.user);
  }

  async function emailRegister(email, password, name) {
    const d = await authFetch('/register', { email: email, password: password, name: name });
    return saveEmailSession(d.token, d.user);
  }

  async function emailLogout() {
    try { if (emailToken()) await authFetch('/logout'); } catch (e) {}
    try {
      localStorage.removeItem(EMAIL_TOKEN_KEY);
      localStorage.removeItem(EMAIL_USER_KEY);
    } catch (e) {}
    clearCache();
    cached = null;
  }

  function emailUserCached() {
    try { return JSON.parse(localStorage.getItem(EMAIL_USER_KEY) || 'null'); } catch (e) { return null; }
  }

  /* ---------------- 统一入口 ---------------- */
  /** 当前账号；null=未登录，undefined=检测失败（网络）。邮箱令牌优先。 */
  async function me(force) {
    if (!force) {
      if (cached && typeof cached.then === 'function') return cached;   // 复用在途请求
      const c = readCache();
      if (c) { cached = c; return c; }
    }
    const p = (async () => {
      // 1) 邮箱令牌
      if (emailToken()) {
        try {
          const d = await authFetch('/me');
          if (d && d.user) {
            const u = { provider: 'email', login: d.user.email, email: d.user.email, name: d.user.name, avatar: '' };
            writeCache(u);
            return u;
          }
        } catch (e) {
          if (/未登录/.test(e.message)) {   // 令牌失效则清掉，继续探测 GitHub
            try { localStorage.removeItem(EMAIL_TOKEN_KEY); localStorage.removeItem(EMAIL_USER_KEY); } catch (e2) {}
          }
        }
      }
      // 2) 群档案 GitHub 会话
      try {
        const u = await ghMe();
        if (u) { writeCache(u); return u; }
        clearCache();
        return null;
      } catch (e) {
        // 断网兜底：邮箱本地缓存
        const eu = emailUserCached();
        if (eu && emailToken()) return { provider: 'email', login: eu.email, email: eu.email, name: eu.name, avatar: '' };
        return null;
      }
    })();
    cached = p;
    return p;
  }

  async function logout() {
    await emailLogout();
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
