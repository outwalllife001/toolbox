// 发票合并打印：界面
import * as core from './core.js';

const $ = id => document.getElementById(id);
const DPR = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
const FREE_FILES = 10;          // 启用会员后：一次超过 10 张发票要会员；导出报销清单要会员
const Q = new URLSearchParams(location.search);
const HOLD = Q.has('hold');     // 录视频用：结果算好先不弹出，等 window.releaseResult()
const st = { files: [], per: 2, cut: true, busy: false, seq: 0, out: null, url: null, viewing: null };
const esc = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const base = n => n.replace(/\.[a-z0-9]{2,5}$/i, '');
const fmtSize = n => n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'MB' : Math.max(1, Math.round(n / 1e3)) + 'KB';
function setStatus(text, cls = '') { const s = $('status'); s.textContent = text; s.className = 'status ' + cls; }
function setBar(v) { $('bar').hidden = v == null; if (v != null) $('barIn').style.width = Math.round(v * 100) + '%'; }
const sheets = () => st.files.flatMap(f => f.pages.map(pg => ({ pg, file: f })));

// ---------- 添加文件 ----------
$('file').addEventListener('change', e => { const fs = [...e.target.files]; e.target.value = ''; addFiles(fs); });
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => { e.preventDefault(); addFiles([...(e.dataTransfer?.files || [])]); });
async function addFiles(list) {
  if (!list.length || st.busy) return;
  if (window.Member?.enabled && st.files.length + list.length > FREE_FILES && !(await Member.active())) {
    const r = await Member.gate({ title: `一次放 ${st.files.length + list.length} 张发票`, text: `免费版一次最多放 ${FREE_FILES} 张发票（打开 OFD、排版、算合计都不限次数，可以分几次打）；开通工具箱会员可以一次放更多。` });
    if (r !== 'member') list = list.slice(0, Math.max(0, FREE_FILES - st.files.length));
    if (!list.length) return;
  }
  st.busy = true;
  const bad = [];
  setLoading(`正在打开 ${list.length} 个文件…`);
  for (const f of list) {
    try {
      const fo = { id: ++st.seq, name: f.name, size: f.size };
      if (core.isOfd(f)) Object.assign(fo, await core.openOfd(new Uint8Array(await f.arrayBuffer())));
      else if (core.isPdf(f)) Object.assign(fo, await core.openPdf(new Uint8Array(await f.arrayBuffer()), reason => window.prompt(`${f.name}\n${reason === 2 ? '密码不对，请再输一次：' : '这个 PDF 有打开密码，请输入：'}`)));
      else if (core.isImage(f)) Object.assign(fo, await core.openImage(f));
      else { bad.push(f.name + (core.isXml(f) ? '（XML 数据文件没有版面，请选同一张发票的 OFD 或 PDF）' : '（不是 OFD / PDF / 图片）')); continue; }
      fo.info.amount0 = fo.info.amount;
      st.files.push(fo);
    } catch (err) {
      console.info('[invoice] 打不开', f.name, String(err && err.message || err));
      bad.push(f.name + (/password/i.test(err.name + err.message) ? '（没输入正确的密码）' : /HEI[FC]/i.test(f.name) ? '（这个浏览器打不开 HEIC，请截图后再传）' : '（文件损坏或格式不对）'));
    }
  }
  st.busy = false;
  render();
  setLoading('');
  $('warn').hidden = !bad.length;
  if (bad.length) $('warn').textContent = `有 ${bad.length} 个文件打不开：${bad.join('、')}`;
}
function setLoading(t) { $('main').classList.toggle('loading', !!t); $('main').dataset.loading = t; }

// 示例：3 张虚构的演示样张（2 张 OFD + 1 张 PDF）
const SAMPLES = [['sample1.ofd', '示例_餐费.ofd'], ['sample2.pdf', '示例_打车.pdf'], ['sample3.ofd', '示例_打印纸.ofd']];
$('sample').addEventListener('click', async () => {
  $('sample').disabled = true;
  try {
    const fs = await Promise.all(SAMPLES.map(async ([u, n]) => { const r = await fetch('sample/' + u); if (!r.ok) throw new Error(r.status); return new File([await r.blob()], n); }));
    await addFiles(fs);
  } catch (e) { console.error(e); $('warn').hidden = false; $('warn').textContent = '示例没下载下来，请检查网络后再试'; }
  $('sample').disabled = false;
});

