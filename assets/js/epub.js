/* ============================================================
   epub.js — .epub ⇄ .bookp 格式转换（纯本地，零上传）
   ------------------------------------------------------------
   · .bookp → .epub：用站点密钥（公开书）或阅读口令（私密书）
     解开正文，按 EPUB 3 规范生成「mimetype + container.xml +
     OPF + nav + ncx + 章节 XHTML + 样式（+ 封面）」的 zip。
   · .epub → .bookp：解析 container.xml → OPF → spine，
     逐章把 XHTML 正文转成 Markdown，再按书阁的加密格式
     （crypto.pack：JSON→gzip→AES-GCM，站点密钥包裹）打包。
   · EPUB 的 mimetype 必须是不压缩的第一个条目 —— 复用
     convert.js 的 buildZip（全 store 写入）正好满足。
   依赖：util / crypto / md（markdown）/ convert（zip 读写）。
   ============================================================ */
(function (root) {
  'use strict';

  const util = root.util;
  const crypto_ = root.crypto;
  const md = root.md;
  const CV = root.convert;
  const CFG = (typeof window !== 'undefined' && window.BOOK) || {};   // 站点配置挂在 window，不在 BKN 上

  if (!util || !crypto_ || !md || !CV) {
    console.error('epub: 依赖缺失（需要 util / crypto / md / convert）');
    return;
  }

  const $ = id => document.getElementById(id);
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const COVER_MAX = 320 * 1024;          // 封面图内嵌上限（超过就用文字封面）
  const EXT_OF = {
    'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png',
    'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg'
  };

  /* ============================================================
     一、路径与 XML 小工具
     ============================================================ */
  function normPath(p) {
    return String(p || '').replace(/\\/g, '/').replace(/^\.\//, '');
  }
  function stripQuery(href) {
    return String(href || '').split('#')[0].split('?')[0];
  }
  function joinPath(dir, href) {
    const segs = (dir ? String(dir).split('/') : []).concat(normPath(stripQuery(href)).split('/'));
    const out = [];
    for (const s of segs) {
      if (!s || s === '.') continue;
      if (s === '..') out.pop();
      else out.push(s);
    }
    return out.join('/');
  }
  function dirOf(p) {
    const s = normPath(p);
    const i = s.lastIndexOf('/');
    return i < 0 ? '' : s.slice(0, i);
  }
  function pad3(n) { return String(n).padStart(3, '0'); }
  function kb(bytes) { return (bytes / 1024).toFixed(bytes >= 102400 ? 0 : 1) + ' KB'; }

  function parseXML(bytes) {
    const text = dec.decode(bytes);
    let doc = null;
    try { doc = new DOMParser().parseFromString(text, 'application/xml'); } catch (e) { doc = null; }
    // 命名空间写错 / 不合法 XML 时退回宽松的 HTML 解析，尽量把书救回来
    if (!doc || doc.getElementsByTagName('parsererror').length) {
      return new DOMParser().parseFromString(text, 'text/html');
    }
    return doc;
  }
  function tags(doc, name) {
    const list = doc.getElementsByTagNameNS('*', name);
    if (list && list.length) return Array.prototype.slice.call(list);
    const lower = String(name).toLowerCase();
    return Array.prototype.slice.call(doc.getElementsByTagName('*'))
      .filter(el => String(el.localName || el.tagName || '').toLowerCase() === lower);
  }
  function dcAll(doc, name) {
    const list = doc.getElementsByTagNameNS('http://purl.org/dc/elements/1.1/', name);
    const out = Array.prototype.slice.call(list)
      .map(el => String(el.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    if (out.length) return out;
    // 前缀不规范时按本地名兜底
    return tags(doc, name)
      .map(el => String(el.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  }

  /* ============================================================
     二、XHTML（DOM）→ Markdown
     ============================================================ */
  const MD_SKIP = /^(script|style|head|svg|noscript|nav|iframe|object|audio|video)$/i;

  function plainOf(node) {
    return String(node.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function inlineNode(n) {
    if (n.nodeType === 3) return String(n.nodeValue || '').replace(/\s+/g, ' ');
    if (n.nodeType !== 1) return '';
    const tag = String(n.localName || n.tagName || '').toLowerCase();
    if (MD_SKIP.test(tag)) return '';
    const inner = () => Array.prototype.map.call(n.childNodes || [], inlineNode).join('');

    switch (tag) {
      case 'br': return '  \n';
      case 'b': case 'strong': {
        const t = inner().trim();
        return t ? '**' + t + '**' : '';
      }
      case 'i': case 'em': {
        const t = inner().trim();
        return t ? '*' + t + '*' : '';
      }
      case 'del': case 's': case 'strike': {
        const t = inner().trim();
        return t ? '~~' + t + '~~' : '';
      }
      case 'code': {
        const t = String(n.textContent || '').replace(/\s+/g, ' ').trim();
        return t ? '`' + t + '`' : '';
      }
      case 'a': {
        const href = n.getAttribute('href') || '';
        const t = inner().trim() || href;
        if (!t) return '';
        return (href && href.charAt(0) !== '#') ? '[' + t + '](' + href + ')' : t;
      }
      case 'img': {
        const src = n.getAttribute('src') || '';
        if (!src) return '';
        return '![' + (n.getAttribute('alt') || '') + '](' + src + ')';
      }
      case 'sup': {
        const t = inner().trim();
        return t ? '^' + t : '';
      }
      default: return inner();
    }
  }
  function inlineOf(node) {
    return Array.prototype.map.call(node.childNodes || [], inlineNode).join('');
  }

  // 块级标签；其余（em/strong/a/code/span…）一律当行内，并入当前段落
  const BLOCK_SET = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'div', 'section',
    'article', 'main', 'body', 'header', 'footer', 'aside', 'blockquote', 'pre',
    'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'figure',
    'figcaption', 'hr', 'dl', 'dt', 'dd', 'center']);

  function blockOf(container) {
    const out = [];
    let pend = '';                      // 正在累积的行内内容
    const flush = () => {
      const t = pend.replace(/\s+/g, ' ').trim();
      if (t) out.push(t);
      pend = '';
    };

    Array.prototype.forEach.call(container.childNodes || [], n => {
      if (n.nodeType === 3) {
        pend += String(n.nodeValue || '');
        return;
      }
      if (n.nodeType !== 1) return;

      const tag = String(n.localName || n.tagName || '').toLowerCase();
      if (MD_SKIP.test(tag)) return;
      const epubType = String(n.getAttribute('epub:type') || n.getAttribute('role') || '').toLowerCase();
      if (epubType === 'toc' || epubType === 'doc-toc') return;   // 内嵌目录页

      if (!BLOCK_SET.has(tag)) {         // 行内元素：并进当前段落，不另起一段
        pend += inlineNode(n);
        return;
      }
      flush();

      switch (tag) {
        case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
          const t = plainOf(n);
          if (t) out.push('#'.repeat(Number(tag.charAt(1))) + ' ' + t);
          break;
        }
        case 'p': {
          const t = inlineOf(n).replace(/\s+/g, ' ').trim();
          if (t) out.push(t);
          break;
        }
        case 'blockquote': {
          const inner = blockOf(n).trim();
          if (inner) out.push(inner.split('\n').map(l => '> ' + l).join('\n'));
          break;
        }
        case 'pre': {
          const code = String(n.textContent || '').replace(/^\n/, '').replace(/\s+$/, '');
          let lang = '';
          const c = n.querySelector('code');
          const cls = c ? (c.getAttribute('class') || '') : '';
          const m = /(?:language|lang)-([\w+#-]+)/i.exec(cls);
          if (m) lang = m[1];
          out.push('```' + lang + '\n' + code + '\n```');
          break;
        }
        case 'ul': case 'ol': {
          const items = Array.prototype.filter.call(n.children || [], c =>
            /^li$/i.test(String(c.localName || c.tagName || '')));
          const lines = [];
          items.forEach((li, i) => {
            const marker = tag === 'ol' ? (i + 1) + '. ' : '- ';
            let body = blockOf(li).trim();
            if (!body) body = inlineOf(li).replace(/\s+/g, ' ').trim();
            if (!body) return;
            const pad = ' '.repeat(marker.length);
            lines.push(marker + body.split('\n').join('\n' + pad));
          });
          if (lines.length) out.push(lines.join('\n'));
          break;
        }
        case 'hr': out.push('---'); break;
        case 'figure': case 'div': case 'section': case 'article': case 'main':
        case 'body': case 'header': case 'footer': case 'aside': case 'li': {
          const inner = blockOf(n).trim();
          if (inner) out.push(inner);
          break;
        }
        case 'table': {
          const t = plainOf(n);
          if (t) out.push(t);
          break;
        }
        default: {
          const t = inlineOf(n).replace(/\s+/g, ' ').trim();
          if (t) out.push(t);
        }
      }
    });

    flush();                            // 收尾：最后一段行内内容
    return out.filter(x => x && x.trim()).join('\n\n');
  }

  /* ============================================================
     三、EPUB → .bookp
     ============================================================ */
  function findCover(odoc, items, opfDir, byName) {
    let it = items.find(x => /\bcover-image\b/.test(x.props));
    if (!it) {
      const metas = tags(odoc, 'meta');
      const m = metas.find(x => String(x.getAttribute('name') || '').toLowerCase() === 'cover');
      const cid = m && m.getAttribute('content');
      if (cid) it = items.find(x => x.id === cid);
    }
    if (!it) it = items.find(x => /^image\//.test(x.type) && /cover/i.test(x.href));
    if (!it) return null;

    const e = byName.get(joinPath(opfDir, it.href));
    if (!e || !e.data || !e.data.length) return null;
    return { data: e.data, media: it.type || guessImageType(it.href) };
  }
  function guessImageType(href) {
    if (/\.png$/i.test(href)) return 'image/png';
    if (/\.gif$/i.test(href)) return 'image/gif';
    if (/\.webp$/i.test(href)) return 'image/webp';
    if (/\.svg$/i.test(href)) return 'image/svg+xml';
    return 'image/jpeg';
  }

  async function epubToBookp(file, outBox) {
    if (!CFG.SITE_KEY) throw new Error('站点密钥缺失（config.js 未配置 SITE_KEY）');

    const entries = await CV.readZip(await file.arrayBuffer());
    if (!entries.length) throw new Error('文件是空 zip');

    const byName = new Map();
    entries.forEach(e => {
      const n = normPath(e.name);
      if (!n || /\/$/.test(n)) return;                 // 目录项
      if (/^__MACOSX\//i.test(n)) return;              // macOS 垃圾
      if (/(^|\/)\.DS_Store$/i.test(n)) return;
      byName.set(n, e);
    });

    /* --- 1) container.xml 找 OPF --- */
    let opfPath = '';
    const container = byName.get('META-INF/container.xml');
    if (container) {
      const cdoc = parseXML(container.data);
      const rf = tags(cdoc, 'rootfile')[0];
      if (rf) opfPath = normPath(rf.getAttribute('full-path') || '');
    }
    if (!opfPath) {
      const cand = entries.find(e => /\.opf$/i.test(e.name));
      if (cand) opfPath = normPath(cand.name);
    }
    if (!opfPath) throw new Error('不是有效的 EPUB：找不到 OPF（content.opf）');
    const opfE = byName.get(opfPath);
    if (!opfE) throw new Error('EPUB 结构损坏：OPF 不存在（' + opfPath + '）');

    const opfDir = dirOf(opfPath);
    const odoc = parseXML(opfE.data);

    /* --- 2) 元数据 --- */
    const bookTitle = (dcAll(odoc, 'title')[0] || file.name.replace(/\.epub$/i, '')).trim();
    const bookAuthor = (dcAll(odoc, 'creator')[0] || '佚名').trim();
    const bookIntro = (dcAll(odoc, 'description')[0] || '').trim();
    const subjects = dcAll(odoc, 'subject').slice(0, 6);

    /* --- 3) manifest / spine --- */
    const items = tags(odoc, 'item').map(el => ({
      id: el.getAttribute('id') || '',
      href: normPath(el.getAttribute('href') || ''),
      type: String(el.getAttribute('media-type') || '').toLowerCase(),
      props: String(el.getAttribute('properties') || '')
    }));
    const byId = new Map(items.map(i => [i.id, i]));
    // linear="no" 是辅助内容（封面、版权页等），不算章节
    const refs = tags(odoc, 'itemref')
      .filter(el => String(el.getAttribute('linear') || 'yes').toLowerCase() !== 'no')
      .map(el => el.getAttribute('idref') || '')
      .filter(Boolean);
    if (!refs.length) throw new Error('EPUB 里没有 spine（无法确定章节顺序）');

    const notes = [];

    /* --- 4) 逐章解析 --- */
    const chapters = [];
    const seen = new Set();

    for (const idref of refs) {
      const it = byId.get(idref);
      if (!it) continue;
      if (/\bnav\b/.test(it.props)) continue;                       // EPUB3 导航页
      const path = joinPath(opfDir, it.href);
      if (seen.has(path)) continue;
      seen.add(path);

      const e = byName.get(path);
      if (!e) { notes.push('缺少文件 ' + path + '，已跳过'); continue; }
      if (it.type && !/x?html/i.test(it.type) && !/\.x?html?$/i.test(path)) continue;

      let doc;
      try { doc = new DOMParser().parseFromString(dec.decode(e.data), 'text/html'); }
      catch (err) { notes.push('解析失败 ' + path); continue; }
      const body = doc.body;
      if (!body) continue;
      const bodyType = String(body.getAttribute('epub:type') || '').toLowerCase();
      if (bodyType === 'toc') continue;                 // 内嵌目录页
      if (bodyType === 'cover') continue;               // 封面页（封面图已单独取用）
      // 纯图片页（没有文字）不算正文章节，否则会多出一堆空章
      if (!String(body.textContent || '').replace(/\s+/g, '') && body.querySelector('img')) continue;

      // 章节标题：正文第一个 h1~h3，取走后从 DOM 移除（避免正文重复）
      let title = '';
      const hd = body.querySelector('h1, h2, h3');
      if (hd) {
        title = plainOf(hd).slice(0, 80);
        hd.remove();
      }
      if (!title) title = String(doc.title || '').replace(/\s+/g, ' ').trim().slice(0, 80);

      const content = blockOf(body).trim();
      if (!content) continue;

      const no = chapters.length + 1;
      // <title> 常常就是书名，这时候按序号命名
      if (!title || title === bookTitle) title = '第 ' + no + ' 章';
      chapters.push({ id: 'c' + no, title: title, content: content });
    }

    if (!chapters.length) throw new Error('没解析出任何章节（这本书可能是纯图片版或结构异常）');

    /* --- 5) 封面 --- */
    let cover = null;
    const cv = findCover(odoc, items, opfDir, byName);
    if (cv) {
      if (cv.data.length > COVER_MAX) {
        notes.push('封面图 ' + kb(cv.data.length) + ' 超过上限 ' + kb(COVER_MAX) + '，已改用文字封面');
      } else {
        cover = { type: 'image', url: 'data:' + cv.media + ';base64,' + crypto_.b64(cv.data) };
      }
    }

    /* --- 6) 打包成 .bookp --- */
    const now = new Date().toISOString();
    const id = util.uid('bk_');
    const meta = {
      id: id,
      title: bookTitle.slice(0, 60) || '未命名作品',
      author: bookAuthor.slice(0, 30) || '佚名',
      intro: bookIntro.slice(0, 500),
      category: '其他',
      tags: subjects,
      status: 'done',
      visibility: 'public',
      cover: cover,
      createdAt: now,
      updatedAt: now
    };

    const packed = await crypto_.pack({ id: id, meta: meta, chapters: chapters },
      { secret: CFG.SITE_KEY, wrap: 'site' });

    const fileName = id + '.bookp';
    util.download(fileName, new Blob([packed.json], { type: 'application/json' }));

    const words = chapters.reduce((n, c) => n + util.words(c.content), 0);
    let msg = '已生成 <strong>' + fileName + '</strong>：' + chapters.length + ' 章 / ' +
      util.num(words) + ' 字，' + kb(packed.bytes) + (cover ? '（含封面图）' : '') + '。';
    msg += '<br><span class="small muted">分类默认「其他」，可导入写作台后调整再发布。</span>';
    if (notes.length) msg += '<br><span class="small muted">提示：' + util.esc(notes.slice(0, 3).join('；')) + '</span>';
    result(outBox, true, msg);
  }

  /* ============================================================
     四、XHTML 生成（.bookp → .epub）
     ============================================================ */
  const CSS = [
    'body{font-family:serif;line-height:1.85;margin:0 5%;text-align:justify;}',
    'h1.chap-title{font-size:1.5em;font-weight:600;text-align:center;margin:1.4em 0 1.6em;}',
    'p{text-indent:2em;margin:0 0 .9em;}',
    'blockquote{margin:1em 2em;padding-left:.8em;border-left:3px solid #ccc;color:#444;}',
    'pre{white-space:pre-wrap;background:#f5f5f5;padding:.8em;font-size:.9em;border-radius:4px;}',
    'code{font-family:monospace;background:#f3f3f3;padding:0 .2em;}',
    'pre code{background:none;padding:0;}',
    'img{max-width:100%;height:auto;}',
    'hr{border:none;border-top:1px solid #ccc;margin:1.6em 0;}',
    'ul,ol{margin:0 0 .9em 1.5em;padding:0;}',
    'li{margin:.3em 0;}',
    'a{color:#9c3a2c;}',
    '.cover-page{margin:0;padding:0;text-align:center;}',
    '.cover-wrap{height:100vh;display:flex;align-items:center;justify-content:center;}',
    '.cover-wrap img{max-width:100%;max-height:100%;}'
  ].join('\n');

  const CONTAINER_XML = '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n'
    + '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>\n'
    + '</container>';

  function xhtmlize(html) {
    return String(html || '')
      // <br> / <hr> / <img> 在 XHTML 里必须自闭合
      .replace(/<(br|hr)(\s[^>]*?)?\s*\/?>/gi, (m, tag, attr) => '<' + tag + (attr || '') + '/>')
      .replace(/<img\b([^>]*?)\s*\/?>/gi, '<img$1/>');
  }

  function stripLeadingTitle(content, title) {
    const lines = String(content || '').split('\n');
    let i = 0;
    while (i < lines.length && !lines[i].trim()) i++;
    const m = /^#\s+(.+?)\s*#*\s*$/.exec(lines[i] || '');
    if (m && m[1].trim() === String(title || '').trim()) lines.splice(i, 1);
    return lines.join('\n');
  }

  function chapterXhtml(ch, no) {
    const t = String(ch.title || ('第 ' + no + ' 章'));
    let body = '';
    try { body = md.render(stripLeadingTitle(ch.content, t)); }
    catch (e) { body = '<p>' + util.esc(String(ch.content || '')) + '</p>'; }
    body = xhtmlize(body);

    return '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n'
      + '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh-CN" lang="zh-CN">\n'
      + '<head><meta charset="utf-8"/><title>' + util.esc(t) + '</title>'
      + '<link rel="stylesheet" type="text/css" href="../style.css"/></head>\n'
      + '<body><section epub:type="chapter">\n'
      + '<h1 class="chap-title">' + util.esc(t) + '</h1>\n'
      + body + '\n</section></body></html>';
  }

  function coverXhtml(bookTitle, imgHref) {
    return '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n'
      + '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh-CN" lang="zh-CN">\n'
      + '<head><meta charset="utf-8"/><title>封面</title>'
      + '<link rel="stylesheet" type="text/css" href="../style.css"/></head>\n'
      + '<body class="cover-page"><div class="cover-wrap">'
      + '<img src="' + imgHref + '" alt="' + util.esc(bookTitle) + '"/></div></body></html>';
  }

  function navXhtml(bookTitle, chaps) {
    const lis = chaps.map(c =>
      '<li><a href="' + c.href + '">' + util.esc(c.title) + '</a></li>').join('');
    return '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n'
      + '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh-CN" lang="zh-CN">\n'
      + '<head><meta charset="utf-8"/><title>' + util.esc(bookTitle) + ' · 目录</title>'
      + '<link rel="stylesheet" type="text/css" href="style.css"/></head>\n'
      + '<body><nav epub:type="toc" id="toc"><h1>目录</h1><ol>' + lis + '</ol></nav></body></html>';
  }

  function ncxXml(uuid, bookTitle, author, chaps) {
    const points = chaps.map((c, i) =>
      '<navPoint id="np' + (i + 1) + '" playOrder="' + (i + 1) + '">'
      + '<navLabel><text>' + util.esc(c.title) + '</text></navLabel>'
      + '<content src="' + c.href + '"/></navPoint>').join('');
    return '<?xml version="1.0" encoding="UTF-8"?>\n'
      + '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="zh-CN">\n'
      + '<head><meta name="dtb:uid" content="urn:uuid:' + uuid + '"/>'
      + '<meta name="dtb:depth" content="1"/>'
      + '<meta name="dtb:totalPageCount" content="0"/>'
      + '<meta name="dtb:maxPageNumber" content="0"/></head>\n'
      + '<docTitle><text>' + util.esc(bookTitle) + '</text></docTitle>\n'
      + '<docAuthor><text>' + util.esc(author) + '</text></docAuthor>\n'
      + '<navMap>' + points + '</navMap></ncx>';
  }

  function opfXml(o) {
    const items = [];
    items.push('<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>');
    items.push('<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>');
    items.push('<item id="css" href="style.css" media-type="text/css"/>');
    if (o.coverImg) {
      items.push('<item id="cover-image" href="' + o.coverImg.rel + '" media-type="' +
        o.coverImg.media + '" properties="cover-image"/>');
      items.push('<item id="cover" href="text/cover.xhtml" media-type="application/xhtml+xml"/>');
    }
    o.chaps.forEach(c => items.push('<item id="' + c.id + '" href="' + c.href +
      '" media-type="application/xhtml+xml"/>'));

    const spine = [];
    if (o.coverImg) spine.push('<itemref idref="cover"/>');
    o.chaps.forEach(c => spine.push('<itemref idref="' + c.id + '"/>'));

    const metas = [
      '<dc:identifier id="bookid">urn:uuid:' + o.uuid + '</dc:identifier>',
      '<dc:title>' + util.esc(o.title) + '</dc:title>',
      '<dc:creator>' + util.esc(o.author) + '</dc:creator>',
      '<dc:language>zh-CN</dc:language>',
      '<meta property="dcterms:modified">' + o.modified + '</meta>'
    ];
    if (o.intro) metas.push('<dc:description>' + util.esc(o.intro) + '</dc:description>');
    (o.tags || []).forEach(t => metas.push('<dc:subject>' + util.esc(t) + '</dc:subject>'));
    if (o.coverImg) metas.push('<meta name="cover" content="cover-image"/>');

    return '<?xml version="1.0" encoding="UTF-8"?>\n'
      + '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="zh-CN">\n'
      + '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">' + metas.join('') + '</metadata>\n'
      + '<manifest>' + items.join('') + '</manifest>\n'
      + '<spine toc="ncx">' + spine.join('') + '</spine>\n'
      + '</package>';
  }

  function genUuid() {
    try {
      if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    } catch (e) { /* 老浏览器无 randomUUID */ }
    const b = new Uint8Array(16);
    window.crypto.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.prototype.map.call(b, x => x.toString(16).padStart(2, '0')).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' +
      h.slice(16, 20) + '-' + h.slice(20);
  }

  function safeFileName(s) {
    const t = String(s || '').replace(/[\\/:*?"<>|\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim();
    return (t || '未命名作品').slice(0, 60);
  }

  async function bookpToEpub(file, outBox, passInput) {
    const text = await file.text();
    const j = util.safeJSON(text, null);
    if (!j || !j.crypto) throw new Error('不是有效的 .bookp（应为含 crypto 字段的加密 JSON）');

    /* --- 1) 解密：填了口令优先用，否则用站点密钥 --- */
    const pw = passInput ? String(passInput.value || '').trim() : '';
    let data;
    if (pw) {
      data = await crypto_.unpack(text, { secret: pw });
    } else {
      try {
        data = await crypto_.unpack(text, { secret: CFG.SITE_KEY });
      } catch (e) {
        if (j.crypto && j.crypto.wrap === 'pass') {
          throw new Error('这是私密作品，请先在上方「阅读口令」里填写口令再转换');
        }
        throw e;
      }
    }

    const meta = data.meta || {};
    const bookTitle = String(meta.title || '未命名作品');
    const author = String(meta.author || '佚名');
    const intro = String(meta.intro || '');
    const tags = Array.isArray(meta.tags) ? meta.tags.filter(Boolean).slice(0, 6) : [];

    const chapters = (data.chapters || []).filter(c => String(c.content || '').trim() || c.title);
    if (!chapters.length) throw new Error('这本书没有任何章节内容，无法生成 EPUB');

    /* --- 2) 组装文件 --- */
    const uuid = genUuid();
    const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const files = [];

    // mimetype 必须第一个、不压缩（buildZip 全 store，符合规范）
    files.push({ name: 'mimetype', data: enc.encode('application/epub+zip') });
    files.push({ name: 'META-INF/container.xml', data: enc.encode(CONTAINER_XML) });

    // 封面图（.bookp 的 cover.url 可能是 data URL）
    let coverImg = null;
    const cv = meta.cover;
    if (cv && cv.type === 'image' && /^data:image\//i.test(cv.url || '')) {
      const m = /^data:(image\/[a-z0-9+.-]+);base64,([\s\S]*)$/i.exec(cv.url);
      if (m) {
        const media = m[1].toLowerCase();
        const ext = EXT_OF[media] || 'jpg';
        const rel = 'images/cover.' + ext;
        coverImg = { rel: rel, media: media };
        files.push({
          name: 'OEBPS/' + rel,
          data: crypto_.unb64(m[2].replace(/\s+/g, ''))
        });
        files.push({ name: 'OEBPS/text/cover.xhtml', data: enc.encode(coverXhtml(bookTitle, '../' + rel)) });
      }
    }

    // 章节
    const chaps = chapters.map((c, i) => {
      const n = pad3(i + 1);
      const title = String(c.title || ('第 ' + (i + 1) + ' 章'));
      files.push({ name: 'OEBPS/text/ch' + n + '.xhtml', data: enc.encode(chapterXhtml(c, i + 1)) });
      return { id: 'ch' + n, href: 'text/ch' + n + '.xhtml', title: title };
    });

    files.push({ name: 'OEBPS/style.css', data: enc.encode(CSS) });
    files.push({ name: 'OEBPS/nav.xhtml', data: enc.encode(navXhtml(bookTitle, chaps)) });
    files.push({ name: 'OEBPS/toc.ncx', data: enc.encode(ncxXml(uuid, bookTitle, author, chaps)) });
    files.push({
      name: 'OEBPS/content.opf',
      data: enc.encode(opfXml({
        uuid: uuid, title: bookTitle, author: author, intro: intro, tags: tags,
        modified: modified, chaps: chaps, coverImg: coverImg
      }))
    });

    /* --- 3) 输出 --- */
    const blob = CV.buildZip(files, 'application/epub+zip');
    const fileName = safeFileName(bookTitle) + '.epub';
    util.download(fileName, blob);

    const words = chapters.reduce((n, c) => n + util.words(c.content), 0);
    result(outBox, true, '已生成 <strong>' + util.esc(fileName) + '</strong>：' + chaps.length +
      ' 章 / ' + util.num(words) + ' 字' + (coverImg ? '，含封面图' : '') +
      '。<br><span class="small muted">可直接导入 Apple Books / Calibre / 微信读书等阅读器。</span>');
  }

  /* ============================================================
     五、UI
     ============================================================ */
  function result(box, ok, html) {
    box.className = 'conv-result ' + (ok ? 'ok' : 'err');
    box.innerHTML = html;
  }

  function boot() {
    if (!CV.bindPanel) { console.error('epub: convert.js 未导出 bindPanel'); return; }

    CV.bindPanel('dz-e2p', 'file-e2p', 'out-e2p', epubToBookp);
    CV.bindPanel('dz-p2e', 'file-p2e', 'out-p2e', function (f, out) {
      return bookpToEpub(f, out, $('pass-p2e'));
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  root.epub = { epubToBookp: epubToBookp, bookpToEpub: bookpToEpub, blockOf: blockOf, xhtmlize: xhtmlize };
})(window.BKN);
