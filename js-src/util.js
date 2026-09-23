// 通用工具：DOM 构建与文本格式化。无第三方依赖。

/* ---------------- 运行时路径配置 ----------------
   本游戏刻意「就地复用」项目里已经整理好的 Kenney 素材，因此素材目录在
   wordgame/ 之外。为了让同一份源码既能本地开发、又能部署成独立站点，
   这里统一从一个全局配置读取路径（缺省值 = 本地开发时的相对路径）：

     window.WORDHUT_CONFIG = {
       ui:     'ui/',                 // Kenney UI 图标
       sfx:    'audio/sfx/',          // Kenney 音效
       sfxMap: 'audio/sfx.json',      // 音效清单
       vocab:  'vocab/',              // 词库（gzip）
       script: 'js/app.js',           // 入口脚本（由构建脚本注入）
     }

   部署产物在 index.html 里注入这个配置，源码本身保持干净。 */
export const CFG = (typeof window !== 'undefined' && window.WORDHUT_CONFIG) || {};

/** 拼一个素材 URL（缺省回到本地开发的相对路径）。 */
export const assetUrl = (kind, file) => `${CFG[kind] || DEFAULT_BASE[kind]}${file}`;

const DEFAULT_BASE = {
  ui: '../assets/ui/',
  sfx: '../assets/audio/sfx/',
  sfxMap: '../assets/audio/sfx.json',
  vocab: '../assets/vocab/',
  dict: '../assets/dict/',
};

/* ---------------- DOM ---------------- */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** 创建元素：h('div', {class:'x', dataset:{k:1}}, [子元素或字符串]) */
export function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    el.append(typeof c === 'string' || typeof c === 'number' ? String(c) : c);
  }
  return el;
}

/** Kenney UI 图标（assets/ui，32×32 像素画，image-rendering: pixelated）。 */
export function icon(name, cls = 'ico') {
  return h('img', { class: cls, src: assetUrl('ui', `${name}.png`), alt: '', draggable: 'false' });
}

/* ---------------- 文本 ---------------- */

export const escapeHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** 去掉释义里的词性前缀：'vt. 放弃，遗弃' -> '放弃，遗弃'。用于干扰项比对。 */
export const stripPos = (s) => String(s ?? '')
  .replace(/^\s*(?:abbr|adj|adv|art|aux|conj|int|interj|n|num|prep|pron|v|vi|vt|pl)\s*\.\s*/i, '')
  .trim();

/** 释义拆成义项集合，用于判断干扰项是否与正确答案「语义重叠」。 */
export function senseSet(t) {
  return new Set(
    String(t ?? '')
      .split(/[；;，,、／/（）()【】\[\]]/)
      .map((s) => stripPos(s))
      .filter((s) => s.length > 0),
  );
}

/** 两个释义是否语义重叠（任一侧义项相同或互相包含即算重叠）。 */
export function sensesOverlap(a, b) {
  const sa = senseSet(a), sb = senseSet(b);
  if (!sa.size || !sb.size) return stripPos(a) === stripPos(b);
  for (const x of sa) {
    for (const y of sb) {
      if (x === y) return true;
      // 短串被长串包含（≥2 字才判定，避免单字误判）
      if (x.length >= 2 && y.includes(x)) return true;
      if (y.length >= 2 && x.includes(y)) return true;
    }
  }
  return false;
}

/**
 * 过长的释义截断，优先在标点处切（保持语义完整）。
 * 用于四选一面板，保证四个选项视觉高度接近。
 */
export function shorten(s, max = 34) {
  const str = String(s ?? '').trim();
  if (str.length <= max) return str;
  const cut = str.slice(0, max);
  const idx = Math.max(cut.lastIndexOf('，'), cut.lastIndexOf('；'), cut.lastIndexOf('、'), cut.lastIndexOf(' '));
  if (idx >= max * 0.55) return cut.slice(0, idx) + '…';
  return cut + '…';
}

export const fmtPct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0) + '%';

export function fmtTime(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m} 分 ${String(s % 60).padStart(2, '0')} 秒` : `${s} 秒`;
}

export function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}

/** 本地日期键 YYYY-MM-DD（每日打卡用）。 */
export function dayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 从 aKey 到 bKey 的天数差（正数表示 b 在 a 之后）。 */
export function daysBetween(aKey, bKey) {
  const a = new Date(aKey + 'T00:00:00');
  const b = new Date(bKey + 'T00:00:00');
  return Math.round((b - a) / 86400000);
}

export const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

/* ---------------- 语音朗读（系统 TTS，无需任何音频文件） ---------------- */

export const speechSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

let cachedVoices = null;
const voiceCache = new Map();

/**
 * 按语言找语音。
 *
 * 这里以前叫 englishVoices() 并且写死了 /^en/i 过滤 —— 结果 say(text, {lang:'ja-JP'})
 * 在只剩英文的列表里永远找不到 ja-JP，于是退回「任意英文语音」并把它赋给 u.voice。
 * 浏览器一旦拿到显式 voice 就用 voice 的语言，u.lang 被忽略，假名就被英文（或系统
 * 默认的中文）嗓子念了。现在按请求语言过滤，别的一概不用。
 */
export function voicesFor(lang) {
  if (!speechSupported()) return [];
  const key = String(lang || 'en-US').toLowerCase().replace('_', '-');
  if (voiceCache.has(key)) return voiceCache.get(key);
  let all = [];
  try { all = window.speechSynthesis.getVoices() || []; } catch { all = []; }
  const base = key.split('-')[0];
  const list = all.filter((v) => {
    const l = String(v.lang || '').toLowerCase().replace('_', '-');
    return l === key || l.split('-')[0] === base;
  });
  // 空结果不缓存：语音列表在部分浏览器是异步填充的，若在填充完成前问过一次，
  // 缓存住空列表会让这门语言永远匹配不到（voiceschanged 也可能不触发）。
  if (list.length) voiceCache.set(key, list);
  return list;
}

/** 设置页的英文口音列表用。 */
export function englishVoices() {
  if (!speechSupported()) return [];
  if (cachedVoices) return cachedVoices;
  cachedVoices = voicesFor('en');
  return cachedVoices;
}

// 语音列表在部分浏览器异步填充
if (speechSupported()) {
  try {
    window.speechSynthesis.addEventListener('voiceschanged', () => {
      cachedVoices = null;
      voiceCache.clear();
    });
  } catch { /* 静默 */ }
}

/**
 * 朗读一段文本。
 *
 * 返回值改为对象：调用方需要区分「读出来了」和「设备根本没有这门语言的语音」，
 * 后者不该硬塞一个别的语言的嗓子敷衍过去。
 * @returns {{ok: boolean, exact: boolean, voice: string|null}}
 */
export function say(text, { lang = 'en-US', rate = 0.9 } = {}) {
  if (!speechSupported() || !text) return { ok: false, exact: false, voice: null };
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(String(text));
    u.lang = lang;
    u.rate = rate;
    u.pitch = 1;
    const want = String(lang).toLowerCase().replace('_', '-');
    const vs = voicesFor(lang);
    const exact = vs.find((v) => String(v.lang || '').toLowerCase().replace('_', '-') === want);
    // 只有确认是同一门语言才指定 voice；没有就留空让引擎按 u.lang 自己挑，
    // 绝不拿别的语言的语音顶替。
    u.voice = exact || vs.find((v) => v.default) || vs[0] || null;
    window.speechSynthesis.speak(u);
    return { ok: true, exact: !!exact, voice: u.voice ? u.voice.name : null };
  } catch {
    return { ok: false, exact: false, voice: null };
  }
}
