# 第三方运行时（原样拷贝，未修改）
| 目录 | 包 | 版本 | 许可证 |
|---|---|---|---|
| `ort/` | [onnxruntime-web](https://github.com/microsoft/onnxruntime) | 1.22.0 | MIT |
| `mediapipe/` | [@mediapipe/tasks-vision](https://github.com/google-ai-edge/mediapipe) | 0.10.21 | Apache-2.0 |

自己托管而不走 CDN：国内访问 jsdelivr / Google 存储不稳定。升级时改 `package.json` 版本，`npm install` 后重新拷贝。
