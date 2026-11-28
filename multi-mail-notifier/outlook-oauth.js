/* Multi Mail Notifier v1.12.0 — Outlook OAuth 模块（Peekat 方式）
 *
 * 彻底替代 v1.10.5 之前那套：service.svc 重放 + webRequest 抄头 + 标签页上报 +
 * CDP 调试器 cookie 隔离。那些全删了。
 *
 * 新路线（Peekat / Conterminal 同款，官方 Microsoft Graph）：
 * 1. 用户在 entra.microsoft.com 免费注册一个 Azure 应用（个人账户，不要钱不用卡），
 *    账户类型选“多租户 + 个人”，Redirect URI 用 Web 平台填
 *    https://<扩展 ID>.chromiumapp.org/microsoft（2026-11-23 从 SPA 改到 Web，
 *    refresh token 从 24 小时变 90 天），
 *    API 权限加 Mail.ReadWrite + Mail.Send + offline_access，得到 Application (client) ID。
 *    Web 平台是机密客户端，换 token 强制要 client_secret（v1.15.65 起走 Worker 中转，
 *    密钥只放 Worker 里，不进插件包）。
 * 2. Client ID 默认用 Thunderbird 的公开 client ID（实测验证过：用这个
 *    client_id + 本扩展的 redirect_uri 请求微软授权地址，返回正常登录页，
 *    没有 AADSTS50011 报错）。用户也可以在设置页换成自己的 Azure 应用
 *    client ID。代码里不写死任何 secret；换 token 走 Worker 中转（v1.15.65），
 *    Worker 里补 client_secret，插件本身不存 secret。
 * 3. 每个 Outlook 账号单独点“登录”：chrome.identity.launchWebAuthFlow 打开微软登录页，
 *    prompt=select_account 强制选号，避免 Windows 静默 SSO 直接登进最后一个号。
 *    拿 code 换 access_token + refresh_token，按账号存本地。
 * 4. 未读数走 Graph API：GET /me/mailFolders/inbox?$select=unreadItemCount；
 *    最近未读邮件列表走 GET /me/messages（带 Graph ID，供标已读/归档/删除/回复）。
 *    access_token 快过期时用 refresh_token 自动换；换不到就标“需重新登录”。
 * 5. v1.12.0：回邮件/标已读/归档/删除/写邮件走 Graph（Mail.ReadWrite + Mail.Send）。
 *    旧 token 只有 Mail.Read 时，未读照常查，但操作会提示重新登录授权一次。
 *
 * 安全：token 值只在 chrome.storage.local 里，永不写进诊断日志、永不在设置页显示。
 * 本文件只定义函数，不在加载时执行任何逻辑（background.js 用 importScripts 引入）。
 */

const MS_AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const MS_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const MS_GRAPH_ME_URL = 'https://graph.microsoft.com/v1.0/me?$select=userPrincipalName,mail,displayName';
const MS_GRAPH_INBOX_URL = 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox?$select=unreadItemCount';
// v1.15.85：不只查未读，查最近 20 封（不论已读未读），客户端留未读的 + 2 小时内新到的（见 isRecentMail）。
// v1.15.86：/me/messages 是全部文件夹，垃圾箱的信也会查到，和垃圾箱列表重复显示两遍。改成只查 inbox 文件夹。
const MS_GRAPH_MESSAGES_URL = 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$top=20&$select=id,from,subject,bodyPreview,receivedDateTime,isRead,webLink&$orderby=receivedDateTime desc';
// v1.15.56：垃圾邮件文件夹（includeJunk 开关开时一起查）
const MS_GRAPH_JUNK_URL = 'https://graph.microsoft.com/v1.0/me/mailFolders/junkemail?$select=unreadItemCount';
const MS_GRAPH_JUNK_MESSAGES_URL = 'https://graph.microsoft.com/v1.0/me/mailFolders/junkemail/messages?$top=20&$select=id,from,subject,bodyPreview,receivedDateTime,isRead,webLink&$orderby=receivedDateTime desc';
const MS_OAUTH_SCOPE = 'openid profile email offline_access Mail.ReadWrite Mail.Send';
// v1.15.81：微软发 token 回来的 scope 顺序不保证跟要的一样，字符串原样比对会误判成“权限不够”。
// 按集合比：拆空格、去重、排序再比（跟 gmail-oauth.js 里同名函数一个逻辑，两文件各存一份）。
function normalizeOAuthScope(s) {
  return [...new Set(String(s || '').split(/\s+/).filter(Boolean))].sort().join(' ');
}
function sameOAuthScope(a, b) {
  return normalizeOAuthScope(a) === normalizeOAuthScope(b);
}
// 默认 client ID：用户自己的 Azure 应用 MultiMailNotifier 的 client ID（public client，不含 secret）。
// Thunderbird 的公开 client ID 也留在设置页里可选（实测可用）。
// 设置页提供选择：自己的 Azure 应用（默认）/ Thunderbird 公开 ID / 自定义。
const OWN_MS_CLIENT_ID = '8aacd0db-eeba-4300-9a7d-70a3c1d684c3';
// v1.15.5：雷鸟（9e5f94bc…）和 Peekat（5343aed1…）的公开微软 ID 已从下拉里拿掉——
// 2026-11-18 在 login.live.com 端点实测，它俩都不认我们的回调地址
// （invalid_request: The provided value for the input parameter 'redirect_uri' is not valid），
// 只有自己的 Azure 应用认。之前 v1.15.3 说“微软对公开客户端回调放得宽”是错的：
// 当时只看了 login.microsoftonline.com 的初始登录页，那里不校验回调地址，
// 真正的校验在跳转到 live.com 之后才发生。
// access_token 剩余有效期小于这个值就提前刷新
const MS_TOKEN_REFRESH_MARGIN_MS = 120000;

