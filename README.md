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

第三方运行时与模型见 [vendor/README.md](vendor/README.md)、[models/README.md](models/README.md)。
本仓库由私有工作仓库自动发布，请不要直接在这里改。
