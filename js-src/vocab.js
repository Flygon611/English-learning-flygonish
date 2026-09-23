// 词库数据层：读取项目已有的六套词库（gzip JSON），
// 并提供「按首字母拆分」、干扰项池、自定义词库导入、字母包导出。
//
// 词条结构（来自 assets/vocab/*.json.gz）：
//   { w: 单词, p: 音标, t: 完整释义, d: [义项], x: 英文例句, xm: 中文例句, lvl: 1~5 }

export const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

/* 路径：本地开发走项目内的 assets/；部署产物通过 window.WORDHUT_CONFIG 覆盖
   （见 js/util.js 顶部的说明）。 */
import { CFG } from './util.js?v=1b053a4f';

const DEFAULT_VOCAB_BASE = '../assets/vocab/';
const GZ_BASE = () => CFG.vocab || DEFAULT_VOCAB_BASE;
const IDX_URL = () => GZ_BASE() + 'index.json';
const PLAIN_BASE = './data/plain/';

/* ---------------- 加载缓存 ---------------- */

let _index = null;
const _packs = new Map();     // bookId -> { words, loading }
let _userBooks = [];          // 用户导入的词库（含 words）

/**
 * 读取 gzip JSON。
 * 优先走浏览器原生 DecompressionStream；若该 API 不可用则回退到
 * data/plain/{id}.json（由 tools/build_wordgame_data.py 生成，非压缩）。
 */
async function fetchPackWords(entry) {
  // 1) 原生 gzip 解压
  if (typeof DecompressionStream === 'function') {
    try {
      const res = await fetch(GZ_BASE() + entry.file, { cache: 'no-cache' });
      if (res.ok) {
        const stream = res.body.pipeThrough(new DecompressionStream('gzip'));
        const text = await new Response(stream).text();
        const data = JSON.parse(text);
        if (Array.isArray(data?.words) && data.words.length) return data.words;
      }
    } catch (e) {
      console.warn('[vocab] gzip 解压失败，回退非压缩版本：', e);
    }
  }
  // 2) 非压缩回退
  const res2 = await fetch(`${PLAIN_BASE}${entry.id}.json`, { cache: 'no-cache' });
  if (!res2.ok) throw new Error(`词库文件缺失：${entry.file} 与 data/plain/${entry.id}.json 都读不到`);
  const data2 = await res2.json();
  if (!Array.isArray(data2?.words)) throw new Error(`词库格式错误：${entry.id}`);
  return data2.words;
}

/** 读取内置词库目录（assets/vocab/index.json）。 */
export async function loadBuiltinIndex() {
  if (_index) return _index;
  const res = await fetch(IDX_URL(), { cache: 'no-cache' });
  if (!res.ok) throw new Error('读不到 assets/vocab/index.json');
  const j = await res.json();
  const groupOrder = new Map((j.groups || []).map((g, i) => [g.id, { ...g, order: g.order ?? i + 1 }]));
  _index = j.packs.map((p) => {
    const g = groupOrder.get(p.groupId);
    return {
      id: p.id,
      name: p.name,
      nameEn: p.nameEn,
      file: p.file,
      count: p.count,
      desc: p.desc,
      difficulty: p.difficulty,
      builtin: true,
      // lang / readingLabel 必须带过来：丢了的话 book.lang 恒为 undefined，
      // session.lang 就永远是 'en'，日语词库会被英文嗓子朗读、假名还会被套上
      // 音标的斜杠 —— 这正是「日语读音不对」的根源。
      lang: p.lang || 'en',
      readingLabel: p.readingLabel || '音标',
      // 分类：选择词库页据此分组显示（英语考试 / 日语入门 / 日语 JLPT）。
      // ⚠ 和下面的「筛选分组」不是一回事：category 是**词库**的分类，
      // groupLabel 是**某个词库内部**筛选按钮的标题（首字母 / 假名种类）。
      // 这两者曾经共用 groupLabel 这个键名，后者把前者覆盖掉，
      // 结果三个分组标题全变成「首字母」。
      categoryId: p.groupId || 'other',
      categoryLabel: g ? g.label : '其它',
      categoryOrder: g ? g.order : 99,
      // 这个词库支持哪些玩法；缺省三样都支持
      modes: p.modes || ['quiz', 'cards', 'spell'],
      // 筛选分组：声明了就按它分组（如五十音的平假名/片假名），否则退回 A–Z 字母
      groups: p.groups || null,
      groupLabel: p.groupLabel || '首字母',
    };
  });
  return _index;
}

/** 全部可选词库 = 内置六套 + 用户导入。 */
export function allBooks() {
  const builtin = (_index || []).map((b) => ({ ...b }));
  return [...builtin, ..._userBooks.map((b) => ({ ...b }))];
}

