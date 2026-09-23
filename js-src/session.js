// 学习会话：把「当前词库 + 字母筛选 + 模式」变成一次可开始的学习。
// 三种模式（四选一 / 翻卡 / 拼写）共用这里加载词表、维护掌握度、收集成绩。

import { getWords, resolveWords, findBook } from './vocab.js';
import { say } from './util.js';
import {
  orderForExam, newProgress, wordKey, MAX_STAR, isDue, isNew,
  recordCorrect, recordWrong, recordRating, statsOf, dueCount,
} from './srs.js';

/**
 * 朗读用什么语音。
 * 日语词库必须用 ja-JP —— 否则浏览器会拿英文嗓子去念假名（实测过，听起来完全不对）。
 * 英文词库沿用设置里的口音（美/英/澳）。
 */
export function voiceLang(session, fallbackAccent = 'en-US') {
  if (session && session.lang === 'ja') return 'ja-JP';
  return fallbackAccent;
}

/**
 * 读音怎么显示。
 * 英文是 IPA，习惯用 /…/ 包起来；日语是假名，套斜杠反而奇怪，直接显示。
 */
export function readingText(session, p) {
  if (!p) return '';
  return session && session.lang === 'ja' ? p : `/${p}/`;
}

/**
 * 朗读念什么。
 * 日语念假名：TTS 遇到汉字经常自己猜读音，生、今日、一日 这类词十有八九念错；
 * 词库里既然有假名，就直接念假名。英文照旧念原词。
 */
export function speechText(session, word) {
  if (!word) return '';
  if (session && session.lang === 'ja' && word.p) return word.p;
  return word.w || '';
}

/**
 * 给纯日文文本元素加 lang="ja"，让 CSS 用日文字体。
 * 只有真正是日文的元素才加：中文元素保持页面默认的 zh，
 * 否则中文会套上日文字形（汉字写法中日不同，混排会很脏）。
 * 返回 null 时 h() 会跳过该属性。
 */
export function langAttr(lang) {
  return lang === 'ja' ? { lang: 'ja' } : null;
}

/** 会话里当前词库的语言（'ja' / 'en'）。 */
export function sessionLang(session) {
  return session && session.lang === 'ja' ? 'ja' : 'zh';
}

/**
 * 朗读一个词条，并把「设备没有这门语言的语音」如实告诉用户。
 * @returns {{ok: boolean, exact: boolean}}
 */
export function speakWord(app, session, word, opts = {}) {
  const res = say(speechText(session, word), { lang: voiceLang(session), ...opts });
  if (!res.ok) { app.toast('系统语音不可用', 'warn', 1400); return res; }
  if (!res.exact && session && session.lang === 'ja') {
    app.toast('设备未安装日语语音，暂用系统默认朗读', 'warn', 2200);
  }
  return res;
}

/** 会话对象结构（供各模式读写）：
 * {
 *   mode, bookId, bookName, letters, words, queue, index,
 *   size, score, correct, wrong, combo, bestCombo, lives, maxLives,
 *   answers: [], progress: Map, rngSeed, startedAt, finished
 * }
 */

/**
 * 准备一次会话（异步：需要加载词库）。
 * @returns {Promise<object>} session
 */
export async function launch(app, mode) {
  const st = app.st;
  const book = app.book();
  const letters = app.s.currentLetters || [];
  const sizeMap = { quiz: st.quizSize, spell: st.spellSize, cards: st.cardSize };
  const size = sizeMap[mode] || 10;

  const all = await getWords(app.s.currentBook);
  const pool = letters.length
    ? all.filter((w) => letters.includes((w.w[0] || '').toUpperCase()))
    : all;

  if (!pool.length) throw new Error('当前筛选下没有词条，请换个词库或字母');

  const seed = (Date.now() ^ Math.floor(Math.random() * 0xffff)) >>> 0;
  const r = makeRng(seed);

  // 按掌握度优先级排序：生词 / 到期词 / 错过的词优先
  const queue = orderForExam(pool, app.progress, app.s.currentBook, Math.min(size, pool.length), r);

  return {
    mode,
    bookId: app.s.currentBook,
    bookName: book.name,
    bookDesc: app.selectionLabel(),
    // 词库语言：日语词库要朗读用 ja-JP，否则英文嗓子会去念假名（实测踩过）
    lang: book.lang === 'ja' ? 'ja' : 'en',
    readingLabel: book.readingLabel || '音标',
    letters: letters.slice(),
    pool,                       // 干扰项候选池（当前字母筛选范围）
    words: queue,
    size: queue.length,
    index: 0,
    score: 0,
    coins: 0,
    correct: 0,
    wrong: 0,
    combo: 0,
    bestCombo: 0,
    lives: mode === 'quiz' ? 3 : 0,
    maxLives: 3,
    answers: [],
    rngSeed: seed,
    r,
    startedAt: Date.now(),
    finished: false,
    autoSpeak: st.autoSpeak,
  };
}

function makeRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------- 掌握度记录 ---------------- */

/** 取（或建）某词的进度对象。 */
export function progressOf(app, bookId, word, now = Date.now()) {
  const k = wordKey(bookId, word);
  let pr = app.progress.get(k);
  if (!pr) {
    pr = newProgress(now);
    app.progress.set(k, pr);
  }
  return pr;
}

