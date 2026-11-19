// 默认 Microsoft Client ID：用户自己的 Azure 应用 MultiMailNotifier，与 outlook-oauth.js 保持一致。
// v1.15.5：雷鸟/Peekat 的公开微软 ID 已拿掉——它俩在 live.com 端点不认我们的回调地址，登不进去。
const OWN_MS_CLIENT_ID = '8aacd0db-eeba-4300-9a7d-70a3c1d684c3';
// 默认 Google Client ID：用户自己的 Google 应用 MultiMailNotifier，与 gmail-oauth.js 保持一致。
// v1.15.6：雷鸟 / Peekat 的 Google ID 已拿掉，全部用自己的。
const OWN_GOOGLE_CLIENT_ID = '940110558797-olvhdbr9e2cvua3dnalch1beui6tg8bo.apps.googleusercontent.com';

async function load() {
  const { accounts = [] } = await chrome.storage.local.get(['accounts']);
  const { settings = {} } = await chrome.storage.local.get(['settings']);
  const { msClientId = '' } = await chrome.storage.local.get(['msClientId']);
  const { outlookTokens = {} } = await chrome.storage.local.get(['outlookTokens']);
  const { gmailTokens = {} } = await chrome.storage.local.get(['gmailTokens']);
  const { googleClientId = '' } = await chrome.storage.local.get(['googleClientId']);
  const tbody = document.querySelector('#accTable tbody');
  tbody.innerHTML = '';
  for (const acc of accounts) {
    const tr = document.createElement('tr');
    tr.dataset.accId = acc.id;
    // v1.15.21：行可拖动排序——只有 ☰ 手柄能拖（不然会跟标签输入框、按钮冲突）
    const gripTd = document.createElement('td');
    const grip = document.createElement('span');
    grip.textContent = '☰';
    grip.title = '拖动排序';
    grip.style.cursor = 'grab';
    grip.style.userSelect = 'none';
    grip.draggable = true;
    grip.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', acc.id);
      e.dataTransfer.effectAllowed = 'move';
      tr.classList.add('dragging');
    });
    grip.addEventListener('dragend', () => tr.classList.remove('dragging'));
    gripTd.append(grip);
    tr.append(gripTd);
    tr.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; tr.classList.add('drag-over'); });
    tr.addEventListener('dragleave', () => tr.classList.remove('drag-over'));
    tr.addEventListener('drop', async (e) => {
      e.preventDefault();
      tr.classList.remove('drag-over');
      const dragId = e.dataTransfer.getData('text/plain');
      if (!dragId || dragId === acc.id) return;
      const all = (await chrome.storage.local.get(['accounts'])).accounts || [];
      const from = all.findIndex(a => a.id === dragId);
      const to = all.findIndex(a => a.id === acc.id);
      if (from < 0 || to < 0) return;
      const [moved] = all.splice(from, 1);
      all.splice(to, 0, moved);
      await chrome.storage.local.set({ accounts: all });
      load();
    });
    const cells = [acc.provider, null, String(acc.index ?? 0), String(acc.unread || 0), acc.status || '-'];
    for (const c of cells) {
      const td = document.createElement('td');
      if (c === null) {
        // 标签/邮箱可直接改：Proton 后台只给未读数、给不出邮箱地址，改成自己的邮箱地址就能认出来了
        const input = document.createElement('input');
        input.type = 'text'; input.value = acc.label || acc.email || '';
        input.style.width = '220px';
        input.onchange = async () => {
          const all = (await chrome.storage.local.get(['accounts'])).accounts || [];
          const next = all.map(a => a.id === acc.id ? { ...a, label: input.value.trim() || a.label } : a);
          await chrome.storage.local.set({ accounts: next });
        };
        td.append(input);
      } else if (acc.provider && c === acc.provider) { td.append(providerIconImg(acc.provider, 18), document.createTextNode(c)); }
      else td.textContent = c;
      tr.append(td);
    }
    const td = document.createElement('td');
    // v1.15.21：登录按钮移到账号表里、放在“打开”前面（不用再翻到下面登录区）
    if (acc.provider === 'gmail' || acc.provider === 'outlook') {
      const tok = acc.provider === 'gmail' ? gmailTokens[acc.id] : outlookTokens[acc.id];
      const loginBtn = document.createElement('button');
      loginBtn.textContent = (tok && tok.access_token && acc.needsRescope) ? '重新授权' : '登录';
      loginBtn.className = 'primary';
      loginBtn.title = acc.provider === 'gmail' ? '登录 Google 授权（拿 Gmail token）' : '登录微软授权（拿 Outlook token）';
      loginBtn.onclick = async () => {
        loginBtn.disabled = true;
        loginBtn.textContent = '登录中…';
        try {
          const type = acc.provider === 'gmail' ? 'mmn-gmail-login' : 'mmn-outlook-login';
          const res = await chrome.runtime.sendMessage({ type, accountId: acc.id });
          if (res && res.ok === false) alert('登录失败：' + res.error + '\n去下面“诊断”里看完整日志。');
          else load();
        } finally { loginBtn.disabled = false; }
      };
      td.append(loginBtn, document.createTextNode(' '));
    }
    // v1.15.7：每账号一行加“打开”——打开这个号的收件箱（Outlook 按邮箱认已开的标签页，
    // 切不过去才按 Peekat 的办法新开 /mail/0/ 或 office.com；不再用序号拼 /mail/N/）
    const openBtn = document.createElement('button');
    openBtn.textContent = '打开';
    openBtn.title = '打开这个号的收件箱';
    openBtn.onclick = async () => { await chrome.runtime.sendMessage({ type: 'mmn-open-mailbox', accountId: acc.id }).catch(() => {}); };
    const btn = document.createElement('button');
    btn.textContent = '删除';
    btn.onclick = async () => {
      const next = (await chrome.storage.local.get(['accounts'])).accounts.filter(a => a.id !== acc.id);
      await chrome.storage.local.set({ accounts: next });
      load();
    };
    td.append(openBtn, document.createTextNode(' '), btn);
    // v1.15.21：槽位下拉框已删——v1.15.18 起 Outlook 打开走 login_hint，不认槽位号了
    tr.append(td);
    tbody.append(tr);
  }
  document.getElementById('interval').value = settings.intervalMinutes ?? 1;
  document.getElementById('desktopNotif').checked = settings.desktopNotif !== false;
  document.getElementById('autoUpdateCheck').checked = settings.autoUpdateCheck !== false;
  refreshUpdateStatus();
  document.getElementById('sound').checked = !!settings.sound;
  document.getElementById('onlyImportant').checked = !!settings.onlyImportant;
  document.getElementById('quietHours').checked = !!settings.quietHours;
  document.getElementById('quietStart').value = settings.quietStart || '23:00';
  document.getElementById('quietEnd').value = settings.quietEnd || '07:00';
  document.getElementById('badgeColor').value = settings.badgeColor || '#d93025';
  // v1.15.22：主题三档（自动/暗黑/白色），同步按钮状态
  applyTheme(settings.theme || 'auto');
  document.querySelectorAll('#themeSeg button').forEach(b => b.classList.toggle('on', b.dataset.theme === (settings.theme || 'auto')));

  // Outlook 登录区：Client ID 选择（自己的 Azure 应用 / 自定义）+ 每个 Outlook 账号一行（登录按钮 + 状态）
  // 选择存在 msClientIdChoice；自定义值存在 msClientId；预设的 ID 显示在输入框里（禁用，不可改）
  const { msClientIdChoice = '' } = await chrome.storage.local.get(['msClientIdChoice']);
  const choiceSel = document.getElementById('msClientIdChoice');
  const idInput = document.getElementById('msClientId');
  let choice = msClientIdChoice;
  if (!choice) {
    // v1.11.0 升上来：已存的 ID 不是自己的就当自定义；v1.15.5 起默认用自己的 Azure 应用
    if (msClientId && msClientId !== OWN_MS_CLIENT_ID) choice = 'custom';
    else choice = 'own';
  }
  // 正在改 Client ID 时不重写输入框，免得打断输入
  const active = document.activeElement;
  if (active !== choiceSel && active !== idInput) {
    choiceSel.value = choice;
    if (choice === 'own') { idInput.value = OWN_MS_CLIENT_ID; idInput.disabled = true; }
    else { idInput.value = msClientId || ''; idInput.disabled = false; }
  }
  document.getElementById('redirectUri').textContent = chrome.identity.getRedirectURL('microsoft');
  const loginEl = document.getElementById('outlookLoginList');
  loginEl.innerHTML = '';
  const outlookAccs = accounts.filter(x => x.provider === 'outlook');
  for (const a of outlookAccs) {
    const tok = outlookTokens[a.id];
    const row = document.createElement('div');
    const name = document.createElement('span');
    name.textContent = a.label || a.email || 'Outlook';
    const pill = document.createElement('span');
    pill.className = 'pill ' + (tok && tok.access_token ? 'on' : 'off');
    if (tok && tok.access_token) {
      const exp = tok.expires_at ? new Date(tok.expires_at).toLocaleString('zh-CN', { hour12: false }) : '';
      pill.textContent = '已登录' + (exp ? `（token 有效至 ${exp}）` : '');
    } else if (a.status === 'need-login') pill.textContent = '未登录';
    else pill.textContent = a.status || '未登录';
    // v1.12.0：token 还是旧权限时，未读照常查，但回邮件/标已读要重新登录授权
    if (tok && tok.access_token && a.needsRescope) {
      pill.textContent += ' · 需重新授权发邮件';
    }
    // v1.15.23：登录按钮已移到上面账号表里，这里只留登录记录（账号 + 状态）
    row.append(name, pill);
    loginEl.append(row);
  }
  if (!outlookAccs.length) loginEl.textContent = '还没有 Outlook 账号，先在上面添加一个，再点“登录”。';

  // Gmail 登录区（v1.13.2）：跟 Outlook 一样——Client ID 下拉选预设 + 值框 + 每个 Gmail 账号一行
  // v1.15.6：下拉只剩“自己的 Google 应用”和“自定义”，全部用自己的
  // 选择存在 googleClientIdChoice；自定义值存在 googleClientId；预设的 ID 显示在输入框里（禁用，不可改）
  const { googleClientIdChoice = '' } = await chrome.storage.local.get(['googleClientIdChoice']);
  const gChoiceSel = document.getElementById('googleClientIdChoice');
  const gIdInput = document.getElementById('googleClientId');
  let gChoice = googleClientIdChoice;
  if (!gChoice) {
    // v1.13.1 升上来：已存的 ID 不是内置的自己 ID 就当自定义，否则默认用自己的 Google 应用
    if (googleClientId && googleClientId !== OWN_GOOGLE_CLIENT_ID) gChoice = 'custom';
    else gChoice = 'own';
  } else if (gChoice !== 'own' && gChoice !== 'custom') gChoice = 'own'; // 以前存的 thunderbird/peekat 也回自己的
  // 正在改 Client ID 时不重写输入框，免得打断输入
  const gActive = document.activeElement;
  if (gActive !== gChoiceSel && gActive !== gIdInput) {
    gChoiceSel.value = gChoice;
    if (gChoice === 'own') { gIdInput.value = OWN_GOOGLE_CLIENT_ID; gIdInput.disabled = true; }
    else { gIdInput.value = googleClientId || ''; gIdInput.disabled = false; }
  }
  document.getElementById('googleRedirectUri').textContent = chrome.identity.getRedirectURL();
  const gmailLoginEl = document.getElementById('gmailLoginList');
  gmailLoginEl.innerHTML = '';
  const gmailAccs = accounts.filter(x => x.provider === 'gmail');
  for (const a of gmailAccs) {
    const tok = gmailTokens[a.id];
    const row = document.createElement('div');
    const name = document.createElement('span');
    name.textContent = a.label || a.email || 'Gmail';
    const pill = document.createElement('span');
    pill.className = 'pill ' + (tok && tok.access_token ? 'on' : 'off');
    if (tok && tok.access_token) {
      const exp = tok.expires_at ? new Date(tok.expires_at).toLocaleString('zh-CN', { hour12: false }) : '';
      pill.textContent = '已登录' + (exp ? `（token 有效至 ${exp}）` : '');
    } else if (a.status === 'need-login') pill.textContent = '未登录';
    else pill.textContent = a.status || '未登录';
    if (tok && tok.access_token && a.needsRescope) {
      pill.textContent += ' · 需重新授权发邮件';
    }
    // v1.15.23：登录按钮已移到上面账号表里，这里只留登录记录（账号 + 状态）
    row.append(name, pill);
    gmailLoginEl.append(row);
  }
  if (!gmailAccs.length) gmailLoginEl.textContent = '还没有 Gmail 账号，先在上面添加一个（或点“自动发现 Gmail 账号”），再点“登录”。';

  // 登录凭证卡：Outlook 只显示登录状态（不显示 token 值），Proton 显示抓到的头
  const { captured = {} } = await chrome.storage.local.get(['captured']);
  const fmtProton = (o) => Object.keys(o || {}).sort().map(k => {
    const c = o[k];
    const t = c.capturedAt ? new Date(c.capturedAt).toLocaleString() : '';
    return `${k} 号：已抓到（${t}）`;
  }).join('<br>') || '还没抓到，打开一次对应网页版再点检查';
  const outlookState = outlookAccs.map(a => {
    const tok = outlookTokens[a.id];
    return `${a.label || a.email || 'Outlook'}：${tok && tok.access_token ? '已登录' : '未登录'}`;
  }).join('<br>') || '还没有 Outlook 账号';
  const gmailState = gmailAccs.map(a => {
    const tok = gmailTokens[a.id];
    return `${a.label || a.email || 'Gmail'}：${tok && tok.access_token ? '已登录' : '未登录'}`;
  }).join('<br>') || '还没有 Gmail 账号';
  document.getElementById('captured').innerHTML =
    'Gmail（Gmail API OAuth）：<br>' + gmailState + '<br>Outlook（Graph OAuth）：<br>' + outlookState + '<br>Proton：<br>' + fmtProton(captured.proton);
}

