/* Multi Mail Notifier v1.14.0 — Gmail API OAuth 模块（Peekat 方式）
 *
 * v1.14.0：弹窗里读全文——点邮件取 format=full 的正文（text/plain 优先，
 * 只有 HTML 就转文本），读完自动标已读、收起就从列表消失。
 * v1.15.4：Gmail 改走隐式流程（跟 Peekat 一样）——response_type=token，Google 直接把
 * access_token 放在回调地址的 #fragment 里返回，不拿 code 换 token，不要 client_secret，
 * 也不存 refresh_token。token 有效期约 1 小时，到期后台静默续（launchWebAuthFlow
 * interactive:false + prompt=none，浏览器里还登着 Google 就能直接拿到新 token，不弹窗；
 * 静默续失败才标需重新登录）。这样谁用都不用填密钥、不用建 Google Cloud 项目——Client ID
 * 是内置的（用户自己的 Google 应用 MultiMailNotifier），用户只点“登录”。
 * 之前 v1.13.0 的教训：Web 应用客户端拿 code 换 token 时 Google 强制要求 client_secret，
 * 隐式流程没有这一步，所以密钥问题彻底消失。代价：没有 refresh_token，全靠静默续。
 * v1.15.62：Gmail 改混用（抄 Checker Plus 的做法）——默认账号走
 * chrome.identity.getAuthToken()，Chrome 帮你管 token，不用 Worker、不用密钥、
 * 不用 refresh_token，登录一次长期有效；其他所有账号走 v1.15.61 的 PKCE + Worker +
 * refresh_token。分法按“是不是 Chrome 默认账号”：getProfileUserInfo() 读到的
 * 那个邮箱就是默认账号，其他账号一律走 Worker。写死账号数是大忌（插件要发布，
 * 别人可能有四五个号），所以代码里不写“1 号/2 号”，只认默认账号 vs 其他账号。
 * 为啥不能全部走 getAuthToken：Checker Plus 代码里写死第 2 个号走服务器，注释是
 * “Chrome sign in can only use default account”——getAuthToken 只能拿默认账号
 * 的 token，非默认账号拿不到（传 account 参数也不行，实测会串号/失败）。
 * getAuthToken 要一个“Chrome 扩展程序”类型的 OAuth 客户端（manifest 的 oauth2 段，
 * client_id 是 940110558797-2jrp985nahho6cce4j4sj6lv9pasi0ja，应用 ID 绑扩展 ID），
 * 跟 Web 应用那个客户端（940110558797-olvhdbr9e2cvua3dnalch1beui6tg8bo）是两个不同的
 * 客户端，别混了。Edge 上不支持 Chrome 登录那套，所有账号都走 Worker。
 * v1.15.61：Gmail 改走授权码 + PKCE + refresh token，长期有效（登录一次，不用天天登）。
 * 根因：Google 的 Web 应用客户端哪怕用 PKCE 换 token 也强制要 client_secret，插件存不了
 * 密钥；“Chrome app” 类型客户端又只配合 chrome.identity.getAuthToken() 用，不走
 * launchWebAuthFlow，多账号后台自动查也对不上。所以 code 换 token 不直连 Google，改走
 * 一个 Cloudflare Worker 中转（Worker 里存 client_secret，插件只发 code/verifier，
 * secret 永不进插件包）。Worker 拿到 refresh_token 后存本地，到期后台直接拿 refresh_token
 * 换新 access_token，不用再弹登录窗、不依赖浏览器里还登着 Google。
 * Worker 没配好之前自动回落到 v1.15.4 的隐式流程 + 静默续，老登录不受影响。
 * v1.15.6：全部用自己的——Google 下拉只剩“自己的 Google 应用”和“自定义”，雷鸟 / Peekat
 * 的 Google ID 已从代码和下拉里拿掉（它俩登不进去，留着只会误导）。
 * v1.13.2：Client ID 跟 Outlook 一样走设置页下拉内置——默认用自己的 Google 应用
 * MultiMailNotifier（940110558797-…apps.googleusercontent.com），另留“自定义”。
 *
 * 替代 v1.12.0 之前那套 Gmail Atom feed（只读）：Atom 只能读未读数，
 * 标已读/归档/删除/回邮件/写邮件全做不了。新路线走官方 Gmail API：
 * 1. （作者建好就行，用户不用管）Google Cloud 项目里开 Gmail API，建 OAuth 同意屏幕，
 *    建 OAuth 客户端（类型选 Web application，Authorized redirect URIs 填
 *    https://<扩展 ID>.chromiumapp.org/ ，就是设置页显示的 Google 回调地址），
 *    得到 Client ID（以 .apps.googleusercontent.com 结尾），内置在扩展里。
 * 2. 每个 Gmail 账号单独点“登录”：chrome.identity.launchWebAuthFlow 打开 Google 登录页，
 *    prompt=select_account + consent（强制选号），token 直接回在回调地址里，按账号存本地。
 * 3. 未读数走 GET /users/me/labels/INBOX（messagesUnread）；最近未读邮件走
 *    GET /users/me/messages?q=is:unread in:inbox，再逐封取 metadata（From/Subject/Date/Message-ID）。
 * 4. 写操作：标已读/归档走 POST /messages/{id}/modify（去 UNREAD/INBOX 标签），
 *    删除走 POST /messages/{id}/trash，回邮件/写邮件走 POST /messages/send（raw 是 RFC822 的 base64url）。
 *    旧 token 只有读权限时，未读照常查，但操作会提示重新登录授权一次（同 Outlook 的 needsRescope）。
 *
 * 安全：token 值只在 chrome.storage.local 里，永不写进诊断日志、永不在设置页显示。
 * 本文件只定义函数，不在加载时执行任何逻辑（background.js 用 importScripts 引入，
 * 在 outlook-oauth.js 之后；小工具 b64urlEncode / randomB64url / safeErrorText 复用
 * outlook-oauth.js 里的，不再重复定义）。
 */

