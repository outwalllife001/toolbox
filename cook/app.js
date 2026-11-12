// 今天吃什么：勾食材 → 现在能做哪些菜 / 再买一样还能做哪些 → 帮我选一道 → 菜谱（用量、步骤、计时）→ 一周菜单
// 菜谱数据来自 HowToCook（Unlicense），见 data.json；匹配逻辑在 core.js
// 网页参数（录视频、测试用）：?pick=菜名 「帮我选一道」固定选中这道（它必须在候选里，否则照常随机）
import { check, match, label, starText, weekPlan, shopping, stepSeconds } from './core.js';

const $ = id => document.getElementById(id);
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const P = new URLSearchParams(location.search);
const KEY = 'toolbox-cook-have';
const FREE_DAYS = 3;                       // 一周菜单：免费看前 3 天，7 天要会员（没启用会员时 7 天都免费）
const PAGE = 8;                            // 列表先显示几道

const st = { data: null, byName: new Map(), emoji: {}, sel: new Set(), tab: '常用', cat: '全部', res: { can: [], one: [] }, showCan: PAGE, showOne: 6, plan: null, planDays: 0, cur: null, from: '' };
window.__cook = st;

function load() { try { return new Set(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch { return new Set(); } }
function save() { try { localStorage.setItem(KEY, JSON.stringify([...st.sel])); } catch {} }

// ---------- 食材 ----------
function renderTabs() {
  const names = ['常用', ...st.data.groups.map(g => g.name)];
  const inTab = n => n === '常用' ? st.data.common : st.data.groups.find(g => g.name === n).items.map(i => i.n);
  $('tabs').innerHTML = names.map(n => {
    const k = n === '常用' ? 0 : inTab(n).filter(x => st.sel.has(x)).length;
    return `<button class="tab${n === st.tab ? ' on' : ''}" data-t="${esc(n)}">${esc(n)}${k ? `<i>${k}</i>` : ''}</button>`;
  }).join('');
  $('ings').innerHTML = inTab(st.tab).map(n => `<button class="ing${st.sel.has(n) ? ' on' : ''}" data-n="${esc(n)}"><span>${st.emoji[n] || '🍽️'}</span><b>${esc(n)}</b></button>`).join('');
  $('clear').hidden = !st.sel.size;
}
$('tabs').addEventListener('click', e => { const b = e.target.closest('.tab'); if (!b) return; st.tab = b.dataset.t; renderTabs(); });
$('ings').addEventListener('click', e => {
  const b = e.target.closest('.ing'); if (!b) return;
  const n = b.dataset.n;
  st.sel.has(n) ? st.sel.delete(n) : st.sel.add(n);
  save(); st.showCan = PAGE; st.showOne = 6; st.cat = '全部';
  renderTabs(); update(true);
});
$('clear').addEventListener('click', () => { st.sel.clear(); save(); st.cat = '全部'; renderTabs(); update(); });

// ---------- 结果 ----------
const emo = r => { const a = r.need.map(g => g.find(x => x[0] === 'c')).filter(Boolean).map(x => st.emoji[x.slice(2)]).filter(Boolean); return [...new Set(a)].slice(0, 2).join('') || '🍽️'; };
const pic = r => r.img ? `<img src="img/${r.id}_s.jpg" alt="" loading="lazy">` : emo(r);
const stars = n => n ? `<i>${'★'.repeat(n)}</i> ${starText(n)}` : '';
function dishHTML(r, o = {}) {
  const sub = [stars(r.stars), r.cat, o.used?.length ? '用到 ' + o.used.map(n => st.emoji[n] || n).join('') : ''].filter(Boolean).join(' · ');
  const ex = (o.miss ? `<span class="need1">还差 ${esc(o.miss.map(label).join(' / '))}</span>` : '') + (r.spice.length ? `另需 ${esc(r.spice.slice(0, 4).join('、'))}${r.spice.length > 4 ? ' 等' : ''}` : '');
  return `<button class="dish" data-id="${r.id}"><span class="pic">${pic(r)}</span><span class="txt"><span class="nm"><span>${esc(r.name)}</span></span><span class="sub">${sub}</span>${ex ? `<span class="ex">${ex}</span>` : ''}</span><span class="go">›</span></button>`;
}
function update(pop) {
  const R = st.data.recipes;
  st.res = match(R, st.sel);
  const has = st.sel.size > 0;
  $('sumLabel').textContent = has ? '现在就能做' : '一共收了';
  const n = has ? st.res.can.length : R.length;
  $('sumN').textContent = n;
  if (pop) { $('sumN').classList.remove('pop'); void $('sumN').offsetWidth; $('sumN').classList.add('pop'); }
  // 分类筛选
  const base = has ? st.res.can.map(x => x.r) : R;
  const cats = ['全部', ...new Set(base.map(r => r.cat))];
  if (!cats.includes(st.cat)) st.cat = '全部';
  $('cats').innerHTML = cats.length > 2 ? cats.map(c => `<button class="chip${c === st.cat ? ' on' : ''}" data-c="${c}">${c}${c === '全部' ? '' : ' ' + base.filter(r => r.cat === c).length}</button>`).join('') : '';
  $('cats').hidden = cats.length <= 2;
  const inCat = r => st.cat === '全部' || r.cat === st.cat;
  if (has) {
    const can = st.res.can.filter(x => inCat(x.r));
    $('list').innerHTML = can.length ? can.slice(0, st.showCan).map(x => dishHTML(x.r, x)).join('') : `<p class="empty">${st.res.one.length ? '这几样还凑不出一道完整的菜，看看下面「再买一样」的' : '这几样还凑不出菜，再多点几样家里有的'}</p>`;
    more('moreCan', can.length, st.showCan);
    const one = st.res.one.filter(x => inCat(x.r));
    $('oneBox').hidden = !one.length;
    $('oneN').textContent = one.length;
    $('oneList').innerHTML = one.slice(0, st.showOne).map(x => dishHTML(x.r, x)).join('');
    more('moreOne', one.length, st.showOne);
  } else {
    // 没勾食材：先给几道新手也能做的
    const easy = R.filter(r => inCat(r) && (st.cat !== '全部' || (r.stars <= 2 && r.img && ['荤菜', '素菜', '主食', '汤粥'].includes(r.cat))));
    $('list').innerHTML = easy.slice(0, st.showCan).map(r => dishHTML(r)).join('');
    more('moreCan', easy.length, st.showCan);
    $('oneBox').hidden = true;
  }
  $('dice').textContent = has && st.res.can.length ? '🎲 帮我选一道' : '🎲 随便来一道';
}
function more(id, total, shown) { $(id).hidden = total <= shown; $(id).textContent = `展开剩下的 ${total - shown} 道`; }
$('moreCan').addEventListener('click', () => { st.showCan = 999; update(); });
$('moreOne').addEventListener('click', () => { st.showOne = 999; update(); });
$('cats').addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return; st.cat = b.dataset.c; st.showCan = PAGE; st.showOne = 6; update(); });
document.addEventListener('click', e => { const b = e.target.closest('.dish'); if (b) openRecipe(st.data.recipes.find(r => r.id === b.dataset.id), 'list'); });

