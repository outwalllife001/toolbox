# 第三方运行时和数据（除表里注明的改动外，原样拷贝）
| 目录 | 包 | 版本 | 许可证 |
|---|---|---|---|
| `ort/` | [onnxruntime-web](https://github.com/microsoft/onnxruntime)（`ort.wasm.min.mjs` + `ort-wasm-simd-threaded.*`；第 6 期加了 WebGPU 版 `ort.webgpu.min.mjs` + `ort-wasm-simd-threaded.jsep.*`） | 1.22.0 | MIT |
| `mediapipe/` | [@mediapipe/tasks-vision](https://github.com/google-ai-edge/mediapipe) | 0.10.21 | Apache-2.0 |
| `opencv/` | [OpenCV.js](https://github.com/opencv/opencv)（取自 npm 包 jscanify@1.4.3 的 `src/opencv.js`） | 4.7.0 | Apache-2.0 |
| `jscanify/` | [jscanify](https://github.com/puffinsoft/jscanify)（npm 包 jscanify@1.4.3 的 `src/jscanify.js`） | 1.4.3 | MIT |
| `mediabunny/` | [Mediabunny](https://github.com/Vanilagy/mediabunny)（npm 包 `dist/bundles/mediabunny.min.mjs`，附 LICENSE；第 4 期字幕、第 8 期视频压缩共用） | 1.62.1 | MPL-2.0（原样使用，未修改；源码见原项目） |
| `gifenc/` | [gifenc](https://github.com/mattdesl/gifenc)（npm 包 `dist/gifenc.esm.js`，附 LICENSE.md；第 8 期转 GIF 用） | 1.0.3 | MIT |
| `hanzi-writer/` | [Hanzi Writer](https://github.com/chanind/hanzi-writer)（npm 包 `dist/hanzi-writer.min.js`，附 LICENSE） | 3.7.3 | MIT |
| `pinyin-pro/` | [pinyin-pro](https://github.com/zh-lx/pinyin-pro)（npm 包 `dist/index.js`，UMD，附 LICENSE） | 3.29.5 | MIT |
| `hanzi-writer-data/` | [hanzi-writer-data](https://github.com/chanind/hanzi-writer-data)（数据来自 [Make Me a Hanzi](https://github.com/skishore/makemeahanzi)）。用 `days/day05-zitie/make_data.mjs` 生成：文件名改成码位（`6211.json` = 我），**修正了 6 个字的笔顺**，改动见目录里的 `NOTICE.md` | 2.0.1 | Arphic Public License（`ARPHICPL.TXT`、`APL/`） |
| `pdfjs/` | [PDF.js](https://github.com/mozilla/pdf.js)（npm 包 pdfjs-dist 的 legacy 版 `pdf.min.mjs` + `pdf.worker.min.mjs`，附 `cmaps/`、`standard_fonts/`、`iccs/` 和 `wasm/` 里的 jbig2 / openjpeg / qcms 解码器，各自的许可证文件原样附在目录里；没拷脚本引擎 quickjs） | 6.4.299 | Apache-2.0（解码器：PDFium BSD-3、OpenJPEG BSD-2、qcms MIT；字体：Foxit BSD-3、Liberation 见 `LICENSE_LIBERATION`；ICC：CC0） |
| `pdf-lib/` | [pdf-lib](https://github.com/Hopding/pdf-lib)（npm 包 `dist/pdf-lib.min.js`，UMD，附 LICENSE.md） | 1.17.1 | MIT |
| `fontkit/` | [@pdf-lib/fontkit](https://github.com/Hopding/fontkit)（npm 包 `dist/fontkit.umd.min.js`，fontkit 的 pdf-lib 分支；第 10 期简历导出 PDF 时给 pdf-lib 嵌入中文字体子集用。包里没附许可证文件，`LICENSE` 是上游 foliojs/fontkit 的 MIT 原文） | 1.1.1 | MIT |
| `signature_pad/` | [Signature Pad](https://github.com/szimek/signature_pad)（npm 包 `dist/signature_pad.min.js`，ES 模块，附 LICENSE） | 5.1.4 | MIT |
| `hyper-compress/` | [Hyper Compress](https://github.com/alam00000/bentopdf-hyper-compress)（[BentoPDF](https://github.com/alam00000/bentopdf) 团队的 PDF 压缩引擎，基于 PDFium；npm 包 `hyper-compress-wasm` 的 `index.js`、`lib/`、`engine/`，附 LICENSE、上游 tag v1.1.3 的 NOTICE.md；第 12 期 PDF 合并压缩用） | 1.1.3 | AGPL-3.0-only（原样使用，未修改；源码见上游 tag [v1.1.3](https://github.com/alam00000/bentopdf-hyper-compress/tree/v1.1.3)；引擎内的第三方组件见 NOTICE.md：PDFium BSD-3、qpdf Apache-2.0、jpegli BSD-3 等） |
| `simple-mind-map/` | [simple-mind-map](https://github.com/wanglin2/mind-map)（思绪思维导图的核心库）+ 它依赖的 svg.js、jszip、xml-js、sax 等：`days/day14-mindmap/bundle/build.mjs` 用 esbuild 打成一个 ES 模块，只带用到的插件（导出、XMind、彩虹线、思维导图布局），没带协同编辑 / 公式 / 富文本。**改动一处**：`entry.mjs` 里把 svg.js 的 `Box.addOffset` 改成不加页面滚动距离（原库在可滚动的页面里导出空白、看全图跑偏，见第 14 期 README）。各包许可证原文在 `LICENSES.txt` | 0.14.0-fix.3 | MIT（jszip 选 MIT；sax BlueOak-1.0.0；其余 MIT） |

自己托管而不走 CDN：国内访问 jsdelivr / Google 存储不稳定。升级时改 `package.json` 版本，`npm install` 后重新拷贝。
jscanify 的 npm 包依赖 node-canvas（要编译原生模块），没放进 `package.json`：用 `npm pack jscanify@<版本>` 解包后拷贝上面两个文件。