export const findBook = (id) => allBooks().find((b) => b.id === id) || null;

/** 用户导入的词库（已含 words）。 */
export const userBooks = () => _userBooks.map((b) => ({ id: b.id, name: b.name, count: b.count, builtin: false, imported: true, words: b.words }));

export function setUserBooks(list) {
  _userBooks = (list || []).map((b) => ({
    id: b.id,
    name: b.name,
    nameEn: b.nameEn || b.name,
    count: Array.isArray(b.words) ? b.words.length : (b.count || 0),
    desc: b.desc || '自定义导入词库',
    difficulty: b.difficulty ?? 3,
    builtin: false,
    imported: true,
    source: b.source || '用户导入',
    words: b.words || [],
  }));
}

/* ---------------- 词库正文 ---------------- */

/** 取某词库的全部词条（带缓存）。 */
export async function getWords(bookId) {
  const book = findBook(bookId);
  if (!book) throw new Error(`没有这个词库：${bookId}`);

  if (book.imported) return _userBooks.find((b) => b.id === bookId)?.words || [];

  const hit = _packs.get(bookId);
  if (hit) return hit;

  const promise = fetchPackWords(book).then((words) => {
    _packs.set(bookId, words);
    return words;
  }).catch((e) => {
    _packs.delete(bookId);          // 失败不留下坏缓存，允许重试
    throw e;
  });
  _packs.set(bookId, promise);
  return promise;
}

/** 词库是否已在内存中（决定是否显示「加载中」）。 */
export const isLoaded = (bookId) => {
  const v = _packs.get(bookId);
  return Array.isArray(v);
};

/* ---------------- 按首字母拆分（核心需求） ---------------- */

/** 取单词首字母（A-Z）；非字母开头返回 '#'。 */
export function letterOf(word) {
  const c = String(word || '').trim().charAt(0).toUpperCase();
  return LETTERS.includes(c) ? c : '#';
}

/**
 * 一条词属于哪个筛选分组。
 *
 * 默认按首字母（A–Z，其余归 '#'）；词条自带 `g` 字段时以它为准 ——
 * 五十音词库用的是平假名/片假名，A–Z 对假名毫无意义。
 *
 * 注意：会话取词以前用的是 `w.w[0].toUpperCase()`，和这里的 letterOf 不一致 ——
 * 词库页按 '#' 分组统计，会话却按真实首字符过滤，选中「#」这一组开练会取到 0 个词。
 * 现在两端都走这一个函数。
 */
export function groupOf(word) {
  if (word && word.g) return word.g;
  return letterOf(word && word.w);
}

/** 某个词库的筛选分组清单（[{key,label}]，顺序即显示顺序）。 */
export function groupsFor(book) {
  if (book && Array.isArray(book.groups) && book.groups.length) return book.groups;
  return [...LETTERS, '#'].map((L) => ({ key: L, label: L === '#' ? '其它' : L }));
}

/**
 * 把词条数组按筛选分组分桶。
 * @returns {Map<string, object[]>} 例：Map { 'A' => [...], 'B' => [...] }
 */
export function groupByLetter(words) {
  const map = new Map();
  for (const w of words) {
    const L = groupOf(w);
    if (!map.has(L)) map.set(L, []);
    map.get(L).push(w);
  }
  return map;
}

/**
 * 每套词库 × 每个分组的规模表，供词库页展示与选择。
 * @param {object[]} words
 * @param {Array<{key:string,label:string}>} [groups] 词库声明的分组；省略则用 A–Z
 * @returns {Array<{letter:string, label:string, count:number}>}
 */
export function letterBreakdown(words, groups = null) {
  const g = groupByLetter(words);
  const order = groups && groups.length ? groups.map((x) => x.key) : [...LETTERS, '#'];
  const labelOf = new Map((groups || []).map((x) => [x.key, x.label]));
  const out = [];
  for (const L of order) {
    if (g.has(L)) out.push({ letter: L, label: labelOf.get(L) || (L === '#' ? '其它' : L), count: g.get(L).length });
  }
  // 数据里出现了声明之外的分组也别漏掉
  for (const [L, arr] of g) {
    if (!order.includes(L)) out.push({ letter: L, label: labelOf.get(L) || L, count: arr.length });
  }
  return out;
}

/**
 * 真正取词的入口：把「词库 + 分组筛选」解析成一个数组。
 * @param {string} bookId
 * @param {string[]} letters 空数组 = 全选（全部分组）
 */
export async function resolveWords(bookId, letters = []) {
  const words = await getWords(bookId);
  if (!letters.length) return words;
  const want = new Set(letters);
  return words.filter((w) => want.has(groupOf(w)));
}

/* ---------------- 干扰项池 ---------------- */