// ---------- Worker 中转：code / refresh_token 换 token（v1.15.65） ----------
// Azure 回调从 SPA 改到 Web 平台后，refresh token 从 24 小时变 90 天，
// 但 Web 平台是机密客户端，换 token 强制要 client_secret（不带报 AADSTS70002），
// 插件是公开客户端存不了 secret，改发给 Worker；Worker 补上 secret 再转发，原样返回。
// 跟 Gmail 的 Worker 一个套路，域名不同：mmn-outlook-oauth.bit.indevs.in。
const MS_TOKEN_PROXY_DEFAULT = 'https://mmn-outlook-oauth.bit.indevs.in';
async function getMsTokenProxyUrl() {
  const r = await chrome.storage.local.get(['msTokenProxyUrl']);
  let u = String(r.msTokenProxyUrl || MS_TOKEN_PROXY_DEFAULT || '').trim().replace(/\/$/, '');
  return u;
}
// 走 Worker 把授权码换成 token。返回 { ok:true, accessToken, refreshToken, expiresIn, scope, idToken }
// 或 { ok:false, error }。token 值只进 storage，永不写进诊断日志。
async function exchangeMsCodeForTokens({ code, redirectUri, codeVerifier, clientId }) {
  const proxyUrl = await getMsTokenProxyUrl();
  if (!proxyUrl) return { ok: false, error: '没配 Outlook 中转 Worker 地址' };
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
  return { ok: true, accessToken: data.access_token, refreshToken: data.refresh_token || '', expiresIn: Number(data.expires_in) || 3600, scope: data.scope || '', idToken: data.id_token || '' };
}
// 走 Worker 拿 refresh_token 换新 access_token。返回同上（refresh_token 续发时可能为空，沿用旧的）。
async function refreshMsAccessTokenViaProxy({ refreshToken, clientId }) {
  const proxyUrl = await getMsTokenProxyUrl();
  if (!proxyUrl) return { ok: false, error: '没配 Outlook 中转 Worker 地址' };
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
  return { ok: true, accessToken: data.access_token, refreshToken: data.refresh_token || '', expiresIn: Number(data.expires_in) || 3600, scope: data.scope || '', idToken: data.id_token || '' };
}

