# BookBlackNet · 群书阁

长篇小说的写作与阅读空间。写作台把一本书当**长期工程**管：分章节、自动存稿、随时接着写；
发布时才在浏览器里打包加密，推进书籍仓库。读者打开即读，密钥不下发正文以外的任何东西。

- 正式站：<https://book.blacknet.cc.cd>（主站「群档案」的子站：<https://grp.blacknet.cc.cd>）
- 本仓库**根即站点**，`vercel.json` 声明 `outputDirectory: "."`，无构建步骤
- 数据真源就在本仓库：`docs/books/`
- 主仓库里的 `book/` 只是开发副本（已 gitignore），用 `bash scripts/sync-book-repo.sh` 同步

---

## 1. 功能地图

| 页面 | 路径 | 做什么 |
|---|---|---|
| 书库首页 | `index` | Hero + 搜索、继续阅读、**最近更新（最多 10 本）**，超出给「查看全部」 |
| 全部书籍 | `books` | 搜索 / 分类 / 排序 / 每页 24 条，筛选状态写进 URL（`?q=&cat=&sort=&page=`） |
| 作品集 | `collections` | 策展清单：名称 + 描述 + 若干作品；登录后可建/改/删，发布进书籍仓库 |
| 作品管理 | `works` | 登录后统一管理：已发布作品 / 云端草稿 / 我的作品集，跨设备继续写 |
| 书籍详情 | `book?id=` | 封面、简介、目录、收藏、「下载 .bookp」、继续阅读 |
| 阅读器 | `read?id=` | 章节抽屉、字号/行距/版心/字体/纸白·米黄·夜间、进度记忆、← → 翻章 |
| 我的书架 | `shelf` | Tab 1「收藏」+ Tab 2「最近阅读」（章节、进度条、百分比、继续） |
| 写作台 | `write` | 我的书稿：列表 / 搜索 / 筛选 / 排序 / 新建 / 导入 / 备份 / 删除 |
| 章节编辑器 | `editor?id=` | 正文编辑（Vditor + 纯文本双模）、章节管理、字数统计、云同步、发布 |
| 格式转换 | `convert` | `.bookp ⇄ .zip`、`.epub ⇄ .bookp`，四个面板，全部在浏览器本地完成 |
| 赞助 | `sponsor` | 无偿赞助说明 |
| 404 | `404` | — |

顶栏（全站统一）：书库 · 写作台 · 我的书架 · 格式转换 · 赞助 · 群档案。
**≤900px 自动折叠为汉堡抽屉**（`core/nav.js` 生成，不改 HTML 结构）。

---

## 2. 目录结构

```
BookBlackNet/
├─ index.html books.html book.html read.html shelf.html
├─ write.html editor.html convert.html sponsor.html 404.html
├─ collections.html works.html    作品集 / 作品管理
├─ api/                     Vercel Functions（线上）
│  ├─ _lib.mjs              req/res 适配
│  ├─ auth.js    /api/auth    邮箱账号：注册 / 登录 / 会话
│  ├─ gh.js      /api/gh      群档案 GitHub 登录态（/me、/logout）
│  ├─ imgup.js   /api/imgup   图片上传转发（pixhost）
│  ├─ shelf.js   /api/shelf   账号书架（收藏 + 进度）
│  ├─ works.js   /api/works   书稿云同步（分块存 Upstash）
│  ├─ collections.js /api/collections  作品集：服务端代写进仓库
│  ├─ publish.js /api/publish 作品发布：服务端代写（BOT_GH_TOKEN）
│  ├─ content.js /api/content 分类与公告：读 Global Config
│  └─ token.js   /api/token   把 HttpOnly Cookie 里的令牌还给本人
├─ lib/                     平台无关核心（api / netlify 两套入口共用）
│  ├─ auth-core.mjs  gh-core.mjs  imgup.mjs
│  ├─ cloud.mjs               Upstash / 身份解析 / CORS / 响应工具
│  └─ gh-publish.mjs          GitHub Contents 读写、清单与索引合并
├─ netlify/functions/       Netlify 版入口（只在主仓库的开发副本里，不同步）
├─ assets/
│  ├─ css/  base home books detail read shelf write convert sponsor
│  └─ js/
│     ├─ config.js          全站配置 window.BOOK
│     ├─ home.js books.js detail.js read.js myshelf.js
│     ├─ write.js editor.js settings.js convert.js epub.js
│     └─ core/
│        ├─ util.js         DOM / toast / 字数 / 时间
│        ├─ crypto.js       .bookp 打包解包（AES-GCM + gzip）
│        ├─ inflate.js      纯 JS inflate/gzip（无 DecompressionStream 时兜底）
│        ├─ api.js          书库读取（三层数据源）+ 发布 + 分块拼装
│        ├─ store.js        本地书稿仓库（IndexedDB）
│        ├─ gist.js         草稿 / 进度云同步（secret Gist）
│        ├─ auth.js         账号（邮箱 + 群档案 GitHub）
│        ├─ account.js      顶栏账号区 + 登录对话框
│        ├─ fav.js          收藏与最近阅读（本地 + 账号）
│        ├─ shelf.js        书架筛选纯函数
│        ├─ nav.js          移动端导航抽屉
│        ├─ net.js          同源反代 fetch 封装
│        ├─ ui.js           弹窗组件（全站不用 alert/prompt）
│        ├─ markdown.js     轻量 Markdown 渲染
│        ├─ prefs.js        偏好设置中心
│        ├─ stats.js        写作统计（今日 / 连续天数 / 累计）
│        ├─ undo.js         textarea 撤销栈（含 IME 保护）
│        └─ upload.js       图片上传（双通道）
├─ docs/books/
│  ├─ index.json            书目索引（明文，只含公开摘要）
│  ├─ *.book                **清单**（分块版）或旧版单体密文
│  └─ *.book.pXXX           分块（每块 ≤ 10 MiB）
├─ vercel.json              Vercel 配置（cleanUrls / api / proxy / 缓存头）
├─ CNAME                    book.blacknet.cc.cd（GitHub Pages 备用）
├─ package.json             仅声明 type: module
└─ .nojekyll
```

