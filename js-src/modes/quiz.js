// 四选一闯关：5 关连闯，答错扣血，连击加成。
// 题型：看英文选中文 / 看中文选英文 / 听音选词。

import { h, icon, say, shorten, sensesOverlap, speechSupported, sleep } from '../util.js';
import { btn, panel, hearts, floatText, shake, celebrate, chip } from '../ui/kit.js';
import { launch, recordAnswer, finishSession, progressOf, voiceLang, readingText, langAttr, speakWord as speakWordShared } from '../session.js';
import { pickDistractors, LETTERS } from '../vocab.js';
import { renderResult } from '../screens/result.js';
import { audio } from '../audio.js';

/** 5 个关卡：越往后抽词范围越难（生词→未掌握→全部），容错越低，奖励越高。 */
export const LEVELS = [
  { n: 1, name: '入门', source: 'new', penalty: 500, mult: 1, time: 15 },
  { n: 2, name: '进阶', source: 'newish', penalty: 700, mult: 2, time: 13 },
  { n: 3, name: '挑战', source: 'learning', penalty: 900, mult: 3, time: 11 },
  { n: 4, name: '精英', source: 'due', penalty: 1200, mult: 4, time: 9 },
  { n: 5, name: '大师', source: 'all', penalty: 1500, mult: 5, time: 8 },
];

const QUIZ_TYPE = { W2T: 'w2t', T2W: 't2w', L2T: 'l2t' };