// ---------- 小工具 ----------
function b64urlEncode(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecodeToString(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  return atob(s + pad);
}
// 邮件 HTML 正文转纯文本（弹窗里只显示文本，不渲染邮件 HTML，免得样式/脚本跑进来）
function htmlToText(html) {
  let s = String(html || '');
  s = s.replace(/<(script|style)[^>]*>[\s\S]*?<\/(script|style)>/gi, '');
  s = s.replace(/<(br|p|div|li|tr|h[1-6])[^>]*>/gi, '\n');
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/&nbsp;/gi, ' ').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&amp;/gi, '&')
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCharCode(+n); } catch { return ''; } })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => { try { return String.fromCharCode(parseInt(n, 16)); } catch { return ''; } });
  const lines = s.split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim());
  const out = [];
  for (const l of lines) { if (l === '' && out[out.length - 1] === '') continue; out.push(l); }
  return out.join('\n').replace(/^\n+|\n+$/g, '');
}
function randomB64url(byteLen) {
  return b64urlEncode(crypto.getRandomValues(new Uint8Array(byteLen)));
}
async function generateCodeVerifier() {
  // 64 随机字节 -> 86 字符，落在 PKCE 要求的 43~128 字符内
  return randomB64url(64);
}
async function generateCodeChallenge(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return b64urlEncode(new Uint8Array(digest));
}
// 纯函数：拼授权 URL，方便测试（不依赖 chrome.identity）
function buildOutlookAuthUrl({ clientId, redirectUri, state, challenge, loginHint }) {
  const u = new URL(MS_AUTH_URL);
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('scope', MS_OAUTH_SCOPE);
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('state', state);
  // 有邮箱就带上 login_hint：微软登录页直接显示这个号，不用再手动输邮箱
  if (loginHint) u.searchParams.set('login_hint', loginHint);
  // 关键：强制微软弹出选号页，否则静默 SSO 会直接登进 Windows 绑定的最后一个号
  u.searchParams.set('prompt', 'select_account');
  return u.toString();
}
function parseJwtEmail(idToken) {
  try {
    const parts = String(idToken || '').split('.');
    if (parts.length < 2) return '';
    const payload = JSON.parse(b64urlDecodeToString(parts[1]));
    return payload.preferred_username || payload.email || payload.upn || '';
  } catch { return ''; }
}
async function safeErrorText(res) {
  try {
    const data = await res.json();
    if (data && (data.error || data.error_description)) {
      // v1.13.1：error 和 error_description 都要，之前只取 error 会把 Google 的
      // 真正原因（如 client_secret is missing）丢掉，日志里只剩 invalid_request
      const e = String(data.error || '').trim();
      const d = String(data.error_description || '').trim();
      return (e && d && d !== e ? e + '：' + d : (e || d)).slice(0, 200);
    }
    return 'HTTP ' + res.status;
  } catch {
    return 'HTTP ' + res.status;
  }
}

// ---------- 存储：msClientId / outlookTokens ----------
// outlookTokens = { [accountId]: { access_token, refresh_token, expires_at(ms), email, updated_at } }
async function getMsClientId() {
  const r = await chrome.storage.local.get(['msClientId', 'msClientIdChoice']);
  const choice = r.msClientIdChoice || '';
  const stored = (r.msClientId || '').trim();
  if (choice === 'custom') return stored || OWN_MS_CLIENT_ID;
  // v1.15.5：默认和兜底都是自己的 Azure 应用。万一存的选择还是 thunderbird/peekat
  //（v1.15.3 迁过去的），也退回自己的——它俩在 live.com 端点登不进去。
  return OWN_MS_CLIENT_ID;
}
async function getOutlookTokens() {
  const r = await chrome.storage.local.get(['outlookTokens']);
  return r.outlookTokens || {};
}
async function saveOutlookTokens(tokens) {
  await chrome.storage.local.set({ outlookTokens: tokens });
}
async function clearOutlookAccessToken(accountId) {
  const tokens = await getOutlookTokens();
  if (tokens[accountId]) {
    delete tokens[accountId].access_token;
    await saveOutlookTokens(tokens);
  }
}

