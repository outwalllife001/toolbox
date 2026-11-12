// 站点配置：填好后重新运行 tools/deploy_site.sh
// service 为 null 时页面不显示「代做」入口
window.SITE_CONFIG = {
  service: null,
  // 示例（按自己的情况改）：
  // service: {
  //   price: '¥9.9',
  //   text: '不会弄 / 没时间？把照片发给我，10 分钟内做好发你（标准照 + 六寸排版 + 指定 KB）',
  //   contact: '微信：your-wechat-id',
  //   qr: 'img/wechat-qr.jpg',      // 可选：放到 site/img/
  //   tools: {                      // 可选：某个工具页单独的价格和说明（不填就用上面的）
  //     scan: { price: '¥5', text: '照片发我，帮你拉正去阴影、合成一份 PDF，压到指定大小' },
  //   },
  // },

  // 工具箱会员（会员码）。member 为 null 时：所有功能免费、页面上没有会员入口
  // 填好后：首页和工具页出现「开通会员」，录音转文字超过 60 分钟的部分、简历存第 2 份起、一周菜单排满 7 天等要会员（以后的进阶功能也挂在这里）
  // 会员码：python3 tools/member_codes.py 200 生成（members/ 下的 txt 上传到收款平台自动发货），作废用 --revoke
  member: null,
  // 示例：
  // member: {
  //   price: '¥9.9', was: '¥19.9', label: '早鸟价',
  //   buy: 'https://afdian.com/item/xxxx',          // 收款平台的商品链接（爱发电 / 面包多等，能自动发兑换码的）
  //   buyText: '去购买会员码',
  //   how: '付款后自动发会员码，回到这里输入即可',
  //   perks: ['全站工具的进阶功能都能用（录音转文字不限时长、简历存多份…）', '以后每天上新的工具，进阶功能一样能用'],
  // },
};