export function render(app) {
  const root = h('div', { class: 'mode-wrap quiz-wrap' });
  document.body.classList.add('in-battle');

  let session = null;
  let S = null;          // 本局状态
  let timers = [];
  let disposed = false;

  const clearTimers = () => { for (const t of timers) clearInterval(t); timers = []; };
  app.onCleanup(() => {
    disposed = true;
    clearTimers();
    document.body.classList.remove('in-battle');
    document.removeEventListener('keydown', onKey);
  });

  function start() {
    S = {
      phase: 'idle',       // idle | levelIntro | ask | feedback | levelUp | over
      drill: !!session.fromSearch,   // 查词练习：单/少词，不按关卡推进
      r: session.r,        // 会话的种子化随机源（出题顺序可复现）
      levelIdx: 0,
      lives: session.maxLives,
      score: 0,
      combo: 0,
      bestCombo: 0,
      qIndex: 0,
      qTotal: 0,
      q: null,
      picked: null,
      used: new Set(),     // 本局已考过的词
      askedAt: 0,
      deadline: 0,
      timeLeft: 0,
      timerId: null,
      correctCount: 0,
      wrongCount: 0,
      lastWrong: null,
    };
    goLevelIntro();
  }

  /* ---------------- 关卡开屏 ---------------- */
  function goLevelIntro() {
    S.phase = 'levelIntro';
    const L = LEVELS[S.levelIdx];
    // 查词练习：只有一两个词，别显示"第 1/5 关""10 题"这类正常关卡信息，会误导
    if (S.drill) {
      root.replaceChildren(h('div', { class: 'quiz-intro' }, [
        h('div', { class: 'qi-badge', text: '查词练习' }),
        h('h1', { class: 'qi-name', text: '练这个词' }),
        h('div', { class: 'qi-facts' }, [
          fact('book', '词库', session.bookName),
          fact('target', '题数', `${session.size} 题`),
          fact('heart', '生命', '不限（答错不扣命）'),
        ]),
        h('p', { class: 'qi-tip', text: '这是从「查单词」进来的专项练习，答错不会中断，练完就回到统计。' }),
        h('div', { class: 'qi-actions' }, [
          btn({ label: '开始', iconName: 'arrowRight', kind: 'primary', onclick: () => beginLevel() }),
          btn({ label: '返回查词', iconName: 'back', kind: 'ghost', onclick: () => app.go('search') }),
        ]),
      ]));
      app.setKeyHint('Enter / 空格 开始本关 · Esc 退出');
      return;
    }
    const round = LEVELS.length;
    root.replaceChildren(h('div', { class: 'quiz-intro' }, [
      h('div', { class: 'qi-badge', text: `第 ${L.n} / ${round} 关` }),
      h('h1', { class: 'qi-name', text: L.name }),
      h('div', { class: 'qi-facts' }, [
        fact('target', '本关题数', `${app.st.quizSize} 题`),
        fact('hourglass', app.st.timer ? '每题限时' : '限时', app.st.timer ? `${L.time} 秒` : '已关闭'),
        fact('warning', '答错扣时', `${L.penalty} 毫秒`),
        fact('coin', '得分倍率', `×${L.mult}`),
        fact('heart', '剩余生命', `${S.lives} / ${session.maxLives}`),
      ]),
      h('p', { class: 'qi-tip', text: levelTip(L) }),
      h('div', { class: 'qi-actions' }, [
        btn({ label: '开始', iconName: 'arrowRight', kind: 'primary', onclick: () => beginLevel() }),
        btn({ label: '退出', iconName: 'home', kind: 'ghost', onclick: () => quit() }),
      ]),
    ]));
    app.setKeyHint('Enter / 空格 开始本关 · Esc 退出');
  }

  function levelTip(L) {
    switch (L.source) {
      case 'new': return '本关只出生词 —— 完全不认识也没关系，答错正好记住它。';
      case 'newish': return '本关以生词和没掌握的词为主。';
      case 'learning': return '本关抽「正在学」的词，考的是记不记得住。';
      case 'due': return '本关优先考到了该复习时间的词。';
      default: return '本关从整个词库范围抽题，包括你已经背熟的词。';
    }
  }

  const fact = (ic, k, v) => h('div', { class: 'qi-fact' }, [icon(ic), h('span', { text: k }), h('b', { text: v })]);

  function beginLevel() {
    const L = LEVELS[S.levelIdx];
    S.phase = 'ask';
    S.qIndex = 0;
    S.qTotal = app.st.quizSize;
    app.play('confirm');
    nextQuestion();
  }

  /* ---------------- 抽词 ---------------- */
  function sourcePool(L) {
    const session2 = session;
    const pr = (w) => app.progress.get(`${session2.bookId}|${w.w.toLowerCase()}`);
    const all = session.pool;
    const isNew = (w) => { const p = pr(w); return !p || ((p.s || 0) === 0 && (p.ok || 0) === 0 && (p.err || 0) === 0); };
    const now = Date.now();
    const isDue = (w) => { const p = pr(w); return !p || (p.next || 0) <= now; };
    const unmastered = (w) => { const p = pr(w); return !p || (p.s || 0) < (app.st.masterThreshold || 5); };

    let pool;
    switch (L.source) {
      case 'new': pool = all.filter(isNew); break;
      case 'newish': pool = all.filter((w) => isNew(w) || unmastered(w)); break;
      case 'learning': pool = all.filter((w) => !isNew(w) && unmastered(w)); break;
      case 'due': pool = all.filter((w) => !isNew(w) && isDue(w)); break;
      default: pool = all;
    }
    // 退级兜底：该范围没词了就放宽
    for (const fb of [all.filter((w) => isNew(w) || unmastered(w)), all.filter(isNew), all]) {
      if (pool.length >= 4) break;
      if (pool.length < 4) pool = fb;
    }
    return pool.length >= 4 ? pool : all;
  }

  function pullWord(L) {
    const pool = sourcePool(L);
    const fresh = pool.filter((w) => !S.used.has(w.w));
    const from = fresh.length >= 4 ? fresh : pool;
    const w = from[Math.floor(S.r() * from.length)];
    S.used.add(w.w);
    return w;
  }

  /* ---------------- 生成题目 ---------------- */
  function makeQuestion(L) {
    const w = pullWord(L);
    const roll = S.r();
    // 听音题需要系统语音可用；占比约 22%
    const useListen = st_autoSpeak() && speechSupported() && roll < 0.22;
    const type = useListen ? QUIZ_TYPE.L2T : (roll < 0.6 ? QUIZ_TYPE.W2T : QUIZ_TYPE.T2W);

    // needZh：中文题面不许出现英文选项（日语词库约 10% 词条没取到中文释义）
    const needZh = session.lang === 'ja' && !!w.zhSource && w.zhSource !== 'none';
    const distractors = pickDistractors(session.pool, w, 3, S.r, { sensesOverlap, needZh });
    while (distractors.length < 3) {
      // 极端情况（词库太小）兜底：放宽重复限制
      const cand = session.pool[Math.floor(S.r() * session.pool.length)];
      if (cand && cand.w !== w.w) distractors.push({ value: cand.t, word: cand });
    }
    const options = [w, ...distractors.map((d) => d.word)];
    for (let i = options.length - 1; i > 0; i--) {
      const j = Math.floor(S.r() * (i + 1));
      [options[i], options[j]] = [options[j], options[i]];
    }

    const q = {
      word: w,
      type,
      level: L,
      options,
      correctIndex: options.findIndex((o) => o.w === w.w),
      timeLimit: app.st.timer ? L.time : 0,
      answered: false,
    };
    // 自动化测试挂钩：把当前会话与题目挂到 window 上，
    // 测试脚本据此知道正确答案，才能「自动打穿 5 关」做回归（见 tools/check_wordgame_browser.mjs）。
    // 正常游玩不受影响（纯读取，无副作用）。
    window.__WORDHUT_TEST__ = { session, q, state: S };
    // 题面用词随词库语言变化 —— 日语词库里写"英文单词"是错的（实测出现过
    // 「选出对应的英文单词」配 塩/店/五/なぜ 这种自相矛盾的题面）
    const ja = session.lang === 'ja';
    if (type === QUIZ_TYPE.L2T) {
      q.prompt = '';
      q.promptLabel = '听发音，选出对应的中文释义';
    } else if (type === QUIZ_TYPE.W2T) {
      q.prompt = w.w;
      q.promptLabel = '选出正确的中文释义';
    } else {
      q.prompt = shorten(w.t, 60);
      q.promptLabel = ja ? '选出对应的日语单词' : '选出对应的英文单词';
    }
    return q;
  }

  const st_autoSpeak = () => app.st.autoSpeak;

  /* ---------------- 出下一题 ---------------- */
  function nextQuestion() {
    if (disposed) return;
    if (!S || S.phase === 'over') return;

    if (S.qIndex >= S.qTotal) { levelCleared(); return; }

    const L = LEVELS[S.levelIdx];
    S.q = makeQuestion(L);
    S.picked = null;
    S.qIndex += 1;
    S.phase = 'ask';
    S.askedAt = performance.now();
    S.deadline = L.time * 1000;
    S.timeLeft = L.time * 1000;

    paint();

    if (S.q.type === QUIZ_TYPE.L2T) {
      setTimeout(() => { if (S.phase === 'ask') speakWord(S.q.word); }, 180);
    }
    if (app.st.timer) startTimer();
  }

  function startTimer() {
    clearTimers();
    const tick = 60;
    const id = setInterval(() => {
      if (disposed || S.phase !== 'ask') return;
      S.timeLeft -= tick;
      if (S.timeLeft <= 0) {
        S.timeLeft = 0;
        clearTimers();
        onTimeout();
        return;
      }
      const bar = root.querySelector('.qt-fill');
      if (bar) {
        const frac = Math.max(0, Math.min(1, S.timeLeft / S.deadline));
        bar.style.width = (frac * 100).toFixed(1) + '%';
        bar.style.background = frac > 0.5 ? 'var(--green)' : frac > 0.25 ? 'var(--gold)' : 'var(--red)';
      }
    }, tick);
    timers.push(id);
  }

  function onTimeout() {
    if (!S || S.phase !== 'ask') return;
    app.play('error');
    submit(LEVELS[S.levelIdx], null, true);
  }

  /* ---------------- 作答 ---------------- */
  function choose(idx) {
    if (!S || S.phase !== 'ask' || !S.q) return;
    const L = LEVELS[S.levelIdx];
    submit(L, idx, false);
  }

  function submit(L, idx, timedOut) {
    clearTimers();
    const q = S.q;
    const correct = idx === q.correctIndex;
    S.picked = idx;
    S.phase = 'feedback';
    q.answered = true;

    const elapsed = performance.now() - S.askedAt;

    if (correct) {
      S.correctCount += 1;
      S.combo += 1;
      S.bestCombo = Math.max(S.bestCombo, S.combo);
      // 基础分 × 关卡倍率 × 速度奖励 × 连击奖励
      const speedBonus = app.st.timer ? Math.max(1, 2 - elapsed / (L.time * 1000)) : 1.2;
      const comboBonus = 1 + Math.min(S.combo, 10) * 0.05;
      const gain = Math.round(60 * L.mult * speedBonus * comboBonus);
      S.score += gain;
      session.score = S.score;
      session.correct += 1;
      session.combo = S.combo;
      session.bestCombo = S.bestCombo;
      recordAnswer(app, session, q.word.w, true, { points: 10 + L.n * 2 });
      app.play(S.combo >= 5 ? 'levelup' : 'confirm');
      floatText(root.querySelector('.quiz-hud') || root, `+${gain}`, 'good');
      if (S.combo > 0 && S.combo % 5 === 0) {
        floatText(root, `连击 ×${S.combo}！`, 'combo');
        app.play('coin');
      }
    } else {
      S.wrongCount += 1;
      S.combo = 0;
      session.combo = 0;
      session.wrong += 1;
      S.lives -= 1;
      S.lastWrong = q.word.w;
      recordAnswer(app, session, q.word.w, false);
      app.play('error');
      shake(root.querySelector('.quiz-main') || root);
      floatText(root.querySelector('.qcard') || root, `-${L.penalty}ms`, 'bad');
    }

    app.s.total.correct = (app.s.total.correct || 0) + (correct ? 1 : 0);
    app.s.total.wrong = (app.s.total.wrong || 0) + (correct ? 0 : 1);
    app.markDirty();

    paint();

    if (S.lives <= 0) {
      setTimeout(() => gameOver(), 900);
      return;
    }
    // 自动进入下一题
    const wait = correct ? 900 : 1700;
    const id = setTimeout(() => nextQuestion(), wait);
    timers.push(id);
  }

  function levelCleared() {
    clearTimers();
    const L = LEVELS[S.levelIdx];
    const bonus = 200 * L.mult;
    S.score += bonus;
    session.score = S.score;
    if (S.levelIdx >= LEVELS.length - 1) { victory(); return; }

    S.phase = 'levelUp';
    app.play('victory');
    paint();
    const id = setTimeout(() => {
      S.levelIdx += 1;
      S.qIndex = 0;                       // 新关卡必须从第 1 题开始
      S.q = null;
      goLevelIntro();
    }, 2200);
    timers.push(id);
  }

  function victory() {
    S.phase = 'over';
    const summary = finishSession(app, session, 'clear');
    celebrate('全部通关！', `总分 ${S.score} · 金币 +${summary.coins}`);
    app.play('levelup');
    setTimeout(() => {
      if (disposed) return;
      renderInto(renderResult(app, summary, {
        onRetry: () => app.go('quiz'),
        extraRows: [h('div', { class: 'result-extra', text: `五关全部通关，总分 ${S.score}（含通关奖励 ${200 * LEVELS[4].mult}）` })],
      }));
    }, 1600);
  }

  function gameOver() {
    clearTimers();
    S.phase = 'over';
    const summary = finishSession(app, session, 'dead');
    app.play('faint');
    renderInto(renderResult(app, summary, {
      onRetry: () => app.go('quiz'),
      extraRows: [
        h('div', { class: 'result-extra', text: `倒在第 ${LEVELS[S.levelIdx].n} 关（${LEVELS[S.levelIdx].name}）· 总分 ${S.score}` }),
        S.lastWrong ? h('div', { class: 'result-extra muted', text: `最后绊住你的词：${S.lastWrong}` }) : null,
      ].filter(Boolean),
    }));
  }

  async function quit() {
    if (S && S.phase !== 'over' && (session.correct + session.wrong) > 0) {
      const ok = await app.confirm('退出本局？', '当前进度会记入统计，但不会结算通关奖励。', { okLabel: '退出', danger: true });
      if (!ok) return;
    }
    clearTimers();
    S && (S.phase = 'over');
    if (session && !session.finished) finishSession(app, session, 'quit');
    app.go('home');
  }

  /* ---------------- 界面渲染 ---------------- */
  function paint() {
    if (disposed || !S) return;
    const L = LEVELS[S.levelIdx];

    // 每帧同步键盘提示，避免显示上一阶段的操作说明
    if (S.phase === 'levelIntro') app.setKeyHint('Enter / 空格 开始本关 · Esc 退出');
    else if (S.phase === 'feedback') app.setKeyHint('Enter / 空格 下一题 · Esc 退出');
    else if (S.phase !== 'over') app.setKeyHint('数字键 1-4 选答案 · Z / 空格 朗读 · Esc 退出');

    if (S.phase === 'levelIntro') return;   // 介绍页由 goLevelIntro 自己负责绘制
    if (S.phase === 'levelUp') {
      const nl = LEVELS[S.levelIdx + 1];
      root.replaceChildren(h('div', { class: 'quiz-levelup' }, [
        icon('trophy', 'ico big'),
        h('h1', { text: `第 ${L.n} 关通过！` }),
        h('p', { text: `过关奖励 +${200 * L.mult} 分` }),
        h('p', { class: 'muted', text: `下一关：${nl.name}（抽词更难 · 限时 ${app.st.timer ? nl.time + ' 秒' : '不限时'}）` }),
      ]));
      return;
    }

    if (root.querySelector('.quiz-levelup')) root.replaceChildren();

    const q = S.q;
    const inFb = S.phase === 'feedback';

    const hud = h('div', { class: 'quiz-hud' }, [
      h('div', { class: 'qh-left' }, [
        h('span', { class: 'qh-level', text: `第 ${L.n} 关 · ${L.name}` }),
        h('span', { class: 'qh-progress', text: `第 ${Math.min(S.qIndex, S.qTotal)} / ${S.qTotal} 题` }),
      ]),
      h('div', { class: 'qh-right' }, [
        hearts(S.lives, session.maxLives),
        h('span', { class: 'qh-score' }, [icon('star', 'ico sm'), h('b', { text: String(S.score) })]),
        S.combo >= 2 ? h('span', { class: 'qh-combo', text: `连击 ×${S.combo}` }) : null,
      ]),
    ]);

    /* --- 时间条：剩余时间越多越绿，越少越红（不要用固定渐变，否则满格时是红色，看着像危险） --- */
    const frac = S.deadline > 0 ? Math.max(0, Math.min(1, S.timeLeft / S.deadline)) : 1;
    const timerBar = app.st.timer
      ? h('div', { class: 'qt-bar' }, [
          h('i', {
            class: 'qt-fill',
            style: {
              width: (frac * 100).toFixed(1) + '%',
              background: frac > 0.5 ? 'var(--green)' : frac > 0.25 ? 'var(--gold)' : 'var(--red)',
            },
          }),
        ])
      : null;

    const promptEl = h('div', { class: 'qcard' }, [
      h('div', { class: 'q-label', text: q.promptLabel }),
      q.type === QUIZ_TYPE.L2T
        ? h('div', { class: 'q-listen' }, [
            h('button', { class: 'listen-btn', type: 'button', onclick: () => speakWord(q.word) }, [icon('soundOn', 'ico big')]),
            h('span', { class: 'q-listen-tip', text: '点击喇叭再听一次（Z / 空格）' }),
          ])
        : q.type === QUIZ_TYPE.W2T
          ? h('div', { class: 'q-word' }, [
              h('b', { text: q.prompt, ...langAttr(session.lang) }),
              h('button', { class: 'speak-btn', type: 'button', title: '朗读', onclick: () => speakWord(q.word) }, [icon('soundOn', 'ico sm')]),
            ])
          : h('div', { class: 'q-word cn', text: q.prompt }),
      q.type !== QUIZ_TYPE.W2T && app.st.showPhonetic && q.word.p
        ? h('div', { class: 'q-phon', text: readingText(session, q.word.p), ...langAttr(session.lang) })
        : null,
      q.type === QUIZ_TYPE.W2T && app.st.showPhonetic && q.word.p && !inFb
        ? h('div', { class: 'q-phon', text: readingText(session, q.word.p), ...langAttr(session.lang) })
        : null,
    ]);

    /* --- 选项 --- */
    const opts = h('div', { class: 'q-options' });
    q.options.forEach((o, i) => {
      const isCorrect = i === q.correctIndex;
      const isPicked = i === S.picked;
      let cls = 'q-opt';
      if (inFb) {
        if (isCorrect) cls += ' right';
        else if (isPicked) cls += ' wrong';
        else cls += ' dim';
      }
      opts.append(h('button', {
        class: cls,
        type: 'button',
        disabled: inFb,
        onclick: () => choose(i),
      }, [
        h('span', { class: 'qo-key', text: String(i + 1) }),
        h('span', { class: 'qo-text', text: q.type === QUIZ_TYPE.T2W ? o.w : shorten(o.t, 40), ...langAttr(q.type === QUIZ_TYPE.T2W ? session.lang : 'zh') }),
        inFb && isCorrect ? icon('check', 'ico sm') : null,
        inFb && isPicked && !isCorrect ? icon('close', 'ico sm') : null,
      ]));
    });

    /* --- 反馈 --- */
    let fb = null;
    if (inFb) {
      const correct = S.picked === q.correctIndex;
      const pr = progressOf(app, session.bookId, q.word.w);
      fb = h('div', { class: `q-feedback ${correct ? 'ok' : 'bad'}` }, [
        h('div', { class: 'fb-head' }, [
          icon(correct ? 'check' : 'close', 'ico sm'),
          h('b', { text: correct ? '答对了！' : (S.picked === null ? '时间到！' : '答错了') }),
          h('span', { class: 'fb-star', text: `掌握 ${'★'.repeat(pr.s || 0)}${'☆'.repeat(5 - (pr.s || 0))}` }),
        ]),
        h('div', { class: 'fb-word' }, [
          h('b', { class: 'fb-w', text: q.word.w, ...langAttr(session.lang) }),
          h('button', { class: 'speak-btn', type: 'button', title: '朗读单词', onclick: () => speakWord(q.word) }, [icon('soundOn', 'ico sm')]),
          q.word.p ? h('span', { class: 'fb-p', text: readingText(session, q.word.p), ...langAttr(session.lang) }) : null,
        ]),
        h('div', { class: 'fb-t', text: q.word.t }),
        app.st.showExample && q.word.x
          ? h('div', { class: 'fb-ex' }, [
              h('div', { class: 'fb-x', text: q.word.x, ...langAttr(session.lang) }),
              q.word.xm ? h('div', { class: 'fb-xm', text: q.word.xm }) : null,
            ])
          : null,
        h('div', { class: 'fb-actions' }, [
          btn({ label: '下一题', iconName: 'arrowRight', size: 'sm', kind: 'primary', onclick: () => { clearTimers(); nextQuestion(); } }),
        ]),
      ]);
    }

    root.replaceChildren(h('div', { class: 'quiz-main' }, [hud, timerBar, promptEl, opts, fb]));
  }

  function speakWord(word) {
    app.play('click');
    speakWordShared(app, session, word);
  }

  /* ---------------- 键盘 ---------------- */
  function onKey(e) {
    if (disposed) return;
    if (e.key === 'Escape') { e.preventDefault(); quit(); return; }
    if (!S) return;

    if (S.phase === 'levelIntro' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); beginLevel(); return; }
    if (S.phase === 'ask') {
      if (e.key >= '1' && e.key <= '4') { e.preventDefault(); choose(Number(e.key) - 1); return; }
      if (e.key === 'z' || e.key === 'Z' || e.key === ' ') { e.preventDefault(); speakWord(S.q.word); return; }
    }
    if (S.phase === 'feedback' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); clearTimers(); nextQuestion(); }
  }
  document.addEventListener('keydown', onKey);

  /* ---------------- 入口 ---------------- */
  function renderInto(node) {
    root.replaceChildren(node);
  }

  // 加载词表后开局。
  // 支持两种入口：
  //   1) 正常开局：按当前词库 + 字母筛选抽题（launch）
  //   2) 查单词页点「练这个词」：app.currentParams.drill 带着准备好的会话直接开
  (async () => {
    root.replaceChildren(h('div', { class: 'loading-line', text: '正在准备词表…' }));
    try {
      session = app.currentParams?.drill || await launch(app, 'quiz');
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

  app.setKeyHint('数字键 1-4 选答案 · Z / 空格 朗读 · Enter 下一题 · Esc 退出');
  return root;
}
