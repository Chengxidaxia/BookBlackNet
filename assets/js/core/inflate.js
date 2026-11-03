/* ============================================================
   inflate.js — 纯 JS 解压兜底（raw deflate + gzip）
   ------------------------------------------------------------
   为什么需要：
   .book 的正文是「gzip → AES-GCM」存的，读任何一本书都要先 gunzip；
   .zip / .epub 的条目绝大多数也是 deflate 压缩，转换器同样要解压。
   这两件事平时都交给浏览器的 DecompressionStream，但它在
   老 Safari（< 16.4）、部分微信 / QQ 内置浏览器、旧 Android WebView
   里根本不存在 —— 那些设备上整站表现为「书打不开、转换报错」。

   这里按 RFC 1951 / 1952 自带一份 inflate（stored / fixed / dynamic
   三种块全支持）与 gzip 外壳解析，让这些浏览器也能读、也能转。
   原生可用时优先用原生（快得多），不可用或失败时才走这份实现。

   用法：
     await B.inflate.raw(u8)     // raw deflate → Uint8Array
     await B.inflate.gzip(u8)    // gzip（含多 member）→ Uint8Array
     B.inflate.rawSync(u8)       // 强制走 JS 实现（同步）
     B.inflate.hasNative()       // 是否具备原生解压
   ============================================================ */
window.BKN = window.BKN || {};

