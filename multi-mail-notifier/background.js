/* Multi Mail Notifier v1.11.0 — background service worker (MV3)
 *
 * 架构（v1.13.0 起）：
 * - Gmail：Gmail API OAuth（Peekat 方式），见 gmail-oauth.js。
 *   每个号单独登录拿 token（launchWebAuthFlow + PKCE，不用 client secret），
 *   未读数走 GET /users/me/labels/INBOX，未读列表走 /users/me/messages，
 *   标已读/归档/删除/回邮件/写邮件走 modify/trash/send。
 *   v1.12.0 之前的 Atom feed 只读，已删掉（只留 parseAtom 给“自动发现”找邮箱）。
 * - Outlook：Microsoft Graph OAuth（Peekat 方式），见 outlook-oauth.js。
 *   每个号单独登录拿 token（launchWebAuthFlow + PKCE，不用 client secret），
 *   未读数走 GET /me/mailFolders/inbox?$select=unreadItemCount。
 *   v1.10.5 之前那套 service.svc 重放 + webRequest 抄 x-owa-canary +
 *   标签页上报 + CDP 调试器 cookie 隔离，已全部删掉。
 * - Proton：打开一次 mail.proton.me 后抄 x-pm-uid 等头，后台调
 *   GET https://mail.proton.me/api/mail/v4/conversations?LabelID=0，
 *   数未读会话数（不是封数）。这套不动（Email Notifier 同款内部接口）。
 *
 * 所有数据只在 chrome.storage.local，绝不发到任何第三方服务器。
 * token / 请求头的值只存本地，设置页只显示“已登录 / 已抓到 + 时间”，不显示值。
 */
importScripts('outlook-oauth.js', 'gmail-oauth.js');

const DEFAULT_SETTINGS = {
  intervalMinutes: 0.5,    // 轮询间隔（分钟），0.5 = 30 秒；Chrome 重复闹钟最小 1 分钟，<1 分钟时用一次性闹钟连锁
  desktopNotif: true,      // 新邮件桌面通知
  sound: false,            // 新邮件提示音（用 WebAudio 哔一声，不用音频文件）
  onlyImportant: false,    // 只提醒含验证码的邮件（Peekat 思路：安静，只报重要的）
  quietHours: false,       // Peekat 思路：免打扰时段内不弹桌面通知
  quietStart: '23:00',     // 免打扰开始
  quietEnd: '07:00',       // 免打扰结束
  badgeColor: '#d93025',
  autoUpdateCheck: true,   // v1.15.44：自动检查更新（去 GitHub 查新版本）
};

