/* ============================================================
   net.js — 可选「同源反代」的 fetch 封装（群档案 / 群书阁共用同一份）
   ------------------------------------------------------------
   为什么需要
     后端（Cloudflare Worker）的 CORS 只放行固定域名。站点一旦换域名部署
     （Netlify 预览域、自定义域、本机预览），数据接口就会被浏览器直接拦掉。
     既不想动后端、也不想把 CORS 开成 *，就让前端在「需要的时候」改走站点
     自己的同源路径，由部署侧转发：

         https://api.blacknet.cc.cd/?first=24
       → /proxy/api.blacknet.cc.cd/?first=24        （netlify.toml 落地）

     同源请求浏览器不做 CORS 校验、不发预检，后端一行都不用改。

   边界
     · 只对「跨域且在白名单里」的地址生效；同源地址原样直连。
     · 带 Cookie 的写接口（oauth / upload）**不要**加进白名单 —— 经反代后
       Cookie 的 Domain 对不上，会把登录态直接打掉。

   降级
     mode='auto' 时先试反代；命中 404 / 501（站点没配这条转发，返回的是
     站点自己的 404 页）或网络错误，就标记「本站没有反代」并改直连重试，
     本次会话内不再尝试 —— 首屏只多一次几毫秒的同源请求。
   ============================================================ */
(function (root) {
  'use strict';

  const DEFAULTS = {
    mode: 'auto',     // 'auto' 先试反代再直连 | 'always' 只走反代 | 'off' 全直连
    base: '/proxy',   // 同源反代前缀
    hosts: null       // 允许代理的 host 列表；null/空 表示「任意跨域地址」
  };

  function create(opt) {
    const cfg = Object.assign({}, DEFAULTS, opt || {});

    const base = String(cfg.base == null ? DEFAULTS.base : cfg.base).replace(/\/+$/, '');
    const mode = (cfg.mode === false || cfg.mode === 'off') ? 'off'
      : (cfg.mode === true || cfg.mode === 'always') ? 'always'
        : 'auto';
    const allow = (Array.isArray(cfg.hosts) && cfg.hosts.length)
      ? cfg.hosts.map(h => String(h).trim().toLowerCase()).filter(Boolean)
      : null;

    const state = {
      mode,
      dead: false,     // 本会话内反代已判定不可用
      hits: 0,         // 成功走反代的次数
      misses: 0,       // 反代不可用而降级的次数
      last: ''         // 最近一次反代地址（排查用）
    };

    function href() {
      const l = root.location;
      return (l && l.href) ? l.href : 'http://localhost/';
    }
    function here() {
      try { return new URL(href()).host.toLowerCase(); }
      catch (e) { return ''; }
    }
    function abs(u) {
      try { return new URL(String(u), href()); }
      catch (e) { return null; }
    }

    /** 这个地址是否值得走反代 */
    function canProxy(url) {
      if (mode === 'off' || state.dead) return false;
      const a = abs(url);
      if (!a) return false;
      if (a.protocol !== 'https:' && a.protocol !== 'http:') return false;
      if (a.host.toLowerCase() === here()) return false;          // 本来就同源
      if (allow && allow.indexOf(a.host.toLowerCase()) < 0) return false;
      return true;
    }

    /** 直连地址 → 同源反代地址 */
    function toProxy(url) {
      const a = abs(url);
      if (!a) return String(url);
      return base + '/' + a.host + a.pathname + a.search;
    }

    /** 响应像不像「站点自己的 404 页」（HTML）而不是接口返回 */
    function isSite404(res) {
      if (res.status !== 404 && res.status !== 501 && res.status !== 405) return false;
      let ct = '';
      try { ct = String(res.headers.get('content-type') || ''); } catch (e) { }
      return !/json/i.test(ct);
    }

    /**
     * 标记反代不可用。只有 auto 会真的降级；always 保持原样，
     * 让调用方直接看到失败 —— 那是它存在的意义（排查用）。
     * @returns {boolean} 是否应该降级重试
     */
    function markDead(why, proxied) {
      state.misses++;
      if (mode !== 'auto') {
        try { console.warn('[proxy] 反代不可用（' + why + '），mode=' + mode + ' 不降级：' + proxied); } catch (e) { }
        return false;
      }
      state.dead = true;
      try {
        console.info('[proxy] 站内反代不可用（' + why + '），本会话改直连：' + proxied);
      } catch (e) { }
      return true;
    }

    /**
     * fetch 的代理版。签名与 fetch 一致。
     * @param {string} url 绝对地址（也接受相对地址，相对就必然同源，不代理）
     * @param {RequestInit} [init]
     */
    async function netFetch(url, init) {
      if (!canProxy(url)) return fetch(url, init);

      const proxied = toProxy(url);
      state.last = proxied;

      let res;
      try {
        res = await fetch(proxied, init);
      } catch (e) {
        // 反代路径连不上（网络抖动，或站点根本没配这条转发）
        if (!markDead('网络错误', proxied)) throw e;
        return fetch(url, init);
      }

      if (isSite404(res)) {
        if (!markDead('HTTP ' + res.status, proxied)) return res;
        return fetch(url, init);
      }

      state.hits++;
      return res;
    }

    /** 取 JSON：非 2xx 直接抛，省掉每处都写 if (!res.ok) */
    async function netJSON(url, init) {
      const res = await netFetch(url, init);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }

    /** 取文本 */
    async function netText(url, init) {
      const res = await netFetch(url, init);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.text();
    }

    return {
      config: { mode, base, hosts: allow },
      state,
      canProxy,
      toProxy,
      fetch: netFetch,
      json: netJSON,
      text: netText
    };
  }

  root.BNNET = { create };
})(typeof window !== 'undefined' ? window : this);