// ---------- 列表 ----------
const list = $('list');
function dupSet() {
  const seen = new Map(), dup = new Set();
  for (const f of st.files) { const k = f.info.no; if (!k) continue; if (seen.has(k)) { dup.add(seen.get(k)); dup.add(f.id); } else seen.set(k, f.id); }
  return dup;
}
function render() {
  const has = st.files.length > 0;
  $('empty').hidden = has; $('listWrap').hidden = !has; $('opts').hidden = !has;
  if (!has) { list.innerHTML = ''; return; }
  const dup = dupSet();
  const keep = new Set(st.files.map(f => f.id));
  for (const el of [...list.children]) if (!keep.has(+el.dataset.id)) el.remove();
  st.files.forEach((f, i) => {
    if (!f.el) {
      const el = f.el = document.createElement('div');
      el.className = 'it in'; el.dataset.id = f.id;
      el.innerHTML = `<button class="th" aria-label="放大看"></button>
        <div class="bd"><b class="nm"></b><span class="mt"></span>
          <label class="amt"><i>¥</i><input inputmode="decimal" autocomplete="off" placeholder="填金额" aria-label="金额"></label></div>
        <button class="del" aria-label="删除">✕</button>`;
      el.querySelector('.th').addEventListener('click', () => openView(f));
      el.querySelector('.del').addEventListener('click', () => removeFile(f));
      const inp = el.querySelector('input');
      inp.addEventListener('input', () => { const v = core.money(inp.value); f.info.amount = v; f.info.sure = v != null; f.info.edited = true; el.classList.toggle('unsure', false); renderSum(); });
      inp.addEventListener('blur', () => { if (f.info.amount != null) inp.value = f.info.amount.toFixed(2); });
      drawThumb(f, el.querySelector('.th'));
    }
    const el = f.el, I = f.info;
    el.querySelector('.nm').textContent = I.seller || base(f.name);
    const kind = f.kind === 'ofd' ? 'OFD' : f.kind === 'pdf' ? 'PDF' : '图片';
    el.querySelector('.mt').innerHTML = `<em class="k ${f.kind}">${kind}</em>${I.date ? esc(I.date.slice(5).replace('-', '月') + '日') + ' · ' : ''}${I.no ? '尾号 ' + esc(I.no.slice(-4)) : esc(f.pages.length > 1 ? f.pages.length + ' 页' : I.seller ? '' : '没认出发票信息')}${f.pages.length > 1 && I.no ? ' · ' + f.pages.length + ' 页' : ''}${dup.has(f.id) ? '<em class="dup">重复</em>' : ''}`;
    const inp = el.querySelector('input');
    if (document.activeElement !== inp) inp.value = I.amount != null ? I.amount.toFixed(2) : '';
    el.classList.toggle('unsure', I.amount != null && !I.sure);
    el.classList.toggle('noamt', I.amount == null);
    if (list.children[i] !== el) list.insertBefore(el, list.children[i] || null);
  });
  renderSum();
}
function renderSum() {
  const n = st.files.length, total = core.sum(st.files);
  const miss = st.files.filter(f => f.info.amount == null).length, unsure = st.files.filter(f => f.info.amount != null && !f.info.sure).length;
  const dup = dupSet().size;
  $('sum').innerHTML = `<span>共 <b>${n}</b> 张</span><span class="tt">合计 <b>¥${core.fmtMoney(total)}</b></span>`
    + (miss || unsure || dup ? `<small>${[miss ? `${miss} 张没认出金额，请手填` : '', unsure ? `${unsure} 张请核对金额` : '', dup ? `有重复的发票` : ''].filter(Boolean).join(' · ')}</small>` : '');
  const sh = sheets(), pages = core.layout(sh.map(s => s.pg), st.per);
  $('plan').textContent = `${sh.length} 张${sh.length > n ? `（${n} 个文件）` : ''} → 排成 ${pages.length} 页 A4` + (st.per > 1 && pages.length < sh.length ? `，省 ${sh.length - pages.length} 张纸` : '');
  window.__inv.plan = { sheets: sh.length, pages: pages.length };
}
async function drawThumb(f, box) {
  const pg = f.pages[0];
  try {
    if (pg.kind === 'ofd') { const im = new Image(); im.alt = ''; im.src = pg.url; await im.decode().catch(() => {}); box.appendChild(im); }
    else {
      const cv = document.createElement('canvas');
      if (pg.kind === 'pdf') await core.renderPdfPage(pg, cv, Math.round(132 * DPR));
      else { const k = 132 * DPR / pg.bmp.width; cv.width = Math.round(pg.bmp.width * k); cv.height = Math.round(pg.bmp.height * k); const g = cv.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(pg.bmp, 0, 0, cv.width, cv.height); }
      box.appendChild(cv);
    }
    box.classList.toggle('tall', pg.hmm > pg.wmm * 1.15);
  } catch (e) { console.error(e); }
  f.ready = true;
}
function removeFile(f) {
  if (st.busy) return;
  st.files = st.files.filter(x => x !== f);
  for (const pg of f.pages) { if (pg.url) URL.revokeObjectURL(pg.url); pg.bmp?.close?.(); }
  if (f.doc) core.closePdf(f.doc);
  f.el?.classList.add('out');
  setTimeout(render, 220);
}
$('sortBtn').addEventListener('click', () => {
  st.files.sort((a, b) => (a.info.date || '9999').localeCompare(b.info.date || '9999') || a.id - b.id);
  render();
});

