# 第三方运行时（原样拷贝，未修改）
| 目录 | 包 | 版本 | 许可证 |
|---|---|---|---|
| `ort/` | [onnxruntime-web](https://github.com/microsoft/onnxruntime) | 1.22.0 | MIT |
| `mediapipe/` | [@mediapipe/tasks-vision](https://github.com/google-ai-edge/mediapipe) | 0.10.21 | Apache-2.0 |
| `opencv/` | [OpenCV.js](https://github.com/opencv/opencv)（取自 npm 包 jscanify@1.4.3 的 `src/opencv.js`） | 4.7.0 | Apache-2.0 |
| `jscanify/` | [jscanify](https://github.com/puffinsoft/jscanify)（npm 包 jscanify@1.4.3 的 `src/jscanify.js`） | 1.4.3 | MIT |

自己托管而不走 CDN：国内访问 jsdelivr / Google 存储不稳定。升级时改 `package.json` 版本，`npm install` 后重新拷贝。
jscanify 的 npm 包依赖 node-canvas（要编译原生模块），没放进 `package.json`：用 `npm pack jscanify@<版本>` 解包后拷贝上面两个文件。
