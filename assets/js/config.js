/* ============================================================
   config.js — BookBlackNet 站点配置
   部署时只改这一个文件即可（仓库、后端、站点密钥）。
   ============================================================ */
window.BOOK = {
  /* ---- 站点 ---- */
  SITE_NAME: 'BookBlackNet',
  SITE_TITLE: '群书阁',
  SITE_DESC: '长篇小说的写作与阅读空间：书架、连载、私密书稿。',
  HOME: 'index.html',

  /* ---- 书籍仓库（.book 文件所在仓库） ---- */
  REPO_OWNER: 'Chengxidaxia',
  REPO_NAME:  'BookBlackNet',
  BRANCH:     'main',
  BOOKS_DIR:  'docs/books',            // 相对仓库根目录
  INDEX_FILE: 'docs/books/index.json', // 书目索引

  /* ---- 书籍数据源（.book / index.json 的读取顺序） ----
     site（本站同源） → cdn（jsDelivr） → raw（raw.githubusercontent）
     · 站点与书籍在同一个仓库时，同源最稳最快，CDN 只作备份；
     · 站点仓库与书籍仓库分开时（书籍在 BookBlackNet 仓库），
       同源会 404，自动落到 jsDelivr，再由 raw 兜底。
     版本戳默认按 3 分钟分桶，能吃到 CDN 缓存；发布成功后站点会
     主动换戳（bustCdn），保证立刻看到新版本。 */
  CDN: {
    enabled: true,
    hosts: [
      'cdn.jsdelivr.net',
      'fastly.jsdelivr.net',
      'gcore.jsdelivr.net'
    ],
    // 自定义基地址（自建反代 / Netlify 子域等）。填了就只用它，忽略 hosts。
    // 例：'https://book.blacknet.cc.cd'
    base: '',
    timeout: 8000,                      // CDN / raw 单个源超时（毫秒）
    siteTimeout: 5000                   // 同源超时（毫秒），改版后立刻见新
  },

  /* ---- 发布通道 ----
     'github' : 浏览器直接用个人访问令牌（PAT）调 GitHub Contents API
                —— 无需任何后端，令牌只存在本机 localStorage；
     'worker' : 走你自己的 Cloudflare Worker（约定 POST /publish），
                令牌留在服务端。后端部署在 CF，不在本仓库。 */
  PUBLISH_MODE: 'github',

  /* ---- 自建后端（PUBLISH_MODE='worker' 时使用；仅调用，不含实现） ---- */
  API_BASE:   '',        // 例：https://book.blacknet.cc.cd
  OAUTH_BASE: '',        // 例：https://oauth.blacknet.cc.cd（可选，用于显示登录态）

  /* ---- 同源反代（前端使用，后端零改动）----
     浏览器直连 api.github.com / raw.githubusercontent.com 在部分网络下不可达，
     或站点自身没有可用出口时，可改走站点同源路径，由 netlify.toml 转发：
         https://api.github.com/repos/...  →  /proxy/api.github.com/repos/...
     同源请求浏览器不做 CORS 校验、不发预检，GitHub 侧也不需要任何配置。

     mode : 'auto'   先试反代，站点没配就自动改直连（默认）
            'always' 只走反代（便于排查）
            'off'    完全直连
     hosts: 允许走反代的地址。只列只读/令牌接口，不要加需要 Cookie 的域。 */
  PROXY: {
    mode: 'auto',
    base: '/proxy',
    hosts: [
      'api.github.com',               // 书目索引、书籍读写、令牌校验
      'raw.githubusercontent.com'     // 读取兜底（同源与 CDN 都失败时）
    ]
  },

  /* ---- 站点主密钥 ----
     用于「公开书」的自动解密：读者无需输入口令。
     注意：静态站的主密钥必然随前端下发，它防的是
     「仓库里出现明文正文 / 随手抓取」，不是密码学级别的保密。
     需要真正私密的书，请把书籍可见性设为「私密」，用作者口令加密。 */
  SITE_KEY: 'bbn-site-4f2c9a71d8e35b60a4c7e29f1d6b83ac',

  /* ---- 分类 ---- */
  CATEGORIES: ['玄幻', '仙侠', '都市', '历史', '科幻', '悬疑', '言情', '游戏', '其他'],

  /* ---- 阅读器默认值 ---- */
  READER: {
    fontSize: 19,
    lineHeight: 1.95,
    width: 720,
    theme: 'paper',      // paper | sepia | night
    font: 'serif'        // serif | sans
  }
};