// v1.15.45：自动检查更新——读仓库里 multi-mail-notifier/version.json。
// 注意：扩展不能自己给自己换代码（Chrome 不允许），所以查到新版只能弹通知 + 给下载链接，
// 用户点链接去 GitHub 下新 zip、覆盖安装后刷新。想完全静默自动更新，只能上架 Chrome 应用商店。
// 仓库是 browser-plug-in（一个仓库放多个插件），Release 是整个仓库共用的，所以不用 Releases API
// （最新 Release 可能是别的插件的）；改成每个插件自己在文件夹里放一个 version.json，扩展只读自己那份。
// 发布新版时：manifest 升版号 → 打包新 zip → 把 version.json 里的 version/url/download 改成新的 → 推到 GitHub。
const UPDATE_JSON_URL = 'https://raw.githubusercontent.com/djkyc/browser-plug-in/main/multi-mail-notifier/version.json';
const UPDATE_FALLBACK_URL = 'https://github.com/djkyc/browser-plug-in/releases';
const UPDATE_CHECK_INTERVAL_MIN = 720; // 自动检查间隔：12 小时
function compareVersions(a, b) {
  const pa = String(a || '').replace(/^v/i, '').split('.').map(x => parseInt(x, 10) || 0);
  const pb = String(b || '').replace(/^v/i, '').split('.').map(x => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}
async function checkForUpdate({ manual = false } = {}) {
  const cur = chrome.runtime.getManifest().version;
  const info = { curVersion: cur, checkedAt: Date.now(), latestVersion: null, releaseUrl: null, hasUpdate: false, error: null };
  try {
    const res = await fetch(UPDATE_JSON_URL, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error('version.json 返回 ' + res.status);
    const data = await res.json();
    const latest = String(data.version || '').replace(/^v/i, '');
    info.latestVersion = latest;
    info.releaseUrl = data.url || data.download || UPDATE_FALLBACK_URL;
    info.downloadUrl = data.download || info.releaseUrl;
    info.hasUpdate = !!latest && compareVersions(latest, cur) > 0;
  } catch (e) {
    info.error = String(e && e.message || e);
  }
  try { await chrome.storage.local.set({ updateInfo: info }); } catch {}
  await diagLog(`[更新] 检查完成：当前 ${cur}，最新 ${info.latestVersion || '未知'}${info.hasUpdate ? '，有新版' : ''}${info.error ? '，失败：' + info.error : ''}`);
  if (info.hasUpdate) {
    const { updateNotifiedVersion } = await chrome.storage.local.get(['updateNotifiedVersion']);
    if (manual || updateNotifiedVersion !== info.latestVersion) {
      try {
        await chrome.storage.local.set({ updateNotifiedVersion: info.latestVersion });
        await chrome.notifications.create('mmn-update-' + info.latestVersion, {
          type: 'basic', iconUrl: 'icons/icon128.png',
          title: `Multi Mail Notifier 有新版本 v${info.latestVersion}`,
          message: `当前 v${cur}，点这里去 GitHub 下载新版（解压覆盖安装后刷新）。`,
          priority: 2,
        });
      } catch {}
    }
  }
  return info;
}
async function setupUpdateAlarm() {
  const settings = await getSettings();
  try {
    if (settings.autoUpdateCheck !== false) {
      chrome.alarms.create('mmn-update-check', { periodInMinutes: UPDATE_CHECK_INTERVAL_MIN });
    } else {
      chrome.alarms.clear('mmn-update-check');
    }
  } catch {}
}

// v1.15.12：Outlook 隔离——/mail/N/ 是浏览器里登录的顺序槽位，不是扩展自己的序号
// （拿扩展序号拼 /mail/N/ 必然串号，v1.15.8 的教训；两个个人号都写死 /mail/0/ 也一样串，
// 因为 0 号槽位是哪个邮箱由浏览器定）。正确做法是从真实标签页上学：内容脚本上报
// （邮箱 + 槽位），后台记在 outlookSlots 里；“打开收件箱”按学到的槽位开，还没学到的
// 逐个槽位试（见 probeOutlookSlot），试出来就记下来。工作/学校号走 office.com，没有槽位。
const PERSONAL_OUTLOOK_RE = /@(?:(?:outlook|hotmail|live)\.[a-z.]+|msn\.com|passport\.com|windowslive\.com)$/i;
function isPersonalOutlook(email) { return PERSONAL_OUTLOOK_RE.test(String(email || '').toLowerCase()); }
// 槽位缓存（内存里一份，启动时从存储读；内容脚本上报 / 扫标签页时更新并写回）
let outlookSlotCache = {};
let outlookSlotsLoaded = false;
async function loadOutlookSlots() {
  if (outlookSlotsLoaded) return outlookSlotCache;
  try {
    const r = await chrome.storage.local.get(['outlookSlots']);
    if (r.outlookSlots && typeof r.outlookSlots === 'object') outlookSlotCache = r.outlookSlots;
  } catch {}
  outlookSlotsLoaded = true;
  return outlookSlotCache;
}
async function saveOutlookSlot(email, slot) {
  if (!email || slot == null) return;
  const key = String(email).toLowerCase();
  if (outlookSlotCache[key] === slot) return;
  outlookSlotCache[key] = slot;
  try { await chrome.storage.local.set({ outlookSlots: outlookSlotCache }); } catch {}
}
// 内容脚本主动上报的（邮箱，槽位）——只记扩展里已知的 Outlook 账号，
// 防内容脚本抓到收件箱里发件人的邮箱、把陌生地址记成槽位。
async function isKnownOutlookAccount(email) {
  try {
    const { accounts = [] } = await chrome.storage.local.get(['accounts']);
    return accounts.some(a => a.provider === 'outlook' && String(a.email || '').toLowerCase() === String(email || '').toLowerCase());
  } catch { return false; }
}
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'mmn-outlook-slot') {
    isKnownOutlookAccount(msg.email).then(known => { if (known) saveOutlookSlot(msg.email, msg.slot); }).catch(() => {});
  }
});
// v1.15.15：之前学错的槽位（A 记成 0 号、B 记成 1 号之类）会一直错下去，
// 第一次启动时清掉重学（只清一次，之后靠内容脚本上报 + 试探重新学）。
async function resetOutlookSlotsOnce() {
  try {
    const r = await chrome.storage.local.get(['outlookSlotsResetV11515']);
    if (!r.outlookSlotsResetV11515) {
      outlookSlotCache = {};
      await chrome.storage.local.set({ outlookSlots: {}, outlookSlotsResetV11515: true });
      return true;
    }
  } catch {}
  return false;
}
loadOutlookSlots(); // 启动时先读一份，后台常驻就不用每次都读存储
resetOutlookSlotsOnce();
function outlookSlotFor(acc) {
  if (!isPersonalOutlook(acc && acc.email)) return null;
  // v1.15.16：手动指定的槽位优先（自动识别在某些电脑上读不到邮箱时用，设置页里选）
  if (acc && acc.slotOverride != null && Number.isInteger(acc.slotOverride) && acc.slotOverride >= 0 && acc.slotOverride <= 9) return acc.slotOverride;
  const s = outlookSlotCache[String(acc.email).toLowerCase()];
  return (s == null ? 0 : s);
}
function outlookBase(acc) {
  return isPersonalOutlook(acc && acc.email) ? 'https://outlook.live.com/mail/' + outlookSlotFor(acc) : 'https://outlook.office.com/mail';
}
// v1.15.18：个人 Outlook 号打开收件箱改走 login_hint（按邮箱地址开，不认槽位号）。
// 槽位号在你这台电脑上靠不住（登出重登就变，A=0/B=1 和 A=1/B=0 都试过还是串）；
// login_hint 是 Outlook 自己切号时用的地址（?login_hint=邮箱），跟邮箱绑定，槽位变了也不怕。
function outlookInboxUrl(acc) {
  if (isPersonalOutlook(acc && acc.email)) {
    return 'https://outlook.live.com/mail/?login_hint=' + encodeURIComponent(acc.email);
  }
  return 'https://outlook.office.com/mail/inbox';
}
function outlookMessageUrl(acc, messageId) {
  const base = outlookBase(acc) + '/deeplink/read/' + encodeURIComponent(messageId || '');
  // 读具体邮件也带上 login_hint，确保进的是这个号的邮箱
  if (isPersonalOutlook(acc && acc.email)) return base + '?login_hint=' + encodeURIComponent(acc.email);
  return base;
}
const PROVIDER_META = {
  gmail:   { name: 'Gmail',   inbox: (a) => `https://mail.google.com/mail/u/${a.index ?? 0}/#inbox` },
  outlook: { name: 'Outlook', inbox: (a) => outlookInboxUrl(a) },
  proton:  { name: 'Proton',  inbox: (a) => `https://mail.proton.me/u/${a.index ?? 0}/inbox` },
};
function parseOutlookSlot(url) {
  const m = String(url || '').match(/\/mail\/(\d+)\//);
  return m ? parseInt(m[1], 10) : null;
}
async function saveLastTabId(accountId, tabId) {
  try {
    const { accounts = [] } = await chrome.storage.local.get(['accounts']);
    const next = accounts.map(a => a.id === accountId ? { ...a, lastTabId: tabId } : a);
    await saveAccountsMerged(next);
  } catch {}
}
// 等某个 Outlook 标签页报出当前登录的邮箱（内容脚本没好 / 顶栏还没渲染出来时返回空串，继续等）
async function waitOutlookTabEmail(tabId, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await chrome.tabs.sendMessage(tabId, { type: 'mmn-outlook-account' });
      if (res && res.email) return { email: res.email, slot: res.slot != null ? res.slot : null };
    } catch { /* 内容脚本还没好，继续等 */ }
    await new Promise(r => setTimeout(r, 900));
  }
  return { email: '', slot: null };
}
// 还不知道这个邮箱是哪个槽位时，逐个槽位试（复用同一个标签页），问内容脚本这个标签页当前是哪个邮箱，
// 对上了就把（邮箱，槽位）记下来；试完所有 Outlook 号还没对上，说明这个号没在浏览器里登录过。
async function probeOutlookSlot(acc, tabId, maxSlots) {
  for (let slot = 0; slot < maxSlots; slot++) {
    if (slot > 0) {
      try { await chrome.tabs.update(tabId, { url: `https://outlook.live.com/mail/${slot}/inbox` }); }
      catch { return null; }
    }
    const got = await waitOutlookTabEmail(tabId, 6000);
    if (got.email) {
      const realSlot = (got.slot != null ? got.slot : slot);
      await saveOutlookSlot(got.email, realSlot);
      if (got.email.toLowerCase() === String(acc.email).toLowerCase()) return realSlot;
    }
  }
  return null;
}
// v1.15.12：打开某账号的收件箱（弹窗和设置页都走这一处）。
// 先找这个号已经打开的标签页（Outlook 靠 content-outlook.js 读标签页里当前登录的邮箱，
// 对上了就直接切过去——这才是真正“打开这个号的邮箱”；序号拼出来的 /mail/N/ 不可信）。
// 没找到才开新的收件箱页：个人 Outlook 号按学到的槽位开，还没学到就逐个槽位试（见 probeOutlookSlot）。
async function openMailbox(accountId) {
  const { accounts = [] } = await chrome.storage.local.get(['accounts']);
  const acc = accounts.find(a => a.id === accountId);
  if (!acc) return { ok: false, error: '没找到这个账号' };
  await loadOutlookSlots();
  // Outlook：每次都新开一个标签页，按学到的槽位开（对号入座），不复用旧标签页——
  // 用户在同一个标签页里切过号之后，复用旧标签页容易串到别的号，而且点了没反应。
  // Gmail/Proton：沿用旧逻辑（上次的标签页还在就切过去，没有才新开）。
  if (acc.provider !== 'outlook') {
    // 1) 上次用过的标签页还在，就切过去
    if (acc.lastTabId != null) {
      try {
        const tab = await chrome.tabs.get(acc.lastTabId);
        await chrome.windows.update(tab.windowId, { focused: true });
        await chrome.tabs.update(acc.lastTabId, { active: true });
        return { ok: true, how: 'tab' };
      } catch { /* 标签页已关，往下走 */ }
    }
  }
  // 2) 新开一个收件箱页（个人 Outlook 号走 login_hint 按邮箱开，不认槽位号，不试探）
  const tab = await chrome.tabs.create({ url: PROVIDER_META[acc.provider].inbox(acc) });
  await saveLastTabId(accountId, tab.id);
  return { ok: true, how: 'new' };
}
// 打开某封具体邮件的网页版（Outlook 用 deeplink 定位到这封，Gmail/Proton 用存的链接）
async function openMessage(accountId, messageId) {
  const { accounts = [] } = await chrome.storage.local.get(['accounts']);
  const acc = accounts.find(a => a.id === accountId);
  if (!acc) return { ok: false, error: '没找到这个账号' };
  const m = (acc.messages || []).find(x => x.id === messageId);
  let url = '';
  if (acc.provider === 'outlook' && messageId) url = outlookMessageUrl(acc, messageId);
  else if (m && m.link) url = m.link;
  else url = PROVIDER_META[acc.provider].inbox(acc);
  await chrome.tabs.create({ url });
  return { ok: true };
}

