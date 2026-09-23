// 背景音乐：主界面循环播放，进入学习界面自动淡出暂停。
//
// 设计要点：
//   1) 浏览器禁止无交互播放音频。因此首次播放必须等一次用户手势（点击/按键），
//      在此之前只"待命"，并在界面上温和提示一下。
//   2) 场景驱动：app 每次切换屏幕都会调用 music.setScene()。
//        menu  → 首页 / 词库 / 统计 / 设置（放 BGM）
//        study → 四选一 / 翻卡 / 拼写（静音，让你专注、也让音效听得清）
//   3) 淡入淡出用音量渐变而不是硬切，避免"啪"的一声。
//   4) 只用一个 <audio> 实例，切换曲目时复用，避免多个实例叠加播放。

import { CFG } from './util.js';

/** BGM 目录：本游戏自己的 assets/audio/music/（清单里的纯文件名都相对它解析）。
 *  注意是 `./assets/...`（wordgame 自己的），不是 `../assets/...`（项目共用的音效目录）——
 *  写错会 404，且只在"切到下一首"时才暴露。 */
const DEFAULT_MUSIC_BASE = './assets/audio/music/';
const DEFAULT_MUSIC_MAP = './assets/audio/music.json';

/** 放 BGM 的场景。 */
const MUSIC_SCENES = new Set(['menu']);

const FADE_IN_MS = 900;
const FADE_OUT_MS = 420;      // 出去比进来快
const TICK_MS = 40;

class MusicPlayer {
  constructor() {
    this.tracks = [];
    this.ready = false;
    this.enabled = true;
    this.volume = 0.5;
    this.scene = 'home';
    this.current = null;      // 当前曲目对象
    this.el = null;
    this.unlocked = false;
    this._fadeTimer = null;
    this._order = [];         // 本轮播放顺序（打乱后的下标）
    this._orderPos = 0;
  }

  /* ---------------- 加载清单 ---------------- */

  async init() {
    try {
      const res = await fetch(CFG.musicMap || DEFAULT_MUSIC_MAP, { cache: 'no-cache' });
      if (res.ok) {
        const j = await res.json();
        const list = Array.isArray(j?.tracks) ? j.tracks : [];
        this.tracks = list.filter((t) => t && t.file && t.scene);
      }
    } catch { this.tracks = []; }
    this.ready = true;
  }

  get base() { return CFG.music || DEFAULT_MUSIC_BASE; }

  /**
   * 把清单里的 file 解析成可用的 URL。两种形态都要能跑：
   *
   *   - 本地开发（wordgame/）：file 可能是相对清单目录的路径，如 `../assets/audio/music/x.ogg`
   *   - 部署站点（站点根）：构建脚本会把 file 改写成站点内路径，如 `assets/audio/music/x.ogg`
   *
   * 规则：**带目录的路径**按 page 解析（清单就在页面根目录）；
   * 纯文件名按 BGM 目录（CFG.music）解析。写反了就会 404，而且只有当随机播到那首歌时才暴露。
   */
  _resolve(file) {
    try {
      if (file.includes('/')) return new URL(file, location.href).href;
      return new URL(file, new URL(this.base, location.href)).href;
    } catch {
      return this.base + file.split('/').pop();
    }
  }

  /** 某场景下可用的曲目。 */
  tracksFor(scene) {
    return this.tracks.filter((t) => t.scene === scene);
  }

  get available() { return this.tracks.length > 0; }

  /* ---------------- 场景 ---------------- */

  /**
   * 切换场景。学习场景会淡出暂停；菜单场景会（在已解锁的前提下）开始播放。
   */
  setScene(scene) {
    this.scene = scene || 'home';
    if (MUSIC_SCENES.has(this.scene)) {
      if (this.enabled && this.unlocked) this.start();
    } else {
      this.pause({ fade: true });
    }
  }

  /* ---------------- 开关 / 音量 ---------------- */

