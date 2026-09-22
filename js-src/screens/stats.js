// 统计页：掌握度分布、逐字母进度、错词本、历史成绩、数据管理。

import { h, icon, fmtPct, fmtTime, fmtBytes } from '../util.js';
import { btn, panel, statBox, progressBar, stars, empty, sectionTitle } from '../ui/kit.js';
import { getWords, letterBreakdown, letterOf, downloadText } from '../vocab.js';
import { statsOf, wordKey, MAX_STAR, isNew } from '../srs.js';
import { store } from '../core/storage.js';

export function render(app) {
  const wrap = h('div', { class: 'screen-body' });
  const bodyHost = h('div', { class: 'stats-host' }, [h('div', { class: 'loading-line', text: '统计中…' })]);
  wrap.append(panel([
    h('div', { class: 'sec-title' }, [
      h('h2', { text: '学习统计' }),
      h('span', { class: 'sec-note', text: app.selectionLabel() }),
    ]),
    bodyHost,
  ], 'pad'));

  const bookId = app.s.currentBook;
  const letters = app.s.currentLetters || [];

  getWords(bookId).then((all) => {
    const words = letters.length ? all.filter((w) => letters.includes(letterOf(w.w))) : all;
    renderStats(app, bodyHost, bookId, words);
  }).catch((e) => {
    bodyHost.replaceChildren(empty(String(e.message || e), 'warning'));
  });

  app.setKeyHint('统计只反映当前词库与当前字母选择的学习记录');
  return wrap;
}

