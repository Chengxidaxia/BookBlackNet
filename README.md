# BookBlackNet · 群书阁

长篇小说的写作与阅读空间。写作台把一本书当作**长期工程**来管：多章节、自动存稿、随时接着写；发布时才打包成一个加密的 `.book` 文件，推进书籍仓库。

- 站点入口：`index.html`（书库）、`read.html`（阅读）、`write.html`（写作台）
- 书籍存放：`docs/books/*.book` + `docs/books/index.json`
- **本仓库只有前端**。后端不在库里（发布走 GitHub Contents API，或你自己的 Cloudflare Worker）。

---

## 目录结构

```
book/
├─ index.html            书库首页（书架 / 搜索 / 继续阅读）
├─ read.html             阅读器（目录、排版、进度记忆）
├─ write.html            写作台（章节管理 + 长文编辑）
├─ 404.html
├─ docs/books/
│  ├─ index.json         书目索引（明文，只含公开摘要）
│  └─ *.book             书籍密文
├─ assets/
│  ├─ css/  base.css home.css read.css write.css
│  └─ js/
│     ├─ config.js       站点/仓库/密钥配置
│     ├─ home.js  read.js  write.js
│     └─ core/
│        ├─ util.js      DOM、toast、字数、格式化
│        ├─ crypto.js    .book 打包 / 解包
│        ├─ markdown.js  轻量 Markdown 渲染（约 3KB）
│        ├─ store.js     本地书稿仓库（IndexedDB）
│        └─ api.js       书库读取 + GitHub 发布
└─ netlify.toml
```

---

## `.book` 文件格式

一个 JSON 文件，外层是公开摘要，正文全部是密文。

```jsonc
{
  "format": "bookblacknet.book",
  "v": 1,
  "meta": {
    "id": "bk_...", "title": "长夜将明", "author": "沈砚",
    "intro": "...", "category": "悬疑", "tags": ["民俗"],
    "status": "ongoing",            // ongoing | done
    "visibility": "public",         // public | private
    "cover": { "type": "letter", "from": "#7c3a2e", "to": "#3d1c16", "text": "长" },
    "chapters": 3, "words": 1244,   // 冗余字段，列表页不下载全文也能显示
    "createdAt": "...", "updatedAt": "..."
  },
  "crypto": {
    "alg": "AES-GCM",
    "kdf": "PBKDF2-SHA256",
    "iter": 310000,
    "salt": "base64(16B)",
    "wrap": "site",                 // site = 站点密钥；pass = 作者口令
    "wrapIv": "base64(12B)",
    "wrapped": "base64(32B DEK 密文)",
    "zip": "gzip",                  // gzip | none
    "dataIv": "base64(12B)",
    "data": "base64(正文密文)"
  }
}
```

**密钥链**

```
secret ──PBKDF2(salt, 310000)──▶ KEK ──AES-GCM(wrapIv)──▶ DEK(32B)
DEK ──AES-GCM(dataIv)──▶ 密文 ──gunzip?──▶ {"meta":{...},"chapters":[{id,title,content}]}
```

**两种可见性**

| 可见性 | secret 来源 | 读者体验 | 安全边界 |
|---|---|---|---|
| `public` | `config.js` 的 `SITE_KEY` | 打开即读 | 密钥随前端下发；防的是「仓库里出现明文」「随手抓取」，不是专业逆向 |
| `private` | 作者设置的口令 | 输入口令才能打开 | 口令不入库、不上传；31 万次 PBKDF2，强度取决于口令 |

> 私密书的口令丢失后**无法找回**——这是加密，不是权限。

---

## 写作台怎么工作

1. **写**：`write.html` 里新建作品 → 分章节写。正文存 IndexedDB，输入停顿 0.7 秒自动落盘，关标签页也会保存。
2. **管**：章节可增删、上下移动；顶部「作品信息」设书名/笔名/分类/标签/简介/连载状态/私密。
3. **发**：点「发布」→ 浏览器内完成 gzip + 加密 → 上传 `.book` → 重写 `index.json`。

发布通道（`config.js` 的 `PUBLISH_MODE`）：

| 通道 | 需要什么 | 说明 |
|---|---|---|
| `github`（默认） | 一个 Fine-grained PAT，`Contents: Read and write` | 浏览器直连 GitHub API，令牌只存 `localStorage`，不经过任何第三方 |
| `worker` | 自建 CF Worker，实现 `POST /publish` | 令牌留在服务端；**后端代码不在本仓库** |

也可以「仅下载 .book」，手动放进 `docs/books/` 并更新 `index.json`。

---

## 阅读器

