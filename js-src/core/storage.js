// 本地存档：localStorage 封装（键前缀 wh.）

const PREFIX = 'wh.';

export const store = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      if (raw == null) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  },

  set(key, value) {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
      return true;
    } catch (e) {
      // 配额超限（大量自定义词库时可能发生）
      console.warn('[store] 写入失败', key, e);
      return false;
    }
  },

  remove(key) {
    try { localStorage.removeItem(PREFIX + key); } catch { /* 静默 */ }
  },

  /** 已占用的字节数（UTF-16 估算），用于设置页显示。 */
  usedBytes() {
    let n = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(PREFIX)) n += (k.length + (localStorage.getItem(k) || '').length) * 2;
      }
    } catch { /* 静默 */ }
    return n;
  },
};
