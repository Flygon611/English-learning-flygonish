// 首页：选模式开玩 + 今日概览。

import { h, icon, say } from '../util.js?v=1b053a4f';
import { btn, panel, statBox, progressBar, empty } from '../ui/kit.js?v=2f24ea8c';
import { bookOverview } from '../session.js?v=c98f7362';
import { audio } from '../audio.js?v=6550a8e0';

export function render(app) {
  const wrap = h('div', { class: 'screen-body' });
  const st = app.st;
  const book = app.book();
  const sel = app.selectionLabel();

  /* ---- 顶部横幅 ---- */
  const banner = h('div', { class: 'hero' }, [
    h('div', { class: 'hero-emoji' }, [icon('bookOpen', 'ico big')]),
    h('div', { class: 'hero-text' }, [
      h('h1', { text: '今天也背几个单词吧' }),
      h('p', { text: `当前词库：${sel}` }),
    ]),
    btn({
      label: '换词库', iconName: 'list', size: 'sm', kind: 'ghost',
      onclick: () => app.go('library'),
    }),
  ]);
  wrap.append(banner);

  /* ---- 掌握概览（异步填充） ---- */
  const ovBox = h('div', { class: 'hero-ov' }, [
    h('div', { class: 'loading-line', text: '正在统计掌握情况…' }),
  ]);
  wrap.append(ovBox);

  bookOverview(app, app.s.currentBook, app.s.currentLetters)
    .then(({ total, stats, due }) => {
      ovBox.replaceChildren(
        h('div', { class: 'ov-row' }, [
          h('span', { class: 'ov-k', text: '待学 / 复习' }),
          h('b', { class: 'ov-v', text: `${due} 词` }),
          h('span', { class: 'ov-k', text: '已掌握' }),
          h('b', { class: 'ov-v', text: `${stats.mastered} / ${total}` }),
        ]),
        progressBar(stats.mastered, total, { cls: 'thin' }),
        h('div', { class: 'ov-sub', text: `生词 ${stats.new} · 学习中 ${stats.learning} · 掌握 ${stats.mastered}（共 ${total} 词）` }),
      );
    })
    .catch((e) => {
      ovBox.replaceChildren(empty(String(e.message || e), 'warning'));
    });

  /* ---- 三种玩法 ---- */
  const modes = [
    {
      id: 'quiz', icon: 'target', title: '四选一闯关',
      desc: '过关斩将，答错扣血。看英文选中文 / 看中文选英文 / 听音选词',
      tag: `${st.quizSize} 题 · 3 条命`,
      cls: 'm-quiz',
    },
    {
      id: 'cards', icon: 'cardOutline', title: '翻卡记忆',
      desc: '翻卡看释义，自评「不认识 / 模糊 / 认识 / 熟练」，自动安排复习',
      tag: `${st.cardSize} 张 · 不限时`,
      cls: 'm-cards',
    },
    {
      id: 'spell', icon: 'note', title: '拼写填空',
      desc: '看中文释义拼出英文单词，拼错了会逐字告诉你哪里错',
      tag: `${st.spellSize} 题 · 不计命`,
      cls: 'm-spell',
    },
  ];

  const modeGrid = h('div', { class: 'mode-grid' });
  // 玩法是否可用由词库自己声明（index.json 的 modes）。
  // 五十音词库就没有「拼写填空」：假名没有拉丁字母可拼，硬上会得到一个空的字母池。
  // 注意复用上面已经取到的 book —— 这里再 const book 一次会让整个模块报
  // SyntaxError: Identifier 'book' has already been declared，首页直接白屏。
  const allowed = (book && book.modes) || ['quiz', 'cards', 'spell'];
  for (const m of modes.filter((x) => allowed.includes(x.id))) {
    modeGrid.append(h('button', {
      class: `mode-card ${m.cls}`,
      type: 'button',
      onclick: () => startMode(app, m.id),
    }, [
      h('div', { class: 'mc-ico' }, [icon(m.icon)]),
      h('div', { class: 'mc-main' }, [
        h('div', { class: 'mc-title', text: m.title }),
        h('div', { class: 'mc-desc', text: m.desc }),
        h('div', { class: 'mc-tag', text: m.tag }),
      ]),
      h('div', { class: 'mc-go' }, [icon('arrowRight')]),
    ]));
  }
  wrap.append(modeGrid);

  /* ---- 今日 / 总览数据 ---- */
  const t = app.s.total || {};
  const acc = (t.correct || 0) + (t.wrong || 0) > 0
    ? Math.round(((t.correct || 0) / ((t.correct || 0) + (t.wrong || 0))) * 100) + '%'
    : '—';
  wrap.append(panel([
    h('div', { class: 'stat-grid' }, [
      statBox('连续打卡', `${app.s.streak || 0} 天`, { iconName: 'fire', kind: 'k-fire' }),
      statBox('总正确率', acc, { iconName: 'target', kind: 'k-target' }),
      statBox('最高连击', t.bestCombo || 0, { iconName: 'star', kind: 'k-star' }),
      statBox('累计金币', app.s.coins || 0, { iconName: 'coin', kind: 'k-coin' }),
    ]),
    h('div', { class: 'row-actions' }, [
      btn({ label: '学习统计', iconName: 'trophy', size: 'sm', onclick: () => app.go('stats') }),
      btn({ label: '词库管理', iconName: 'list', size: 'sm', onclick: () => app.go('library') }),
      btn({ label: '导入词库', iconName: 'plus', size: 'sm', onclick: () => app.go('importer') }),
    ]),
  ], 'pad'));

  /* ---- 最近成绩 ---- */
  const recent = (app.s.sessions || []).slice(0, 3);
  if (recent.length) {
    const list = h('div', { class: 'recent-list' });
    for (const r of recent) {
      list.append(h('div', { class: 'recent-row' }, [
        icon(modeIcon(r.mode), 'ico sm'),
        h('span', { class: 'rr-name', text: `${modeName(r.mode)} · ${r.selection || r.bookName}` }),
        h('span', { class: 'rr-score', text: `${r.correct}/${r.answered}` }),
        h('span', { class: `rr-acc ${r.accuracy >= 0.8 ? 'good' : r.accuracy >= 0.5 ? 'mid' : 'bad'}`,
          text: Math.round(r.accuracy * 100) + '%' }),
      ]));
    }
    wrap.append(panel([h('div', { class: 'sec-title' }, [h('h2', { text: '最近成绩' })]), list], 'pad'));
  }

  app.setKeyHint('提示：Z / 空格 朗读单词 · 数字键 1-4 选答案 · Esc 返回');
  return wrap;
}

export const modeIcon = (m) => (m === 'quiz' ? 'target' : m === 'cards' ? 'cardOutline' : 'note');
export const modeName = (m) => (m === 'quiz' ? '四选一' : m === 'cards' ? '翻卡' : '拼写');

/** 加载词表 → 进入对应模式（带「加载中」反馈）。 */
export async function startMode(app, mode, hostEl = null) {
  app.play('confirm');
  const host = hostEl || document.getElementById('screen');
  const overlay = h('div', { class: 'loading-overlay' }, [
    h('div', { class: 'spinner' }),
    h('p', { text: '正在准备词表…' }),
  ]);
  document.body.append(overlay);
  try {
    await app.go(mode);
  } catch (e) {
    app.toast(String(e.message || e), 'bad');
  } finally {
    overlay.remove();
  }
}
