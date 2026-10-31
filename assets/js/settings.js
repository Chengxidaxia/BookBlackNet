/* ============================================================
   settings.js — 设置中心（写作台 / 编辑器 / 阅读页共用）
   B.settings.open(page)
     page = 'editor' | 'shelf' → 显示「编辑器 + 云同步」组
     page = 'reader'           → 显示「阅读 + 云同步」组
   GitHub 令牌（发布 / 校验）始终保留在面板顶部。
   持久化：core/prefs.js（bbn.prefs.v1）。
   ============================================================ */
window.BKN = window.BKN || {};

(function (B) {
  'use strict';

  const { el, toast } = B.util;
  const CFG = window.BOOK || {};
  const prefs = B.prefs;

  function hasToken() { return !!(B.api && B.api.auth.get()); }

  /* ---------------- 控件工厂 ---------------- */
  function switchRow(label, hint, path, after) {
    const box = el('input', { type: 'checkbox', checked: !!prefs.get(path) });
    box.addEventListener('change', () => {
      prefs.set(path, box.checked);
      if (after) after(box.checked);
    });
    return el('div.field',
      el('label.switch', box, el('span.track'), el('span', { text: label })),
      hint ? el('div.hint', { text: hint }) : null
    );
  }

  function selectRow(label, path, options, after) {
    const sel = el('select.select', options.map(o =>
      el('option', { value: o[0], text: o[1] })));
    sel.value = String(prefs.get(path));
    sel.addEventListener('change', () => {
      prefs.set(path, /^\d+$/.test(sel.value) ? +sel.value : sel.value);
      if (after) after(prefs.get(path));
    });
    return el('div.field', el('label.label', { text: label }), sel);
  }

  function numRow(label, path, min, max, step, unit) {
    const input = el('input.input', { type: 'number', min: min, max: max, step: step || 1, value: prefs.get(path) });
    const commit = () => {
      let v = +input.value;
      if (isNaN(v)) v = prefs.get(path);
      v = Math.min(max, Math.max(min, v));
      input.value = v;
      prefs.set(path, v);
    };
    input.addEventListener('change', commit);
    return el('div.field',
      el('label.label', { text: label + '（' + prefs.get(path) + (unit || '') + '）' }), input);
  }

  /* ---------------- 各分组 ---------------- */
  function editorGroup() {
    return [
      el('h4.set-h', { text: '编辑器' }),
      numRow('正文字号', 'editor.fontSize', 12, 24, 1, 'px'),
      selectRow('正文字体', 'editor.fontFamily', [['serif', '衬线（宋）'], ['sans', '无衬线（黑）']]),
      numRow('行距倍数', 'editor.lineHeight', 1.4, 2.6, 0.05),
      selectRow('界面主题', 'editor.uiTheme', [['light', '浅色'], ['sepia', '羊皮纸'], ['night', '夜间']], v => {
        document.body.dataset.uiTheme = v;
      }),
      switchRow('打字机滚动（光标保持屏幕中部）', '', 'editor.typewriter'),
      numRow('撤销栈深度', 'editor.undoLimit', 20, 1000, 20),
      switchRow('删除书稿 / 章节前二次确认', '', 'editor.confirmDelete'),
      switchRow('显示写作统计（今日 / 连续 / 目标）', '', 'editor.showStats'),
      numRow('每日目标字数', 'editor.dailyGoal', 100, 20000, 100)
    ];
  }

  function syncGroup() {
    return [
      el('h4.set-h', { text: '云同步' }),
      switchRow('草稿自动同步到云端（Gist）',
        '需要「云同步令牌」；关闭后仅手动同步。', 'sync.autoGist'),
      numRow('自动同步延迟', 'sync.gistDelaySec', 3, 60, 1, ' 秒'),
      switchRow('阅读进度云同步', '在同一 Gist 里同步每本书读到哪了。', 'sync.progressSync'),
      el('div.hint', { text: '令牌在下方「GitHub 访问令牌」填写；classic token 需勾选 gist 权限，fine-grained token 不支持 Gist。' })
    ];
  }

  function readerGroup() {
    return [
      el('h4.set-h', { text: '阅读' }),
      numRow('正文字号', 'reader.fontSize', 14, 28, 1, 'px'),
      numRow('行距倍数', 'reader.lineHeight', 1.4, 2.8, 0.05),
      numRow('版心宽度', 'reader.width', 560, 1000, 20, 'px'),
      selectRow('正文字体', 'reader.font', [['serif', '衬线（宋）'], ['sans', '无衬线（黑）']]),
      selectRow('阅读主题', 'reader.theme', [['paper', '纸白'], ['sepia', '羊皮纸'], ['green', '护眼绿'], ['night', '夜间']]),
      switchRow('段落首行缩进', '', 'reader.indent'),
      switchRow('点击屏幕左右侧翻页', '', 'reader.clickTurn'),
      switchRow('向下滚动时自动隐藏顶栏', '', 'reader.autoHideBar'),
      switchRow('阅读进度云同步', '', 'sync.progressSync'),
      switchRow('自动在章首放置书签', '', 'reader.autoBookmark')
    ];
  }

  function tokenSection() {
    const tokenInput = el('input.input', { type: 'password', placeholder: hasToken() ? '已保存，输入新值可覆盖' : 'ghp_… 或 github_pat_…' });
    const gistInput = el('input.input', { type: 'password', placeholder: B.gist && B.gist.token() ? '已保存（留空沿用发布令牌）' : '留空则使用上方发布令牌' });
    const modeSel = el('select.select',
      el('option', { value: 'github', text: 'GitHub 令牌（浏览器直连）' }),
      CFG.API_BASE ? el('option', { value: 'worker', text: '自建后端（Worker）' }) : null
    );
    modeSel.value = B.api.auth.mode();
    const status = el('div.pub-status', el('span.dot'), el('span', { text: '未校验' }));

    return el('div.stack.gap-12',
      el('h4.set-h', { text: '发布 / 云同步令牌' }),
      el('div.field', el('label.label', { text: '发布通道' }), modeSel),
      el('div.field', el('label.label', { text: 'GitHub 访问令牌（发布）' }), tokenInput,
        el('div.hint', { text: 'Fine-grained token 需 Contents: Read and write；classic token 需 repo。只存本机。' })),
      el('div.field', el('label.label', { text: '云同步令牌（Gist，可选）' }), gistInput,
        el('div.hint', { text: 'classic token 需勾选 gist 权限；fine-grained token 不支持 Gist。留空使用发布令牌。' })),
      el('div.row.gap-8',
        el('button.btn.btn-sm', { text: '校验令牌', on: { click: async () => {
          const t = tokenInput.value.trim();
          if (t) B.api.auth.set(t);
          const gt = gistInput.value.trim();
          if (gt && B.gist) B.gist.setToken(gt);
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
        } } }),
        el('button.btn.btn-sm', { text: '清除令牌', on: { click: () => {
          B.api.auth.clear();
          if (B.gist) B.gist.clearToken();
          tokenInput.value = ''; gistInput.value = '';
          toast('已清除令牌', 'ok');
        } } })
      ),
      status
    );
  }

  /* ---------------- 主面板 ---------------- */
  function open(page) {
    const groups = [];
    if (page === 'reader') {
      groups.push(readerGroup(), syncGroup());
    } else {
      groups.push(editorGroup(), syncGroup());
    }
    if (B.api) groups.push(tokenSection());

    const body = el('div.stack.gap-14');
    groups.forEach(g => { const sec = el('div.set-group'); g.forEach(n => sec.appendChild(n)); body.appendChild(sec); });

    B.ui.dialog({ title: '设置', body: body, actions: [{ label: '完成', cls: 'primary', onClick: ({ close }) => close() }] });
  }

  B.settings = { open };
})(window.BKN);
