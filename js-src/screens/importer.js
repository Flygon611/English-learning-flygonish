// 导入词库：粘贴文本 / 选择文件 → 解析预览 → 保存为自定义词库。

import { h, icon, fmtBytes } from '../util.js?v=1b053a4f';
import { btn, panel, empty, statBox } from '../ui/kit.js?v=2f24ea8c';
import { parseImport, addUserBook, letterBreakdown, allBooks } from '../vocab.js?v=4c022754';

const SAMPLE = `# 1) 制表符 / 逗号 / 竖线 / 冒号分隔（最常见）
abandon	v. 抛弃，放弃
banana,香蕉
cherry|樱桃
# 2) 三列：单词 + 音标 + 释义（会自动识别第二列是不是音标）
apple	ˈæpl	n. 苹果
# 3) 也可以直接贴 JSON
[{"w":"dog","p":"dɒɡ","t":"n. 狗","x":"The dog barks.","xm":"狗在叫。"}]`;

export function render(app) {
  const wrap = h('div', { class: 'screen-body' });
  let parsed = null;

  const ta = h('textarea', {
    class: 'import-text',
    rows: 10,
    spellcheck: 'false',
    placeholder: '在这里粘贴你的词表…（每行一个词条）',
  });

  const fileInput = h('input', {
    type: 'file',
    accept: '.txt,.csv,.tsv,.json,text/plain,application/json',
    class: 'hidden-file',
    onchange: (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        ta.value = String(reader.result || '');
        nameInput.value = f.name.replace(/\.[^.]+$/, '');
        doParse();
      };
      reader.readAsText(f, 'utf-8');
    },
  });

  const nameInput = h('input', { class: 'text-input', placeholder: '给这个词库起个名字，例如：我的雅思生词', maxlength: '24' });

  const preview = h('div', { class: 'import-preview' }, [
    empty('还没有内容。粘贴或选择文件后会自动解析。', 'info'),
  ]);

  /* ---------------- 解析 ---------------- */
  function doParse() {
    const text = ta.value;
    if (!text.trim()) {
      parsed = null;
      preview.replaceChildren(empty('还没有内容。粘贴或选择文件后会自动解析。', 'info'));
      return;
    }
    try {
      const { words, warn } = parseImport(text);
      parsed = words;
      const letters = letterBreakdown(words);
      const head = h('div', { class: 'iv-grid' }, [
        statBox('解析到词条', words.length, { iconName: 'book', kind: 'k-target' }),
        statBox('覆盖字母', letters.length, { iconName: 'list', kind: 'k-star' }),
        statBox('含音标', words.filter((w) => w.p).length, { iconName: 'note', kind: 'k-coin' }),
        statBox('含例句', words.filter((w) => w.x).length, { iconName: 'scroll', kind: 'k-fire' }),
      ]);

      // 字母分布
      const chips = h('div', { class: 'letter-mini' }, letters.map((L) =>
        h('span', { class: 'lm-chip' }, [h('b', { text: L.letter }), h('em', { text: String(L.count) })])));

      // 前 5 条预览
      const sampleRows = h('div', { class: 'import-rows' });
      for (const w of words.slice(0, 5)) {
        sampleRows.append(h('div', { class: 'ir-row' }, [
          h('b', { text: w.w }),
          h('span', { class: 'ir-p', text: w.p ? `/${w.p}/` : '' }),
          h('span', { class: 'ir-t', text: w.t || '（无释义）' }),
        ]));
      }

      const warnBox = warn.length
        ? h('details', { class: 'warn-box' }, [
            h('summary', { text: `${warn.length} 条提示（点击展开）` }),
            h('ul', {}, warn.slice(0, 40).map((m) => h('li', { text: m }))),
          ])
        : null;

      preview.replaceChildren(head, chips, h('div', { class: 'iv-sub', text: '前 5 条预览：' }), sampleRows, warnBox);
      app.play('select');
    } catch (e) {
      parsed = null;
      preview.replaceChildren(empty(String(e.message || e), 'warning'));
      app.play('error');
    }
  }

  ta.addEventListener('input', () => {
    clearTimeout(ta._t);
    ta._t = setTimeout(doParse, 350);
  });

  /* ---------------- 保存 ---------------- */
  async function save() {
    if (!parsed || !parsed.length) { app.toast('请先粘贴或选择有效的词表内容', 'warn'); return; }
    const name = (nameInput.value || '').trim() || `自定义词库 ${allBooks().filter((b) => !b.builtin).length + 1}`;
    const id = 'user_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    addUserBook({ id, name, words: parsed, source: '用户导入' });
    try {
      app.syncUserBooks();
    } catch (e) {
      app.toast('保存失败：浏览器本地空间不足，可尝试减小词库', 'bad', 5000);
      return;
    }
    app.s.currentBook = id;
    app.s.currentLetters = [];
    app.saveAll();
    app.play('levelup');
    app.toast(`已保存「${name}」，共 ${parsed.length} 词`, 'ok', 3000);
    app.go('library');
  }

  /* ---------------- 界面 ---------------- */
  wrap.append(panel([
    h('div', { class: 'sec-title' }, [
      h('h2', { text: '导入自己的词库' }),
      btn({ label: '返回词库', iconName: 'back', size: 'sm', kind: 'ghost', onclick: () => app.go('library') }),
    ]),
    h('p', { class: 'muted', text: '支持逐行文本（制表符 / 逗号 / 竖线 / 冒号分隔）与 JSON。数据只存在你自己的浏览器里。' }),
    h('div', { class: 'row-actions wrap' }, [
      h('label', { class: 'btn sm file-btn' }, [icon('bookOpen'), h('span', { text: '选择文件…' }), fileInput]),
      btn({ label: '填入示例', iconName: 'info', size: 'sm', kind: 'ghost', onclick: () => { ta.value = SAMPLE; doParse(); } }),
      btn({ label: '清空', iconName: 'close', size: 'sm', kind: 'ghost', onclick: () => { ta.value = ''; doParse(); } }),
    ]),
    ta,
    h('div', { class: 'import-name-row' }, [
      h('span', { class: 'inr-label', text: '词库名称' }),
      nameInput,
      btn({ label: '保存为词库', iconName: 'check', kind: 'primary', onclick: save }),
    ]),
  ], 'pad'));

  wrap.append(panel([
    h('div', { class: 'sec-title' }, [h('h2', { text: '解析结果' })]),
    preview,
  ], 'pad'));

  wrap.append(panel([
    h('div', { class: 'sec-title' }, [h('h2', { text: '支持的格式' })]),
    h('pre', { class: 'code-block', text: SAMPLE }),
    h('ul', { class: 'tip-list' }, [
      h('li', { text: '两列时：第二列自动判断是音标还是释义（含 IPA 符号或类似 /ˈæpl/ 的会当音标）。' }),
      h('li', { text: '表头行（word,phonetic,meaning 等）会自动跳过。' }),
      h('li', { text: '以 # 开头的行视为注释。' }),
      h('li', { text: '重复的单词会自动合并，并保留更长的释义。' }),
      h('li', { text: '注意：自定义词库存在 localStorage，数量很大时可能超出浏览器配额。' }),
    ]),
  ], 'pad'));

  app.setKeyHint('导入后可在词库页按首字母拆分出来单独练习');
  return wrap;
}