const G_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
// v1.15.4：隐式流程没有换 token 这一步，不再调 oauth2.googleapis.com/token
// 内置默认 Google Client ID：用户自己的 Google 应用 MultiMailNotifier，
// 设置页下拉默认选它（与 outlook-oauth.js 里内置 Azure ID 一个做法；雷鸟的 ID 是微软的，Google 不能用）
const OWN_GOOGLE_CLIENT_ID = '940110558797-olvhdbr9e2cvua3dnalch1beui6tg8bo.apps.googleusercontent.com';
const G_API_BASE = 'https://gmail.googleapis.com/gmail/v1';
// v1.15.62：code / refresh_token 换 token 的中转 Worker 地址。Worker 里存着 Google
// Web 应用客户端的 client_secret，插件只把 code/verifier/refresh_token 发给它，
// 它补上 secret 再转发给 oauth2.googleapis.com/token，原样返回结果。
// 地址存在 storage（gmailTokenProxyUrl，设置页可填），没填 = 未配置，走隐式流程回落。
// v1.15.63：默认地址改成自定义域名 https://mmn-gmail-oauth.bit.indevs.in。
// 原来的 workers.dev 地址（mmn-gmail-oauth.dj-badboy.workers.dev）一直报 1101
// （请求到不了 Worker 代码，日志里一条记录都没有），删掉重建也没用；
// 改绑自定义域名后就正常了，workers.dev 也已关掉，只留自定义域名。
// 之前存的旧 workers.dev 地址会自动被新默认地址顶掉，不用用户手动改。
const G_TOKEN_PROXY_DEFAULT = 'https://mmn-gmail-oauth.bit.indevs.in';
const G_OAUTH_SCOPE = 'https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send';
// access_token 剩余有效期小于这个值就提前刷新
const G_TOKEN_REFRESH_MARGIN_MS = 120000;

// ---------- v1.15.62：Chrome Identity（getAuthToken） ----------
// 只给 Chrome 默认账号用。getProfileUserInfo() 读到的邮箱就是默认账号；
// 其他账号一律走 Worker（Checker Plus 也是这么分的，getAuthToken 拿不到非默认账号的 token）。
// getProfileUserInfo 要 identity.email 权限，没登 Chrome 或没给权限就返回空串，
// 那就所有账号都走 Worker，不会坏事。
let _chromeDefaultEmailCache = null; // '' = 已查过但没有，null = 还没查
async function getChromeDefaultEmail() {
  if (_chromeDefaultEmailCache !== null) return _chromeDefaultEmailCache;
  let email = '';
  try {
    if (chrome.identity && chrome.identity.getProfileUserInfo) {
      const info = await chrome.identity.getProfileUserInfo();
      email = String((info && info.email) || '').trim().toLowerCase();
    }
  } catch { email = ''; }
  _chromeDefaultEmailCache = email;
  return email;
}
// 这个 Gmail 账号是不是 Chrome 默认账号（邮箱对得上才算）。
// accountId -> 先读账号行的 email，读不到再读 gmailTokens 里存的 email。
async function isChromeDefaultGmail(accountId) {
  const defEmail = await getChromeDefaultEmail();
  if (!defEmail) return false;
  let email = '';
  try {
    const acc = (await getAccounts()).find(a => a.id === accountId);
    email = String((acc && acc.email) || '').trim().toLowerCase();
  } catch { /* getAccounts 失败就读 token */ }
  if (!email) {
    const t = (await getGmailTokens())[accountId];
    email = String((t && t.email) || '').trim().toLowerCase();
  }
  return !!email && email === defEmail;
}
// 拿 Chrome 管的 token。返回 { ok:true, token } 或 { ok:false, error }。
// interactive:true 会弹登录/授权窗（登录时用）；false 静默拿（后台查邮件时用）。
// Chrome 内部自己缓存 + 刷新，插件不用存 refresh_token，也不用管过期。
async function getChromeIdentityToken({ interactive }) {
  try {
    if (!chrome.identity || !chrome.identity.getAuthToken) return { ok: false, error: '当前浏览器不支持 chrome.identity' };
    const res = await chrome.identity.getAuthToken({ interactive: !!interactive, scopes: ['https://www.googleapis.com/auth/gmail.modify', 'https://www.googleapis.com/auth/gmail.send'] });
    const token = (res && res.token) || '';
    if (!token) return { ok: false, error: 'Chrome 没返回 token' };
    return { ok: true, token };
  } catch (e) {
    const msg = String((e && e.message) || e || '');
    return { ok: false, error: msg || 'getAuthToken 失败' };
  }
}
// token 失效（401）时把 Chrome 缓存里的这个 token 清掉，下次 getAuthToken 会重新拿。
async function removeChromeCachedToken(token) {
  try {
    if (token && chrome.identity && chrome.identity.removeCachedAuthToken) {
      await chrome.identity.removeCachedAuthToken({ token });
    }
  } catch { /* 清缓存失败不影响主流程 */ }
}