// ---------- 登录流程 ----------
async function startOutlookLogin(accountId) {
  const label = (await getAccounts()).find(a => a.id === accountId);
  const who = (label && (label.email || label.label)) || accountId;
  const clientId = await getMsClientId();
  if (!clientId) {
    const err = '请先在设置页填 Microsoft Client ID（Azure 应用注册的 Application (client) ID）';
    await diagLog(`[Outlook 登录] ${who}：${err}`);
    return { ok: false, error: err };
  }
  const redirectUri = chrome.identity.getRedirectURL('microsoft');
  const state = randomB64url(16);
  const verifier = await generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  // 行里的标签/邮箱就是要登的号，带过去让微软登录页直接显示它
  const loginHint = String(who || '').includes('@') ? String(who) : '';
  const authUrl = buildOutlookAuthUrl({ clientId, redirectUri, state, challenge, loginHint });
  globalThis.__mmnLastAuthUrl = authUrl; // 仅供诊断/测试读授权地址，不含任何 token
  let redirectUrl;
  try {
    redirectUrl = await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true });
  } catch (e) {
    const msg = String((e && e.message) || e || '未知错误');
    await diagLog(`[Outlook 登录] ${who}：登录窗口被关闭或失败（${msg}）`);
    return { ok: false, error: '登录窗口被关闭或失败：' + msg };
  }
  if (!redirectUrl) {
    await diagLog(`[Outlook 登录] ${who}：没拿到微软的回调地址`);
    return { ok: false, error: '没拿到微软的回调地址' };
  }
  let code = '', retState = '', errParam = '', errDesc = '';
  try {
    const u = new URL(redirectUrl);
    code = u.searchParams.get('code') || '';
    retState = u.searchParams.get('state') || '';
    errParam = u.searchParams.get('error') || '';
    errDesc = u.searchParams.get('error_description') || '';
  } catch {
    await diagLog(`[Outlook 登录] ${who}：回调地址解析失败`);
    return { ok: false, error: '回调地址解析失败' };
  }
  if (errParam) {
    await diagLog(`[Outlook 登录] ${who}：微软拒绝了登录（${errParam}${errDesc ? '：' + errDesc.slice(0, 100) : ''}）`);
    return { ok: false, error: '微软拒绝了登录：' + errParam };
  }
  if (!code || retState !== state) {
    await diagLog(`[Outlook 登录] ${who}：没拿到授权码或 state 对不上（可能被拦截）`);
    return { ok: false, error: '没拿到授权码或 state 对不上' };
  }
  // 拿 code 换 token：走 Worker 中转（v1.15.65；Web 平台强制要 client_secret，
  // 插件存不了，直接调微软会报 AADSTS70002）
  const exchanged = await exchangeMsCodeForTokens({ code, redirectUri, codeVerifier: verifier, clientId });
  if (!exchanged.ok) {
    await diagLog(`[Outlook 登录] ${who}：${exchanged.error}`);
    return { ok: false, error: exchanged.error };
  }
  const tokenData = { access_token: exchanged.accessToken, refresh_token: exchanged.refreshToken, expires_in: exchanged.expiresIn, scope: exchanged.scope, id_token: exchanged.idToken };
  // 邮箱：先从 id_token 读，拿不到再调 /me
  let email = parseJwtEmail(tokenData.id_token);
  if (tokenData.access_token) {
    try {
      const me = await fetch(MS_GRAPH_ME_URL, { headers: { 'Authorization': 'Bearer ' + tokenData.access_token, 'Accept': 'application/json' } });
      if (me.ok) {
        const d = await me.json();
        email = d.mail || d.userPrincipalName || email;
      }
    } catch { /* /me 失败就用 id_token 里的邮箱 */ }
  }
  const tokens = await getOutlookTokens();
  tokens[accountId] = {
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token || '',
    expires_at: Date.now() + (tokenData.expires_in || 3600) * 1000,
    email: email || '',
    scope: MS_OAUTH_SCOPE, // 登录时实际申请的 scope；v1.12.0 起含 Mail.ReadWrite + Mail.Send
    clientId, // 刷新时必须用发 token 时那个 clientId（微软不认换了 client 的 refresh_token），不能只认当前默认
    updated_at: Date.now(),
  };
  await saveOutlookTokens(tokens);
  // 写回账号行：邮箱 + 状态
  const accounts = await getAccounts();
  const acc = accounts.find(a => a.id === accountId);
  if (acc) {
    const autoLabel = !acc.label || /^Outlook \d+$/.test(acc.label) || acc.label === acc.email;
    const next = accounts.map(a => a.id === accountId ? {
      ...a,
      email: email || a.email || '',
      label: (email && autoLabel) ? email : (a.label || email || a.email || ''),
      status: 'ok',
      lastCheck: Date.now(),
    } : a);
    await saveAccounts(next);
  }
  await diagLog(`[Outlook 登录] ${email || who} 登录成功，已拿到 token（有效期约 ${Math.round((tokenData.expires_in || 3600) / 60)} 分钟，到期自动刷新）`);
  return { ok: true, email: email || '' };
}

