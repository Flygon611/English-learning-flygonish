// 应用状态与外壳：状态存取、导航、弹窗、提示、音效绑定。

import { store } from './core/storage.js?v=c9ee2a15';
import { allBooks, setUserBooks, userBooks } from './vocab.js?v=4c022754';
import { importProgress, exportProgress, isCorruptKey } from './srs.js?v=e54c36c9';
import { h, $, dayKey, daysBetween } from './util.js?v=1b053a4f';
import { audio } from './audio.js?v=6550a8e0';
import { music } from './music.js?v=bb44cee2';
// 默认设置/场景常量放在叶子模块里，避免各 screen 反向 import app.js 造成循环依赖
// （那会产生第二个 App 实例，把渲染好的页面覆盖回首页 —— 见 settings-defaults.js 注释）
import { DEFAULT_SETTINGS, STUDY_SCREENS, SCREEN_TITLES } from './settings-defaults.js?v=9a1ebd43';

// 重新导出，保持既有调用方（如 screens/settings.js 的 `from '../app.js'`）仍可用。
// 但新代码应直接从 settings-defaults.js 取，别从这里取。
export { DEFAULT_SETTINGS, STUDY_SCREENS };

const K_STATE = 'state';

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
    this._navToken = 0;          // 导航令牌，见 go()：防止旧导航覆盖新屏幕
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
    // 清掉历史上被误写成 `词库|[object object]` 这类脏键（曾导致「背了却显示没背过」）。
    // 见 js/srs.js 的 wordKey 注释。
    let dropped = 0;
    for (const k of Array.from(this.progress.keys())) {
      if (isCorruptKey(k)) { this.progress.delete(k); dropped += 1; }
    }
    if (dropped) {
      console.warn(`[app] 清理了 ${dropped} 条无效掌握度记录`);
      store.set('progress', exportProgress(this.progress));
    }
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
      }
    });

    // 音乐：先同步用户设置，再等第一次用户手势解锁播放
    this.applyMusicVolume();
    music.setEnabled(this.st.music);
    this._musicHintShown = false;

    // 自动化测试挂钩：让测试脚本能检查真实实例的状态。
    // 只登记一次，避免「第二个实例」把进度写乱（踩过这个坑）。
    if (!window.__WORDHUT_APP__) window.__WORDHUT_APP__ = this;
  }

  /** 音乐只有在一次真实用户手势之后才能播放（浏览器策略）。 */
  unlockMusic() {
    if (music.unlock()) {
      this.markDirty();
      return true;
    }
    return false;
  }

  /** 一次用户手势后解锁 WebAudio 兜底 + 背景音乐。 */
  unlockAudio() {
    audio.unlock();
    this.unlockMusic();
  }

  /** 音乐音量 = 设置里的 musicVolume，并且受「音效」总开关一起管。 */
  applyMusicVolume() {
    // 「音效」关掉时也静音 BGM，避免出现"整体静音了但音乐还在响"的怪状态
    music.setVolume(this.st.sound ? this.st.musicVolume : 0);
  }

  /** 给界面用的：当前是不是在学习（学习时音乐会自动停）。 */
  isStudyScreen() { return STUDY_SCREENS.has(this.screen); }

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
    if (key === 'sound') { audio.setMuted(!value); this.applyMusicVolume(); }
    if (key === 'music') {
      music.setEnabled(value);
      if (value) music.setScene(this.isStudyScreen() ? 'study' : 'menu');
    }
    if (key === 'musicVolume') this.applyMusicVolume();
    // 设置是用户主动改动，立即落盘（改完就关页面也不会丢）
    this.saveAll();
  }

  play(name, opts) {
    if (!this.s.settings.sound) return;
    audio.play(name, opts);
  }

  /** 供自动化测试与设置页读取当前音乐状态（只读用途）。 */
  get music() { return music; }
  get sfx() { return audio; }

  /**
   * 搜索 API（只读转发）。
   * 挂在这里是为了测试脚本不必拼模块路径 —— 本地是 /wordgame/js/、部署产物是 /js-src/，
   * 写死任一个都会在另一边 404（这个坑踩过好几次）。
   */
  get searchApi() {
    return {
      build: (onProgress) => import('./search.js?v=de5a369e').then((m) => m.buildIndex(onProgress)),
      ready: () => import('./search.js?v=de5a369e').then((m) => m.isReady()),
      run: (q, opt) => import('./search.js?v=de5a369e').then((m) => m.search(q, opt)),
    };
  }

  /** 词库 API（只读转发）。同样是为了让测试脚本不必拼模块路径。 */
  get vocabApi() {
    return {
      books: () => import('./vocab.js?v=4c022754').then((m) => (m.loadBuiltinIndex(), m.allBooks())),
      words: (id) => import('./vocab.js?v=4c022754').then((m) => m.getWords(id)),
    };
  }

  addCoins(n) {
    this.s.coins = Math.max(0, (this.s.coins || 0) + n);
    this.markDirty();
  }

  /* ---------------- 导航 ---------------- */

  async go(name, params = {}) {
    // 导航令牌：每次 go() 都自增。异步加载模块期间如果又发生了一次导航，
    // 旧的那次必须**放弃提交**，否则会出现「导航成功了、界面却是上一个屏幕」——
    // 表现为「第一次点标签没反应」。实测踩过这个坑（点设置只改了标题不换内容）。
    const token = ++this._navToken;
    const mod = await SCREENS[name]?.();
    if (!mod) { console.warn('[app] 未知屏幕', name); return; }
    if (token !== this._navToken) return;      // 期间已有更新的导航，丢弃这次
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
    // 场景驱动 BGM：学习界面自动淡出暂停，回到菜单界面淡入恢复
    music.setScene(STUDY_SCREENS.has(name) ? 'study' : 'menu');
  }

  /** 注册当前屏幕的清理函数（定时器 / 键盘监听）。 */
  onCleanup(fn) { this._cleanup = fn; }

  updateChrome() {
    const t = $('#topbar-title');
    if (t) t.textContent = SCREEN_TITLES[this.screen] || '单词小栈';
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
  home: () => import('./screens/home.js?v=f7ae5616'),
  library: () => import('./screens/library.js?v=8baf07f6'),
  search: () => import('./screens/search.js?v=7987798c'),
  dict: () => import('./screens/dict.js?v=dcf3f927'),
  quiz: () => import('./modes/quiz.js?v=d1cb0289'),
  cards: () => import('./modes/cards.js?v=38fe724c'),
  spell: () => import('./modes/spell.js?v=db4b1607'),
  stats: () => import('./screens/stats.js?v=9abe6b8d'),
  settings: () => import('./screens/settings.js?v=c335ebc7'),
  importer: () => import('./screens/importer.js?v=9476ce79'),
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
  try {
    bootProgress(0);
    await audio.init();
    bootProgress(1);
    // BGM 清单（没有也能跑，只是没音乐）
    await music.init();
    // 读取词库目录（失败也不阻断，只是没有内置词库可选）
    try {
      const { loadBuiltinIndex } = await import('./vocab.js?v=4c022754');
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

// 首次用户交互：解锁 WebAudio 兜底 + 开始播放 BGM
// （浏览器禁止无手势播放音频，所以音乐必须等到这一刻）
const unlock = () => {
  app.unlockAudio();
  document.removeEventListener('pointerdown', unlock);
  document.removeEventListener('keydown', unlock);
};
document.addEventListener('pointerdown', unlock);
document.addEventListener('keydown', unlock);

// 手机端从后台切回来时，浏览器可能已暂停音频；这里顺手恢复
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) app.unlockAudio();
});

boot();