// ---------- 小工具 ----------
// 纯函数：拼授权 URL，方便测试（不依赖 chrome.identity）
// v1.15.4：隐式流程 response_type=token——token 直接回在回调地址的 #fragment 里，
// 不用 code_challenge / access_type=offline（没有换 token 这一步）；prompt 可传 'none' 供静默续用。
// v1.15.61：传了 challenge 就走授权码 + PKCE 流程——response_type=code，带 code_challenge
// （S256）和 access_type=offline，Google 才会发 refresh_token；prompt 默认
// 'select_account consent'（强制弹同意页，不然 Google 不发新的 refresh_token）。
function buildGmailAuthUrl({ clientId, redirectUri, state, loginHint, prompt, challenge }) {
  const u = new URL(G_AUTH_URL);
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('response_type', challenge ? 'code' : 'token');
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('scope', G_OAUTH_SCOPE);
  u.searchParams.set('state', state);
  u.searchParams.set('include_granted_scopes', 'true');
  if (challenge) {
    u.searchParams.set('code_challenge', challenge);
    u.searchParams.set('code_challenge_method', 'S256');
    u.searchParams.set('access_type', 'offline');
  }
  // select_account：强制选号；consent：确保新 scope 也拿到授权
  u.searchParams.set('prompt', prompt || 'select_account consent');
  if (loginHint) u.searchParams.set('login_hint', loginHint);
  return u.toString();
}
// 纯函数：解析授权码流程的回调地址（?code=...&state=...），方便测试
// 返回 { ok:true, code } 或 { ok:false, error }
function parseGmailAuthCode(redirectUrl, state) {
  let q = null;
  try { q = new URL(redirectUrl).searchParams; } catch { return { ok: false, error: '回调地址解析失败' }; }
  const err = q.get('error') || '';
  if (err) return { ok: false, error: 'Google 拒绝了登录：' + err };
  if ((q.get('state') || '') !== state) return { ok: false, error: '没拿到授权码或 state 对不上' };
  const code = q.get('code') || '';
  if (!code) return { ok: false, error: 'Google 没返回授权码' };
  return { ok: true, code };
}
// 纯函数：解析隐式流程的回调地址（#access_token=...&expires_in=...&scope=...&state=...），方便测试
// 返回 { ok:true, accessToken, expiresIn, scope } 或 { ok:false, error }
function parseImplicitToken(redirectUrl, state) {
  let frag = '';
  try { frag = new URL(redirectUrl).hash.slice(1); } catch { return { ok: false, error: '回调地址解析失败' }; }
  const p = new URLSearchParams(frag);
  const err = p.get('error') || '';
  if (err) return { ok: false, error: 'Google 拒绝了登录：' + err };
  if ((p.get('state') || '') !== state) return { ok: false, error: '没拿到 token 或 state 对不上' };
  const accessToken = p.get('access_token') || '';
  if (!accessToken) return { ok: false, error: 'Google 没返回 access_token' };
  return { ok: true, accessToken, expiresIn: parseInt(p.get('expires_in') || '3600', 10) || 3600, scope: p.get('scope') || '' };
}
// RFC822 头里非 ASCII（如中文主题）要编成 encoded-word，不然有的服务器会认错
function encodeGmailHeader(s) {
  const str = String(s || '');
  if (/^[\x00-\x7F]*$/.test(str)) return str;
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return '=?UTF-8?B?' + btoa(bin) + '?=';
}
// 纯函数：拼一封 RFC822 邮件，转 base64url（Gmail send 接口要的 raw 字段）
function buildGmailRaw({ to, subject, body, inReplyTo, references }) {
  const lines = [];
  if (to) lines.push('To: ' + to);
  if (subject) lines.push('Subject: ' + encodeGmailHeader(subject));
  lines.push('Content-Type: text/plain; charset="UTF-8"');
  lines.push('Content-Transfer-Encoding: 8bit');
  if (inReplyTo) lines.push('In-Reply-To: ' + inReplyTo);
  if (references) lines.push('References: ' + references);
  lines.push('', body || '');
  return b64urlEncode(new TextEncoder().encode(lines.join('\r\n')));
}
// 纯函数：Gmail API message 详情 -> 弹窗用的消息列表（带 ID + 回复用的 threadId/Message-ID）
function parseGmailMessages(details) {
  const list = Array.isArray(details) ? details : [];
  const header = (m, name) => {
    const h = (m.payload && Array.isArray(m.payload.headers))
      ? m.payload.headers.find(x => x && x.name && x.name.toLowerCase() === name.toLowerCase()) : null;
    return h ? (h.value || '') : '';
  };
  return list.slice(0, 10).map(m => {
    const from = header(m, 'From');
    const f = from.match(/^(?:"?([^"<]+)"?\s*)?<([^>]+)>$/);
    const sender = f ? (f[1] || f[2] || '').trim() : from;
    const senderEmail = f ? (f[2] || '') : (from.includes('@') ? from.trim() : '');
    const subject = header(m, 'Subject');
    const summary = String(m.snippet || '').replace(/\s+/g, ' ').trim();
    return {
      id: m.id || '',
      threadId: m.threadId || '',
      messageIdHeader: header(m, 'Message-ID'),
      sender,
      senderEmail,
      subject,
      summary,
      link: '',
      time: header(m, 'Date'),
      code: extractCode(subject + ' ' + summary),
    };
  });
}