---

## 3. 格式体系

仓库、用户、外部工具三者的文件格式是分开的：

| 格式 | 谁用 | 形态 |
|---|---|---|
| `.book`（清单）+ `.book.pXXX` | **仓库** | 小 JSON 清单 + 分块正文，单文件 ≤ 10 MiB |
| `.bookp` | **用户** | 单体加密 JSON，一本书一个文件，可下载 / 导入 / 备份 |
| `.zip` | 交换 | 清单 + 分块打包，便于手工放进仓库或外部工具处理 |
| `.epub` | 交换 | EPUB 3，可导入第三方阅读器 |

### 3.1 单体文件（`.bookp` / 旧版 `.book`）

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
    "chapters": 3, "words": 1244,   // 冗余字段：列表页不下载全文也能显示
    "createdAt": "...", "updatedAt": "..."
  },
  "crypto": {
    "alg": "AES-GCM", "kdf": "PBKDF2-SHA256", "iter": 310000,
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

### 3.2 分块清单（仓库里看到的 `.book`）

```json
{
  "format": "bookblacknet.chunks",
  "v": 1,
  "parts": ["bk_sample_longnight.book.p001"],
  "size": 4695,
  "updatedAt": "2026-11-01T11:04:15.155Z"
}
```

- 正文 JSON 按 **UTF-8 字节**切成 ≤ 10 MiB 的片，**不在代理对中间切断**；
- 加载端先取清单，再顺序取回所有分块拼接（`api.js → fetchBook`）；
- 读旧版单体 `.book` 完全兼容，两种格式长期共存；
- 发布时超过 10 MiB 会自动生成清单 + 分块并逐个提交。

### 3.3 格式互转

全部在 `convert` 页、浏览器本地完成，**文件不出本机**：

| 面板 | 说明 |
|---|---|
| `.bookp → .zip` | 解包后重新按清单 + 分块切分（与线上发布同一套切分规则） |
| `.zip → .bookp` | 读清单与分块，按顺序拼回单体文件；支持 store 与 deflate |
| `.epub → .bookp` | `container.xml → OPF → spine`，逐章 XHTML 转 Markdown 后加密打包 |
| `.bookp → .epub` | 解密 → Markdown 渲染 → 生成 EPUB 3（mimetype 首位且不压缩、nav、ncx、章节 XHTML） |

ZIP 读写零依赖：写入用 store + 自算 CRC32，读取支持 store 与 deflate
（浏览器原生 `DecompressionStream`，缺失时用 `core/inflate.js`）。

---

## 4. 加密链路

```
secret ──PBKDF2(salt, 310000)──▶ KEK ──AES-GCM(wrapIv)──▶ DEK(32B)
DEK ──AES-GCM(dataIv)──▶ 密文 ──gunzip?──▶ {"meta":{…},"chapters":[{id,title,content}]}
```

| 可见性 | secret 来源 | 读者体验 | 安全边界 |
|---|---|---|---|
| `public` | `config.js → SITE_KEY` | 打开即读 | 密钥随前端下发；防的是「仓库里出现明文」「随手抓取」，**不是**专业逆向 |
| `private` | 作者设的口令 | 输入口令才能打开 | 口令不入库、不上传；31 万次 PBKDF2 |

> 私密书口令丢失后**无法找回** —— 这是加密，不是权限。
> 所有书的正文在 GitHub 上都只是密文；书目索引只有标题、作者、简介、字数这类公开摘要。

---

## 5. 账号与云端

### 5.1 两种登录方式

| 方式 | 通道 | 说明 |
|---|---|---|
| 邮箱账号 | 同源 `/api/auth` | 本站注册；PBKDF2 十万次哈希；令牌存 `localStorage`（`bbn.email.token`），Bearer 调用 |
| 群档案 GitHub | Cookie `github_token` | 复用主站 OAuth 会话（Domain=`.blacknet.cc.cd`，HttpOnly），登录跳转经 `grp?login-next=` 中转 |

未登录也能读书、写稿（存本机），只是不能云同步。顶栏右侧会显示「登录」或头像 + 下拉菜单
（我的书架 / 我的书稿 / 同步书架 / 设置 / 登出）。

### 5.2 我的书架（`/shelf` + `/api/shelf`）

- 本机：`bbn.fav`（收藏）、`bbn.progress.<id>`（进度）、`bbn.shelf`（最近阅读，最多 24 条）
- 账号：`GET/POST /api/shelf`，键 `bshelf:<uid>`，只存 **id / 标题 / 封面 / 进度**，不存正文
- 合并规则：按 id 取 `at` 较新的一份 —— 未登录时收藏的书登录后并进账号，不会丢
- 身份：邮箱 Bearer 令牌，或 Cookie 里的 GitHub 会话（服务端问 `api.github.com/user`）
- 未登录时状态行明确写「只保存在本机浏览器」，并提供「登录后可同步」入口

### 5.3 草稿云同步（secret Gist）

- 一个 secret gist，每本书一个文件 `bbn-book-<id>.json`，进度单独 `bbn-progress.json`；
  只 PATCH 脏文件，删书即删文件
- 冲突按 `updatedAt` 比对：本地新 → 推；云新且本地干净 → 静默拉；云新且本地脏 → 三选弹窗
- 令牌解析顺序：单独填的 Gist 令牌 → 发布 PAT → **群档案登录态换来的令牌**（`/api/token` 读 HttpOnly Cookie）
- 所以用群档案账号登录后，编辑器保存草稿就自动上云，不必再手填令牌

### 5.4 书稿云端（换设备接着写）

Gist 仍是主通道，账号云端是**备份**（不需要用户自己配令牌）：

| 项 | 说明 |
|---|---|
| 存储 | Upstash `bu:<uid>:books`（书目索引）+ `bu:<uid>:b:<id>:<n>`（正文分块，每块 ≤ 12 万字符） |
| 写入 | 编辑器本地保存后节流 30 秒推一次，失败静默；单本超过约 8.6MB 会拒绝并提示改用「备份」导出 |
| 读取 | 打开 `editor?id=` 时**本机没有草稿才会回拉**，回拉后先写 IndexedDB 再进编辑器 |
| 归属 | key 前缀就是 `email:…` / `gh:…` —— 别人的书在物理上读不到，不靠前端判断 |
| 取稿顺序 | 本机 IndexedDB → 账号云端 → 仓库里的 `.book` 密文解密回灌（作品管理页「继续写」按此顺序） |

云端书稿是**明文**存储（与 Gist 同级），适合草稿而不适合当保险箱；正文真正的密文只在仓库里的 `.book`。

---

## 6. 数据源与发布

### 6.1 读

```
① 同源 docs/books/… → ② jsDelivr 三节点并发 → ③ raw.githubusercontent
```

每层都有超时（同源 5s、其余 8s），失败自动降级；并发竞速是为了避开国内单节点整段超时。
`<html data-book-source="site|cdn|raw|none">` 标明当前用的哪一层。
细节见主仓库的 **[CDN.md](https://github.com/Chengxidaxia/GroupBlackNet/blob/main/CDN.md)**。

### 6.2 写

| 通道 | 配置 | 说明 |
|---|---|---|
| `server`（默认优先） | 无 | 浏览器按 ≤2MiB 分片 POST `/api/publish`，服务端持 `BOT_GH_TOKEN` 提交。**任何 GitHub 登录用户都能发**，account 由服务端写入 |
| `github` | `PUBLISH_MODE: 'github'` | 浏览器直连 GitHub Contents API，PAT 只存本机。服务端不可用时自动回退到这里，但**只有仓库协作者能成功**（否则 403） |
| `worker` | `PUBLISH_MODE: 'worker'` + `API_BASE` | 旧的自建 Worker 通道，保留兼容 |
| 手动 | — | 「下载 .bookp」后自行放进 `docs/books/` 并改 `index.json` |

发布流程（两条路，产物格式完全一致，可混用）：

- **服务端代写（默认）**：浏览器 `JSON → gzip → AES-GCM` → 按 ≤2MiB 分片 POST `/api/publish`
  → 服务端逐片 `PUT` → 写清单（原子切换）→ 清旧分片 → 合并 `index.json` → `bustCdn()`。
  用户不需要仓库权限，`account` 由服务端写入。
- **浏览器直连（回退）**：同样的加密与分块，但由浏览器自己 `PUT`，需要本机 PAT 或该仓库写权限。

> 为什么默认走服务端：GitHub Contents API 的写权限只属于仓库协作者。浏览器直连意味着
> 「只有你能发」；要让任何登录用户都能发，只能由服务端持一把有权限的令牌代提交。

---

## 7. 后端接口

| 端点 | 方法 | 作用 | 依赖 |
|---|---|---|---|
| `/api/auth` | POST | 注册 / 登录 / 登出 / 会话 | Upstash Redis |
| `/api/gh` | GET | 群档案登录态（`/me`、`/logout`） | Cookie |
| `/api/imgup` | POST | 图片上传（转发 pixhost） | — |
| `/api/shelf` | GET / POST | 账号书架读写 | Upstash Redis |
| `/api/works` | GET / POST / DELETE | 账号书稿云同步（分块） | Upstash Redis |
| `/api/collections` | POST / DELETE | 作品集发布与删除（写书籍仓库） | GitHub + `BOT_GH_TOKEN` |
| `/api/publish` | POST | 作品发布代写（分片 → 清单 → 索引） | GitHub + `BOT_GH_TOKEN` |
| `/api/content` | GET | 分类与公告（与主站同一份） | `GLOBAL_CONFIG` |
| `/api/token` | GET | 把 Cookie 里的 GitHub 令牌还给本人（`no-store`） | Cookie |

> 没有 Redis 变量时：`/api/auth` 返回 503，书架退回纯本地，其余功能不受影响。
> 图片上传主通道走同源 `/api/imgup`，兜底是 CF `upload.blacknet.cc.cd`（Bearer PAT / Cookie）。

---

## 8. 本地开发

WebCrypto 只在安全上下文可用，**必须用 localhost 或 https 打开**（`file://` 不行）。

```bash
# 在主仓库根
python -m http.server 8123 --directory book

# 或者就在本目录
python -m http.server 8123
```

访问 <http://localhost:8123/>。

| 事项 | 说明 |
|---|---|
| Functions | 本地静态服务器没有 `/api/*`，登录 / 书架 / `/api/token` 会失败并自动降级（不报错、不阻塞阅读） |
| 发布 | 本地发布需要真 PAT（设置里填），或直接用线上的 `/api/token` 拿登录态令牌 |
| 验证渲染 | 本机 Edge 无头 + CDP **真实等待**；`--virtual-time-budget` 会加速定时器把 fetch 抢死，造成「渲染失败」的假象 |
| 测老浏览器 | CDP 注入 `Object.defineProperty(window,'DecompressionStream',{value:undefined})` 即可模拟旧 Safari / 微信内核 |
| 造测试素材 | Node `zlib.deflateRawSync` 手搓 zip / epub（epub 的 `mimetype` 必须 store） |

---

## 9. 部署

生产在 **Vercel**，项目直接连本仓库：

| 项 | 值 |
|---|---|
| Framework Preset | Other |
| Build Command | 无 |
| Output Directory | `.` |
| 配置 | 仓库根 `vercel.json` |

环境变量：

| 变量 | 用途 |
|---|---|
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | 账号、会话、账号书架、书稿云同步 |
| `BOT_GH_TOKEN` | 对书籍仓库有 `contents:write` 的令牌，服务端代写发布用。不配则回退用户令牌，此时只有仓库协作者能发 |
| `GLOBAL_CONFIG` | Global Config 连接串（与 `vercel-proxy` 同一个服务），读作品分类与公告 |
| `BOOKS_REPO` / `BOOKS_BRANCH` / `BOOKS_DIR` / `COLLECTIONS_DIR` | 可选，默认 `Chengxidaxia/BookBlackNet` / `main` / `docs/books` / `docs/collections` |

`vercel.json` 里的关键规则：

- `cleanUrls: true` → 线上是 `/books`、`/shelf`、`/book?id=…`，没有 `.html`
- `/api/*` 各自 rewrite 到同名 Function
- `/proxy/<host>/*` 转发到 `api.github.com`、`raw.githubusercontent.com`、`oauth/upload/img/api.blacknet.cc.cd`
- `/docs/books/*` 强制 `application/octet-stream` + 60 秒缓存，避免被当成 HTML 解析
- `/assets/js/*` 不缓存（改版立刻生效），`/netlify.toml`、`/README.md`、`/vercel.json` 直接 404

Netlify / GitHub Pages 是备用通道：

- Pages：直接切本仓库，根目录已有 `CNAME`（`book.blacknet.cc.cd`），无需额外配置；
- Netlify：配置文件是主仓库里的 `book/netlify.toml`（**不随本仓库同步**），
  用的时候从主仓库取，Base directory 填 `book`、无构建、`publish = "."`。

三种都能跑，但同源最稳的是 Vercel 直连本仓库 —— 发布完刷新即见，不依赖缓存。

---

## 10. 兼容与降级

| 场景 | 处理 |
|---|---|
| 无 `DecompressionStream`（老 Safari <16.4 / 微信内置 / 旧 WebView） | `core/inflate.js` 提供纯 JS inflate + gzip（含多 member），原生优先、缺失或失败回退。**没有它这些设备一本都打不开**（正文是 gzip + AES-GCM） |
| 无 `CompressionStream` | `crypto.pack` 不压缩直接写，`zip` 字段记 `none`，互转仍自洽 |
| 无 IndexedDB | 提示浏览器过旧，不落稿 |
| ≤900px 窄屏 | 汉堡抽屉导航；输入框 16px（避免 iOS 聚焦放大）；`.page` 用 `100dvh` |
| 没有 `/proxy` 转发 | `net.js` 收到 404 自动降级直连，功能不受影响 |
| 本地 / 离线 | 书架、书稿全在本地；云同步静默降级为 `off`，不打扰写作 |

---

## 11. 配置（`assets/js/config.js`）

| 键 | 作用 |
|---|---|
| `REPO_OWNER` / `REPO_NAME` / `BRANCH` | 书籍仓库 |
| `BOOKS_DIR` / `INDEX_FILE` | 书籍与索引路径 |
| `CDN.hosts` / `CDN.base` / `CDN.timeout` / `CDN.siteTimeout` | 数据源节点与超时 |
| `PUBLISH_MODE` / `API_BASE` | 发布通道 |
| `AUTH_URL` / `AUTH_URL_FALLBACK` | 账号服务（同源优先，CF 兜底） |
| `PROXY.mode` / `hosts` / `skipOn` | 同源反代 |
| `SITE_KEY` | 公开书主密钥（**换成自己的随机串**） |
| `SITE_URL` | 正式域名，用于 canonical 与分享链接 |
| `CATEGORIES` | 分类列表 |
| `READER` | 阅读器默认排版 |

---

## 12. 维护脚本（在主仓库 `scripts/`）

| 脚本 | 作用 |
|---|---|
| `sync-book-repo.sh` | 本仓库 ← 主仓库 `book/`。页面覆盖、书籍只补不覆盖、索引合并；`DRY=1` 预演、`FORCE_BOOKS=1` 强推 |
| `book-chunk.mjs` | 单体 `.book` → 清单 + 分块（幂等，`--dry` 预演） |
| `book-index-merge.mjs` | 合并 `index.json`（远端为基底，只补本地独有） |
| `cdn-urls.mjs` | 列 / 探测数据源（含分块），`--check`、`--purge` |

> 同步后**必须**核对远端 SHA：`git -C .workbuddy/tmp/book-repo ls-remote origin main`。
> push 偶发被静默吞掉（exit 0 但远端没变），SHA 变了才算成功。

---

## 13. 已知限制

- 主密钥随前端下发，`public` 书的加密只防「明文入库 + 随手抓取」；
- 邮箱账号的会话存在 Upstash，未配置时只能本机使用；
- **发布与作品集只对 GitHub 账号开放**：邮箱账号能写草稿、存书架，但不能发布（发布要往仓库写文件）；
- 未配置 `BOT_GH_TOKEN` 时发布回退到浏览器直连，此时**只有仓库协作者能成功**（其他账号 403）；
- 云端草稿（`/api/works`）是**明文**存储，与 Gist 同级；作品集也是明文 JSON（只有名称、描述、作品编号，不含正文）；
- `.epub → .bookp` 是启发式解析（container → OPF → spine），复杂排版会丢样式，只保留章节结构与文本；
- 图片走外链（pixhost / img 子域），不随书加密；
- 移动端顶栏的「开始写作」在 ≤900px 收进抽屉，平板用户要多点一次。
