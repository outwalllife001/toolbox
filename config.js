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
};
