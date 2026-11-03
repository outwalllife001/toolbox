// 示例简历（虚构人物：照片是第 1 期「一键证件照」用可灵生成的虚拟人像做的证件照）
export const SAMPLE = {
  basics: {
    name: '林子航', title: '新媒体运营', phone: '138-0000-1234', email: 'zihang.lin@example.com', city: '杭州',
    age: '23 岁', politics: '共青团员', wechat: '', photo: null, showPhoto: true,
  },
  sections: [
    { id: 'edu', type: 'entry', title: '教育经历', items: [
      { org: '江城大学 · 新闻传播学院', role: '网络与新媒体 · 本科', start: '2021.09', end: '2025.06', desc: 'GPA 3.6 / 4.0，专业前 10%\n主修：新媒体运营、数据分析、视听语言、广告策划' },
    ] },
    { id: 'work', type: 'entry', title: '实习经历', items: [
      { org: '杭州某文创品牌', role: '新媒体运营实习生', start: '2024.07', end: '2024.12', desc: '负责小红书和抖音账号日常更新，5 个月发布笔记 80 篇、短视频 36 条\n策划「开学季手账」话题，单条笔记点赞 1.2 万，账号粉丝从 3,000 涨到 1.8 万\n每周整理数据周报，找出完播率低的视频开头，调整后平均完播率提升 9%' },
      { org: '江城日报新媒体中心', role: '编辑实习生', start: '2023.07', end: '2023.09', desc: '参与公众号选题和排版，独立完成推文 12 篇，最高阅读 4.6 万\n协助拍摄、剪辑城市专题短视频 8 条' },
    ] },
    { id: 'proj', type: 'entry', title: '项目经历', items: [
      { org: '校园二手书小程序推广', role: '项目负责人', start: '2023.03', end: '2023.06', desc: '带 5 人小组做线上线下推广，3 个月注册用户 2,600 人\n用问卷和访谈整理出 3 类用户需求，推动上线「按课程找书」功能' },
    ] },
    { id: 'campus', type: 'entry', title: '校园经历', items: [
      { org: '学院融媒体中心', role: '副主任', start: '2022.09', end: '2024.06', desc: '管理 20 人的采编团队，负责学院公众号和视频号的内容规划' },
    ] },
    { id: 'skills', type: 'text', title: '技能证书', items: [{ text: '英语六级（568 分）\n计算机二级 MS Office\n熟练使用 剪映、PS、秀米\n会用 Excel 透视表做数据分析' }] },
    { id: 'awards', type: 'text', title: '荣誉奖项', items: [{ text: '校级一等奖学金（2023）\n全国大学生广告艺术大赛 省级二等奖\n优秀学生干部' }] },
    { id: 'summary', type: 'text', title: '自我评价', items: [{ text: '喜欢琢磨用户为什么点开、为什么划走，习惯用数据验证想法；做事有条理，能扛住多个账号同时更新的节奏。' }] },
  ],
};

export function blank() {
  return {
    basics: { name: '', title: '', phone: '', email: '', city: '', age: '', politics: '', wechat: '', photo: null, showPhoto: true },
    sections: [
      { id: 'edu', type: 'entry', title: '教育经历', items: [{}] },
      { id: 'work', type: 'entry', title: '实习经历', items: [{}] },
      { id: 'proj', type: 'entry', title: '项目经历', items: [{}] },
      { id: 'campus', type: 'entry', title: '校园经历', items: [{}] },
      { id: 'skills', type: 'text', title: '技能证书', items: [{}] },
      { id: 'awards', type: 'text', title: '荣誉奖项', items: [{}] },
      { id: 'summary', type: 'text', title: '自我评价', items: [{}] },
    ],
  };
}