// 验证码提取（Peekat 思路）：
// 1) 先找“验证码/verification code/OTP”这类词附近的 4-8 位数字（词在前或在后都行）；
// 2) 没有关键词时，找独立的 4-8 位数字，但排除年份（1900-2099，之前把 2025 当验证码就是这么来的），
//    优先 6 位（最常见的验证码长度）。
// 注意：列表里只扫标题+摘要，正文里的码要靠读正文时再提（见 mmn-gmail-body / mmn-outlook-body）。
function extractCode(text) {
  if (!text) return null;
  // v1.15.55：先去掉邮箱地址和网址——里面的数字（QQ 号、订单号等）不是验证码。
  // 如 56959566@qq.com 里的 56959566 曾被误认成验证码。
  const t = String(text)
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ');
  const KW = '(?:验证码|驗證碼|verification\\s*code|verify\\s*code|otp|one[\\s-]?time(?:\\s*pass)?\\s*code|动态码|动态密码|校验码|确认码|安全码|auth(?:entication)?\\s*code|login\\s*code|sign[\\s-]?in\\s*code|code)';
  let m = t.match(new RegExp(KW + '[^0-9]{0,20}([0-9]{4,8})\\b', 'i'));
  if (m) return m[1];
  m = t.match(new RegExp('\\b([0-9]{4,8})\\b[^0-9]{0,20}' + KW, 'i'));
  if (m) return m[1];
  // v1.15.55：删掉无关键词兜底——以前没关键词也抓任意 4-8 位数字，
  // 会把 QQ 号、订单号、金额等误认成验证码。只认关键词附近的数字。
  return null;
}

async function getSettings() {
  const r = await chrome.storage.local.get(['settings']);
  return { ...DEFAULT_SETTINGS, ...(r.settings || {}) };
}

async function getAccounts() {
  const r = await chrome.storage.local.get(['accounts']);
  return Array.isArray(r.accounts) ? r.accounts : [];
}

async function saveAccounts(accounts) {
  await chrome.storage.local.set({ accounts });
}
// v1.15.0：写回前重读合并——checkAll 从读列表到写回要几秒（发现 Gmail 要扫 5 个 Atom），
// 期间设置页加了账号会被旧列表覆盖掉，删了账号的也不能复活。
// 用法：next 是本次检查/操作后的列表；返回合并后的最终列表。
async function saveAccountsMerged(next) {
  const current = await getAccounts();
  const currentById = new Map(current.map(a => [a.id, a]));
  const currentIds = new Set(current.map(a => a.id));
  // v1.15.17：手动设的槽位（slotOverride）不能被后台定时检查的旧写回抹掉。
  // checkAll 先读了账号、用户随后在设置页改了槽位、checkAll 再用旧 next 写回时，
  // next 里 slotOverride 是 undefined（字段根本不存在），要从当前存储里补回来；
  // 用户显式改回“自动”时存的是 null，那时就用 null（不补）。
  const merged = next.filter(a => currentIds.has(a.id)).map(a => {
    const cur = currentById.get(a.id);
    if (cur && a.slotOverride === undefined && cur.slotOverride !== undefined) {
      return { ...a, slotOverride: cur.slotOverride };
    }
    return a;
  });
  for (const a of current) if (!merged.some(x => x.id === a.id)) merged.push(a);
  await saveAccounts(merged);
  return merged;
}

// ---------- v1.4 诊断日志：每次检查都记一行，只存本地，绝不记 token / 请求头的值 ----------
// 格式：时间 账号（label/host） 方法 结果
// 设置页“诊断”区能看、能复制、能清空；你装好后把复制的日志贴给我，我就能直接看出
// token 有没有拿到、后台查返回了什么状态码、解析到了未读数没有、还是要重新登录。
async function diagLog(line) {
  try {
    const r = await chrome.storage.local.get(['diagLog']);
    const log = Array.isArray(r.diagLog) ? r.diagLog : [];
    log.push(`${new Date().toLocaleString('zh-CN', { hour12: false })} ${line}`);
    await chrome.storage.local.set({ diagLog: log.slice(-100) });
  } catch { /* 日志写失败不影响查邮件 */ }
}