async function applyMsClientIdChoice() {
  const sel = document.getElementById('msClientIdChoice').value;
  const input = document.getElementById('msClientId');
  if (sel === 'own') { input.value = OWN_MS_CLIENT_ID; input.disabled = true; }
  else {
    input.disabled = false;
    // 切回自定义时把上次保存的自定义值填回来（之前框里还留着预设的 ID，得重输）
    const { msClientId = '' } = await chrome.storage.local.get(['msClientId']);
    if (msClientId) input.value = msClientId;
  }
}
document.getElementById('msClientIdChoice').onchange = applyMsClientIdChoice;

async function applyGoogleClientIdChoice() {
  const sel = document.getElementById('googleClientIdChoice').value;
  const input = document.getElementById('googleClientId');
  if (sel === 'own') { input.value = OWN_GOOGLE_CLIENT_ID; input.disabled = true; }
  else {
    input.disabled = false;
    // 切回自定义时把上次保存的自定义值填回来（之前框里还留着预设的 ID，得重输）
    const { googleClientId = '' } = await chrome.storage.local.get(['googleClientId']);
    if (googleClientId) input.value = googleClientId;
  }
}
document.getElementById('googleClientIdChoice').onchange = applyGoogleClientIdChoice;

document.getElementById('saveMsClientIdBtn').onclick = async () => {
  const choice = document.getElementById('msClientIdChoice').value;
  const v = document.getElementById('msClientId').value.trim();
  // 只在“自定义”时存输入框的值；选预设时不动已存的自定义值（切回来还在）
  if (choice === 'custom') await chrome.storage.local.set({ msClientIdChoice: choice, msClientId: v });
  else await chrome.storage.local.set({ msClientIdChoice: choice });
  const label = choice === 'own' ? '自己的 Azure 应用 MultiMailNotifier' : '自定义 ID';
  document.getElementById('msClientIdSaved').textContent = '已保存 ✓ 当前用' + label;
  setTimeout(() => { document.getElementById('msClientIdSaved').textContent = ''; }, 2500);
};