  setEnabled(on) {
    this.enabled = !!on;
    if (!this.enabled) this.pause({ fade: true });
    else if (MUSIC_SCENES.has(this.scene) && this.unlocked) this.start();
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.isPlaying()) this._applyVolume(this._targetVolume());
  }

  /* ---------------- 首次手势解锁 ---------------- */

  /** 由 app 在第一次用户交互时调用。 */
  unlock() {
    if (this.unlocked) return false;
    this.unlocked = true;
    if (this.enabled && MUSIC_SCENES.has(this.scene)) {
      this.start();
      return true;
    }
    return false;
  }

  /* ---------------- 播放控制 ---------------- */

  _targetVolume() {
    const t = this.current;
    const perTrack = typeof t?.volume === 'number' ? t.volume : 1;
    return Math.max(0, Math.min(1, this.volume * perTrack));
  }

  _pickNext() {
    const pool = this.tracksFor(this.scene);
    if (!pool.length) return null;
    // 打乱一轮，避免每次都是同一首；一轮放完再重新洗
    if (!this._order.length || this._orderPos >= this._order.length) {
      this._order = pool.map((_, i) => i);
      for (let i = this._order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this._order[i], this._order[j]] = [this._order[j], this._order[i]];
      }
      this._orderPos = 0;
    }
    const t = pool[this._order[this._orderPos]] || pool[0];
    this._orderPos += 1;
    return t;
  }

  _ensureEl() {
    if (this.el) return this.el;
    const a = new Audio();
    a.preload = 'auto';
    a.loop = true;                    // 单曲循环；一轮里的其它曲子靠 ended 轮换
    a.addEventListener('ended', () => {
      // loop=true 时一般不会触发；留作兜底（某些浏览器对 mp3 循环不精确）
      if (this.isPlaying()) this.next({ auto: true });
    });
    a.addEventListener('error', () => {
      console.warn('[music] 加载失败：', this.current?.file);
    });
    this.el = a;
    return a;
  }

  /** 开始/继续播放当前场景的 BGM。返回是否真的开始了。 */
  start() {
    if (!this.enabled || !this.unlocked) return false;
    if (!MUSIC_SCENES.has(this.scene)) return false;
    if (!this.tracksFor(this.scene).length) return false;

    // 已经在放同一场景的曲子 → 只把音量淡回来
    if (this.current && this.isPlaying()) {
      this._fadeTo(this._targetVolume(), FADE_IN_MS);
      return true;
    }

    if (!this.current || this.current.scene !== this.scene) {
      this.current = this._pickNext();
    }
    if (!this.current) return false;

    const a = this._ensureEl();
    const want = this._resolve(this.current.file);
    // 只有换曲才重新赋值 src（避免每次 setScene 都重新加载）
    if (!a.src || !a.src.endsWith(encodeURI(this.current.file)) && !a.src.endsWith(this.current.file)) {
      a.src = want;
      try { a.load(); } catch { /* 忽略 */ }
    }

    a.volume = 0;
    const p = a.play();
    if (p && typeof p.catch === 'function') {
      p.then(() => {
        this._fadeTo(this._targetVolume(), FADE_IN_MS);
      }).catch((e) => {
        // 自动播放被拦：等下一次手势再试
        this.unlocked = false;
        console.warn('[music] 播放被浏览器拦截，等待用户交互：', e?.name || e);
      });
    } else {
      this._fadeTo(this._targetVolume(), FADE_IN_MS);
    }
    return true;
  }

  pause({ fade = true } = {}) {
    const a = this.el;
    if (!a) return;
    if (!fade) { a.pause(); return; }
    if (a.paused) return;
    this._fadeTo(0, FADE_OUT_MS, () => { try { a.pause(); } catch { /* 忽略 */ } });
  }

  /** 手动切下一首（设置页有个按钮）。 */
  next({ auto = false } = {}) {
    if (!this.tracksFor(this.scene).length) return false;
    this.current = this._pickNext();
    const a = this._ensureEl();
    a.src = this._resolve(this.current.file);
    try { a.load(); } catch { /* 忽略 */ }
    if (this.enabled && this.unlocked && MUSIC_SCENES.has(this.scene)) {
      a.volume = 0;
      const p = a.play();
      if (p && typeof p.catch === 'function') {
        p.then(() => { this._fadeTo(this._targetVolume(), FADE_IN_MS); }).catch(() => {});
      }
    }
    return true;
  }

  isPlaying() { return !!this.el && !this.el.paused && !this.el.ended; }

  /** 当前曲目显示名（设置页/提示用）。 */
  nowPlayingName() {
    return this.current ? this.current.name : '';
  }

  /* ---------------- 音量渐变 ---------------- */

  _fadeTo(target, ms, done) {
    if (this._fadeTimer) { clearInterval(this._fadeTimer); this._fadeTimer = null; }
    const a = this.el;
    if (!a) { if (done) done(); return; }
    const from = a.volume;
    const t0 = performance.now();
    const span = Math.max(1, ms);
    this._fadeTimer = setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / span);
      // ease-out，听起来更自然
      const e = 1 - Math.pow(1 - k, 3);
      a.volume = Math.max(0, Math.min(1, from + (target - from) * e));
      if (k >= 1) {
        clearInterval(this._fadeTimer);
        this._fadeTimer = null;
        if (done) done();
      }
    }, TICK_MS);
  }

  _applyVolume(v) {
    if (this._fadeTimer) return;      // 渐变进行中别插手
    if (this.el) this.el.volume = Math.max(0, Math.min(1, v));
  }
}

export const music = new MusicPlayer();