/** 记录一次作答，返回 {starBefore, starAfter, points}。
 *
 * @param {string} word **单词字符串**（如 'abandon'），不是词条对象。
 *   历史上这里收的是对象（写作 `word.w`），与 wordKey 的字符串约定不一致 ——
 *   结果就是一处传对象、一处传字符串，两边都"能跑"，但进度键与统计对不上。
 *   现在统一成字符串，并在下面显式校验。
 */
export function recordAnswer(app, session, word, correct, { points = 10, rating = null, now = Date.now() } = {}) {
  if (typeof word !== 'string') {
    const what = word === null ? 'null' : Array.isArray(word) ? 'array' : typeof word;
    const hint = (word && typeof word === 'object') ? `（字段：${Object.keys(word).slice(0, 5).join(',')}）` : '';
    throw new TypeError(`recordAnswer 需要单词字符串，收到 ${what}${hint} —— 是不是误传了词条对象？应传 word.w。`);
  }
  const pr = progressOf(app, session.bookId, word, now);
  const before = pr.s || 0;

  if (rating != null) {
    // 翻卡模式：按自评直接定级
    recordRating(pr, rating, { now });
  } else {
    if (correct) recordCorrect(pr, { points, now });
    else recordWrong(pr, { now });
  }

  app.markDirty();
  // 立即落盘：掌握度是最重要的数据，不能等 15 秒的自动保存
  app.flush();
  session.answers.push({
    w: word,
    correct,
    star: pr.s || 0,
    rating: rating ?? null,
    ms: now,
  });

  return { starBefore: before, starAfter: pr.s || 0, points: pr.p || 0 };
}


/* ---------------- 会话收尾 ---------------- */

/** 结算：写统计、发金币，返回成绩对象。 */
export function finishSession(app, session, reason = 'done') {
  if (session.finished) return session.summary;
  session.finished = true;
  session.endedAt = Date.now();
  const ms = session.endedAt - session.startedAt;
  const total = session.correct + session.wrong;

  // 金币：答对基础 2 枚，连击加成
  const baseCoins = session.correct * 2 + Math.floor(session.bestCombo / 3) * 3;
  const bonus = session.mode === 'quiz' && reason === 'clear' ? 10 : 0;
  session.coins = baseCoins + bonus;
  app.addCoins(session.coins);

  const s = app.s;
  s.total.correct = (s.total.correct || 0) + session.correct;
  s.total.wrong = (s.total.wrong || 0) + session.wrong;
  s.total.sessions = (s.total.sessions || 0) + 1;
  s.total.bestCombo = Math.max(s.total.bestCombo || 0, session.bestCombo);

  const summary = {
    mode: session.mode,
    bookId: session.bookId,
    bookName: session.bookName,
    selection: session.bookDesc,
    size: session.size,
    answered: total,
    correct: session.correct,
    wrong: session.wrong,
    accuracy: total > 0 ? session.correct / total : 0,
    bestCombo: session.bestCombo,
    score: session.score,
    coins: session.coins,
    ms,
    reason,
    at: new Date().toISOString(),
    words: session.answers.map((a) => a.w),
  };
  session.summary = summary;

  s.sessions = [summary, ...(s.sessions || [])].slice(0, 20);
  app.saveAll();
  return summary;
}

/**
 * 构造一个「只练这几个词」的临时会话（查单词页的「练这个词」用）。
 * 干扰项仍然从该词所在词库的全量词里取，保证选项有迷惑性。
 */
export async function drillSession(app, bookId, words) {
  const book = findBook(bookId);
  if (!book) throw new Error(`没有这个词库：${bookId}`);
  const all = await getWords(bookId);
  const seed = (Date.now() ^ Math.floor(Math.random() * 0xffff)) >>> 0;
  const r = makeRngLike(seed);
  const picked = all.filter((w) => words.includes(w.w));
  if (!picked.length) throw new Error('这些词不在该词库里');
  return {
    mode: 'quiz',
    bookId,
    bookName: book.name,
    bookDesc: `${book.name} · 查词`,
    lang: book.lang === 'ja' ? 'ja' : 'en',
    readingLabel: book.readingLabel || '音标',
    letters: [],
    pool: all,                 // 干扰项池 = 整本词库
    words: picked,
    size: picked.length,
    index: 0,
    score: 0,
    coins: 0,
    correct: 0,
    wrong: 0,
    combo: 0,
    bestCombo: 0,
    lives: 99,                 // 查词练习不该被"扣血"打断
    maxLives: 99,
    answers: [],
    rngSeed: seed,
    r,
    startedAt: Date.now(),
    finished: false,
    autoSpeak: app.st.autoSpeak,
    fromSearch: true,
  };
}

/** 与 launch() 里同一个 PRNG（抽出来避免重复实现）。 */
function makeRngLike(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 快捷读取某词库的规模与掌握概览。 */
export async function bookOverview(app, bookId, letters = null) {  const all = await getWords(bookId);
  const pool = letters && letters.length
    ? all.filter((w) => letters.includes((w.w[0] || '').toUpperCase()))
    : all;
  return {
    total: pool.length,
    stats: statsOf(pool, app.progress, bookId, app.st.masterThreshold || MAX_STAR),
    due: dueCount(pool, app.progress, bookId),
  };
}

export { isDue, isNew, MAX_STAR, findBook };
