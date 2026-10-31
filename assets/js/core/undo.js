/* ============================================================
   undo.js — textarea 撤销 / 重做栈
   背景：document.execCommand('undo') 对普通 textarea 无效，
        Chrome 也不保证原生撤销与 JS 改值（ta.value=…）兼容。
        这里自实现：快照栈 + 输入合并 + IME 保护。
   用法：
     const u = BKN.undo.attach(ta, { limit: 200, onChange: fn });
     u.push(true)          // 工具栏改值后强制入栈（不合并）
     u.undo() / u.redo()
     u.canUndo() / u.canRedo() / u.clear()
   ============================================================ */
window.BKN = window.BKN || {};

(function (B) {
  'use strict';

  function attach(ta, opt) {
    opt = opt || {};
    const limit = opt.limit || 200;
    const mergeMs = opt.mergeMs || 450;
    const onChange = opt.onChange || function () {};
    let states = [];          // { v, s, e }
    let idx = -1;
    let lastPush = 0;
    let applying = false;     // apply 自身触发 input 时不入栈
    let composing = false;    // IME 拼音中间态不入栈

    ta.addEventListener('compositionstart', () => { composing = true; });
    ta.addEventListener('compositionend', () => {
      composing = false;
      capture(false);
    });

    function capture(force) {
      if (applying || composing) return;
      const now = Date.now();
      const snap = { v: ta.value, s: ta.selectionStart, e: ta.selectionEnd };
      const top = states[idx];
      if (top && top.v === snap.v) { top.s = snap.s; top.e = snap.e; return; }
      if (!force && now - lastPush < mergeMs && idx >= 0) {
        // 连续输入合并成一个快照
        states[idx] = snap;
      } else {
        states = states.slice(0, idx + 1);
        states.push(snap);
        if (states.length > limit) states = states.slice(states.length - limit);
        idx = states.length - 1;
      }
      lastPush = now;
    }

    ta.addEventListener('input', () => capture(false));
    ta.addEventListener('select', () => {
      if (states[idx]) { states[idx].s = ta.selectionStart; states[idx].e = ta.selectionEnd; }
    });

    function apply(snap) {
      applying = true;
      const selChanged = ta.value !== snap.v;
      ta.value = snap.v;
      try { ta.setSelectionRange(snap.s, snap.e); } catch (e) {}
      applying = false;
      if (selChanged || opt.onChangeAlways) onChange(snap);
    }

    function push(force) { capture(force !== false); }

    function undo() {
      if (idx <= 0) return false;
      // 先把当前未入栈的输入收进来，保证不丢
      if (states[idx] && states[idx].v !== ta.value) { states[idx] = { v: ta.value, s: ta.selectionStart, e: ta.selectionEnd }; }
      idx--;
      apply(states[idx]);
      return true;
    }

    function redo() {
      if (idx >= states.length - 1) return false;
      idx++;
      apply(states[idx]);
      return true;
    }

    const canUndo = () => idx > 0 || (idx === 0 && states[0] && states[0].v !== ta.value);
    const canRedo = () => idx < states.length - 1;

    function clear() {
      states = [{ v: ta.value, s: ta.selectionStart, e: ta.selectionEnd }];
      idx = 0;
    }

    // 初始快照
    clear();

    return { push, undo, redo, canUndo, canRedo, clear };
  }

  B.undo = { attach: attach };
})(window.BKN);