// ---------- 搜菜名 ----------
$('q').addEventListener('input', () => {
  const q = $('q').value.trim();
  if (!q) { $('qList').innerHTML = ''; return; }
  const hit = st.data.recipes.filter(r => r.name.includes(q)).slice(0, 12);
  $('qList').innerHTML = hit.length ? hit.map(r => { const c = check(r, st.sel); return dishHTML(r, { used: c.used }); }).join('') : '<p class="empty">没搜到，换个说法试试（比如「番茄」换成「西红柿」）</p>';
});

// ---------- 帮我选一道 ----------
let slotTimer = 0, slotPickR = null;
function candidates() {
  const inCat = r => st.cat === '全部' || r.cat === st.cat;
  let c = st.res.can.map(x => x.r).filter(inCat);
  if (!c.length) c = st.data.recipes.filter(r => inCat(r) && ['荤菜', '素菜', '主食', '汤粥', '水产'].includes(r.cat) && r.stars && r.stars <= 3);
  if (!c.length) c = st.data.recipes.filter(inCat);
  // 用到两样以上已有食材的菜优先（只剩「水煮蛋」这类一样食材的菜时才从它们里挑）
  const rich = st.res.can.filter(x => x.used.length >= 2 && inCat(x.r)).map(x => x.r);
  return { all: c, prefer: rich.length >= 2 ? rich : c };
}
function spin(prev) {
  const { all, prefer } = candidates();
  let pool = prefer.filter(r => r !== prev); if (!pool.length) pool = all.filter(r => r !== prev); if (!pool.length) pool = all;
  const forced = P.get('pick') && !prev ? all.find(r => r.name === P.get('pick')) : null;
  const target = forced || pool[Math.floor(Math.random() * pool.length)];
  slotPickR = target;
  $('slot').hidden = false; $('slotOpen').hidden = true; $('slotBtns').hidden = true;
  $('slotTop').textContent = st.sel.size && st.res.can.length ? `从能做的 ${all.length} 道里挑…` : '随便挑一道…';
  $('slotName').classList.remove('hit'); $('slotMeta').textContent = '';
  const show = r => { $('slotPic').innerHTML = r.img ? `<img src="img/${r.id}_s.jpg" alt="">` : emo(r); $('slotName').textContent = r.name; };
  let i = 0; const T = 12;                           // 先快后慢闪 12 下，约 1.4 秒
  clearTimeout(slotTimer);
  const tick = () => {
    if (i >= T) {
      show(target); $('slotName').classList.add('hit');
      $('slotTop').textContent = '今天就吃';
      $('slotMeta').innerHTML = [target.stars ? '★'.repeat(target.stars) + ' ' + starText(target.stars) : '', target.cat, target.kcal ? `约 ${target.kcal} 大卡` : ''].filter(Boolean).join(' · ');
      $('slotOpen').hidden = false; $('slotBtns').hidden = false;
      window.dispatchEvent(new CustomEvent('cook-picked', { detail: target.name }));
      return;
    }
    show(all[(Math.floor(Math.random() * all.length) + i) % all.length]);
    i++; slotTimer = setTimeout(tick, 50 + i * i * 1.2);
  };
  tick();
}
$('dice').addEventListener('click', () => spin(null));
$('slotAgain').addEventListener('click', () => spin(slotPickR));
$('slotClose').addEventListener('click', () => { $('slot').hidden = true; });
$('slot').addEventListener('click', e => { if (e.target === $('slot') && !$('slotBtns').hidden) $('slot').hidden = true; });
$('slotOpen').addEventListener('click', () => { $('slot').hidden = true; openRecipe(slotPickR, 'dice'); });