// ---------- 存储：googleClientId / gmailTokens ----------
// gmailTokens = { [accountId]: { access_token, refresh_token, expires_at(ms), email, scope, silentFailAt, updated_at } }
// v1.15.4：隐式流程没有 refresh_token / clientId，token 过期靠静默续
// v1.15.61：配好 Worker 后登录会存 refresh_token，到期走 Worker 换新 access_token；
// 没配 Worker 的老账号仍走隐式流程 + 静默续。
// ---------- Worker 中转：code / refresh_token 换 token ----------
// 插件不直连 oauth2.googleapis.com/token（Web 应用客户端换 token 强制要 client_secret，
// 插件存不了），改发给 Worker；Worker 补上 secret 再转发，原样返回结果。
async function getGmailTokenProxyUrl() {
  const r = await chrome.storage.local.get(['gmailTokenProxyUrl']);
  let u = String(r.gmailTokenProxyUrl || G_TOKEN_PROXY_DEFAULT || '').trim().replace(/\/$/, '');
  // v1.15.63 迁移：之前存的旧 workers.dev 地址已关掉（一直报 1101），
  // 自动顶成新的自定义域名地址，不用用户手动改设置。
  if (u === 'https://mmn-gmail-oauth.dj-badboy.workers.dev') u = G_TOKEN_PROXY_DEFAULT;
  return u;
}
// 走 Worker 把授权码换成 token。返回 { ok:true, accessToken, refreshToken, expiresIn, scope }
// 或 { ok:false, error }。token 值只进 storage，永不写进诊断日志。
async function exchangeGmailCodeForTokens({ code, redirectUri, codeVerifier, clientId }) {
  const proxyUrl = await getGmailTokenProxyUrl();
  if (!proxyUrl) return { ok: false, error: '没配 Gmail 中转 Worker 地址' };
  let res, data;
  try {
    res = await fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: codeVerifier, client_id: clientId }),
    });
    data = await res.json().catch(() => ({}));
  } catch (e) {
    return { ok: false, error: '中转 Worker 请求失败：' + String((e && e.message) || e || '') };
  }
  if (!res.ok || data.error) return { ok: false, error: '换 token 失败：' + (data.error ? data.error + (data.error_description ? ': ' + data.error_description : '') : ('HTTP ' + res.status)) };
  if (!data.access_token) return { ok: false, error: '换 token 失败：没返回 access_token' };
  return { ok: true, accessToken: data.access_token, refreshToken: data.refresh_token || '', expiresIn: Number(data.expires_in) || 3600, scope: data.scope || '' };
}
// 走 Worker 拿 refresh_token 换新 access_token。返回同上（refresh_token 续发时可能为空，沿用旧的）。
async function refreshGmailAccessTokenViaProxy({ refreshToken, clientId }) {
  const proxyUrl = await getGmailTokenProxyUrl();
  if (!proxyUrl) return { ok: false, error: '没配 Gmail 中转 Worker 地址' };
  let res, data;
  try {
    res = await fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId }),
    });
    data = await res.json().catch(() => ({}));
  } catch (e) {
    return { ok: false, error: '中转 Worker 请求失败：' + String((e && e.message) || e || '') };
  }
  if (!res.ok || data.error) return { ok: false, error: '刷新 token 失败：' + (data.error ? data.error + (data.error_description ? ': ' + data.error_description : '') : ('HTTP ' + res.status)) };
  if (!data.access_token) return { ok: false, error: '刷新 token 失败：没返回 access_token' };
  return { ok: true, accessToken: data.access_token, refreshToken: data.refresh_token || '', expiresIn: Number(data.expires_in) || 3600, scope: data.scope || '' };
}
async function getGoogleClientId() {
  // v1.15.6：全部用自己的——下拉里只剩“自己的 Google 应用”和“自定义”，雷鸟 / Peekat 的
  // 公开 ID 已拿掉（它俩在我们扩展上登不进去，Google 只认注册在它名下的回调地址）。
  // 万一存的选择还是 thunderbird/peekat（v1.15.3–v1.15.5 留下的），也退回自己的。
  const r = await chrome.storage.local.get(['googleClientIdChoice', 'googleClientId']);
  const choice = r.googleClientIdChoice || '';
  if (choice === 'custom') return (r.googleClientId || '').trim() || OWN_GOOGLE_CLIENT_ID;
  return OWN_GOOGLE_CLIENT_ID;
}
// v1.15.6：雷鸟 / Peekat 的 Google Client ID 已从代码和下拉里拿掉（用户要求全部用自己的）。
// 它俩之前留在这里只是让用户看得到；实测都报 redirect_uri_mismatch，登不进去。
// v1.15.4：隐式流程不要密钥，getGoogleClientSecret 已删（以前存过的 googleClientSecret 还在
// storage 里躺着，无害，不再有人读它）。
async function getGmailTokens() {
  const r = await chrome.storage.local.get(['gmailTokens']);
  return r.gmailTokens || {};
}
async function saveGmailTokens(tokens) {
  await chrome.storage.local.set({ gmailTokens: tokens });
}
async function clearGmailAccessToken(accountId) {
  const tokens = await getGmailTokens();
  if (tokens[accountId]) {
    // v1.15.62：Chrome Identity 的账号还要把 Chrome 缓存里的 token 清掉，
    // 不然下次 getAuthToken 还会拿到同一个失效的 token。
    if (tokens[accountId].authMethod === 'chromeIdentity' && tokens[accountId].access_token) {
      await removeChromeCachedToken(tokens[accountId].access_token);
    }
    delete tokens[accountId].access_token;
    await saveGmailTokens(tokens);
  }
}

