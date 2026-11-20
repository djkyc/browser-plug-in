const PROVIDER_LABEL = { gmail: 'Gmail', outlook: 'Outlook', proton: 'Proton' };
// v1.15.7：打开收件箱 / 网页版邮件都走后台 openMailbox / openMessage（background.js），
// 不再在弹窗里拼 /mail/N/（那个序号跟浏览器会话槽位对不上，会串号）。
const STATUS_TEXT = {
  'need-login': '未登录',
  'need-tab': '未抓到登录凭证：打开一次该邮箱网页版，等它加载完再点检查（凭证过期也要重开一次）',
};
// v1.14.0：弹窗自己维护未读计数（安静标已读后立即减，不等后台重查）
let lastMeta = { total: 0, enabledCount: 0, interval: 1 };
// v1.15.26：左侧图标栏选中的账号（null = 全部账号）；点图标切换，点已选中的再点回全部
let selectedAccId = null;
// v1.15.49：rail 首字母圆标按服务商固定着色（用户 15:02 定的色值）：
// Proton #d444f1、Gmail #12b76a、Outlook #7ddeff、Hotmail #fdc347、Live #2cb2fc。
// v1.15.50（用户 15:13 改色）：Hotmail 改 #fa6604、Outlook 改 #1a4bbb，其它不动。
// 其它后缀（iconKindForEmail 认不出的）：按账号 hash 从 RAIL_OTHER_COLORS 稳定挑一个，
// 避开上面五个服务商色，避免撞色。
const RAIL_PROVIDER_COLORS = {
  proton: '#d444f1',
  gmail: '#12b76a',
  outlook: '#1a4bbb',
  hotmail: '#fa6604',
  live: '#2cb2fc',
};
const RAIL_OTHER_COLORS = ['#f04438', '#f79009', '#2e90fa', '#7a5af8', '#ec4899', '#06aed4', '#667085', '#98a2b3'];
function railColorFor(acc) {
  const kind = iconKindForEmail(acc.email) || acc.provider;
  if (kind && RAIL_PROVIDER_COLORS[kind]) return RAIL_PROVIDER_COLORS[kind];
  let h = 0;
  const s = acc.id || acc.email || '';
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return RAIL_OTHER_COLORS[h % RAIL_OTHER_COLORS.length];
}
// 圆标上的字母颜色：亮底（Outlook #7ddeff、Hotmail #fdc347）用深字，暗底用白字，不然看不清
function railTextColor(bg) {
  const m = /^#([0-9a-f]{6})$/i.exec(bg || '');
  if (!m) return '#fff';
  const r = parseInt(m[1].slice(0, 2), 16), g = parseInt(m[1].slice(2, 4), 16), b = parseInt(m[1].slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? '#1a1a1a' : '#fff';
}
function railInitial(acc) {
  const local = (acc.email || acc.label || '?').split('@')[0];
  return (local.charAt(0) || '?').toUpperCase();
}
// v1.15.26：左侧图标栏——顶部“全部”信封 + 每账号一个彩色圆标（首字母 + 未读角标）
function buildRail(accounts) {
  const rail = document.getElementById('rail');
  rail.innerHTML = '';
  const all = document.createElement('div');
  all.className = 'rail-icon all' + (selectedAccId === null ? ' selected' : '');
  all.textContent = '✉';
  all.title = '全部账号';
  all.onclick = () => { selectedAccId = null; load(); };
  rail.append(all);
  for (const acc of accounts) {
    const ic = document.createElement('div');
    ic.className = 'rail-icon' + (selectedAccId === acc.id ? ' selected' : '');
    // 注意：别用 ic.style.background 回读再算字色——style.background 读回来是 rgb(...) 格式，
    // railTextColor 只认 #rrggbb，会误判成白字。先存到变量里再传。
    const railBg = railColorFor(acc);
    ic.style.background = railBg;
    ic.style.color = railTextColor(railBg);
    ic.textContent = railInitial(acc);
    ic.title = acc.label || acc.email || acc.provider;
    ic.dataset.accId = acc.id;
    const n = acc.status === 'ok' ? (acc.unread || 0) : 0;
    if (n > 0) {
      const b = document.createElement('span');
      b.className = 'rail-badge';
      b.textContent = n > 99 ? '99+' : String(n);
      ic.append(b);
    }
    ic.onclick = () => { selectedAccId = (selectedAccId === acc.id) ? null : acc.id; load(); };
    // v1.15.35：徽章全部换成矢量 SVG（Gmail 官方彩色 M、Outlook 深蓝 O、Hotmail/Live 浅蓝 O、
    // Proton 白字信封），放大到 18px、logo 14px，看得清；不再用糊掉的小 PNG 图。
    const kind = iconKindForEmail(acc.email) || acc.provider;
    const pv = PROVIDER_ICON[kind === 'hotmail' ? 'outlook' : kind] || { color: '#888', letter: '?' };
    const pb = document.createElement('span');
    pb.className = 'rail-provider';
    pb.style.background = providerLogoBg(kind);
    const logo = providerLogoSvg(kind, 14);
    if (logo) pb.append(logo);
    else pb.textContent = pv.letter;
    ic.append(pb);
    // v1.15.27：图标栏支持拖放排序（拖圆标换位置，存 accounts 数组顺序）
    ic.draggable = true;
    ic.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', acc.id);
      e.dataTransfer.effectAllowed = 'move';
      ic.classList.add('dragging');
    });
    ic.addEventListener('dragend', () => ic.classList.remove('dragging'));
    ic.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; ic.classList.add('drag-over'); });
    ic.addEventListener('dragleave', () => ic.classList.remove('drag-over'));
    ic.addEventListener('drop', async (e) => {
      e.preventDefault();
      ic.classList.remove('drag-over');
      const dragId = e.dataTransfer.getData('text/plain');
      if (!dragId || dragId === acc.id) return;
      const all = (await chrome.storage.local.get(['accounts'])).accounts || [];
      const from = all.findIndex(a => a.id === dragId);
      const to = all.findIndex(a => a.id === acc.id);
      if (from < 0 || to < 0) return;
      const [moved] = all.splice(from, 1);
      all.splice(to, 0, moved);
      await chrome.storage.local.set({ accounts: all });
    });
    rail.append(ic);
  }
  // v1.15.28：号多到放不下时图标栏可滚动；选中的图标滚到可见处
  const sel = rail.querySelector('.rail-icon.selected');
  if (sel) sel.scrollIntoView({ block: 'nearest' });
}
// v1.15.35：侧边栏鼠标贴边自动滚动——号多到放不下时，鼠标贴到栏的底边就往下滚、
// 贴到顶边就往上滚，不用滚轮也能翻到下面的号；鼠标离开栏或挪开就停。
// 用 setInterval 不用 rAF（rAF 在后台标签页/无头里会被节流，滚不动）。
(function setupRailAutoScroll() {
  const rail = document.getElementById('rail');
  if (!rail) return;
  let dir = 0; // -1 往上，1 往下，0 停
  let timer = null;
  function setDir(d) {
    if (d === dir) return;
    dir = d;
    if (timer) { clearInterval(timer); timer = null; }
    if (dir) timer = setInterval(() => { rail.scrollTop += dir * 4; }, 30);
  }
  rail.addEventListener('mousemove', (e) => {
    const r = rail.getBoundingClientRect();
    const y = e.clientY - r.top;
    const EDGE = 28;
    if (y > r.height - EDGE && rail.scrollTop + rail.clientHeight < rail.scrollHeight - 1) setDir(1);
    else if (y < EDGE && rail.scrollTop > 0) setDir(-1);
    else setDir(0);
  });
  rail.addEventListener('mouseleave', () => setDir(0));
})();
function statusText(acc) {
  if (acc.status === 'need-login') {
    if (acc.provider === 'outlook') return '未登录：去设置页 Outlook 区域点“登录”';
    return '未登录：点账号名去登录一次';
  }
  return STATUS_TEXT[acc.status] || ('状态：' + acc.status);
}

