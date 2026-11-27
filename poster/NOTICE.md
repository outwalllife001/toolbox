# 许可证和来源说明（店铺海报）

## 编辑器内核：vue-fabric-editor · 快图设计（MIT）+ fabric.js（MIT）
画布、选中后的控制点、拖动时的对齐辅助线、撤销 / 重做、图层上下移、居中、导入 JSON 的流程，用的是开源项目
[ikuaitu/vue-fabric-editor](https://github.com/ikuaitu/vue-fabric-editor)（快图设计）的编辑器内核 `packages/core`：
`Editor`、`ServersPlugin`，以及 `WorkspacePlugin`、`ControlsPlugin`、`AlignGuidLinePlugin`、`HistoryPlugin`、`LayerPlugin`、`CenterAlignPlugin`、`DeleteHotKeyPlugin`、`MoveHotKeyPlugin` 8 个插件，
取自 commit `b3bdcfb`（2026-07-21），**源码没有修改**，和它依赖的 [fabric.js](https://github.com/fabricjs/fabric.js) 5.3.0 一起打包成 `../vendor/kuaitu-core/kuaitu-core.min.mjs`（打包脚本在私有仓库的 `days/day20-poster/bundle/`）。各部分的许可证原文在 [`../vendor/kuaitu-core/LICENSES.txt`](../vendor/kuaitu-core/LICENSES.txt)。

没有用它的：Vue 界面、模板库和素材接口（它们来自快图设计的线上服务，不在 MIT 仓库里）、标尺、二维码、PSD 导入等其它插件。
本页的模板、贴纸、配色、手机界面、换照片、文字自动缩小、换尺寸重排、导出和本机草稿是自己写的。模板存成的 JSON 和快图设计是同一种格式（fabric.js 的 JSON，第一个对象是 `id: workspace` 的画布）。

运行时在本页代码里（不是改上游文件）调整了三处：
- fabric 5.3 画字前把 `textBaseline` 设成了不存在的 `'alphabetical'`，每画一次浏览器就告警一次 → 换成 `'alphabetic'`；
- 文本框沿用内核的角点和旋转图标（fabric 给文本框单独留了一份默认控制点）；
- 没带标尺插件，给 `fabric.GuideLine` 放了一个空类占位（内核的选中事件里要用它做判断）。

## 字体（都是 SIL Open Font License 1.1）
OFL 允许免费商用、允许修改和再分发，但改过的版本不能沿用原作者保留的字体名，也不能把字体文件单独拿去卖。
本页的字体都**裁成了常用字子集**（GB2312 的 6763 个汉字 + 西文和常用符号，去掉了字距等排版表），所以**字体内部的名字都改了**，页面上写「源自 ××」。许可证原文在 `fonts/` 目录。

| 页面上的名字 | 文件 | 原字体 | 版权 / 保留名称 | 许可证原文 |
|---|---|---|---|---|
| 端正粗黑 | `../resume/fonts/sc-700.ttf`（和简历页共用） | [思源黑体 Noto Sans SC](https://github.com/notofonts/noto-cjk) Bold | Adobe / Google | [`../resume/fonts/OFL.txt`](../resume/fonts/OFL.txt) |
| 潮流斜黑 | `fonts/xiehei.woff2` | [得意黑 Smiley Sans](https://github.com/atelier-anchor/smiley-sans) v2.0.1 | © 2022–2024 atelierAnchor，保留名称 Smiley、得意黑 | [`fonts/OFL-smileysans.txt`](fonts/OFL-smileysans.txt) |
| 温润楷体 | `fonts/kai.woff2` | [霞鹜文楷 LXGW WenKai](https://github.com/lxgw/LxgwWenKai) v1.530 Medium | © 2021–2026 LXGW，保留名称 霞鹜、落霞孤鹜、LXGW；基于 Fontworks 的 Klee One | [`fonts/OFL-lxgwwenkai.txt`](fonts/OFL-lxgwwenkai.txt) |
| 圆润快乐体 | `fonts/kuaile.woff2` | [站酷快乐体 ZCOOL KuaiLe](https://github.com/googlefonts/zcool-kuaile) | © 2018 The ZCOOL KuaiLe Project Authors | [`fonts/OFL-zcoolkuaile.txt`](fonts/OFL-zcoolkuaile.txt) |
| 高挑黄油体 | `fonts/huangyou.woff2` | [站酷庆科黄油体 ZCOOL QingKe HuangYou](https://github.com/googlefonts/zcool-qingke-huangyou) | © 2018 The ZCOOL QingKe HuangYou Project Authors | [`fonts/OFL-zcoolqingkehuangyou.txt`](fonts/OFL-zcoolqingkehuangyou.txt) |
| 毛笔楷书 | `fonts/maobi.woff2` | [马善政毛笔楷书 Ma Shan Zheng](https://github.com/googlefonts/mashanzheng) | © 2018 The Ma Shan Zheng Project Authors | [`fonts/OFL-mashanzheng.txt`](fonts/OFL-mashanzheng.txt) |

`fonts/*-name.woff2` 是只含字体名那几个字的小文件，给选字体的按钮显示用。

## 一键抠图
直接调用本站「AI 抠图」页的代码（`../cutout/core.js`，移植自 [rembg](https://github.com/danielgatis/rembg) MIT 的 isnet-general-use 流程）和模型（[DIS / IS-Net](https://github.com/xuebinqin/DIS)，Apache-2.0，见 `../models/README.md`）。

## 导出 PDF
[pdf-lib](https://github.com/Hopding/pdf-lib)（MIT），见 `../vendor/README.md`。
