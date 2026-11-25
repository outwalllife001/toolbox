# 跟读提词器 · 许可证说明

这个页面（`site/prompter/`）的界面和跟读算法（`app.js`、`follow.js`、`style.css`、`index.html`）由开源宝藏工具箱制作。用到的开源项目：

| 用在哪 | 项目 | 许可证 | 说明 |
|---|---|---|---|
| 玩法参考 | [Textream](https://github.com/f/textream)（Fatih Kadir Akın） | MIT | macOS 上的提词器：边说边把稿子里念过的词标出来。本页只参考了「说到哪亮到哪」这个交互，**没有使用它的代码**（它是 Swift 写的 macOS 应用，用的是苹果系统自带的语音识别） |
| 语音识别流程 | [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)（k2-fsa / 新一代 Kaldi） | Apache-2.0 | `asr.js` 是照它的 C++ 实现（`features.cc`、`online-zipformer-transducer-model.cc`、`online-transducer-greedy-search-decoder.cc`）移植到浏览器的：Kaldi fbank 特征、流式 Zipformer 的状态管理、贪心解码。同一批录音和原版逐字相同 |
| 语音识别模型 | streaming zipformer zh-14M：[csukuangfj/sherpa-onnx-streaming-zipformer-zh-14M-2023-02-23](https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-zh-14M-2023-02-23)，原始权重 [marcoyang/sherpa-ncnn-streaming-zipformer-zh-14M-2023-02-23](https://huggingface.co/marcoyang/sherpa-ncnn-streaming-zipformer-zh-14M-2023-02-23)，用 [icefall](https://github.com/k2-fsa/icefall) 训练 | Apache-2.0（两个模型仓库的模型卡都这么标） | 文件在 `../models/zipformer-zh-14m/`：权重换了存法（encoder、joiner 存成 int8，decoder 存成 fp16，计算仍是 fp32），识别结果和原版 fp32 一样好。sherpa-onnx 的文档写明它是用 WenetSpeech 语料训练的；WenetSpeech 数据集自己的说明是「供非商业用途下载」（CC BY 4.0，音频版权归原作者），这里用的是模型权重，不含数据集 |
| 模型运行 | [onnxruntime-web](https://github.com/microsoft/onnxruntime) 1.22.0 | MIT | `../vendor/ort/` |
| 读音 | [pinyin-pro](https://github.com/zh-lx/pinyin-pro) 3.29.5 | MIT | `../vendor/pinyin-pro/`，把稿子和识别结果都换成拼音再比对 |

Apache-2.0 全文：`../models/zipformer-zh-14m/LICENSE`。
