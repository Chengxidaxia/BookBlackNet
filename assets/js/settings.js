/* ============================================================
   settings.js — 设置中心（写作台 / 编辑器共用）
   阶段 3 会扩展为完整设置面板（编辑器 / 云同步 / 阅读分组）。
   ============================================================ */
window.BKN = window.BKN || {};

(function (B) {
  'use strict';

  const { el, toast } = B.util;
  const CFG = window.BOOK || {};

  function hasToken() { return !!B.api.auth.get(); }

  function open() {
    const tokenInput = el('input.input', { type: 'password', placeholder: hasToken() ? '已保存，输入新值可覆盖' : 'ghp_… 或 github_pat_…' });
    const modeSel = el('select.select',
      el('option', { value: 'github', text: 'GitHub 令牌（浏览器直连）' }),
      CFG.API_BASE ? el('option', { value: 'worker', text: '自建后端（Worker）' }) : null
    );
    modeSel.value = B.api.auth.mode();

    const status = el('div.pub-status', el('span.dot'), el('span', { text: '未校验' }));

    const body = el('div.stack.gap-14',
      el('div.field', el('label.label', { text: '发布通道' }), modeSel),
      el('div.field', el('label.label', { text: 'GitHub 访问令牌' }), tokenInput,
        el('div.hint', { text: 'Fine-grained token 需勾选 Contents: Read and write；只存本机浏览器，不会上传。' })),
      el('div.row.gap-8',
        el('button.btn.btn-sm', {
          text: '校验令牌',
          on: { click: async () => {
            const t = tokenInput.value.trim();
            if (t) B.api.auth.set(t);
            status.className = 'pub-status';
            status.lastChild.textContent = '校验中…';
            try {
              const r = await B.api.checkToken();
              status.className = 'pub-status ok';
              status.lastChild.textContent = '已连接 ' + r.user + ' · ' + r.repo + (r.private ? '（私有）' : '（公开）') + (r.push ? ' · 可写入' : ' · 只读，无法发布');
            } catch (err) {
              status.className = 'pub-status err';
              status.lastChild.textContent = err.message;
            }
          } }
        }),
        el('button.btn.btn-sm', {
          text: '清除令牌',
          on: { click: () => { B.api.auth.clear(); tokenInput.value = ''; toast('已清除令牌', 'ok'); } }
        })
      ),
      status,
      el('hr'),
      el('div.small.muted', { style: { lineHeight: '1.7' } },
        '站点密钥（内置，用于公开书自动解密）：',
        el('code', { text: String(CFG.SITE_KEY || '').slice(0, 10) + '…' })
      )
    );

    B.ui.dialog({ title: '设置', body: body, actions: [{ label: '完成', cls: 'primary', onClick: ({ close }) => {
      const t = tokenInput.value.trim();
      if (t) B.api.auth.set(t);
      B.api.auth.setMode(modeSel.value);
      close();
    } }] });
  }

  B.settings = { open };
})(window.BKN);
