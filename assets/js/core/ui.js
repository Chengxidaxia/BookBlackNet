/* ============================================================
   ui.js — 公共弹窗组件（写作台 / 编辑器共用）
   依赖：core/util.js（BKN.util.el）
   约定：全站不用 alert / prompt，一切走这里。
   ============================================================ */
window.BKN = window.BKN || {};

(function (B) {
  'use strict';

  const { el } = B.util;

  /**
   * dialog({ title, body, actions:[{label, cls, onClick({close, btn})}] })
   * 返回 { close, box, body }
   */
  function dialog(opt) {
    const host = el('div.modal-host');
    const close = () => { host.remove(); document.removeEventListener('keydown', onKey); };
    function onKey(e) { if (e.key === 'Escape') close(); }

    const x = el('button.modal-x', {
      html: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg>',
      title: '关闭',
      on: { click: close }
    });

    const head = el('div.modal-head', el('h3.modal-title', { text: opt.title || '' }), x);
    const body = el('div.modal-body');
    if (opt.body) body.appendChild(opt.body);
    const box = el('div.modal', head, body);

    if (opt.actions && opt.actions.length) {
      const foot = el('div.modal-foot');
      opt.actions.forEach(a => {
        // cls 里的 primary / danger 是语义记号，要映射成真正的类名 .btn-primary / .btn-danger
        // （CSS 里没有 .btn.primary，直接拼会得到毫无样式的白按钮）
        const cls = String(a.cls || '').trim().split(/\s+/).filter(Boolean)
          .map(t => (t === 'primary' ? 'btn-primary' : t === 'danger' ? 'btn-danger' : t))
          .join('.');
        const b = el('button.btn' + (cls ? '.' + cls : ''), a.html ? { html: a.html } : { text: a.label });
        b.addEventListener('click', () => a.onClick && a.onClick({ close, btn: b }));
        foot.appendChild(b);
      });
      box.appendChild(foot);
    }

    host.appendChild(box);
    host.addEventListener('mousedown', e => { if (e.target === host) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(host);
    setTimeout(() => { const f = box.querySelector('input,textarea,button.btn-primary'); if (f) f.focus(); }, 40);
    return { close, box, body };
  }

  /** confirmBox(title, text, okLabel, onOk) */
  function confirmBox(title, text, okLabel, onOk) {
    dialog({
      title: title,
      body: el('p.muted.small', { text: text, style: { lineHeight: '1.7', margin: '0 0 4px' } }),
      actions: [
        { label: '取消', onClick: ({ close }) => close() },
        { label: okLabel || '确定', cls: 'danger', onClick: ({ close }) => { close(); onOk(); } }
      ]
    });
  }

  /**
   * promptDialog(title, label, opt, onOk)
   * opt: { value, placeholder, type, hint, okLabel, validate }
   * 确定时把输入值传给 onOk(value, close)；validate 返回字符串 = 错误提示。
   */
  function promptDialog(title, label, opt, onOk) {
    opt = opt || {};
    const input = el('input.input', {
      type: opt.type || 'text',
      value: opt.value || '',
      placeholder: opt.placeholder || ''
    });
    const kids = [el('div.field', el('label.label', { text: label || '' }), input)];
    if (opt.hint) kids.push(el('div.hint', { text: opt.hint }));
    dialog({
      title: title,
      body: el('div.stack.gap-10', kids),
      actions: [
        { label: '取消', onClick: ({ close }) => close() },
        {
          label: opt.okLabel || '确定', cls: 'primary',
          onClick: ({ close }) => {
            const v = input.value.trim();
            if (opt.validate) {
              const err = opt.validate(v);
              if (err) { B.util.toast(err, 'err'); input.focus(); return; }
            }
            onOk(v, close);
          }
        }
      ]
    });
  }

  /**
   * multiSelect({ options, value, placeholder, max, onChange })
   * 下拉多选框（复选）：按钮显示已选项，点开是复选框面板。
   * 返回 { node, get(), set(arr), destroy() }
   *   · value 是字符串数组；
   *   · 面板挂到 body 并用 fixed 定位，避免被 .modal 的 overflow:auto 裁掉；
   *   · max > 0 时到达上限后未选项置灰。
   */
  function multiSelect(opt) {
    opt = opt || {};
    const options = (opt.options || []).slice();
    const max = +opt.max || 0;
    const ph = opt.placeholder || '未选择';
    let val = [];
    let open = false;
    let pop = null;

    const txt = el('span.msel-val');
    const caret = el('span.msel-caret', {
      html: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>'
    });
    const btn = el('button.msel-btn', { type: 'button', 'aria-haspopup': 'listbox', 'aria-expanded': 'false' }, txt, caret);
    const node = el('div.msel', btn);

    function set(arr) {
      val = (Array.isArray(arr) ? arr : []).map(v => String(v == null ? '' : v).trim())
        .filter((v, i, a) => v && a.indexOf(v) === i);
      paint();
    }
    function get() { return val.slice(); }

    function paint() {
      txt.textContent = val.length ? val.join('、') : ph;
      txt.classList.toggle('is-empty', !val.length);
      if (pop) {
        pop.querySelectorAll('.msel-opt').forEach(row => {
          const on = val.indexOf(row.dataset.v) >= 0;
          row.querySelector('input').checked = on;
          row.classList.toggle('on', on);
          const dis = max > 0 && !on && val.length >= max;
          row.classList.toggle('is-dis', dis);
          row.querySelector('input').disabled = dis;
        });
        const c = pop.querySelector('.msel-count');
        if (c) c.textContent = '已选 ' + val.length + (max ? ' / ' + max : '') + ' 项';
      }
      if (opt.onChange) opt.onChange(get());
    }

    function toggle(v) {
      const i = val.indexOf(v);
      if (i >= 0) val.splice(i, 1);
      else {
        if (max > 0 && val.length >= max) { B.util.toast('最多选择 ' + max + ' 个大标签', 'err'); return; }
        val.push(v);
      }
      paint();
    }

    function place() {
      if (!pop) return;
      const r = btn.getBoundingClientRect();
      const w = Math.max(r.width, 208);
      let below = window.innerHeight - r.bottom - 16;
      let above = r.top - 16;
      const flip = below < 200 && above > below;
      const avail = flip ? above : below;
      pop.style.width = w + 'px';
      pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
      pop.style.top = flip ? '' : (r.bottom + 6) + 'px';
      pop.style.bottom = flip ? (window.innerHeight - r.top + 6) + 'px' : '';
      const list = pop.querySelector('.msel-list');
      if (list) list.style.maxHeight = Math.max(96, Math.min(340, avail - 52)) + 'px';
    }

    function onDocDown(e) {
      if (pop && !pop.contains(e.target) && !node.contains(e.target)) close();
    }
    function onKey(e) {
      if (e.key === 'Escape' && open) { e.stopPropagation(); close(); }
    }
    function onWin() { if (open) place(); }

    function build() {
      const list = el('div.msel-list');
      options.forEach(v => {
        const cb = el('input', { type: 'checkbox' });
        const row = el('label.msel-opt', { data: { v: v }, title: v }, cb, el('span', { text: v }));
        row.addEventListener('click', e => {
          e.preventDefault();
          if (cb.disabled) return;
          toggle(v);
        });
        list.appendChild(row);
      });
      const count = el('span.msel-count', { text: '已选 0 项' });
      const clear = el('button.msel-clear', { type: 'button', text: '清空', on: { click: () => { val = []; paint(); } } });
      const done = el('button.msel-done', { type: 'button', text: '完成', on: { click: () => close() } });
      const foot = el('div.msel-foot', count, el('span.msel-foot-btns', clear, done));
      return el('div.msel-pop', { role: 'listbox' }, list, foot);
    }

    function show() {
      if (open) return;
      pop = null;
      pop = build();
      document.body.appendChild(pop);
      open = true;
      btn.setAttribute('aria-expanded', 'true');
      node.classList.add('is-open');
      paint();
      place();
      document.addEventListener('mousedown', onDocDown, true);
      document.addEventListener('keydown', onKey, true);
      window.addEventListener('resize', onWin);
      window.addEventListener('scroll', onWin, true);
      const first = pop.querySelector('input');
      if (first) first.focus({ preventScroll: true });
    }

    function close() {
      if (!open) return;
      open = false;
      btn.setAttribute('aria-expanded', 'false');
      node.classList.remove('is-open');
      document.removeEventListener('mousedown', onDocDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onWin);
      window.removeEventListener('scroll', onWin, true);
      if (pop) { pop.remove(); pop = null; }
    }

    btn.addEventListener('click', e => { e.preventDefault(); open ? close() : show(); });
    set(opt.value || []);

    return {
      node, get, set,
      close,
      destroy() { close(); node.remove(); }
    };
  }

  B.ui = { dialog, confirmBox, promptDialog, multiSelect };
})(window.BKN);
