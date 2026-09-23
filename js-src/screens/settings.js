// 设置页：音效、背景音乐、朗读、题量、模式偏好、数据。

import { h, icon, speechSupported, englishVoices, say, fmtBytes } from '../util.js';
import { btn, panel, toggleRow, stepper, selectRow, segmented, empty } from '../ui/kit.js';
import { store } from '../core/storage.js';
// 注意：**不要**从 '../app.js' 导入 —— 那会让「打开设置页」反向加载入口模块，
// 产生第二个 App 实例并把页面覆盖回首页（见 js/settings-defaults.js 顶部注释）。
import { DEFAULT_SETTINGS } from '../settings-defaults.js';
import { music } from '../music.js';

export function render(app) {
  const wrap = h('div', { class: 'screen-body' });
  const st = app.st;
  const set = (k, v) => { app.setSetting(k, v); renderAll(); };
  const host = h('div', {});

  function renderAll() {
    host.replaceChildren();

    /* ---- 声音 ---- */
    host.append(panel([
      h('div', { class: 'sec-title' }, [h('h2', { text: '声音' })]),
      toggleRow('音效', '按钮、答对答错等提示音（Kenney Interface Sounds）', st.sound, (v) => set('sound', v), 'soundOn'),
      h('div', { class: 'row toggle-row' }, [
        h('div', { class: 'row-main' }, [
          h('div', { class: 'row-label' }, [icon('musicOn', 'ico sm'), h('span', { text: '音效音量' })]),
          h('div', { class: 'row-desc', text: `当前 ${Math.round(st.volume * 100)}%` }),
        ]),
        h('input', {
          type: 'range', min: '0', max: '1', step: '0.05', value: String(st.volume),
          class: 'range',
          oninput: (e) => { st.volume = Number(e.target.value); app.setSetting('volume', st.volume); e.target.nextElementSibling.textContent = Math.round(st.volume * 100) + '%'; },
        }),
        h('b', { class: 'range-val', text: Math.round(st.volume * 100) + '%' }),
      ]),
      toggleRow('自动朗读', '「听音选词」题会自动读出单词', st.autoSpeak, (v) => set('autoSpeak', v), 'note'),
      toggleRow('拼写题朗读', '开启后拼写题也会读出单词（会直接听到答案，慎开）', st.spellSound, (v) => set('spellSound', v), 'soundOn'),
    ], 'pad'));

    /* ---- 背景音乐 ---- */
    const tracks = music.tracksFor('menu');
    host.append(panel([
      h('div', { class: 'sec-title' }, [h('h2', { text: '背景音乐' })]),
      toggleRow('播放 BGM', '只在首页/词库/统计/设置播放；进入三种玩法会**自动淡出暂停**，让你专注',
        st.music, (v) => set('music', v), 'musicOn'),
      h('div', { class: 'row toggle-row' }, [
        h('div', { class: 'row-main' }, [
          h('div', { class: 'row-label' }, [icon('musicOff', 'ico sm'), h('span', { text: '音乐音量' })]),
          h('div', { class: 'row-desc', text: `当前 ${Math.round(st.musicVolume * 100)}%` }),
        ]),
        h('input', {
          type: 'range', min: '0', max: '1', step: '0.05', value: String(st.musicVolume),
          class: 'range',
          oninput: (e) => { st.musicVolume = Number(e.target.value); app.setSetting('musicVolume', st.musicVolume); e.target.nextElementSibling.textContent = Math.round(st.musicVolume * 100) + '%'; },
        }),
        h('b', { class: 'range-val', text: Math.round(st.musicVolume * 100) + '%' }),
      ]),
      // 当前曲目 + 换一首
      tracks.length
        ? h('div', { class: 'row toggle-row' }, [
            h('div', { class: 'row-main' }, [
              h('div', { class: 'row-label' }, [icon('note', 'ico sm'), h('span', { text: '正在播放' })]),
              h('div', { class: 'row-desc', text: music.nowPlayingName() || '（还没开始，点一下页面即可播放）' }),
            ]),
            h('div', { class: 'row-actions' }, [
              btn({
                label: '换一首', iconName: 'arrowRight', size: 'sm',
                onclick: () => { app.unlockAudio(); music.next(); renderAll(); },
              }),
            ]),
          ])
        : empty('没有可用的 BGM 曲目（assets/audio/music.json 为空）', 'musicOff'),
      tracks.length
        ? h('div', { class: 'row-desc', text: `共 ${tracks.length} 首，循环播放；换一首会立刻切到另一首` })
        : null,
    ].filter(Boolean), 'pad'));

    /* ---- 朗读引擎 ---- */
    const voices = englishVoices();
    host.append(panel([
      h('div', { class: 'sec-title' }, [h('h2', { text: '朗读（系统语音）' })]),
      speechSupported()
        ? (voices.length
          ? h('div', {}, [
              selectRow('口音', st.accent, [
                { value: 'en-US', label: '美式 English (US)' },
                { value: 'en-GB', label: '英式 English (UK)' },
                { value: 'en-AU', label: '澳式 English (AU)' },
              ], (v) => { set('accent', v); say('vocabulary', { lang: v }); }, { desc: `检测到 ${voices.length} 个英文语音`, iconName: 'note' }),
              h('div', { class: 'row-actions' }, [
                btn({ label: '试听发音', iconName: 'soundOn', size: 'sm', onclick: () => say('vocabulary', { lang: st.accent }) }),
              ]),
            ])
          : empty('系统里没有检测到英文语音，朗读功能将不可用。可在系统设置里安装英文语音包。', 'warning'))
        : empty('当前浏览器不支持语音合成（speechSynthesis），朗读功能不可用。', 'warning'),
    ], 'pad'));

    /* ---- 出题 ---- */
    const sizeOpts = [5, 10, 15, 20, 30, 50].map((n) => ({ value: String(n), label: `${n} 题` }));
    host.append(panel([
      h('div', { class: 'sec-title' }, [h('h2', { text: '出题设置' })]),
      selectRow('四选一题量', String(st.quizSize), sizeOpts, (v) => set('quizSize', Number(v)), { iconName: 'target' }),
      selectRow('翻卡张数', String(st.cardSize), [10, 20, 30, 50, 100].map((n) => ({ value: String(n), label: `${n} 张` })), (v) => set('cardSize', Number(v)), { iconName: 'cardOutline' }),
      selectRow('拼写题量', String(st.spellSize), sizeOpts, (v) => set('spellSize', Number(v)), { iconName: 'note' }),
      selectRow('几星算掌握', String(st.masterThreshold), [3, 4, 5].map((n) => ({ value: String(n), label: `${n} 星` })), (v) => set('masterThreshold', Number(v)), { desc: '影响统计里的「已掌握」口径', iconName: 'star' }),
      toggleRow('四选一限时', '每题倒计时，超时算答错', st.timer, (v) => set('timer', v), 'hourglass'),
      toggleRow('显示音标', '在题目里显示音标提示', st.showPhonetic, (v) => set('showPhonetic', v), 'note'),
      toggleRow('显示例句', '答完后显示中英例句', st.showExample, (v) => set('showExample', v), 'scroll'),
      h('div', { class: 'row toggle-row' }, [
        h('div', { class: 'row-main' }, [
          h('div', { class: 'row-label' }, [icon('note', 'ico sm'), h('span', { text: '拼写作答方式' })]),
          h('div', { class: 'row-desc', text: st.spellMode === 'type' ? '键盘输入，接近真实拼写' : '从打乱的字母里点选拼出单词' }),
        ]),
        segmented([
          { value: 'type', label: '键盘输入', iconName: 'note' },
          { value: 'letters', label: '字母点选', iconName: 'dice' },
        ], st.spellMode, (v) => set('spellMode', v)),
      ]),
    ], 'pad'));

    /* ---- 数据 ---- */
    host.append(panel([
      h('div', { class: 'sec-title' }, [h('h2', { text: '数据' })]),
      h('div', { class: 'row' }, [
        h('div', { class: 'row-main' }, [
          h('div', { class: 'row-label' }, [icon('save', 'ico sm'), h('span', { text: '本地占用' })]),
          h('div', { class: 'row-desc', text: '所有学习记录与自定义词库都保存在浏览器本地' }),
        ]),
        h('b', { text: fmtBytes(store.usedBytes()) }),
      ]),
      h('div', { class: 'row-actions wrap' }, [
        btn({ label: '学习统计', iconName: 'trophy', size: 'sm', onclick: () => app.go('stats') }),
        btn({
          label: '恢复默认设置', iconName: 'gear', size: 'sm', kind: 'ghost',
          onclick: async () => {
            const ok = await app.confirm('恢复默认设置', '会把所有设置项恢复为初始值（不影响学习进度）。');
            if (!ok) return;
            app.s.settings = { ...DEFAULT_SETTINGS };
            app.saveAll();
            app.toast('已恢复默认设置', 'ok');
            renderAll();
          },
        }),
      ]),
    ], 'pad'));

    /* ---- 关于 ---- */
    const depTracks = music.tracksFor('menu');   // 本地可见的菜单曲目
    host.append(panel([
      h('div', { class: 'sec-title' }, [h('h2', { text: '关于' })]),
      h('ul', { class: 'tip-list' }, [
        h('li', { text: '单词小栈 · Word Hut —— 纯网页、零构建、可离线的背单词小游戏。' }),
        h('li', { text: '词库：内置四级 / 六级 / 专四 / 专八 / 雅思 / 托福六套，均含音标、释义与例句。' }),
        h('li', { text: '音效与图标：Kenney 素材包（CC0，可商用）。' }),
        h('li', { text: '宝可梦素材未被本游戏使用；此处仅复用同项目里已整理好的 Kenney 音效与 UI 图标。' }),
        h('li', {}, [
          h('span', { text: '背景音乐（本地共 ' + depTracks.length + ' 首）：' }),
          h('br'),
          h('span', { class: 'muted', text: '· CC0 公有领域氛围曲 —— cynicmusic / AWeirdDay，' }),
          h('span', { class: 'muted', text: '来源 OpenGameArt（CC0 允许自由再分发与商用，无需署名）' }),
        ]),
        h('li', {}, [
          h('span', { class: 'muted', text: '· 「命运的指引」「联合之心·交响进行曲」—— takai（音楽の卵）、藤村ほわん（龍的交響楽），' }),
          h('span', { class: 'muted', text: '两站条款均允许嵌入游戏，但禁止把音频单独再打包分发' }),
        ]),
        h('li', {}, [
          h('span', { text: '字体：中文与拉丁「檎风黑体 Alt CHS」（SIL OFL 1.1）；日文「07やさしさゴシック」（M+ FONT LICENSE + IPA フォントライセンス v1.0）。' }),
          h('br'),
          // IPA 字体许可要求让服务器使用者能看到许可证，所以这里给出可直接打开的正文链接，
          // 而不是只写「见仓库文件」。移除这些链接前请重新确认该条要求。
          h('span', { class: 'muted', text: '两款字体均原样分发（未子集化、未转换、未改名）。许可正文：' }),
          h('a', { class: 'lic-link', href: './assets/fonts/OFL-1.1.txt', target: '_blank', rel: 'noopener', text: 'OFL 1.1' }),
          h('span', { class: 'muted', text: ' · ' }),
          h('a', { class: 'lic-link', href: './assets/fonts/IPA-Font-License-1.0.txt', target: '_blank', rel: 'noopener', text: 'IPA フォントライセンス v1.0' }),
          h('span', { class: 'muted', text: ' · ' }),
          h('a', { class: 'lic-link', href: './assets/fonts/Mplus-LICENSE_E.txt', target: '_blank', rel: 'noopener', text: 'M+ FONT LICENSE' }),
        ]),
        h('li', { class: 'muted', text: '完整署名与授权依据见仓库根目录 CREDITS.md。' }),
      ]),
    ], 'pad'));
  }

  wrap.append(host);
  renderAll();
  app.setKeyHint('本页设置立即生效并自动保存');
  return wrap;
}
