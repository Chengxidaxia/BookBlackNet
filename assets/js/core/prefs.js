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
    'editor.fontFamily': 'serif', // serif | sans
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

  /* ---------------- 编辑器组应用到页面 ---------------- */
  function applyEditor() {
    const size = get('editor.fontSize', 17);
    const lh = get('editor.lineHeight', 1.95);
    const fam = get('editor.fontFamily', 'serif');
    const ta = document.getElementById('ed-text');
    if (ta) {
      ta.style.fontSize = size + 'px';
      ta.style.lineHeight = lh;
      ta.style.fontFamily = fam === 'sans' ? 'var(--sans)' : 'var(--serif)';
    }
    const ct = document.getElementById('ch-title');
    if (ct) ct.style.fontFamily = fam === 'sans' ? 'var(--sans)' : 'var(--serif)';
    document.body.dataset.uiTheme = get('editor.uiTheme', 'light');
  }

  B.prefs = { get, set, onChange, applyEditor, defaults,
              all: () => JSON.parse(JSON.stringify(load())) };
})(window.BKN);
