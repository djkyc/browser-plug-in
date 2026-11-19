/* Proton content script — 读已打开的 Proton Mail 标签页取未读数
 * Proton 没有官方浏览器插件，官方路线是 Bridge（付费，IMAP）；
 * SRP + PGP 全套后台登录是 v2 的工程量，v1 不做。
 * v1 做法：读 mail.proton.me 标签页标题，形如 "(2) Inbox | Proton Mail"，
 * 未读数变化就上报给 background。没打开标签页时显示“需打开”。
 */
(function () {
  function indexFromUrl() {
    const m = location.pathname.match(/\/u\/(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  }
  function unreadFromTitle() {
    const m = document.title.match(/^\((\d+)\)/);
    return m ? parseInt(m[1], 10) : null;
  }
  function accountEmail() {
    const els = document.querySelectorAll('[aria-label*="@"], [title*="@"]');
    for (const el of els) {
      const t = (el.getAttribute('aria-label') || el.getAttribute('title') || '').match(/[\w.+-]+@[\w-]+\.[\w.]+/);
      if (t) return t[0];
    }
    return '';
  }
  let lastSent = -1;
  let lastSentEmail = '';
  function report() {
    const unread = unreadFromTitle();
    const email = accountEmail();
    if (unread === null || (unread === lastSent && email === lastSentEmail)) return;
    lastSent = unread;
    lastSentEmail = email;
    chrome.runtime.sendMessage({
      type: 'mmn-unread-report',
      provider: 'proton',
      index: indexFromUrl(),
      unread,
      email,
      label: 'Proton ' + (indexFromUrl() + 1),
      messages: [],
    });
  }
  const titleEl = document.querySelector('title');
  if (titleEl) new MutationObserver(report).observe(titleEl, { childList: true });
  setInterval(report, 15000);
  setTimeout(report, 2000);
})();
