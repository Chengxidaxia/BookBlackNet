// imgup.js — Vercel Function：图片上传转发 pixhost.to（书阁 /api/imgup）
import { toWebRequest, sendResponse } from './_lib.mjs';
import imgupHandler from '../lib/imgup.mjs';

export default async function handler(req, res) {
  try {
    const r = await imgupHandler(toWebRequest(req));
    await sendResponse(res, r);
  } catch (e) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: String((e && e.message) || e) }));
  }
}
