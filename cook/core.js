// 今天吃什么：匹配和排菜单的逻辑（不碰页面，node 里也能跑，e2e 直接 import）
// 数据见 data.json（days/day13-cook/make_data.py 从 HowToCook 生成）：
//   recipe.need  = [[任选其一…], …]，每项 'c:西红柿'（能勾选的食材）或 'o:咖喱块'（不在勾选列表里的主料）
//   recipe.spice = 另需的香料 / 酱料（不参与匹配，只提示）；recipe.base = 默认家里有的常用调料

export const label = x => x.slice(2);

// 一道菜对着已勾选的食材：used 用到了哪些，miss 还差哪几组
export function check(r, sel) {
  const used = [], miss = [];
  for (const g of r.need) {
    const hit = g.find(x => x[0] === 'c' && sel.has(x.slice(2)));
    if (hit) used.push(hit.slice(2)); else miss.push(g);
  }
  return { used, miss };
}

// 现在就能做（主料全有）/ 再买一样就能做（只差一组，而且至少用到一样已有的）
export function match(recipes, sel) {
  const can = [], one = [];
  if (!sel.size) return { can, one };
  for (const r of recipes) {
    if (!r.need.length) continue;
    const { used, miss } = check(r, sel);
    if (!miss.length) can.push({ r, used });
    else if (miss.length === 1 && used.length) one.push({ r, used, miss: miss[0] });
  }
  // 用到的已有食材越多越靠前，其次简单的、有图的
  const by = (a, b) => b.used.length - a.used.length || (a.r.stars || 9) - (b.r.stars || 9) || (b.r.img || 0) - (a.r.img || 0) || a.r.name.localeCompare(b.r.name, 'zh');
  can.sort(by);
  // 差一样的：先按「买这一样能多做几道」排，同一样东西的挨在一起
  const cnt = {};
  for (const o of one) { const k = o.miss.map(label).join('/'); o.key = k; cnt[k] = (cnt[k] || 0) + 1; }
  one.sort((a, b) => cnt[b.key] - cnt[a.key] || a.key.localeCompare(b.key, 'zh') || by(a, b));
  return { can, one };
}

export const starText = n => ['', '很简单', '简单', '一般', '有点难', '难'][n] || '';

// 一周菜单：每天一荤（荤菜 / 水产）一素，不重样；优先差得少的（已勾选的食材能用上），再随机
export function weekPlan(recipes, sel, rnd = Math.random, days = 7) {
  // 水产、偏难的菜少排一点（一周三天鱼虾蟹不像家常菜单）
  const score = r => { const c = check(r, sel); return c.miss.length - c.used.length * 0.6 + rnd() * 2.2 + (r.cat === '水产' ? 0.9 : 0) + (r.stars >= 4 ? 0.5 : 0); };
  // 只排主料都是常见食材的菜（海参、鸡爪这类不在勾选列表里的不排），主料不超过 5 样
  const ok = (r, maxStars) => r.need.length && r.stars && r.stars <= maxStars && r.need.length <= 5 && r.steps.length >= 3 && r.need.every(g => g.some(x => x[0] === 'c'));
  const meat = recipes.filter(r => (r.cat === '荤菜' || r.cat === '水产') && ok(r, 4)).map(r => [score(r), r]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
  const veg = recipes.filter(r => r.cat === '素菜' && ok(r, 3)).map(r => [score(r), r]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
  const plan = [];
  // 同一种主料的荤菜别连着排（连吃三天排骨）
  const mainOf = r => (r.need[0] || [''])[0];
  const pool = meat.slice(); let last = '';
  for (let d = 0; d < days; d++) {
    let i = pool.findIndex(r => mainOf(r) !== last); if (i < 0) i = 0;
    const m = pool.splice(i, 1)[0]; last = m ? mainOf(m) : '';
    plan.push({ meat: m, veg: veg[d] });
  }
  return plan;
}

// 买菜清单：这几天的菜里，还没有的主料（同一样合并，记下是哪道菜要的）和另需的调料
export function shopping(plan, sel) {
  const buy = new Map(), spice = new Set();
  for (const d of plan) for (const r of [d.meat, d.veg]) {
    if (!r) continue;
    for (const g of check(r, sel).miss) { const k = g.map(label).join(' 或 '); if (!buy.has(k)) buy.set(k, []); buy.get(k).push(r.name); }
    r.spice.forEach(s => spice.add(s));
  }
  return { buy: [...buy].map(([name, dishes]) => ({ name, dishes })), spice: [...spice] };
}

// 步骤里写的时间 → 秒（「5-8 分钟」取小的那个；找不到返回 0）
export function stepSeconds(html) {
  const t = html.replace(/<[^>]+>/g, '');
  const m = t.match(/(\d+(?:\.\d+)?)\s*(?:[-~–到至]\s*\d+(?:\.\d+)?\s*)?(分钟|min|秒钟|秒|小时)/);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const s = m[2] === '小时' ? n * 3600 : /秒/.test(m[2]) ? n : n * 60;
  return s >= 10 && s <= 4 * 3600 ? Math.round(s) : 0;
}