// v1.15.22：主题三档（自动/暗黑/白色）。auto 时不设 data-theme，靠 CSS 的
// prefers-color-scheme 跟系统走；dark/light 强制对应主题。
function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'dark') root.dataset.theme = 'dark';
  else if (theme === 'light') root.dataset.theme = 'light';
  else delete root.dataset.theme;
}

async function load() {
  const { accounts = [] } = await chrome.storage.local.get(['accounts']);
  const { settings = {} } = await chrome.storage.local.get(['settings']);
  applyTheme(settings.theme || 'auto');
  render(accounts, settings);
}

// v1.15.22：鼠标跟随光斑——鼠标移到账号卡/邮件卡上时，把位置写进 --mx/--my，
// CSS 的 ::before 用径向渐变画一层跟着鼠标走的柔光（事件委托，卡片重渲染也不怕）。
document.getElementById('list').addEventListener('mousemove', (e) => {
  const card = e.target.closest('.acc, .msg');
  if (!card) return;
  const r = card.getBoundingClientRect();
  card.style.setProperty('--mx', (e.clientX - r.left) + 'px');
  card.style.setProperty('--my', (e.clientY - r.top) + 'px');
});

// v1.15.11：单封邮件的行（按邮箱分组后，每行只带时间，不再带账号标签，账号看上面的条）
// v1.15.27：showAcc 时左上角带个小账号标（全部视图里认得出是哪号的；单号视图不用，上面有邮箱头）
function buildMsgEl(acc, m, showAcc) {
  const msg = document.createElement('div');
  msg.className = 'msg';
  msg.dataset.accId = acc.id;
  // v1.14.0：点邮件在弹窗里读全文（跟 Peekat 一样），读完自动标已读、收起就消失；
  // Proton 没接正文接口，点它还是打开网页版
  const canReadInline = (acc.provider === 'gmail' || acc.provider === 'outlook') && m.id;
  msg.onclick = () => {
    if (canReadInline) toggleReader(msg, acc, m);
    else chrome.runtime.sendMessage({ type: 'mmn-open-message', accountId: acc.id, messageId: m.id }).catch(() => {});
  };
  msg.innerHTML = '';
  const meta = document.createElement('div');
  meta.className = 'msg-meta';
  if (showAcc) {
    // v1.15.31：显示完整邮箱（不只 @ 前的名字）——同名账号分得出是哪家的（liu687836@proton.me 还是 liu687836@gmail.com）
    const accEl = document.createElement('span');
    accEl.className = 'msg-acc';
    accEl.textContent = acc.email || acc.label || '';
    accEl.title = acc.email || acc.label || '';
    accEl.style.color = railColorFor(acc);
    meta.append(accEl);
  }
  const time = document.createElement('span');
  time.className = 'msg-time';
  time.textContent = fmtTime(m.time);
  meta.append(time);
  const from = document.createElement('div'); from.className = 'from'; from.textContent = m.sender || '';
  const subj = document.createElement('div'); subj.className = 'subj'; subj.textContent = m.subject || '(无标题)';
  const sum = document.createElement('div'); sum.className = 'sum'; sum.textContent = m.summary || '';
  msg.append(meta, from, subj, sum);
  if (m.code) msg.append(makeCodeBadge(msg, m.code));
  // v1.15.56：垃圾邮件（Outlook junk / Gmail、Proton spam）打个“垃圾”标记，一眼分得出
  if (m.folder === 'junk' || m.folder === 'spam') {
    const jb = document.createElement('span');
    jb.className = 'junk-badge';
    jb.textContent = '垃圾邮件';
    msg.append(jb);
  }
  // v1.12.0 Outlook / v1.13.0 Gmail / v1.15.0 Proton：每封邮件的操作按钮
  // Proton 只有标已读/归档/删除，没有回复（回信要私钥加密，扩展里做不了）
  if (acc.status === 'ok' && m.id) {
    const actionType = acc.provider === 'gmail' ? 'mmn-gmail-action' : acc.provider === 'outlook' ? 'mmn-outlook-action' : 'mmn-proton-action';
    const acts = document.createElement('div');
    acts.className = 'msg-actions';
    for (const [label, action] of [['标已读', 'read'], ['归档', 'archive'], ['删除', 'delete']]) {
      const b = document.createElement('button');
      b.textContent = label;
      b.onclick = async (e) => {
        e.stopPropagation();
        b.disabled = true;
        // v1.15.10：点下去立刻把这行拿掉、计数减 1，不用等后台 API + 重查回来才消失；
        // 后台失败会重新加载，把这封恢复回来再显示错误。
        msg.remove();
        decCounts(msg);
        const res = await chrome.runtime.sendMessage({ type: actionType, accountId: acc.id, messageId: m.id, action }).catch(() => null);
        if (!res || res.ok !== true) { await load(); setActionStatus(acc.id, actionErrorText(res), true); }
        else await load();
      };
      acts.append(b);
    }
    if (acc.provider !== 'proton') {
      const rb = document.createElement('button');
      rb.textContent = '回复';
      rb.onclick = (e) => { e.stopPropagation(); toggleReplyBox(msg, acc, m); };
      acts.append(rb);
    }
    msg.append(acts);
  }
  return msg;
}