// ---------- 取有效的 access_token（自动刷新） ----------
// 返回 { accessToken, email }；拿不到返回 null（调用方把账号标成 need-login）
async function getValidOutlookAccessToken(accountId) {
  const tokens = await getOutlookTokens();
  const t = tokens[accountId];
  if (!t) return null;
  if (t.access_token && t.expires_at && t.expires_at - Date.now() > MS_TOKEN_REFRESH_MARGIN_MS) {
    return { accessToken: t.access_token, email: t.email || '', scope: t.scope || '' };
  }
  if (!t.refresh_token) return null;
  // 刷新必须用发 token 时那个 clientId；老 token 没存 clientId 的，默认是自己的 Azure 应用
  //（v1.15.3 之前只有它成功登过），不能用当前默认，否则已登录的号会被顶掉
  const clientId = t.clientId || OWN_MS_CLIENT_ID;
  if (!clientId) return null;
  // 刷新也走 Worker 中转（v1.15.65；Web 平台强制要 client_secret，直接调微软会报 AADSTS70002）
  const refreshed = await refreshMsAccessTokenViaProxy({ refreshToken: t.refresh_token, clientId });
  if (!refreshed.ok) {
    const errText = refreshed.error || '';
    if (/invalid_grant/i.test(errText)) {
      // refresh_token 彻底失效（改密码/撤销授权）：删掉，下次重新登录
      delete tokens[accountId];
      await saveOutlookTokens(tokens);
      await diagLog(`[Outlook] ${t.email || accountId}：刷新 token 失败（${errText}），需重新登录`);
    } else {
      // 网络或临时错误：留着 refresh_token，下次再试
      await diagLog(`[Outlook] ${t.email || accountId}：刷新 token 失败（${errText}），下次重试`);
    }
    return null;
  }
  {
    const data = { access_token: refreshed.accessToken, refresh_token: refreshed.refreshToken, expires_in: refreshed.expiresIn, scope: refreshed.scope };
    tokens[accountId] = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || t.refresh_token,
      expires_at: Date.now() + (data.expires_in || 3600) * 1000,
      email: t.email || '',
      scope: t.scope || '', // 刷新不改变已授权的 scope；旧 scope 的 token 刷新后还是旧 scope
      clientId: t.clientId || OWN_MS_CLIENT_ID,
      updated_at: Date.now(),
    };
    await saveOutlookTokens(tokens);
    return { accessToken: data.access_token, email: t.email || '', scope: t.scope || '' };
  }
}

