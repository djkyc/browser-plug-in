/**
 * Multi Mail Notifier — Gmail OAuth 中转 Worker（v1.15.61）
 *
 * 为什么需要它：
 * Google 的 Web 应用客户端拿 code / refresh_token 换 token 时强制要 client_secret，
 * 插件是公开客户端，secret 不能进插件包；“Chrome app” 类型客户端又只配合
 * chrome.identity.getAuthToken() 用，不走 launchWebAuthFlow，多账号后台自动查也对不上。
 * 所以换 token 这一步走这个 Worker 中转：插件只把 code / verifier / refresh_token 发来，
 * Worker 补上 secret 再转发给 Google，原样返回结果。secret 只存在 Worker 的 Secrets 里，
 * 不进插件包、不进日志、不返回给插件。
 *
 * 部署（Cloudflare Dashboard → Workers & Pages → Create → 贴这份代码）：
 * 1. 变量：到 Worker → Settings → Variables → 添加 Secret，名字 GOOGLE_CLIENT_SECRET，
 *    值填 Google Cloud Console 里那个 Web 应用 OAuth 客户端的 Client secret。
 *    （和插件里内置的 Client ID 940110558797-olvhdbr9e2cvua3dnalch1beui6tg8bo
 *    是同一对，ID 在插件里，secret 只在这里。）
 * 2. 触发器：用默认的 workers.dev 域名就行，记下地址
 *    https://<worker名>.<你的子域>.workers.dev ，填到插件设置页的
 *    “Gmail 中转 Worker 地址”里（或直接改 gmail-oauth.js 的 G_TOKEN_PROXY_DEFAULT）。
 * 3. 插件里 Gmail 重新登录一次，即可拿到 refresh_token，之后自动续，不用天天登。
 *
 * 安全：
 * - 只接受 POST + JSON；只转发 code / refresh_token 两种 grant_type。
 * - 不记录请求体、不记录返回体（token 只在内存里过一遍）。
 * - 建议在 Cloudflare 里给这个 Worker 开速率限制，防刷。
 */

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';


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
    const clientSecret = (env.GOOGLE_CLIENT_SECRET || '').trim();
    if (!clientSecret) {
      return corsJson({ error: 'server_error', error_description: 'Worker 没配 GOOGLE_CLIENT_SECRET' }, 500);
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
      // application/x-www-form-urlencoded；不要传 params.toString() 字符串，
      // 之前那样 Google 会把 body 当 JSON 解析而报错。
      upstream = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Accept': 'application/json' },
        body: params,
      });
    } catch (e) {
      return corsJson({ error: 'server_error', error_description: '连不上 Google token 接口：' + String((e && e.message) || e || '') }, 502);
    }
    const text = await upstream.text();
    // 原样返回 Google 的结果（状态码 + body），不改、不记日志
    return new Response(text, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  },
};