// 验证码徽标（点一下复制）：列表里是标题+摘要里提到的码；读正文后正文里提到的码会更新它
function makeCodeBadge(msgDiv, code) {
  const codeEl = document.createElement('span');
  codeEl.className = 'code';
  codeEl.textContent = '验证码 ' + code + ' · 点我复制';
  codeEl.onclick = (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(code).then(() => { codeEl.textContent = '已复制 ✓'; setTimeout(() => { codeEl.textContent = '验证码 ' + code + ' · 点我复制'; }, 1200); });
  };
  return codeEl;
}

function render(accounts, settings) {
  const totalEl = document.getElementById('total');
  const listEl = document.getElementById('list');
  const footEl = document.getElementById('foot');
  const enabled = accounts.filter(a => a.enabled !== false);
  const total = enabled.filter(a => a.status === 'ok').reduce((s, a) => s + (a.unread || 0), 0);
  lastMeta = { total, enabledCount: enabled.length, interval: settings.intervalMinutes || 1 };
  totalEl.textContent = accounts.length === 0
    ? '还没有账号：点右上 ⚙️，或先登录 Gmail 再点 ↻ 检查自动发现'
    : `共 ${total} 封未读 · ${enabled.length} 个账号 · 每 ${settings.intervalMinutes || 1} 分钟检查`;

  // v1.15.26：先画左侧图标栏
  buildRail(accounts);
  const query = (document.getElementById('search')?.value || '').trim().toLowerCase();

  if (!accounts.length) {
    listEl.innerHTML = '<div class="empty">先在浏览器里登录你的 Gmail / Outlook / Proton，然后点 ↻ 检查。<br>Gmail 会自动发现 u/0、u/1… 已登录的账号；Outlook / Proton 需要在设置里添加，并打开一次对应标签页。</div>';
  } else if (selectedAccId) {
    // v1.15.27：选中了某个号——主区只显示这个号（邮箱头 + 它的邮件）
    const acc = accounts.find(a => a.id === selectedAccId);
    if (acc) {
      listEl.innerHTML = '';
      listEl.append(buildAccountHeader(acc));
      renderMessageList(listEl, [acc], query, false);
    } else {
      // 选中的号被删了，回全部
      selectedAccId = null;
      listEl.innerHTML = '';
      renderMessageList(listEl, accounts, query, true);
    }
  } else {
    // v1.15.27：全部视图——主区不显示邮箱行，只列所有号的未读邮件（每封带个小账号标）
    listEl.innerHTML = '';
    renderMessageList(listEl, accounts, query, true);
  }
  footEl.textContent = '本地运行，不存密码，不发服务器。Gmail 用 Gmail API OAuth；Outlook 用 Microsoft Graph OAuth；Proton 用标签页会话（可标已读/归档/删除，不能回信）。';
}