document.getElementById('copyRedirectUriBtn').onclick = async () => {
  await navigator.clipboard.writeText(chrome.identity.getRedirectURL('microsoft'));
  document.getElementById('msClientIdSaved').textContent = '回调地址已复制 ✓ 注册 Azure 应用时贴进去';
  setTimeout(() => { document.getElementById('msClientIdSaved').textContent = ''; }, 2500);
};

document.getElementById('saveGoogleClientIdBtn').onclick = async () => {
  const choice = document.getElementById('googleClientIdChoice').value;
  const v = document.getElementById('googleClientId').value.trim();
  // v1.15.4：Gmail 走隐式流程，密钥彻底不要了，这里只存选择和自定义 ID
  if (choice === 'custom') await chrome.storage.local.set({ googleClientIdChoice: choice, googleClientId: v });
  else await chrome.storage.local.set({ googleClientIdChoice: choice });
  const label = choice === 'own' ? '自己的 Google 应用 MultiMailNotifier' : '自定义 ID';
  document.getElementById('googleClientIdSaved').textContent = '已保存 ✓ 当前用' + label;
  setTimeout(() => { document.getElementById('googleClientIdSaved').textContent = ''; }, 2500);
};

document.getElementById('copyGoogleRedirectUriBtn').onclick = async () => {
  await navigator.clipboard.writeText(chrome.identity.getRedirectURL());
  document.getElementById('googleClientIdSaved').textContent = '回调地址已复制 ✓ 建 Google OAuth 客户端时贴进去';
  setTimeout(() => { document.getElementById('googleClientIdSaved').textContent = ''; }, 2500);
};

// v1.15.19：添加账号时输入邮箱前缀自动补域名后缀（Gmail→@gmail.com，
// Proton→@proton.me）。只在值像邮箱前缀（字母数字._%+-
// 且没有 @、没有空格/中文）时才补；已带 @ 的（比如手动打了 @hotmail.com）
// 或纯标签（比如“工作 Gmail”）不动。失焦时补一次，点“添加账号”时再补一次兜底。
// v1.15.39：Outlook 不再默认补 @outlook.com——Outlook 系有 outlook.com/
// hotmail.com/live.com 多个域名，静默默认会把 Hotmail/Live 的号加错成
// @outlook.com（用户 12:19 指出）。只输前缀时不补，等用户从候选里选域名；
// Gmail/Proton 只有一个主域名（gmail.com / proton.me），照旧自动补。
function domainForProvider(provider) {
  if (provider === 'gmail') return '@gmail.com';
  if (provider === 'outlook') return '@outlook.com';
  if (provider === 'proton') return '@proton.me';
  return '';
}
function completeEmailPrefix(value, provider) {
  const v = String(value || '').trim();
  if (v && !v.includes('@') && /^[A-Za-z0-9._%+-]+$/.test(v)) {
    if (provider === 'outlook') return v;
    return v + domainForProvider(provider);
  }
  return v;
}
document.getElementById('newLabel').addEventListener('blur', () => {
  const input = document.getElementById('newLabel');
  const provider = document.getElementById('newProvider').value;
  input.value = completeEmailPrefix(input.value, provider);
  // v1.15.32：打了完整邮箱（比如 xxx@hotmail.com）就按域名把下拉框也切到对应的服务商
  const detected = providerForEmail(input.value);
  if (detected) document.getElementById('newProvider').value = detected;
});

