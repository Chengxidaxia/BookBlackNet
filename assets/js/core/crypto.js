/* ============================================================
   crypto.js — .book 文件格式（创建 / 解析）
   ------------------------------------------------------------
   设计要点
   1. 正文（章节 Markdown）先组装成 JSON → gzip → AES-GCM 加密；
   2. 加密用的随机 DEK（数据密钥）再用 KEK 包裹后写入文件，
      KEK 来自站点主密钥（public 书）或作者口令（private 书）；
   3. 外层保留一份「公开摘要」，让书库列表不下载全文也能展示。
   这样 .book 落地即密文，仓库里看不到任何正文。
   ============================================================ */
window.BKN = window.BKN || {};

(function (B) {
  'use strict';

  const FORMAT = 'bookblacknet.book';
  const VERSION = 1;
  const ITER = 310000;

  const subtle = (typeof crypto !== 'undefined' && crypto.subtle) ? crypto.subtle : null;
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  /* ---------- base64 ---------- */
  function b64(bytes) {
    const arr = new Uint8Array(bytes);
    let s = '';
    const CH = 0x8000;
    for (let i = 0; i < arr.length; i += CH) {
      s += String.fromCharCode.apply(null, arr.subarray(i, i + CH));
    }
    return btoa(s);
  }
  function unb64(str) {
    const bin = atob(str);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  const rand = n => crypto.getRandomValues(new Uint8Array(n));

  /* ---------- 压缩 ---------- */
  async function gzip(bytes) {
    if (typeof CompressionStream === 'undefined') return null;
    try {
      const cs = new CompressionStream('gzip');
      const stream = new Blob([bytes]).stream().pipeThrough(cs);
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch (e) { return null; }
  }
  async function gunzip(bytes) {
    if (typeof DecompressionStream === 'undefined') throw new Error('当前浏览器不支持解压');
    const ds = new DecompressionStream('gzip');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /* ---------- 密钥派生 ---------- */
  async function deriveKEK(secret, salt, iter) {
    const base = await subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey']);
    return subtle.deriveKey(
      { name: 'PBKDF2', salt: salt, iterations: iter, hash: 'SHA-256' },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /* ---------- 封面配色（无封面图时按书名取一组沉稳色） ---------- */
  const PALETTE = [
    ['#7c3a2e', '#3d1c16'], ['#2f4f4a', '#152a26'], ['#37506e', '#1a283a'],
    ['#6b5340', '#31241a'], ['#5a3a55', '#291827'], ['#7a5c2e', '#382810'],
    ['#8a4a28', '#3a1d0e'], ['#3f4a58', '#1c2229'], ['#6a3838', '#301717'],
    ['#2e4a3c', '#14251c']
  ];
  function coverTheme(seed) {
    const s = String(seed || '');
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    const p = PALETTE[h % PALETTE.length];
    return { from: p[0], to: p[1] };
  }
  function coverOf(meta) {
    if (meta && meta.cover && meta.cover.type === 'image' && meta.cover.url) return meta.cover;
    const t = coverTheme((meta && (meta.title || meta.id)) || '');
    return { type: 'letter', from: t.from, to: t.to, text: firstChar(meta && meta.title) };
  }
  function firstChar(title) {
    const s = String(title || '书').replace(/^[\s《「【(（]+/, '');
    return s.slice(0, 1) || '书';
  }

  /* ---------- 打包 ---------- */
  /**
   * @param {Object} book  { id, meta, chapters:[{id,title,content}] }
   * @param {Object} opt   { secret, wrap:'site'|'pass' }
   * @returns {Promise<{json:string, fileName:string, bytes:number}>}
   */
  async function pack(book, opt) {
    if (!subtle) throw new Error('当前页面不是安全上下文（需 https 或 localhost），无法加密');
    const secret = (opt && opt.secret) || '';
    if (!secret) throw new Error('缺少加密密钥');
    const wrap = (opt && opt.wrap) === 'pass' ? 'pass' : 'site';

    const meta = normalizeMeta(book.meta, book);
    const chapters = (book.chapters || []).map((c, i) => ({
      id: c.id || 'c' + (i + 1),
      title: String(c.title || ('第 ' + (i + 1) + ' 章')),
      content: String(c.content || '')
    }));
    const words = chapters.reduce((n, c) => n + B.util.words(c.content), 0);

    // 1) 明码摘要（列表页用，不含正文）
    const pub = {
      id: meta.id,
      title: meta.title,
      author: meta.author,
      intro: meta.intro,
      category: meta.category,
      tags: meta.tags,
      status: meta.status,
      visibility: meta.visibility,
      cover: coverOf(meta),
      chapters: chapters.length,
      words: words,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt
    };

    // 2) 正文负载
    const payload = { meta: Object.assign({}, meta, { words: words, chapters: chapters.length }), chapters: chapters };
    let plain = enc.encode(JSON.stringify(payload));
    let zip = 'none';
    const gz = await gzip(plain);
    if (gz && gz.byteLength < plain.byteLength) { plain = gz; zip = 'gzip'; }

    // 3) 密钥
    const salt = rand(16);
    const kek = await deriveKEK(secret, salt, ITER);
    const dek = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const rawDek = new Uint8Array(await subtle.exportKey('raw', dek));

    const wrapIv = rand(12);
    const wrapped = await subtle.encrypt({ name: 'AES-GCM', iv: wrapIv }, kek, rawDek);

    const dataIv = rand(12);
    const ct = await subtle.encrypt({ name: 'AES-GCM', iv: dataIv }, dek, plain);

    const file = {
      format: FORMAT,
      v: VERSION,
      meta: pub,
      crypto: {
        alg: 'AES-GCM',
        kdf: 'PBKDF2-SHA256',
        iter: ITER,
        salt: b64(salt),
        wrap: wrap,
        wrapIv: b64(wrapIv),
        wrapped: b64(wrapped),
        zip: zip,
        dataIv: b64(dataIv),
        data: b64(ct)
      }
    };
    const json = JSON.stringify(file);
    return {
      json: json,
      fileName: meta.id + '.book',
      bytes: enc.encode(json).byteLength
    };
  }

  /* ---------- 解包 ---------- */
  /**
   * @param {string|Object} src .book 文本或对象
   * @param {Object} opt { secret }
   */
  async function unpack(src, opt) {
    if (!subtle) throw new Error('当前页面不是安全上下文（需 https 或 localhost），无法解密');
    let file;
    if (typeof src === 'string') {
      try { file = JSON.parse(src); }
      catch (e) { throw new Error('文件格式错误：不是有效的 .book'); }
    } else file = src;

    if (!file || file.format !== FORMAT) throw new Error('文件格式错误：缺少 BookBlackNet 标识');
    if (!file.crypto || !file.crypto.data) throw new Error('文件已损坏：缺少加密数据');

    const c = file.crypto;
    const secret = (opt && opt.secret) || '';
    if (!secret) throw new Error(c.wrap === 'pass' ? '此书需要阅读口令' : '缺少站点密钥');

    const salt = unb64(c.salt);
    const kek = await deriveKEK(secret, salt, c.iter || ITER);

    let rawDek;
    try {
      rawDek = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(c.wrapIv) }, kek, unb64(c.wrapped));
    } catch (e) {
      throw new Error(c.wrap === 'pass' ? '口令不正确' : '站点密钥不匹配，无法解开本书');
    }
    const dek = await subtle.importKey('raw', rawDek, { name: 'AES-GCM' }, false, ['decrypt']);

    let buf;
    try {
      buf = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(c.dataIv) }, dek, unb64(c.data));
    } catch (e) {
      throw new Error('正文解密失败：文件可能被改动');
    }
    if (c.zip === 'gzip') buf = await gunzip(new Uint8Array(buf));

    let payload;
    try { payload = JSON.parse(dec.decode(buf)); }
    catch (e) { throw new Error('正文解析失败：文件已损坏'); }

    const meta = Object.assign({}, file.meta || {}, payload.meta || {});
    return {
      raw: file,
      meta: meta,
      chapters: payload.chapters || [],
      words: (payload.chapters || []).reduce((n, ch) => n + B.util.words(ch.content), 0)
    };
  }

  /* ---------- 元数据规整 ---------- */
  function normalizeMeta(m, book) {
    const src = m || {};
    const now = new Date().toISOString();
    const tags = Array.isArray(src.tags) ? src.tags.filter(Boolean).slice(0, 6) : [];
    return {
      id: (src.id || book.id || B.util.uid('bk_')).replace(/[^\w-]/g, ''),
      title: (src.title || '未命名作品').trim().slice(0, 60),
      author: (src.author || '佚名').trim().slice(0, 30),
      intro: (src.intro || '').trim().slice(0, 500),
      category: src.category || '其他',
      tags: tags,
      status: src.status === 'done' ? 'done' : 'ongoing',
      visibility: src.visibility === 'private' ? 'private' : 'public',
      cover: src.cover || null,
      createdAt: src.createdAt || now,
      updatedAt: src.updatedAt || now
    };
  }

  /* ---------- 校验 / 摘要 ---------- */
  function summaryOf(meta) {
    const m = meta || {};
    return {
      id: m.id,
      title: m.title || '未命名作品',
      author: m.author || '佚名',
      intro: m.intro || '',
      category: m.category || '其他',
      tags: m.tags || [],
      status: m.status || 'ongoing',
      visibility: m.visibility || 'public',
      cover: coverOf(m),
      chapters: m.chapters || 0,
      words: m.words || 0,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt
    };
  }

  B.crypto = { FORMAT, VERSION, ITER, pack, unpack, coverOf, coverTheme, firstChar,
               summaryOf, b64, unb64, hasSubtle: () => !!subtle };
})(window.BKN);
