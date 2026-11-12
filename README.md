# 开源宝藏工具箱

每天一个免费好用的开源工具，网页打开就能用，所有处理都在浏览器里完成，文件不上传。

在线地址：https://outwalllife001.github.io/toolbox/

| 工具 | 基于的开源项目 | 许可证 |
|---|---|---|
| [一键证件照](idphoto/) | [HivisionIDPhotos](https://github.com/Zeyi-Lin/HivisionIDPhotos) | Apache-2.0 |
| [拍照变扫描件](scan/) | [jscanify](https://github.com/puffinsoft/jscanify) + [OpenCV.js](https://github.com/opencv/opencv) | MIT / Apache-2.0 |
| [AI 抠图 · 白底图](cutout/) | [rembg](https://github.com/danielgatis/rembg) 的 isnet-general-use 模型（[DIS / IS-Net](https://github.com/xuebinqin/DIS)） | MIT / Apache-2.0 |
| [视频自动加字幕](subtitle/) | [SenseVoiceSmall](https://github.com/QwenAudio/SenseVoice)（阿里巴巴 FunAudioLLM）+ [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) 的 int8 导出；导出视频用 [Mediabunny](https://github.com/Vanilagy/mediabunny) | MIT（代码）/ [FunASR 模型许可证](https://github.com/modelscope/FunASR/blob/main/MODEL_LICENSE)（权重）/ Apache-2.0 / MPL-2.0 |
| [汉字笔顺字帖](zitie/) | [Hanzi Writer](https://github.com/chanind/hanzi-writer) + [pinyin-pro](https://github.com/zh-lx/pinyin-pro)（笔画数据 [Make Me a Hanzi](https://github.com/skishore/makemeahanzi)） | MIT / Arphic Public License |
| [模糊照片变高清](upscale/) | [Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN)（realesr-general-x4v3） | BSD-3-Clause |
| [手机签名盖到 PDF](sign/) | [signature_pad](https://github.com/szimek/signature_pad) + [pdf-lib](https://github.com/Hopding/pdf-lib) + [PDF.js](https://github.com/mozilla/pdf.js) | MIT / MIT / Apache-2.0 |
| [视频压缩 · 转 GIF](video-compress/) | [Mediabunny](https://github.com/Vanilagy/mediabunny) + [gifenc](https://github.com/mattdesl/gifenc) | MPL-2.0 / MIT |
| [录音转文字](transcribe/) | 和「视频自动加字幕」共用 [SenseVoiceSmall](https://github.com/QwenAudio/SenseVoice) + [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) 的语音识别；长录音用 [Mediabunny](https://github.com/Vanilagy/mediabunny) 读取 | MIT（代码）/ [FunASR 模型许可证](https://github.com/modelscope/FunASR/blob/main/MODEL_LICENSE)（权重）/ Apache-2.0 / MPL-2.0 |
| [免费简历生成器](resume/) | 版式移植自 [Reactive Resume](https://github.com/reactive-resume/reactive-resume)；导出用 [pdf-lib](https://github.com/Hopding/pdf-lib)，字体 Noto Sans SC | MIT / MIT / OFL-1.1 |
| [照片变涂色画](coloring/) | [informative-drawings](https://github.com/carolineec/informative-drawings)（anime_style 模型）+ [DIS / IS-Net](https://github.com/xuebinqin/DIS) 去背景 | MIT / Apache-2.0 |
| [PDF 合并 · 压缩](pdf/) | [BentoPDF](https://github.com/alam00000/bentopdf) 团队的 [Hyper Compress](https://github.com/alam00000/bentopdf-hyper-compress) 压缩引擎 + [pdf-lib](https://github.com/Hopding/pdf-lib) + [PDF.js](https://github.com/mozilla/pdf.js) | AGPL-3.0（这一页按 AGPL 开源，见 [pdf/LICENSE.md](pdf/LICENSE.md)）/ MIT / Apache-2.0 |
| [今天吃什么](cook/) | 菜谱和成品照片来自 [HowToCook](https://github.com/Anduin2017/HowToCook)；食材图标参考 [YunYouJun/cook](https://github.com/YunYouJun/cook)（见 [cook/NOTICE.md](cook/NOTICE.md)） | Unlicense / MIT |

`coi-sw.js`：只给「录音转文字」页补上跨源隔离响应头（COOP / COEP）的 Service Worker，让语音识别能开多线程。装上后作用于整个网站，但只接手录音转文字页和它要用的文件（别的页面加载同一批运行库时也会带上这些响应头，不影响使用，见 `days/day09-transcribe/sw_check.mjs`）。`member.js` + `member/codes.json`：工具箱会员码（`config.js` 里配置了 `member` 才启用）。

第三方运行时与模型见 [vendor/README.md](vendor/README.md)、[models/README.md](models/README.md)。
本仓库由私有工作仓库自动发布，请不要直接在这里改。