// v1.15.27：单号视图的邮箱头（没手柄、没折叠——排序在图标栏拖，折叠用不上了）
function buildAccountHeader(acc) {
  const div = document.createElement('div');
  div.className = 'acc';
  div.dataset.accId = acc.id;
  const head = document.createElement('div');
  head.className = 'acc-head';
  const name = document.createElement('span');
  name.className = 'acc-name';
  name.textContent = acc.label || acc.email || acc.provider;
  name.prepend(providerIconImg(acc.provider, 18));
  name.style.cursor = 'pointer';
  name.title = '点击打开这个号的收件箱';
  name.onclick = () => { chrome.runtime.sendMessage({ type: 'mmn-open-mailbox', accountId: acc.id }).catch(() => {}); };
  const right = document.createElement('span');
  const tag = document.createElement('span');
  tag.className = 'tag';
  tag.textContent = PROVIDER_LABEL[acc.provider] || acc.provider;
  const badge = document.createElement('span');
  badge.className = 'badge' + ((acc.unread || 0) === 0 ? ' zero' : '');
  badge.textContent = acc.status === 'ok' ? String(acc.unread || 0) : '—';
  right.append(tag, document.createTextNode(' '), badge);
  head.append(name, right);
  div.append(head);
  if (acc.status === 'ok' && (acc.provider === 'outlook' || acc.provider === 'gmail')) {
    const cBtn = document.createElement('button');
    cBtn.className = 'compose-toggle';
    cBtn.textContent = '✉️ 写邮件';
    cBtn.onclick = () => toggleComposeBox(div, acc);
    div.append(cBtn);
  }
  // v1.15.10：操作状态行（单号视图才有；全部视图没有邮箱头，操作失败时消息会自己回来）
  if (acc.status === 'ok') {
    const st = document.createElement('div');
    st.className = 'action-status';
    st.dataset.accId = acc.id;
    div.append(st);
  }
  if (acc.status && acc.status !== 'ok') {
    const s = document.createElement('div');
    s.className = 'status';
    s.textContent = statusText(acc);
    div.append(s);
  }
  // v1.12.0 Outlook / v1.13.0 Gmail：token 还是旧权限时未读照常查，但要提示重新登录授权才能回邮件/标已读
  if (acc.status === 'ok' && (acc.provider === 'outlook' || acc.provider === 'gmail') && acc.needsRescope) {
    const s = document.createElement('div');
    s.className = 'status';
    s.textContent = acc.provider === 'gmail'
      ? '回邮件/标已读要重新登录授权一次（去设置页 Gmail 区域点“登录”）'
      : '回邮件/标已读要重新登录授权一次（去设置页 Outlook 区域点“登录”）';
    div.append(s);
  }
  return div;
}