// v1.15.36：输入邮箱时弹出域名候选（边输边出，不用等失焦）。
// 输了前缀 + @ 就按当前选的服务商列出域名（Outlook：outlook.com/hotmail.com/live.com…；
// Gmail：gmail.com；Proton：proton.me/protonmail.com），点一下就补全；
// 只输前缀（没 @）也列出来。↓/↑ 选、回车确认、Esc 关掉；
// 点候选用 mousedown（比 blur 先触发，点得上）。
const EMAIL_DOMAINS = {
  gmail: ['gmail.com', 'googlemail.com'],
  outlook: ['outlook.com', 'hotmail.com', 'live.com', 'outlook.co.uk', 'hotmail.co.uk', 'live.co.uk', 'live.cn', 'msn.com'],
  proton: ['proton.me', 'protonmail.com', 'pm.me'],
};
function emailSuggestions(value, provider) {
  const v = String(value || '').trim();
  if (!v) return [];
  const at = v.indexOf('@');
  const prefix = at === -1 ? v : v.slice(0, at);
  const typed = at === -1 ? '' : v.slice(at + 1);
  if (!/^[A-Za-z0-9._%+-]+$/.test(prefix)) return [];
  if (typed && !/^[A-Za-z0-9.-]*$/.test(typed)) return [];
  const domains = EMAIL_DOMAINS[provider] || [];
  // 域名已完整（正好等于某一家）就不出候选——不然点完候选 focus 一触发又弹出来
  if (typed && domains.some(d => d.toLowerCase() === typed.toLowerCase())) return [];
  return domains.filter(d => d.toLowerCase().startsWith(typed.toLowerCase())).map(d => prefix + '@' + d);
}
let suggestIdx = -1;
let hideTimer = 0;
function renderEmailSuggest() {
  clearTimeout(hideTimer);
  const input = document.getElementById('newLabel');
  const box = document.getElementById('emailSuggest');
  const provider = document.getElementById('newProvider').value;
  const list = emailSuggestions(input.value, provider);
  suggestIdx = -1;
  box.innerHTML = '';
  if (!list.length) { box.hidden = true; return; }
  const at = input.value.indexOf('@');
  const prefix = at === -1 ? input.value.trim() : input.value.slice(0, at);
  for (const full of list) {
    const b = document.createElement('button');
    b.type = 'button';
    // 前缀普通字，域名部分加粗红字，一眼看出是补的哪家
    b.append(document.createTextNode(prefix));
    const strong = document.createElement('b');
    strong.textContent = full.slice(prefix.length);
    b.append(strong);
    b.addEventListener('mousedown', (e) => {
      e.preventDefault();
      input.value = full;
      box.hidden = true;
      const detected = providerForEmail(full);
      if (detected) document.getElementById('newProvider').value = detected;
      input.focus();
    });
    box.append(b);
  }
  box.hidden = false;
}
function hideEmailSuggest() { document.getElementById('emailSuggest').hidden = true; }
document.getElementById('newLabel').addEventListener('input', renderEmailSuggest);
document.getElementById('newLabel').addEventListener('focus', renderEmailSuggest);
document.getElementById('newLabel').addEventListener('keydown', (e) => {
  const box = document.getElementById('emailSuggest');
  if (box.hidden) return;
  const items = [...box.querySelectorAll('button')];
  if (!items.length) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    suggestIdx = e.key === 'ArrowDown' ? (suggestIdx + 1) % items.length : (suggestIdx - 1 + items.length) % items.length;
    items.forEach((it, i) => it.classList.toggle('on', i === suggestIdx));
  } else if (e.key === 'Enter' && suggestIdx >= 0) {
    e.preventDefault();
    items[suggestIdx].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  } else if (e.key === 'Escape') {
    hideEmailSuggest();
  }
});
document.getElementById('newLabel').addEventListener('blur', () => {
  // 晚一点再关，让点候选的 mousedown 先跑完；renderEmailSuggest 会清掉这个延时
  hideTimer = setTimeout(hideEmailSuggest, 150);
});
document.getElementById('newProvider').addEventListener('change', renderEmailSuggest);

document.getElementById('addBtn').onclick = async () => {
  let provider = document.getElementById('newProvider').value;
  const label = completeEmailPrefix(document.getElementById('newLabel').value, provider);
  // v1.15.39：只输了邮箱前缀（没 @、像邮箱前缀）时不直接加——Outlook 有
  // outlook.com/hotmail.com/live.com 多个域名，必须让用户从候选里选一个，
  // 不然默认 @outlook.com 会把 Hotmail/Live 的号加错。纯标签（带空格/中文，
  // 比如“工作 Gmail”）不拦，照旧能加。Gmail/Proton 前缀已在上面补成完整邮箱。
  if (!label.includes('@') && /^[A-Za-z0-9._%+-]+$/.test(label)) {
    renderEmailSuggest();
    document.getElementById('newLabel').focus();
    return;
  }
  // v1.15.32：输入的邮箱带域名时（hotmail/outlook.com 等）按域名自动认服务商，盖掉下拉框的选择
  const detected = providerForEmail(label);
  if (detected) provider = detected;
  const { accounts = [] } = await chrome.storage.local.get(['accounts']);
  // v1.11.2：序号自动排号——取该服务商下最小的未用序号（从 0 开始），不用手动填
  const used = new Set(accounts.filter(a => a.provider === provider).map(a => a.index ?? 0));
  let index = 0;
  while (used.has(index)) index++;
  // 标签本身是邮箱时也填到 email 里，省得登录时再认
  const email = label.includes('@') ? label : '';
  accounts.push({ id: `${provider}-${index}-${Date.now()}`, provider, index, label: label || `${provider} ${index + 1}`, email, enabled: true, unread: 0, messages: [], status: 'need-login', lastCheck: 0 });
  await chrome.storage.local.set({ accounts });
  document.getElementById('newLabel').value = '';
  await chrome.runtime.sendMessage({ type: 'mmn-check-now', discover: false }).catch(() => {});
  load();
};

