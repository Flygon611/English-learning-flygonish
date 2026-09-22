// 应用状态与外壳：状态存取、导航、弹窗、提示、音效绑定。

import { store } from './core/storage.js';
import { allBooks, setUserBooks, userBooks } from './vocab.js';
import { importProgress, exportProgress } from './srs.js';
import { h, $, dayKey, daysBetween } from './util.js';
import { audio } from './audio.js';

const K_STATE = 'state';

export const DEFAULT_SETTINGS = {
  sound: true,
  volume: 0.7,
  autoSpeak: true,      // 四选一「听音选词」题自动朗读
  spellSound: false,    // 拼写题是否朗读（默认关，避免直接听到答案）
  showPhonetic: true,
  showExample: true,
  timer: true,          // 四选一是否限时
  accent: 'en-US',      // 朗读口音
  spellMode: 'type',    // 'type' | 'letters'
  masterThreshold: 5,   // 几星算掌握
  quizSize: 10,
  spellSize: 10,
  cardSize: 20,
};

function freshState() {
  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS },
    currentBook: 'cet4',
    currentLetters: [],          // 空 = 全部字母
    coins: 0,
    lastDaily: '',
    streak: 0,
    total: { correct: 0, wrong: 0, sessions: 0, bestCombo: 0 },
    sessions: [],                // 最近若干次成绩
  };
}

class App {
  constructor() {
    this.s = freshState();
    this.progress = new Map();   // 'bookId|word' -> srs 进度
    this.screen = 'home';
    this.screenRoot = null;
    this._dirty = false;
  }

  /* ---------------- 生命周期 ---------------- */

