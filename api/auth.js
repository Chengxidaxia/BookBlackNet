// auth.js — Vercel Function：书阁邮箱账号服务（/api/auth/*）
// 存储用 Upstash Redis（REST 接口，零依赖）：Vercel 面板 → Storage →
// 创建 Upstash Redis 并 Connect 到本项目，环境变量自动注入：
//   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
// 键与 Netlify Blobs 版完全一致（user:<email> / sess:<token>），数据可无缝导入。
import { toWebRequest, sendResponse } from './_lib.mjs';
import { handleAuth } from '../netlify/functions/auth-core.mjs';

// 与 auth-core 的 get/set/delete 接口对齐的 Redis 适配器
function makeStore(env) {
  const base = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  if (!base || !token) return null;
  const cmd = async (...args) => {
    const r = await fetch(base + '/' + args.map(a => encodeURIComponent(a)).join('/'), {
      headers: { Authorization: 'Bearer ' + token },
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    return j.result;
  };
  return {
    get: (k) => cmd('get', k),
    set: (k, v) => cmd('set', k, v),
    delete: (k) => cmd('del', k),
  };
}

export default async function handler(req, res) {
  try {
    const store = makeStore(process.env);
    if (!store) {
      res.statusCode = 500;
      return res.end(JSON.stringify({ error: '存储未配置：请在 Vercel 面板创建 Upstash Redis 并 Connect 本项目' }));
    }
    const r = await handleAuth(toWebRequest(req), store);
    await sendResponse(res, r);
  } catch (e) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: String((e && e.message) || e) }));
  }
}
