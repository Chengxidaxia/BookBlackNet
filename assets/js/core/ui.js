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
        const b = el('button.btn' + (a.cls ? '.' + a.cls.replace(/\s+/g, '.') : ''), { text: a.label });
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

  B.ui = { dialog, confirmBox, promptDialog };
})(window.BKN);
