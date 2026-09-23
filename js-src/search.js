// 查单词：跨全部词库搜索。
//
// 设计要点：
//  1) 全部词库加起来近 5 万词，不能每次按键都全量遍历 —— 结果做缓存 + 上限，
//     并且只在**首次进入搜索页**时才后台把所有词库读进内存（不拖慢启动）。
//  2) 搜索要能同时命中：日文/英文单词、读音（假名/IPA）、中文释义。
//  3) 排序按"相关性"：完全相等 > 前缀 > 包含；相同相关性下级别低的词库优先
//     （四级在托福前面），因为那更可能是用户想查的常用词。
//  4) 搜到没背过的词可以直接去练（只练这一个词），避免"搜到了却没法记"。

import { allBooks, getWords, letterOf } from './vocab.js?v=4c022754';
import { wordKey } from './srs.js?v=e54c36c9';

/** 搜索索引是否已就绪。 */
let indexReady = false;
let building = false;
let buildPromise = null;
const index = [];          // [{ book, bookName, difficulty, w: 词条 }]

export const isReady = () => indexReady;

/** 已建立索引的词库数（用于界面显示加载进度）。 */
let builtBooks = 0;
export const builtCount = () => builtBooks;
export const totalBooks = () => allBooks().length;

/**
 * 后台建立索引。幂等：重复调用只会建一次。
 * @param {(done:number,total:number)=>void} onProgress
 */
export function buildIndex(onProgress) {
  if (indexReady) return Promise.resolve(index.length);
  if (building) return buildPromise;

  building = true;
  const books = allBooks();
  const total = books.length;

  buildPromise = (async () => {
    for (const b of books) {
      try {
        const words = await getWords(b.id);
        for (const w of words) {
          index.push({ book: b.id, bookName: b.name, difficulty: b.difficulty ?? 3, lang: b.lang || 'en', w });
        }
      } catch (e) {
        console.warn('[search] 读不到词库', b.id, e);
      }
      builtBooks += 1;
      if (onProgress) {
        try { onProgress(builtBooks, total); } catch { /* 界面已销毁 */ }
      }
    }
    indexReady = true;
    building = false;
    return index.length;
  })();

  return buildPromise;
}

const norm = (s) => String(s ?? '').trim().toLowerCase();

/**
 * 简单相关性打分。返回 0 表示不命中。
 * 分数越高越相关；同一词条可能被多个字段命中，取最高分。
 */
function scoreOf(entry, q) {
  const w = norm(entry.w.w);
  const p = norm(entry.w.p);
  const t = norm(entry.w.t);

  // 完全不相等/不含 就是没命中
  if (w === q) return 1000;
  if (p && p === q) return 900;
  if (w.startsWith(q)) return 700;
  if (p && p.startsWith(q)) return 600;
  if (t.startsWith(q)) return 500;
  if (w.includes(q)) return 400;
  if (p && p.includes(q)) return 300;
  if (t.includes(q)) return 200;
  return 0;
}

/**
 * 执行搜索。
 * @param {string} query
 * @param {{scope?:'all'|'current', bookId?:string, onlyStudied?:boolean,
 *          progress?:Map, limit?:number}} opt
 * @returns {Array<{entry, score, mastery}>}
 */
export function search(query, opt = {}) {
  const q = norm(query);
  const limit = opt.limit ?? 200;
  const scope = opt.scope || 'all';
  if (!q) return [];

  const out = [];
  for (const e of index) {
    if (scope === 'current' && opt.bookId && e.book !== opt.bookId) continue;
    const s = scoreOf(e, q);
    if (!s) continue;
    const key = wordKey(e.book, e.w.w);
    const pr = opt.progress ? opt.progress.get(key) : null;
    if (opt.onlyStudied && !pr) continue;
    // 相关性优先，其次难度低的词库优先，再其次词短的优先
    const tie = (10 - e.difficulty) * 10 - Math.min(e.w.w.length, 20);
    out.push({ entry: e, score: s + tie, mastery: pr || null });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

/** 结果里出现的词库统计，用于顶部小结。 */
export function summarize(results) {
  const byBook = new Map();
  for (const r of results) {
    const k = r.entry.book;
    if (!byBook.has(k)) byBook.set(k, { bookName: r.entry.bookName, count: 0 });
    byBook.get(k).count += 1;
  }
  return Array.from(byBook.entries())
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.count - a.count);
}
