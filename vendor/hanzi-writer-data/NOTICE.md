# 汉字笔画数据

来源：npm 包 [hanzi-writer-data](https://github.com/chanind/hanzi-writer-data) 2.0.1，数据来自 [Make Me a Hanzi](https://github.com/skishore/makemeahanzi)，由文鼎科技（Arphic Technology）1999 年以 Arphic Public License 发布的「文鼎 PL 简中楷」「文鼎 PL 中楷」字体提取。

- Arphic PL KaitiM GB and UKai — Copyright 1999 Arphic Technology Co., Ltd.; licensed under the Arphic Public License
- Make Me a Hanzi — Copyright 1999 Arphic Technology Co., Ltd., copyright 2016 Shaunak Kishore; licensed under the Arphic Public License
- 许可证全文：`ARPHICPL.TXT`（英文）、`APL/`（含简体中文、繁体中文版本）。你可以按 Arphic Public License 的条款再分发和修改这份数据。

## 本站的改动
- 文件名改为字符码位的十六进制（`6211.json` = 我），内容格式不变。
- 2026-10-25，开源宝藏工具箱修改了下面 6 个字的笔画顺序（只调换笔画先后，笔画形状没动），使其符合《现代汉语通用字笔顺规范》；改过的文件里有 `note` 字段：
  - 冉（`5189.json`）：中间的竖在里面的短横之前（竖、横折钩、竖、横、横），和同一份数据里的「再」一致
  - 盖（`76d6.json`）：上部：点、撇、横、横、竖、横（原数据竖在第三横之后），同「美」「羔」
  - 肠（`80a0.json`）：撇、横折钩、横、横、横折折折钩、撇、撇（原数据撇在横折折折钩之前），同「场」「汤」
  - 滚（`6eda.json`）：中间「公」的两笔先左撇后右点（原数据先右后左）
  - 寝（`5bdd.json`）：丬：点、提、竖（原数据先写竖），同「将」「状」
  - 衙（`8859.json`）：先写彳、再写中间的吾、最后写亍（原数据亍在吾之前）
- 另有 4 个字（兜、虐、翰、髓）比对结果可疑、但没有找到可靠的规范笔顺，数据没改，网页上会提示「以课本为准」。