// ---------- 菜谱 ----------
const blk = arr => arr.map(([k, t]) => k === 'h' ? `<h5>${t}</h5>` : k === 's' ? `<div class="s">${t}</div>` : k === 'n' ? `<div class="n">${t}</div>` : `<p>${t}</p>`).join('');
function openRecipe(r, from) {
  if (!r) return;
  st.cur = r; st.from = from;
  const c = check(r, st.sel);
  const have = r.need.map(g => {
    const hit = g.find(x => x[0] === 'c' && st.sel.has(x.slice(2)));
    const name = g.map(label).join(' 或 ');
    return st.sel.size ? `<span class="${hit ? 'y' : 'n'}">${hit ? '✓' : '还差'} ${esc(name)}</span>` : `<span>${esc(name)}</span>`;
  }).join('');
  const steps = r.steps.map(([k, t]) => {
    if (k === 's') { const sec = stepSeconds(t); return `<div class="s">${t}${sec ? `<button class="tm" data-s="${sec}">⏱ ${fmtDur(sec)}</button>` : ''}</div>`; }
    return k === 'n' ? `<div class="n">${t}</div>` : k === 'h' ? `<h5>${t}</h5>` : `<p>${t}</p>`;
  }).join('');
  $('sheetTitle').textContent = r.name;
  $('recipe').innerHTML = `
    <div class="hero">${r.img ? `<img src="img/${r.id}.jpg" alt="${esc(r.name)}">` : `<div class="emo">${emo(r)}</div>`}</div>
    <div class="r-title">${esc(r.name)}</div>
    <div class="r-meta">${r.stars ? `<span class="st">${'★'.repeat(r.stars)} ${starText(r.stars)}</span>` : ''}<span>${r.cat}</span>${r.kcal ? `<span>约 ${r.kcal} 大卡 / 份</span>` : ''}${st.sel.size ? `<span>${c.miss.length ? '还差 ' + c.miss.length + ' 样主料' : '主料齐了 ✓'}</span>` : ''}</div>
    ${r.intro ? `<p class="r-intro">${r.intro}</p>` : ''}
    <div class="sec" id="secNeed"><h4>要准备的</h4>
      <p class="k">主料</p><div class="have">${have || '<span>见下面原文</span>'}</div>
      ${r.spice.length ? `<p class="k">另需调料（不一定家家都有）</p><div class="have">${r.spice.map(s => `<span class="s">${esc(s)}</span>`).join('')}</div>` : ''}
      ${r.base.length ? `<p class="k">常用调料</p><p class="txt">${esc(r.base.join('、'))}</p>` : ''}
      ${r.tools.length ? `<p class="k">工具</p><p class="txt">${esc(r.tools.join('、'))}</p>` : ''}
      <details class="raw"><summary>原菜谱写的「必备原料和工具」</summary><ul>${r.raw.map(x => `<li>${esc(x)}</li>`).join('')}</ul></details>
    </div>
    ${r.calc.length ? `<div class="sec" id="secCalc"><h4>用量</h4><div class="blk">${blk(r.calc)}</div></div>` : ''}
    <div class="sec" id="secSteps"><h4>步骤 <small style="font-weight:400;color:#667085;font-size:12px">做完一步点一下</small></h4><div class="steps">${steps}</div></div>
    ${r.extra.length ? `<div class="sec"><h4>补充</h4><div class="blk">${blk(r.extra)}</div></div>` : ''}
    <p class="r-src">做法原文：<a href="https://github.com/Anduin2017/HowToCook/blob/master/${r.src.split('/').map(encodeURIComponent).join('/')}" target="_blank" rel="noopener">HowToCook / ${esc(r.src.split('/').pop())}</a>（Unlicense）</p>`;
  $('sheet').hidden = false; document.body.classList.add('lock');
  $('recipe').scrollTop = 0;
  $('awake').hidden = !('wakeLock' in navigator);
  if (history.state?.cook !== r.id) history.pushState({ cook: r.id }, '', '#' + encodeURIComponent(r.name));
}
function closeRecipe() { $('sheet').hidden = true; document.body.classList.remove('lock'); st.cur = null; releaseWake(); }
$('back').addEventListener('click', () => history.state?.cook ? history.back() : (closeRecipe(), history.replaceState(null, '', location.pathname + location.search)));
window.addEventListener('popstate', () => { if (!$('sheet').hidden) closeRecipe(); else fromHash(); });
$('recipe').addEventListener('click', e => {
  const t = e.target.closest('.tm');
  if (t) { e.stopPropagation(); startTimer(+t.dataset.s); return; }
  const s = e.target.closest('.steps .s'); if (s) s.classList.toggle('done');
});
function fromHash() { const n = decodeURIComponent(location.hash.slice(1)); const r = n && st.byName.get(n); if (r) openRecipe(r, 'link'); }

