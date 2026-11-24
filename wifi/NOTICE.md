# 许可证和来源说明（WiFi 二维码桌牌）

## wifi-card（MIT）
二维码里装的文字格式（`WIFI:T:<加密方式>;S:<名称>;P:<密码>;H:true;;`，名称和密码里的 `\ " ; , :` 前面加反斜杠）和「开放网络 / 隐藏网络」的处理方式，参考了开源项目 [bndw/wifi-card](https://github.com/bndw/wifi-card)（[wificard.io](https://wificard.io)）。本页没有拷贝它的界面代码（它是 React 应用），桌牌样式、拼版和 PDF 导出都是自己写的；`days/day18-wifi/e2e.mjs` 里把它的 `buildQrValue` 原样拷过去，对 10 种写法逐字节对比过输出。

和它不一样的一处：「没有密码」时本页不写 `P:` 字段（`WIFI:T:nopass;S:名称;;`），wifi-card 会写一个空的 `P:;`；两种写法都是合法的。

```
MIT License

Copyright (c) 2020 Ben Woodward

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## qrcode-generator（MIT）
二维码用 Kazuhiko Arase 的 [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) 2.0.4 生成（`../vendor/qrcode-generator/`，原样拷贝，许可证见同目录 `LICENSE`）。「QR Code」是 DENSO WAVE INCORPORATED 的注册商标。

## pdf-lib（MIT）
导出 PDF 用 [pdf-lib](https://github.com/Hopding/pdf-lib)（`../vendor/pdf-lib/`，导出时才加载）。

## 字体
卡片上的文字用你设备自带的字体（苹果 PingFang SC、安卓 Noto Sans CJK / 思源黑体、Windows 微软雅黑等），网页不下载、不嵌入任何字体文件，所以不同设备上字形略有差别。