// ---------- 登录流程 ----------
// v1.15.62 混用：是 Chrome 默认账号就走 getAuthToken（Chrome 管 token，长期有效，
// 不用 Worker、不用密钥）；其他账号走 v1.15.61 的 PKCE + Worker（拿 refresh_token）。
// getAuthToken 拿不到非默认账号的 token，所以分法按默认账号 vs 其他账号，不写死账号数。
async function startGmailLogin(accountId) {
  const label = (await getAccounts()).find(a => a.id === accountId);
  const who = (label && (label.email || label.label)) || accountId;
  // 先看是不是 Chrome 默认账号：是就走 getAuthToken，不用 Web 客户端、不用 Worker。
  if (await isChromeDefaultGmail(accountId)) {
    const got = await getChromeIdentityToken({ interactive: true });
    if (!got.ok) {
      await diagLog(`[Gmail 登录] ${who}：Chrome 登录失败（${got.error}），改走 Worker 方式`);
      // getAuthToken 失败就回落到下面的 Worker/隐式流程，别直接报错
    } else {
      const accessToken = got.token;
      let email = '';
      try {
        const me = await fetch(G_API_BASE + '/users/me/profile', { headers: { 'Authorization': 'Bearer ' + accessToken, 'Accept': 'application/json' } });
        if (me.ok) {
          const d = await me.json();
          email = d.emailAddress || '';
        }
      } catch { /* profile 失败就用行里的邮箱 */ }
      const tokens = await getGmailTokens();
      tokens[accountId] = {
        access_token: accessToken,
        authMethod: 'chromeIdentity',
        // getAuthToken 不返回有效期，Chrome 自己管；这里只记个大约时间，
        // 真正过期由 getValidGmailAccessToken 每次调 getAuthToken 重新拿，不依赖这个值。
        expires_at: Date.now() + 3600 * 1000,
        email: email || '',
        scope: G_OAUTH_SCOPE,
        updated_at: Date.now(),
      };
      await saveGmailTokens(tokens);
      const accounts = await getAccounts();
      const acc = accounts.find(a => a.id === accountId);
      if (acc) {
        const autoLabel = !acc.label || /^Gmail \d+$/.test(acc.label) || acc.label === acc.email;
        const next = accounts.map(a => a.id === accountId ? {
          ...a,
          email: email || a.email || '',
          label: (email && autoLabel) ? email : (a.label || email || a.email || ''),
          status: 'ok',
          lastCheck: Date.now(),
        } : a);
        await saveAccounts(next);
      }
      await diagLog(`[Gmail 登录] ${email || who} 登录成功（Chrome 账号，Chrome 管 token，长期有效，不用天天登）`);
      return { ok: true, email: email || '' };
    }
  }
  const clientId = await getGoogleClientId();
  if (!clientId) {
    const err = '请先在设置页填 Google Client ID（Google Cloud Console 建的 OAuth 客户端 ID）';
    await diagLog(`[Gmail 登录] ${who}：${err}`);
    return { ok: false, error: err };
  }
  // v1.15.61：配好 Worker 就走授权码 + PKCE（拿 refresh_token，长期有效）；没配就走
  // v1.15.4 的隐式流程（不要密钥、不换 token，之前缺密钥就登不进去的问题彻底没了）。
  const redirectUri = chrome.identity.getRedirectURL(); // https://<扩展 ID>.chromiumapp.org/
  const state = randomB64url(16);
  const loginHint = String(who || '').includes('@') ? String(who) : '';
  const proxyUrl = await getGmailTokenProxyUrl();
  const usePkce = !!proxyUrl;
  let accessToken = '';
  let expiresIn = 3600;
  let refreshToken = '';
  let parsedScope = '';
  if (usePkce) {
    // PKCE：verifier 只在换 token 时发给 Worker，不进授权地址、不进日志
    const codeVerifier = await generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    const authUrl = buildGmailAuthUrl({ clientId, redirectUri, state, loginHint, challenge: codeChallenge });
    globalThis.__mmnLastGmailAuthUrl = authUrl; // 仅供诊断/测试读授权地址，不含任何 token
    let redirectUrl;
    try {
      redirectUrl = await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true });
    } catch (e) {
      const msg = String((e && e.message) || e || '未知错误');
      await diagLog(`[Gmail 登录] ${who}：登录窗口被关闭或失败（${msg}）`);
      return { ok: false, error: '登录窗口被关闭或失败：' + msg };
    }
    if (!redirectUrl) {
      await diagLog(`[Gmail 登录] ${who}：没拿到 Google 的回调地址`);
      return { ok: false, error: '没拿到 Google 的回调地址' };
    }
    const codeParsed = parseGmailAuthCode(redirectUrl, state);
    if (!codeParsed.ok) {
      await diagLog(`[Gmail 登录] ${who}：${codeParsed.error}`);
      return { ok: false, error: codeParsed.error };
    }
    const exchanged = await exchangeGmailCodeForTokens({ code: codeParsed.code, redirectUri, codeVerifier, clientId });
    if (!exchanged.ok) {
      await diagLog(`[Gmail 登录] ${who}：${exchanged.error}`);
      return { ok: false, error: exchanged.error };
    }
    accessToken = exchanged.accessToken;
    expiresIn = exchanged.expiresIn;
    refreshToken = exchanged.refreshToken;
    parsedScope = exchanged.scope;
    if (!refreshToken) {
      await diagLog(`[Gmail 登录] ${who}：Google 没发 refresh_token（可能之前已授权过且没强制弹同意页），这次只拿到短期 token；重新登录时会在同意页强制确认`);
    }
  } else {
    const authUrl = buildGmailAuthUrl({ clientId, redirectUri, state, loginHint });
    globalThis.__mmnLastGmailAuthUrl = authUrl; // 仅供诊断/测试读授权地址，不含任何 token
    let redirectUrl;
    try {
      redirectUrl = await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true });
    } catch (e) {
      const msg = String((e && e.message) || e || '未知错误');
      await diagLog(`[Gmail 登录] ${who}：登录窗口被关闭或失败（${msg}）`);
      return { ok: false, error: '登录窗口被关闭或失败：' + msg };
    }
    if (!redirectUrl) {
      await diagLog(`[Gmail 登录] ${who}：没拿到 Google 的回调地址`);
      return { ok: false, error: '没拿到 Google 的回调地址' };
    }
    // 隐式流程：token 直接回在回调地址的 #fragment 里（access_token/expires_in/scope），不用换 token
    const parsed = parseImplicitToken(redirectUrl, state);
    if (!parsed.ok) {
      await diagLog(`[Gmail 登录] ${who}：${parsed.error}`);
      return { ok: false, error: parsed.error };
    }
    accessToken = parsed.accessToken;
    expiresIn = parsed.expiresIn;
    parsedScope = parsed.scope;
  }
  // 邮箱：调 /users/me/profile 读 emailAddress
  let email = '';
  try {
    const me = await fetch(G_API_BASE + '/users/me/profile', { headers: { 'Authorization': 'Bearer ' + accessToken, 'Accept': 'application/json' } });
    if (me.ok) {
      const d = await me.json();
      email = d.emailAddress || '';
    }
  } catch { /* profile 失败就用行里的邮箱 */ }
  const tokens = await getGmailTokens();
  tokens[accountId] = {
    access_token: accessToken,
    authMethod: refreshToken ? 'worker' : 'implicit',
    // v1.15.61：PKCE 登录会存 refresh_token，到期走 Worker 换新 access_token；
    // 隐式流程没有 refresh_token，到期靠 silentGmailReauth 静默续；也不存 clientId（续登时用当前默认）
    ...(refreshToken ? { refresh_token: refreshToken } : {}),
    expires_at: Date.now() + expiresIn * 1000,
    email: email || '',
    scope: parsedScope || G_OAUTH_SCOPE,
    updated_at: Date.now(),
  };
  await saveGmailTokens(tokens);
  // 写回账号行：邮箱 + 状态
  const accounts = await getAccounts();
  const acc = accounts.find(a => a.id === accountId);
  if (acc) {
    const autoLabel = !acc.label || /^Gmail \d+$/.test(acc.label) || acc.label === acc.email;
    const next = accounts.map(a => a.id === accountId ? {
      ...a,
      email: email || a.email || '',
      label: (email && autoLabel) ? email : (a.label || email || a.email || ''),
      status: 'ok',
      lastCheck: Date.now(),
    } : a);
    await saveAccounts(next);
  }
  await diagLog(`[Gmail 登录] ${email || who} 登录成功，已拿到 token（有效期约 ${Math.round(expiresIn / 60)} 分钟${refreshToken ? '，已存 refresh_token，到期自动续，不用天天登' : '，到期自动静默续'}）`);
  return { ok: true, email: email || '' };
}

