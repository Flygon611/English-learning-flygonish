// 词库页：选择词库（内置六套 + 自定义）、按首字母拆分选择、导入、导出。

import { h, icon, fmtBytes } from '../util.js?v=1b053a4f';
import { btn, panel, chip, progressBar, empty, statBox } from '../ui/kit.js?v=2f24ea8c';
import {
  allBooks, getWords, letterBreakdown, buildSplitExport, downloadText,
  removeUserBook, groupOf, groupsFor,
} from '../vocab.js?v=4c022754';
import { statsOf, dueCount, isNew, isDue, MAX_STAR } from '../srs.js?v=e54c36c9';

export function render(app) {
  const wrap = h('div', { class: 'screen-body' });
  const state = { words: null, loading: false, error: null };

  /* ---- 词库选择区 ---- */
  const bookList = h('div', { class: 'book-list' });
  wrap.append(panel([
    h('div', { class: 'sec-title' }, [
      h('h2', { text: '选择词库' }),
      btn({ label: '导入我的词库', iconName: 'plus', size: 'sm', kind: 'primary', onclick: () => app.go('importer') }),
    ]),
    bookList,
  ], 'pad'));

  /* ---- 字母区 ---- */
  const letterBox = h('div', { class: 'letter-box' }, [h('div', { class: 'loading-line', text: '读取词库中…' })]);
  const letterPanel = panel([
    h('div', { class: 'sec-title' }, [
      h('h2', { id: 'letter-title', text: '按首字母拆分' }),
      h('span', { class: 'sec-note', id: 'letter-note', text: '不选 = 全部' }),
    ]),
    letterBox,
  ], 'pad');
  wrap.append(letterPanel);

  /* ---- 当前选择 + 开始 ---- */
  const summaryBar = h('div', { class: 'selection-bar' });
  wrap.append(summaryBar);

  /* ---------------- 渲染词库列表 ---------------- */
  function renderBooks() {
    bookList.replaceChildren();
    const books = allBooks();

    /* 按分类分组显示。
       以前 11 套词库全堆在一个网格里，英语六级会夹在日语 N5 和 N4 之间，
       看不出语言分界（用户反馈：全都堆在一起了）。
       分类来自 index.json 的 groups + 每套词库的 groupId；
       用户导入的词库单独归一组，放在最后。 */
    const buckets = new Map();
    for (const b of books) {
      const key = b.builtin ? (b.categoryId || 'other') : '__mine__';
      if (!buckets.has(key)) {
        buckets.set(key, {
          label: b.builtin ? (b.categoryLabel || '其它') : '我导入的词库',
          order: b.builtin ? (b.categoryOrder ?? 99) : 100,
          items: [],
        });
      }
      buckets.get(key).items.push(b);
    }

    for (const g of [...buckets.values()].sort((a, z) => a.order - z.order)) {
      const total = g.items.reduce((n, b) => n + (b.count || 0), 0);
      bookList.append(h('div', { class: 'book-group' }, [
        h('div', { class: 'bg-head' }, [
          h('span', { class: 'bg-label', text: g.label }),
          h('span', { class: 'bg-meta', text: `${g.items.length} 套 · ${total.toLocaleString()} 词` }),
        ]),
        h('div', { class: 'book-grid' }, g.items.map((b) => bookCard(b))),
      ]));
    }
  }

  /** 单张词库卡片。 */
  function bookCard(b) {
    const active = b.id === app.s.currentBook;
    const card = h('button', {
      class: `book-card ${active ? 'active' : ''}`.trim(),
      type: 'button',
      onclick: () => {
        app.play('click');
        if (b.id !== app.s.currentBook) {
          app.s.currentBook = b.id;
          app.s.currentLetters = [];      // 换词库时清空分组筛选
          app.markDirty();
        }
        renderBooks();
        loadBook();
      },
    }, [
      h('div', { class: 'bc-top' }, [
        h('span', { class: 'bc-name', text: b.name }),
        b.nameEn && b.nameEn !== b.name ? h('span', { class: 'bc-en', text: b.nameEn }) : null,
        b.builtin ? null : h('span', { class: 'bc-badge', text: '自定义' }),
      ]),
      h('div', { class: 'bc-desc', text: b.desc || '' }),
      h('div', { class: 'bc-count' }, [
        icon(b.builtin ? 'book' : 'pouch', 'ico xs'),
        h('span', { text: `${(b.count || 0).toLocaleString()} 词` }),
      ]),
    ]);
    if (!b.builtin) {
      card.append(h('span', {
        class: 'bc-del',
        title: '删除这个词库',
        onclick: async (e) => {
          e.stopPropagation();
          const ok = await app.confirm('删除词库', `确定删除自定义词库「${b.name}」吗？该词库的学习进度也会一并清除。`, { danger: true, okLabel: '删除' });
          if (!ok) return;
          removeUserBook(b.id);
          // 清理该词库的进度
          for (const k of Array.from(app.progress.keys())) {
            if (k.startsWith(b.id + '|')) app.progress.delete(k);
          }
          if (app.s.currentBook === b.id) { app.s.currentBook = 'cet4'; app.s.currentLetters = []; }
          app.syncUserBooks();
          renderBooks();
          loadBook();
          app.toast('已删除', 'ok');
        },
      }, [icon('trash', 'ico xs')]));
    }
    return card;
  }

  /* ---------------- 载入词表并渲染字母网格 ---------------- */
  async function loadBook() {
    const bookId = app.s.currentBook;
    state.loading = true;
    state.error = null;
    letterBox.replaceChildren(h('div', { class: 'loading-line', text: `${app.book().name} 读取中…` }));
    renderSummary();

    try {
      const words = await getWords(bookId);
      if (app.s.currentBook !== bookId) return;    // 用户在加载期间换了词库
      state.words = words;
      state.loading = false;
      renderLetters();
    } catch (e) {
      state.loading = false;
      state.error = e;
      letterBox.replaceChildren(empty(String(e.message || e), 'warning'));
    }
    renderSummary();
  }

  function renderLetters() {
    const words = state.words || [];
    const groups = groupsFor(app.book());
    const counts = letterBreakdown(words, groups);
    // 小标题随词库的筛选维度变：英语是「按首字母拆分」，五十音是「按假名种类筛选」
    const titleEl = document.getElementById('letter-title');
    if (titleEl) {
      const gl = app.book().groupLabel || '首字母';
      titleEl.textContent = gl === '首字母' ? '按首字母拆分' : `按${gl}筛选`;
    }
    const bookId = app.s.currentBook;
    const progress = app.progress;
    const now = Date.now();

    // 已选字母（空 = 全部）
    let selected = new Set(app.s.currentLetters || []);

    const grid = h('div', { class: 'letter-grid' });
    const selInfo = h('div', { class: 'letter-count' });

    const applySelection = () => {
      app.s.currentLetters = Array.from(selected);
      app.markDirty();
      // 重绘网格高亮
      grid.querySelectorAll('.lt-btn').forEach((el) => {
        el.classList.toggle('active', selected.has(el.dataset.letter));
      });
      allBtn.classList.toggle('active', selected.size === 0);
      updateCounts();
      renderSummary();
    };

    const updateCounts = () => {
      const active = selected.size === 0 ? words : words.filter((w) => selected.has(groupOf(w)));
      const s = statsOf(active, progress, bookId, app.st.maxThreshold || MAX_STAR);
      const due = dueCount(active, progress, bookId, now);
      selInfo.replaceChildren(
        h('span', {}, [h('b', { text: active.length.toLocaleString() }), ' 词可选']),
        h('span', { class: 'dot' }),
        h('span', {}, ['待学/复习 ', h('b', { text: String(due) })]),
        h('span', { class: 'dot' }),
        h('span', {}, ['已掌握 ', h('b', { text: String(s.mastered) })]),
      );
    };

    // 全选按钮
    const totalCount = words.length;
    const allBtn = h('button', {
      class: `lt-btn all ${selected.size === 0 ? 'active' : ''}`,
      type: 'button',
      onclick: () => { selected = new Set(); applySelection(); },
    }, [
      h('span', { class: 'lt-letter', text: '全' }),
      h('span', { class: 'lt-count', text: totalCount > 999 ? Math.round(totalCount / 1000) + 'k' : String(totalCount) }),
    ]);
    grid.append(allBtn);

    for (const { letter, label, count } of counts) {
      // 该字母的掌握度进度
      const bucket = words.filter((w) => groupOf(w) === letter);
      const s = statsOf(bucket, progress, bookId, app.st.masterThreshold || MAX_STAR);
      const pct = bucket.length ? s.mastered / bucket.length : 0;
      const b = h('button', {
        class: `lt-btn ${selected.has(letter) ? 'active' : ''}`.trim(),
        type: 'button',
        dataset: { letter },
        title: `${letter} 开头：${count} 词（已掌握 ${s.mastered}）`,
        onclick: () => {
          app.play('click');
          if (selected.has(letter)) selected.delete(letter); else selected.add(letter);
          applySelection();
        },
      }, [
        h('span', { class: 'lt-letter' + (String(label).length > 2 ? ' long' : ''), text: label }),
        h('span', { class: 'lt-count', text: count > 999 ? Math.round(count / 1000) + 'k' : String(count) }),
        progressBar(pct, 1, { cls: 'lt-bar' }),
      ]);
      grid.append(b);
    }

    /* ---- 快捷选择 ---- */
    const quick = h('div', { class: 'quick-row' }, [
      btn({
        label: '只选没背过的', iconName: 'plus', size: 'sm',
        onclick: () => {
          app.play('click');
          selected = new Set();
          for (const { letter } of counts) {
            const bucket = words.filter((w) => groupOf(w) === letter);
            const s = statsOf(bucket, progress, bookId, app.st.masterThreshold || MAX_STAR);
            if (s.new > 0) selected.add(letter);
          }
          if (!selected.size) { app.toast('这个词库已经没有生词了', 'info'); return; }
          applySelection();
        },
      }),
      btn({
        label: '只选该复习的', iconName: 'hourglass', size: 'sm',
        onclick: () => {
          app.play('click');
          selected = new Set();
          for (const w of words) {
            const pr = progress.get(`${bookId}|${w.w.toLowerCase()}`);
            if (isNew(pr) || isDue(pr, now)) selected.add(groupOf(w));
          }
          if (!selected.size) { app.toast('暂时没有需要复习的词', 'info'); return; }
          applySelection();
        },
      }),
      btn({
        label: '只选错得多的', iconName: 'warning', size: 'sm',
        onclick: () => {
          app.play('click');
          selected = new Set();
          for (const w of words) {
            const pr = progress.get(`${bookId}|${w.w.toLowerCase()}`);
            if (pr && (pr.err || 0) >= 2) selected.add(groupOf(w));
          }
          if (!selected.size) { app.toast('还没有错满 2 次的字母分组', 'info'); return; }
          applySelection();
        },
      }),
      btn({
        label: '清空选择（=全部）', iconName: 'close', size: 'sm', kind: 'ghost',
        onclick: () => { app.play('cancel'); selected = new Set(); applySelection(); },
      }),
      btn({
        label: '导出拆分文件', iconName: 'save', size: 'sm', kind: 'ghost',
        onclick: () => doExport(selected),
      }),
    ]);

    letterBox.replaceChildren(grid, selInfo, quick);
    updateCounts();
  }

  /* ---------------- 导出「按字母拆分」 ---------------- */
  async function doExport(selected) {
    if (!state.words) { app.toast('词库还在加载中', 'warn'); return; }
    const book = app.book();
    const letters = Array.from(selected);
    const choice = await app.modal({
      title: 导出按拆分的词库,
      body: h('div', {}, [
        h('p', { text: '会生成一个 JSON 文件，结构为 { groups: { A: [...], B: [...] } }，可直接给别的程序用。' }),
        h('p', { class: 'muted', text: letters.length ? `范围：${letters.slice().sort().join(' ')}` : `范围：全部（不分${groupsFor(book).length > 2 ? '组' : '字母'}）` }),
      ]),
      buttons: [
        { label: '取消', value: null },
        { label: '导出全部字母', value: 'all' },
        { label: '只导出已选字母', value: 'sel', kind: 'primary' },
      ],
    });
    if (!choice) return;
    const useLetters = choice === 'all' ? [] : letters;
    const { filename, json, meta } = buildSplitExport(book, state.words, useLetters);
    downloadText(filename, json);
    app.play('confirm');
    app.toast(`已导出 ${filename}（${meta.map((m) => m.letter + m.count).join(' ')}）`, 'ok', 3600);
  }

  /* ---------------- 底部选择条 ---------------- */
  function renderSummary() {
    const book = app.book();
    const L = app.s.currentLetters || [];
    // 「字母」这个词对五十音词库是错的（它按平假名/片假名筛选）。
    // 词库自己声明了 groupLabel 就用它：首字母 / 假名种类。
    const unit = book.groupLabel || '字母';
    const nameOf = new Map(groupsFor(book).map((g) => [g.key, g.label]));
    const desc = L.length === 0
      ? `${book.name} · 全部${unit === '首字母' ? '字母' : ''}${unit === '首字母' ? '' : unit}`
      : `${book.name} · ${L.map((k) => nameOf.get(k) || k).sort().join(' ')}`;
    // 玩法按钮按词库声明的能力出：五十音没有「拼写」
    const allowed = book.modes || ['quiz', 'cards', 'spell'];
    const modeBtns = (disabled) => [
      allowed.includes('quiz') ? btn({ label: '四选一', iconName: 'target', kind: 'primary', disabled, onclick: () => app.go('quiz') }) : null,
      allowed.includes('cards') ? btn({ label: '翻卡', iconName: 'cardOutline', disabled, onclick: () => app.go('cards') }) : null,
      allowed.includes('spell') ? btn({ label: '拼写', iconName: 'note', disabled, onclick: () => app.go('spell') }) : null,
    ].filter(Boolean);

    let countText = '读取中…';
    if (state.words) {
      const active = L.length === 0 ? state.words : state.words.filter((w) => L.includes(groupOf(w)));
      countText = `${active.length.toLocaleString()} 词`;
      const s = statsOf(active, app.progress, book.id, app.st.masterThreshold || MAX_STAR);
      summaryBar.replaceChildren(
        h('div', { class: 'sb-main' }, [
          h('div', { class: 'sb-title', text: desc }),
          h('div', { class: 'sb-sub', text: `${countText} · 生词 ${s.new} · 待复习 ${dueCount(active, app.progress, book.id)} · 已掌握 ${s.mastered}` }),
        ]),
        h('div', { class: 'sb-actions' }, modeBtns(false)),
      );
    } else {
      const s = statsOf([], app.progress, book.id);
      summaryBar.replaceChildren(
        h('div', { class: 'sb-main' }, [
          h('div', { class: 'sb-title', text: desc }),
          h('div', { class: 'sb-sub', text: state.error ? '读取失败' : '读取中…' }),
        ]),
        h('div', { class: 'sb-actions' }, modeBtns(!!state.error)),
      );
    }
  }

  app.setKeyHint('可多选（再点一次取消）· 不选任何一项 = 使用全部');
  renderBooks();
  loadBook();
  return wrap;
}
