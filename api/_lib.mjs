// _lib.mjs — Vercel 适配层（书阁）：Node req/res ↔ Web Request/Response
export function toWebRequest(req) {
  const url = 'https://' + (req.headers.host || 'localhost') + req.url;
  const h = new Headers();
  for (const k of Object.keys(req.headers)) {
    if (k === 'host' || k === 'content-length' || k === 'transfer-encoding') continue;
    const v = req.headers[k];
    if (Array.isArray(v)) v.forEach(x => h.append(k, x)); else h.set(k, v);
  }
  const method = req.method || 'GET';
  const hasBody = !/^(GET|HEAD)$/i.test(method);
  return new Request(url, { method, headers: h, body: hasBody ? req : undefined, duplex: 'hold' });
}

export async function sendResponse(res, r) {
  res.statusCode = r.status;
  const setCookies = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [];
  if (setCookies.length) res.setHeader('set-cookie', setCookies);
  for (const [k, v] of r.headers) {
    if (k === 'set-cookie' || k === 'content-encoding' || k === 'transfer-encoding' || k === 'content-length') continue;
    res.setHeader(k, v);
  }
  if (!r.body) return res.end();
  const reader = r.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(Buffer.from(value));
  }
  res.end();
}
