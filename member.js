// 工具箱会员（会员码）。site/config.js 里配置了 member 才启用；没配置时所有功能都免费，页面上不出现任何会员入口
//   <script src="../config.js"></script><script src="../member.js"></script>
//   Member.enabled                         是否启用了会员
//   await Member.active()                  这个浏览器是否已经激活了会员码
//   await Member.gate({ title, text, free })  需要会员的地方调用：没启用 / 已是会员 → 'member'；选了免费的做法 → 'free'；关掉 → null
//   Member.open()                          打开会员弹窗（购买 / 输入会员码）
// 会员码形如 K7QX-2M9D-HT4W：12 位 Crockford 32 进制（不含 I L O U），60 位随机数，tools/member_codes.py 生成。
// 网页里只放会员码 SHA-256 的前 16 位十六进制（member/codes.json），原码在私有仓库里，上传到收款平台自动发货；
// 某个码外泄了，从 codes.json 删掉它的哈希（tools/member_codes.py --revoke）再发布网站即可作废
window.Member = (() => {
  const cfg = (window.SITE_CONFIG || {}).member || null;
  const ROOT = new URL('.', document.currentScript ? document.currentScript.src : location.href).href;
  const KEY = 'toolbox-member-code';
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // 用户手输时常见的混淆：O→0、I/L→1，去掉空格和横线
  const norm = s => String(s || '').toUpperCase().replace(/[O]/g, '0').replace(/[IL]/g, '1').replace(/[^0-9A-Z]/g, '');
  let list = null;
  const hashes = () => (list ||= fetch(ROOT + 'member/codes.json', { cache: 'no-cache' }).then(r => r.json()).then(j => new Set(j.h)).catch(() => { list = null; return null; }));
  async function sha16(s) {
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
    return [...d.slice(0, 8)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  async function check(code) {
    const c = norm(code);
    if (c.length !== 12) return false;
    if (!(window.crypto && crypto.subtle)) throw new Error('请用 https 网址打开再激活');
    const set = await hashes();
    if (!set) throw new Error('网络不好，没能核对会员码，稍后再试');
    return set.has(await sha16(c));
  }
  let cached = null;
  async function active() {
    if (!cfg) return false;
    if (cached !== null) return cached;
    const c = localStorage.getItem(KEY);
    if (!c) return (cached = false);
    try { cached = await check(c); } catch { cached = true; }   // 没网时不把已激活的会员踢掉
    return cached;
  }
  const fmt = c => norm(c).replace(/(.{4})(?=.)/g, '$1-');

  // ---------- 弹窗 ----------
  let dlg = null;
  function css() {
    if (document.getElementById('mb-css')) return;
    const s = document.createElement('style'); s.id = 'mb-css';
    s.textContent = `
.mb-mask{position:fixed;inset:0;z-index:100;background:rgba(10,14,24,.55);display:flex;align-items:flex-end;justify-content:center}
@media(min-width:560px){.mb-mask{align-items:center}}
.mb-box{width:100%;max-width:440px;background:#fff;color:#141a26;border-radius:20px 20px 0 0;padding:18px 18px 22px;font:15px/1.5 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;max-height:92vh;overflow:auto}
@media(min-width:560px){.mb-box{border-radius:20px}}
.mb-x{float:right;border:0;background:#f0f2f6;border-radius:50%;width:30px;height:30px;font-size:16px;cursor:pointer;color:#667085}
.mb-box h3{margin:2px 0 4px;font-size:18px}
.mb-box .mb-why{margin:0 0 12px;color:#475467;font-size:14px}
.mb-card{background:linear-gradient(135deg,#fff6db,#ffe9b8);border-radius:16px;padding:14px}
.mb-price{font-size:15px;font-weight:700;color:#8a6100}.mb-price b{font-size:26px;color:#d9480f;margin:0 2px}.mb-price s{color:#a08a5a;font-weight:400;margin-left:6px;font-size:13px}
.mb-card ul{margin:8px 0 0;padding-left:18px;font-size:14px;color:#5c4400}
.mb-btn{display:block;width:100%;margin-top:12px;border:0;border-radius:14px;padding:13px;font:inherit;font-size:16px;font-weight:700;text-align:center;text-decoration:none;cursor:pointer;color:#fff;background:#2f6bff}
.mb-buy{background:#d9480f}
.mb-ghost{color:#2f6bff;background:#e8efff}
.mb-code{display:flex;gap:8px;margin-top:14px}
.mb-code input{flex:1;min-width:0;border:1.5px solid #e4e8f0;border-radius:12px;padding:10px 12px;font:600 16px ui-monospace,Menlo,monospace;letter-spacing:.06em;text-transform:uppercase}
.mb-code input:focus{outline:0;border-color:#2f6bff}
.mb-code button{flex:none;border:0;border-radius:12px;padding:0 16px;font:inherit;font-weight:700;color:#fff;background:#141a26;cursor:pointer}
.mb-msg{min-height:20px;margin:8px 0 0;font-size:13px;color:#667085;text-align:center}.mb-msg.ok{color:#12b76a;font-weight:600}.mb-msg.bad{color:#e5484d}
.mb-small{font-size:12px;color:#98a2b3;text-align:center;margin:10px 0 0}`;
    document.head.appendChild(s);
  }
  // opts: {title, text, free}：free 是不开会员也能选的做法（比如「先转前 30 分钟」），不给就只有购买 / 激活
  function open(opts = {}) {
    if (!cfg) return Promise.resolve('member');
    css(); close(null);
    return new Promise(resolve => {
      const perks = cfg.perks || ['全站工具的进阶功能都能用（录音转文字不限时长、简历存多份…）', '以后每天上新的工具，进阶功能一样能用'];
      const m = document.createElement('div'); m.className = 'mb-mask';
      m.innerHTML = `<div class="mb-box" role="dialog" aria-modal="true">
        <button class="mb-x" aria-label="关闭">✕</button>
        <h3>${esc(opts.title || '开通工具箱会员')}</h3>
        ${opts.text ? `<p class="mb-why">${esc(opts.text)}</p>` : ''}
        <div class="mb-card">
          <div class="mb-price">${esc(cfg.label || '早鸟价')}<b>${esc(cfg.price || '¥9.9')}</b>${cfg.was ? `<s>${esc(cfg.was)}</s>` : ''}</div>
          <ul>${perks.map(p => `<li>${esc(p)}</li>`).join('')}</ul>
          ${cfg.buy ? `<a class="mb-btn mb-buy" href="${esc(cfg.buy)}" target="_blank" rel="noopener">${esc(cfg.buyText || '去购买会员码')}</a>` : ''}
          ${cfg.how ? `<p class="mb-small" style="color:#8a6100">${esc(cfg.how)}</p>` : ''}
        </div>
        <div class="mb-code"><input placeholder="输入会员码" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="20"><button>激活</button></div>
        <p class="mb-msg"></p>
        ${opts.free ? `<button class="mb-btn mb-ghost mb-free">${esc(opts.free)}</button>` : ''}
        <p class="mb-small">会员码存在这个浏览器里；换手机、换浏览器再输一次就行</p>
      </div>`;
      document.body.appendChild(m);
      dlg = { m, resolve };
      const inp = m.querySelector('input'), msg = m.querySelector('.mb-msg');
      const say = (t, c = '') => { msg.textContent = t; msg.className = 'mb-msg ' + c; };
      m.querySelector('.mb-x').onclick = () => close(null);
      m.addEventListener('click', e => { if (e.target === m) close(null); });
      if (opts.free) m.querySelector('.mb-free').onclick = () => close('free');
      const go = async () => {
        const c = norm(inp.value);
        if (c.length !== 12) return say('会员码是 12 位字母和数字（比如 K7QX-2M9D-HT4W）', 'bad');
        say('正在核对…');
        try {
          if (!(await check(c))) return say('这个会员码不对，检查一下有没有输错', 'bad');
        } catch (e) { return say(e.message, 'bad'); }
        localStorage.setItem(KEY, c); cached = true;
        say('会员已开通 ✓', 'ok'); refreshBadges();
        setTimeout(() => close('member'), 700);
      };
      m.querySelector('.mb-code button').onclick = go;
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
      inp.addEventListener('input', () => { const v = fmt(inp.value).slice(0, 14); if (v !== inp.value && !/-$/.test(inp.value)) inp.value = v; });
    });
  }
  function close(v) { if (!dlg) return; const d = dlg; dlg = null; d.m.remove(); d.resolve(v); }
  async function gate(opts) { if (!cfg || (await active())) return 'member'; return open(opts); }

  // 页面上标了 data-member-badge 的元素：显示「会员 ✓」或「开通会员」入口
  async function refreshBadges() {
    const els = document.querySelectorAll('[data-member-badge]');
    if (!cfg || !els.length) return;
    const yes = await active();
    els.forEach(el => {
      el.hidden = false;
      el.innerHTML = yes ? `<span class="mb-on">会员 ✓ <small>${esc(fmt(localStorage.getItem(KEY)).slice(0, 4))}…</small></span>`
        : `<button class="mb-open">${esc(cfg.cta || '开通会员 ' + (cfg.price || '¥9.9'))}</button>`;
      const b = el.querySelector('.mb-open'); if (b) b.onclick = () => open();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refreshBadges); else refreshBadges();
  return { enabled: !!cfg, active, gate, open, norm };
})();
