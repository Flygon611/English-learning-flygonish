// 词条详情页：等级归属、词性、音标/读音、逐义项释义与例句、近义词、词源。
//
// 从「查单词」点进来（app.go('dict', { word, lang })）。
// 数据按需从 assets/dict/<bucket>.json.gz 拉取，见 js/dict.js。

import { h, icon, say, speechSupported } from '../util.js?v=1b053a4f';
import { btn, panel, empty, stars } from '../ui/kit.js?v=2f24ea8c';
import { getEntry, getMeta, searchAffix } from '../dict.js?v=df0f2e7b';
import { langAttr } from '../session.js?v=c98f7362';
import { findBook } from '../vocab.js?v=4c022754';
import { wordKey, MAX_STAR } from '../srs.js?v=e54c36c9';

const POS_LABEL = {
  n: '名词', v: '动词', adj: '形容词', adv: '副词', intj: '感叹词',
  prep: '介词', conj: '连词', pron: '代词', num: '数词', article: '冠词',
};

export function render(app) {
  const wrap = h('div', { class: 'screen-body dict-body' });
  const params = app.currentParams || {};
  const word = params.word || '';
  const bookId = params.bookId || app.s.currentBook;
  const book = findBook(bookId) || { id: bookId, name: bookId, lang: params.lang || 'en' };

  const head = h('div', { class: 'dict-head' });
  const body = h('div', { class: 'dict-main' }, [
    h('div', { class: 'loading-line', text: `正在读取「${word}」的词条…` }),
  ]);
  wrap.append(panel([head, body], 'pad'));
  // 详情页底部也放一个「练这个词」，从列表点进来之后不必再退回去
  wrap.append(h('div', { class: 'dict-actions' }, [
    btn({
      label: '返回', iconName: 'back', size: 'sm', kind: 'ghost',
      onclick: () => app.go('search', { q: params.q || word }),
    }),
    btn({
      label: '练这个词', iconName: 'target', size: 'sm', kind: 'primary',
      onclick: () => app.go('quiz', { drill: { bookId, words: [word] } }),
    }),
  ]));

  paintHead();
  load();

  function paintHead() {
    head.replaceChildren(
      h('div', { class: 'dh-top' }, [
        h('h1', { class: 'dh-w', text: word, ...langAttr(book.lang) }),
        speechSupported()
          ? h('button', {
              class: 'speak-btn', type: 'button', title: '朗读',
              onclick: () => { app.play('click'); say(word, { lang: book.lang === 'ja' ? 'ja-JP' : app.st.accent }); },
            }, [icon('soundOn', 'ico sm')])
          : null,
      ]),
    );
  }

  async function load() {
    // 词缀查询：搜 un- / -tion 时不查词条，直接给词缀解释
    const affixes = await searchAffix(word);
    if (affixes.length && !/[a-z]{4,}/i.test(word.replace(/-/g, ''))) {
      paintAffix(affixes);
      return;
    }
    let entry = null;
    try {
      entry = await getEntry(word);
    } catch (err) {
      body.replaceChildren(empty(`读不到词条数据：${err.message}`));
      return;
    }
    if (!entry) {
      body.replaceChildren(
        empty(`词库里没有「${word}」的详细词条`),
        h('div', { class: 'muted small center', text: '只有内置词库（12 套）里的词有详情；自定义导入的词库暂时只有释义。' }),
      );
      if (affixes.length) paintAffix(affixes);
      return;
    }
    paint(entry);
  }

  /* ---------------- 词缀 ---------------- */
  function paintAffix(list) {
    const box = h('div', { class: 'affix-box' }, list.map((x) => h('div', { class: 'affix-item' }, [
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
              h('a', {
                class: 'af-link',
                href: 'javascript:void 0',
                text: w,
                onclick: (e) => { e.preventDefault(); app.go('dict', { word: w }); },
              }),
            ]),
          ])
        : null,
    ])));
    body.replaceChildren(
      h('div', { class: 'sec-title' }, [h('h2', { text: '词缀释义' })]),
      box,
    );
  }

  /* ---------------- 词条 ---------------- */
  function paint(e) {
    const pr = app.progress.get(wordKey(bookId, e.w));
    const nodes = [];

    /* --- 等级 / 词性 / 读音 --- */
    const metaRow = h('div', { class: 'd-meta' });
    if (e.levels && e.levels.length) {
      metaRow.append(h('div', { class: 'dm-row' }, [
        h('span', { class: 'dm-k', text: e.levels.length > 1 ? '所属词库' : '所属词库' }),
        h('span', { class: 'dm-v' }, (e.levels || []).map((x) => h('span', { class: 'dict-tag', text: x }))),
      ]));
    }
    if (e.pos && e.pos.length) {
      metaRow.append(h('div', { class: 'dm-row' }, [
        h('span', { class: 'dm-k', text: '词性' }),
        h('span', { class: 'dm-v', text: e.pos.join('、') }),
      ]));
    }
    if (e.ipa) {
      metaRow.append(h('div', { class: 'dm-row' }, [
        h('span', { class: 'dm-k', text: '音标' }),
        h('span', { class: 'dm-v mono', text: e.ipa }),
      ]));
    }
    // 「读音」只对日语有意义（那是假名）。英语的读音和音标是同一类东西，
    // 两行都显示会像 bug（abandon 的 音标 /əˈbæn.dən/ 与 读音 ə'bændən 是同一件事的两种写法）。
    if (e.lang === 'ja' && e.reading) {
      metaRow.append(h('div', { class: 'dm-row' }, [
        h('span', { class: 'dm-k', text: '假名' }),
        h('span', { class: 'dm-v', text: e.reading, ...langAttr('ja') }),
      ]));
    }
    if (e.forms) {
      metaRow.append(h('div', { class: 'dm-row' }, [
        h('span', { class: 'dm-k', text: '词形' }),
        h('span', { class: 'dm-v', text: e.forms }),
      ]));
    }
    if (pr) {
      metaRow.append(h('div', { class: 'dm-row' }, [
        h('span', { class: 'dm-k', text: '掌握度' }),
        h('span', { class: 'dm-v' }, [stars(pr.s || 0, { small: true })]),
      ]));
    }
    if (metaRow.childNodes.length) nodes.push(metaRow);

    /* --- 逐义项 --- */
    const senses = e.senses || [];
    if (senses.length) {
      nodes.push(h('div', { class: 'sec-title mt' }, [
        h('h2', { text: '释义' }),
        h('span', { class: 'sec-note', text: `${senses.length} 个义项` }),
      ]));
      const ol = h('ol', { class: 'sense-list' });
      senses.forEach((s, i) => {
        const li = h('li', { class: 'sense' }, [
          h('div', { class: 'se-head' }, [
            s.posZh ? h('span', { class: 'se-pos', text: s.posZh }) : null,
            s.domain ? h('span', { class: 'se-dom', text: s.domain }) : null,
            h('span', { class: 'se-zh', text: (s.zh || []).join('；'), ...langAttr('zh') }),
          ]),
        ]);
        if (s.en) li.append(h('div', { class: 'se-en', text: s.en }));
        if (s.ex) {
          li.append(h('div', { class: 'se-ex' }, [
            h('span', { class: 'se-x', text: s.ex, ...langAttr(e.lang) }),
            s.exZh ? h('span', { class: 'se-xm', text: s.exZh, ...langAttr('zh') }) : null,
          ]));
        }
        ol.append(li);
      });
      nodes.push(ol);
    } else {
      nodes.push(empty('这个词条没有释义数据'));
    }

    /* --- 近义词 --- */
    if (e.syn && e.syn.length) {
      nodes.push(h('div', { class: 'sec-title mt' }, [h('h2', { text: '近义词' })]));
      nodes.push(h('div', { class: 'syn-row' }, e.syn.map((w) => h('a', {
        class: 'syn-chip',
        href: 'javascript:void 0',
        text: w,
        onclick: (ev) => { ev.preventDefault(); app.play('click'); app.go('dict', { word: w }); },
      }))));
    }

    /* --- 词源 --- */
    // 中文译文优先；英文原文收在一个折叠开关里，想核对时可以展开。
    // 译文衍生自 Wiktionary（CC BY-SA 4.0），所以来源标注要说清楚。
    if (e.etymZh || e.etym) {
      const zhNode = h('div', {
        class: 'etym', text: e.etymZh || e.etym, lang: e.etymZh ? 'zh' : 'en',
      });
      const note = h('span', {
        class: 'sec-note',
        text: e.etymZh ? '译自 Wiktionary 英文原文' : '来自 Wiktionary（英文原文）',
      });
      nodes.push(h('div', { class: 'sec-title mt' }, [h('h2', { text: '词源' }), note]));
      nodes.push(zhNode);
      if (e.etymZh && e.etym) {
        const en = h('div', { class: 'etym etym-en', text: e.etym, hidden: true, lang: 'en' });
        const toggle = h('button', {
          class: 'etym-toggle', type: 'button', text: '显示英文原文',
          onclick: () => {
            en.hidden = !en.hidden;
            toggle.textContent = en.hidden ? '显示英文原文' : '收起英文原文';
            app.play('click');
          },
        });
        nodes.push(toggle, en);
      }
    } else if (e.lang === 'en') {
      nodes.push(h('div', { class: 'sec-title mt' }, [h('h2', { text: '词源' })]));
      nodes.push(h('div', { class: 'muted small', text: '这条词目在 Wiktionary 里没有词源段落。' }));
    }

    /* --- 出处 --- */
    if (e.source && e.source.length) {
      nodes.push(h('div', { class: 'dict-src muted', text: `数据来源：${e.source.join(' · ')}` }));
    }

    body.replaceChildren(...nodes);
  }

  return wrap;
}