// ---------- Gmail：Atom 只留给“自动发现”找邮箱（service worker 里没有 DOMParser，用正则解析） ----------
// 查未读和写操作走 Gmail API，见 gmail-oauth.js 的 checkGmailAccount。
function parseAtom(xml) {
  const pick = (re) => { const m = xml.match(re); return m ? m[1].trim() : ''; };
  const fullcount = parseInt(pick(/<fullcount>(\d+)<\/fullcount>/), 10);
  // feed <title> 形如 "Gmail - Inbox for xxx@gmail.com"，以此识别账号
  const feedTitle = pick(/<feed[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/);
  const emailMatch = feedTitle.match(/([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/);
  const messages = [];
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];
  for (const e of entries.slice(0, 20)) {
    const get = (re) => { const m = e.match(re); return m ? m[1].replace(/<[^>]+>/g, '').trim() : ''; };
    const sender = get(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>/);
    const subject = get(/<title[^>]*>([\s\S]*?)<\/title>/);
    const summary = get(/<summary[^>]*>([\s\S]*?)<\/summary>/);
    const link = get(/<link[^>]*href="([^"]+)"/);
    const issued = get(/<issued>([\s\S]*?)<\/issued>/);
    messages.push({ sender, subject, summary, link, time: issued, code: extractCode(subject + ' ' + summary) });
  }
  return {
    unread: Number.isFinite(fullcount) ? fullcount : messages.length,
    email: emailMatch ? emailMatch[1] : '',
    messages,
  };
}

// Gmail 自动发现：扫 u/0..u/4，有 feed 且有邮箱地址的就认作一个账号
async function discoverGmailAccounts(existing) {
  const found = [];
  for (let idx = 0; idx <= 4; idx++) {
    if (existing.some(a => a.provider === 'gmail' && (a.index ?? 0) === idx)) continue;
    try {
      const res = await fetch(`https://mail.google.com/mail/u/${idx}/feed/atom`, { credentials: 'include' });
      if (!res.ok) continue;
      const xml = await res.text();
      if (!xml.includes('<feed')) continue;
      const parsed = parseAtom(xml);
      if (!parsed.email) continue;
      // u/2、u/3、u/4 没单独登录时 Google 会重定向回默认账号，feed 返回同一个邮箱——按邮箱去重，同一个邮箱只留一个
      if (existing.some(a => a.provider === 'gmail' && a.email && a.email.toLowerCase() === parsed.email.toLowerCase())) continue;
      if (found.some(a => a.email && a.email.toLowerCase() === parsed.email.toLowerCase())) continue;
      found.push({
        id: 'gmail-' + idx + '-' + Date.now(),
        provider: 'gmail', index: idx, email: parsed.email,
        label: parsed.email, enabled: true,
        unread: parsed.unread, messages: parsed.messages,
        status: 'ok', lastCheck: Date.now(),
      });
    } catch { /* 该 index 没登录就跳过 */ }
  }
  return found;
}

// ---------- 抓头：只剩 Proton ----------
// captured = { proton: {"0": {uid, accept, appversion, capturedAt}, ...} }
// 只存本地 chrome.storage.local；设置页只显示是否抓到，不显示头的值。
// v1.11.0：Outlook 的 x-owa-canary 抄头已删（改走 Graph OAuth），这里不再抄 Outlook。
async function getCaptured() {
  const r = await chrome.storage.local.get(['captured']);
  return { proton: (r.captured && r.captured.proton) || {} };
}
async function saveCaptured(captured) {
  await chrome.storage.local.set({ captured: { proton: captured.proton || {} } });
}
function headerValue(headers, name) {
  const h = (headers || []).find(x => x.name && x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}

if (chrome.webRequest && chrome.webRequest.onBeforeSendHeaders) {
  chrome.webRequest.onBeforeSendHeaders.addListener(async (details) => {
    try {
      const url = details.url || '';
      const headers = details.requestHeaders || [];
      if (!url.includes('mail.proton.me/api/mail/')) return;
      const uid = headerValue(headers, 'x-pm-uid');
      if (!uid) return;
      // Proton 账号序号从发请求的标签页 URL /u/<N>/ 来；拿不到就记 0
      let idx = '0';
      if (details.tabId >= 0) {
        try {
          const tab = await chrome.tabs.get(details.tabId);
          const tm = (tab.url || '').match(/\/u\/(\d+)/);
          if (tm) idx = tm[1];
        } catch { /* 标签页已关就按 0 记 */ }
      }
      const captured = await getCaptured();
      captured.proton[idx] = {
        uid, accept: headerValue(headers, 'accept') || 'application/vnd.protonmail.v1+json',
        appversion: headerValue(headers, 'x-pm-appversion') || 'web-mail@5.0.41.4',
        capturedAt: Date.now(),
      };
      await saveCaptured(captured);
    } catch { /* 抓头失败不影响浏览 */ }
  }, { urls: ['*://mail.proton.me/*'] },
  ['requestHeaders', 'extraHeaders']);
}

// ---------- Proton：重放 api/mail/v4/conversations（Email Notifier 同款） ----------
// v1.15.9：按封数算未读（跟标签页标题一致）。conversations 接口默认只回第一页，
// 旧的未读邮件不在第一页里就会漏数成 0；这里按 Page/PageSize 翻页，
// 把每页会话的 NumUnread 加起来就是收件箱未读总封数。最多翻 10 页，
// 超过会在日志里说明（这时数字可能比实际少）。
async function checkProtonAccount(acc) {
  const idx = String(acc.index ?? 0);
  const captured = await getCaptured();
  const creds = (captured.proton || {})[idx];
  if (!creds || !creds.uid) {
    await diagLog(`[${acc.label || 'Proton ' + idx}] 无凭证：打开一次 mail.proton.me 登录，等加载完会自动抄 x-pm-uid，之后后台调 conversations`);
    return { ...acc, status: 'need-tab', unread: acc.unread || 0, lastCheck: Date.now() };
  }
  const headers = {
    'x-pm-uid': creds.uid,
    'accept': creds.accept || 'application/vnd.protonmail.v1+json',
    'x-pm-appversion': creds.appversion || 'web-mail@5.0.41.4',
  };
  const PAGE = 100, MAX_PAGES = 10;
  let totalUnread = 0, unreadConvCount = 0, totalConvs = Infinity, fetched = 0, pages = 0;
  const unreadConvs = [];
  try {
    while (pages < MAX_PAGES) {
      const res = await fetch(`https://mail.proton.me/api/mail/v4/conversations?LabelID=0&Page=${pages}&PageSize=${PAGE}`, {
        method: 'GET', credentials: 'include', headers,
      });
      if (res.status === 401 || res.status === 403) { await diagLog(`[${acc.label || 'Proton ' + idx}] 后台查：HTTP ${res.status}，凭证过期，重开一次 mail.proton.me 重抄`); return { ...acc, status: 'need-tab', unread: acc.unread || 0, lastCheck: Date.now() }; }
      if (!res.ok) { await diagLog(`[${acc.label || 'Proton ' + idx}] 后台查：HTTP ${res.status}`); return { ...acc, status: 'error:' + res.status, unread: acc.unread || 0, lastCheck: Date.now() }; }
      const obj = await res.json();
      const list = Array.isArray(obj?.Conversations) ? obj.Conversations : [];
      if (typeof obj?.Total === 'number') totalConvs = obj.Total;
      fetched += list.length;
      for (const c of list) {
        const n = c.NumUnread || 0;
        if (n) {
          totalUnread += n;
          unreadConvCount++;
          if (unreadConvs.length < 10) unreadConvs.push(c);
        }
      }
      pages++;
      if (list.length === 0) break; // 没更多了
      if (fetched >= totalConvs) break; // 已盖过全部会话
    }
    // v1.15.0：把未读会话列出来（发件人/标题/链接），弹窗里能点、能标已读/归档/删除；
    // 正文是端到端加密的，后台解不开，点邮件还是打开网页版看。
    const messages = unreadConvs.map((c) => {
      const sender = (c.Senders && c.Senders[0]) || {};
      return {
        id: c.ID,
        sender: sender.Name || sender.Address || '',
        senderEmail: sender.Address || '',
        subject: c.Subject || '(无标题)',
        summary: (c.NumMessages || 1) > 1 ? `会话共 ${c.NumMessages} 封 · ${c.NumUnread} 封未读` : '',
        link: `https://mail.proton.me/u/${idx}/inbox/${c.ID}`,
      };
    });
    const capped = pages >= MAX_PAGES && fetched < totalConvs;
    await diagLog(`[${acc.label || 'Proton ' + idx}] 后台查：HTTP 200，未读 ${totalUnread} 封（${unreadConvCount} 个未读会话，翻了 ${pages} 页${capped ? '，会话太多只数了前 ' + fetched + ' 个' : ''}）`);
    return { ...acc, unread: totalUnread, messages, status: 'ok', lastCheck: Date.now() };
  } catch (e) {
    await diagLog(`[${acc.label || 'Proton ' + idx}] 后台查异常：${String(e?.message || e)}`);
    return { ...acc, status: 'error:' + (e?.message || 'fetch-failed'), lastCheck: Date.now() };
  }
}

// ---------- Proton 写操作：标已读 / 归档 / 删除 ----------
// 路径来自 Proton 开源 WebClients（packages/shared/lib/api/conversations.ts）：
// 标已读 PUT /mail/v4/conversations/read {IDs}；
// 归档/删除都是 PUT /mail/v4/conversations/label {LabelID, IDs}，
// 归档 LabelID='6'，删除是移到垃圾箱 LabelID='3'（可恢复；彻底删除是另一个接口，这里不用）。
// 跟查未读同一套抄头。401/403 -> 凭证过期，返回 need-tab（重开一次标签页重抄）。
async function protonApiCall(accountId, method, path, body) {
  const accounts = await getAccounts();
  const acc = accounts.find(a => a.id === accountId);
  const idx = String((acc && acc.index) ?? 0);
  const captured = await getCaptured();
  const creds = (captured.proton || {})[idx];
  if (!creds || !creds.uid) return { ok: false, error: 'need-tab' };
  try {
    const res = await fetch('https://mail.proton.me/api' + path, {
      method, credentials: 'include',
      headers: {
        'x-pm-uid': creds.uid,
        'accept': creds.accept || 'application/vnd.protonmail.v1+json',
        'x-pm-appversion': creds.appversion || 'web-mail@5.0.41.4',
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 401 || res.status === 403) {
      await diagLog(`[Proton 操作] HTTP ${res.status}，凭证过期，重开一次 mail.proton.me 重抄`);
      return { ok: false, error: 'need-tab' };
    }
    if (!res.ok) return { ok: false, error: 'HTTP ' + res.status };
    const obj = await res.json().catch(() => ({}));
    if (obj && obj.Code !== 1000) return { ok: false, error: 'Proton Code ' + obj.Code };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}
async function protonMarkRead(accountId, conversationId) {
  return protonApiCall(accountId, 'PUT', '/mail/v4/conversations/read', { IDs: [conversationId] });
}
async function protonArchive(accountId, conversationId) {
  return protonApiCall(accountId, 'PUT', '/mail/v4/conversations/label', { LabelID: '6', IDs: [conversationId] });
}
async function protonDelete(accountId, conversationId) {
  return protonApiCall(accountId, 'PUT', '/mail/v4/conversations/label', { LabelID: '3', IDs: [conversationId] });
}

// ---------- 汇总 / 徽标 / 通知 ----------
async function updateBadge(accounts) {
  const settings = await getSettings();
  const total = accounts.filter(a => a.enabled !== false && a.status === 'ok')
    .reduce((s, a) => s + (a.unread || 0), 0);
  await chrome.action.setBadgeText({ text: total > 0 ? (total > 99 ? '99+' : String(total)) : '' });
  await chrome.action.setBadgeBackgroundColor({ color: settings.badgeColor || '#d93025' });
  await chrome.action.setTitle({ title: total > 0 ? `Multi Mail Notifier — ${total} 封未读` : 'Multi Mail Notifier — 没有未读' });
}

function beep() {
  // service worker 里没有 Audio；用 chrome.tts 不合适，这里用 offscreen 太重，
  // v1 的 sound 用 notifications 的默认提示音代替（Chrome 通知自带声音跟随系统）。
  // 保留开关位，v2 再加 offscreen 音频。
}

function inQuietHours(settings) {
  if (!settings.quietHours) return false;
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const parse = (s) => { const [h, m] = (s || '00:00').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
  const start = parse(settings.quietStart), end = parse(settings.quietEnd);
  return start <= end ? (mins >= start && mins < end) : (mins >= start || mins < end);
}
async function notifyIfIncreased(oldAccounts, newAccounts) {
  const settings = await getSettings();
  if (!settings.desktopNotif) return;
  if (inQuietHours(settings)) return; // 免打扰时段：只记数，不弹通知
  for (const next of newAccounts) {
    if (next.enabled === false || next.status !== 'ok') continue;
    const prev = oldAccounts.find(a => a.id === next.id);
    const prevUnread = prev ? (prev.unread || 0) : 0;
    if ((next.unread || 0) <= prevUnread) continue;
    const fresh = (next.messages || []).slice(0, 3);
    // onlyImportant：只报含验证码的
    const toShow = settings.onlyImportant ? fresh.filter(m => m.code) : fresh;
    if (settings.onlyImportant && toShow.length === 0) continue;
    const first = toShow[0] || fresh[0];
    if (!first) continue;
    const body = first.code
      ? `${first.sender || ''}：${first.subject || ''}\n验证码：${first.code}（点弹窗可一键复制）`
      : `${first.sender || ''}：${first.subject || ''}`;
    try {
      await chrome.notifications.create('mmn-' + next.id + '-' + Date.now(), {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: `${PROVIDER_META[next.provider]?.name || next.provider} · ${next.label || next.email || ''} 有 ${next.unread - prevUnread} 封新邮件`,
        message: body,
        priority: 2,
      });
    } catch { /* 通知权限被关就静默 */ }
    if (settings.sound) beep();
  }
}

// ---------- Outlook 去重：启动时按邮箱小写去重，同一邮箱只留一行 ----------
// 优先留有有效 token 的那行，其次留状态 ok 的，最后留最近检查过的；多余的删掉并记一行日志。
// 没填邮箱的行（还没登录过）不动，等登录后自动填邮箱，下次启动再去重。
async function dedupeOutlookAccounts(accounts) {
  const tokens = await getOutlookTokens();
  const rank = (a) => {
    const t = tokens[a.id];
    const hasToken = !!(t && (t.refresh_token || (t.access_token && t.expires_at > Date.now())));
    return (hasToken ? 2 : 0) + (a.status === 'ok' ? 1 : 0);
  };
  const best = new Map(); // emailLower -> account
  const drop = new Set();
  for (const a of accounts) {
    if (a.provider !== 'outlook') continue;
    const email = (a.email || '').trim().toLowerCase();
    if (!email) continue;
    if (!best.has(email)) { best.set(email, a); continue; }
    const cur = best.get(email);
    if (rank(a) > rank(cur)) { drop.add(cur.id); best.set(email, a); }
    else drop.add(a.id);
  }
  if (!drop.size) return accounts;
  const kept = accounts.filter(a => !drop.has(a.id));
  await saveAccounts(kept);
  await diagLog(`[Outlook 去重] 同一邮箱只留一行，删掉了 ${drop.size} 个重复行`);
  return kept;
}

async function checkAll({ discover = false } = {}) {
  let oldAccounts = await getAccounts();
  let accounts = await dedupeOutlookAccounts([...oldAccounts]);
  // 去重可能删了行，刷新 oldAccounts，避免通知比较时把被删的行当成“旧账号”
  oldAccounts = accounts;

  if (discover) {
    const found = await discoverGmailAccounts(accounts);
    if (found.length) accounts = [...accounts, ...found];
  }

  const next = [];
  for (const acc of accounts) {
    if (acc.enabled === false) { next.push(acc); continue; }
    if (acc.provider === 'gmail') {
      next.push(await checkGmailAccount(acc));
    } else if (acc.provider === 'outlook') {
      next.push(await checkOutlookAccount(acc)); // Graph API，见 outlook-oauth.js
    } else if (acc.provider === 'proton') {
      next.push(await checkProtonAccount(acc));
    } else if (acc.provider === 'custom') {
      continue; // v1.7：已不要自定义邮箱，这类账号不再检查
    } else {
      next.push(acc);
    }
  }

  const merged = await saveAccountsMerged(next);
  await updateBadge(merged);
  await notifyIfIncreased(oldAccounts, merged);
  return merged;
}

// ---------- 事件 ----------
async function dropCustomAccounts() {
  const accounts = await getAccounts();
  const kept = accounts.filter(a => a.provider !== 'custom');
  if (kept.length !== accounts.length) { await saveAccounts(kept); await diagLog('v1.7：已删除自定义邮箱账号（QQ/WX/163），只留 Gmail/Outlook/Proton'); }
}
// v1.11.0 升级：清掉旧版残留的隔离数据（isoTabs/isoJars）和 Outlook 抄头（captured.outlook）
async function dropLegacyOutlookData() {
  try {
    await chrome.storage.local.remove(['isoTabs', 'isoJars']);
    const r = await chrome.storage.local.get(['captured']);
    if (r.captured && r.captured.outlook) {
      const { outlook, ...rest } = r.captured;
      await chrome.storage.local.set({ captured: rest });
    }
  } catch { /* 清理失败不影响运行 */ }
}
// v1.15.5：v1.15.3 把 Outlook 默认切到雷鸟公开 ID 是错的——2026-11-18 在 live.com 端点实测，
// 雷鸟和 Peekat 的微软 ID 都不认我们的回调地址（invalid_request: redirect_uri is not valid），
// 只有自己的 Azure 应用认。把被 v1.15.3 迁到 thunderbird/peekat 的选择一次性迁回 own（只跑一次）。
async function migrateMsThunderbirdToOwn() {
  try {
    const r = await chrome.storage.local.get(['msClientIdChoice', 'msThunderbirdMigrated1155']);
    if (r.msThunderbirdMigrated1155) return;
    await chrome.storage.local.set({ msThunderbirdMigrated1155: true });
    if (r.msClientIdChoice === 'thunderbird' || r.msClientIdChoice === 'peekat') {
      await chrome.storage.local.set({ msClientIdChoice: 'own' });
      await diagLog('[Outlook] Client ID 已从公开 ID 切回自己的 Azure 应用（v1.15.5）：公开 ID 在 live.com 端点不认我们的回调地址，登不进去');
    }
  } catch { /* 迁移失败不影响运行 */ }
}
// v1.15.6：Google 也全部用自己的了。把以前存的 thunderbird/peekat 选择一次性迁回 own（只跑一次）。
async function migrateGooglePublicToOwn() {
  try {
    const r = await chrome.storage.local.get(['googleClientIdChoice', 'googlePublicMigrated1156']);
    if (r.googlePublicMigrated1156) return;
    await chrome.storage.local.set({ googlePublicMigrated1156: true });
    if (r.googleClientIdChoice === 'thunderbird' || r.googleClientIdChoice === 'peekat') {
      await chrome.storage.local.set({ googleClientIdChoice: 'own' });
      await diagLog('[Gmail] Client ID 已从公开 ID 切回自己的 Google 应用（v1.15.6）：公开 ID 在我们扩展上登不进去');
    }
  } catch { /* 迁移失败不影响运行 */ }
}
// v1.15.53：检查间隔改成 30 秒（0.5 分钟）。Chrome 重复闹钟最小 1 分钟，
// 所以 <1 分钟时用一次性闹钟连锁：响一次就再设下一个 delayInMinutes=0.5 的。
let checkRunning = false;
async function scheduleCheckAlarm() {
  const settings = await getSettings();
  const mins = settings.intervalMinutes || 0.5;
  await chrome.alarms.clear('mmn-check');
  if (mins >= 1) chrome.alarms.create('mmn-check', { periodInMinutes: mins });
  else chrome.alarms.create('mmn-check', { delayInMinutes: mins });
}
// 一次性迁移：老默认 1 分钟改成 0.5 分钟（只跑一次；用户后来在设置页改回 1 分钟不会被再改回去）
async function migrateIntervalToHalfMinute() {
  const data = await chrome.storage.local.get(['settings', 'intervalMigratedTo05']);
  if (data.intervalMigratedTo05) return;
  await chrome.storage.local.set({ intervalMigratedTo05: true });
  if (data.settings && data.settings.intervalMinutes === 1) {
    data.settings.intervalMinutes = 0.5;
    await chrome.storage.local.set({ settings: data.settings });
  }
}
chrome.runtime.onInstalled.addListener(async () => {
  await migrateMsThunderbirdToOwn();
  await migrateGooglePublicToOwn();
  await dropCustomAccounts();
  await dropLegacyOutlookData();
  await dedupeOutlookAccounts(await getAccounts());
  await migrateIntervalToHalfMinute();
  const settings = await getSettings();
  await chrome.storage.local.set({ settings });
  await scheduleCheckAlarm();
  await setupUpdateAlarm();
  // 首次安装：自动发现已登录的 Gmail 账号
  await checkAll({ discover: true });
});

chrome.runtime.onStartup.addListener(async () => {
  await migrateMsThunderbirdToOwn();
  await migrateGooglePublicToOwn();
  await dropCustomAccounts();
  await dropLegacyOutlookData();
  await dedupeOutlookAccounts(await getAccounts());
  await migrateIntervalToHalfMinute();
  const settings = await getSettings();
  await scheduleCheckAlarm();
  await setupUpdateAlarm();
  // v1.15.44：启动时如果开了自动检查、且上次检查超过 6 小时，就查一次新版本
  if (settings.autoUpdateCheck !== false) {
    try {
      const { updateInfo } = await chrome.storage.local.get(['updateInfo']);
      if (!updateInfo || !updateInfo.checkedAt || Date.now() - updateInfo.checkedAt > 6 * 3600 * 1000) {
        await checkForUpdate();
      }
    } catch {}
  }
  await checkAll({ discover: true });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'mmn-check') {
    // 一次性闹钟连锁：响完再设下一个；检查已在跑就跳过这次，避免重叠
    const settings = await getSettings();
    if ((settings.intervalMinutes || 0.5) < 1) await scheduleCheckAlarm();
    if (checkRunning) return;
    checkRunning = true;
    try { await checkAll({ discover: false }); } finally { checkRunning = false; }
  }
  if (alarm.name === 'mmn-update-check') checkForUpdate();
});

// content script（Proton 标签页）上报未读数
// v1.11.0：Outlook 不再走标签页上报（改走 Graph），收到 Outlook 上报直接忽略，不再自动新建账号行。
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'mmn-unread-report') return;
  if (msg.provider === 'outlook') {
    sendResponse({ ok: true, ignored: true });
    return;
  }
  (async () => {
    const accounts = await getAccounts();
    const idx = msg.index ?? 0;
    let acc;
    // Proton：有邮箱地址时按邮箱认账号，序号只作兜底
    if (msg.email) acc = accounts.find(a => a.provider === msg.provider && (a.email || '').toLowerCase() === msg.email.toLowerCase());
    if (!acc) {
      const byIdx = accounts.find(a => a.provider === msg.provider && (a.index ?? 0) === idx);
      // 序号那行已经是另一个邮箱了（主标签页切了账号）：不要把旧行改成新邮箱，留给下面新建一行
      if (byIdx && msg.email && byIdx.email && byIdx.email.toLowerCase() !== msg.email.toLowerCase()) acc = null;
      else acc = byIdx;
    }
    if (!acc) {
      acc = {
        id: `${msg.provider}-${msg.host || idx}-${Date.now()}`,
        provider: msg.provider, index: idx, host: msg.host || '', url: msg.url || '',
        email: msg.email || '', label: msg.label || `${PROVIDER_META[msg.provider]?.name || msg.provider} ${msg.host || (idx + 1)}`,
        enabled: true, unread: 0, messages: [], status: 'ok', lastCheck: Date.now(),
      };
      accounts.push(acc);
    }
    const autoLabel = /^(Outlook|Proton|Gmail) \d+$/.test(acc.label || '') || (acc.label || '') === (acc.email || '');
    const updated = {
      ...acc,
      lastTabId: (sender && sender.tab && sender.tab.id != null) ? sender.tab.id : acc.lastTabId,
      _tabOk: true,
      index: idx,
      email: msg.email || acc.email || '',
      label: (msg.email && autoLabel) ? msg.email : (acc.label || msg.label || msg.email || `${PROVIDER_META[msg.provider]?.name} ${idx + 1}`),
      unread: msg.unread || 0,
      messages: msg.messages || acc.messages || [],
      status: 'ok',
      lastCheck: Date.now(),
    };
    const next = accounts.map(a => a.id === acc.id ? updated : a);
    const merged = await saveAccountsMerged(next);
    await updateBadge(merged);
    await notifyIfIncreased(accounts, next);
    await diagLog(`[${updated.label || updated.host}] 标签页上报：未读 ${updated.unread}（${msg.provider}）`);
    sendResponse({ ok: true });
  })();
  return true; // 异步回复
});

// 弹窗 / 设置页发来的操作
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'mmn-check-now') return;
  checkAll({ discover: !!msg.discover }).then((accounts) => sendResponse({ ok: true, accounts }));
  return true;
});

