// 查单词页：跨全部词库搜索，可看掌握度、可朗读、可直接开练。

import { h, icon, say } from '../util.js?v=1b053a4f';
import { btn, panel, stars, empty, segmented } from '../ui/kit.js?v=2f24ea8c';
import { search, buildIndex, isReady, builtCount, totalBooks, summarize } from '../search.js?v=de5a369e';
import { drillSession, voiceLang, readingText, speechText, langAttr } from '../session.js?v=c98f7362';
import { searchAffix } from '../dict.js?v=df0f2e7b';

const LIMIT = 200;

export function render(app) {
  const wrap = h('div', { class: 'screen-body search-body' });

  // 界面状态（不持久化，每次进来重置）
  const ui = {
    q: '',
    scope: 'all',
    onlyStudied: false,
    results: [],
    affixes: [],
    mergedCount: 0,
    indexDone: isReady(),
  };

  /* ---- 搜索栏 ---- */
  const input = h('input', {
    class: 'text-input search-input',
    type: 'search',
    placeholder: '输入单词 / 假名 / 中文释义，例如 abandon、のみもの、抛弃',
    autocomplete: 'off',
    spellcheck: 'false',
    value: ui.q,
    oninput: (e) => { ui.q = e.target.value; runSearch(); },
    onkeydown: (e) => {
      if (e.key === 'Escape') { e.target.value = ''; ui.q = ''; runSearch(); }
      e.stopPropagation();
    },
  });

  const indexNote = h('div', { class: 'search-note' });
  const summaryRow = h('div', { class: 'search-summary' });
  const resultBox = h('div', { class: 'search-results' });

  const scopeRow = h('div', { class: 'search-scope' }, [
    segmented([
      { value: 'all', label: '全部词库', iconName: 'list' },
      { value: 'current', label: '当前词库', iconName: 'book' },
    ], ui.scope, (v) => { ui.scope = v; runSearch(); }),
    h('button', {
      class: `chip-btn ${ui.onlyStudied ? 'active' : ''}`.trim(),
      type: 'button',
      onclick: (e) => {
        ui.onlyStudied = !ui.onlyStudied;
        e.currentTarget.classList.toggle('active', ui.onlyStudied);
        runSearch();
      },
    }, [icon('star', 'ico xs'), h('span', { class: 'cb-label', text: '只看学过的' })]),
  ]);

  wrap.append(panel([
    h('div', { class: 'sec-title' }, [
      h('h2', { text: '查单词' }),
      h('span', { class: 'sec-note', text: '跨全部词库，可搜中文/假名/英文' }),
    ]),
    input,
    scopeRow,
    indexNote,
    summaryRow,
  ], 'pad'));

  wrap.append(resultBox);

  /* ---------------- 搜索 ---------------- */
  async function runSearch() {
    if (!ui.indexDone) {
      resultBox.replaceChildren(empty('正在读取全部词库，稍等一下…', 'hourglass'));
      return;
    }
    const q = ui.q.trim();
    if (!q) {
      ui.results = [];
      summaryRow.replaceChildren();
      resultBox.replaceChildren(empty('输入关键词开始搜索。支持英文单词、假名读音、中文释义；搜词缀（un-、-tion）可直接查它的意思。', 'info'));
      return;
    }
    const t0 = performance.now();
    ui.results = search(q, {
      scope: ui.scope,
      bookId: app.s.currentBook,
      onlyStudied: ui.onlyStudied,
      progress: app.progress,
      limit: LIMIT,
    });
    const ms = Math.round(performance.now() - t0);

    /* 词缀：搜「un-」「-tion」这类写法时，词库里当然查不到「单词」，
       但用户要的是词缀本身的释义。所以并行查一次词缀表，命中了就置顶显示。 */
    // 词缀表取不到不该连累整页搜索，失败就当没有词缀
    ui.affixes = await searchAffix(q).catch(() => []);

    // 小结
    if (!ui.results.length && !ui.affixes.length) {
      summaryRow.replaceChildren(h('div', { class: 'muted', text: `没有找到「${q}」` }));
    } else {
      const books = summarize(ui.results);
      summaryRow.replaceChildren(
        h('div', { class: 'search-stat' }, [
          h('b', { text: String(ui.results.length ? (ui.mergedCount || ui.results.length) : ui.affixes.length) }),
          h('span', { text: ui.results.length ? ' 条结果' : ' 个词缀' }),
          ui.affixes.length && ui.results.length ? h('span', { class: 'muted', text: ` +${ui.affixes.length} 个词缀` }) : null,
          h('span', { class: 'muted', text: ` · ${ms}ms` }),
        ]),
        h('div', { class: 'search-books' }, books.slice(0, 6).map((b) =>
          h('span', { class: 'lm-chip' }, [h('b', { text: b.bookName }), h('em', { text: String(b.count) })]))),
      );
    }
    renderResults();
  }

  /* ---------------- 结果列表 ---------------- */
  /** 词缀卡片：搜 un- / -tion 时显示释义与例词。例词可点进词条详情。 */
  function renderAffix() {
    const box = h('div', { class: 'affix-box search-affix' });
    for (const x of ui.affixes) {
      box.append(h('div', { class: 'affix-item' }, [
        h('div', { class: 'af-head' }, [
          h('b', { class: 'af-key', text: x.a }),
          h('span', { class: 'dict-tag', text: x.type }),
        ]),
        h('div', { class: 'af-zh', text: x.zh }),
        x.note ? h('div', { class: 'af-note muted', text: x.note }) : null,
        x.ex && x.ex.length
          ? h('div', { class: 'af-ex' }, [
              h('span', { class: 'muted', text: '例：' }),
              ...x.ex.flatMap((w, i) => [
                i ? h('span', { class: 'muted', text: '、' }) : null,
                h('button', {
                  class: 'af-link', type: 'button', text: w,
                  onclick: () => { app.play('click'); app.go('dict', { word: w, q: ui.q }); },
                }),
              ]),
            ])
          : null,
      ]));
    }
    resultBox.append(box);
  }

  function renderResults() {
    if (!ui.results.length) { resultBox.replaceChildren(); if (ui.affixes && ui.affixes.length) renderAffix(); return; }
    /* 同一个词可能同时出现在四六级/专四专八里。查词典时应该是一条词条，
       底下标明「属于：四级、六级、专四」，而不是三条重复记录 —— 这里按
       小写词形合并，词库名收集成一个数组。 */
    const merged = new Map();
    for (const r of ui.results) {
      const key = `${r.entry.lang}|${String(r.entry.w.w).toLowerCase()}`;
      const hit = merged.get(key);
      if (!hit) {
        merged.set(key, {
          entry: r.entry,
          mastery: r.mastery,
          books: [r.entry.bookName],
          levels: [],
        });
      } else {
        if (!hit.books.includes(r.entry.bookName)) hit.books.push(r.entry.bookName);
        // 掌握度取两处里较高的那个（同一词在不同词库的进度是分开记的）
        const a = (hit.mastery && hit.mastery.s) || 0;
        const b = (r.mastery && r.mastery.s) || 0;
        if (b > a) hit.mastery = r.mastery;
      }
    }
    const rows = [...merged.values()];
    ui.mergedCount = rows.length;

    const list = h('div', { class: 'search-list' });
    for (const r of rows) {
      const w = r.entry.w;
      const pr = r.mastery;
      const row = h('div', {
        class: 'search-row clickable',
        title: '点开查看词条详情',
        onclick: (e) => {
          // 点到里面的按钮时不触发跳转
          if (e.target.closest('button')) return;
          app.play('click');
          app.go('dict', { word: w.w, bookId: r.entry.book, lang: r.entry.lang, q: ui.query });
        },
      }, [
        h('div', { class: 'sr-main' }, [
          h('div', { class: 'sr-head' }, [
            h('b', { class: 'sr-w', text: w.w, ...langAttr(r.entry.lang) }),
            w.p ? h('span', { class: 'sr-p', text: readingText({ lang: r.entry.lang }, w.p), ...langAttr(r.entry.lang) }) : null,
            ...r.books.map((b) => h('span', { class: 'sr-book', text: b })),
            h('span', { class: 'sr-more', text: '详情' }),
          ]),
          h('div', { class: 'sr-t', text: w.t, ...langAttr('zh') }),
          (app.st.showExample && w.x)
            ? h('div', { class: 'sr-ex' }, [
                h('span', { class: 'sr-x', text: w.x, ...langAttr(r.entry.lang) }),
                w.xm ? h('span', { class: 'sr-xm', text: ` ${w.xm}` }) : null,
              ])
            : null,
        ]),
        h('div', { class: 'sr-right' }, [
          h('span', { class: 'sr-star' }, pr ? stars(pr.s || 0, { small: true }) : h('span', { class: 'muted', text: '未学' })),
          h('div', { class: 'sr-actions' }, [
            h('button', {
              class: 'speak-btn', type: 'button', title: '朗读',
              onclick: () => {
                app.play('click');
                const sl = { lang: r.entry.lang };
                // 日语念假名，汉字让 TTS 自己猜读音十有八九是错的
                const res = say(speechText(sl, w), { lang: voiceLang(sl, app.st.accent) });
                if (!res.exact && r.entry.lang === 'ja') {
                  app.toast('设备未安装日语语音，暂用系统默认朗读', 'warn', 2200);
                }
              },
            }, [icon('soundOn', 'ico sm')]),
            btn({
              label: '练这个词', iconName: 'target', size: 'sm',
              onclick: () => drill(app, r.entry.book, w.w),
            }),
          ]),
        ]),
      ]);
      list.append(row);
    }
    if (ui.results.length >= LIMIT) {
      list.append(h('div', { class: 'search-note', text: `只显示前 ${LIMIT} 条，输入更完整的关键词可缩小范围` }));
    }
    resultBox.replaceChildren(panel([list], 'pad'));
  }

  /* ---------------- 开练 ---------------- */
  async function drill(appRef, bookId, word) {
    appRef.play('confirm');
    const overlay = h('div', { class: 'loading-overlay' }, [
      h('div', { class: 'spinner' }),
      h('p', { text: '正在准备…' }),
    ]);
    document.body.append(overlay);
    try {
      const ses = await drillSession(appRef, bookId, [word]);
      // 把准备好的会话交给四选一模式（它支持 currentParams.drill）
      await appRef.go('quiz', { drill: ses });
    } catch (e) {
      appRef.toast(String(e.message || e), 'bad');
    } finally {
      overlay.remove();
    }
  }

  /* ---------------- 索引构建 ---------------- */
  function paintIndexNote() {
    const total = totalBooks();
    if (ui.indexDone) {
      indexNote.replaceChildren(h('div', { class: 'muted', text: `已载入 ${total} 套词库，可即时搜索` }));
    } else {
      indexNote.replaceChildren(h('div', { class: 'muted', text: `正在读取词库… ${builtCount()}/${total}` }));
    }
  }

  if (isReady()) {
    ui.indexDone = true;
    paintIndexNote();
    runSearch();
  } else {
    paintIndexNote();
    resultBox.replaceChildren(empty('正在读取全部词库，稍等一下…', 'hourglass'));
    buildIndex((done, total) => {
      paintIndexNote();
      // 全部完成前先不搜，避免给出不完整结果让人误会
      if (done >= total) {
        ui.indexDone = true;
        paintIndexNote();
        runSearch();
      }
    }).then(() => {
      ui.indexDone = true;
      paintIndexNote();
      runSearch();
      setTimeout(() => input.focus(), 50);
    }).catch((e) => {
      indexNote.replaceChildren(h('div', { class: 'bad', text: '词库读取失败：' + (e.message || e) }));
    });
  }

  app.setKeyHint('输入即搜 · Esc 清空 · 「练这个词」可只练这一个词');
  return wrap;
}
