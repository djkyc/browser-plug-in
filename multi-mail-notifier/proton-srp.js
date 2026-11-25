/* Proton SRP 登录（v1.15.70）
 * 按 ProtonMail/go-srp（MIT）实现的客户端 SRP 变种，纯 JS：
 *  - 大数用原生 BigInt；SHA-512 用 Web Crypto（crypto.subtle）
 *  - 密码哈希用 bcryptjs（$2a$，ASCII 密码下与 Go 的 $2y$ 结果一致；输出前缀换回 $2y$ 再进 expandHash）
 *  - 全部数字均为小端（little-endian）字节序，与 go-srp 的 toInt/fromInt 一致
 *  - bitLength 固定 2048
 * 流程：auth/info → 算证明 → auth → 验 ServerProof →（2FA 时走 /2fa）→ 得 UID/AccessToken/RefreshToken
 * 之后 AccessToken 过期用 /auth/v4/refresh 自己续（见 refreshProtonToken）
 * 密码只在内存里用一次，绝不存 storage；只存 UID + AccessToken + RefreshToken。
 */
(function () {
  'use strict';

  const BIT_LENGTH = 2048;
  const BYTE_LEN = BIT_LENGTH / 8; // 256
  const PROTON_API = 'https://mail.proton.me/api';
  // appversion 用浏览器里抄到的真实版本；兜底用 2026-11-24 实测能过的 web-mail@5.0.142.3
  // 注意：不带 appversion 会 400（Code 5002），旧版 5.0.41.4 会 422（Code 5003），必须带一个较新的版本
  const FALLBACK_APP_VERSION = 'web-mail@5.0.142.3';
  let APP_VERSION = FALLBACK_APP_VERSION;
  function setAppVersion(v) { if (v) APP_VERSION = v; }
  const ACCEPT = 'application/vnd.protonmail.v1+json';

  // ---------- 字节 / BigInt ----------
  function leToBigInt(bytes) {
    let n = 0n;
    for (let i = bytes.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(bytes[i]);
    return n;
  }
  function bigIntToLE(n, len) {
    const out = new Uint8Array(len);
    let v = n;
    for (let i = 0; i < len; i++) { out[i] = Number(v & 0xffn); v >>= 8n; }
    return out;
  }
  function modPow(base, exp, mod) {
    let b = ((base % mod) + mod) % mod, e = exp, r = 1n;
    while (e > 0n) { if (e & 1n) r = (r * b) % mod; b = (b * b) % mod; e >>= 1n; }
    return r;
  }
  function mod(n, m) { const r = n % m; return r < 0n ? r + m : r; }
  function concatBytes(...arrs) {
    const total = arrs.reduce((s, a) => s + a.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const a of arrs) { out.set(a, off); off += a.length; }
    return out;
  }
  function b64encode(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  function b64decode(str) {
    const bin = atob(str);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function utf8bytes(str) { return new TextEncoder().encode(str); }

  // ---------- SHA-512 / expandHash ----------
  async function sha512(data) {
    const buf = await crypto.subtle.digest('SHA-512', data);
    return new Uint8Array(buf);
  }
  // expandHash：SHA512(data||0) || SHA512(data||1) || SHA512(data||2) || SHA512(data||3) = 256 字节
  async function expandHash(data) {
    const parts = [];
    for (let i = 0; i < 4; i++) {
      parts.push(await sha512(concatBytes(data, new Uint8Array([i]))));
    }
    return concatBytes(...parts);
  }

  // ---------- bcrypt base64 编码（字母表 ./A-Za-z0-9） ----------
  const BCRYPT_B64 = './ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  function bcryptB64Encode(bytes) {
    let out = '';
    let i = 0;
    while (i < bytes.length) {
      let c1 = bytes[i++];
      out += BCRYPT_B64[c1 >> 2];
      c1 = (c1 & 0x03) << 4;
      if (i >= bytes.length) { out += BCRYPT_B64[c1]; break; }
      let c2 = bytes[i++];
      c1 |= (c2 >> 4) & 0x0f;
      out += BCRYPT_B64[c1];
      c1 = (c2 & 0x0f) << 2;
      if (i >= bytes.length) { out += BCRYPT_B64[c1]; break; }
      c2 = bytes[i++];
      c1 |= (c2 >> 6) & 0x03;
      out += BCRYPT_B64[c1];
      out += BCRYPT_B64[c2 & 0x3f];
    }
    return out;
  }

  // ---------- 密码哈希（version 3/4） ----------
  // bcryptjs 的 UMD 挂在 self.dcodeIO.bcrypt 上，不是 self.bcrypt
  function getBcrypt() {
    if (typeof self !== 'undefined' && self.dcodeIO && self.dcodeIO.bcrypt) return self.dcodeIO.bcrypt;
    if (typeof bcrypt !== 'undefined') return bcrypt;
    throw new Error('SRP：bcrypt 没加载');
  }
  // go-srp hashPasswordVersion3：bcrypt(password, "$2y$10$" + b64(salt||"proton")) 再 expandHash(crypted || modulus)
  async function hashPasswordV3(password, saltBytes, modulusBytes) {
    const encodedSalt = bcryptB64Encode(concatBytes(saltBytes, utf8bytes('proton')));
    const saltStr = '$2a$10$' + encodedSalt;
    // bcryptjs 只出 $2a$；ASCII 密码下 $2a$ 与 Go 的 $2y$ 算出的哈希体相同，把前缀换回 $2y$ 再用
    const cryptedA = getBcrypt().hashSync(password, saltStr);
    const crypted = '$2y$' + cryptedA.slice(4);
    return expandHash(concatBytes(utf8bytes(crypted), modulusBytes));
  }

  // ---------- 从 PGP 明文签名里取出 base64 模数 ----------
  function extractModulus(signedModulus) {
    // 格式：-----BEGIN PGP SIGNED MESSAGE-----\nHash: ...\n\n<base64>\n-----BEGIN PGP SIGNATURE-----
    const lines = String(signedModulus || '').split(/\r?\n/);
    let start = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === '' && start < 0 && i > 0 && /BEGIN PGP SIGNED MESSAGE/.test(lines.slice(0, i).join('\n'))) { start = i + 1; break; }
    }
    if (start < 0) {
      // 没有签名头，直接当 base64 用
      const t = String(signedModulus || '').trim();
      if (/^[A-Za-z0-9+/=]+$/.test(t)) return b64decode(t);
      throw new Error('SRP：模数格式不对');
    }
    let b64 = '';
    for (let i = start; i < lines.length; i++) {
      if (/^-----BEGIN PGP SIGNATURE-----/.test(lines[i])) break;
      b64 += lines[i].trim();
    }
    if (!b64) throw new Error('SRP：模数为空');
    return b64decode(b64);
  }

  // ---------- SRP 证明（照 go-srp GenerateProofs） ----------
  function randomBigIntBelow(n) {
    // 在 [2*BIT_LENGTH, n) 内取随机数
    const bytes = new Uint8Array(BYTE_LEN);
    const lower = BigInt(BIT_LENGTH * 2);
    for (;;) {
      crypto.getRandomValues(bytes);
      const v = leToBigInt(bytes) % (n - 1n);
      if (v >= lower) return v;
    }
  }
  async function generateProofs(hashedPasswordBytes, modulusBytes, serverEphemeralBytes) {
    const N = leToBigInt(modulusBytes);
    const g = 2n;
    const Nminus1 = N - 1n;
    const B = leToBigInt(serverEphemeralBytes);
    if (B <= 1n || B >= Nminus1) throw new Error('SRP：服务器临时值越界');
    // k = H(g || N) mod N
    const kBytes = await expandHash(concatBytes(bigIntToLE(g, BYTE_LEN), bigIntToLE(N, BYTE_LEN)));
    const k = mod(leToBigInt(kBytes), N);
    if (k <= 1n || k >= Nminus1) throw new Error('SRP：乘数越界');
    const x = leToBigInt(hashedPasswordBytes);
    // a 与 A，u 不为 0 才收
    let a, Abytes, u;
    for (;;) {
      a = randomBigIntBelow(N);
      Abytes = bigIntToLE(modPow(g, a, N), BYTE_LEN);
      const uBytes = await expandHash(concatBytes(Abytes, serverEphemeralBytes));
      u = leToBigInt(uBytes);
      if (u !== 0n) break;
    }
    // S = (B - k*g^x) ^ (u*x + a) mod N
    const base = mod(B - mod(k * modPow(g, x, N), N), N);
    const exponent = mod(u * x + a, Nminus1);
    const Sbytes = bigIntToLE(modPow(base, exponent, N), BYTE_LEN);
    const M1 = await expandHash(concatBytes(Abytes, serverEphemeralBytes, Sbytes));
    const M2 = await expandHash(concatBytes(Abytes, M1, Sbytes));
    return { clientEphemeral: Abytes, clientProof: M1, expectedServerProof: M2 };
  }

  // ---------- API ----------
  async function protonApi(path, body, extraHeaders, noAppVersion) {
    const headers = { 'Content-Type': 'application/json', 'Accept': ACCEPT };
    if (!noAppVersion) headers['x-pm-appversion'] = APP_VERSION;
    Object.assign(headers, extraHeaders || {});
    const res = await fetch(PROTON_API + path, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let obj = null;
    try { obj = JSON.parse(text); } catch { /* 非 JSON */ }
    return { status: res.status, obj, text };
  }

  // SRP 登录：返回 { uid, accessToken, refreshToken }；2FA 时抛 { code:'NEED_2FA' }，调用方拿到 TOTP 再调 srpLogin2fa
  async function srpLogin(username, password) {
    // auth/info 被 422 拦时依次换路：/core 端点、再用实测能过的兜底版本（抄到的版本也可能已过期）
    let info = await protonApi('/auth/v4/info', { Username: username });
    if (info.status === 422) {
      const alt = await protonApi('/core/v4/auth/info', { Username: username });
      if (alt.status === 200 && alt.obj && alt.obj.Code === 1000) info = alt;
      else {
        const saved = APP_VERSION;
        APP_VERSION = FALLBACK_APP_VERSION;
        const fb = await protonApi('/auth/v4/info', { Username: username });
        if (fb.status === 200 && fb.obj && fb.obj.Code === 1000) info = fb;
        else {
          const fbAlt = await protonApi('/core/v4/auth/info', { Username: username });
          if (fbAlt.status === 200 && fbAlt.obj && fbAlt.obj.Code === 1000) info = fbAlt;
          else APP_VERSION = saved;
        }
      }
    }
    if (info.status !== 200 || !info.obj || info.obj.Code !== 1000) {
      throw new Error('SRP：auth/info 失败 HTTP ' + info.status + ' ' + (info.obj && info.obj.Error ? info.obj.Error : info.text.slice(0, 120)) + '（先去浏览器打开一次 mail.proton.me 再试）');
    }
    const { Modulus, ServerEphemeral, Version, Salt, SRPSession } = info.obj;
    const modulusBytes = extractModulus(Modulus);
    const saltBytes = b64decode(Salt);
    const serverEphemeralBytes = b64decode(ServerEphemeral);
    const version = Version || 4;
    let hashed;
    if (version >= 3) hashed = await hashPasswordV3(password, saltBytes, modulusBytes);
    else throw new Error('SRP：不支持的 auth version ' + version + '（只支持 3/4）');
    const proofs = await generateProofs(hashed, modulusBytes, serverEphemeralBytes);
    const auth = await protonApi('/auth/v4', {
      Username: username,
      ClientEphemeral: b64encode(proofs.clientEphemeral),
      ClientProof: b64encode(proofs.clientProof),
      SRPSession,
      Payload: {},
    });
    if (auth.status !== 200 || !auth.obj || auth.obj.Code !== 1000) {
      const err = (auth.obj && auth.obj.Error) || auth.text.slice(0, 120);
      throw new Error('SRP：auth 失败 HTTP ' + auth.status + ' ' + err);
    }
    const serverProofB64 = b64encode(proofs.expectedServerProof);
    if (auth.obj.ServerProof !== serverProofB64) throw new Error('SRP：服务器证明不符（密码可能错了）');
    const twoFA = auth.obj['2FA'] || auth.obj.TwoFactor;
    if (twoFA && twoFA.Enabled) {
      const e = new Error('SRP：需要两步验证');
      e.code = 'NEED_2FA';
      e.uid = auth.obj.UID;
      e.accessToken = auth.obj.AccessToken;
      e.refreshToken = auth.obj.RefreshToken;
      throw e;
    }
    return { uid: auth.obj.UID, accessToken: auth.obj.AccessToken, refreshToken: auth.obj.RefreshToken };
  }

  // 2FA：TOTP 六位码
  async function srpLogin2fa(uid, accessToken, refreshToken, totpCode) {
    const r = await protonApi('/auth/v4/2fa', { TwoFactorCode: String(totpCode).trim() }, { 'x-pm-uid': uid, 'Authorization': 'Bearer ' + accessToken });
    if (r.status !== 200 || !r.obj || r.obj.Code !== 1000) {
      throw new Error('SRP：2FA 失败 HTTP ' + r.status + ' ' + ((r.obj && r.obj.Error) || r.text.slice(0, 120)));
    }
    return { uid, accessToken: r.obj.AccessToken || accessToken, refreshToken: r.obj.RefreshToken || refreshToken };
  }

  // 刷新 token：返回 { accessToken, refreshToken }，失败回 null
  async function refreshProtonToken(uid, refreshToken) {
    try {
      const r = await protonApi('/auth/v4/refresh', {
        UID: uid,
        RefreshToken: refreshToken,
        ResponseType: 'token',
        GrantType: 'refresh_token',
        RedirectURI: 'https://proton.me',
      });
      if (r.status !== 200 || !r.obj || r.obj.Code !== 1000 || !r.obj.AccessToken) return null;
      return { accessToken: r.obj.AccessToken, refreshToken: r.obj.RefreshToken || refreshToken };
    } catch { return null; }
  }

  // 暴露给 background.js
  self.ProtonSRP = { srpLogin, srpLogin2fa, refreshProtonToken, setAppVersion, extractModulus, hashPasswordV3, generateProofs, expandHash, b64encode, b64decode };
})();