// 弹窗 / 设置页发来的“打开收件箱”：按邮箱认标签页，切不过去才新开（见 openMailbox）
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'mmn-open-mailbox') return;
  openMailbox(msg.accountId).then(sendResponse);
  return true;
});

// 弹窗发来的“在网页版打开这封邮件”：Outlook 用 deeplink 定位到这封
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'mmn-open-message') return;
  openMessage(msg.accountId, msg.messageId).then(sendResponse);
  return true;
});

// 设置页发来的 Outlook 登录：跑 OAuth 流程，成功后马上用 Graph 查一次未读（不弹通知）
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'mmn-outlook-login') return;
  (async () => {
    const r = await startOutlookLogin(msg.accountId);
    if (!r.ok) { sendResponse({ ok: false, error: r.error }); return; }
    const accounts = await getAccounts();
    const acc = accounts.find(a => a.id === msg.accountId);
    if (acc) {
      const updated = await checkOutlookAccount(acc);
      const merged = await saveAccountsMerged(accounts.map(a => a.id === acc.id ? updated : a));
      await updateBadge(merged);
    }
    sendResponse({ ok: true, email: r.email });
  })();
  return true;
});

// 弹窗发来的 Outlook 操作：标已读 / 归档 / 删除（成功后重查一次刷新列表和未读数）
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'mmn-outlook-action') return;
  (async () => {
    const fn = { read: outlookMarkRead, archive: outlookArchive, delete: outlookDelete }[msg.action];
    if (!fn) { sendResponse({ ok: false, error: '未知操作' }); return; }
    const r = await fn(msg.accountId, msg.messageId);
    if (!r.ok) { sendResponse({ ok: false, error: r.error }); return; }
    // v1.14.0 安静标已读（点开邮件时自动标已读）：不重查、不改 badge，
    // 免得正读着弹窗列表被刷新掉；弹窗自己维护计数，下次定时检查再对齐
    if (msg.quiet) { sendResponse({ ok: true }); return; }
    const accounts = await getAccounts();
    const acc = accounts.find(a => a.id === msg.accountId);
    if (acc) {
      const updated = await checkOutlookAccount(acc);
      const next = accounts.map(a => a.id === acc.id ? updated : a);
      const merged = await saveAccountsMerged(next);
      await updateBadge(merged);
    }
    sendResponse({ ok: true });
  })();
  return true;
});