// v1.15.27：把这些号的未读邮件按时间倒序列出来（全部号加起来最多 30 封）；
// showAcc 时每封左上角带个小账号标（全部视图里认得出是哪号的）
function renderMessageList(listEl, accounts, query, showAcc) {
  const all = [];
  for (const acc of accounts) {
    if (acc.enabled === false || acc.status !== 'ok') continue;
    for (const m of (acc.messages || [])) all.push({ acc, m });
  }
  all.sort((a, b) => (new Date(b.m.time || 0).getTime() || 0) - (new Date(a.m.time || 0).getTime() || 0));
  let shown = 0;
  for (const { acc, m } of all) {
    if (shown >= 30) break;
    if (query && !((m.sender || '') + ' ' + (m.subject || '') + ' ' + (m.summary || '') + ' ' + (acc.email || '') + ' ' + (acc.label || '')).toLowerCase().includes(query)) continue;
    listEl.append(buildMsgEl(acc, m, showAcc));
    shown++;
  }
  if (!shown) {
    const none = document.createElement('div');
    none.className = 'empty';
    none.textContent = all.length ? '没有匹配的邮件' : '没有未读邮件';
    listEl.append(none);
  }
}

// 邮件时间：今天的只显示时:分，之前的显示 月-日
function fmtTime(t) {
  const d = new Date(t || 0);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return sameDay ? `${hh}:${mi}` : `${mm}-${dd} ${hh}:${mi}`;
}

