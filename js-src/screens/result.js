// 结算界面：三种模式共用的成绩页。

import { h, icon, fmtTime, fmtPct } from '../util.js';
import { btn, panel, statBox, progressBar, stars, empty } from '../ui/kit.js';
import { wordKey, MAX_STAR } from '../srs.js';

/**
 * @param {object} app
 * @param {object} summary finishSession 的返回值
 * @param {{onRetry?:Function, extraRows?:Node[]}} opt
 */
export function renderResult(app, summary, { onRetry, extraRows = [] } = {}) {
  const wrap = h('div', { class: 'screen-body result-body' });

  const grade = summary.accuracy >= 0.95 ? { t: '完美！', k: 'g-s', i: 'crown' }
    : summary.accuracy >= 0.8 ? { t: '很棒！', k: 'g-a', i: 'trophy' }
      : summary.accuracy >= 0.6 ? { t: '还不错', k: 'g-b', i: 'medal' }
        : { t: '继续加油', k: 'g-c', i: 'book' };

  wrap.append(h('div', { class: `result-hero ${grade.k}` }, [
    icon(grade.i, 'ico big'),
    h('h1', { text: grade.t }),
    h('p', { text: `${summary.selection || summary.bookName} · 用时 ${fmtTime(summary.ms)}` }),
  ]));

  wrap.append(panel([
    h('div', { class: 'stat-grid wide' }, [
      statBox('答对', `${summary.correct}/${summary.answered}`, { iconName: 'check', kind: 'k-target' }),
      statBox('正确率', summary.answered ? fmtPct(summary.correct, summary.answered) : '—', { iconName: 'target', kind: 'k-star' }),
      statBox('最高连击', summary.bestCombo, { iconName: 'fire', kind: 'k-fire' }),
      statBox('获得金币', `+${summary.coins}`, { iconName: 'coin', kind: 'k-coin' }),
    ]),
    progressBar(summary.correct, Math.max(1, summary.answered), { cls: 'thick' }),
    ...extraRows,
  ], 'pad'));

  /* ---- 本轮涉及的单词与掌握变化 ---- */
  const words = summary.words || [];
  if (words.length) {
    const list = h('div', { class: 'result-words' });
    for (const w of words.slice(0, 60)) {
      const pr = app.progress.get(wordKey(summary.bookId, w));
      list.append(h('div', { class: 'rw-row' }, [
        h('b', { text: w }),
        stars(pr ? (pr.s || 0) : 0, { small: true }),
      ]));
    }
    wrap.append(panel([
      h('div', { class: 'sec-title' }, [
        h('h2', { text: '本轮单词掌握度' }),
        h('span', { class: 'sec-note', text: '★ 为答题后的最新星级' }),
      ]),
      list,
    ], 'pad'));
  }

  /* ---- 下一步 ---- */
  const actions = h('div', { class: 'result-actions' }, [
    btn({ label: '再来一轮', iconName: 'arrowRight', kind: 'primary', onclick: () => onRetry ? onRetry() : app.go(app.screen) }),
    btn({ label: '换模式', iconName: 'list', onclick: () => app.go('home') }),
    btn({ label: '返回首页', iconName: 'home', kind: 'ghost', onclick: () => app.go('home') }),
  ]);
  wrap.append(actions);

  /* ---- 键盘 ---- */
  const onKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); onRetry ? onRetry() : app.go(app.screen); }
    else if (e.key === 'Escape') { e.preventDefault(); app.go('home'); }
  };
  document.addEventListener('keydown', onKey);
  app.onCleanup(() => document.removeEventListener('keydown', onKey));
  app.setKeyHint('Enter 再来一轮 · Esc 返回首页');

  return wrap;
}
