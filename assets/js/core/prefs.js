/* ============================================================
   prefs.js — 偏好设置中心（localStorage 单键）
   键：bbn.prefs.v1 = { 编辑器组…, 阅读组… }
   API：
     prefs.get(path, dft)   点号路径，回退默认值
     prefs.set(path, val)   写入并触发 onChange
     prefs.defaults         默认值表
     prefs.onChange(fn)     任何变更回调 (path, val)
     prefs.applyEditor()    把编辑器组刷到页面（编辑器页调用）
   ============================================================ */
window.BKN = window.BKN || {};

(function (B) {
  'use strict';

  const KEY = 'bbn.prefs.v1';
  const OLD_READER_KEY = 'bbn.reader';

  const defaults = {
    /* ---- 编辑器 ---- */
    'editor.autosaveMs': 700,
    'editor.fontSize': 17,        // 12–24
    'editor.fontFamily': 'serif', // serif | sans | mono | shserif（见 FONT_STACK）
    'editor.lineHeight': 1.95,
    'editor.uiTheme': 'light',    // light | sepia | night
    'editor.typewriter': false,
    'editor.undoLimit': 200,
    'editor.confirmDelete': true,
    'editor.showStats': true,
    'editor.dailyGoal': 1000,
    /* ---- 云同步 ---- */
    'sync.autoGist': true,
    'sync.gistDelaySec': 8,
    'sync.progressSync': true,
    /* ---- 阅读 ---- */
    'reader.fontSize': 19,
    'reader.lineHeight': 1.95,
    'reader.width': 720,
    'reader.font': 'serif',
    'reader.theme': 'paper',      // paper | sepia | green | night
    'reader.indent': true,
    'reader.clickTurn': false,
    'reader.autoHideBar': true,
    'reader.syncProgress': true,
    'reader.autoBookmark': false
  };

  let cache = null;
  const listeners = [];

  function load() {
    if (cache) return cache;
    try { cache = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; }
    catch (e) { cache = {}; }
    migrate();
    return cache;
  }

  /* 旧版阅读偏好（bbn.reader）一次性迁入 */
  function migrate() {
    let moved = false;
    try {
      const old = JSON.parse(localStorage.getItem(OLD_READER_KEY) || 'null');
      if (old && typeof old === 'object') {
        ['fontSize', 'lineHeight', 'width', 'font', 'theme'].forEach(k => {
          if (old[k] !== undefined && cache['reader.' + k] === undefined) cache['reader.' + k] = old[k];
        });
        localStorage.removeItem(OLD_READER_KEY);
        moved = true;
      }
    } catch (e) {}
    // 清掉更旧的散键
    ['editor.fontSize', 'editor.lineHeight'].forEach(() => {});
    if (moved) persist();
  }

  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch (e) {}
  }

  function get(path, dft) {
    const c = load();
    if (Object.prototype.hasOwnProperty.call(c, path)) {
      const v = c[path];
      if (v !== null && v !== undefined) return v;
    }
    return (dft !== undefined) ? dft : defaults[path];
  }

  function set(path, val) {
    load();
    if (cache[path] === val) return val;
    cache[path] = val;
    persist();
    listeners.forEach(fn => { try { fn(path, val); } catch (e) {} });
    return val;
  }

  const onChange = fn => listeners.push(fn);

  /* ---------------- 字体档位 ----------------
     全部是「字体栈」，不加载任何 webfont：
       serif   宋（系统宋体链，苹方设备上是 Songti SC）
       sans    黑（系统无衬线链）
       mono    等宽（只作用于西文/数字，中文回退系统字体）
       shserif 思源宋（先试思源各命名，装了的设备才生效）
     值统一写成 CSS 变量引用，改一处栈就能全站生效（见 base.css）。 */
  const FONT_STACK = {
    serif: 'var(--serif)',
    sans: 'var(--sans)',
    mono: 'var(--mono)',
    shserif: 'var(--serif-sh)'
  };
  function stackOf(fam) { return FONT_STACK[fam] || FONT_STACK.serif; }

  /* ---------------- 编辑器组应用到页面 ---------------- */
  /* 注意：Vditor 启用后正文由 .vditor-reset 渲染，老 textarea（#ed-text）只是
     一条隐藏的数据通道 —— 只改它的内联样式等于没改。所以这里同时把三项写进
     根级 CSS 变量，write.css 里 .vd-host .vditor-reset 直接吃这些变量。 */
  function applyEditor() {
    const size = get('editor.fontSize', 17);
    const lh = get('editor.lineHeight', 1.95);
    const fam = get('editor.fontFamily', 'serif');
    const ff = stackOf(fam);
    const root = document.documentElement;
    root.style.setProperty('--ed-fs', size + 'px');
    root.style.setProperty('--ed-lh', String(lh));
    root.style.setProperty('--ed-ff', ff);

    const ta = document.getElementById('ed-text');
    if (ta) {
      ta.style.fontSize = size + 'px';
      ta.style.lineHeight = lh;
      ta.style.fontFamily = ff;
    }
    const ct = document.getElementById('ch-title');
    if (ct) ct.style.fontFamily = ff;
    document.body.dataset.uiTheme = get('editor.uiTheme', 'light');
  }

  B.prefs = { get, set, onChange, applyEditor, defaults, stackOf, FONT_STACK,
              all: () => JSON.parse(JSON.stringify(load())) };
})(window.BKN);