// ---------- 选项 ----------
$('pers').addEventListener('click', e => {
  const b = e.target.closest('.chip'); if (!b) return;
  st.per = +b.dataset.p;
  for (const c of $('pers').children) c.classList.toggle('on', c === b);
  renderSum();
});
$('cut').addEventListener('change', e => { st.cut = e.target.checked; });

// ---------- 放大看 ----------
async function openView(f) {
  st.viewing = f;
  $('viewTitle').textContent = (f.info.seller || base(f.name)) + (f.info.amount != null ? ` · ¥${core.fmtMoney(f.info.amount)}` : '');
  const box = $('viewBox'); box.innerHTML = ''; box.classList.remove('zoom');
  for (const pg of f.pages.slice(0, 20)) {
    let el;
    if (pg.kind === 'ofd') { el = new Image(); el.src = pg.url; }
    else if (pg.kind === 'pdf') { el = document.createElement('canvas'); await core.renderPdfPage(pg, el, 1600); }
    else { el = document.createElement('canvas'); el.width = pg.bmp.width; el.height = pg.bmp.height; el.getContext('2d').drawImage(pg.bmp, 0, 0); }
    box.appendChild(el);
  }
  $('viewSave').hidden = f.kind === 'pdf';
  $('viewSave').textContent = '单独存成 PDF';
  $('viewSheet').hidden = false; document.body.classList.add('lock');
}
$('viewBox').addEventListener('click', () => $('viewBox').classList.toggle('zoom'));
$('viewClose').addEventListener('click', () => { $('viewSheet').hidden = true; document.body.classList.remove('lock'); });
$('viewSave').addEventListener('click', async () => {
  const f = st.viewing; if (!f || st.busy) return;
  st.busy = true; $('viewSave').textContent = '正在生成…';
  try {
    const bytes = await core.exportOriginal(f);
    download(new Blob([bytes], { type: 'application/pdf' }), base(f.name) + '.pdf');
    window.__inv.single = { size: bytes.length, name: base(f.name) + '.pdf' };
    $('viewSave').textContent = '✓ 已保存';
  } catch (e) { console.error(e); $('viewSave').textContent = '没存成：' + e.message; }
  st.busy = false;
});
function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