// ---------- 取有效的 access_token（到期自动续） ----------
// 返回 { accessToken, email, scope }；拿不到返回 null（调用方把账号标成 need-login）
// v1.15.62 混用：authMethod 是 chromeIdentity 的账号，每次都调 getAuthToken({interactive:false})
// 拿新 token（Chrome 内部缓存 + 自动刷新，插件不用管过期）；其他账号走原来的逻辑。
// v1.15.61：有 refresh_token 就走 Worker 换新 access_token（长期有效，不用天天登）；
// 没有 refresh_token 的老账号才走 v1.15.4 的静默续（launchWebAuthFlow interactive:false
// + prompt=none，不弹窗；浏览器里还登着 Google 就能直接拿到新 token；静默续失败也不刷日志——
// 等用户手动点登录，避免每分钟刷日志）
async function getValidGmailAccessToken(accountId) {
  const tokens = await getGmailTokens();
  const t = tokens[accountId];
  if (!t) return null;
  // Chrome Identity 账号：每次都找 Chrome 要个新 token（内部有缓存，过期它自己会续）。
  if (t.authMethod === 'chromeIdentity') {
    const got = await getChromeIdentityToken({ interactive: false });
    if (got.ok) {
      const tokens2 = await getGmailTokens();
      if (tokens2[accountId]) {
        tokens2[accountId] = {
          ...tokens2[accountId],
          access_token: got.token,
          // expires_at 只是估计值（getAuthToken 不返回有效期），下次照样调 getAuthToken
          expires_at: Date.now() + 3600 * 1000,
          updated_at: Date.now(),
        };
        await saveGmailTokens(tokens2);
      }
      return { accessToken: got.token, email: t.email || '', scope: G_OAUTH_SCOPE };
    }
    // 静默拿失败（授权被撤、没登 Chrome 等）：清掉 Chrome 缓存的旧 token，等用户手动点登录
    await removeChromeCachedToken(t.access_token || '');
    return null;
  }
  if (t.access_token && t.expires_at && t.expires_at - Date.now() > G_TOKEN_REFRESH_MARGIN_MS) {
    return { accessToken: t.access_token, email: t.email || '', scope: t.scope || '' };
  }
  // token 过期：有 refresh_token 先走 Worker 刷新；刷新失败才回落到静默续
  if (t.refresh_token) {
    const refreshed = await refreshGmailTokenWithCooldown(accountId, t);
    if (refreshed) return refreshed;
  }
  // 10 分钟内静默续失败过就先别试（省得每分钟都去撞一次 Google 授权页）
  if (t.silentFailAt && Date.now() - t.silentFailAt < 10 * 60 * 1000) return null;
  return await silentGmailReauth(accountId, t);
}

// 用 refresh_token 走 Worker 换新 access_token，带 10 分钟失败冷却。
// 成功返回 { accessToken, email, scope } 并写回 storage；失败返回 null。
async function refreshGmailTokenWithCooldown(accountId, t) {
  if (t.refreshFailAt && Date.now() - t.refreshFailAt < 10 * 60 * 1000) return null;
  const clientId = await getGoogleClientId();
  if (!clientId) return null;
  const r = await refreshGmailAccessTokenViaProxy({ refreshToken: t.refresh_token, clientId });
  const tokens = await getGmailTokens();
  if (!r.ok) {
    if (tokens[accountId]) {
      // refresh_token 失效（invalid_grant 等）就清掉它，下次走静默续/重新登录；别每分钟都撞 Worker
      const invalid = /invalid_grant|invalid_request/i.test(r.error || '');
      tokens[accountId] = {
        ...tokens[accountId],
        ...(invalid ? { refresh_token: '' } : {}),
        refreshFailAt: Date.now(),
      };
      await saveGmailTokens(tokens);
    }
    return null;
  }
  if (tokens[accountId]) {
    tokens[accountId] = {
      ...tokens[accountId],
      access_token: r.accessToken,
      // Worker 续发 refresh_token 时用新的，没发就沿用旧的
      refresh_token: r.refreshToken || tokens[accountId].refresh_token,
      expires_at: Date.now() + r.expiresIn * 1000,
      scope: r.scope || tokens[accountId].scope || '',
      refreshFailAt: 0,
      updated_at: Date.now(),
    };
    await saveGmailTokens(tokens);
  }
  return { accessToken: r.accessToken, email: t.email || '', scope: r.scope || t.scope || '' };
}

// 静默续 token：成功返回 { accessToken, email, scope } 并写回 storage；失败返回 null 并记 silentFailAt
async function silentGmailReauth(accountId, t) {
  const fail = async () => {
    const tokens = await getGmailTokens();
    if (tokens[accountId]) {
      tokens[accountId] = { ...tokens[accountId], silentFailAt: Date.now() };
      await saveGmailTokens(tokens);
    }
    return null;
  };
  const clientId = await getGoogleClientId();
  if (!clientId) return fail();
  const redirectUri = chrome.identity.getRedirectURL();
  const state = randomB64url(16);
  const authUrl = buildGmailAuthUrl({ clientId, redirectUri, state, loginHint: t.email || '', prompt: 'none' });
  let redirectUrl;
  try {
    redirectUrl = await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: false });
  } catch {
    return fail(); // 需要用户出面（Google 会话过期等）
  }
  if (!redirectUrl) return fail();
  const parsed = parseImplicitToken(redirectUrl, state);
  if (!parsed.ok) return fail();
  const tokens = await getGmailTokens();
  tokens[accountId] = {
    ...t,
    access_token: parsed.accessToken,
    expires_at: Date.now() + parsed.expiresIn * 1000,
    scope: parsed.scope || t.scope || '',
    silentFailAt: 0,
    updated_at: Date.now(),
  };
  await saveGmailTokens(tokens);
  return { accessToken: parsed.accessToken, email: t.email || '', scope: parsed.scope || t.scope || '' };
}