// 弹窗发来的 Outlook 回复 / 写邮件：带 messageId 就是回复，不带就是新写一封
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'mmn-outlook-send') return;
  (async () => {
    let r;
    if (msg.messageId) {
      r = await outlookReply(msg.accountId, msg.messageId, msg.body || '');
      // 回完顺手把原邮件标已读（失败也无所谓）
      if (r.ok) await outlookMarkRead(msg.accountId, msg.messageId).catch(() => {});
    } else {
      r = await outlookSend(msg.accountId, { to: msg.to || '', subject: msg.subject || '', body: msg.body || '' });
    }
    if (!r.ok) { sendResponse({ ok: false, error: r.error }); return; }
    // 回复会把原邮件标已读：重查一次刷新列表
    if (msg.messageId) {
      const accounts = await getAccounts();
      const acc = accounts.find(a => a.id === msg.accountId);
      if (acc) {
        const updated = await checkOutlookAccount(acc);
        const next = accounts.map(a => a.id === acc.id ? updated : a);
        const merged = await saveAccountsMerged(next);
        await updateBadge(merged);
      }
    }
    sendResponse({ ok: true });
  })();
  return true;
});

// 弹窗点开邮件读全文（只读，不触发重查；旧读权限的 token 也能读）
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'mmn-outlook-body') return;
  (async () => {
    const r = await getOutlookMessageBody(msg.accountId, msg.messageId);
    sendResponse(r.ok ? { ok: true, text: r.text, code: extractCode(r.text) } : { ok: false, error: r.error });
  })();
  return true;
});
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'mmn-gmail-body') return;
  (async () => {
    const r = await getGmailMessageBody(msg.accountId, msg.messageId);
    sendResponse(r.ok ? { ok: true, text: r.text, code: extractCode(r.text) } : { ok: false, error: r.error });
  })();
  return true;
});

