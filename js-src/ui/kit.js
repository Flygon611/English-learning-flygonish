// UI 组件工具箱：所有界面元素都从这里拼装，保证外观一致。

import { h, icon } from '../util.js';
import { MAX_STAR } from '../srs.js';

/* ---------------- 按钮 ---------------- */

/**
 * @param {{label:string, iconName?:string, kind?:string, size?:string, onclick?:Function,
 *          dataset?:object, disabled?:boolean, title?:string}} o
 */
export function btn({ label, iconName, kind = '', size = '', onclick, dataset, disabled = false, title }) {
  return h('button', {
    class: `btn ${kind} ${size}`.trim(),
    dataset: dataset || {},
    disabled,
    title,
    onclick,
  }, [iconName ? icon(iconName) : null, label ? h('span', { text: label }) : null]);
}

/** 顶部「返回」按钮。 */
export function backBtn(app, to = 'home', label = '返回') {
  return btn({
    label, iconName: 'back', size: 'sm', kind: 'ghost',
    onclick: () => app.go(to),
  });
}

/* ---------------- 面板 / 卡片 ---------------- */

export function panel(children, cls = '') {
  return h('section', { class: `panel ${cls}`.trim() }, [].concat(children));
}

export function sectionTitle(text, right = null) {
  return h('div', { class: 'sec-title' }, [
    h('h2', { text }),
    right || null,
  ]);
}

/* ---------------- 进度 / 星级 ---------------- */

export function progressBar(value, max, { cls = '', showText = false } = {}) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return h('div', { class: `pbar ${cls}`.trim() }, [
    h('i', { style: { width: (pct * 100).toFixed(1) + '%' } }),
    showText ? h('span', { class: 'pbar-text', text: `${Math.round(pct * 100)}%` }) : null,
  ]);
}

/** 星级显示（用 Kenney 星星图标）。 */
export function stars(n, { max = MAX_STAR, small = false } = {}) {
  const out = h('span', { class: `stars ${small ? 'sm' : ''}`.trim() });
  for (let i = 0; i < max; i++) {
    out.append(icon(i < n ? 'star' : 'starEmpty', small ? 'ico xs' : 'ico sm'));
  }
  return out;
}

/** 生命值心形。 */
export function hearts(left, max = 3) {
  const out = h('span', { class: 'hearts' });
  for (let i = 0; i < max; i++) out.append(icon(i < left ? 'heart' : 'heartEmpty', 'ico sm'));
  return out;
}

/* ---------------- 芯片 / 字母选择 ---------------- */

export function chip(label, { active = false, dataset = {}, onclick, count, iconName } = {}) {
  return h('button', {
    class: `chip-btn ${active ? 'active' : ''}`.trim(),
    dataset,
    onclick,
    type: 'button',
  }, [
    iconName ? icon(iconName, 'ico xs') : null,
    h('span', { class: 'cb-label', text: label }),
    count != null ? h('b', { class: 'cb-count', text: String(count) }) : null,
  ]);
}

/* ---------------- 表单控件 ---------------- */

export function segmented(options, value, onPick) {
  return h('div', { class: 'segmented' }, options.map((o) =>
    h('button', {
      type: 'button',
      class: `seg ${o.value === value ? 'active' : ''}`.trim(),
      onclick: () => onPick(o.value),
      title: o.title,
    }, [o.iconName ? icon(o.iconName, 'ico xs') : null, h('span', { text: o.label })])));
}

export function toggleRow(label, desc, value, onChange, iconName) {
  return h('div', { class: 'row toggle-row' }, [
    h('div', { class: 'row-main' }, [
      h('div', { class: 'row-label' }, [iconName ? icon(iconName, 'ico sm') : null, h('span', { text: label })]),
      desc ? h('div', { class: 'row-desc', text: desc }) : null,
    ]),
    h('button', {
      type: 'button',
      class: `switch ${value ? 'on' : ''}`.trim(),
      role: 'switch',
      'aria-checked': value ? 'true' : 'false',
      onclick: () => onChange(!value),
    }, [h('i')]),
  ]);
}

