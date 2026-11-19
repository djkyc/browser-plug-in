// 各邮箱服务商小图标（内联 SVG data URI，不联网）
const PROVIDER_ICON = {
  gmail:  { color: '#ea4335', letter: 'G' },
  outlook:{ color: '#0078d4', letter: 'O' },
  proton: { color: '#6d4aff', letter: 'P' },
};
function providerIconSrc(provider, size = 18) {
  const p = PROVIDER_ICON[provider] || { color: '#888', letter: '?' };
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'><rect width='${size}' height='${size}' rx='4' fill='${p.color}'/><text x='50%' y='68%' font-size='${Math.round(size * 0.62)}' font-family='Arial,sans-serif' font-weight='bold' fill='#fff' text-anchor='middle'>${p.letter}</text></svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}
// v1.15.35：徽章全部换成矢量 SVG（放大不糊），不再用用户发的糊掉的小 PNG 图
// （图一其实是截图碎片——青色 H 大圆标 + 右下角小蓝 O；图二是 19×18 的糊图）。
// Gmail：Wikimedia 官方彩色 M（5 条路径，四个官方色）；
// Outlook：Simple Icons 的官方 O 形状，填 Outlook 蓝 #0078d4；
// Hotmail/Live：同一个 O 形状，填浅蓝 #00a4ef，跟 Outlook 区分开；
// Proton：Simple Icons 的官方信封形状，白字放紫底上（不动）。
const GMAIL_LOGO_PATHS = [
  ['#4285f4', 'M58 108h14V74L52 59v43c0 3.32 2.69 6 6 6'],
  ['#34a853', 'M120 108h14c3.32 0 6-2.69 6-6V59l-20 15'],
  ['#fbbc04', 'M120 48v26l20-15v-8c0-7.42-8.47-11.65-14.4-7.2'],
  ['#ea4335', 'M72 74V48l24 18 24-18v26L96 92'],
  ['#c5221f', 'M52 51v8l20 15V48l-5.6-4.2c-5.94-4.45-14.4-.22-14.4 7.2'],
];
const PROVIDER_LOGO_PATH = {
  // Hotmail/Live 和 Outlook 用同一个 O 形状，只填色不同（Outlook #0078d4 深蓝，Hotmail #00a4ef 浅蓝）
  outlook: 'M7.88 12.04q0 .45-.11.87-.1.41-.33.74-.22.33-.58.52-.37.2-.87.2t-.85-.2q-.35-.21-.57-.55-.22-.33-.33-.75-.1-.42-.1-.86t.1-.87q.1-.43.34-.76.22-.34.59-.54.36-.2.87-.2t.86.2q.35.21.57.55.22.34.31.77.1.43.1.88zM24 12v9.38q0 .46-.33.8-.33.32-.8.32H7.13q-.46 0-.8-.33-.32-.33-.32-.8V18H1q-.41 0-.7-.3-.3-.29-.3-.7V7q0-.41.3-.7Q.58 6 1 6h6.5V2.55q0-.44.3-.75.3-.3.75-.3h12.9q.44 0 .75.3.3.3.3.75V10.85l1.24.72h.01q.1.07.18.18.07.12.07.25zm-6-8.25v3h3v-3zm0 4.5v3h3v-3zm0 4.5v1.83l3.05-1.83zm-5.25-9v3h3.75v-3zm0 4.5v3h3.75v-3zm0 4.5v2.03l2.41 1.5 1.34-.8v-2.73zM9 3.75V6h2l.13.01.12.04v-2.3zM5.98 15.98q.9 0 1.6-.3.7-.32 1.19-.86.48-.55.73-1.28.25-.74.25-1.61 0-.83-.25-1.55-.24-.71-.71-1.24t-1.15-.83q-.68-.3-1.55-.3-.92 0-1.64.3-.71.3-1.2.85-.5.54-.75 1.3-.25.74-.25 1.63 0 .85.26 1.56.26.72.74 1.23.48.52 1.17.81.69.3 1.56.3zM7.5 21h12.39L12 16.08V17q0 .41-.3.7-.29.3-.7.3H7.5zm15-.13v-7.24l-5.9 3.54Z',
  proton: 'm15.24 8.998 3.656-3.073v15.81H2.482C1.11 21.735 0 20.609 0 19.223V6.944l7.58 6.38a2.186 2.186 0 0 0 2.871-.042l4.792-4.284h-.003zm-5.456 3.538 1.809-1.616a2.438 2.438 0 0 1-1.178-.533L.905 2.395A.552.552 0 0 0 0 2.826v2.811l8.226 6.923a1.186 1.186 0 0 0 1.558-.024zM23.871 2.463a.551.551 0 0 0-.776-.068l-3.199 2.688v16.653h1.623c1.371 0 2.481-1.127 2.481-2.513V2.824a.551.551 0 0 0-.129-.36z',
};
// 各家徽章底色：Gmail/Outlook/Hotmail 白底（logo 本身带颜色），Proton 紫底
function providerLogoBg(kind) {
  if (kind === 'proton') return '#6d4aff';
  return '#fff';
}
function providerLogoSvg(provider, size = 14) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  if (provider === 'gmail') {
    svg.setAttribute('viewBox', '52 42 88 66');
    for (const [fill, d] of GMAIL_LOGO_PATHS) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('fill', fill);
      path.setAttribute('d', d);
      svg.appendChild(path);
    }
    return svg;
  }
  // v1.15.38（用户 12:10 确认）：Outlook/Hotmail 改用官方原图文件——
  // Outlook 用 Wikimedia 官方 Microsoft Outlook Icon (2025–present).svg
  //（蓝渐变方块 + 白色 O）。
  // v1.15.42（用户 12:47 拍板）：Hotmail 改用橙信封，不用红 msn 椭圆了。
  // Commons 上没有橙信封的 SVG（只有 PNG），用的官方 Hotmail logo
  // (2011-2013).png（3840×2160，Public domain）左边抠出来的信封，
  // 不要右边的 Microsoft Hotmail 字，缩到 256px（icons/logo-hotmail.png，
  // 透明底）。红 msn 椭圆的 logo-hotmail.svg 已删。
  // v1.15.40（用户 12:32 拍板）：Live 单独拆出来，不再跟 Hotmail 共用——
  // Live 用 Outlook.com 图标 (2012-2019) 里的蓝 O 方块（icons/logo-live.svg，
  // 只留 g23 蓝瓦片+白 O，无信封无字）。
  // Gmail（官方彩色 M）和 Proton（白字信封紫底）用户已确认好，不动。
  // 徽章是 18px 圆、logo 14px，跟 Gmail 一样大；img 用 object-fit:contain
  // 等比塞进 14×14 框。
  if (provider === 'outlook' || provider === 'hotmail' || provider === 'live') {
    const file = provider === 'outlook' ? 'icons/logo-outlook.svg'
      : provider === 'live' ? 'icons/logo-live.svg' : 'icons/logo-hotmail.png';
    const img = document.createElement('img');
    img.src = chrome.runtime.getURL(file);
    img.width = size; img.height = size;
    img.alt = provider;
    img.style.objectFit = 'contain';
    img.style.display = 'block';
    return img;
  }
  const fill = provider === 'proton' ? '#fff' : '#888';
  const d = PROVIDER_LOGO_PATH[provider];
  if (!d) return null;
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', fill);
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d);
  svg.appendChild(path);
  return svg;
}
// v1.15.32：按邮箱域名自动认服务商（输入 hotmail/outlook.com 就认出是 Outlook，
// 不用再靠下拉框选对）。Gmail 认 gmail.com/googlemail.com；Outlook 认微软系
// 域名（hotmail/outlook/live/msn）；Proton 认 proton.me/protonmail.com。
function providerForEmail(email) {
  const m = String(email || '').trim().toLowerCase().match(/@([a-z0-9.-]+)$/);
  if (!m) return null;
  const d = m[1];
  if (d === 'gmail.com' || d === 'googlemail.com') return 'gmail';
  if (d === 'hotmail.com' || d === 'hotmail.co.uk' || d === 'outlook.com' || d === 'outlook.co.uk' || d === 'live.com' || d === 'live.co.uk' || d === 'live.cn' || d === 'msn.com' || d === 'msn.co.uk') return 'outlook';
  if (d === 'proton.me' || d === 'protonmail.com' || d === 'protonmail.ch' || d === 'pm.me') return 'proton';
  return null;
}
// v1.15.40：Live 单独拆出来（用户 12:32 拍板，live.com/live.co.uk/live.cn
// 用蓝 O 方块，不再跟 Hotmail 共用红椭圆）。登录仍走 providerForEmail
//（hotmail/live 登录一样走微软 OAuth，provider 还是 'outlook'，别改）。
function iconKindForEmail(email) {
  const m = String(email || '').trim().toLowerCase().match(/@([a-z0-9.-]+)$/);
  if (!m) return null;
  const d = m[1];
  if (d === 'hotmail.com' || d === 'hotmail.co.uk') return 'hotmail';
  if (d === 'live.com' || d === 'live.co.uk' || d === 'live.cn') return 'live';
  if (d === 'outlook.com' || d === 'outlook.co.uk' || d === 'msn.com' || d === 'msn.co.uk') return 'outlook';
  if (d === 'gmail.com' || d === 'googlemail.com') return 'gmail';
  if (d === 'proton.me' || d === 'protonmail.com' || d === 'protonmail.ch' || d === 'pm.me') return 'proton';
  return null;
}
function providerIconImg(provider, size = 18) {
  const img = document.createElement('img');
  img.src = providerIconSrc(provider, size);
  img.width = size; img.height = size;
  img.style.verticalAlign = '-3px'; img.style.marginRight = '5px';
  img.alt = provider;
  return img;
}