// v1.15.53：正文翻译（Google 免费接口，无需 key；sl=auto 识源语言，tl=zh-CN 译成简体中文）
// 弹窗发 mmn-translate { text }，后台按段落分块（每块 ≤3800 字）逐块翻译，译文按原段落拼回。
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'mmn-translate') return;
  (async () => {
    try {
      const text = String(msg.text || '');
      if (!text.trim()) { sendResponse({ ok: false, error: '没有可翻译的正文' }); return; }
      sendResponse({ ok: true, text: await translateText(text) });
    } catch (e) {
      sendResponse({ ok: false, error: '翻译失败：' + (e && e.message ? e.message : '网络错误') });
    }
  })();
  return true;
});
async function translateText(text) {
  // 先按行切，单行超长再硬切成 ≤3800 的段
  const pieces = [];
  for (const line of text.split('\n')) {
    if (line.length <= 3800) { pieces.push(line); continue; }
    for (let i = 0; i < line.length; i += 3800) pieces.push(line.slice(i, i + 3800));
  }
  // 把行拼成 ≤3800 的块（尽量不断段）
  const chunks = [];
  let cur = '';
  for (const p of pieces) {
    if (cur && (cur + '\n' + p).length > 3800) { chunks.push(cur); cur = p; }
    else cur = cur ? cur + '\n' + p : p;
  }
  if (cur) chunks.push(cur);
  // 翻译接口优先级：clients5（POST，最抗限流）→ gtx（GET）→ MyMemory；
  // 一旦某接口失败就整篇切到下一个，不再每块都试。
  const providers = [translateViaClients5, translateViaGoogle, translateViaMyMemory];
  let providerIdx = 0;
  const out = [];
  for (const c of chunks) {
    let t = '';
    while (providerIdx < providers.length) {
      try { t = await providers[providerIdx](c); break; }
      catch (e) { providerIdx++; }
    }
    if (providerIdx >= providers.length) throw new Error('翻译失败：三个接口都不可用');
    out.push(t);
  }
  return out.join('\n');
}
// clients5 谷歌翻译接口（POST，client=dict-chrome-ex；无需 key；单次约 4500 字；返回 [["译文","源语言"]])
async function translateViaClients5(text) {
  const body = new URLSearchParams();
  body.set('sl', 'auto');
  body.set('tl', 'zh-CN');
  body.set('q', text);
  const r = await fetch('https://clients5.google.com/translate_a/t?client=dict-chrome-ex', { method: 'POST', body });
  if (!r.ok) throw new Error('clients5 HTTP ' + r.status);
  const data = await r.json();
  const t = data && data[0] && data[0][0];
  if (!t) throw new Error('clients5 返回异常');
  return t;
}
// Google 免费翻译接口（无需 key；sl=auto 识源语言）
async function translateViaGoogle(text) {
  const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&q=' + encodeURIComponent(text);
  const r = await fetch(url);
  if (!r.ok) throw new Error('Google HTTP ' + r.status);
  const data = await r.json();
  return data && data[0] ? data[0].map(s => (s && s[0]) || '').join('') : '';
}
// MyMemory 免费翻译兜底（无需 key；匿名每天 5000 字）。配额用完会回 429 或 WARNING 文本，都当失败抛掉。
async function translateViaMyMemory(text) {
  const url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text) + '&langpair=' + encodeURIComponent('auto|zh-CN');
  const r = await fetch(url);
  if (!r.ok) throw new Error('MyMemory HTTP ' + r.status);
  const data = await r.json();
  const t = data && data.responseData && data.responseData.translatedText;
  if (data.responseStatus !== 200 || !t || /MYMEMORY WARNING/i.test(t)) throw new Error('MyMemory 不可用');
  return t;
}