document.getElementById('discoverBtn').onclick = async () => {
  await chrome.runtime.sendMessage({ type: 'mmn-check-now', discover: true }).catch(() => {});
  load();
};

// Proton 没法像 Gmail 那样扫接口：必须先在标签页里登好，再从已开的标签页认序号
// Outlook 不再从标签页发现（改走 OAuth 登录，序号没有意义）
document.getElementById('discoverTabsBtn').onclick = async () => {
  const tabs = await chrome.tabs.query({ url: ['https://mail.proton.me/*'] });
  const found = [];
  for (const t of tabs) {
    const m = (t.url || '').match(/mail\.proton\.me\/u\/(\d+)/);
    if (m) found.push({ provider: 'proton', index: parseInt(m[1], 10) });
  }
  const { accounts = [] } = await chrome.storage.local.get(['accounts']);
  let added = 0;
  for (const f of found) {
    if (accounts.some(a => a.provider === f.provider && (a.index ?? 0) === f.index)) continue;
    accounts.push({ id: `${f.provider}-${f.index}-${Date.now()}-${added}`, provider: f.provider, index: f.index, label: `${f.provider} ${f.index + 1}`, email: '', enabled: true, unread: 0, messages: [], status: 'need-login', lastCheck: 0 });
    added++;
  }
  await chrome.storage.local.set({ accounts });
  alert(added ? `从标签页发现 ${added} 个账号，已加上` : '没发现新账号：先把 Proton 的收件箱标签页打开（第二个号是 /u/1/），再点这个按钮');
  await chrome.runtime.sendMessage({ type: 'mmn-check-now', discover: false }).catch(() => {});
  load();
};

// Outlook 也可以从标签页发现：先在标签页里登好 Outlook（新版 Outlook 支持多账号，地址是 /mail/0/、/mail/1/……），
// 再点这个按钮，按标签页的序号加账号（邮箱能读到就直接填，读不到先留空，点“登录”时自动填）。
// 读邮箱只靠 content-outlook.js 扫 DOM 里的账号信息，不碰任何凭证；未读数还是走 Graph OAuth。
document.getElementById('discoverOutlookBtn').onclick = async () => {
  const tabs = await chrome.tabs.query({ url: ['https://outlook.live.com/mail/*', 'https://outlook.office.com/mail/*', 'https://outlook.cloud.microsoft/mail/*'] });
  const found = new Map(); // 序号 -> 邮箱（同一个序号多个标签页只留一个）
  for (const t of tabs) {
    const m = (t.url || '').match(/\/mail\/(\d+)/);
    if (!m) continue;
    const idx = parseInt(m[1], 10);
    let email = '';
    try {
      const res = await chrome.tabs.sendMessage(t.id, { type: 'mmn-outlook-account' });
      if (res && res.email) email = res.email;
    } catch { /* 内容脚本还没注入（标签页是装新版前打开的）：先按序号加，登录时自动填邮箱 */ }
    if (!found.has(idx)) found.set(idx, email);
    else if (email && !found.get(idx)) found.set(idx, email);
  }
  const { accounts = [] } = await chrome.storage.local.get(['accounts']);
  let added = 0;
  for (const [idx, email] of found) {
    if (accounts.some(a => a.provider === 'outlook' && (a.index ?? 0) === idx)) continue;
    if (email && accounts.some(a => a.provider === 'outlook' && (a.email || '').toLowerCase() === email.toLowerCase())) continue;
    accounts.push({ id: `outlook-${idx}-${Date.now()}-${added}`, provider: 'outlook', index: idx, label: email || `Outlook ${idx + 1}`, email: email || '', enabled: true, unread: 0, messages: [], status: 'need-login', lastCheck: 0 });
    added++;
  }
  await chrome.storage.local.set({ accounts });
  alert(added ? `从标签页发现 ${added} 个 Outlook 账号，已加上（再到下面 Outlook 登录区点登录）` : '没发现新账号：先把 Outlook 收件箱标签页打开（第二个号是 /mail/1/），刷新一次再点这个按钮；也可以直接在上面添加账号再点登录');
  await chrome.runtime.sendMessage({ type: 'mmn-check-now', discover: false }).catch(() => {});
  load();
};

document.getElementById('saveBtn').onclick = async () => {
  const settings = {
    intervalMinutes: Math.max(1, parseInt(document.getElementById('interval').value, 10) || 1),
    desktopNotif: document.getElementById('desktopNotif').checked,
    autoUpdateCheck: document.getElementById('autoUpdateCheck').checked,
    sound: document.getElementById('sound').checked,
    onlyImportant: document.getElementById('onlyImportant').checked,
    quietHours: document.getElementById('quietHours').checked,
    quietStart: document.getElementById('quietStart').value || '23:00',
    quietEnd: document.getElementById('quietEnd').value || '07:00',
    badgeColor: document.getElementById('badgeColor').value,
  };
  await chrome.storage.local.set({ settings });
  chrome.alarms.create('mmn-check', { periodInMinutes: settings.intervalMinutes });
  // v1.15.44：自动更新开关——开就建 12 小时定时检查，关就清掉
  if (settings.autoUpdateCheck !== false) chrome.alarms.create('mmn-update-check', { periodInMinutes: 720 });
  else chrome.alarms.clear('mmn-update-check');
  document.getElementById('saved').textContent = '已保存 ✓';
  setTimeout(() => { document.getElementById('saved').textContent = ''; }, 1500);
};