// 屏幕常亮
let wake = null, wantWake = false;
async function acquireWake() { try { wake = await navigator.wakeLock.request('screen'); $('awake').classList.add('on'); $('awake').textContent = '常亮中 ✓'; } catch { wantWake = false; $('awake').textContent = '这个浏览器不支持'; } }
function releaseWake() { wantWake = false; wake?.release?.().catch(() => {}); wake = null; $('awake').classList.remove('on'); $('awake').textContent = '屏幕常亮'; }
$('awake').addEventListener('click', () => { if (wantWake) releaseWake(); else { wantWake = true; acquireWake(); } });
document.addEventListener('visibilitychange', () => { if (wantWake && document.visibilityState === 'visible') acquireWake(); });

// 计时
const fmtDur = s => s >= 3600 ? `${+(s / 3600).toFixed(1)} 小时` : s >= 60 ? `${+(s / 60).toFixed(1)} 分钟` : `${s} 秒`;
const mmss = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
let tmEnd = 0, tmInt = 0;
function startTimer(sec) {
  tmEnd = Date.now() + sec * 1000; clearInterval(tmInt);
  $('timer').hidden = false; $('timer').classList.remove('end');
  const tick = () => {
    const left = Math.max(0, Math.round((tmEnd - Date.now()) / 1000));
    $('timerT').textContent = left ? '⏱ ' + mmss(left) : '⏰ 时间到';
    if (!left) { clearInterval(tmInt); $('timer').classList.add('end'); beep(); navigator.vibrate?.([300, 150, 300]); }
  };
  tick(); tmInt = setInterval(tick, 250);
}
$('timerX').addEventListener('click', () => { clearInterval(tmInt); $('timer').hidden = true; });
function beep() {
  try {
    const A = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.25, 0.5].forEach(t => { const o = A.createOscillator(), g = A.createGain(); o.frequency.value = 880; g.gain.setValueAtTime(0.25, A.currentTime + t); g.gain.exponentialRampToValueAtTime(0.001, A.currentTime + t + 0.2); o.connect(g).connect(A.destination); o.start(A.currentTime + t); o.stop(A.currentTime + t + 0.22); });
  } catch {}
}

