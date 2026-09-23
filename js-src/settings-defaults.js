// 默认设置与场景常量。
//
// 单独放一个模块的**原因很重要**：这些值以前定义在 app.js 里，而 screens/settings.js
// 与 screens/stats.js 会从 app.js 导入它们 —— 于是「加载设置页」会连带重新求值 app.js，
// 又因为 app.js 是入口脚本（页面已经以 `js-src/app.js` 加载过），模块图里就出现了
// 第二份 app.js，产生**第二个 App 实例**：它也会跑 boot()，把刚渲染好的设置页覆盖回首页。
//
// 现象极难定位：导航内部明明成功（日志显示 screen=settings、标题=设置），
// 但用户看到的是"点标签没反应"。
//
// 现在把共享常量放在这个叶子模块里：app.js 与各 screen 都从这里取，
// app.js 不再被任何 screen 导入，循环依赖消失。

export const DEFAULT_SETTINGS = {
  sound: true,
  volume: 0.7,
  music: true,          // 主界面背景音乐
  musicVolume: 0.5,
  autoSpeak: true,      // 四选一「听音选词」题自动朗读
  spellSound: false,    // 拼写题是否朗读（默认关，避免直接听到答案）
  showPhonetic: true,
  showExample: true,
  timer: true,          // 四选一是否限时
  accent: 'en-US',      // 朗读口音
  spellMode: 'type',    // 'type' | 'letters'
  masterThreshold: 5,   // 几星算掌握
  quizSize: 10,
  spellSize: 10,
  cardSize: 20,
};

/** 哪些屏幕属于「学习」：需要停掉 BGM 让人专注（也免得盖住音效）。 */
export const STUDY_SCREENS = new Set(['quiz', 'cards', 'spell']);

/** 各屏幕的标题（顶部栏用）。 */
export const SCREEN_TITLES = {
  home: '单词小栈',
  library: '词库',
  search: '查单词',
  quiz: '四选一闯关',
  cards: '翻卡记忆',
  spell: '拼写填空',
  stats: '学习统计',
  settings: '设置',
  importer: '导入词库',
};
