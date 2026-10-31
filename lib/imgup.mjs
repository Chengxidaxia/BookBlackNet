// ============================================================
// imgup.mjs — Netlify Function：图片上传转发到 pixhost.to
// 路由: /api/imgup (POST multipart，字段 file)
// 为什么走服务端：浏览器直传 pixhost 有 CORS/UA 限制；Function
// 转发一次到位。请求体上限约 6MB（Netlify 限制），前端限 5MB。
// pixhost.to 无需任何 API 密钥。
// ============================================================

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  },
});

async function pixhostUpload(buf, name) {
  const fd = new FormData();
  fd.append('content_type', '0');
  fd.append('max_th_size', '420');
  fd.append('img', new Blob([buf]), name || 'img');
  const r = await fetch('https://api.pixhost.to/images', {
    method: 'POST',
    body: fd,
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(90000),
  });
  if (!r.ok) throw new Error('pixhost ' + r.status);
  const j = await r.json();
  let direct = null;
  try {
    const page = await fetch(j.show_url, { signal: AbortSignal.timeout(45000) });
    const t = await page.text();
    const m = t.match(/https:\/\/[a-z0-9.]+\.pixhost\.to\/images\/[^\s"'<>]+/i);
    direct = m && m[0];
  } catch (e) { /* 直链解析失败用 show_url 兜底 */ }
  return { url: direct || j.show_url, show: j.show_url, th: j.th_url };
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const form = await req.formData();
    const file = form.get('file') || form.get('img');
    if (!file || typeof file === 'string') return json({ error: '缺少图片字段 file' }, 400);
    if (file.size > 5.5 * 1024 * 1024) return json({ error: '图片超过 5.5MB（Function 请求体限制）' }, 413);
    const buf = Buffer.from(await file.arrayBuffer());
    const out = await pixhostUpload(buf, file.name || 'img.jpg');
    return json({ code: 0, data: out });
  } catch (e) {
    return json({ error: '上传失败：' + (e && e.message || e) }, 502);
  }
};