function renderStats(app, host, bookId, words) {
  const th = app.st.masterThreshold || MAX_STAR;
  const s = statsOf(words, app.progress, bookId, th);
  const now = Date.now();

  const frag = h('div', {});

  /* ---- 总览 ---- */
  frag.append(h('div', { class: 'stat-grid wide' }, [
    statBox('已掌握', `${s.mastered}`, { iconName: 'crown', kind: 'k-star' }),
    statBox('学习中', `${s.learning}`, { iconName: 'book', kind: 'k-target' }),
    statBox('还没碰过', `${s.new}`, { iconName: 'plus', kind: 'k-fire' }),
    statBox('正确率', s.ok + s.err > 0 ? fmtPct(s.ok, s.ok + s.err) : '—', { iconName: 'target', kind: 'k-coin' }),
  ]));

  /* ---- 掌握进度条 ---- */
  frag.append(h('div', { class: 'mastery-block' }, [
    h('div', { class: 'mb-head' }, [
      h('span', { text: `掌握进度（${th} 星算掌握）` }),
      h('b', { text: `${fmtPct(s.mastered, s.total || 1)}` }),
    ]),
    progressBar(s.mastered, s.total, { cls: 'thick' }),
    h('div', { class: 'star-dist' }, s.stars.map((n, star) => h('div', {
      class: 'sd-col', title: `${star} 星：${n} 词`,
    }, [
      h('i', { style: { height: Math.max(2, (n / Math.max(1, ...s.stars)) * 100) + '%' } }),
      h('span', { text: String(star) }),
      h('em', { text: n > 999 ? Math.round(n / 1000) + 'k' : String(n) }),
    ]))),
    h('div', { class: 'sd-legend', text: '柱状图：0 星 → 5 星 的词量分布' }),
  ]));

  /* ---- 逐字母进度 ---- */
  const g = new Map();
  for (const w of words) {
    const L = letterOf(w.w);
    if (!g.has(L)) g.set(L, []);
    g.get(L).push(w);
  }
  const rows = h('div', { class: 'letter-table' });
  rows.append(h('div', { class: 'lt-head' }, [
    h('span', { text: '字母' }), h('span', { text: '词数' }),
    h('span', { text: '已掌握' }), h('span', { text: '掌握率' }),
    h('span', { text: '错次' }),
  ]));
  const ordered = [...letterBreakdown(words)];
  for (const { letter } of ordered) {
    const bucket = g.get(letter) || [];
    const bs = statsOf(bucket, app.progress, bookId, th);
    rows.append(h('div', { class: 'lt-row' }, [
      h('b', { class: 'lt-l', text: letter }),
      h('span', { text: String(bucket.length) }),
      h('span', { text: String(bs.mastered) }),
      h('span', { class: 'lt-p' }, [
        progressBar(bs.mastered, bucket.length, { cls: 'thin' }),
        h('em', { text: fmtPct(bs.mastered, bucket.length) }),
      ]),
      h('span', { class: bs.err > 0 ? 'bad' : '', text: String(bs.err) }),
    ]));
  }
  frag.append(h('div', { class: 'sec-title mt' }, [h('h2', { text: '逐字母进度' })]), rows);

  /* ---- 错词本（错得最多的 20 个） ---- */
  const wrongList = [];
  for (const w of words) {
    const pr = app.progress.get(wordKey(bookId, w.w));
    if (pr && (pr.err || 0) > 0) wrongList.push({ w, pr });
  }
  wrongList.sort((a, b) => (b.pr.err || 0) - (a.pr.err || 0));
  const topWrong = wrongList.slice(0, 20);

  if (topWrong.length) {
    const list = h('div', { class: 'wrong-list' });
    for (const { w, pr } of topWrong) {
      list.append(h('div', { class: 'wrong-row' }, [
        h('div', { class: 'wr-main' }, [
          h('b', { class: 'wr-w', text: w.w }),
          h('span', { class: 'wr-p', text: w.p ? `/${w.p}/` : '' }),
          h('span', { class: 'wr-t', text: w.t }),
        ]),
        h('div', { class: 'wr-right' }, [
          h('span', { class: 'wr-err', text: `错 ${pr.err}` }),
          stars(pr.s || 0, { small: true }),
        ]),
      ]));
    }
    frag.append(h('div', { class: 'sec-title mt' }, [
      h('h2', { text: '错词本' }),
      h('span', { class: 'sec-note', text: `当前筛选下共 ${wrongList.length} 个词错过` }),
    ]), list);
  } else {
    frag.append(h('div', { class: 'sec-title mt' }, [h('h2', { text: '错词本' })]),
      empty('还没有错词，很棒！', 'trophy'));
  }

  /* ---- 历史成绩 ---- */
  const sessions = app.s.sessions || [];
  if (sessions.length) {
    const list = h('div', { class: 'recent-list' });
    for (const r of sessions.slice(0, 10)) {
      const d = new Date(r.at);
      list.append(h('div', { class: 'recent-row' }, [
        h('span', { class: 'rr-name', text: `${new Date(r.at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })} · ${r.selection || r.bookName}` }),
        h('span', { class: 'rr-score', text: `${r.correct}/${r.answered}` }),
        h('span', { class: 'rr-time', text: fmtTime(r.ms) }),
        h('span', { class: `rr-acc ${r.accuracy >= 0.8 ? 'good' : r.accuracy >= 0.5 ? 'mid' : 'bad'}`, text: Math.round(r.accuracy * 100) + '%' }),
      ]));
    }
    frag.append(h('div', { class: 'sec-title mt' }, [h('h2', { text: '历史成绩（最近 10 次）' })]), list);
  }

  /* ---- 数据管理 ---- */
  frag.append(h('div', { class: 'sec-title mt' }, [h('h2', { text: '数据管理' })]));
  frag.append(h('div', { class: 'row-actions wrap' }, [
    btn({
      label: '导出学习进度', iconName: 'save', size: 'sm',
      onclick: () => {
        const payload = {
          format: 'wordhut.progress/v1',
          exported: new Date().toISOString(),
          state: app.s,
          progress: Array.from(app.progress.entries()),
        };
        downloadText(`wordhut-progress-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2));
        app.play('confirm');
        app.toast('已导出学习进度', 'ok');
      },
    }),
    btn({
      label: '重置当前选择进度', iconName: 'warning', size: 'sm', kind: 'ghost',
      onclick: async () => {
        const ok = await app.confirm(
          '重置进度',
          `将清除「${app.selectionLabel()}」范围内所有单词的掌握度与答题记录。此操作不可撤销。`,
          { danger: true, okLabel: '确认重置' },
        );
        if (!ok) return;
        let n = 0;
        for (const w of words) {
          const k = wordKey(bookId, w.w);
          if (app.progress.delete(k)) n += 1;
        }
        app.saveAll();
        app.play('cancel');
        app.toast(`已重置 ${n} 个词的进度`, 'ok');
        app.go('stats');
      },
    }),
    btn({
      label: '清空全部数据', iconName: 'trash', size: 'sm', kind: 'danger',
      onclick: async () => {
        const ok = await app.confirm(
          '清空全部数据',
          '将删除所有词库的掌握度、金币、打卡记录与自定义导入的词库。此操作不可撤销。',
          { danger: true, okLabel: '全部清空' },
        );
        if (!ok) return;
        app.progress.clear();
        store.remove('progress');
        store.remove('userBooks');
        store.remove('state');
        location.reload();
      },
    }),
    h('span', { class: 'muted', text: `本地占用：${fmtBytes(store.usedBytes())}` }),
  ]));

  host.replaceChildren(frag);
  app.setKeyHint('数据全部保存在浏览器本地（localStorage），换浏览器不会同步');
}