// ---------- Gmail 查未读：Gmail API ----------
// 替代 v1.12.0 之前的 Atom feed。返回更新后的账号对象。
async function checkGmailAccount(acc) {
  const who = acc.label || acc.email || 'Gmail';
  const tok = await getValidGmailAccessToken(acc.id);
  if (!tok) {
    return { ...acc, status: 'need-login', unread: acc.unread || 0, lastCheck: Date.now() };
  }
  // v1.15.20：别用字符串全等比 scope——Google 回来的 scope 顺序可能不一样
  // （比如先 send 后 modify），就算两个权限都有也会误判成缺权限。
  // 改成“包含 gmail.modify 和 gmail.send 两个权限就行”。
  const scopeSet = new Set(String(tok.scope || '').split(/\s+/).filter(Boolean));
  const needsRescope = !(scopeSet.has('https://www.googleapis.com/auth/gmail.modify') && scopeSet.has('https://www.googleapis.com/auth/gmail.send'));
  // 只在第一次发现 scope 旧了的时候记一行，别每分钟刷日志
  if (needsRescope && !acc.needsRescope) await diagLog(`[${who}] token 还是旧权限，未读照常查；回邮件/标已读要重新登录授权一次`);
  try {
    const res = await fetch(G_API_BASE + '/users/me/labels/INBOX', {
      headers: { 'Authorization': 'Bearer ' + tok.accessToken, 'Accept': 'application/json' },
    });
    if (res.status === 401) {
      await clearGmailAccessToken(acc.id);
      await diagLog(`[${who}] Gmail API 查未读：HTTP 401，token 失效，点“登录”重新登录`);
      return { ...acc, status: 'need-login', unread: acc.unread || 0, lastCheck: Date.now() };
    }
    if (!res.ok) {
      await diagLog(`[${who}] Gmail API 查未读：HTTP ${res.status}`);
      return { ...acc, status: 'error:' + res.status, unread: acc.unread || 0, lastCheck: Date.now() };
    }
    const data = await res.json();
    let unread = Number.isFinite(data.messagesUnread) ? data.messagesUnread : 0;
    // 最近未读邮件列表（带 ID，供弹窗里标已读/归档/删除/回复）
    let messages = acc.messages || [];
    try {
      const lres = await fetch(G_API_BASE + '/users/me/messages?q=' + encodeURIComponent('is:unread in:inbox') + '&maxResults=10', {
        headers: { 'Authorization': 'Bearer ' + tok.accessToken, 'Accept': 'application/json' },
      });
      if (lres.ok) {
        const ldata = await lres.json();
        const ids = (Array.isArray(ldata.messages) ? ldata.messages : []).slice(0, 10).map(m => m.id).filter(Boolean);
        const details = [];
        for (const id of ids) {
          try {
            const dres = await fetch(G_API_BASE + '/users/me/messages/' + encodeURIComponent(id) + '?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=Message-ID', {
              headers: { 'Authorization': 'Bearer ' + tok.accessToken, 'Accept': 'application/json' },
            });
            if (dres.ok) details.push(await dres.json());
          } catch { /* 单封取失败就跳过 */ }
        }
        // 给每封补上网页版链接（Gmail 网页版按 u/<序号> 分账号）
        const idx = acc.index ?? 0;
        messages = parseGmailMessages(details).map(m => ({
          ...m,
          link: m.id ? `https://mail.google.com/mail/u/${idx}/#inbox/${m.id}` : '',
        }));
      } else {
        await diagLog(`[${who}] Gmail API 取邮件列表：HTTP ${lres.status}，沿用旧列表`);
      }
    } catch (e) {
      await diagLog(`[${who}] Gmail API 取邮件列表异常：${String((e && e.message) || e)}，沿用旧列表`);
    }
    // v1.15.56：includeJunk 开时，连垃圾邮件（SPAM 标签）一起查（未读数加上，列表合并按时间倒序取前 10，带 spam 标记）
    if ((await getSettings()).includeJunk) {
      try {
        const sres = await fetch(G_API_BASE + '/users/me/labels/SPAM', {
          headers: { 'Authorization': 'Bearer ' + tok.accessToken, 'Accept': 'application/json' },
        });
        if (sres.ok) {
          const sdata = await sres.json();
          unread += Number.isFinite(sdata.messagesUnread) ? sdata.messagesUnread : 0;
        }
      } catch { /* SPAM 标签取不到就不算，不影响收件箱 */ }
      try {
        const lres = await fetch(G_API_BASE + '/users/me/messages?q=' + encodeURIComponent('is:unread in:spam') + '&maxResults=10', {
          headers: { 'Authorization': 'Bearer ' + tok.accessToken, 'Accept': 'application/json' },
        });
        if (lres.ok) {
          const ldata = await lres.json();
          const ids = (Array.isArray(ldata.messages) ? ldata.messages : []).slice(0, 10).map(m => m.id).filter(Boolean);
          const details = [];
          for (const id of ids) {
            try {
              const dres = await fetch(G_API_BASE + '/users/me/messages/' + encodeURIComponent(id) + '?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=Message-ID', {
                headers: { 'Authorization': 'Bearer ' + tok.accessToken, 'Accept': 'application/json' },
              });
              if (dres.ok) details.push(await dres.json());
            } catch { /* 单封取失败就跳过 */ }
          }
          const idx = acc.index ?? 0;
          const spamMsgs = parseGmailMessages(details).map(m => ({
            ...m,
            folder: 'spam',
            link: m.id ? `https://mail.google.com/mail/u/${idx}/#spam/${m.id}` : '',
          }));
          messages = [...messages, ...spamMsgs]
            .sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0))
            .slice(0, 10);
        } else {
          await diagLog(`[${who}] Gmail API 取垃圾邮件列表：HTTP ${lres.status}，只用收件箱列表`);
        }
      } catch (e) {
        await diagLog(`[${who}] Gmail API 取垃圾邮件列表异常：${String((e && e.message) || e)}，只用收件箱列表`);
      }
    }
    return { ...acc, unread, messages, needsRescope, status: 'ok', lastCheck: Date.now() };
  } catch (e) {
    await diagLog(`[${who}] Gmail API 查未读异常：${String((e && e.message) || e)}`);
    return { ...acc, status: 'error:' + ((e && e.message) || 'fetch-failed'), lastCheck: Date.now() };
  }
}