export function stepper(label, value, onChange, { min = 1, max = 50, step = 1, desc, iconName } = {}) {
  const valEl = h('b', { class: 'stepper-val', text: String(value) });
  const set = (v) => {
    const nv = Math.max(min, Math.min(max, v));
    valEl.textContent = String(nv);
    onChange(nv);
  };
  return h('div', { class: 'row toggle-row' }, [
    h('div', { class: 'row-main' }, [
      h('div', { class: 'row-label' }, [iconName ? icon(iconName, 'ico sm') : null, h('span', { text: label })]),
      desc ? h('div', { class: 'row-desc', text: desc }) : null,
    ]),
    h('div', { class: 'stepper' }, [
      h('button', { type: 'button', class: 'st-btn', text: '−', onclick: () => set(Number(valEl.textContent) - step) }),
      valEl,
      h('button', { type: 'button', class: 'st-btn', text: '+', onclick: () => set(Number(valEl.textContent) + step) }),
    ]),
  ]);
}

export function selectRow(label, value, options, onChange, { desc, iconName } = {}) {
  const sel = h('select', { class: 'select', onchange: (e) => onChange(e.target.value) },
    options.map((o) => h('option', { value: o.value, selected: o.value === value, text: o.label })));
  return h('div', { class: 'row toggle-row' }, [
    h('div', { class: 'row-main' }, [
      h('div', { class: 'row-label' }, [iconName ? icon(iconName, 'ico sm') : null, h('span', { text: label })]),
      desc ? h('div', { class: 'row-desc', text: desc }) : null,
    ]),
    sel,
  ]);
}

/* ---------------- 数据展示 ---------------- */

export function statBox(label, value, { iconName, kind = '' } = {}) {
  return h('div', { class: `stat ${kind}`.trim() }, [
    iconName ? icon(iconName) : null,
    h('b', { class: 'stat-val', text: String(value) }),
    h('span', { class: 'stat-lbl', text: label }),
  ]);
}

export function kv(label, value) {
  return h('div', { class: 'kv' }, [
    h('span', { class: 'kv-k', text: label }),
    h('b', { class: 'kv-v', text: String(value) }),
  ]);
}

export function empty(text, iconName = 'info') {
  return h('div', { class: 'empty' }, [icon(iconName), h('p', { text })]);
}

/* ---------------- 特效 ---------------- */

/** 在容器上弹出飘字（+10 之类）。 */
export function floatText(host, text, kind = 'good') {
  if (!host) return;
  const el = h('div', { class: `float ${kind}`, text });
  host.append(el);
  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(() => el.remove(), 1100);
}

/** 全屏庆祝（升级 / 通关）。 */
export function celebrate(text, sub = '') {
  const layer = document.getElementById('toast-layer');
  if (!layer) return;
  const el = h('div', { class: 'celebrate' }, [
    h('div', { class: 'celebrate-card' }, [
      icon('trophy', 'ico big'),
      h('div', { class: 'celebrate-text', text }),
      sub ? h('div', { class: 'celebrate-sub', text: sub }) : null,
    ]),
  ]);
  // 彩色泡泡：颜色做在泡泡的高光上，动画由 .confetti 的 aero-confetti 负责
  const hues = ['#ffd166', '#ef476f', '#06d6a0', '#118ab2', '#f78c6b', '#a78bfa'];
  for (let i = 0; i < 20; i++) {
    const c = hues[i % hues.length];
    el.append(h('i', {
      class: 'confetti',
      style: {
        left: (Math.random() * 96 + 2).toFixed(1) + '%',
        animationDelay: (Math.random() * 0.6).toFixed(2) + 's',
        background: `radial-gradient(circle at 34% 30%, #fff, ${c} 62%, rgba(0,0,0,.15) 100%)`,
        width: (9 + Math.random() * 8).toFixed(0) + 'px',
        height: (9 + Math.random() * 8).toFixed(0) + 'px',
      },
    }));
  }
  layer.append(el);
  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(() => {
    el.classList.remove('in');
    setTimeout(() => el.remove(), 400);
  }, 1800);
}

/** 屏幕震动（答错反馈）。 */
export function shake(el) {
  if (!el) return;
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
}
