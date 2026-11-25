/**
 * Multi Mail Notifier — Outlook/Microsoft OAuth 中转 Worker（v1.15.65）
 *
 * 为什么需要它（跟 Gmail 的 Worker 一个道理）：
 * Outlook 的 Azure 回调从 SPA 改到 Web 平台后，refresh token 从 24 小时变 90 天，
 * 但 Web 平台是机密客户端，拿 code / refresh_token 换 token 时微软强制要 client_secret
 *（不带就报 AADSTS70002）。插件是公开客户端，secret 不能进插件包，
 * 所以换 token 这一步走这个 Worker 中转：插件只把 code / verifier / refresh_token 发来，
 * Worker 补上 secret 再转发给微软，原样返回结果。secret 只存在 Worker 的 Secrets 里，
 * 不进插件包、不进日志、不返回给插件。
 *
 * 部署（Cloudflare Dashboard → Workers & Pages → Create → 贴这份代码）：
 * 1. 变量：到 Worker → Settings → Variables → 添加 Secret，名字 MS_CLIENT_SECRET，
 *    值填 Azure 门户里 MultiMailNotifier 应用（appId 8aacd0db-eeba-4300-9a7d-70a3c1d684c3）
 *    的“证书和密码”里新建的客户端密码（Client secret）。
 *    （和插件里内置的 Client ID 8aacd0db-eeba-4300-9a7d-70a3c1d684c3 是同一对，
 *    ID 在插件里，secret 只在这里。）
 * 2. 自定义域名：给这个 Worker 绑一个自定义域名（不要用 workers.dev，会报 1101），
 *    例如 https://mmn-outlook-oauth.bit.indevs.in ，填到插件设置页的
 *    “Outlook 中转 Worker 地址”里（或直接改 outlook-oauth.js 的 MS_TOKEN_PROXY_DEFAULT）。
 * 3. 插件里 Outlook 重新登录一次，即可拿到 90 天的 refresh_token，之后自动续，不用天天登。
 *
 * 安全：
 * - 只接受 POST + JSON；只转发 code / refresh_token 两种 grant_type。
 * - 不记录请求体、不记录返回体（token 只在内存里过一遍）。
 * - 建议在 Cloudflare 里给这个 Worker 开速率限制，防刷。
 */

const MS_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';


// 跨域头：插件从 chrome-extension:// 域名发请求，浏览器会先发 OPTIONS 预检，
// Worker 必须回 Access-Control-Allow-Origin，否则请求被拦（v1.15.65 用户实机报 CORS 错）。
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
function corsJson(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== 'POST') {
      return corsJson({ error: 'method_not_allowed' }, 405);
    }
    let body;
    try {
      body = await request.json();
    } catch {
      return corsJson({ error: 'invalid_request', error_description: 'body 不是合法 JSON' }, 400);
    }
    const clientSecret = (env.MS_CLIENT_SECRET || '').trim();
    if (!clientSecret) {
      return corsJson({ error: 'server_error', error_description: 'Worker 没配 MS_CLIENT_SECRET' }, 500);
    }
    const clientId = String(body.client_id || '').trim();
    if (!clientId) {
      return corsJson({ error: 'invalid_request', error_description: '缺 client_id' }, 400);
    }
    const grantType = String(body.grant_type || '');
    const params = new URLSearchParams();
    params.set('client_id', clientId);
    params.set('client_secret', clientSecret);
    if (grantType === 'authorization_code') {
      const code = String(body.code || '');
      const redirectUri = String(body.redirect_uri || '');
      const verifier = String(body.code_verifier || '');
      if (!code || !redirectUri || !verifier) {
        return corsJson({ error: 'invalid_request', error_description: '授权码流程缺 code / redirect_uri / code_verifier' }, 400);
      }
      params.set('grant_type', 'authorization_code');
      params.set('code', code);
      params.set('redirect_uri', redirectUri);
      params.set('code_verifier', verifier);
    } else if (grantType === 'refresh_token') {
      const refreshToken = String(body.refresh_token || '');
      if (!refreshToken) {
        return corsJson({ error: 'invalid_request', error_description: '缺 refresh_token' }, 400);
      }
      params.set('grant_type', 'refresh_token');
      params.set('refresh_token', refreshToken);
    } else {
      return corsJson({ error: 'unsupported_grant_type', error_description: '只支持 authorization_code / refresh_token' }, 400);
    }
    let upstream;
    try {
      // 直接传 URLSearchParams 对象当 body，fetch 会自动把 Content-Type 设成
      // application/x-www-form-urlencoded；不要传 params.toString() 字符串。
      upstream = await fetch(MS_TOKEN_URL, {
        method: 'POST',
        headers: { 'Accept': 'application/json' },
        body: params,
      });
    } catch (e) {
      return corsJson({ error: 'server_error', error_description: '连不上微软 token 接口：' + String((e && e.message) || e || '') }, 502);
    }
    const text = await upstream.text();
    // 原样返回微软的结果（状态码 + body），不改、不记日志
    return new Response(text, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  },
};
