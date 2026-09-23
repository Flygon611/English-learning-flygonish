// 翻卡记忆：翻卡看释义 + 自评「不认识 / 模糊 / 认识 / 熟练」，按自评排复习间隔。

import { h, icon, say, sleep, speechSupported } from '../util.js?v=1b053a4f';
import { btn, panel, stars, progressBar, floatText, empty, sectionTitle } from '../ui/kit.js?v=2f24ea8c';
import { launch, recordAnswer, finishSession, progressOf, voiceLang, readingText, langAttr, speakWord as speakWordShared } from '../session.js?v=c98f7362';
import { orderForExam } from '../srs.js?v=e54c36c9';
import { renderResult } from '../screens/result.js?v=9bcc5429';

/** 自评档位：rating 越大掌握度越高。 */
const RATINGS = [
  { rating: 0, key: '1', label: '不认识', icon: 'close', kind: 'r0', api: { points: 0 } },
  { rating: 1, key: '2', label: '有点印象', icon: 'question', kind: 'r1' },
  { rating: 2, key: '3', label: '认识', icon: 'check', kind: 'r2' },
  { rating: 3, key: '4', label: '很熟练', icon: 'crown', kind: 'r3' },
];

export function render(app) {
  const root = h('div', { class: 'mode-wrap cards-wrap' });
  let session = null;
  let S = null;
  let disposed = false;

  app.onCleanup(() => {
    disposed = true;
    document.removeEventListener('keydown', onKey);
  });

  function start() {
    S = {
      index: 0,
      flipped: false,
      history: [],        // { word, rating }
      counts: [0, 0, 0, 0],
      startedAt: Date.now(),
    };
    paint();
  }

  async function speak(word) {
    app.play('click');
    speakWordShared(app, session, word);
  }

  function rate(rating) {
    if (!S || S.index >= session.words.length) return;
    const word = session.words[S.index];
    const pr = progressOf(app, session.bookId, word.w);
    const before = pr.s || 0;
    recordAnswer(app, session, word.w, rating > 0, { rating });
    S.history.push({ word: word.w, rating, before, after: pr.s || 0 });
    S.counts[rating] += 1;

    if (rating === 0) { session.wrong += 1; app.play('error'); }
    else { session.correct += 1; app.play(rating >= 2 ? 'confirm' : 'select'); }

    S.index += 1;
    S.flipped = false;
    if (S.counts[rating] > 0) floatText(root.querySelector('.cards-hud') || root, `${RATINGS[rating].label}`, rating >= 2 ? 'good' : 'bad');

    if (S.index >= session.words.length) { finish(); return; }
    paint();
  }

  function undo() {
    if (!S.history.length) { app.toast('没有可撤销的操作', 'info', 1400); return; }
    const last = S.history.pop();
    // 把星级还原
    const k = `${session.bookId}|${last.word.toLowerCase()}`;
    const pr = app.progress.get(k);
    if (pr) {
      pr.s = last.before;
      pr.ok = Math.max(0, (pr.ok || 0) - (last.rating > 0 ? 1 : 0));
      pr.err = Math.max(0, (pr.err || 0) - (last.rating === 0 ? 1 : 0));
      pr.c = Math.max(0, (pr.c || 0) - (last.rating > 0 ? 1 : 0));
      if (pr.err === 0) pr.or = 0;
    }
    S.counts[last.rating] -= 1;
    if (last.rating === 0) session.wrong -= 1; else session.correct -= 1;
    S.index = Math.max(0, S.index - 1);
    S.flipped = false;
    app.play('cancel');
    app.markDirty();
    paint();
    app.toast(`已撤销：${last.word}`, 'info', 1400);
  }

  function skip() {
    if (S.index >= session.words.length) return;
    S.index += 1;
    S.flipped = false;
    app.play('back');
    if (S.index >= session.words.length) { finish(); return; }
    paint();
  }

  function finish() {
    const answered = S.counts.reduce((a, b) => a + b, 0);
    // 全部「跳过」也要能收尾
    const summary = finishSession(app, session, answered >= session.words.length ? 'done' : 'quit');
    const rows = [
      h('div', { class: 'tr-row' }, RATINGS.map((r) => h('span', { class: `tr-cell ${r.kind}` }, [
        h('b', { text: String(S.counts[r.rating]) }),
        h('span', { text: r.label }),
      ]))),
    ];
    const node = renderResult(app, summary, {
      onRetry: () => app.go('cards'),
      extraRows: rows,
    });
    paintInto(node);
  }

  /* ---------------- 继续加练 ---------------- */
  function moreCards(n = 10) {
    const extra = orderForExam(session.pool, app.progress, session.bookId, n, S.r || Math.random);
    if (!extra.length) { app.toast('没有更多词了', 'info'); return; }
    session.words = [...session.words, ...extra];
    session.size = session.words.length;
    app.play('coin');
    paint();
  }

  /* ---------------- 渲染 ---------------- */
  function paintInto(node) { root.replaceChildren(node); }

  function paint() {
    if (disposed || !S) return;
    const total = session.words.length;
    const answered = S.counts.reduce((a, b) => a + b, 0);

    /* HUD */
    const hud = h('div', { class: 'cards-hud' }, [
      h('span', { class: 'qh-level', text: `第 ${Math.min(S.index + 1, total)} / ${total} 张` }),
      h('div', { class: 'card-counts' }, RATINGS.map((r) =>
        h('span', { class: `cc ${r.kind}`, title: r.label }, [h('b', { text: String(S.counts[r.rating]) })])),
      ),
    ]);

    /* 进度条 */
    const bar = progressBar(answered, total, { cls: 'thick' });

    if (S.index >= total) { finish(); return; }

    const word = session.words[S.index];
    const pr = progressOf(app, session.bookId, word.w);

    /* 卡片（3D 翻转）
       注意：翻面靠点卡片本体。喇叭按钮必须偏到角落，
       否则它会占住卡片正中 —— 用户点中心点不到卡、只能点到喇叭。 */
    const front = h('div', { class: 'card-face card-front' }, [
      h('div', { class: 'cf-badge', text: '英文' }),
      h('button', {
        class: 'speak-btn corner', type: 'button', title: '朗读（Z / 空格）',
        onclick: (e) => { e.stopPropagation(); speak(word); },
      }, [icon('soundOn', 'ico sm')]),
      h('div', { class: 'cf-word', text: word.w }),
      h('div', { class: 'cf-hint', text: '点击卡片 / 按空格 翻到背面' }),
    ]);

    const back = h('div', { class: 'card-face card-back' }, [
      h('div', { class: 'cf-badge', text: '释义' }),
      h('div', { class: 'cb-word' }, [
        h('b', { text: word.w, ...langAttr(session.lang) }),
        word.p ? h('span', { class: 'cb-phon', text: readingText(session, word.p), ...langAttr(session.lang) }) : null,
      ]),
      h('div', { class: 'cf-meaning', text: word.t }),
      word.x ? h('div', { class: 'cf-ex' }, [
        h('div', { class: 'cf-x', text: word.x, ...langAttr(session.lang) }),
        word.xm ? h('div', { class: 'cf-xm', text: word.xm }) : null,
      ]) : null,
    ]);

    const card = h('div', {
      class: `flip-card ${S.flipped ? 'flipped' : ''}`.trim(),
      // 翻卡用 Kenney 的卡牌滑动音（cardSlide1），而不是通用音效。
      // 注意：原来写的是 app.play('page')，而 'page' 在音效清单里根本不存在，
      // 于是每次翻卡都退化成 WebAudio 兜底的"哔"声。
      onclick: () => {
        S.flipped = !S.flipped;
        card.classList.toggle('flipped');
        app.play('cardFlip');
        paintRatings();
      },
    }, [h('div', { class: 'flip-inner' }, [front, back])]);

    /* 自评按钮（翻面后才可用） */
    const ratingBox = h('div', { class: 'rating-box' });
    function paintRatings() {
      const on = S.flipped;
      ratingBox.replaceChildren(
        h('div', { class: 'rating-tip', text: on ? '你记得多熟？选中后自动进入下一张' : '先翻卡看释义，再自评' }),
        h('div', { class: 'rating-row' }, RATINGS.map((r) =>
          h('button', {
            class: `rate-btn ${r.kind}`,
            type: 'button',
            disabled: !on,
            onclick: () => rate(r.rating),
          }, [icon(r.icon, 'ico sm'), h('span', { text: r.label }), h('em', { text: r.key })]))),
      );
    }
    paintRatings();

    /* 工具条 */
    const tools = h('div', { class: 'card-tools' }, [
      btn({ label: '撤销', iconName: 'back', size: 'sm', kind: 'ghost', onclick: undo }),
      btn({ label: '跳过', iconName: 'arrowRight', size: 'sm', kind: 'ghost', onclick: skip }),
      btn({ label: '加练 10 张', iconName: 'plus', size: 'sm', kind: 'ghost', onclick: () => moreCards(10) }),
      btn({ label: '结束并结算', iconName: 'trophy', size: 'sm', onclick: () => finish() }),
    ]);

    root.replaceChildren(h('div', { class: 'cards-main' }, [
      hud,
      bar,
      h('div', { class: 'card-stage' }, [card]),
      h('div', { class: 'card-meta' }, [
        h('span', { class: 'cm-item' }, ['当前掌握：', stars(pr.s || 0, { small: true })]),
        pr.err ? h('span', { class: 'cm-item bad', text: `错过 ${pr.err} 次` }) : null,
        h('span', { class: 'cm-item muted', text: `共 ${total} 张 · 已完成 ${answered}` }),
      ]),
      ratingBox,
      tools,
    ]));
  }

  /* ---------------- 键盘 ---------------- */
  function onKey(e) {
    if (disposed) return;
    if (S && S.index < session.words.length) {
      if (e.key === ' ') { e.preventDefault(); S.flipped = !S.flipped; paint(); return; }
      if (e.key >= '1' && e.key <= '4') { e.preventDefault(); rate(Number(e.key) - 1); return; }
      if (e.key === 'z' || e.key === 'Z') { e.preventDefault(); speak(session.words[S.index]); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); skip(); return; }
      if (e.key === 'Backspace') { e.preventDefault(); undo(); return; }
    }
    if (e.key === 'Escape') { e.preventDefault(); if (S && S.counts.some((c) => c > 0)) finish(); else app.go('home'); }
  }
  document.addEventListener('keydown', onKey);

  /* ---------------- 入口 ---------------- */
  (async () => {
    root.replaceChildren(h('div', { class: 'loading-line', text: '正在准备卡片…' }));
    try {
      session = await launch(app, 'cards');
      session.r = Math.random;
    } catch (e) {
      root.replaceChildren(panel([
        h('div', { class: 'sec-title' }, [h('h2', { text: '无法开始' })]),
        h('p', { text: String(e.message || e) }),
        btn({ label: '返回', iconName: 'back', onclick: () => app.go('home') }),
      ], 'pad'));
      return;
    }
    if (disposed) return;
    start();
  })();

  app.setKeyHint('空格 翻卡 · 数字键 1-4 自评 · Z 朗读 · → 跳过 · Backspace 撤销 · Esc 结算');
  return root;
}
