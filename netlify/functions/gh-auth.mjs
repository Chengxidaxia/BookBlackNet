// ============================================================
// gh-auth.mjs — Netlify Function：GitHub 登录态（/api/gh/me、/api/gh/logout）
// 路由由 netlify.toml 重定向: /api/gh/* → /.netlify/functions/gh-auth/:splat
// ============================================================
import { handleGh } from './gh-core.mjs';

export default async (req) => handleGh(req, fetch);
