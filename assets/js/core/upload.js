/* ============================================================
   core/upload.js — 复用主站图床（upload.blacknet.cc.cd → B2）

   · 走站点同源反代（netlify.toml 转发），无 CORS 问题；
   · 鉴权双保险：登录 Cookie（Domain=.blacknet.cc.cd 自动携带）
     或 GitHub PAT（Authorization: Bearer，upload worker 原生支持）；
   · 返回 https://img.blacknet.cc.cd/<file>，CDN 缓存在 CF 边缘。
   ============================================================ */
(function () {
  'use strict';
  const B = (window.BKN = window.BKN || {});
  const UPLOAD_URL = 'https://upload.blacknet.cc.cd/';

  // 注意：net 实例由 api.js 创建（晚于本文件），调用时再取
  const netFetch = (...a) => ((B.net && B.net.fetch) ? B.net.fetch(...a) : fetch(...a));

  /** 上传 File，成功返回图片 URL（img.blacknet.cc.cd/…），失败 throw */
  async function uploadImage(file) {
    if (!file || typeof file === 'string') throw new Error('没有可上传的文件');
    if (file.size > 8 * 1024 * 1024) throw new Error('图片超过 8MB，请压缩后再传');
    if (!/^image\/(jpeg|png|gif|webp)$/.test(file.type)) throw new Error('仅支持 JPG / PNG / GIF / WebP');

    const headers = {};
    const pat = (B.api && B.api.auth && B.api.auth.get) ? B.api.auth.get() : '';
    if (pat) headers['Authorization'] = 'Bearer ' + pat;

    const fd = new FormData();
    fd.append('file', file, file.name);

    const res = await netFetch(UPLOAD_URL, { method: 'POST', headers: headers, body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data && data.msg) || ('上传失败（HTTP ' + res.status + '）'));
    const map = data && data.data && data.data.succMap;
    const url = map && (map[file.name] || Object.values(map)[0]);
    if (data.code === 0 && url) return url;
    throw new Error((data && data.msg) || '上传失败：未知错误');
  }

  B.upload = { uploadImage };
})();
