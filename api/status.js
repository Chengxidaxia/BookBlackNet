// ============================================================
// status.js — Vercel Function：部署自检（只读，无副作用）
// ------------------------------------------------------------
// 用途：改完环境变量 / 触发重新部署后，直接访问 /api/status 就能确认
//       服务端到底拿到了什么，不用靠「发一本书试试」来猜。
//
// 返回（只给布尔值与标识，绝不含令牌明文）：
//   {
//     ok, time, build,
//     env: {
//       bot: 服务端是否配了 BOT_GH_TOKEN,
//       upstash: 是否配了 Upstash REST 地址+令牌,
//       upstashReadOnly: 用的令牌是否只读（KV_REST_API_READ_ONLY_TOKEN）,
//       contentAdmin: /api/content 的 PUT 白名单,
//       booksRepo / booksBranch / booksDir
//     }
//   }
//
// 判定要点：
//   · bot = false → 发布只能回退「调用者自己的令牌」，此时只有仓库协作者能发
//   · upstash = true 但 upstashReadOnly = true → 读没问题，PUT /api/content 必失败
// ============================================================

import { cors, sendJSON } from '../lib/cloud.mjs';

const BUILD = 'status-v1';

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'GET') return sendJSON(res, 405, { error: 'Method Not Allowed' });

  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || process.env.KV_URL || '';
  const writeTok = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';
  const readTok = process.env.KV_REST_API_READ_ONLY_TOKEN || '';

  let host = '';
  try { host = new URL(url).host; } catch (e) { host = ''; }

  return sendJSON(res, 200, {
    ok: true,
    time: new Date().toISOString(),
    build: BUILD,
    env: {
      bot: !!process.env.BOT_GH_TOKEN,
      upstash: !!(url && (writeTok || readTok)),
      upstashHost: host,                                  // 只回显主机名，便于核对两个项目是不是同一个库
      upstashReadOnly: !writeTok && !!readTok,             // true = 只有只读令牌，写入会失败
      contentAdmin: String(process.env.CONTENT_ADMIN || 'Chengxidaxia'),
      booksRepo: process.env.BOOKS_REPO || 'Chengxidaxia/BookBlackNet',
      booksBranch: process.env.BOOKS_BRANCH || 'main',
      booksDir: process.env.BOOKS_DIR || 'docs/books',
    },
  });
}
