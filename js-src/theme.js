// 主题：日间（Frutiger Aero 晴空）/ 夜间（Dark Aero 夜航）。
//
// 夜间不是把日间「反色」，而是换一层材质：黑漆地面 + 烟熏玻璃 + 青色边缘光。
// 配色全部写在 style.css 的 html[data-theme="dark"] 段里，这里只负责：
//   1) 把偏好（auto / light / dark）解析成实际主题；
//   2) 写到 <html data-theme>，CSS 与 meta[name=theme-color] 跟着变；
//   3) 偏好为 auto 时监听系统深色模式变化。
//
// 首帧不能闪白：index.html 的 <head> 里有一段内联脚本，会在解析样式表之前
// 用同一套规则先写一次 data-theme。这里初始化时会再算一遍（状态加载后可能
// 与内联脚本读到的不同——比如设置被恢复默认）。

const MQ = '(prefers-color-scheme: dark)';

/** 移动端浏览器工具栏配色，跟地面顶部同色。 */
const THEME_COLOR = { light: '#d9f0ff', dark: '#050b12' };

let pref = 'auto';
let mql = null;

function systemDark() {
  return !!(mql && mql.matches);
}

/** 把偏好解析成实际主题。 */
export function resolveTheme(prefValue = pref) {
  if (prefValue === 'dark' || prefValue === 'light') return prefValue;
  return systemDark() ? 'dark' : 'light';
}

/** 当前偏好（auto / light / dark）。 */
export function themePref() {
  return pref;
}

/** 当前实际主题（light / dark）。 */
export function currentTheme() {
  return resolveTheme(pref);
}

function paint() {
  const mode = resolveTheme();
  const root = document.documentElement;
  root.dataset.theme = mode;
  // 让滚动条、原生控件（select 下拉、range 轨道）跟着走
  root.style.colorScheme = mode;
  const meta = document.getElementById('meta-theme');
  if (meta) meta.setAttribute('content', THEME_COLOR[mode] || THEME_COLOR.light);
  window.dispatchEvent(new CustomEvent('wordhut:theme', { detail: { mode, pref } }));
  return mode;
}

/**
 * 应用主题偏好。
 * @param {'auto'|'light'|'dark'} prefValue
 * @returns {'light'|'dark'} 实际生效的主题
 */
export function applyTheme(prefValue = 'auto') {
  pref = prefValue === 'dark' || prefValue === 'light' ? prefValue : 'auto';
  return paint();
}

/** 启动时调用一次：绑定系统主题监听并立即上色。 */
export function initTheme(initialPref = 'auto') {
  if (!mql && typeof window.matchMedia === 'function') {
    mql = window.matchMedia(MQ);
    const onSystemChange = () => {
      // 只有「跟随系统」时才跟着系统走；手动选过日/夜的用户不该被系统改掉
      if (pref === 'auto') paint();
    };
    if (typeof mql.addEventListener === 'function') mql.addEventListener('change', onSystemChange);
    else if (typeof mql.addListener === 'function') mql.addListener(onSystemChange);
  }
  return applyTheme(initialPref);
}
