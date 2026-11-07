/* ============================================================
   markdown.js — 完整 Markdown 渲染（marked 12 + DOMPurify）
   ------------------------------------------------------------
   为什么换掉自研的 3KB 解析器：它只认标题/粗斜体/列表/引用/代码，
   表格、任务列表、自动链接、嵌套列表混排、HTML 块全都不支持，
   阅读页遇到这些会退化成一段乱文本。

   现在：
   · 解析交给 marked 12（GFM + breaks），与主站 blog 详情页同一套
   · 净化交给 DOMPurify（禁 script/style/iframe/表单，禁 javascript: URL）
   · 渲染后统一后处理：标题生成 id（锚点可跳）、外链新窗口 +
     rel="noopener noreferrer"、图片懒加载、代码块加 .md-pre、
     纯图片段落加 .md-figure（阅读器里不缩进）

   对外的 API 保持不变（render / inline / outline / plain），
   调用方（read.js、editor.js、epub.js）无需改动。
   ============================================================ */
window.BKN = window.BKN || {};

(function (B) {
  'use strict';

  const esc = B.util.esc;

  /* ---------- 解析器就绪 ---------- */
  let markedReady = false;
  let purifyReady = false;
  let slugSeq = {};

  function slug(text) {
    const base = String(text || '')
      .replace(/<[^>]*>/g, '')
      .replace(/&[a-z#0-9]+;/gi, '')
      .trim()
      .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'sec';
    const n = (slugSeq[base] = (slugSeq[base] || 0) + 1);
    return 'h-' + base + (n > 1 ? '-' + n : '');
  }

  function ensureMarked() {
    if (!window.marked || typeof window.marked.parse !== 'function') return false;
    if (!markedReady) {
      try {
        window.marked.use({ gfm: true, breaks: true });
        // 旧渲染器支持 ==高亮==，marked 不含这个语法（Vditor 编辑器也不认）——
        // 为了让老书稿里的 ==文字== 不会突然变成两个等号，这里补一个行内扩展。
        window.marked.use({
          extensions: [{
            name: 'mdHighlight',
            level: 'inline',
            start(src) { return src.indexOf('=='); },
            tokenizer(src) {
              const m = /^==([^=\n]+)==/.exec(src);
              if (!m) return undefined;
              return { type: 'mdHighlight', raw: m[0], text: m[1], tokens: this.lexer.inlineTokens(m[1]) };
            },
            renderer(token) { return '<mark>' + this.parser.parseInline(token.tokens) + '</mark>'; }
          }]
        });
      } catch (e) { /* 旧版本忽略 */ }
      markedReady = true;
    }
    return true;
  }

  /* ---------- DOMPurify 后处理钩子（只注册一次） ---------- */
  function ensurePurify() {
    if (!window.DOMPurify) return false;
    if (purifyReady) return true;
    const DP = window.DOMPurify;

    DP.addHook('afterSanitizeAttributes', function (node) {
      const tag = node.nodeName;

      if (tag === 'A') {
        const href = node.getAttribute('href') || '';
        if (/^https?:/i.test(href)) {
          // 站外链接：新窗口打开，避免读者丢失阅读进度
          node.setAttribute('target', '_blank');
          node.setAttribute('rel', 'noopener noreferrer');
        } else if (href && href.charAt(0) !== '#' && !/^mailto:/i.test(href)) {
          // 站内相对链接：同标签页跳转
          node.setAttribute('rel', 'noopener');
        }
        if (!node.getAttribute('title') && /^https?:/i.test(href)) {
          node.setAttribute('title', href);
        }
      }

      if (tag === 'IMG') {
        node.setAttribute('loading', 'lazy');
        node.setAttribute('decoding', 'async');
        node.setAttribute('referrerpolicy', 'no-referrer');
      }

      if (tag === 'PRE') {
        node.classList.add('md-pre');
      }

      // 任务列表的复选框：只读展示（点不动，内容不因点击而改变）
      if (tag === 'INPUT') {
        node.setAttribute('disabled', 'disabled');
        const li = node.closest ? node.closest('li') : null;
        if (li) {
          li.classList.add('md-task-item');
          const ul = li.parentNode;
          if (ul && ul.classList) ul.classList.add('md-tasks');   // 干净地给整个列表加类，不依赖 CSS :has()
        }
      }

      // 标题补锚点 id（marked 12 不再自动生成）
      if (/^H[1-6]$/.test(tag)) {
        if (!node.id) node.id = slug(node.textContent);
        node.classList.add('md-heading');
      }

      if (tag === 'TABLE') node.classList.add('md-table');
    });

    purifyReady = true;
    return true;
  }

  /* ---------- 纯图片段落 → .md-figure（阅读器里不首行缩进） ---------- */
  function markFigures(html) {
    return html.replace(/<p>\s*(<img\b[^>]*>)\s*<\/p>/gi, '<p class="md-figure">$1</p>');
  }

  /* ---------- 主渲染 ---------- */
  function render(md) {
    if (!md) return '';
    const text = String(md).replace(/\r\n?/g, '\n');

    if (!ensureMarked()) {
      // 极端情况：vendor 没加载（例如被缓存/CDN 断流）→ 退化为纯文本，不抛错
      return text.split(/\n{2,}/).map(p =>
        '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>').join('');
    }

    slugSeq = {};
    let html;
    try {
      html = window.marked.parse(text);
    } catch (e) {
      return text.split(/\n{2,}/).map(p => '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>').join('');
    }

    if (ensurePurify()) {
      html = window.DOMPurify.sanitize(html, {
        ADD_TAGS: ['input', 'del', 'ins', 'mark', 'kbd', 'sub', 'sup', 'details', 'summary', 'figure', 'figcaption'],
        ADD_ATTR: ['target', 'rel', 'checked', 'disabled', 'type', 'align', 'colspan', 'rowspan', 'start', 'loading', 'decoding', 'referrerpolicy', 'id', 'class'],
        FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'link', 'meta', 'base'],
        FORBID_ATTR: ['onerror', 'onload', 'onclick', 'style']
      });
    }

    return markFigures(html);
  }

  /* ---------- 行内渲染（单行，不含块级） ---------- */
  function inline(text) {
    const s = String(text == null ? '' : text);
    if (!ensureMarked()) return esc(s);
    try {
      // parseInline 只处理行内语法，不会产生 <p> 包裹
      return window.marked.parseInline(s);
    } catch (e) {
      return esc(s);
    }
  }

  /* ---------- 大纲（与渲染出的标题 id 规则一致） ---------- */
  function outline(md) {
    const res = [];
    const seen = {};
    String(md || '').replace(/\r\n?/g, '\n').split('\n').forEach(l => {
      const m = /^\s*(#{1,4})\s+(.+?)\s*#*\s*$/.exec(l);
      if (!m) return;
      const raw = m[2];
      const base = raw.replace(/<[^>]*>/g, '').trim()
        .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
        .replace(/^-+|-+$/g, '').slice(0, 48) || 'sec';
      const n = (seen[base] = (seen[base] || 0) + 1);
      res.push({
        level: m[1].length,
        text: raw.replace(/[*_`~]/g, ''),
        // 与 render() 里的 slug() 保持同一规则，才能跳转
        id: 'h-' + base + (n > 1 ? '-' + n : '')
      });
    });
    return res;
  }

  /* ---------- 页内锚点跳转 ----------
     作者写 [回到本节](#第二节-星图) 时，浏览器只会拿编码后的片段去精确匹配 id，
     而我们生成的 id 是 h-<slugified>，两者几乎不会相等 → 点了没反应。
     这里接管容器内所有 a[href^="#"] 的点击，按「原样 / 解码 / 加 h- 前缀 /
     再过一次 slug / 标题文字全等」逐级兜底查找，找到就带固定顶栏偏移滚动。 */
  function slugSoft(s) {
    return String(s || '')
      .replace(/<[^>]*>/g, '')
      .replace(/&[a-z#0-9]+;/gi, '')
      .trim()
      .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'sec';
  }

  function findAnchorTarget(root, raw) {
    let dec = raw;
    try { dec = decodeURIComponent(raw); } catch (e) { /* 保留原样 */ }
    const cands = [];
    const push = (s) => { if (s && cands.indexOf(s) < 0) cands.push(s); };
    [raw, dec].forEach(s => {
      push(s);
      push('h-' + s);
      push(slugSoft(s));
      push('h-' + slugSoft(s));
    });
    for (let i = 0; i < cands.length; i++) {
      const el = document.getElementById(cands[i]);
      if (el) return el;
    }

    // 模糊兜底：作者写的片段通常不带标点（#二级标题星图），而我们生成的 id
    // 会把「：」变成一个连字符（h-二级标题-星图）。两边都去掉所有非文字字符再比。
    const nrm = (s) => String(s || '').replace(/[^\w\u4e00-\u9fa5]/g, '').toLowerCase();
    const want = nrm(dec);
    if (!want) return null;

    const withId = root.querySelectorAll('[id]');
    for (let i = 0; i < withId.length; i++) {
      const el = withId[i];
      if (nrm(String(el.id).replace(/^h-/, '')) === want) return el;
    }
    const hs = root.querySelectorAll('h1,h2,h3,h4,h5,h6');
    for (let i = 0; i < hs.length; i++) {
      if (nrm(hs[i].textContent) === want) return hs[i];
    }
    return null;
  }

  function bindAnchors(root) {
    if (!root || root.__mdAnchorBound) return;
    root.__mdAnchorBound = true;
    root.addEventListener('click', (e) => {
      const a = e.target && e.target.closest ? e.target.closest('a[href^="#"]') : null;
      if (!a || !root.contains(a)) return;
      const raw = (a.getAttribute('href') || '').slice(1);
      if (!raw) return;
      const el = findAnchorTarget(root, raw);
      if (!el) return;                       // 找不到就保持浏览器默认行为
      e.preventDefault();
      const bar = document.querySelector('.reader-bar:not(.hide)');
      const offset = bar ? bar.getBoundingClientRect().height + 12 : 16;
      const top = el.getBoundingClientRect().top + window.scrollY - offset;
      try { window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' }); }
      catch (err) { window.scrollTo(0, Math.max(0, top)); }
      if (history.replaceState) history.replaceState(null, '', '#' + raw);
    });
  }

  /* ---------- 纯文本（用于摘要 / 卡片 / 字数） ---------- */  function plain(md, max) {
    let s = String(md || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
      .replace(/^\s*\|.*\|\s*$/gm, ' ')          // 表格行
      .replace(/^\s*[-: ]+\|[-: |]+\s*$/gm, ' ')
      .replace(/[*_~`=]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (max && s.length > max) s = s.slice(0, max) + '…';
    return s;
  }

  B.md = { render, inline, outline, plain, bindAnchors, findAnchorTarget };
})(window.BKN);
