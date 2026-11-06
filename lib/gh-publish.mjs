// ============================================================
// gh-publish.mjs — 服务端代写书籍仓库（GitHub Contents API）
// ------------------------------------------------------------
// 为什么需要它：浏览器直连时用的是「用户自己的 GitHub 令牌」，没有仓库
// 写权限的账号必然 403。想让「任何登录用户都能发布」，只能由服务端持
// 一把有权限的令牌代提交 —— 就是这里的 BOT_GH_TOKEN。
//
// 设计约束：
//   · Vercel Function 请求体上限 4.5MB → 客户端按 ≤2MiB 分片上传，
//     服务端每片直接 PUT 成 <file>.pNNN，不需要在服务端保留会话；
//   · 先写所有分片，最后写清单（原子切换），中途失败读者看不到半成品；
//   · 清单格式与前端直连完全一致（bookblacknet.chunks），两种通道可混用。
// ============================================================

export const PART_MAX = 2 * 1024 * 1024;        // 每片 2MiB（客户端切好传上来）
const FILE_RE = /^bk_[\w-]{1,60}\.book$/;
const IDX_MAX = 500;

export function isValidFile(name) {
  return FILE_RE.test(String(name || ''));
}

export function partName(file, seq) {
  return file + '.p' + String(seq).padStart(3, '0');
}

export function partNames(file, total) {
  const out = [];
  for (let i = 1; i <= total; i++) out.push(partName(file, i));
  return out;
}

export function makeGh({ token, owner, repo, branch }) {
  const root = 'https://api.github.com/repos/' + owner + '/' + repo;

  async function call(path, init) {
    const res = await fetch(root + path, Object.assign({
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'BookBlackNet-Publish',
      },
    }, init || {}));
    if (res.status === 204) return null;
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (j && j.message) || ('HTTP ' + res.status);
      const e = new Error(msg);
      e.status = res.status;
      throw e;
    }
    return j;
  }

  return {
    /** 读文件 → {sha, text} 或 null */
    async getFile(path) {
      try {
        const j = await call('/contents/' + encodeURI(path) + '?ref=' + branch);
        if (!j || !j.sha) return null;
        const text = j.content ? Buffer.from(j.content, 'base64').toString('utf8') : '';
        return { sha: j.sha, text };
      } catch (e) {
        if (e.status === 404) return null;
        throw e;
      }
    },
    async putFile(path, text, message, sha) {
      const body = {
        message,
        content: Buffer.from(text, 'utf8').toString('base64'),
        branch,
      };
      if (sha) body.sha = sha;
      return call('/contents/' + encodeURI(path), { method: 'PUT', body: JSON.stringify(body) });
    },
    async deleteFile(path, message, sha) {
      return call('/contents/' + encodeURI(path), {
        method: 'DELETE',
        body: JSON.stringify({ message, sha, branch }),
      });
    },
  };
}

/** 从旧清单里取出分片名（旧版单体文件返回空数组） */
export function staleOf(oldText, keep) {
  if (!oldText) return [];
  let j;
  try { j = JSON.parse(oldText); } catch (e) { return []; }
  if (!j || j.format !== 'bookblacknet.chunks' || !Array.isArray(j.parts)) return [];
  return j.parts.filter((n) => keep.indexOf(n) < 0);
}

/** 生成清单文本（与前端 makeChunks 同构） */
export function manifestOf(names, size) {
  return JSON.stringify({
    format: 'bookblacknet.chunks',
    v: 1,
    parts: names,
    size: size,
    updatedAt: new Date().toISOString(),
  });
}

/** 更新 index.json：同 id 覆盖并置顶，保留其它条目 */
export function mergeIndex(oldText, entry) {
  let list = [];
  if (oldText) {
    try {
      const j = JSON.parse(oldText);
      list = Array.isArray(j) ? j : (j && j.books) || [];
    } catch (e) { list = []; }
  }
  list = (Array.isArray(list) ? list : []).filter((b) => b && b.id !== entry.id);
  list.unshift(entry);
  return {
    text: JSON.stringify({
      format: 'bookblacknet.index',
      v: 1,
      updatedAt: new Date().toISOString(),
      books: list.slice(0, IDX_MAX),
    }, null, 2),
    prev: list.slice(0, IDX_MAX),
  };
}

/** 索引里某本书的归属（老数据没有 account → 空串） */
export function ownerOfBook(list, id) {
  const hit = (Array.isArray(list) ? list : []).find((b) => b && b.id === id);
  return hit ? String(hit.account || '') : '';
}
