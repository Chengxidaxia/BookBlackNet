// ============================================================
// gh-core.mjs — GitHub 登录态读取核心逻辑（与平台解耦，可单测）
// 原理：Cookie github_token（Domain=.blacknet.cc.cd，HttpOnly）
//       会随同域请求带到 Function，服务端拿它问 GitHub /user。
// 替代直连 oauth.blacknet.cc.cd/me（CORS 白名单未含 book 时被拦，
// 且 CF 链路慢），同源调用零 CORS、走 Netlify 边缘。
// ============================================================

const CLEAR_COOKIE = 'github_token=; HttpOnly; Secure; Max-Age=0; Path=/; SameSite=Lax; Domain=.blacknet.cc.cd';

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      ...extra,
    },
  });
}

/**
 * 路由（末段匹配）:
 *   GET  /me     → 200 {login,name,avatar_url,email} | 401 {error}
 *   POST /logout → 200 {ok:true}（清 github_token Cookie）
 */
export async function handleGh(request, fetchImpl) {
  const f = fetchImpl || fetch;
  const last = (new URL(request.url).pathname.replace(/\/+$/, '').split('/').pop() || '');

  if (last === 'logout' && request.method === 'POST') {
    return json({ ok: true }, 200, { 'Set-Cookie': CLEAR_COOKIE });
  }

  const cookie = request.headers.get('Cookie') || '';
  const m = cookie.match(/(?:^|;\s*)github_token=([^;]+)/);
  const token = m ? m[1] : '';
  if (!token) return json({ error: '未登录' }, 401);

  try {
    const res = await f('https://api.github.com/user', {
      headers: { Authorization: 'Bearer ' + token, 'User-Agent': 'GroupBlackNet/1.0' },
    });
    if (!res.ok) return json({ error: 'Token 无效' }, 401, { 'Set-Cookie': CLEAR_COOKIE });
    const u = await res.json();
    // 只回前端需要的字段，不透传邮箱等敏感全集
    return json({ login: u.login, name: u.name, avatar_url: u.avatar_url, email: u.email || '' });
  } catch (e) {
    return json({ error: 'GitHub API 不可达' }, 502);
  }
}
