// 掌握度 + 间隔重复（SRS）。
//
// 设计目标：
//   1) 「星级」只在答对时上升、答错时下降一格 —— 不会因为一次失误把长期积累清零
//   2) 答错的词立刻重新进入「该复习」队列（间隔 = 0）
//   3) 复习间隔随星级增长：0 分钟 → 10 分钟 → 1 天 → 2 天 → 7 天 → 21 天
//   4) 出题优先级 = 该复习程度 + 错误惩罚 - 掌握加成，保证弱词优先出现

export const MAX_STAR = 5;

/** 每个星级对应的复习间隔（毫秒）。0 星 = 立刻重来。 */
export const INTERVALS = [0, 10 * 60e3, 1 * 864e5, 2 * 864e5, 7 * 864e5, 21 * 864e5];

/** 各星级升级所需累计正确次数。 */
export const STAR_NEED = [0, 1, 2, 3, 5, 8];

export const wordKey = (bookId, w) => `${bookId}|${String(w).toLowerCase()}`;

export function newProgress(now = 0) {
  return { p: 0, s: 0, c: 0, ok: 0, err: 0, or: 0, last: now, next: now };
}

/** 判为「已掌握」的星级。 */
export const isMastered = (pr, threshold = 5) => !!pr && (pr.s || 0) >= threshold;

/** 该词现在是否到了复习时间。 */
export const isDue = (pr, now) => !pr || (pr.next || 0) <= now;

/** 从未学过（0 星且没有作答记录）。 */
export const isNew = (pr) => !pr || ((pr.s || 0) === 0 && (pr.ok || 0) === 0 && (pr.err || 0) === 0);

/**
 * 答对：加点、按累计正确次数升星、推后下次复习。
 * @param {object} pr 进度对象（原地修改并返回）
 * @param {{points?:number, now?:number}} opt
 * @returns {object} pr
 */
export function recordCorrect(pr, { points = 10, now = Date.now() } = {}) {
  const o = pr || newProgress(now);
  o.p = (o.p || 0) + points;
  o.c = (o.c || 0) + 1;
  o.ok = (o.ok || 0) + 1;
  o.or = 0;
  while (o.s < MAX_STAR && o.c >= STAR_NEED[o.s + 1]) o.s += 1;
  o.last = now;
  o.next = now + INTERVALS[Math.min(o.s, MAX_STAR)];
  return o;
}

/**
 * 答错：降一星（最低 0）、累计错误、立刻重新排入复习队列。
 */
export function recordWrong(pr, { now = Date.now() } = {}) {
  const o = pr || newProgress(now);
  o.s = Math.max(0, (o.s || 0) - 1);
  o.err = (o.err || 0) + 1;
  o.or = (o.or || 0) + 1;
  o.last = now;
  o.next = now;                    // 立刻重来
  return o;
}

/**
 * 翻卡模式用：直接按「认识程度」评级。
 * @param {object} pr
 * @param {number} rating 0=不认识 1=模糊 2=认识 3=熟练
 */
export function recordRating(pr, rating, { now = Date.now() } = {}) {
  const o = pr || newProgress(now);
  if (rating <= 0) {
    o.s = 0;
    o.err = (o.err || 0) + 1;
    o.or = (o.or || 0) + 1;
    o.next = now;
    o.last = now;
    return o;
  }
  if (rating === 1) {
    o.s = Math.max(1, Math.min((o.s || 0), 1));   // 模糊：最多 1 星
    o.p = (o.p || 0) + 3;
    o.c = (o.c || 0) + 1;
    o.ok = (o.ok || 0) + 1;
    o.or = 0;
    o.next = now + INTERVALS[1];
  } else if (rating === 2) {
    o.p = (o.p || 0) + 10;
    o.c = (o.c || 0) + 1;
    o.ok = (o.ok || 0) + 1;
    o.or = 0;
    o.s = Math.max(o.s || 0, 3);
    o.next = now + INTERVALS[3];
  } else {
    o.p = (o.p || 0) + 14;
    o.c = (o.c || 0) + 1;
    o.ok = (o.ok || 0) + 1;
    o.or = 0;
    o.s = MAX_STAR;
    o.next = now + INTERVALS[MAX_STAR];
  }
  o.last = now;
  return o;
}

/**
 * 出题优先级：分越高越该考。
 * 生词、到期词、错过的词排前面；高星熟词排后面（但仍会偶尔出现，用于保持记忆）。
 */
export function priority(pr, now) {
  if (isNew(pr)) return 1000;
  const overdue = now - (pr.next || 0);
  let v = 500 + Math.min(overdue / 864e5, 30) * 60;   // 逾期越久越优先（按天计）
  v += Math.min(pr.err || 0, 8) * 40;                  // 经常错的词加权
  v += (pr.or || 0) * 300;                             // 连续答错：最优先
  v -= (pr.s || 0) * 150;                              // 掌握好的往后排
  v += (pr.last || 0) === 0 ? 200 : 0;                 // 从未考过的优先
  return v;
}

/**
 * 按优先级排出本轮考试词序。
 * @param {object[]} words 候选词条
 * @param {Map<string,object>} progress bookId|word 的进度表
 * @param {string} bookId
 * @param {number} n 需要几个
 * @param {function} r 随机源（同 seed 可复现）
 */
export function orderForExam(words, progress, bookId, n, r) {
  const now = Date.now();
  const scored = words.map((w) => {
    const pr = progress.get(wordKey(bookId, w.w));
    return { w, v: priority(pr, now) * (0.75 + r() * 0.5) };   // 乘随机因子避免每次顺序一样
  });
  scored.sort((a, b) => b.v - a.v);
  return scored.slice(0, n).map((s) => s.w);
}

/**
 * 统计一批词的掌握情况。
 * @returns {{total,new,learning,mastered,pct,ok,err,accuracy,stars:number[]}}
 */
export function statsOf(words, progress, bookId, masterThreshold = MAX_STAR) {
  const stars = Array.from({ length: MAX_STAR + 1 }, () => 0);
  let fresh = 0, learning = 0, mastered = 0, ok = 0, err = 0, pts = 0;
  for (const w of words) {
    const pr = progress.get(wordKey(bookId, w.w));
    if (isNew(pr)) { fresh += 1; stars[0] += 1; continue; }
    const s = Math.min(pr.s || 0, MAX_STAR);
    stars[s] += 1;
    if (s >= masterThreshold) mastered += 1; else learning += 1;
    ok += pr.ok || 0;
    err += pr.err || 0;
    pts += pr.p || 0;
  }
  const total = words.length;
  return {
    total,
    new: fresh,
    learning,
    mastered,
    pct: total > 0 ? mastered / total : 0,
    ok, err,
    accuracy: ok + err > 0 ? ok / (ok + err) : 0,
    points: pts,
    stars,
  };
}

/** 该词库中「现在就该复习」的词数。 */
export function dueCount(words, progress, bookId, now = Date.now()) {
  let n = 0;
  for (const w of words) {
    const pr = progress.get(wordKey(bookId, w.w));
    if (isNew(pr) || isDue(pr, now)) n += 1;
  }
  return n;
}

/** 导出/导入进度时用的紧凑格式。 */
export function exportProgress(progress) {
  return Array.from(progress.entries());
}

export function importProgress(entries) {
  return new Map(Array.isArray(entries) ? entries : []);
}