// ---------- v1.14.0：弹窗里读全文 ----------
// base64url -> UTF-8 字符串（atob 是 Latin-1，中文会乱码，所以走 TextDecoder）
function b64urlToUtf8(str) {
  try {
    const s = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
    const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
    const bin = atob(s + pad);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  } catch { return ''; }
}
// 从 format=full 的 payload 里取正文：优先 text/plain，没有就取 text/html 转文本
function extractGmailText(payload) {
  if (!payload) return '';
  const plains = [], htmls = [];
  (function walk(p) {
    if (!p) return;
    const mt = (p.mimeType || '').toLowerCase();
    const data = p.body && p.body.data;
    if (mt === 'text/plain' && data) plains.push(b64urlToUtf8(data));
    else if (mt === 'text/html' && data) htmls.push(b64urlToUtf8(data));
    (p.parts || []).forEach(walk);
  })(payload);
  if (plains.length) return plains.join('\n').trim();
  if (htmls.length) return htmlToText(htmls[0]);
  return '';
}
// 纯函数：format=full 的整封邮件 -> 正文文本（没有正文就退回 snippet）
function parseGmailFullMessage(detail) {
  if (!detail) return '';
  return extractGmailText(detail.payload) || detail.snippet || '';
}
// 只读，旧读权限的 token 也能读，不校验写 scope
async function getGmailMessageBody(accountId, messageId) {
  const tok = await getValidGmailAccessToken(accountId);
  if (!tok) return { ok: false, error: 'need-login' };
  try {
    const res = await fetch(`${G_API_BASE}/users/me/messages/${encodeURIComponent(messageId)}?format=full`, {
      headers: { 'Authorization': 'Bearer ' + tok.accessToken, 'Accept': 'application/json' },
    });
    if (res.status === 401) {
      await clearGmailAccessToken(accountId);
      return { ok: false, error: 'need-login' };
    }
    if (!res.ok) return { ok: false, error: 'HTTP ' + res.status + ' ' + (await safeErrorText(res)) };
    const data = await res.json();
    return { ok: true, text: parseGmailFullMessage(data) };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

// ---------- Gmail 写操作：标已读 / 归档 / 删除 / 回复 / 写邮件 ----------
// token 的 scope 是不是旧的
async function isGmailScopeStale(accountId) {
  const tokens = await getGmailTokens();
  const t = tokens[accountId];
  if (!t) return true;
  return (t.scope || '') !== G_OAUTH_SCOPE;
}

// Gmail API 写操作通用：成功 {ok:true}；
// 401 -> 清 access_token，返回 need-login；403 -> 权限不够，返回 need-rescope。
async function gmailApiCall(accountId, method, path, body) {
  const tok = await getValidGmailAccessToken(accountId);
  if (!tok) return { ok: false, error: 'need-login' };
  if ((tok.scope || '') !== G_OAUTH_SCOPE) return { ok: false, error: 'need-rescope' };
  try {
    const res = await fetch(G_API_BASE + path, {
      method,
      headers: { 'Authorization': 'Bearer ' + tok.accessToken, 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 401) {
      await clearGmailAccessToken(accountId);
      await diagLog(`[Gmail 操作] token 失效，点“登录”重新登录`);
      return { ok: false, error: 'need-login' };
    }
    if (res.status === 403) {
      await diagLog(`[Gmail 操作] HTTP 403：权限不够，Google 同意屏幕里加了 scope 后要重新登录一次`);
      return { ok: false, error: 'need-rescope' };
    }
    if (!res.ok) {
      const errText = await safeErrorText(res);
      return { ok: false, error: 'HTTP ' + res.status + ' ' + errText };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

async function gmailMarkRead(accountId, messageId) {
  return gmailApiCall(accountId, 'POST', `/users/me/messages/${encodeURIComponent(messageId)}/modify`, { removeLabelIds: ['UNREAD'] });
}
async function gmailArchive(accountId, messageId) {
  return gmailApiCall(accountId, 'POST', `/users/me/messages/${encodeURIComponent(messageId)}/modify`, { removeLabelIds: ['INBOX'] });
}
async function gmailDelete(accountId, messageId) {
  return gmailApiCall(accountId, 'POST', `/users/me/messages/${encodeURIComponent(messageId)}/trash`, {});
}
// 回复：从账号存的消息里找原邮件的 threadId / Message-ID / 发件人，同 thread 发出去
async function gmailReply(accountId, messageId, comment) {
  const accounts = await getAccounts();
  const acc = accounts.find(a => a.id === accountId);
  const orig = (acc && acc.messages || []).find(m => m.id === messageId);
  if (!orig) return { ok: false, error: '找不到原邮件' };
  const raw = buildGmailRaw({
    to: orig.senderEmail || '',
    subject: 'Re: ' + (orig.subject || ''),
    body: comment || '',
    inReplyTo: orig.messageIdHeader || '',
    references: orig.messageIdHeader || '',
  });
  const body = { raw };
  if (orig.threadId) body.threadId = orig.threadId;
  return gmailApiCall(accountId, 'POST', '/users/me/messages/send', body);
}
async function gmailSend(accountId, { to, subject, body }) {
  const toList = String(to || '').split(/[;,]/).map(s => s.trim()).filter(Boolean);
  if (!toList.length) return { ok: false, error: '收件人邮箱不对' };
  const raw = buildGmailRaw({ to: toList.join(', '), subject: subject || '', body: body || '' });
  return gmailApiCall(accountId, 'POST', '/users/me/messages/send', { raw });
}
