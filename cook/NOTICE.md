# 今天吃什么 · 数据来源和许可证

## 菜谱和成品照片：HowToCook（Unlicense）
`data.json` 里的菜谱（简介、原料、用量、步骤、补充说明）和 `img/` 里的成品照片，全部来自
[Anduin2017/HowToCook](https://github.com/Anduin2017/HowToCook)（程序员做饭指南），取自 2026-10-26 的提交 `308cc8b7da`。
原项目按 [The Unlicense](https://unlicense.org) 发布（作者放弃版权，进入公有领域），许可证原文见本目录 `UNLICENSE.txt`。

本页做了这些处理（做法文字没有改）：
- 只收 `dishes/` 下的荤菜、素菜、水产、主食、汤粥、早餐、半成品、甜品，共 341 道；饮品（一半是鸡尾酒）、酱料没收
- 把每道菜「必备原料和工具」逐条归成：主料 / 常用调料 / 另需调料 / 工具，用来按食材匹配（程序归类，偶尔不准，菜谱页里保留了原文）
- 成品照片缩成 640×480 和 180×180 两个尺寸
- 一个菜名改了：「韩国麻药鸡蛋」→「韩式酱油腌鸡蛋」
- 每道菜下面有指向原文的链接

## 食材图标（emoji）和「按食材找菜」的玩法：YunYouJun/cook（MIT）
食材对应的 emoji 部分取自 [YunYouJun/cook](https://github.com/YunYouJun/cook) 的 `packages/data/food.json`，玩法也参考了它。没有使用它的菜谱数据和界面代码。

```
MIT License

Copyright (c) 2022 云游君 YunYouJun <me@yunyoujun.cn>

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

重新生成数据：私有工作仓库的 `days/day13-cook/make_data.py`。