(function (B) {
  'use strict';

  /* ---------------- 长度 / 距离码表（RFC 1951 §3.2.5） ---------------- */
  const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59,
    67, 83, 99, 115, 131, 163, 195, 227, 258];
  const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769,
    1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  const DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

  /* ---------------- 位流（deflate 是低位先出） ---------------- */
  function BitReader(d, p) {
    this.d = d;
    this.p = p || 0;
    this.b = 0;
    this.n = 0;
  }
  BitReader.prototype.bit = function () {
    if (this.n === 0) {
      if (this.p >= this.d.length) throw new Error('压缩数据不完整');
      this.b = this.d[this.p++];
      this.n = 8;
    }
    const v = this.b & 1;
    this.b >>= 1;
    this.n--;
    return v;
  };
  BitReader.prototype.bits = function (need) {
    let v = 0;
    for (let i = 0; i < need; i++) v |= this.bit() << i;
    return v;
  };
  BitReader.prototype.align = function () { this.n = 0; this.b = 0; };

  /* ---------------- Huffman 表（puff 风格：count + symbol） ---------------- */
  function Huff() {
    this.count = new Uint16Array(16);
    this.symbol = new Uint16Array(288);
  }
  // 返回 0 正常（含空表），-1 表示码长超额
  function build(h, lengths, n) {
    h.count.fill(0);
    for (let i = 0; i < n; i++) h.count[lengths[i]]++;
    if (h.count[0] === n) return 0;          // 空表：合法，但不能用来解任何符号
    let left = 1;
    for (let len = 1; len <= 15; len++) {
      left = (left << 1) - h.count[len];
      if (left < 0) return -1;
    }
    const offs = new Uint16Array(16);
    for (let len = 1; len < 15; len++) offs[len + 1] = offs[len] + h.count[len];
    for (let i = 0; i < n; i++) if (lengths[i]) h.symbol[offs[lengths[i]]++] = i;
    return 0;
  }
  function decode(h, s) {
    let code = 0, first = 0, index = 0;
    for (let len = 1; len <= 15; len++) {
      code |= s.bit();
      const c = h.count[len];
      if (code - c < first) return h.symbol[index + (code - first)];
      index += c;
      first = (first + c) << 1;
      code <<= 1;
    }
    throw new Error('哈夫曼码无效（数据可能已损坏）');
  }

  /* ---------------- 输出缓冲 ---------------- */
  function Out(n) {
    this.buf = new Uint8Array(Math.max(1024, n | 0));
    this.len = 0;
  }
  Out.prototype.need = function (n) {
    if (this.len + n <= this.buf.length) return;
    let cap = this.buf.length;
    while (cap < this.len + n) cap *= 2;
    const nb = new Uint8Array(cap);
    nb.set(this.buf.subarray(0, this.len));
    this.buf = nb;
  };
  Out.prototype.byte = function (v) {
    if (this.len >= this.buf.length) this.need(1);
    this.buf[this.len++] = v;
  };
  Out.prototype.copy = function (dist, len) {
    this.need(len);
    const b = this.buf;
    let o = this.len;
    if (dist >= len) {
      b.set(b.subarray(o - dist, o - dist + len), o);
      this.len = o + len;
    } else {
      // 注意：不能写 b[o++] = b[o - dist] —— 左侧自增先发生，
      // 右侧读到的就是 o+1-dist，回溯整体偏一位（会把 "abab" 解成 "abaa"）。
      for (let i = 0; i < len; i++) { b[o] = b[o - dist]; o++; }
      this.len = o;
    }
  };

  /* ---------------- 固定 Huffman 表（缓存） ---------------- */
  const FIXED_LIT = new Uint8Array(288);
  const FIXED_DIST = new Uint8Array(30).fill(5);
  (function () {
    for (let i = 0; i < 144; i++) FIXED_LIT[i] = 8;
    for (let i = 144; i < 256; i++) FIXED_LIT[i] = 9;
    for (let i = 256; i < 280; i++) FIXED_LIT[i] = 7;
    for (let i = 280; i < 288; i++) FIXED_LIT[i] = 8;
  })();
  const HL = new Huff(), HD = new Huff();
  build(HL, FIXED_LIT, 288);
  build(HD, FIXED_DIST, 30);

  /* ---------------- 码流主循环 ---------------- */
  function codes(lit, dist, s, out) {
    for (;;) {
      const sym = decode(lit, s);
      if (sym < 256) {
        out.byte(sym);
      } else if (sym === 256) {
        return;
      } else {
        const li = sym - 257;
        if (li >= 29) throw new Error('长度码无效');
        const len = LBASE[li] + s.bits(LEXT[li]);
        const ds = decode(dist, s);
        if (ds >= 30) throw new Error('距离码无效');
        const d = DBASE[ds] + s.bits(DEXT[ds]);
        if (d > out.len) throw new Error('回溯距离越界（数据可能已损坏）');
        out.copy(d, len);
      }
    }
  }

  const CLORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

  function dynamicBlock(s, out) {
    const hlit = s.bits(5) + 257;
    const hdist = s.bits(5) + 1;
    const hclen = s.bits(4) + 4;

    const clen = new Uint8Array(19);
    for (let i = 0; i < hclen; i++) clen[CLORDER[i]] = s.bits(3);
    const ch = new Huff();
    if (build(ch, clen, 19) !== 0) throw new Error('码长表损坏');

    const total = hlit + hdist;
    const lens = new Uint8Array(total);
    let i = 0;
    while (i < total) {
      const sym = decode(ch, s);
      if (sym < 16) {
        lens[i++] = sym;
      } else {
        let rep, val;
        if (sym === 16) {
          if (i === 0) throw new Error('码长表首项不能重复');
          val = lens[i - 1];
          rep = 3 + s.bits(2);
        } else if (sym === 17) {
          val = 0; rep = 3 + s.bits(3);
        } else {
          val = 0; rep = 11 + s.bits(7);
        }
        for (let k = 0; k < rep && i < total; k++) lens[i++] = val;
      }
    }

    const lit = new Huff(), dist = new Huff();
    if (build(lit, lens.subarray(0, hlit), hlit) !== 0) throw new Error('字面量码表损坏');
    if (build(dist, lens.subarray(hlit), hdist) !== 0) throw new Error('距离码表损坏');
    codes(lit, dist, s, out);
  }

  /** raw deflate 解压，返回 { data, end }（end = 压缩数据结束的字节偏移） */
  function inflateRaw(u8, start) {
    const s = new BitReader(u8, start || 0);
    const out = new Out(u8.length * 3);

    let last = 0;
    while (!last) {
      last = s.bit();
      const type = s.bits(2);

      if (type === 0) {                         // stored
        s.align();
        if (s.p + 4 > u8.length) throw new Error('压缩数据不完整');
        const len = u8[s.p] | (u8[s.p + 1] << 8);
        const nlen = u8[s.p + 2] | (u8[s.p + 3] << 8);
        if ((len ^ 0xFFFF) !== nlen) throw new Error('stored 块校验失败');
        s.p += 4;
        if (s.p + len > u8.length) throw new Error('压缩数据不完整');
        out.need(len);
        out.buf.set(u8.subarray(s.p, s.p + len), out.len);
        out.len += len;
        s.p += len;
      } else if (type === 1) {                  // fixed Huffman
        codes(HL, HD, s, out);
      } else if (type === 2) {                  // dynamic Huffman
        dynamicBlock(s, out);
      } else {
        throw new Error('压缩块类型无效');
      }
    }
    return { data: out.buf.subarray(0, out.len), end: s.p };
  }

  /* ---------------- gzip 外壳（RFC 1952，支持多 member） ---------------- */
  function gzipJS(u8) {
    const parts = [];
    let p = 0;
    let guard = 0;

    while (p + 18 <= u8.length && guard++ < 4096) {
      if (u8[p] !== 0x1f || u8[p + 1] !== 0x8b) {
        if (p === 0) throw new Error('不是有效的 gzip 数据');
        break;                                  // 尾部残留，忽略
      }
      if (u8[p + 2] !== 8) throw new Error('不支持的 gzip 压缩算法');
      const flg = u8[p + 3];
      p += 10;

      if (flg & 0x04) {                         // FEXTRA
        if (p + 2 > u8.length) throw new Error('gzip 头损坏');
        const xlen = u8[p] | (u8[p + 1] << 8);
        p += 2 + xlen;
      }
      if (flg & 0x08) { while (p < u8.length && u8[p] !== 0) p++; p++; }   // FNAME
      if (flg & 0x10) { while (p < u8.length && u8[p] !== 0) p++; p++; }   // FCOMMENT
      if (flg & 0x02) p += 2;                                              // FHCRC
      if (p > u8.length) throw new Error('gzip 头损坏');

      const r = inflateRaw(u8, p);
      parts.push(r.data);
      p = r.end + 8;                            // 跳过 CRC32 + ISIZE
    }

    if (!parts.length) throw new Error('gzip 数据为空');
    if (parts.length === 1) return parts[0];

    let total = 0;
    for (const x of parts) total += x.length;
    const out = new Uint8Array(total);
    let off = 0;
    for (const x of parts) { out.set(x, off); off += x.length; }
    return out;
  }

  /* ---------------- 原生优先的封装 ---------------- */
  const hasNative = () => typeof DecompressionStream === 'function';

  async function nativeDecompress(u8, fmt) {
    const ds = new DecompressionStream(fmt);
    const stream = new Blob([u8]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function raw(u8) {
    const data = u8 instanceof Uint8Array ? u8 : new Uint8Array(u8);
    if (hasNative()) {
      try { return await nativeDecompress(data, 'deflate-raw'); }
      catch (e) { /* 落到 JS 实现再试一次 */ }
    }
    return inflateRaw(data).data;
  }

  async function gzip(u8) {
    const data = u8 instanceof Uint8Array ? u8 : new Uint8Array(u8);
    if (hasNative()) {
      try { return await nativeDecompress(data, 'gzip'); }
      catch (e) { /* 同上 */ }
    }
    return gzipJS(data);
  }

  B.inflate = {
    raw, gzip,
    rawSync: u8 => inflateRaw(u8 instanceof Uint8Array ? u8 : new Uint8Array(u8)).data,
    gzipSync: u8 => gzipJS(u8 instanceof Uint8Array ? u8 : new Uint8Array(u8)),
    hasNative
  };
})(window.BKN);