// v1.15.44：更新区——显示当前版/最新版/上次检查，点按钮立即查一次
async function refreshUpdateStatus() {
  try {
    document.getElementById('curVersion').textContent = 'v' + chrome.runtime.getManifest().version;
    const { updateInfo } = await chrome.storage.local.get(['updateInfo']);
    const el = document.getElementById('updateStatus');
    if (!updateInfo || !updateInfo.checkedAt) { el.textContent = '还没检查过。'; return; }
    const t = new Date(updateInfo.checkedAt).toLocaleString('zh-CN', { hour12: false });
    if (updateInfo.error) { el.textContent = `上次检查 ${t}：失败（${updateInfo.error}），稍后再试。`; return; }
    if (updateInfo.hasUpdate) {
      el.innerHTML = '';
      el.append(document.createTextNode(`上次检查 ${t}：有新版 v${updateInfo.latestVersion}，`));
      const a = document.createElement('a');
      a.href = updateInfo.releaseUrl || '#'; a.target = '_blank'; a.textContent = '点这里去 GitHub 下载';
      el.append(a);
      el.append(document.createTextNode('（解压覆盖安装后刷新）。'));
    } else {
      el.textContent = `上次检查 ${t}：已是最新版 v${updateInfo.curVersion || updateInfo.latestVersion}。`;
    }
  } catch {}
}
document.getElementById('updateCheckNowBtn').onclick = async () => {
  const btn = document.getElementById('updateCheckNowBtn');
  const tip = document.getElementById('updateChecked');
  btn.disabled = true; tip.textContent = '正在检查…';
  try {
    const r = await chrome.runtime.sendMessage({ type: 'mmn-check-update-now' });
    if (r && r.ok) {
      tip.textContent = r.info.hasUpdate ? `有新版 v${r.info.latestVersion}！` : (r.info.error ? '检查失败，稍后再试。' : '已是最新版。');
    } else {
      tip.textContent = '检查失败：' + (r && r.error || '后台没回话');
    }
  } catch (e) {
    tip.textContent = '检查失败：' + String(e && e.message || e);
  }
  btn.disabled = false;
  await refreshUpdateStatus();
  setTimeout(() => { tip.textContent = ''; }, 4000);
};

// 清理重复账号：Outlook 按邮箱小写去重（优先留有 token / 状态 ok 的行），其他服务商按原逻辑
document.getElementById('dedupBtn').onclick = async () => {
  const { accounts = [] } = await chrome.storage.local.get(['accounts']);
  const { outlookTokens = {} } = await chrome.storage.local.get(['outlookTokens']);
  const rank = (a) => {
    const t = outlookTokens[a.id];
    const hasToken = !!(t && (t.refresh_token || (t.access_token && t.expires_at > Date.now())));
    return (hasToken ? 2 : 0) + (a.status === 'ok' ? 1 : 0);
  };
  const seen = new Map();
  const kept = [];
  for (const a of accounts) {
    let key;
    if (a.provider === 'outlook' && (a.email || '').trim()) key = 'outlook|' + a.email.trim().toLowerCase();
    else key = a.provider + '|' + (a.email || a.label || '').toLowerCase() + '|' + (a.index ?? 0);
    if (!seen.has(key)) { seen.set(key, a); kept.push(a); continue; }
    const cur = seen.get(key);
    if (a.provider === 'outlook' && rank(a) > rank(cur)) {
      kept[kept.indexOf(cur)] = a;
      seen.set(key, a);
    }
  }
  await chrome.storage.local.set({ accounts: kept });
  alert(accounts.length - kept.length ? `删掉了 ${accounts.length - kept.length} 个重复账号` : '没有重复账号');
  load();
};

document.getElementById('resetBtn').onclick = async () => {
  if (!confirm('确定清空所有账号吗？')) return;
  await chrome.storage.local.set({ accounts: [] });
  load();
};

// 设置页不用手动刷新：每 5 秒原地更新未读数和状态；账号增减时（非编辑状态下）重建列表
setInterval(async () => {
  const { accounts = [] } = await chrome.storage.local.get(['accounts']);
  for (const acc of accounts) {
    const tr = document.querySelector(`tr[data-acc-id="${CSS.escape(acc.id)}"]`);
    if (!tr) continue;
    const tds = tr.querySelectorAll('td');
    if (tds[3]) tds[3].textContent = String(acc.unread || 0);
    if (tds[4]) tds[4].textContent = acc.status || '-';
  }
}, 5000);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.accounts) return;
  if (document.activeElement && document.activeElement.closest && document.activeElement.closest('#accTable')) return; // 正在改标签，不打断
  load();
});

load();

async function loadDiag() {
  const r = await chrome.runtime.sendMessage({ type: 'mmn-get-diag' }).catch(() => ({ log: [] }));
  document.getElementById('diagLog').textContent = (r.log || []).join('\n') || '还没有日志。点“立即检查一次”，等 10 秒再点“刷新日志”。';
}
document.getElementById('diagRefreshBtn').onclick = loadDiag;
document.getElementById('diagCheckBtn').onclick = async () => {
  document.getElementById('diagSaved').textContent = '检查中…';
  await chrome.runtime.sendMessage({ type: 'mmn-check-now' }).catch(() => {});
  setTimeout(async () => { await load(); await loadDiag(); document.getElementById('diagSaved').textContent = '已检查 ✓'; setTimeout(() => document.getElementById('diagSaved').textContent = '', 1500); }, 3000);
};
document.getElementById('diagCopyBtn').onclick = async () => {
  const r = await chrome.runtime.sendMessage({ type: 'mmn-get-diag' }).catch(() => ({ log: [] }));
  await navigator.clipboard.writeText((r.log || []).join('\n'));
  document.getElementById('diagSaved').textContent = '已复制 ✓ 贴给我就行';
  setTimeout(() => document.getElementById('diagSaved').textContent = '', 2000);
};
document.getElementById('diagClearBtn').onclick = async () => {
  await chrome.runtime.sendMessage({ type: 'mmn-clear-diag' }).catch(() => {});
  await loadDiag();
};
loadDiag();

document.getElementById('extVersion').textContent = 'v' + chrome.runtime.getManifest().version;

// v1.15.22：主题三档（自动/暗黑/白色）。auto 时不设 data-theme，靠 CSS 的
// prefers-color-scheme 跟系统走；dark/light 强制对应主题。点一下立即应用并保存。
function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'dark') root.dataset.theme = 'dark';
  else if (theme === 'light') root.dataset.theme = 'light';
  else delete root.dataset.theme;
}
document.querySelectorAll('#themeSeg button').forEach(b => {
  b.onclick = async () => {
    const theme = b.dataset.theme;
    applyTheme(theme);
    document.querySelectorAll('#themeSeg button').forEach(x => x.classList.toggle('on', x === b));
    const { settings = {} } = await chrome.storage.local.get(['settings']);
    await chrome.storage.local.set({ settings: { ...settings, theme } });
  };
});