  async init() {
    // 状态
    const saved = store.get(K_STATE, null);
    if (saved && typeof saved === 'object') {
      this.s = { ...freshState(), ...saved, settings: { ...DEFAULT_SETTINGS, ...(saved.settings || {}) } };
    }
    // 掌握度
    this.progress = importProgress(store.get('progress', []));
    // 用户导入的词库
    setUserBooks(store.get('userBooks', []));
    if (!this.s.currentBook) this.s.currentBook = 'cet4';

    this.screenRoot = $('#screen');

    // 首次进入的每日打卡
    this.touchDaily();

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.flush();
    });
    window.addEventListener('beforeunload', () => this.flush());
    setInterval(() => this.flush(), 15000);

    // 顶部栏 / 底部标签的导航按钮
    document.addEventListener('click', (e) => {
      const go = e.target.closest?.('[data-go]');
      if (go) {
        const target = go.dataset.go;
        if (go.dataset.book) this.s.currentBook = go.dataset.book;
        this.go(target);
      }    });
  }

  /* ---------------- 持久化 ---------------- */

  markDirty() { this._dirty = true; }

  flush() {
    if (!this._dirty) return;
    store.set(K_STATE, this.s);
    store.set('progress', exportProgress(this.progress));
    store.set('userBooks', userBooks().map((b) => ({ id: b.id, name: b.name, words: b.words })));
    this._dirty = false;
  }

  /** 立即完整落盘（导入词库、改设置等关键操作后调用）。 */
  saveAll() {
    store.set(K_STATE, this.s);
    store.set('progress', exportProgress(this.progress));
    store.set('userBooks', userBooks().map((b) => ({ id: b.id, name: b.name, words: b.words })));
    this._dirty = false;
  }

  /** 用户导入词库变化后同步到存档。 */
  syncUserBooks() {
    this.saveAll();
  }

  /* ---------------- 每日打卡 ---------------- */

  touchDaily() {
    const today = dayKey();
    if (this.s.lastDaily === today) return;
    const prev = this.s.lastDaily;
    if (prev) {
      const gap = daysBetween(prev, today);
      this.s.streak = gap === 1 ? (this.s.streak || 0) + 1 : 1;
    } else {
      this.s.streak = 1;
    }
    this.s.lastDaily = today;
    this.markDirty();
  }

  /* ---------------- 设置 ---------------- */

  get st() { return this.s.settings; }

  setSetting(key, value) {
    this.s.settings[key] = value;
    if (key === 'volume') audio.setVolume(value);
    if (key === 'sound') audio.setMuted(!value);
    // 设置是用户主动改动，立即落盘（改完就关页面也不会丢）
    this.saveAll();
  }

  play(name, opts) {
    if (!this.s.settings.sound) return;
    audio.play(name, opts);
  }

  addCoins(n) {
    this.s.coins = Math.max(0, (this.s.coins || 0) + n);
    this.markDirty();
  }

  /* ---------------- 导航 ---------------- */

  async go(name, params = {}) {
    const mod = await SCREENS[name]?.();
    if (!mod) { console.warn('[app] 未知屏幕', name); return; }
    this.screen = name;
    this.currentParams = params;
    if (this._cleanup) { try { this._cleanup(); } catch { /* 静默 */ } this._cleanup = null; }
    this.screenRoot.replaceChildren();
    let node;
    try {
      node = mod.render(this, params);
    } catch (e) {
      // 屏幕渲染失败不能静默：否则表现为「点了没反应」，极难排查
      console.error(`[app] 屏幕 ${name} 渲染失败`, e);
      node = h('div', { class: 'screen-body' }, [
        h('section', { class: 'panel pad' }, [
          h('h2', { text: '这个页面出错了' }),
          h('p', { text: String((e && e.message) || e) }),
          h('pre', { class: 'code-block', text: String((e && e.stack) || '') .split('\n').slice(0, 6).join('\n') }),
          h('button', { class: 'btn primary', text: '返回首页', onclick: () => this.go('home') }),
        ]),
      ]);
      this.toast('页面出错：' + String((e && e.message) || e), 'bad', 4000);
    }
    if (node) this.screenRoot.append(node);
    this.screenRoot.scrollTop = 0;
    window.scrollTo(0, 0);
    this.updateChrome();
  }

  /** 注册当前屏幕的清理函数（定时器 / 键盘监听）。 */
  onCleanup(fn) { this._cleanup = fn; }

  updateChrome() {
    const titles = {
      home: '单词小栈', library: '词库', quiz: '四选一闯关',
      cards: '翻卡记忆', spell: '拼写填空', stats: '学习统计',
      settings: '设置', importer: '导入词库',
    };
    const t = $('#topbar-title');
    if (t) t.textContent = titles[this.screen] || '单词小栈';
    const c = $('#coin-num');
    if (c) c.textContent = String(this.s.coins || 0);
    document.querySelectorAll('.tab').forEach((el) => {
      el.classList.toggle('active', el.dataset.go === this.screen);
    });
  }

  setKeyHint(text) {
    const el = $('#keyhint');
    if (el) el.textContent = text || '';
  }

  /* ---------------- 提示 / 弹窗 ---------------- */

  toast(msg, kind = 'info', ms = 2200) {
    const layer = $('#toast-layer');
    if (!layer) return;
    const el = h('div', { class: `toast toast-${kind}`, text: msg });
    layer.append(el);
    requestAnimationFrame(() => el.classList.add('in'));
    setTimeout(() => {
      el.classList.remove('in');
      setTimeout(() => el.remove(), 260);
    }, ms);
  }

  /**
   * 模态弹窗。
   * @param {{title:string, body:(Node|string), buttons:Array<{label:string,value:any,kind?:string}>}} opt
   * @returns {Promise<any>} 被点击按钮的 value（点遮罩返回 null）
   */
  modal({ title, body, buttons = [{ label: '好', value: true, kind: 'primary' }] }) {
    return new Promise((resolve) => {
      const layer = $('#modal-layer');
      const close = (val) => {
        layer.hidden = true;
        layer.replaceChildren();
        document.removeEventListener('keydown', onKey);
        resolve(val);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); close(null); }
        const idx = Number(e.key);
        if (idx >= 1 && idx <= buttons.length) { e.stopPropagation(); close(buttons[idx - 1].value); }
      };
      const box = h('div', { class: 'modal' }, [
        h('div', { class: 'modal-title', text: title }),
        h('div', { class: 'modal-body' }, typeof body === 'string' ? [h('p', { text: body })] : [body]),
        h('div', { class: 'modal-actions' }, buttons.map((b) =>
          h('button', {
            class: `btn ${b.kind || ''}`,
            text: b.label,
            onclick: () => { this.play(b.kind === 'danger' ? 'cancel' : 'confirm'); close(b.value); },
          }))),
      ]);
      layer.replaceChildren(h('div', { class: 'modal-backdrop', onclick: () => close(null) }, [box]));
      box.addEventListener('click', (e) => e.stopPropagation());
      layer.hidden = false;
      document.addEventListener('keydown', onKey);
      setTimeout(() => box.querySelector('.btn')?.focus(), 30);
    });
  }

  confirm(title, message, { danger = false, okLabel = '确定', cancelLabel = '取消' } = {}) {
    return this.modal({
      title,
      body: message,
      buttons: [
        { label: cancelLabel, value: false },
        { label: okLabel, value: true, kind: danger ? 'danger' : 'primary' },
      ],
    });
  }

  /* ---------------- 便捷查询 ---------------- */

  book(id = this.s.currentBook) {
    return allBooks().find((b) => b.id === id) || { id, name: '（未选择）', count: 0 };
  }

  /** 当前筛选描述，用于标题与成绩记录。 */
  selectionLabel() {
    const b = this.book();
    const L = this.s.currentLetters || [];
    if (!L.length) return `${b.name} · 全部`;
    if (L.length <= 6) return `${b.name} · ${L.slice().sort().join(' ')}`;
    return `${b.name} · ${L.length} 个字母`;
  }
}