// ---------- 一周菜单 ----------
const WD = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
async function makeWeek(askMember) {
  let days = 7;
  if (window.Member?.enabled && !(await Member.active())) {
    days = FREE_DAYS;
    if (askMember) {
      const r = await Member.gate({ title: '排满 7 天的菜单', text: `免费版排 ${FREE_DAYS} 天的菜单和买菜清单；开通工具箱会员可以一次排满一周 7 天。`, free: `先排 ${FREE_DAYS} 天` });
      if (!r) return;
      if (r === 'member') days = 7;
    }
  }
  st.plan = weekPlan(st.data.recipes, st.sel, Math.random, 7); st.planDays = days;
  renderWeek();
}
function renderWeek() {
  const days = st.planDays, plan = st.plan.slice(0, days);
  const b = (r, k) => r ? `<button data-id="${r.id}"><small>${k}</small>${esc(r.name)}</button>` : '';
  $('days').innerHTML = plan.map((d, i) => `<div class="day"><b>${WD[i]}</b><div class="ds">${b(d.meat, '荤')}${b(d.veg, '素')}</div></div>`).join('')
    + (days < 7 ? `<div class="day locked" id="weekLock">🔒 周四到周日 · 会员一次排满 7 天</div>` : '');
  const s = shopping(plan, st.sel);
  $('shop').innerHTML = `<b>🛒 买菜清单（${s.buy.length} 样${st.sel.size ? '，已去掉你勾选的' : ''}）</b>${s.buy.map(x => esc(x.name)).join('、') || '都有了，不用买'}${s.spice.length ? `<p>调料看看家里有没有：${esc(s.spice.join('、'))}</p>` : ''}`;
  $('weekOut').hidden = false; $('weekGo').hidden = true; $('weekStatus').textContent = '';
}
$('weekGo').addEventListener('click', () => makeWeek(true));
$('weekAgain').addEventListener('click', () => makeWeek(false));
$('days').addEventListener('click', e => {
  if (e.target.closest('#weekLock')) { makeWeek(true); return; }
  const b = e.target.closest('button[data-id]'); if (b) openRecipe(st.data.recipes.find(r => r.id === b.dataset.id), 'week');
});
$('weekCopy').addEventListener('click', async () => {
  const plan = st.plan.slice(0, st.planDays), s = shopping(plan, st.sel);
  const text = ['【一周菜单】', ...plan.map((d, i) => `${WD[i]}：${[d.meat?.name, d.veg?.name].filter(Boolean).join(' + ')}`), '', '【买菜清单】', s.buy.map(x => x.name).join('、') || '都有了', s.spice.length ? '调料：' + s.spice.join('、') : ''].filter(x => x !== '').join('\n');
  try { await navigator.clipboard.writeText(text); $('weekStatus').textContent = '已复制，去微信里粘贴发给家人'; }
  catch { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); $('weekStatus').textContent = ok ? '已复制，去微信里粘贴发给家人' : '复制失败，长按上面的文字手动复制'; }
});

// ---------- 启动 ----------
const svc = window.SITE_CONFIG && window.SITE_CONFIG.service;
if (svc) {
  const s = { ...svc, ...(svc.tools && svc.tools.cook) };
  $('service').innerHTML = `<h2>找我代做 <b>${esc(s.price)}</b></h2><p>${esc(s.text)}</p><p class="contact">${esc(s.contact)}</p>${s.qr ? `<img src="../${esc(s.qr)}" alt="联系方式二维码">` : ''}`;
  $('service').hidden = false;
}
fetch('data.json').then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }).then(d => {
  st.data = d;
  for (const g of d.groups) for (const i of g.items) st.emoji[i.n] = i.e;
  for (const r of d.recipes) st.byName.set(r.name, r);
  const all = new Set(d.groups.flatMap(g => g.items.map(i => i.n)));
  st.sel = new Set([...load()].filter(n => all.has(n)));
  $('tagCount').textContent = `${d.recipes.length} 道家常菜`;
  $('faqN').textContent = d.recipes.length + ' ';
  $('srcVer').textContent = `数据取自 ${d.source.date} 的版本（${d.source.commit}）`;
  $('result').hidden = false; $('searchCard').hidden = false; $('week').hidden = false;
  renderTabs(); update();
  fromHash();
  window.__cookReady = true;
}).catch(e => { $('ings').innerHTML = `<p class="hint">菜谱没加载出来（${esc(e.message)}），刷新一下试试</p>`; });
