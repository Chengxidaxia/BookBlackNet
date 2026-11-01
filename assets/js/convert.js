/* ============================================================
   convert.js — .bookp ⇄ .zip 格式转换（纯本地，零上传）
   ------------------------------------------------------------
   · .bookp（单体加密 JSON）→ .zip（清单 .book + 分块 .pXXX）
     分块逻辑与 api.js 发布通道一致（≤10MiB/块，不拆代理对）。
   · .zip → .bookp：读 zip 清单与分块，按顺序拼回单体文件。
     支持 store 与 deflate 两种压缩方式（后者用浏览器
     DecompressionStream('deflate-raw')，Chromium 103+ / 现代浏览器）。
   · 不依赖任何第三方库；文件全程不出本机。
   ============================================================ */
(function (root) {
  'use strict';

  const api = root.api;
  const util = root.util;
  if (!api || !util) { console.error('convert: 依赖缺失'); return; }

  const $ = id => document.getElementById(id);

  /* ---------------- ZIP 写（store，无压缩） ---------------- */
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(u8) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function buildZip(files) {           // files: [{name, data:Uint8Array}]
    const enc = new TextEncoder();
    const chunks = [], central = [];
    let offset = 0;
    const u16 = v => [v & 255, (v >>> 8) & 255];
    const u32 = v => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];

    for (const f of files) {
      const name = enc.encode(f.name);
      const crc = crc32(f.data), sz = f.data.length;
      const local = new Uint8Array([
        ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
        ...u32(crc), ...u32(sz), ...u32(sz), ...u16(name.length), ...u16(0),
        ...name
      ]);
      chunks.push(local, f.data);
      central.push(new Uint8Array([
        ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
        ...u32(crc), ...u32(sz), ...u32(sz), ...u16(name.length), ...u16(0), ...u16(0),
        ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...name
      ]));
      offset += local.length + sz;
    }
    let centralSize = 0;
    for (const c of central) centralSize += c.length;
    const eocd = new Uint8Array([
      ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length),
      ...u32(centralSize), ...u32(offset), ...u16(0)
    ]);
    return new Blob([...chunks, ...central, eocd], { type: 'application/zip' });
  }

  /* ---------------- ZIP 读（store + deflate） ---------------- */
  async function readZip(buf) {        // → [{name, data:Uint8Array}]
    const u8 = new Uint8Array(buf);
    const dv = new DataView(buf);
    // 从尾部找 EOCD（0x06054b50）
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65536); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('不是有效的 zip 文件（找不到 EOCD）');
    const count = dv.getUint16(eocd + 10, true);
    let ptr = dv.getUint32(eocd + 16, true);
    const dec = new TextDecoder();
    const files = [];

    for (let i = 0; i < count; i++) {
      if (dv.getUint32(ptr, true) !== 0x02014b50) throw new Error('zip 中央目录损坏');
      const method = dv.getUint16(ptr + 10, true);
      const compSize = dv.getUint32(ptr + 20, true);
      const nameLen = dv.getUint16(ptr + 28, true);
      const extraLen = dv.getUint16(ptr + 30, true);
      const cmtLen = dv.getUint16(ptr + 32, true);
      const localOff = dv.getUint32(ptr + 42, true);
      const name = dec.decode(u8.subarray(ptr + 46, ptr + 46 + nameLen));

      // 本地头：跳过其文件名/extra（长度可能与中央目录不同）
      if (dv.getUint32(localOff, true) !== 0x04034b50) throw new Error('zip 本地头损坏：' + name);
      const lName = dv.getUint16(localOff + 26, true);
      const lExtra = dv.getUint16(localOff + 28, true);
      const dataStart = localOff + 30 + lName + lExtra;
      const raw = u8.subarray(dataStart, dataStart + compSize);

      if (method === 0) {
        files.push({ name: name, data: new Uint8Array(raw) });
      } else if (method === 8) {
        if (typeof DecompressionStream !== 'function')
          throw new Error('浏览器不支持 deflate 解压（需较新的 Chrome/Edge/Firefox）');
        const ds = new DecompressionStream('deflate-raw');
        const stream = new Blob([raw]).stream().pipeThrough(ds);
        const out = await new Response(stream).arrayBuffer();
        files.push({ name: name, data: new Uint8Array(out) });
      } else {
        throw new Error('不支持的压缩方式 ' + method + '：' + name);
      }
      ptr += 46 + nameLen + extraLen + cmtLen;
    }
    return files;
  }

  /* ---------------- 方向 1：.bookp → .zip ---------------- */
  async function bookpToZip(file, outBox) {
    const text = await file.text();
    const j = util.safeJSON(text, null);
    if (!j || !j.crypto) throw new Error('不是有效的 .bookp（应为含 crypto 字段的加密 JSON）');

    // 仓库内文件名：<id>.book；zip 里保持同样的相对名
    const base = (j.pub && j.pub.id) ? j.pub.id : file.name.replace(/\.bookp$/i, '');
    const { manifest, parts, names } = api.makeChunks(text, base + '.book');

    const files = [{ name: base + '.book', data: new TextEncoder().encode(manifest) }];
    names.forEach((n, i) => files.push({ name: n, data: new TextEncoder().encode(parts[i]) }));

    const blob = buildZip(files);
    const name = base + '.zip';
    util.download(name, blob);
    result(outBox, true, '已生成 <strong>' + name + '</strong>：清单 1 个 + 分块 ' + parts.length +
      ' 个（每块 ≤ ' + Math.round(api.CHUNK_MAX / 1048576) + ' MiB）。');
  }

  /* ---------------- 方向 2：.zip → .bookp ---------------- */
  async function zipToBookp(file, outBox) {
    const entries = await readZip(await file.arrayBuffer());
    const byName = new Map(entries.map(e => [e.name, e]));

    // 找清单：名为 *.book 且解析出 bookblacknet.chunks
    let manName = null, man = null;
    for (const e of entries) {
      if (!/\.book$/i.test(e.name)) continue;
      try {
        const j = JSON.parse(new TextDecoder().decode(e.data));
        if (j && j.format === 'bookblacknet.chunks' && Array.isArray(j.parts)) { manName = e.name; man = j; break; }
      } catch (err) { /* 不是清单 */ }
    }
    if (!man) throw new Error('zip 里没找到分块清单（*.book，format=bookblacknet.chunks）');

    const segs = [];
    for (const p of man.parts || []) {
      const e = byName.get(p);
      if (!e) throw new Error('清单列出的分块缺失：' + p);
      segs.push(new TextDecoder().decode(e.data));
    }
    const full = segs.join('');
    const j = util.safeJSON(full, null);
    if (!j || !j.crypto) throw new Error('拼回的 JSON 无效（缺 crypto 字段），分块集可能不完整');

    const outName = manName.replace(/\.book$/i, '') + '.bookp';
    util.download(outName, new Blob([full], { type: 'application/json' }));
    result(outBox, true, '已生成 <strong>' + outName + '</strong>：' + segs.length + ' 个分块拼回，' +
      (full.length / 1024).toFixed(1) + ' KB，校验通过。');
  }

  /* ---------------- UI 装配 ---------------- */
  function result(box, ok, html) {
    box.className = 'conv-result ' + (ok ? 'ok' : 'err');
    box.innerHTML = html;
  }
  function bindPanel(dzId, inputId, outId, acceptFn) {
    const dz = $(dzId), input = $(inputId), out = $(outId);
    dz.addEventListener('click', () => input.click());
    ['dragover', 'dragenter'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('drag'); }));
    dz.addEventListener('drop', e => {
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) handle(f);
    });
    input.addEventListener('change', () => {
      const f = input.files && input.files[0];
      input.value = '';
      if (f) handle(f);
    });
    async function handle(f) {
      result(out, true, '<span class="spinner ink"></span> 转换中…');
      try { await acceptFn(f, out); }
      catch (e) { console.error(e); result(out, false, '转换失败：' + e.message); }
    }
  }

  bindPanel('dz-p2z', 'file-p2z', 'out-p2z', bookpToZip);
  bindPanel('dz-z2p', 'file-z2p', 'out-z2p', zipToBookp);

  root.convert = { buildZip: buildZip, readZip: readZip, bookpToZip: bookpToZip, zipToBookp: zipToBookp };
})(window.BKN);