// ---------- Outlook 查未读：Graph API ----------
// 替代 v1.10.5 的 service.svc 重放。返回更新后的账号对象。
// v1.12.0：同时取最近未读邮件列表（带 Graph ID，供弹窗里标已读/归档/删除/回复）。
// token 的 scope 还是旧的（只有 Mail.Read）时，未读照常查，只标 needsRescope，
// 弹窗里做写操作时会提示重新登录授权一次。
async function checkOutlookAccount(acc) {
  const who = acc.label || acc.email || 'Outlook';
  const tok = await getValidOutlookAccessToken(acc.id);
  if (!tok) {
    return { ...acc, status: 'need-login', unread: acc.unread || 0, lastCheck: Date.now() };
  }
  const needsRescope = !sameOAuthScope(tok.scope || '', MS_OAUTH_SCOPE);
  // 只在第一次发现 scope 旧了的时候记一行，别每分钟刷日志
  if (needsRescope && !acc.needsRescope) await diagLog(`[${who}] token 还是旧权限（只有读），未读照常查；回邮件/标已读要重新登录授权一次`);
  try {
    const res = await fetch(MS_GRAPH_INBOX_URL, {
      headers: { 'Authorization': 'Bearer ' + tok.accessToken, 'Accept': 'application/json' },
    });
    if (res.status === 401) {
      // 刚换过的 token 还 401：清掉 access_token，下次重新登录
      await clearOutlookAccessToken(acc.id);
      await diagLog(`[${who}] Graph 查未读：HTTP 401，token 失效，点“登录”重新登录`);
      return { ...acc, status: 'need-login', unread: acc.unread || 0, lastCheck: Date.now() };
    }
    if (!res.ok) {
      await diagLog(`[${who}] Graph 查未读：HTTP ${res.status}`);
      return { ...acc, status: 'error:' + res.status, unread: acc.unread || 0, lastCheck: Date.now() };
    }
    const data = await res.json();
    let unread = Number.isFinite(data.unreadItemCount) ? data.unreadItemCount : 0;
    // 最近收到的邮件列表（带 Graph ID）；取不到就沿用旧列表，不影响未读数
    // v1.15.88：只留 24 小时内新到的（最新收到），不跟旧列表合并。
    const dismissed = new Set(Array.isArray(acc.dismissed) ? acc.dismissed : []);
    let fresh = [];
    try {
      const mres = await fetch(MS_GRAPH_MESSAGES_URL, {
        headers: { 'Authorization': 'Bearer ' + tok.accessToken, 'Accept': 'application/json' },
      });
      if (mres.ok) {
        const mdata = await mres.json();
        // v1.15.88：只留 24 小时内新到的（最新收到）；以前的未读不进列表。
        fresh = parseOutlookMessages(mdata).filter(m => isRecentMail(m.time));
      } else {
        await diagLog(`[${who}] Graph 取邮件列表：HTTP ${mres.status}，沿用旧列表`);
      }
    } catch (e) {
      await diagLog(`[${who}] Graph 取邮件列表异常：${String((e && e.message) || e)}，沿用旧列表`);
    }
    // v1.15.56：includeJunk 开时，连垃圾邮件文件夹一起查（未读数加上，列表合并按时间倒序取前 10，带 junk 标记）
    if ((await getSettings()).includeJunk) {
      try {
        const jres = await fetch(MS_GRAPH_JUNK_URL, {
          headers: { 'Authorization': 'Bearer ' + tok.accessToken, 'Accept': 'application/json' },
        });
        if (jres.ok) {
          const jdata = await jres.json();
          unread += Number.isFinite(jdata.unreadItemCount) ? jdata.unreadItemCount : 0;
        }
      } catch { /* 垃圾文件夹取不到就不算，不影响收件箱 */ }
      try {
        const jmres = await fetch(MS_GRAPH_JUNK_MESSAGES_URL, {
          headers: { 'Authorization': 'Bearer ' + tok.accessToken, 'Accept': 'application/json' },
        });
        if (jmres.ok) {
          const jmdata = await jmres.json();
          // v1.15.85：同上，留未读的 + 2 小时内新到的
          const junkMsgs = parseOutlookMessages(jmdata, 'junk').filter(m => isRecentMail(m.time));
          fresh = dedupeMessages([...fresh, ...junkMsgs])
            .sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0));
        } else {
          await diagLog(`[${who}] Graph 取垃圾邮件列表：HTTP ${jmres.status}，只用收件箱列表`);
        }
      } catch (e) {
        await diagLog(`[${who}] Graph 取垃圾邮件列表异常：${String((e && e.message) || e)}，只用收件箱列表`);
      }
    }
    const messages = dedupeMessages(fresh).filter(m => !dismissed.has(m.id))
      .sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0))
      .slice(0, 10);
    // v1.15.89：计数 = 列表里还没处理的新信数，不认服务器未读数（机器人取信标已读后服务器数是 0）。
    return { ...acc, unread: messages.length, messages, needsRescope, status: 'ok', lastCheck: Date.now() };
  } catch (e) {
    await diagLog(`[${who}] Graph 查未读异常：${String((e && e.message) || e)}`);
    return { ...acc, status: 'error:' + ((e && e.message) || 'fetch-failed'), lastCheck: Date.now() };
  }
}

// ---------- Outlook 写操作：标已读 / 归档 / 删除 / 回复 / 写邮件 ----------
// 纯函数：Graph /me/messages 返回值 -> 弹窗用的消息列表（带 Graph ID，供操作）
// folder 为 'junk' 时打上标记，弹窗里显示“垃圾”徽标
function parseOutlookMessages(data, folder) {
  const list = Array.isArray(data && data.value) ? data.value : [];
  return list.slice(0, 20).map(m => {
    const from = m.from && m.from.emailAddress;
    const sender = (from && (from.name || from.address)) || '';
    const subject = m.subject || '';
    const summary = String(m.bodyPreview || '').replace(/\s+/g, ' ').trim();
    return {
      id: m.id || '',
      sender,
      subject,
      summary,
      link: m.webLink || '',
      time: m.receivedDateTime || '',
      code: extractCode(subject + ' ' + summary),
      folder: folder || '',
      // v1.15.85：isRead 为 false 才是未读；已被机器人标已读但 2 小时内新到的照样显示。
      unread: !m.isRead,
    };
  });
}