/**
 * 为出题挑干扰项：优先「同首字母 + 难度接近」的词，更迷惑也更有教学价值。
 * 返回 [{value, word}]，已保证与正确答案释义不重叠。
 *
 * @param {object[]} words 候选池
 * @param {object} answer 正确答案词条
 * @param {number} n 需要几个
 * @param {function} r 随机源
 * @param {{sensesOverlap?:Function, needZh?:boolean}} opt
 *   needZh —— 正确答案用中文释义时，干扰项**也必须是中文**。
 *   否则会出现「三个中文选项 + 一个英文」这种一眼就能排除掉的题目（实测踩过）。
 */
export function pickDistractors(words, answer, n, r, { sensesOverlap, needZh = false } = {}) {
  const pool = words;
  const ansLen = Math.abs((answer.w || '').length);
  const scored = [];
  for (const w of pool) {
    if (w.w === answer.w) continue;
    if (!w.t) continue;
    // 语言一致：中文题面就不许出现英文选项（JLPT 词库里有约 10% 未取到中文释义）
    if (needZh && w.zhSource === 'none') continue;
    if (sensesOverlap && sensesOverlap(w.t, answer.t)) continue;   // 语义重复不做干扰项
    let score = 0;
    if (groupOf(w) === groupOf(answer)) score += 40;
    if (w.lvl && answer.lvl) score += Math.max(0, 12 - Math.abs(w.lvl - answer.lvl) * 3);
    score += Math.max(0, 10 - Math.abs((w.w || '').length - ansLen));
    score += r() * 18;                                            // 打散，避免每次都同样几个
    scored.push({ w, score });
  }
  scored.sort((a, b) => b.score - a.score);

  // 从最接近答案的一段里随机取，兼顾迷惑性与多样性
  const head = scored.slice(0, Math.max(n * 8, 24));
  const chosen = [];
  const usedText = new Set([answer.t]);
  while (chosen.length < n && head.length) {
    const i = Math.floor(r() * head.length);
    const cand = head.splice(i, 1)[0].w;
    if (usedText.has(cand.t)) continue;   // 选项文本也不能重复
    usedText.add(cand.t);
    chosen.push({ value: cand.t, word: cand });
  }
  return chosen;
}

/* ---------------- 自定义词库导入 ---------------- */

const IPA_HINT = /[ˈˌɑæəɛɪɔʊʌθðʃʒŋɜɝɚɐɒɞɘɵɨʉɯɤʍɰʀɾɹɻʔʕʢǀǁǂǃ\u02b0-\u02ff\u0300-\u036f]/;

const HEADER_WORDS = new Set(['word', 'words', 'english', 'phonetic', '音标', '单词', '释义', 'meaning', 'translation', '中文', 'example', '例句']);

/** 依据内容猜第二列是音标还是释义。 */
function looksLikePhonetic(s) {
  if (!s) return false;
  if (IPA_HINT.test(s)) return true;
  // 全是 ASCII 且没有空格/汉字，且有常见音标符号组合
  return /^[a-z:'\-\s,.()]+$/i.test(s) && !/[\u4e00-\u9fff]/.test(s) && s.length <= 20 && /[':]/.test(s);
}

/**
 * 把一行文本按分隔符切列。支持 tab / 逗号（含中文逗号）/ 竖线 / 冒号。
 * 优先 tab，其次竖线，再次逗号，最后冒号（避免 "n. 放弃" 的冒号被误切）。
 */
function splitLine(line) {
  if (line.includes('\t')) return line.split('\t');
  if (line.includes('|')) return line.split('|');
  if (line.includes(',')) return line.split(',');
  if (/[：:]/.test(line)) {
    const idx = line.search(/[：:]/);
    return [line.slice(0, idx), line.slice(idx + 1)];
  }
  return [line];
}

/**
 * 解析导入文本，返回 { words, warn }。
 * 支持：
 *   1) 逐行 词\t音标\t释义（或 词,释义）
 *   2) JSON 数组 [{w,p,t,x,xm}]
 *   3) JSON 对象映射 {"dog":"n. 狗"}
 */
