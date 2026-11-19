/* Outlook content script — 只读：供设置页“从标签页发现 Outlook 账号”认邮箱
 *
 * v1.11.0 删掉旧的 content-outlook.js，是因为它抄凭证、后台重放；这一版只读 DOM 里的
 * 账号邮箱（aria-label/title/顶栏文字），不碰任何凭证、不读邮件内容、不上报未读数。
 * 未读数走 Graph OAuth，跟标签页没关系。
 *
 * v1.15.12：标签页加载后主动上报（当前登录的邮箱 + 地址栏里的 /mail/N/ 槽位），
 * 后台记下来，以后“打开收件箱”就按这个槽位开。Outlook 网页版同一个浏览器会话里
 * 只能有一个活跃账号，/mail/N/ 是浏览器里登录的顺序槽位，不是扩展自己的序号——
 * 拿扩展的序号拼 /mail/N/ 必然串号（v1.15.8 的教训），只能从真实标签页上学。
 *
 * v1.15.15：accountEmail() 之前只找 aria-label/title 里带 @ 的和顶栏 innerText，
 * 正常收件箱页面、头像菜单没打开时邮箱根本不在这些地方，读不到就学不到槽位、
 * 试探也认不出 A 和 B。改成多层找：aria-label/title → 顶栏 textContent（含隐藏
 * 的头像菜单，innerText 读不到隐藏元素）→ 整页 textContent 里第一个邮箱。
 * 抓错的风险由后台兜底：只有扩展里已知的 Outlook 账号才会被记成槽位。
 */
(function () {
  const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.]+/;
  // 在某个根节点下逐个文本节点找邮箱（不用整块 textContent，免得“名字+邮箱”
  // 连在一起被当成一个邮箱，例如 Hemmingadjlevis@outlook.com）
  function findEmailIn(root) {
    if (!root || !document.createTreeWalker) return '';
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const t = (node.nodeValue || '').match(EMAIL_RE);
      if (t) return t[0];
    }
    return '';
  }
  function accountEmail() {
    const els = document.querySelectorAll('[aria-label*="@"], [title*="@"]');
    for (const el of els) {
      const t = (el.getAttribute('aria-label') || el.getAttribute('title') || '').match(EMAIL_RE);
      if (t) return t[0];
    }
    // 顶栏（含隐藏的头像菜单）里逐个文本节点找——textContent 会包含隐藏元素，
    // innerText 读不到隐藏元素，所以用 TreeWalker 而不用 innerText/textContent 整块扫
    const header = document.querySelector('header');
    if (header) {
      const e = findEmailIn(header);
      if (e) return e;
    }
    // 整页逐个文本节点找（头像菜单即使没打开也在 DOM 里，通常排在邮件列表前面）
    if (document.body) {
      const e = findEmailIn(document.body);
      if (e) return e;
    }
    return '';
  }
  function slotFromUrl() {
    const m = (location.pathname || '').match(/\/mail\/(\d+)\//);
    return m ? parseInt(m[1], 10) : null;
  }
  // 主动上报一次（Outlook 顶栏是异步渲染的，邮箱可能一开始读不到，重试几次）
  let reported = false;
  function tryReport(n) {
    if (reported) return;
    const email = accountEmail();
    const slot = slotFromUrl();
    if (email && slot != null) {
      reported = true;
      try { chrome.runtime.sendMessage({ type: 'mmn-outlook-slot', email, slot }); } catch {}
      return;
    }
    if (n < 6) setTimeout(() => tryReport(n + 1), 1500);
  }
  setTimeout(() => tryReport(0), 1200);
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'mmn-outlook-account') sendResponse({ email: accountEmail(), slot: slotFromUrl() });
  });
})();
