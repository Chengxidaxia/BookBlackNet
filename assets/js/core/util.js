/* ============================================================
   util.js — 极简 DOM / 交互工具
   全局命名空间：window.BKN
   ============================================================ */
window.BKN = window.BKN || {};

(function (B) {
  'use strict';

  /* ---------------- DOM ---------------- */
  const $  = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

  /**
   * el('div.cls#id', { attrs }, child...)
   * attrs 特殊键：class / text / html / style / on{event:fn} / data{key:val}
   */
  function el(spec, attrs) {
    const m = /^([a-zA-Z0-9-]+)?((?:[.#][\w-]+)*)$/.exec(spec) || [];
    const tag = m[1] || 'div';
    const node = document.createElement(tag);
    if (m[2]) {
      m[2].replace(/([.#])([\w-]+)/g, (_, k, v) => {
        if (k === '.') node.classList.add(v);
        else node.id = v;
      });
    }
    if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
      append(node, [attrs].concat(Array.prototype.slice.call(arguments, 2)));
      return node;
    }
    if (attrs) {
      Object.keys(attrs).forEach(k => {
        const v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'class') node.className += (node.className ? ' ' : '') + v;
        else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
        else if (k === 'on') Object.keys(v).forEach(ev => node.addEventListener(ev, v[ev]));
        else if (k === 'data') Object.keys(v).forEach(d => { node.dataset[d] = v[d]; });
        else if (k === 'value') node.value = v;
        else if (k === 'checked' || k === 'disabled' || k === 'selected') node[k] = !!v;
        else node.setAttribute(k, v === true ? '' : v);
      });
    }
    append(node, Array.prototype.slice.call(arguments, 2));
    return node;
  }

  function append(node, kids) {
    kids.forEach(k => {
      if (k === null || k === undefined || k === false) return;
      if (Array.isArray(k)) return append(node, k);
      node.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
    });
  }

  /* ---------------- 转义 ---------------- */
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ESC[c]);

  /* ---------------- toast ---------------- */
  let toastHost = null;
  function toast(msg, type, ms) {
    if (!toastHost) {
      toastHost = $('.toast-host');
      if (!toastHost) {
        toastHost = el('div.toast-host');
        document.body.appendChild(toastHost);
      }
    }
    const ic = type === 'err' ? '!' : type === 'ok' ? '✓' : 'i';
    const box = el('div.toast' + (type ? '.' + type : ''),
      el('span.toast-ic', { text: ic }),
      el('span', { text: msg })
    );
    toastHost.appendChild(box);
    const life = ms || (type === 'err' ? 4200 : 2600);
    setTimeout(() => {
      box.classList.add('out');
      setTimeout(() => box.remove(), 220);
    }, life);
  }

  /* ---------------- 格式化 ---------------- */
  function words(text) {
    if (!text) return 0;
    // 中文按字计、英文按词计，去掉 Markdown 记号与空白
    const plain = String(text)
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[#>*_`~\-]/g, ' ');
    const cn = (plain.match(/[\u4e00-\u9fa5\u3040-\u30ff]/g) || []).length;
    const en = (plain.replace(/[\u4e00-\u9fa5\u3040-\u30ff]/g, ' ').match(/[A-Za-z0-9]+/g) || []).length;
    return cn + en;
  }
  const num = n => (n >= 10000 ? (n / 10000).toFixed(n >= 100000 ? 0 : 1).replace(/\.0$/, '') + ' 万' : String(n || 0));

  function timeAgo(iso) {
    if (!iso) return '';
    const t = new Date(iso).getTime();
    if (isNaN(t)) return '';
    const d = Date.now() - t;
    if (d < 6e4) return '刚刚';
    if (d < 36e5) return Math.floor(d / 6e4) + ' 分钟前';
    if (d < 864e5) return Math.floor(d / 36e5) + ' 小时前';
    if (d < 2592e6) return Math.floor(d / 864e5) + ' 天前';
    return dateStr(iso);
  }
  function dateStr(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  /* ---------------- 杂项 ---------------- */
  function debounce(fn, wait) {
    let t;
    const f = function () {
      const a = arguments, c = this;
      clearTimeout(t);
      t = setTimeout(() => fn.apply(c, a), wait);
    };
    f.cancel = () => clearTimeout(t);
    f.flush = function () { clearTimeout(t); fn.apply(this, arguments); };
    return f;
  }

  function uid(prefix) {
    const t = Date.now().toString(36);
    const r = Math.random().toString(36).slice(2, 8);
    return (prefix || '') + t + r;
  }

  function safeJSON(s, dft) {
    try { return JSON.parse(s); } catch (e) { return dft; }
  }

  const store = {
    get(k, dft) {
      try {
        const v = localStorage.getItem(k);
        return v == null ? dft : JSON.parse(v);
      } catch (e) { return dft; }
    },
    set(k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); return true; }
      catch (e) { return false; }
    },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };

  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise((res, rej) => {
      const ta = el('textarea', { style: { position: 'fixed', opacity: '0' } });
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); res(); } catch (e) { rej(e); }
      ta.remove();
    });
  }

  function download(name, blob) {
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function go(url) { window.location.href = url; }

  function qs(name, dft) {
    const v = new URLSearchParams(location.search).get(name);
    return v == null ? (dft === undefined ? null : dft) : v;
  }

  /* 用父级宽度做等比缩放，避免 flex 子项撑破容器 */
  function fitText(node, max, min) {
    const len = (node.textContent || '').length;
    if (!len) return;
    const size = Math.max(min || 12, Math.min(max, Math.floor(160 / Math.sqrt(len + 2))));
    node.style.fontSize = size + 'px';
  }

  B.util = { $, $$, el, esc, toast, words, num, timeAgo, dateStr,
             debounce, uid, safeJSON, store, copy, download, go, qs, fitText };
})(window.BKN);
