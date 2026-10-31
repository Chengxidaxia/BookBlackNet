/* ============================================================
   core/upload.js — 图片上传（双通道）

   主通道: 站点同源 Netlify Function /api/imgup → pixhost.to
           （无密钥、无 CORS，服务端转发；返回 pixhost 直链）
   兜底:   CF upload.blacknet.cc.cd（Bearer PAT / Cookie）
           → 返回 img.blacknet.cc.cd 旧图床链接
   ============================================================ */
(function () {
  'use strict';
  const B = (window.BKN = window.BKN || {});
  const UPLOAD_URL = 'https://upload.blacknet.cc.cd/';
  const PIXHOST_URL = '/api/imgup';

  // 注意：net 实例由 api.js 创建（晚于本文件），调用时再取
  const netFetch = (...a) => ((B.net && B.net.fetch) ? B.net.fetch(...a) : fetch(...a));

  /** 上传 File，成功返回图片 URL，失败 throw */
  async function uploadImage(file) {
    if (!file || typeof file === 'string') throw new Error('没有可上传的文件');
    if (file.size > 5 * 1024 * 1024) throw new Error('图片超过 5MB，请压缩后再传');
    if (!/^image\/(jpeg|png|gif|webp)$/.test(file.type)) throw new Error('仅支持 JPG / PNG / GIF / WebP');

    // 主通道：同源 Function → pixhost（无需登录、无密钥）
    try {
      const fd = new FormData();
      fd.append('file', file, file.name);
      const res = await netFetch(PIXHOST_URL, { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.code === 0 && data.data && data.data.url) return data.data.url;
      if (res.status !== 404) throw new Error((data && data.error) || ('上传失败（HTTP ' + res.status + '）'));
      // 404 = 无 Function（GitHub Pages 镜像等）→ 落 CF 兜底
    } catch (e) {
      if (!/HTTP 404/.test(e.message) && e.message.indexOf('上传失败') !== 0) throw e;
    }

    // 兜底：CF upload worker（Bearer PAT 或 Cookie）
    const headers = {};
    const pat = (B.api && B.api.auth && B.api.auth.get) ? B.api.auth.get() : '';
    if (pat) headers['Authorization'] = 'Bearer ' + pat;

    const fd2 = new FormData();
    fd2.append('file', file, file.name);

    const res = await netFetch(UPLOAD_URL, { method: 'POST', headers: headers, body: fd2 });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data && data.msg) || ('上传失败（HTTP ' + res.status + '）'));
    const map = data && data.data && data.data.succMap;
    const url = map && (map[file.name] || Object.values(map)[0]);
    if (data.code === 0 && url) return url;
    throw new Error((data && data.msg) || '上传失败：未知错误');
  }

  B.upload = { uploadImage };
})();
