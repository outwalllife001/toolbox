# 第三方运行时和数据（除表里注明的改动外，原样拷贝）
| 目录 | 包 | 版本 | 许可证 |
|---|---|---|---|
| `ort/` | [onnxruntime-web](https://github.com/microsoft/onnxruntime)（`ort.wasm.min.mjs` + `ort-wasm-simd-threaded.*`；第 6 期加了 WebGPU 版 `ort.webgpu.min.mjs` + `ort-wasm-simd-threaded.jsep.*`） | 1.22.0 | MIT |
| `mediapipe/` | [@mediapipe/tasks-vision](https://github.com/google-ai-edge/mediapipe) | 0.10.21 | Apache-2.0 |
| `opencv/` | [OpenCV.js](https://github.com/opencv/opencv)（取自 npm 包 jscanify@1.4.3 的 `src/opencv.js`） | 4.7.0 | Apache-2.0 |
| `jscanify/` | [jscanify](https://github.com/puffinsoft/jscanify)（npm 包 jscanify@1.4.3 的 `src/jscanify.js`） | 1.4.3 | MIT |
| `mediabunny/` | [Mediabunny](https://github.com/Vanilagy/mediabunny)（npm 包 `dist/bundles/mediabunny.min.mjs`，附 LICENSE） | 1.62.1 | MPL-2.0（原样使用，未修改；源码见原项目） |
| `hanzi-writer/` | [Hanzi Writer](https://github.com/chanind/hanzi-writer)（npm 包 `dist/hanzi-writer.min.js`，附 LICENSE） | 3.7.3 | MIT |
| `pinyin-pro/` | [pinyin-pro](https://github.com/zh-lx/pinyin-pro)（npm 包 `dist/index.js`，UMD，附 LICENSE） | 3.29.5 | MIT |
| `hanzi-writer-data/` | [hanzi-writer-data](https://github.com/chanind/hanzi-writer-data)（数据来自 [Make Me a Hanzi](https://github.com/skishore/makemeahanzi)）。用 `days/day05-zitie/make_data.mjs` 生成：文件名改成码位（`6211.json` = 我），**修正了 6 个字的笔顺**，改动见目录里的 `NOTICE.md` | 2.0.1 | Arphic Public License（`ARPHICPL.TXT`、`APL/`） |

自己托管而不走 CDN：国内访问 jsdelivr / Google 存储不稳定。升级时改 `package.json` 版本，`npm install` 后重新拷贝。
jscanify 的 npm 包依赖 node-canvas（要编译原生模块），没放进 `package.json`：用 `npm pack jscanify@<版本>` 解包后拷贝上面两个文件。