/* ---------------- 屏幕懒加载表 ---------------- */

const SCREENS = {
  home: () => import('./screens/home.js'),
  library: () => import('./screens/library.js'),
  quiz: () => import('./modes/quiz.js'),
  cards: () => import('./modes/cards.js'),
  spell: () => import('./modes/spell.js'),
  stats: () => import('./screens/stats.js'),
  settings: () => import('./screens/settings.js'),
  importer: () => import('./screens/importer.js'),
};

export const app = new App();

/* ---------------- 启动 ---------------- */

const BOOT_MSGS = [
  '正在读取词库目录…',
  '正在整理 Kenney 音效…',
  '正在统计掌握情况…',
  '准备好了！',
];

function bootProgress(i) {
  const fill = document.getElementById('boot-bar-fill');
  const msg = document.getElementById('boot-msg');
  if (fill) fill.style.width = Math.round(((i + 1) / BOOT_MSGS.length) * 100) + '%';
  if (msg) msg.textContent = BOOT_MSGS[i] || '';
}

async function boot() {
  const t0 = performance.now();
  try {
    bootProgress(0);
    await audio.init();
    bootProgress(1);
    // 读取词库目录（失败也不阻断，只是没有内置词库可选）
    try {
      const { loadBuiltinIndex } = await import('./vocab.js');
      await loadBuiltinIndex();
    } catch (e) {
      console.error(e);
      app._indexError = e;
    }
    bootProgress(2);
    await app.init();
    bootProgress(3);
    await app.go('home');
  } catch (e) {
    console.error('[boot] 启动失败', e);
    const root = document.getElementById('screen');
    if (root) {
      root.replaceChildren(h('div', { class: 'screen-body' }, [
        h('section', { class: 'panel pad' }, [
          h('h2', { text: '启动失败' }),
          h('p', { text: String(e && e.message || e) }),
          h('p', { class: 'muted', text: '请确认是通过静态服务器（http://）打开本页，而不是直接双击 index.html。' }),
        ]),
      ]));
    }
  } finally {
    // 隐藏启动画面
    const bootEl = document.getElementById('boot');
    const appEl = document.getElementById('app');
    if (appEl) appEl.hidden = false;
    if (bootEl) {
      bootEl.classList.add('gone');
      setTimeout(() => bootEl.remove(), 450);
    }
  }
}

// 首次用户交互时解锁音频与语音
const unlock = () => {
  audio.unlock();
  document.removeEventListener('pointerdown', unlock);
  document.removeEventListener('keydown', unlock);
};
document.addEventListener('pointerdown', unlock, { once: false });
document.addEventListener('keydown', unlock, { once: false });

boot();