// 设置页发来的 Gmail 登录：跑 OAuth 流程，成功后马上用 Gmail API 查一次未读（不弹通知）
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'mmn-gmail-login') return;
  (async () => {
    const r = await startGmailLogin(msg.accountId);
    if (!r.ok) { sendResponse({ ok: false, error: r.error }); return; }
    const accounts = await getAccounts();
    const acc = accounts.find(a => a.id === msg.accountId);
    if (acc) {
      const updated = await checkGmailAccount(acc);
      const next = accounts.map(a => a.id === acc.id ? updated : a);
      const merged = await saveAccountsMerged(next);
      await updateBadge(merged);
    }
    sendResponse({ ok: true, email: r.email });
  })();
  return true;
});

// 弹窗发来的 Gmail 操作：标已读 / 归档 / 删除（成功后重查一次刷新列表和未读数）
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'mmn-gmail-action') return;
  (async () => {
    const fn = { read: gmailMarkRead, archive: gmailArchive, delete: gmailDelete }[msg.action];
    if (!fn) { sendResponse({ ok: false, error: '未知操作' }); return; }
    const r = await fn(msg.accountId, msg.messageId);
    if (!r.ok) { sendResponse({ ok: false, error: r.error }); return; }
    // v1.14.0 安静标已读（点开邮件时自动标已读）：不重查、不改 badge，
    // 免得正读着弹窗列表被刷新掉；弹窗自己维护计数，下次定时检查再对齐
    if (msg.quiet) { sendResponse({ ok: true }); return; }
    const accounts = await getAccounts();
    const acc = accounts.find(a => a.id === msg.accountId);
    if (acc) {
      const updated = await checkGmailAccount(acc);
      const next = accounts.map(a => a.id === acc.id ? updated : a);
      const merged = await saveAccountsMerged(next);
      await updateBadge(merged);
    }
    sendResponse({ ok: true });
  })();
  return true;
});

// v1.15.0：弹窗发来的 Proton 操作：标已读 / 归档 / 删除（成功后重查一次刷新列表和未读数）
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'mmn-proton-action') return;
  (async () => {
    const fn = { read: protonMarkRead, archive: protonArchive, delete: protonDelete }[msg.action];
    if (!fn) { sendResponse({ ok: false, error: '未知操作' }); return; }
    const r = await fn(msg.accountId, msg.messageId);
    if (!r.ok) { sendResponse({ ok: false, error: r.error }); return; }
    const accounts = await getAccounts();
    const acc = accounts.find(a => a.id === msg.accountId);
    if (acc) {
      const updated = await checkProtonAccount(acc);
      const next = accounts.map(a => a.id === acc.id ? updated : a);
      const merged = await saveAccountsMerged(next);
      await updateBadge(merged);
    }
    sendResponse({ ok: true });
  })();
  return true;
});

// 弹窗发来的 Gmail 回复 / 写邮件：带 messageId 就是回复，不带就是新写一封
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'mmn-gmail-send') return;
  (async () => {
    let r;
    if (msg.messageId) {
      r = await gmailReply(msg.accountId, msg.messageId, msg.body || '');
      // 回完顺手把原邮件标已读（失败也无所谓）
      if (r.ok) await gmailMarkRead(msg.accountId, msg.messageId).catch(() => {});
    } else {
      r = await gmailSend(msg.accountId, { to: msg.to || '', subject: msg.subject || '', body: msg.body || '' });
    }
    if (!r.ok) { sendResponse({ ok: false, error: r.error }); return; }
    // 回复会把原邮件标已读：重查一次刷新列表
    if (msg.messageId) {
      const accounts = await getAccounts();
      const acc = accounts.find(a => a.id === msg.accountId);
      if (acc) {
        const updated = await checkGmailAccount(acc);
        const next = accounts.map(a => a.id === acc.id ? updated : a);
        const merged = await saveAccountsMerged(next);
        await updateBadge(merged);
      }
    }
    sendResponse({ ok: true });
  })();
  return true;
});

// 诊断日志：设置页读 / 清空（只读本地日志，不含任何 token / 凭证值）
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;
  if (msg.type === 'mmn-get-diag') {
    chrome.storage.local.get(['diagLog']).then(r => sendResponse({ ok: true, log: r.diagLog || [] }));
    return true;
  }
  if (msg.type === 'mmn-clear-diag') {
    chrome.storage.local.set({ diagLog: [] }).then(() => sendResponse({ ok: true }));
    return true;
  }
  // v1.15.44：设置页“立即检查更新”
  if (msg.type === 'mmn-check-update-now') {
    checkForUpdate({ manual: true }).then(info => sendResponse({ ok: true, info })).catch(e => sendResponse({ ok: false, error: String(e && e.message || e) }));
    return true;
  }
});

chrome.notifications.onClicked.addListener((id) => {
  chrome.notifications.clear(id);
  // v1.15.44：点更新通知 → 打开 GitHub 发布页
  if (id && id.startsWith('mmn-update-')) {
    chrome.storage.local.get(['updateInfo']).then(r => {
      const url = r.updateInfo && r.updateInfo.releaseUrl;
      if (url) chrome.tabs.create({ url });
    }).catch(() => {});
    return;
  }
  chrome.action.openPopup?.();
});
