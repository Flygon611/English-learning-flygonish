// 种子化随机：同一 seed 可完全复现出题顺序（便于「重做本轮」）。

export function rng(seed = Date.now()) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const randInt = (r, min, max) => min + Math.floor(r() * (max - min + 1));

export function shuffle(arr, r) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const pick = (arr, r) => arr[Math.floor(r() * arr.length)];

export function sampleN(arr, n, r) {
  if (n >= arr.length) return shuffle(arr, r);
  return shuffle(arr, r).slice(0, n);
}