// ---------- 生成 PDF ----------
$('go').addEventListener('click', run);
async function run() {
  if (st.busy || !st.files.length) return;
  st.busy = true; $('go').disabled = true;
  const t0 = performance.now();
  try {
    setStatus('正在排版…'); setBar(0.05);
    const sh = sheets();
    const r = await core.exportPdf(sh, { per: st.per, cut: st.cut }, k => setBar(0.05 + 0.9 * k));
    setBar(1);
    await showResult(r, sh.length, performance.now() - t0);
    setStatus('');
  } catch (err) {
    console.error(err);
    setStatus((/memory|内存|allocation/i.test(err.message) ? '手机内存不够：少放几张，分两次打。' : '没做成：') + err.message, 'err');
  } finally { st.busy = false; $('go').disabled = false; setBar(null); }
}
async function showResult(r, count, ms) {
  const blob = new Blob([r.bytes], { type: 'application/pdf' });
  if (st.url) URL.revokeObjectURL(st.url);
  st.url = URL.createObjectURL(blob); st.out = r.bytes;
  const total = core.sum(st.files);
  const name = `发票${count}张_合计${total.toFixed(2)}元.pdf`;
  const a = $('dlPdf'); a.href = st.url; a.download = name;
  $('outTitle').textContent = '✓ 排好了';
  $('outSizes').innerHTML = `<s>${count} 张</s><span class="arr">→</span><b>${r.pages} 页 A4</b>`;
  $('outMeta').textContent = `合计 ¥${core.fmtMoney(total)} · ${fmtSize(r.bytes.length)} · ${name}`;
  const box = $('outPrevBox'); box.innerHTML = '';
  const cssW = Math.min(480, innerWidth) - 28, n = Math.min(r.pages, 6);
  for (let i = 1; i <= n; i++) {
    const cv = document.createElement('canvas'); box.appendChild(cv);
    await core.previewPdf(r.bytes, i, cv, Math.round(cssW * Math.min(DPR, 2))).catch(console.error);
  }
  window.__inv.result = { size: r.bytes.length, pages: r.pages, count, total, name, ms: Math.round(ms), per: st.per };
  if (HOLD) await new Promise(res => { window.releaseResult = res; window.__inv.held = true; });
  $('outSheet').hidden = false; document.body.classList.add('lock'); box.scrollTop = 0;
}
$('outClose').addEventListener('click', () => { $('outSheet').hidden = true; document.body.classList.remove('lock'); });
$('printBtn').addEventListener('click', () => {
  if (!st.url) return;
  // 电脑：隐藏的 iframe 里直接调打印；手机浏览器不支持，就新开一页，用系统的「打印 / 分享」
  const fr = document.createElement('iframe');
  fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  fr.src = st.url;
  fr.onload = () => { try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch (e) { window.open(st.url, '_blank'); } };
  document.body.appendChild(fr);
  setTimeout(() => fr.remove(), 120000);
});

// ---------- 报销清单 ----------
$('csv').addEventListener('click', async () => {
  if (!st.files.length) return;
  if (window.Member?.enabled && !(await Member.active())) {
    const r = await Member.gate({ title: '导出报销清单', text: '把每张发票的号码、日期、销售方、金额和合计导出成表格（Excel、WPS 都能打开）是会员功能；页面上的合计、排版打印一直免费。' });
    if (r !== 'member') return;
  }
  const csv = core.toCsv(st.files);
  download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `报销清单_${st.files.length}张_${core.sum(st.files).toFixed(2)}元.csv`);
  window.__inv.csv = csv;
});

// 代做入口：site/config.js 里配置了才显示；service.tools.invoice 可以单独设置这一页的价格和说明
const svc = window.SITE_CONFIG && window.SITE_CONFIG.service;
if (svc) {
  const s = Object.assign({}, svc, svc.tools && svc.tools.invoice);
  $('service').innerHTML = `<h2>找我代做 <b>${esc(s.price)}</b></h2><p>${esc(s.text)}</p><p class="contact">${esc(s.contact)}</p>${s.qr ? `<img src="../${esc(s.qr)}" alt="联系方式二维码">` : ''}`;
  $('service').hidden = false;
}

window.__inv = { st, core, addFiles, run, render, plan: null, result: null };
