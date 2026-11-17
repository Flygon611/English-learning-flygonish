// 词条详情的数据层：按需拉取 assets/dict 下的分桶文件，并缓存。
//
// 为什么分桶：一条词条含逐义项释义、例句、近义词、词源，平均约 400 字节；
// 2.5 万条挤在一个文件里就是 2.5 MB，点开一个词不该下这么多。
// 按「首字符码位 % 24」分成 24 个桶，每个 100~200 KB。
// ⚠ bucketOf 必须与 tools/build_dict.py 的 bucket_of() 完全一致。

import { assetUrl } from './util.js?v=8b589faf';

const BUCKETS = 24;

/** 词 → 分桶文件名。两侧算法必须一致，改一处就要改另一处。 */
export function bucketOf(word) {
  const c = (word || '?').slice(0, 1).toLowerCase();
  return 'b' + String(c.charCodeAt(0) % BUCKETS).padStart(2, '0');
}

const _cache = new Map();     // bucket -> Promise<Map<word, entry>>
const _affix = { list: null, promise: null };

async function loadBucket(bucket) {
  if (_cache.has(bucket)) return _cache.get(bucket);
  const p = (async () => {
    const res = await fetch(assetUrl('dict', `${bucket}.json.gz`));
    if (!res.ok) throw new Error(`词条数据读取失败（${bucket}）`);
    const buf = await res.arrayBuffer();
    let text;
    if (typeof DecompressionStream === 'function') {
      const ds = new DecompressionStream('gzip');
      text = await new Response(new Blob([buf]).stream().pipeThrough(ds)).text();
    } else {
      throw new Error('这个浏览器不支持 gzip 解压，无法读取词条详情');
    }
    const doc = JSON.parse(text);
    const map = new Map();
    for (const e of doc.words || []) map.set(String(e.w).toLowerCase(), e);
    return map;
  })();
  _cache.set(bucket, p);
  try {
    return await p;
  } catch (err) {
    _cache.delete(bucket);   // 失败不留下坏缓存
    throw err;
  }
}

/** 取一个词的详情；没有返回 null。 */
export async function getEntry(word) {
  if (!word) return null;
  const map = await loadBucket(bucketOf(word));
  return map.get(String(word).toLowerCase()) || null;
}

/* ---------------- 变形词 → 原形 ----------------
   ECDICT 的 exchange 字段带 lemma 信息（`0:` 是原形、p/d/i/3/r/t/s 是各种变形），
   构建期已经展开成 { 变形: 原形 } 的索引（tools/build_lemma.py）。
   只在「直接搜不到」时才加载，所以平时不占流量。 */
const _lemma = { forms: null, promise: null };

export async function loadLemmaIndex() {
  if (_lemma.forms) return _lemma.forms;
  if (_lemma.promise) return _lemma.promise;
  _lemma.promise = (async () => {
    try {
      const res = await fetch(assetUrl('dict', 'lemma.json.gz'));
      if (!res.ok) throw new Error('lemma 索引读取失败');
      const buf = await res.arrayBuffer();
      if (typeof DecompressionStream !== 'function') throw new Error('浏览器不支持 gzip');
      const ds = new DecompressionStream('gzip');
      const text = await new Response(new Blob([buf]).stream().pipeThrough(ds)).text();
      const doc = JSON.parse(text);
      _lemma.forms = new Map(Object.entries(doc.forms || {}));
      return _lemma.forms;
    } catch (e) {
      _lemma.promise = null;      // 失败不缓存，下次再试
      throw e;
    }
  })();
  return _lemma.promise;
}

/** 查一个变形词的原形；查不到返回 null。 */
export async function getLemma(word) {
  const key = String(word ?? '').trim().toLowerCase();
  if (!key) return null;
  try {
    const map = await loadLemmaIndex();
    return map.get(key) || null;
  } catch {
    return null;
  }
}

/** 词缀表（搜 un- / -tion 用）。 */
export async function getAffixes() {
  if (_affix.list) return _affix.list;
  if (_affix.promise) return _affix.promise;
  _affix.promise = (async () => {
    try {
      const res = await fetch(assetUrl('dict', 'affixes.json.gz'));
      if (!res.ok) throw new Error('词缀表读取失败');
      const buf = await res.arrayBuffer();
      const ds = new DecompressionStream('gzip');
      const text = await new Response(new Blob([buf]).stream().pipeThrough(ds)).text();
      _affix.list = (JSON.parse(text).affixes) || [];
    } catch {
      _affix.list = [];
    }
    return _affix.list;
  })();
  return _affix.promise;
}

/** 查询串是否像一个词缀：un- / -tion / re- 这种。 */
export function affixKeyOf(query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return null;
  if (/^[a-z]{1,12}-$/.test(q)) return q;          // 前缀写法 un-
  if (/^-[a-z]{1,12}$/.test(q)) return q;          // 后缀写法 -tion
  return null;
}

/**
 * 按词缀查询。除了精确写法，也允许不带连字符直接查（搜 "un" 也能找到 un-），
 * 但只在「没有更匹配的单词」时才由调用方展示，避免把普通单词变成词缀。
 */
export async function searchAffix(query) {
  const list = await getAffixes();
  const q = String(query || '').trim().toLowerCase();
  if (!q || q.length < 2 || q.length > 12) return [];
  const exact = affixKeyOf(q);
  const bare = /^[a-z]+$/.test(q) ? q : null;
  return list.filter((x) => {
    const a = x.a.toLowerCase();
    if (exact && a === exact) return true;
    const core = a.replace(/^-+|-+$/g, '');
    return !!bare && core === bare;
  });
}

/** 词条数据自检信息（覆盖率等），词条页底部展示。 */
export async function getMeta() {
  try {
    const res = await fetch(assetUrl('dict', 'meta.json'));
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