// v1.14.0：弹窗内读全文（跟 Peekat 一样）
// 点开：取正文显示 + 自动标已读（安静模式，不触发后台重查）；
// 收起：已经标已读的就把这行从列表拿掉（读完自动消失），没标上的留着。
function toggleReader(msgDiv, acc, m) {
  const old = msgDiv.querySelector('.msg-body');
  if (old) { closeReader(msgDiv, acc); return; }
  openReader(msgDiv, acc, m);
}
function closeReader(msgDiv, acc) {
  const bodyEl = msgDiv.querySelector('.msg-body');
  if (bodyEl) bodyEl.remove();
  msgDiv._readerOpen = false;
  // 计数在标已读成功时已经减过，这里只拿掉这行
  if (msgDiv._readDone) msgDiv.remove();
}
async function openReader(msgDiv, acc, m) {
  const bodyEl = document.createElement('div');
  bodyEl.className = 'msg-body loading';
  bodyEl.textContent = '正在读正文…';
  bodyEl.onclick = (e) => e.stopPropagation();
  msgDiv.append(bodyEl);
  msgDiv._readerOpen = true;
  const bodyType = acc.provider === 'gmail' ? 'mmn-gmail-body' : 'mmn-outlook-body';
  const res = await chrome.runtime.sendMessage({ type: bodyType, accountId: acc.id, messageId: m.id }).catch(() => null);
  if (!msgDiv.isConnected || !msgDiv.querySelector('.msg-body')) return; // 期间列表被刷新了
  if (!res || res.ok !== true) {
    bodyEl.classList.remove('loading');
    bodyEl.textContent = '正文读不出来：' + actionErrorText(res) + '。';
    const web = document.createElement('a');
    web.textContent = '在网页版打开 ↗';
    web.onclick = (e) => { e.stopPropagation(); chrome.runtime.sendMessage({ type: 'mmn-open-message', accountId: acc.id, messageId: m.id }).catch(() => {}); };
    bodyEl.append(document.createElement('br'), web);
    return;
  }
  bodyEl.classList.remove('loading');
  // v1.15.53：正文放进单独的 .msg-body-text，翻译时只换这块文字，不动下面的工具行
  bodyEl.textContent = '';
  const bodyText = document.createElement('div');
  bodyText.className = 'msg-body-text';
  bodyText.textContent = res.text || '(没有正文)';
  bodyEl.append(bodyText);
  // v1.15.11：正文里提到的验证码（比标题+摘要准）——有就更新这行的徽标，没有就补一个
  if (res.code) {
    const oldBadge = msgDiv.querySelector('.code');
    if (oldBadge) oldBadge.remove();
    msgDiv.insertBefore(makeCodeBadge(msgDiv, res.code), msgDiv.querySelector('.msg-actions') || null);
    m.code = res.code;
  }
  const tools = document.createElement('div');
  tools.className = 'reader-tools';
  const web = document.createElement('a');
  web.textContent = acc.provider === 'gmail' ? '在 Gmail 中打开 ↗' : '在 Outlook 中打开 ↗';
  web.onclick = (e) => { e.stopPropagation(); chrome.runtime.sendMessage({ type: 'mmn-open-message', accountId: acc.id, messageId: m.id }).catch(() => {}); };
  // v1.15.53：翻译（Google 免费接口，译成简体中文；再点切回原文，译文缓存不再重复请求）
  const tr = document.createElement('a');
  tr.textContent = '翻译';
  tr.onclick = (e) => { e.stopPropagation(); toggleTranslate(bodyEl, bodyText, tr, res.text || ''); };
  const collapse = document.createElement('a');
  collapse.textContent = '收起 ∧';
  collapse.onclick = (e) => { e.stopPropagation(); closeReader(msgDiv, acc); };
  tools.append(web, tr, collapse);
  bodyEl.append(tools);
  // 读完自动标已读（安静模式：后台不重查，弹窗自己减计数）
  const actionType = acc.provider === 'gmail' ? 'mmn-gmail-action' : 'mmn-outlook-action';
  const r2 = await chrome.runtime.sendMessage({ type: actionType, accountId: acc.id, messageId: m.id, action: 'read', quiet: true }).catch(() => null);
  if (!msgDiv.isConnected) return;
  if (r2 && r2.ok) {
    msgDiv._readDone = true;
    decCounts(msgDiv);
  } else if (r2) {
    setActionStatus(acc.id, actionErrorText(r2), true);
  }
}
// v1.15.53：正文翻译开关。已是中文（CJK 占 60% 以上）就不发请求；译文存 bodyEl._transText，切换不再重复请求。
async function toggleTranslate(bodyEl, bodyText, link, origText) {
  if (bodyEl._showingTrans) {
    bodyText.textContent = origText;
    bodyEl._showingTrans = false;
    link.textContent = '翻译';
    return;
  }
  if (bodyEl._transText) {
    bodyText.textContent = bodyEl._transText;
    bodyEl._showingTrans = true;
    link.textContent = '原文';
    return;
  }
  if (!origText || !origText.trim()) return;
  const cjk = (origText.match(/[\u4e00-\u9fa5]/g) || []).length;
  const nonWs = origText.replace(/\s/g, '').length;
  if (nonWs && cjk / nonWs > 0.6) {
    link.textContent = '已是中文';
    setTimeout(() => { if (!bodyEl._showingTrans) link.textContent = '翻译'; }, 1500);
    return;
  }
  link.textContent = '翻译中…';
  const res = await chrome.runtime.sendMessage({ type: 'mmn-translate', text: origText }).catch(() => null);
  if (!bodyEl.isConnected) return;
  if (!res || res.ok !== true) {
    link.textContent = '翻译失败';
    setTimeout(() => { if (!bodyEl._showingTrans) link.textContent = '翻译'; }, 2000);
    return;
  }
  bodyEl._transText = res.text;
  bodyText.textContent = res.text;
  bodyEl._showingTrans = true;
  link.textContent = '原文';
}
// 安静标已读成功后：账号徽标 -1，总数 -1（下次定时检查再跟服务器对齐）
// v1.15.7：邮件行不再嵌在账号卡里，按 data-acc-id 找账号条上的徽标
function decCounts(msgDiv) {
  const accId = msgDiv.dataset.accId;
  const badge = accId && document.querySelector('.acc[data-acc-id="' + CSS.escape(accId) + '"] .badge');
  if (badge) {
    const n = Math.max(0, (parseInt(badge.textContent, 10) || 0) - 1);
    badge.textContent = String(n);
    if (n === 0) badge.classList.add('zero');
  }
  // v1.15.26：左侧图标栏上的角标也减 1，减到 0 就拿掉
  const railBadge = accId && document.querySelector('.rail-icon[data-acc-id="' + CSS.escape(accId) + '"] .rail-badge');
  if (railBadge) {
    const n = Math.max(0, (parseInt(railBadge.textContent, 10) || 0) - 1);
    if (n === 0) railBadge.remove();
    else railBadge.textContent = String(n);
  }
  lastMeta.total = Math.max(0, lastMeta.total - 1);
  const totalEl = document.getElementById('total');
  if (totalEl) totalEl.textContent = `共 ${lastMeta.total} 封未读 · ${lastMeta.enabledCount} 个账号 · 每 ${lastMeta.interval} 分钟检查`;
}

