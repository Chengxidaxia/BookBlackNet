// ============================================================
// auth.mjs — Netlify Function：群书阁邮箱账号（/api/auth/*）
// 存储: Netlify Blobs（bbn-users store）
// 路由由 netlify.toml 重定向: /api/auth/* → /.netlify/functions/auth/:splat
// 核心逻辑见 auth-core.mjs（存储解耦，可本地单测）
// ============================================================
import { getStore } from '@netlify/blobs';
import { handleAuth } from './auth-core.mjs';

export default async (req) => {
  let store;
  try {
    store = getStore('bbn-users');
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Blobs 不可用（本地请用 netlify dev）' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
  return handleAuth(req, store);
};
