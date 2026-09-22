// 拼写判定：规范化、逐字符比对（用于高亮错处）、字母蒙版。

/** 规范化用户输入：去首尾空白、折叠内部空白、转小写、统一弯引号与连字符。 */
export function normalizeSpell(s) {
  return String(s ?? '')
    .trim()
    .replace(/[\u2018\u2019\u02BC]/g, "'")
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/** 是否完全正确。 */
export const isSpellCorrect = (input, answer) => normalizeSpell(input) === normalizeSpell(answer);

/** 相似度 0~1（Levenshtein 归一化），用于给「差一点点」的反馈。 */
export function similarity(a, b) {
  const s = normalizeSpell(a), t = normalizeSpell(b);
  if (!s.length && !t.length) return 1;
  const m = s.length, n = t.length;
  if (!m || !n) return 0;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return 1 - prev[n] / Math.max(m, n);
}

/**
 * 逐字符比对，返回渲染用的字符块。
 * kind: 'ok' 正确 / 'wrong' 错字 / 'miss' 缺失 / 'extra' 多打
 */
export function diffChars(input, answer) {
  const a = normalizeSpell(answer);
  const b = normalizeSpell(input);
  const out = [];
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const ca = a[i], cb = b[i];
    if (ca === undefined) out.push({ ch: cb, kind: 'extra' });
    else if (cb === undefined) out.push({ ch: ca, kind: 'miss' });
    else if (ca === cb) out.push({ ch: cb, kind: 'ok' });
    else out.push({ ch: cb, kind: 'wrong' });
  }
  return out;
}

/**
 * 字母蒙版：提示时隐藏部分字母，保留首尾与空格/连字符。
 * 例：'abandon' -> 'a _ a _ _ o n'
 */
export function maskWord(word, revealRatio = 0.45, rand = Math.random) {
  const w = String(word);
  const visible = new Set();
  for (let i = 0; i < w.length; i++) {
    const ch = w[i];
    if (ch === ' ' || ch === '-' || ch === "'") visible.add(i);
  }
  // 首字母与末字母始终可见
  if (w.length) visible.add(0);
  for (let i = w.length - 1; i >= 0; i--) {
    if (/[a-z]/i.test(w[i])) { visible.add(i); break; }
  }
  const letters = [];
  for (let i = 0; i < w.length; i++) if (/[a-z]/i.test(w[i]) && !visible.has(i)) letters.push(i);
  const want = Math.round(letters.length * revealRatio);
  for (let k = 0; k < want; k++) {
    const idx = Math.floor(rand() * letters.length);
    visible.add(letters.splice(idx, 1)[0]);
  }
  return Array.from(w, (ch, i) => (visible.has(i) ? ch : '_')).join('');
}

/** 打乱的字母银行（用于「拖/点字母拼词」，可选模式）。 */
export function letterBank(word, rand = Math.random) {
  const letters = String(word).replace(/[^a-z]/gi, '').toLowerCase().split('');
  for (let i = letters.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [letters[i], letters[j]] = [letters[j], letters[i]];
  }
  return letters.map((ch, i) => ({ id: i + '-' + ch, ch }));
}
