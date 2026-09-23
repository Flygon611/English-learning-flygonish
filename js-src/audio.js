// 音效管理：复用项目已有 Kenney Interface Sounds 整理产物（assets/audio/sfx + sfx.json）。
// 纯 ES2022，无依赖。

import { CFG } from './util.js?v=1b053a4f';

// 逻辑名 -> 实际文件名由 sfx.json 提供（此处只保留兜底）
const FALLBACK = {
  click: 'click_001.ogg',
  confirm: 'confirmation_001.ogg',
  cancel: 'back_001.ogg',
  error: 'error_004.ogg',
  levelup: 'confirmation_004.ogg',
  victory: 'confirmation_002.ogg',
  coin: 'pluck_002.ogg',
  hover: 'select_001.ogg',
  tick: 'tick_002.ogg',
  deny: 'error_002.ogg',
};

/** 本地开发时的默认路径；部署产物通过 window.WORDHUT_CONFIG 覆盖。 */
const DEFAULT_SFX_BASE = '../assets/audio/sfx/';
const DEFAULT_SFX_MAP = '../assets/audio/sfx.json';
/** 本游戏自己的音效覆盖层（不改动项目共用的 sfx.json）。
 *  卡片翻动等单词小栈专属音效放在这里，资源在 wordgame/assets/audio/sfx/。 */
const LOCAL_SFX_BASE = './assets/audio/sfx/';
const LOCAL_SFX_MAP = './assets/audio/sfx.local.json';

/** 需要从「本游戏自己的目录」加载的音效（其余走项目共用的 assets/audio/sfx/）。 */
const LOCAL_SFX = new Set(['cardFlip', 'cardPlace']);

class AudioManager {
  constructor() {
    this.map = { ...FALLBACK };
    this.ready = false;
    this.volume = 0.7;
    this.muted = false;
    this.cache = new Map();   // name -> HTMLAudioElement
    this.ctx = null;          // WebAudio 兜底
    this._last = 0;
  }

  async init() {
    // 1) 项目共用的音效清单
    try {
      const res = await fetch(CFG.sfxMap || DEFAULT_SFX_MAP, { cache: 'no-cache' });
      if (res.ok) {
        const j = await res.json();
        if (j && typeof j === 'object') Object.assign(this.map, j);
      }
    } catch { /* 用兜底映射继续 */ }
    // 2) 本游戏的覆盖层（卡片音效等）
    try {
      const res = await fetch(CFG.sfxLocalMap || LOCAL_SFX_MAP, { cache: 'no-cache' });
      if (res.ok) {
        const j = await res.json();
        if (j && typeof j === 'object') {
          for (const [k, v] of Object.entries(j)) {
            if (k.startsWith('_') || typeof v !== 'string') continue;   // 跳过 _note 之类
            this.map[k] = v;
          }
        }
      }
    } catch { /* 没有覆盖层也能跑 */ }
    this.ready = true;
  }

  /** 该音效应该在哪个目录取。 */
  _baseFor(name) {
    // 本地：wordgame/assets/audio/sfx/；部署：构建脚本注入 CFG.sfxLocal（audio/sfx-local/）
    if (LOCAL_SFX.has(name)) return CFG.sfxLocal || LOCAL_SFX_BASE;
    return CFG.sfx || DEFAULT_SFX_BASE;
  }

  setVolume(v) { this.volume = Math.max(0, Math.min(1, v)); }
  setMuted(m) { this.muted = !!m; }

  _el(name) {
    const file = this.map[name];
    if (!file) return null;
    let a = this.cache.get(name);
    if (!a) {
      a = new Audio(this._baseFor(name) + file);
      a.preload = 'auto';
      this.cache.set(name, a);
    }
    return a;
  }

  /** 播放音效。同音效 45ms 内不重复触发，避免连点时爆音。 */
  play(name, { volume = 1, rate = 1 } = {}) {
    if (this.muted || this.volume <= 0) return;
    const now = performance.now();
    if (now - this._last < 45 && name !== 'tick') return;
    this._last = now;

    const a = this._el(name);
    if (a) {
      try {
        const node = a.cloneNode(true);
        node.volume = Math.max(0, Math.min(1, this.volume * volume));
        node.playbackRate = rate;
        const p = node.play();
        if (p && p.catch) p.catch(() => this._beep(name));
        return;
      } catch { /* 落到兜底 */ }
    }
    this._beep(name);
  }

  /** WebAudio 合成兜底：素材缺失或自动播放被拦时的最小反馈音。 */
  _beep(name) {
    if (this.muted) return;
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
      }
      const ctx = this.ctx;
      if (ctx.state === 'suspended') ctx.resume();
      const good = ['confirm', 'levelup', 'victory', 'coin', 'select'].includes(name);
      const bad = ['error', 'deny'].includes(name);
      const freq = good ? 880 : bad ? 200 : 440;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = good ? 'square' : 'triangle';
      o.frequency.value = freq;
      g.gain.value = 0.06 * this.volume;
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
      o.connect(g).connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.13);
    } catch { /* 静默 */ }
  }

  /** 用户首次交互后解锁自动播放。 */
  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) this.ctx = new AC();
      }
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    } catch { /* 静默 */ }
  }
}

export const audio = new AudioManager();
