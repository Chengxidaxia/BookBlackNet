// gh.js — Vercel Function：GitHub 登录态（书阁 /api/gh/me、/api/gh/logout）
import { toWebRequest, sendResponse } from './_lib.mjs';
import { handleGh } from '../lib/gh-core.mjs';

export default async function handler(req, res) {
  try {
    const r = await handleGh(toWebRequest(req), fetch);
    await sendResponse(res, r);
  } catch (e) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: String((e && e.message) || e) }));
  }
}
