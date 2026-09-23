# 网页字体 / Web fonts

两款字体都**原样分发**（未子集化、未转换格式、未改名），文件字节与获取到的原始文件完全一致。
下面的 SHA-256 可用于自行核对。

| 文件 | 字体 | 大小 | 许可 |
|---|---|---:|---|
| `QynFlavorAltCHS-Regular.ttf` | 檎风黑体 Alt CHS / Qyn Flavor Grotesk Alt CHS | 13,112,888 B | SIL OFL 1.1 |
| `07YasGothic-Regular.ttf` | 07やさしさゴシック / 07YasashisaGothic | 4,615,092 B | M+ FONT LICENSE + IPA フォントライセンス v1.0 |

```
9CD8DAA69349A53E730925A4D1AF53866F04392E31F4CC93D845211A532D1700  QynFlavorAltCHS-Regular.ttf
D950993BD9341783D852EFAB87D19BF5F4B920D5F644A7CF9564E48BA5D05912  07YasGothic-Regular.ttf
```

## 檎风黑体 Alt CHS（中文 / 拉丁 / 音标）
- 版权：`Copyright (c) 2026, howlingFounts.`，并包含 Renzhi Li（Sarasa Gothic，Belleve Invis）、
  Pretendard、The Inter Project、Adobe（Source）、Chiron Hei HK、Google 的部分版权。
- 保留字体名（Reserved Font Name）：**'Pretendard'、'Source'**。本仓库未做修改，因此不触发该限制；
  若日后要做子集化或改名，必须先移除这些保留名。
- 许可：**SIL Open Font License 1.1**，全文见 `OFL-1.1.txt`（第 2 条要求随附版权声明与本许可，已满足）。
- OFL 明确允许 `embed`（网页嵌入）与再分发，**无需**公开源码或支付费用；唯一禁止的是「单独售卖字体本身」。

## 07やさしさゴシック（日文）
- 版权：`Fontna.com, M + FONTS PROJECT, Information-technology Promotion Agency, Japan`
  （出处页面另注明：`ひらがな・カタカナ部分のデザイン Copyright(c)fontna.com`）。
- 许可：**M+ FONT LICENSE** 与 **IPA フォントライセンス v1.0** 双重约束，正文分别见
  `Mplus-LICENSE_E.txt`、`IPA-Font-License-1.0.txt`。
- 官方说明（fontna.com「やさしさゴシック」页面）：可自由下载，**商用、非商用均可使用**，媒体形式不限；
  但**改変再配布、程序嵌入、服务器上传**均受上述两份许可条款约束。

### 本仓库为什么可以这样用
IPA 字体许可 **第 2 条第 6 项** 允许「**原样不改动**地复制并公开传输/再分发」，条件是 **第 3 条第 2 项**：
1. 不得更改字体名称 —— 本仓库保留原名 `07YasashisaGothic`（仅把文件名里的空格换成连字符，字体内部名称未改）；
2. 不得改动字体 —— 已用 SHA-256 核对，文件与原文件字节一致；
3. 必须随附本许可副本 —— 即 `IPA-Font-License-1.0.txt`。
M+ 许可则明确「unlimited permission to use, copy, and distribute … with or without modification」，
可与 IPA 条款叠加满足。

### 注意事项
- **不要**对 `07YasGothic-Regular.ttf` 做子集化、WOFF2 转换或改名。那样会构成 IPA 许可第 1 条第 3 项的
  「派生程序」，需要额外履行第 3 条第 1 项（提供可再修改的原始形式、提供还原为原始程序的手段、
  以同一许可授权、且不得沿用原名），手续明显更重。
- IPA 字体许可要求让**服务器使用者**能够看到该许可；本站的做法是在词库/设置页给出可见链接，
  并把全文放在本目录。若日后移除该链接，请重新审视这一条。
- 07やさしさゴシック 是**日文**字体，不含简体中文字形（缺 专/东/为/关 等），
  所以 CSS 里它只用于 `lang="ja"` 的日文文本；中文一律走 檎风黑体。
- `07YasGothic Regular.ttf` 与 `QynFlavorAltCHS-Regular.ttf` 两份原文件放在仓库根目录，
  本目录是提供给网页使用的副本（哈希一致）。
