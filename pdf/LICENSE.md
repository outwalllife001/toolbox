# 许可证：GNU AGPL-3.0

「PDF 合并 · 压缩」这一页（本目录 `pdf/` 下的 `index.html`、`app.js`、`core.js`、`worker.js`、`style.css`）以 **GNU Affero General Public License v3.0**（AGPL-3.0-only）发布。
本页在浏览器里运行时，和站点公共文件 `config.js`、`member.js` 一起工作；这两个文件作为本页的一部分时，同样按 AGPL-3.0 提供。

- 许可证全文：[`../vendor/hyper-compress/LICENSE`](../vendor/hyper-compress/LICENSE)（与 GNU 官方文本 https://www.gnu.org/licenses/agpl-3.0.txt 相同）
- 本页完整源代码：就是网站上这些文件本身（没有压缩、混淆），也在公开仓库 https://github.com/outwalllife001/toolbox 的 `pdf/` 目录

## 为什么是 AGPL
压缩用的是 [BentoPDF](https://github.com/alam00000/bentopdf) 团队开源的 PDF 压缩引擎 [Hyper Compress](https://github.com/alam00000/bentopdf-hyper-compress)（AGPL-3.0）。
本站原样使用它的 npm 包 `hyper-compress-wasm@1.1.3`（`../vendor/hyper-compress/`，未做任何修改），对应源码在上游仓库的 tag
[`v1.1.3`](https://github.com/alam00000/bentopdf-hyper-compress/tree/v1.1.3)。引擎里打包的第三方组件（PDFium、qpdf、jpegli、Leptonica 等）各自的许可证见 [`NOTICE.md`](../vendor/hyper-compress/NOTICE.md)。

## 其他组件
- [pdf-lib](https://github.com/Hopding/pdf-lib) 1.17.1：MIT（`../vendor/pdf-lib/`）
- [PDF.js](https://github.com/mozilla/pdf.js) 6.4.299：Apache-2.0（`../vendor/pdfjs/`）

本程序不提供任何担保。详见许可证全文。