- 目录抽屉、上一章/下一章、← → 键翻章
- 排版：字号 / 行距 / 版心宽度 / 宋黑字体 / 纸白·米黄·夜间
- 进度按书记忆，首页「继续阅读」直接续上
- 渲染走自写的轻量 Markdown：标题、粗斜体、删除线、引用、列表、分隔线、链接、图片、代码块

---

## 本地开发

WebCrypto 只在安全上下文可用，**必须用 localhost 打开**（`file://` 不行）。

在仓库根执行（`--directory` 指向本目录）：

```bash
python -m http.server 8123 --directory book
```

如果当前就在本目录里，用：

```bash
python -m http.server 8123
```

然后访问 `http://localhost:8123/`。

---

## 部署

正式域名：**<https://book.blacknet.cc.cd>**（`assets/js/config.js → SITE_URL`）。

### Netlify（推荐）

本目录根即站点根，`netlify.toml` 已经写好（无构建，`publish = "."`）。
Netlify 新建站点时 **Base directory 填 `book`**（Netlify 只读 base 目录下的 toml），
然后在 Domain management 里绑 `book.blacknet.cc.cd`，DNS 用 CNAME → `<站点名>.netlify.app`，
证书签发完成后再开 Force HTTPS。

Netlify 有个好处：`netlify.toml` 里配了 `/proxy/api.github.com/*` 与
`/proxy/raw.githubusercontent.com/*`，前端在国内直连 GitHub 不通时会自动走这条同源反代。

### GitHub Pages

独立仓库 `Chengxidaxia/BookBlackNet`（根即站点）→ Settings → Pages →
Custom domain 填 `book.blacknet.cc.cd`。仓库根需要 `CNAME` 文件
（内容就一行 `book.blacknet.cc.cd`），`scripts/sync-book-repo.sh` 会自动带上；
`.nojekyll` 同理，脚本也会补。

Pages 上没有 `/proxy/` 转发，`net.js` 会收到 404 并**自动降级为直连**，功能不受影响，
只是少了这一层兜底。

### 放在群档案的子路径下

根项目的 `scripts/netlify-build.sh` 会把 `book/` 一起复制进 `dist/book/`，因此
`https://grp.blacknet.cc.cd/book/` 仍可访问（保留为备用入口，也可当书籍的同源兜底）。
页面已带 `canonical` 指向 `book.blacknet.cc.cd`，不会被搜索引擎当成重复内容。

### 书籍与站点分仓（jsDelivr）

读书不强制同源：`assets/js/core/api.js` 按 **同源 → jsDelivr（三节点并发竞速）→ raw.githubusercontent**
取 `index.json` 与 `.book`，任一成功即返回，每层都有超时保护。

所以站点可以部署在 Netlify，书籍单独放 `BookBlackNet` 仓库，只靠 CDN 读。
详见仓库根的 **[CDN.md](../CDN.md)**：缓存与 `?v=` 版本戳、jsDelivr 限制、验收命令
（`node scripts/cdn-urls.mjs --check`）。

本地改完要同步到书籍仓库：`bash scripts/sync-book-repo.sh`（SSH，不弹凭据）。

排查用：`<html data-book-source="site|cdn|raw|none">`。

---

## 配置

改 `assets/js/config.js` 一处即可：

| 键 | 作用 |
|---|---|
| `REPO_OWNER` / `REPO_NAME` / `BRANCH` | 书籍仓库 |
| `BOOKS_DIR` / `INDEX_FILE` | 书籍与索引路径（默认 `docs/books`） |
| `CDN.hosts` | jsDelivr 节点顺序，前面的失败自动换下一个 |
| `CDN.base` | 自定义数据源基地址（自建反代 / 对象存储），填了就忽略 `hosts` |
| `CDN.timeout` / `CDN.siteTimeout` | 单个源超时（毫秒） |
| `SITE_KEY` | 公开书的主密钥，**换成你自己的随机串** |
| `PUBLISH_MODE` | `github` 或 `worker` |
| `API_BASE` | 用 worker 通道时填 Worker 地址 |
| `SITE_URL` | 正式域名，用于 canonical 与分享链接。换域时改这一处 |
| `PROXY` | 同源反代：`mode` = `auto`/`always`/`off`，`hosts` 是允许代理的域名（默认 `api.github.com`、`raw.githubusercontent.com`）。注意 `CDN.hosts` 里的 jsDelivr 不在其中 —— CDN 自己就通 CORS |
| `CATEGORIES` | 分类列表 |
| `READER` | 阅读器默认排版 |

---

## 示例书籍

`docs/books/` 里有三本示例（《长夜将明》《旧书店的第七个夏天》《星图之外》），用来验证加密链路和排版。
不需要时直接删除对应 `.book`，并从 `index.json` 的 `books` 数组里去掉那一条即可。