export function parseImport(text) {
  const raw = String(text || '').replace(/\r\n?/g, '\n').trim();
  const warn = [];
  if (!raw) throw new Error('内容为空');

  // --- JSON 形态 ---
  if (raw[0] === '[' || raw[0] === '{') {
    let j;
    try { j = JSON.parse(raw); } catch (e) { throw new Error('JSON 解析失败：' + e.message); }
    const out = [];
    const push = (w, p, t, x, xm) => {
      const word = String(w || '').trim();
      if (!word) return;
      out.push({ w: word, p: String(p || '').trim(), t: String(t || '').trim(), d: [], x: String(x || '').trim(), xm: String(xm || '').trim(), lvl: guessLvl(word) });
    };
    if (Array.isArray(j)) {
      for (const it of j) {
        if (typeof it === 'string') push(it, '', '');
        else if (it && typeof it === 'object') {
          push(it.w ?? it.word ?? it.english ?? it.单词,
               it.p ?? it.phonetic ?? it.音标,
               it.t ?? it.translation ?? it.meaning ?? it.中文 ?? it.释义,
               it.x ?? it.example ?? it.例句,
               it.xm ?? it.exampleCn ?? it.例句中文);
        }
      }
    } else if (j && typeof j === 'object') {
      for (const [k, v] of Object.entries(j)) {
        if (typeof v === 'string') push(k, '', v);
        else if (v && typeof v === 'object') push(k, v.p ?? v.phonetic, v.t ?? v.translation ?? v.meaning, v.x ?? v.example, v.xm);
      }
    }
    return { words: dedupe(out, warn), warn };
  }

  // --- 逐行形态 ---
  const lines = raw.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    const cols = splitLine(line).map((s) => s.trim());
    // 跳过表头
    if (i < 3 && HEADER_WORDS.has(cols[0].toLowerCase()) && cols.length > 1 && HEADER_WORDS.has((cols[1] || '').toLowerCase())) continue;

    const word = cols[0].replace(/^\d+[.、)]\s*/, '');
    if (!word) continue;
    let p = '', t = '';
    if (cols.length >= 3) {
      if (looksLikePhonetic(cols[1])) { p = cols[1]; t = cols.slice(2).join(' '); }
      else { t = cols.slice(1).join(' '); }
    } else {
      t = cols[1] || '';
    }
    if (!t && !p) { warn.push(`第 ${i + 1} 行没有释义，已跳过：${line.slice(0, 30)}`); continue; }
    out.push({ w: word, p, t, d: [], x: '', xm: '', lvl: guessLvl(word) });
  }
  if (!out.length) throw new Error('没有解析出任何词条，请检查格式');
  return { words: dedupe(out, warn), warn };
}

function dedupe(list, warn) {
  const seen = new Map();
  for (const w of list) {
    const key = w.w.toLowerCase();
    if (seen.has(key)) {
      const prev = seen.get(key);
      // 合并释义：保留更长的
      if ((w.t || '').length > (prev.t || '').length) prev.t = w.t;
      if (!prev.p && w.p) prev.p = w.p;
      warn.push(`重复词条已合并：${w.w}`);
      continue;
    }
    seen.set(key, w);
  }
  return Array.from(seen.values());
}

/** 按词长估难度 1~5（与内置词库的 lvl 规则一致）。 */
function guessLvl(w) {
  const n = String(w).length;
  if (n <= 5) return 1;
  if (n <= 7) return 2;
  if (n <= 9) return 3;
  if (n <= 12) return 4;
  return 5;
}

/** 把用户导入的词库登记进内存（持久化由 app 负责）。 */
export function addUserBook({ id, name, words, source }) {
  const book = {
    id,
    name,
    nameEn: name,
    count: words.length,
    desc: '自定义导入词库',
    difficulty: 3,
    builtin: false,
    imported: true,
    source: source || '用户导入',
    words,
  };
  _userBooks.push(book);
  return book;
}

export function removeUserBook(id) {
  const i = _userBooks.findIndex((b) => b.id === id);
  if (i >= 0) _userBooks.splice(i, 1);
  _packs.delete(id);
}

/* ---------------- 导出「按字母拆分」的词库文件 ---------------- */

/**
 * 生成一个按字母拆分的 JSON 包（用于导出给别的工具/程序使用）。
 * @returns {{filename:string, json:string, meta:object}}
 */
export function buildSplitExport(book, words, letters = []) {
  const filtered = letters.length ? words.filter((w) => letters.includes(groupOf(w))) : words;
  const g = groupByLetter(filtered);
  const groups = {};
  const meta = [];
  for (const L of [...LETTERS, '#']) {
    if (!g.has(L)) continue;
    groups[L] = g.get(L).map((w) => ({ w: w.w, p: w.p || '', t: w.t || '', d: w.d || [], x: w.x || '', xm: w.xm || '', lvl: w.lvl || 0 }));
    meta.push({ letter: L, count: groups[L].length });
  }
  const payload = {
    format: 'wordhut.splitletters/v1',
    book: { id: book.id, name: book.name, nameEn: book.nameEn || book.name, difficulty: book.difficulty ?? 3 },
    generated: new Date().toISOString(),
    total: filtered.length,
    letters: meta,
    groups,
  };
  const suffix = letters.length ? `_${letters.slice().sort().join('')}` : '_ALL';
  return {
    filename: `${book.id}${suffix}.letters.json`,
    json: JSON.stringify(payload, null, 0),
    meta,
  };
}

/** 触发浏览器下载。 */
export function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