// v1.15.22：鼠标跟随光斑——鼠标移到卡片上时，把位置写进 --mx/--my，
// CSS 的 ::before 用径向渐变画一层跟着鼠标走的柔光。
document.querySelector('.wrap').addEventListener('mousemove', (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  const r = card.getBoundingClientRect();
  card.style.setProperty('--mx', (e.clientX - r.left) + 'px');
  card.style.setProperty('--my', (e.clientY - r.top) + 'px');
});

// v1.15.22：WebDAV 备份/恢复。只备份账号和设置，不备份登录 token 和 WebDAV 密码。
// 坚果云地址 https://dav.jianguoyun.com/dav/；InfiniCLOUD（TeraCLOUD）地址
// https://higa.teracloud.jp/dav/（用户实测，之前写的 dav.infini-cloud.net 不通）。
// v1.15.24：每次备份存一个带日期时间的文件（multi-mail-notifier-backup-YYYYMMDD-HHmmss.json），
// 恢复时按最新日期列出，最多显示三个。
const DAV_PRESETS = {
  jianguoyun: 'https://dav.jianguoyun.com/dav/',
  infinicloud: 'https://higa.teracloud.jp/dav/',
  custom: '',
};
const DAV_FILE_PREFIX = 'multi-mail-notifier-backup';
const DAV_FILE = 'multi-mail-notifier-backup.json'; // 旧版单文件，恢复时也认
function davStampedName() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${DAV_FILE_PREFIX}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.json`;
}
function davFileNameFromHref(href) {
  // v1.15.41：只看 href 最后一段文件名（完整 URL、带 ?# 后缀都认），解码失败也不炸
  let decoded = href;
  try { decoded = decodeURIComponent(href); } catch { decoded = href; }
  const seg = decoded.split(/[?#]/)[0].split('/').filter(Boolean).pop() || '';
  const m = seg.match(/^multi-mail-notifier-backup(?:-(\d{8})-(\d{6}))?\.json$/);
  if (!m) return null;
  if (!m[1]) return { name: DAV_FILE, date: null }; // 旧版单文件，无日期
  const ds = m[1], ts = m[2];
  return { name: `${DAV_FILE_PREFIX}-${ds}-${ts}.json`, date: `${ds.slice(0, 4)}-${ds.slice(4, 6)}-${ds.slice(6, 8)} ${ts.slice(0, 2)}:${ts.slice(2, 4)}:${ts.slice(4, 6)}` };
}
async function loadDavForm() {
  const { webdav = {} } = await chrome.storage.local.get(['webdav']);
  const preset = webdav.preset || 'jianguoyun';
  document.getElementById('davPreset').value = preset;
  document.getElementById('davUrl').value = webdav.url || DAV_PRESETS[preset] || '';
  document.getElementById('davUser').value = webdav.user || '';
  document.getElementById('davPass').value = webdav.pass || '';
}
document.getElementById('davPreset').onchange = () => {
  const preset = document.getElementById('davPreset').value;
  const urlInput = document.getElementById('davUrl');
  // 切预设时把地址换成预设地址；自定义留空让用户自己填
  urlInput.value = DAV_PRESETS[preset] || '';
};
function davBase() {
  return document.getElementById('davUrl').value.trim().replace(/\/+$/, '');
}
function davFileUrlFor(name) {
  return davBase() + '/' + name;
}
function davAuth() {
  const user = document.getElementById('davUser').value.trim();
  const pass = document.getElementById('davPass').value;
  return 'Basic ' + btoa(unescape(encodeURIComponent(user + ':' + pass)));
}
async function saveDavForm() {
  await chrome.storage.local.set({ webdav: {
    preset: document.getElementById('davPreset').value,
    url: document.getElementById('davUrl').value.trim(),
    user: document.getElementById('davUser').value.trim(),
    pass: document.getElementById('davPass').value,
  } });
}
// 自定义服务器要先申请这个域名的访问权限（内置服务商已在 manifest 里，不用申请）
async function ensureDavPermission(url) {
  try {
    const origin = new URL(url).origin;
    if (origin === 'https://dav.jianguoyun.com' || origin === 'https://dav.infini-cloud.net' || origin === 'https://higa.teracloud.jp') return true;
    const granted = await chrome.permissions.request({ origins: [origin + '/*'] });
    return !!granted;
  } catch { return false; }
}
// v1.15.24：测试连接——PROPFIND 一下根目录，看服务器通不通、账号密码对不对
document.getElementById('davTestBtn').onclick = async () => {
  const st = document.getElementById('davStatus');
  const btn = document.getElementById('davTestBtn');
  const url = document.getElementById('davUrl').value.trim();
  if (!url || !document.getElementById('davUser').value.trim()) { st.textContent = '先填 WebDAV 地址和账号'; return; }
  btn.disabled = true; st.textContent = '测试连接中…';
  try {
    if (!await ensureDavPermission(url)) { st.textContent = '未授予该服务器的访问权限'; return; }
    const res = await fetch(davBase() + '/', { method: 'PROPFIND', headers: { 'Authorization': davAuth(), 'Depth': '0' } });
    if (res.status === 207 || res.status === 200) { await saveDavForm(); st.textContent = '连接成功 ✓ 服务器通，账号密码正确'; }
    else if (res.status === 401) st.textContent = '账号或密码不对（HTTP 401）';
    else if (res.status === 404) st.textContent = '服务器通了，但这个地址不对（HTTP 404）';
    else st.textContent = '服务器返回 HTTP ' + res.status + '，可能地址不对';
  } catch (e) {
    st.textContent = '连不上服务器：' + (e && e.message ? e.message : e) + '（检查地址和网络）';
  } finally { btn.disabled = false; }
};
document.getElementById('davUploadBtn').onclick = async () => {
  const st = document.getElementById('davStatus');
  const btn = document.getElementById('davUploadBtn');
  const url = document.getElementById('davUrl').value.trim();
  if (!url || !document.getElementById('davUser').value.trim()) { st.textContent = '先填 WebDAV 地址和账号'; return; }
  btn.disabled = true; st.textContent = '备份中…';
  try {
    if (!await ensureDavPermission(url)) { st.textContent = '未授予该服务器的访问权限'; return; }
    const { accounts = [] } = await chrome.storage.local.get(['accounts']);
    const { settings = {} } = await chrome.storage.local.get(['settings']);
    const payload = JSON.stringify({ app: 'multi-mail-notifier', version: 1, exportedAt: new Date().toISOString(), accounts, settings }, null, 2);
    const name = davStampedName();
    const res = await fetch(davFileUrlFor(name), { method: 'PUT', headers: { 'Authorization': davAuth(), 'Content-Type': 'application/json' }, body: payload });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    await saveDavForm();
    st.textContent = `备份成功 ✓（${accounts.length} 个账号，${name}）`;
  } catch (e) {
    st.textContent = '备份失败：' + (e && e.message ? e.message : e) + '（账号或密码不对、地址不对都会这样）';
  } finally { btn.disabled = false; }
};
// v1.15.24：恢复先列出服务器上的备份（PROPFIND），按最新日期排，最多显示三个，点哪个恢复哪个
// v1.15.41：PROPFIND 返回的 href 不一定用 d: 前缀——InfiniCLOUD/TeraCLOUD 这类服务器常返回
// 大写 D: 或别的命名空间前缀，旧的 /<(?:d:)?href>/ 正则一个都抓不到，就报“还没有备份文件”。
// 改成 DOMParser 按 localName 取 href（任何前缀都认），再用正则兜底。返回 { backups, total }，
// total 是服务器返回的条目数，0 个备份时状态栏会写“服务器共返回了 N 个条目”，帮着判断是真没
// 备份还是名字/目录对不上。
async function listDavBackups() {
  const res = await fetch(davBase() + '/', { method: 'PROPFIND', headers: { 'Authorization': davAuth(), 'Depth': '1', 'Content-Type': 'application/xml' }, body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/></d:prop></d:propfind>' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const text = await res.text();
  let hrefs = [];
  try {
    const doc = new DOMParser().parseFromString(text, 'text/xml');
    hrefs = [...doc.getElementsByTagNameNS('*', 'href')].map(n => n.textContent || '');
    if (!hrefs.length) throw new Error('no href in xml');
  } catch {
    hrefs = [...text.matchAll(/<[^>]*href>([^<]+)<\/[^>]*href>/g)].map(m => m[1]);
  }
  const found = [];
  for (const h of hrefs) {
    const f = davFileNameFromHref(h);
    if (f) found.push(f);
  }
  // 带日期的按日期倒序排最前面；旧版单文件（无日期）放最后
  found.sort((a, b) => {
    if (a.date && b.date) return b.name.localeCompare(a.name);
    if (a.date) return -1;
    if (b.date) return 1;
    return 0;
  });
  return { backups: found.slice(0, 3), total: hrefs.length };
}
// v1.15.41：列出备份 + 每行“恢复这个 / 删除”。删完重新列一遍，列表自己刷新。
async function refreshDavBackupList() {
  const st = document.getElementById('davStatus');
  const listEl = document.getElementById('davBackupList');
  st.textContent = '正在找服务器上的备份…';
  listEl.innerHTML = '';
  try {
    const { backups, total } = await listDavBackups();
    if (!backups.length) {
      st.textContent = total > 0
        ? `服务器上没有找到备份文件（服务器共返回了 ${total} 个条目，可能是备份在别的目录或文件名不对）`
        : '服务器上还没有备份文件（先点“备份到 WebDAV”）';
      return;
    }
    st.textContent = `找到 ${backups.length} 个备份（最新在前），点一个恢复，或点“删除”删掉某一天的：`;
    for (const b of backups) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:8px';
      const label = document.createElement('span');
      label.textContent = (b.date || '旧版备份（无日期）') + ' · ' + b.name;
      label.style.fontWeight = '600';
      const rb = document.createElement('button');
      rb.textContent = '恢复这个';
      rb.onclick = async () => {
        if (!confirm(`从 ${b.date || b.name} 恢复？会覆盖这台电脑上的账号和设置。`)) return;
        rb.disabled = true; st.textContent = '恢复中…';
        try {
          const res = await fetch(davFileUrlFor(b.name), { method: 'GET', headers: { 'Authorization': davAuth() } });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const data = await res.json();
          if (!data || !Array.isArray(data.accounts)) throw new Error('备份文件格式不对');
          await chrome.storage.local.set({ accounts: data.accounts, settings: data.settings || {} });
          await saveDavForm();
          st.textContent = `恢复成功 ✓（${data.accounts.length} 个账号，${b.date || b.name}），正在刷新…`;
          setTimeout(() => load(), 600);
        } catch (e) {
          st.textContent = '恢复失败：' + (e && e.message ? e.message : e);
        } finally { rb.disabled = false; }
      };
      const del = document.createElement('button');
      del.textContent = '删除';
      del.onclick = async () => {
        if (!confirm(`删除 ${b.date || b.name}？服务器上这个备份文件会被删掉，删了找不回来。`)) return;
        del.disabled = true; rb.disabled = true; st.textContent = '删除中…';
        try {
          const res = await fetch(davFileUrlFor(b.name), { method: 'DELETE', headers: { 'Authorization': davAuth() } });
          if (!res.ok && res.status !== 404) throw new Error('HTTP ' + res.status);
          st.textContent = `已删除 ${b.date || b.name}，正在刷新列表…`;
          await refreshDavBackupList();
        } catch (e) {
          st.textContent = '删除失败：' + (e && e.message ? e.message : e);
        } finally { del.disabled = false; rb.disabled = false; }
      };
      row.append(label, rb, del);
      listEl.append(row);
    }
  } catch (e) {
    st.textContent = '找备份失败：' + (e && e.message ? e.message : e);
  }
}
document.getElementById('davDownloadBtn').onclick = async () => {
  const st = document.getElementById('davStatus');
  const btn = document.getElementById('davDownloadBtn');
  const url = document.getElementById('davUrl').value.trim();
  if (!url || !document.getElementById('davUser').value.trim()) { st.textContent = '先填 WebDAV 地址和账号'; return; }
  btn.disabled = true;
  try {
    if (!await ensureDavPermission(url)) { st.textContent = '未授予该服务器的访问权限'; return; }
    await refreshDavBackupList();
  } finally { btn.disabled = false; }
};
loadDavForm();
