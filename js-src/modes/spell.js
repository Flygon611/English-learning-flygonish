// 拼写填空：看中文释义拼出英文单词。
// 两种作答方式：键盘输入（默认）/ 从打乱的字母里点选。

import { h, icon, say, shorten } from '../util.js?v=4e5abe9c';
import { btn, panel, progressBar, floatText, shake, hearts, stars } from '../ui/kit.js?v=2f24ea8c';
import { launch, recordAnswer, finishSession, progressOf, voiceLang, readingText, langAttr, speakWord as speakWordShared } from '../session.js?v=26ba47b3';
import { normalizeSpell, isSpellCorrect, similarity, diffChars, maskWord, letterBank } from '../spell.js?v=5a536d8a';
import { renderResult } from '../screens/result.js?v=9bcc5429';

export function render(app) {
  const root = h('div', { class: 'mode-wrap spell-wrap' });
  let session = null;
  let S = null;
  let disposed = false;
  let inputEl = null;

  app.onCleanup(() => {
    disposed = true;
    document.removeEventListener('keydown', onKey);
  });

  function start() {
    S = {
      index: 0,
      input: '',            // 键盘模式
      picked: [],           // 字母模式：已点选的字母 id
      status: 'ask',        // ask | right | wrong | giveup
      hints: 0,
      queue: session.words.map((w) => ({ w })),
      total: session.words.length,
      firstTry: true,
      usedBank: null,
    };
    paint();
  }

  const current = () => S.queue[S.index];

  async function speak(word) {
    app.play('click');
    speakWordShared(app, session, word);
  }

  function hint() {
    if (!S || S.status !== 'ask') return;
    S.hints += 1;
    app.play('select');
    if (S.hints >= 3) {
      // 三次提示后直接给答案（算答错）
      S.status = 'giveup';
      const pr = progressOf(app, session.bookId, current().w.w);
      recordAnswer(app, session, current().w.w, false);
      session.wrong += 1;
      app.play('error');
      paint();
      return;
    }
    paint();
  }

  /* ---------------- 提交 ---------------- */
  function submit() {
    if (!S || S.status !== 'ask') return;
    const { w } = current();
    const guess = app.st.spellMode === 'letters'
      ? S.picked.map((p) => p.ch).join('')
      : inputEl ? inputEl.value : S.input;

    if (!normalizeSpell(guess)) { app.toast('还没拼写呢', 'warn', 1200); return; }

    const correct = isSpellCorrect(guess, w.w);
    const pr = progressOf(app, session.bookId, w.w);
    const before = pr.s || 0;

    if (correct) {
      const points = S.firstTry ? 12 : 6;
      recordAnswer(app, session, w.w, true, { points });
      session.correct += 1;
      session.combo += 1;
      session.bestCombo = Math.max(session.bestCombo, session.combo);
      S.status = 'right';
      S.scoreGain = Math.round(40 * (S.firstTry ? 1 : 0.5) * (1 + Math.min(session.combo, 8) * 0.06));
      session.score += S.scoreGain;
      app.play(session.combo >= 5 ? 'levelup' : 'confirm');
      floatText(root.querySelector('.spell-hud') || root, `+${S.scoreGain}`, 'good');
    } else {
      recordAnswer(app, session, w.w, false);
      session.wrong += 1;
      session.combo = 0;
      S.status = 'wrong';
      S.sim = similarity(guess, w.w);
      S.diff = diffChars(guess, w.w);
      app.play('error');
      shake(root.querySelector('.spell-card') || root);
    }
    S.lastGuess = guess;
    S.lastStar = { before, after: pr.s || 0 };
    app.markDirty();
    paint();
  }

  /** 答错后「再试一次」：把该词排到队尾。 */
  function retry() {
    const item = current();
    S.queue.push({ w: item.w });
    S.firstTry = false;
    S.index += 1;
    resetInput();
    paint();
  }

  function next() {
    S.index += 1;
    S.firstTry = true;
    resetInput();
    if (S.index >= S.queue.length) { finish(); return; }
    paint();
  }

  function resetInput() {
    S.input = '';
    S.picked = [];
    S.status = 'ask';
    S.hints = 0;
    S.usedBank = null;
    S.diff = null;
    S.lastGuess = '';
  }

  function skip() {
    app.play('back');
    next();
  }

  function finish() {
    const summary = finishSession(app, session, 'done');
    paintInto(renderResult(app, summary, {
      onRetry: () => app.go('spell'),
      extraRows: [
        h('div', { class: 'result-extra', text: `本组共出现 ${S.queue.length} 次（含重练）` }),
      ],
    }));
  }

  function paintInto(node) { root.replaceChildren(node); }

  /* ---------------- 渲染 ---------------- */
  function paint() {
    if (disposed || !S) return;
    if (S.index >= S.queue.length) { finish(); return; }

    const { w } = current();
    const pr = progressOf(app, session.bookId, w.w);
    const answered = session.correct + session.wrong;

    const hud = h('div', { class: 'spell-hud' }, [
      h('span', { class: 'qh-level', text: `第 ${S.index + 1} / ${S.queue.length} 题` }),
      h('div', { class: 'qh-right' }, [
        h('span', { class: 'qh-score' }, [icon('star', 'ico sm'), h('b', { text: String(session.score) })]),
        session.combo >= 2 ? h('span', { class: 'qh-combo', text: `连击 ×${session.combo}` }) : null,
      ]),
    ]);

    /* 题干：中文释义 */
    const card = h('div', { class: 'spell-card' }, [
      h('div', { class: 'sc-label', text: session.lang === 'ja' ? '请拼出对应的日语单词' : '请拼出对应的英文单词' }),
      h('div', { class: 'sc-meaning', text: w.t }),
      w.p && app.st.showPhonetic && S.status !== 'ask'
        ? h('div', { class: 'sc-phon', text: readingText(session, w.p), ...langAttr(session.lang) })
        : null,
      h('div', { class: 'sc-meta' }, [
        h('span', {}, [icon(w.w.includes(' ') ? 'scroll' : 'note', 'ico xs'), h('span', { text: `${w.w.includes(' ') ? '词组' : '单词'} · ${w.w.replace(/[a-z]/gi, '·').length} 个字符` })]),
        h('span', { class: 'muted' }, ['掌握：', stars(pr.s || 0, { small: true })]),
      ]),
    ]);

    /* 空格提示：以 _ 表示 */
    const spaces = h('div', { class: 'spell-slots' }, Array.from(w.w).map((ch, i) => {
      let cls = 'slot';
      let text = '';
      if (ch === ' ') { cls += ' space'; text = '␣'; }
      else if (ch === '-') { cls += ' fixed'; text = '-'; }
      else if (ch === "'") { cls += ' fixed'; text = "'"; }
      else if (S.hints >= 1) {
        const mask = maskWord(w.w, S.hints >= 2 ? 0.85 : 0.4, mulberryish(S.index * 31 + S.hints));
        const m = Array.from(mask);
        if (m[i] !== '_') { cls += ' hinted'; text = m[i]; }
      }
      return h('i', { class: cls, text });
    }));

    /* 作答区 */
    let answerBox = null;
    if (app.st.spellMode === 'letters') {
      if (!S.usedBank || S.usedBank.for !== w.w) {
        S.usedBank = { for: w.w, letters: letterBank(w.w, mulberryish(S.index * 7 + 3)) };
      }
      const chosen = S.picked.map((p) => p.ch).join('');
      const bank = h('div', { class: 'letter-bank' }, S.usedBank.letters.map((L) =>
        h('button', {
          class: `bank-key ${S.picked.some((p) => p.id === L.id) ? 'used' : ''}`.trim(),
          type: 'button',
          disabled: S.status !== 'ask' || S.picked.some((p) => p.id === L.id),
          onclick: () => {
            S.picked.push(L);
            app.play('tick');
            paint();
          },
        }, [L.ch])));
      answerBox = h('div', { class: 'answer-box letters' }, [
        h('div', { class: 'typed-letters' }, S.picked.length
          ? S.picked.map((p, i) => h('button', {
              class: 'tk',
              type: 'button',
              onclick: () => {
                if (S.status !== 'ask') return;
                S.picked.splice(i, 1);
                app.play('back');
                paint();
              },
            }, [p.ch]))
          : [h('span', { class: 'tk empty', text: '点下面的字母拼写' })]),
        bank,
        h('div', { class: 'answer-actions' }, [
          btn({ label: '退格', iconName: 'back', size: 'sm', kind: 'ghost', disabled: S.status !== 'ask', onclick: () => { S.picked.pop(); app.play('back'); paint(); } }),
          btn({ label: '提交', iconName: 'check', size: 'sm', kind: 'primary', disabled: S.status !== 'ask', onclick: submit }),
        ]),
      ]);
      // 记录用于提交
      S.input = chosen;
    } else {
      inputEl = h('input', {
        class: 'spell-input',
        type: 'text',
        autocomplete: 'off',
        autocapitalize: 'off',
        autocorrect: 'off',
        spellcheck: 'false',
        placeholder: '在这里输入英文…',
        value: S.status === 'ask' ? S.input : (S.lastGuess || ''),
        disabled: S.status !== 'ask',
        oninput: (e) => { S.input = e.target.value; },
        onkeydown: (e) => {
          if (e.key === 'Enter') { e.preventDefault(); if (S.status === 'ask') submit(); else next(); }
          e.stopPropagation();
        },
      });
      answerBox = h('div', { class: 'answer-box' }, [
        inputEl,
        h('div', { class: 'answer-actions' }, [
          btn({ label: '提交', iconName: 'check', size: 'sm', kind: 'primary', disabled: S.status !== 'ask', onclick: submit }),
        ]),
      ]);
    }

    /* 反馈 */
    const fb = h('div', { class: 'spell-feedback' });
    if (S.status === 'right') {
      fb.append(h('div', { class: 'sf-box ok' }, [
        h('div', { class: 'sf-head' }, [icon('check', 'ico sm'), h('b', { text: '拼写正确！' }), h('span', { class: 'fb-star', text: `掌握 ${'★'.repeat(S.lastStar?.after || 0)}${'☆'.repeat(5 - (S.lastStar?.after || 0))}` })]),
        h('div', { class: 'sf-word' }, [
          h('b', { text: w.w, ...langAttr(session.lang) }),
          h('button', { class: 'speak-btn', type: 'button', onclick: () => speak(w) }, [icon('soundOn', 'ico sm')]),
          w.p ? h('span', { class: 'muted', text: readingText(session, w.p) }) : null,
        ]),
        app.st.showExample && w.x ? h('div', { class: 'fb-ex' }, [
          h('div', { class: 'fb-x', text: w.x, ...langAttr(session.lang) }),
          w.xm ? h('div', { class: 'fb-xm', text: w.xm }) : null,
        ]) : null,
        h('div', { class: 'answer-actions' }, [
          btn({ label: '下一题', iconName: 'arrowRight', size: 'sm', kind: 'primary', onclick: next }),
        ]),
      ]));
    } else if (S.status === 'wrong') {
      fb.append(h('div', { class: 'sf-box bad' }, [
        h('div', { class: 'sf-head' }, [icon('close', 'ico sm'), h('b', { text: '拼错了' }),
          h('span', { class: 'muted', text: `相似度 ${Math.round((S.sim || 0) * 100)}%` })]),
        h('div', { class: 'sf-diff' }, (S.diff || []).map((d) =>
          h('i', { class: `dc ${d.kind}`, text: d.ch === ' ' ? '␣' : d.ch }))),
        h('div', { class: 'sf-answer' }, [
          h('span', { text: '正确拼写：' }),
          h('b', { text: w.w, ...langAttr(session.lang) }),
          h('button', { class: 'speak-btn', type: 'button', onclick: () => speak(w) }, [icon('soundOn', 'ico sm')]),
        ]),
        h('div', { class: 'sf-t', text: w.t }),
        app.st.showExample && w.x ? h('div', { class: 'fb-ex' }, [
          h('div', { class: 'fb-x', text: w.x, ...langAttr(session.lang) }),
          w.xm ? h('div', { class: 'fb-xm', text: w.xm }) : null,
        ]) : null,
        h('div', { class: 'answer-actions' }, [
          btn({ label: '再试一次（排到队尾）', iconName: 'back', size: 'sm', onclick: retry }),
          btn({ label: '下一题', iconName: 'arrowRight', size: 'sm', kind: 'primary', onclick: next }),
        ]),
      ]));
    } else if (S.status === 'giveup') {
      fb.append(h('div', { class: 'sf-box bad' }, [
        h('div', { class: 'sf-head' }, [icon('info', 'ico sm'), h('b', { text: '提示用完了' })]),
        h('div', { class: 'sf-answer' }, [
          h('span', { text: '正确拼写：' }), h('b', { text: w.w, ...langAttr(session.lang) }),
          h('button', { class: 'speak-btn', type: 'button', onclick: () => speak(w) }, [icon('soundOn', 'ico sm')]),
        ]),
        h('div', { class: 'sf-t', text: w.t }),
        h('div', { class: 'answer-actions' }, [
          btn({ label: '记住了，下一题', iconName: 'arrowRight', size: 'sm', kind: 'primary', onclick: next }),
        ]),
      ]));
    }

    /* 工具条 */
    const tools = h('div', { class: 'card-tools' }, [
      btn({ label: '提示', iconName: 'info', size: 'sm', kind: 'ghost', disabled: S.status !== 'ask', onclick: hint }),
      btn({ label: '跳过', iconName: 'arrowRight', size: 'sm', kind: 'ghost', onclick: skip }),
      btn({ label: '朗读', iconName: 'soundOn', size: 'sm', kind: 'ghost', onclick: () => speak(w) }),
      btn({ label: '结算', iconName: 'trophy', size: 'sm', kind: 'ghost', onclick: () => finish() }),
    ]);

    root.replaceChildren(h('div', { class: 'spell-main' }, [
      hud,
      progressBar(answered, Math.max(1, session.size), { cls: 'thick' }),
      card,
      spaces,
      answerBox,
      fb,
      tools,
    ]));

    if (inputEl && S.status === 'ask') {
      setTimeout(() => { inputEl?.focus(); }, 30);
    }

    // 拼写题可选用朗读
    if (app.st.spellSound && S.status === 'ask' && S.index >= 0) {
      speakWordShared(app, session, w, { rate: 0.8 });
    }
  }

  /* 确定性伪随机（提示掩码与字母银行要稳定，不能在重绘时变） */
  function mulberryish(seed) {
    let a = (seed * 2654435761) >>> 0;
    return () => {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------------- 键盘 ---------------- */
  function onKey(e) {
    if (disposed || !S) return;
    const typing = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');
    if (e.key === 'Escape') { e.preventDefault(); finish(); return; }
    if (typing) return;                       // 输入框里交给 input 自己处理

    if (S.status === 'ask') {
      if (e.key === 'z' || e.key === 'Z') { e.preventDefault(); speak(current().w); return; }
      if (e.key === 'Tab') { e.preventDefault(); hint(); return; }
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (S.status === 'wrong') retry(); else next();
    }
  }
  document.addEventListener('keydown', onKey);

  /* ---------------- 入口 ---------------- */
  (async () => {
    root.replaceChildren(h('div', { class: 'loading-line', text: '正在准备题目…' }));
    try {
      session = await launch(app, 'spell');
      session.combo = 0;
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

  app.setKeyHint('输入后按 Enter 提交 · Tab 提示（3 次用完）· Z 朗读 · Esc 结算');
  return root;
}
