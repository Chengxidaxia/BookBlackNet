// token.js — Vercel Function：把 Cookie 里的 GitHub 令牌还给登录用户本人
// ------------------------------------------------------------
// 用途：书阁发布走浏览器直调 GitHub Contents API（PAT）。若用户已在
// 群档案（grp）登录，github_token Cookie（Domain=.blacknet.cc.cd，
// HttpOnly）会随请求带上；本端点读取后原样返回给**同源**前端，
// 让「没填 PAT 但已登录群档案」的用户也能直接发布。
//
// 安全边界：
//   · Cookie 是 HttpOnly，前端 JS 读不到，必须经此端点中转；
//   · 响应不设缓存头（no-store），令牌不落 CDN / 中间层；
//   · 只回给发起请求的浏览器本人（读他自己的 Cookie），无提权。
import { toWebRequest, sendResponse } from './_lib.mjs';

function readCookie(request, name) {
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}

function jsonResponse(obj, status, extraHeaders) {
  const h = Object.assign({
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': 'https://book.blacknet.cc.cd',
    'Access-Control-Allow-Credentials': 'true',
  }, extraHeaders || {});
  return new Response(JSON.stringify(obj), { status: status || 200, headers: h });
}

async function handle(request) {
  if (request.method === 'OPTIONS') {
    return jsonResponse({}, 204, {
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
  }
  if (request.method !== 'GET') return jsonResponse({ error: 'Method Not Allowed' }, 405);

  const token = readCookie(request, 'github_token');
  if (!token) return jsonResponse({ error: '未登录：请先在群档案登录 GitHub 账号，或在本机填写作令牌' }, 401);
  return jsonResponse({ token });
}

export default async function handler(req, res) {
  try {
    await sendResponse(res, await handle(toWebRequest(req)));
  } catch (e) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: String((e && e.message) || e) }));
  }
}