// token 的 scope 是不是旧的（只有 Mail.Read，没含 Mail.ReadWrite/Mail.Send）
async function isOutlookScopeStale(accountId) {
  const tokens = await getOutlookTokens();
  const t = tokens[accountId];
  if (!t) return true;
  return !sameOAuthScope(t.scope || '', MS_OAUTH_SCOPE);
}

// Graph 写操作通用：成功 {ok:true}；
// 401 -> 清 access_token，返回 need-login；403 -> 权限不够，返回 need-rescope。
async function outlookGraphCall(accountId, method, url, body) {
  const tok = await getValidOutlookAccessToken(accountId);
  if (!tok) return { ok: false, error: 'need-login' };
  if (!sameOAuthScope(tok.scope || '', MS_OAUTH_SCOPE)) return { ok: false, error: 'need-rescope' };
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Authorization': 'Bearer ' + tok.accessToken, 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 401) {
      await clearOutlookAccessToken(accountId);
      await diagLog(`[Outlook 操作] token 失效，点“登录”重新登录`);
      return { ok: false, error: 'need-login' };
    }
    if (res.status === 403) {
      await diagLog(`[Outlook 操作] HTTP 403：权限不够，Azure 里加了 Mail.ReadWrite/Mail.Send 后要重新登录一次`);
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

const MS_GRAPH_MESSAGE_URL = (messageId) => `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(messageId)}`;

async function outlookMarkRead(accountId, messageId) {
  return outlookGraphCall(accountId, 'PATCH', MS_GRAPH_MESSAGE_URL(messageId), { isRead: true });
}
// v1.14.0：弹窗里读全文（只读，旧读权限的 token 也能读，不校验写 scope）
async function getOutlookMessageBody(accountId, messageId) {
  const tok = await getValidOutlookAccessToken(accountId);
  if (!tok) return { ok: false, error: 'need-login' };
  try {
    const res = await fetch(MS_GRAPH_MESSAGE_URL(messageId) + '?$select=body,subject,from,receivedDateTime,isRead', {
      headers: { 'Authorization': 'Bearer ' + tok.accessToken, 'Accept': 'application/json' },
    });
    if (res.status === 401) {
      await clearOutlookAccessToken(accountId);
      return { ok: false, error: 'need-login' };
    }
    if (!res.ok) return { ok: false, error: 'HTTP ' + res.status + ' ' + (await safeErrorText(res)) };
    const data = await res.json();
    const body = data.body || {};
    const text = (body.contentType || '').toLowerCase() === 'text'
      ? String(body.content || '')
      : htmlToText(body.content || '');
    return { ok: true, text: text || data.bodyPreview || '' };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}
async function outlookArchive(accountId, messageId) {
  return outlookGraphCall(accountId, 'POST', MS_GRAPH_MESSAGE_URL(messageId) + '/move', { destinationId: 'archive' });
}
async function outlookDelete(accountId, messageId) {
  return outlookGraphCall(accountId, 'DELETE', MS_GRAPH_MESSAGE_URL(messageId));
}
async function outlookReply(accountId, messageId, comment) {
  return outlookGraphCall(accountId, 'POST', MS_GRAPH_MESSAGE_URL(messageId) + '/reply', { comment: comment || '' });
}
async function outlookSend(accountId, { to, subject, body }) {
  const recipients = String(to || '').split(/[;,]/).map(s => s.trim()).filter(Boolean)
    .map(address => ({ emailAddress: { address } }));
  if (!recipients.length) return { ok: false, error: '收件人邮箱不对' };
  return outlookGraphCall(accountId, 'POST', 'https://graph.microsoft.com/v1.0/me/sendMail', {
    message: {
      subject: subject || '',
      body: { contentType: 'Text', content: body || '' },
      toRecipients: recipients,
    },
  });
}