function actionErrorText(res) {
  const e = (res && res.error) || '';
  if (e === 'need-login') return '这个号还没登录，去设置页登录一次';
  if (e === 'need-rescope') return '要重新登录授权一次（新权限）';
  if (e === 'need-tab') return '凭证过期：重开一次 Proton 标签页，等它加载完再试';
  return '操作失败：' + (e || '未知错误');
}
function setActionStatus(accId, text, isError) {
  const el = document.querySelector('.action-status[data-acc-id="' + CSS.escape(accId) + '"]');
  if (!el) return;
  el.textContent = text;
  el.style.color = isError ? '#b42318' : '#067647';
  if (text) setTimeout(() => { if (el.textContent === text) el.textContent = ''; }, 6000);
}
// 邮件下面的回复框（在 msg 里面，点它不能触发 msg 的开链接）
function toggleReplyBox(msgDiv, acc, m) {
  const old = msgDiv.querySelector('.reply-box');
  if (old) { old.remove(); return; }
  const box = document.createElement('div');
  box.className = 'reply-box';
  box.onclick = (e) => e.stopPropagation();
  const ta = document.createElement('textarea');
  ta.placeholder = '回复 ' + (m.sender || '') + '…';
  const row = document.createElement('div');
  row.className = 'compose-row';
  const send = document.createElement('button');
  send.className = 'primary'; send.textContent = '发送回复';
  const cancel = document.createElement('button');
  cancel.textContent = '取消';
  cancel.onclick = (e) => { e.stopPropagation(); box.remove(); };
  send.onclick = async (e) => {
    e.stopPropagation();
    if (!ta.value.trim()) { ta.focus(); return; }
    send.disabled = true; send.textContent = '发送中…';
    const sendType = acc.provider === 'gmail' ? 'mmn-gmail-send' : 'mmn-outlook-send';
    const res = await chrome.runtime.sendMessage({ type: sendType, accountId: acc.id, messageId: m.id, body: ta.value }).catch(() => null);
    if (res && res.ok) { setActionStatus(acc.id, '已回复 ✓', false); await load(); }
    else { setActionStatus(acc.id, actionErrorText(res), true); send.disabled = false; send.textContent = '发送回复'; }
  };
  row.append(send, cancel);
  box.append(ta, row);
  msgDiv.append(box);
  ta.focus();
}
// 账号下面的写邮件框
function toggleComposeBox(accDiv, acc) {
  const old = accDiv.querySelector('.compose');
  if (old) { old.remove(); return; }
  const box = document.createElement('div');
  box.className = 'compose';
  const to = document.createElement('input');
  to.type = 'text'; to.placeholder = '收件人邮箱（多个用 ; 分隔）';
  const subj = document.createElement('input');
  subj.type = 'text'; subj.placeholder = '主题';
  const body = document.createElement('textarea');
  body.placeholder = '正文…';
  const row = document.createElement('div');
  row.className = 'compose-row';
  const send = document.createElement('button');
  send.className = 'primary'; send.textContent = '发送';
  const cancel = document.createElement('button');
  cancel.textContent = '取消';
  cancel.onclick = () => box.remove();
  send.onclick = async () => {
    const toV = to.value.trim();
    if (!toV.includes('@')) { setActionStatus(acc.id, '收件人邮箱不对', true); to.focus(); return; }
    send.disabled = true; send.textContent = '发送中…';
    const sendType = acc.provider === 'gmail' ? 'mmn-gmail-send' : 'mmn-outlook-send';
    const res = await chrome.runtime.sendMessage({ type: sendType, accountId: acc.id, to: toV, subject: subj.value.trim(), body: body.value }).catch(() => null);
    if (res && res.ok) { setActionStatus(acc.id, '已发送 ✓', false); box.remove(); }
    else { setActionStatus(acc.id, actionErrorText(res), true); send.disabled = false; send.textContent = '发送'; }
  };
  row.append(send, cancel);
  box.append(to, subj, body, row);
  accDiv.append(box);
  to.focus();
}

document.getElementById('search').oninput = load;
document.getElementById('refresh').onclick = async () => {
  document.getElementById('refresh').textContent = '检查中…';
  try { await chrome.runtime.sendMessage({ type: 'mmn-check-now', discover: true }); } catch {}
  await load();
  document.getElementById('refresh').textContent = '↻ 检查';
};
document.getElementById('openOptions').onclick = () => chrome.runtime.openOptionsPage();
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.accounts) load(); });
load();
