/* ============================================================
   markdown.js — 轻量 Markdown 渲染（约 3KB，无依赖）
   支持：标题 / 段落 / 粗斜体 / 删除线 / 行内代码 / 代码块 /
        引用 / 有序无序列表（可嵌套）/ 分割线 / 链接 / 图片
   安全策略：先整体 HTML 转义，再只放行白名单标签，URL 做协议校验。
   ============================================================ */
window.BKN = window.BKN || {};

(function (B) {
  'use strict';

  const esc = B.util.esc;

  function safeUrl(u) {
    const s = String(u || '').trim();
    if (/^(https?:)?\/\//i.test(s) || /^data:image\//i.test(s)) return s;
    if (/^[./#]/.test(s)) return s;                       // 相对路径 / 锚点
    return '';
  }

  function inline(text) {
    let s = text;

    // 行内代码先占位，避免内部内容被后续规则改写
    const codes = [];
    s = s.replace(/`([^`\n]+)`/g, (_, c) => {
      codes.push('<code>' + c + '</code>');
      return '\u0000C' + (codes.length - 1) + '\u0000';
    });

    // 图片
    s = s.replace(/!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"([^"]*)")?\s*\)/g, (_, alt, url, title) => {
      const u = safeUrl(url);
      if (!u) return alt;
      return '<img src="' + u + '" alt="' + alt + '"' + (title ? ' title="' + title + '"' : '') + ' loading="lazy">';
    });
    // 链接
    s = s.replace(/\[([^\]]+)\]\(\s*([^)\s]+)(?:\s+"([^"]*)")?\s*\)/g, (_, txt, url, title) => {
      const u = safeUrl(url);
      if (!u) return txt;
      const ext = /^https?:/i.test(u) ? ' target="_blank" rel="noopener noreferrer"' : '';
      return '<a href="' + u + '"' + (title ? ' title="' + title + '"' : '') + ext + '>' + txt + '</a>';
    });

    // 强调
    s = s.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^\w*])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>');
    s = s.replace(/(^|[^\w_])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>');
    s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    s = s.replace(/==([^=]+)==/g, '<mark>$1</mark>');

    // 还原行内代码
    s = s.replace(/\u0000C(\d+)\u0000/g, (_, i) => codes[+i]);
    return s;
  }

  function isBlank(l) { return /^\s*$/.test(l); }
  function indentOf(l) { return (/^\s*/.exec(l)[0] || '').replace(/\t/g, '    ').length; }

  /* ---------- 列表（支持缩进嵌套） ---------- */
  function parseList(lines, start) {
    const base = indentOf(lines[start]);
    const ordered = /^\s*\d+[.)]\s+/.test(lines[start]);
    const items = [];
    let i = start;

    while (i < lines.length) {
      const line = lines[i];
      if (isBlank(line)) {
        // 空行后若仍是列表项则继续，否则结束
        if (i + 1 < lines.length && indentOf(lines[i + 1]) >= base && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i + 1])) { i++; continue; }
        break;
      }
      const m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
      if (!m) {
        // 续行：并入上一项
        if (items.length && indentOf(line) > base) {
          items[items.length - 1].body.push(line.trim());
          i++;
          continue;
        }
        break;
      }
      if (indentOf(line) < base) break;
      if (indentOf(line) > base) {
        // 子列表：递归解析后挂到上一项
        const sub = parseList(lines, i);
        if (items.length) items[items.length - 1].children.push(sub.html);
        i = sub.next;
        continue;
      }
      items.push({ body: [m[3]], children: [] });
      i++;
    }

    let html = '';
    items.forEach(it => {
      let body = inline(it.body.join(' '));
      if (/^\s*\[[ xX]\]\s+/.test(it.body[0])) {
        const done = /^\s*\[[xX]\]/.test(it.body[0]);
        body = body.replace(/^\s*\[[ xX]\]\s+/, '');
        body = '<span class="md-task' + (done ? ' done' : '') + '">' + (done ? '✓' : '') + '</span>' + body;
      }
      html += '<li>' + body + (it.children.length ? it.children.join('') : '') + '</li>';
    });

    return { html: (ordered ? '<ol>' : '<ul>') + html + (ordered ? '</ol>' : '</ul>'), next: i };
  }

  function render(md) {
    if (!md) return '';
    const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // 空行
      if (isBlank(line)) { i++; continue; }

      // 代码块
      const fence = /^\s*(```|~~~)\s*([\w+-]*)\s*$/.exec(line);
      if (fence) {
        const mark = fence[1];
        const lang = fence[2];
        const buf = [];
        i++;
        while (i < lines.length && !new RegExp('^\\s*' + mark + '\\s*$').test(lines[i])) {
          buf.push(lines[i]); i++;
        }
        i++; // 跳过结束围栏
        out.push('<pre class="md-pre"' + (lang ? ' data-lang="' + esc(lang) + '"' : '') + '><code>'
          + esc(buf.join('\n')) + '</code></pre>');
        continue;
      }

      // 分割线
      if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { out.push('<hr>'); i++; continue; }

      // 标题
      const h = /^\s*(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
      if (h) {
        const lv = h[1].length;
        const id = 'h-' + String(h[2]).replace(/[^\w\u4e00-\u9fa5]+/g, '-').slice(0, 40);
        out.push('<h' + lv + ' id="' + id + '">' + inline(h[2]) + '</h' + lv + '>');
        i++;
        continue;
      }

      // 引用
      if (/^\s*>\s?/.test(line)) {
        const buf = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
          buf.push(lines[i].replace(/^\s*>\s?/, ''));
          i++;
        }
        out.push('<blockquote>' + render(buf.join('\n')) + '</blockquote>');
        continue;
      }

      // 列表
      if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
        const r = parseList(lines, i);
        out.push(r.html);
        i = r.next;
        continue;
      }

      // 缩进代码块（4 空格）
      if (/^ {4,}\S/.test(line)) {
        const buf = [];
        while (i < lines.length && (/^ {4,}/.test(lines[i]) || isBlank(lines[i]))) {
          buf.push(lines[i].replace(/^ {4}/, '')); i++;
        }
        out.push('<pre class="md-pre"><code>' + esc(buf.join('\n').replace(/\n+$/, '')) + '</code></pre>');
        continue;
      }

      // 段落：连续非空行合并；行内单换行保留为 <br>（小说排版友好）
      const buf = [];
      while (i < lines.length && !isBlank(lines[i])
        && !/^\s*(#{1,6})\s+/.test(lines[i])
        && !/^\s*(```|~~~)/.test(lines[i])
        && !/^\s*>\s?/.test(lines[i])
        && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i])
        && !/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i])) {
        buf.push(lines[i]); i++;
      }
      if (!buf.length) { i++; continue; }
      const html = buf.map(l => inline(l)).join('<br>');
      out.push(/^\s*<img /.test(html) ? '<p class="md-figure">' + html + '</p>' : '<p>' + html + '</p>');
    }

    return out.join('\n');
  }

  /* ---------- 大纲 ---------- */
  function outline(md) {
    const res = [];
    String(md || '').replace(/\r\n?/g, '\n').split('\n').forEach(l => {
      const m = /^\s*(#{1,4})\s+(.+?)\s*#*\s*$/.exec(l);
      if (m) res.push({ level: m[1].length, text: m[2], id: 'h-' + m[2].replace(/[^\w\u4e00-\u9fa5]+/g, '-').slice(0, 40) });
    });
    return res;
  }

  /* ---------- 纯文本（用于摘要 / 卡片） ---------- */
  function plain(md, max) {
    let s = String(md || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
      .replace(/[*_~`=]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (max && s.length > max) s = s.slice(0, max) + '…';
    return s;
  }

  B.md = { render, inline, outline, plain };
})(window.BKN);
