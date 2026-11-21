# Multi Mail Notifier v1.15.60
Multi Mail Notifier 是一款适用于 Chrome、Edge、Firefox、Dia 和 Brave 的免费浏览器扩展（Gmail 通知工具）：它检查浏览器里登录的每个 Gmail 账号和你添加的 Outlook.com 账号、Proton 账号，只提醒需要你处理的邮件，并让登录验证码一键可用。

## v1.15.60：Proton 也提验证码、补时间

Proton 一直漏了两样，Gmail 和 Outlook 早就有了：列表里没有 `code`（验证码提不出来），也没有 `time`（按时间排序会沉到底，时间也显示不出来）。收件箱和垃圾箱两处一起补上。教训：改东西要三家一起查，不能只改两家等用户一个一个提示。

## v1.15.59：正在读邮件时不重画列表

v1.15.58 修了自动标已读，但还有一条路会把阅读器弄没：后台每 30 秒查完就往 storage 写 accounts，弹窗一监听到变化就整块重画列表，正在翻译的阅读器被一起重画掉。改成：读着邮件的时候不重画（攒着），收起后再补刷一次。

## v1.15.58：点开邮件不再自动标已读

以前点开一封邮件，正文一读完就自动标已读，30 秒一刷新它就从未读列表里没了——翻译还没看完它先走了。改成：点开只看正文，不标已读；只有点“标已读/删除/归档”它才从列表里消失。收起也只折叠正文，邮件还留在列表里。

## v1.15.57：同时检查垃圾邮件改成默认开

v1.15.56 加的“同时检查垃圾邮件”开关默认是关的，用户反馈光加安全发件人没用（新发件人还是会进垃圾箱），插件应当直接能收到垃圾箱里的邮件。所以改成默认开着：装上就直接收 Outlook 垃圾邮件文件夹、Gmail 垃圾邮件（SPAM）、Proton 垃圾邮件（LabelID=4）里的未读，弹窗里带黄色的“垃圾邮件”标记，未读数也算进去；不想看就去设置页关掉。垃圾邮件只在弹窗里显示，不弹桌面通知（只报收件箱的新邮件）。

## v1.15.55：修验证码误认（QQ 号当验证码）

提验证码前先去掉邮箱地址和网址，再删掉“没关键词也抓任意 4-8 位数字”的兜底——只认“验证码”等关键词附近的数字。之前 `56959566@qq.com` 里的 QQ 号会被当成验证码显示。真验证码（关键词在旁边）不受影响。

## v1.15.54：翻译主接口换成 clients5

翻译主接口从 gtx 换成 `clients5.google.com/translate_a/t?client=dict-chrome-ex`（POST，一次约 4500 字，返回 [["译文","源语言"]]）：gtx 在数据中心/共享 IP 上容易被 429，clients5 更抗限流（2026-11-19 实测本机 gtx 被拦、clients5 POST 正常，本机 VM 共享 IP 上 clients5 也通）。兜底顺序：clients5 → gtx → MyMemory。

## v1.15.53：正文翻译（Google 免费接口）+ 检查间隔改 30 秒

检查间隔默认从 1 分钟改成 30 秒（0.5 分钟）：Chrome 重复闹钟最小 1 分钟，所以 30 秒用一次性闹钟连锁实现（响一次再设下一个），带防重叠保护（上次检查没跑完就跳过这次）。设置页间隔输入框最小改成 0.5 分钟，步长 0.5。老默认 1 分钟一次性迁移到 0.5 分钟（只迁一次；之后在设置页改回 1 分钟不会被再改回去）。

## v1.15.53：正文翻译（Google 免费接口）

弹窗读邮件时，工具行多了个“翻译”：点一下把正文翻成简体中文（Google 免费接口，不用 key、不存账号；主接口 clients5，依次兜底 gtx、MyMemory），再点“原文”切回来；译文缓存，切换不重复请求；正文已是中文就不发请求。长正文按段落分块翻，换行还在。

## v1.15.52：manifest 描述改短（为上架 Edge）
- Edge 要求 manifest 的 description 最多 132 个字符，原中文描述超长导致上传校验失败。改成英文短描述：“Check unread mail across Gmail, Outlook, Hotmail, Live and Proton accounts in one popup. No password needed.”（105 字符）。

## v1.15.51：加隐私政策（为上架 Edge 准备）
- 新增 PRIVACY.md（扩展文件夹内，GitHub 上可公开访问，供商店隐私政策链接用）。功能无改动。

## v1.15.50：rail 圆标改两个色
- Hotmail 改 #fa6604、Outlook 改 #1a4bbb（用户 15:13 改的色值）；Proton #d444f1、Gmail #12b76a、Live #2cb2fc 不动。
- 这两个新色都是深色，字母恢复白字（亮度判断自动切，不用改代码）。

## v1.15.49：弹窗左侧 rail 圆标按服务商固定着色
- 首字母圆标不再按账号 hash 随机挑色，改成按服务商固定：Proton #d444f1、Gmail #12b76a、Outlook #7ddeff、Hotmail #fdc347、Live #2cb2fc；其它后缀（认不出的域名）按账号 hash 从另一组颜色里稳定挑一个，避开上面五个避免撞色。
- 字母颜色按底色亮度自动切：Outlook #7ddeff 和 Hotmail #fdc347 是浅色，字母用深色字，不然白字看不清；深底还是白字。

## v1.15.48：更新提示点一下直接下载 zip
- 设置页“更新”区查到新版时，链接改成直接下 zip（`downloadUrl`），不再跳发布页——之前点链接是打开发布页，还得再点一次 zip 才能下。

## v1.15.47：联系作者加 Telegram
- 设置页“联系作者”卡和 README 底部加了 Telegram：[@djkyc](https://t.me/djkyc)。

## v1.15.46：补版权说明 + 支持 Dia 和 Brave
- **版权**：扩展文件夹里加了 `LICENSE`（Apache License 2.0，跟仓库根目录那份一样），README 底部加了版权说明。Copyright © 2026 djkyc。
- **支持的浏览器**：Chrome、Edge、Firefox、Dia、Brave 都能用。Dia 和 Brave 都是 Chromium 内核，跟 Chrome 一个引擎，所以**同一份代码、同一个 zip**，不用单独打包。装法都一样：打开浏览器的扩展页 → 开开发者模式 → “加载已解压的扩展程序” → 选这个文件夹。Chromium 浏览器扩展页地址：Chrome 是 `chrome://extensions/`，Edge 是 `edge://extensions/`，Brave 是 `brave://extensions/`，Dia 是 `dia://extensions/`；Firefox 是 `about:debugging` → “此 Firefox” → “临时载入附加组件”（临时加载，重启失效；想长期用要走 Firefox 附加组件站签名发布）。
- 上架应用商店的话，一个 Chrome 应用商店的上架能覆盖 Chrome、Edge、Dia、Brave（都是 Chromium，都能从 Chrome 应用商店装扩展）；Edge 附加组件站和 Firefox 附加组件站是另外两个商店，要分开上架。

## v1.15.45：更新检查改读 version.json（仓库是 browser-plug-in）
- 仓库是 `djkyc/browser-plug-in`（一个仓库放多个插件，扩展在 `multi-mail-notifier/` 文件夹里），Release 是整个仓库共用的，查 Releases API 会拿到别的插件的版本，所以更新检查改成读本插件文件夹里的 `version.json`（`https://raw.githubusercontent.com/djkyc/browser-plug-in/main/multi-mail-notifier/version.json`），里面写最新版号和下载链接。manifest 的 host 权限也从 `api.github.com` 换成 `raw.githubusercontent.com`。
- 发布新版时：manifest 升版号 → 打包新 zip → 把 `version.json` 里的 `version`/`url`/`download` 改成新的 → 推到 GitHub（zip 挂到 Release 上，tag 写 `multi-mail-notifier-v1.15.45` 这种）。

## v1.15.44：自动检查更新（GitHub）
- **设置页“提醒”区加了“自动检查更新”开关**：开着时，扩展每天去 GitHub 查一次有没有新版本（每 12 小时一次 + 启动时超过 6 小时没查过就查一次）；关掉就不查了。开关在设置页，改完点“保存设置”生效。
- **“更新”区**：显示当前版本和最新版本，点“立即检查更新”马上查一次；查到新版会弹桌面通知，点通知打开 GitHub 发布页下载新 zip。
- **注意**：扩展不能自己给自己换代码（Chrome 不允许），所以查到新版后要手动下载新 zip、解压覆盖安装后点扩展卡片上的刷新。想完全静默自动更新，只能上架 Chrome 应用商店（Chrome 每隔几小时自动帮用户升版）。
- 更新检查走本插件文件夹里的 `version.json`（raw.githubusercontent.com），拿里面的版号跟当前版比。仓库名和地址在 background.js 顶部的 `UPDATE_JSON_URL`，换仓库改那一行就行。

## v1.15.43：主图标换成红圈版
- 主图标（icon16/48/128.png）换成白底圆 + 细红圈 #e5392c + 里面红信封 #e5392c + 白 V 加粗，信封带投影和翻盖阴影。

## v1.15.42：Hotmail 徽章换成橙信封
- Hotmail 徽章换成官方 Hotmail logo (2011-2013).png 里抠出来的橙色信封（不要右边的字），存成 icons/logo-hotmail.png。

## v1.15.41：修 WebDAV 恢复找不到备份 + 每行加删除
- WebDAV 列备份时 PROPFIND 的 href 解析改成按 localName 取（大小写前缀都认），InfiniCLOUD/TeraCLOUD 返回大写 `D:` 前缀也能列出来；0 个备份时状态栏会写服务器共返回了几个条目，方便分清是空目录还是名字对不上；每行备份加了“删除”按钮。

## v1.15.40：Hotmail/Live 徽章拆分
- Hotmail 用 MSN Hotmail logo.svg 的红椭圆+白 msn，Live 从 Hotmail 拆出来用 Outlook.com 图标的蓝 O 方块。
- **根因**：Outlook 网页版同一个浏览器会话里一次只能有一个活跃账号，/mail/N/ 是浏览器里登录的顺序槽位，不是扩展自己的序号。之前两个个人号都写死开 /mail/0/，0 号槽位是哪个邮箱由浏览器定，点 adjlevis@outlook.com 却进了 hotmail就是这么来的。拿扩展的 index 拼 /mail/N/ 也一样会串（扩展里 adjlevis@outlook.com 是 index 0，可浏览器里 0 号槽位是 hotmail）——这正是 v1.15.8 拆掉的做法，不要再用。
- **改法**：从真实标签页上学槽位。内容脚本在 Outlook 标签页加载后主动上报（当前登录的邮箱 + 地址栏里的 /mail/N/ 槽位），后台记在 outlookSlots 里；扫已开标签页时也顺便记。以后“打开收件箱”按学到的槽位开；还没学到的，逐个槽位试（复用同一个标签页），试出来就记下来，以后直接开对的槽位。新开标签页后会把 lastTabId 记下来，下次直接切过去。工作/学校号走 office.com，没有槽位。

## v1.15.11：邮件按邮箱分组 + 验证码提得更准
- **显示改回按邮箱分组**：每个账号条下面就是这个号的未读邮件（本号内按时间倒序），不再所有账号混成一个列表；每行只带时间，不再带账号标签（账号看上面的条）。搜索、点账号名打开收件箱、点邮件读全文、标已读/归档/删除立刻消失都还在。
- **验证码提得更准（跟 Peekat 一个思路）**：之前只取标题+摘要里第一个 4-8 位数字，年份 2025 这种也会被当成验证码，正文里的码又提不到。现在先找“验证码/verification code/OTP”这类词附近的 4-8 位数字；没有关键词时再找独立的数字，但排除年份（1900-2099），优先 6 位。点开邮件读正文时，还会从全文里再提一次码，有就更新这行的徽标（点一下复制）。Proton 正文是加密的，后台解不开，码只能从标题+摘要里提。

## v1.15.10：点标已读/归档/删除立刻消失
- **问题**：之前点操作按钮要等后台调完 API 再重查一遍（Proton 还要翻页）才刷新列表，点下去那封还留在那里几秒，看着像没删。
- **改法**：点下去立刻把这行从列表拿掉、未读数减 1，后台慢慢做；后台失败会重新加载把这封恢复回来，并在账号条下显示失败原因。操作状态行之前只有 Gmail/Outlook 有，Proton 操作失败看不到报错，现在三个号都有（空的时候自动隐藏，不占地方）。

## v1.15.9：Proton 未读数改成按封数算
- **问题**：后台查 Proton 只拿 conversations 接口第一页，旧的未读邮件不在第一页里就漏数成 0（标签页标题里却是 82 封），两个数还互相覆盖，弹窗里的数字一会儿 82 一会儿 0。
- **改法**：后台按 `Page`/`PageSize=100` 翻页（最多 10 页），把每页会话的 `NumUnread` 加起来就是收件箱未读总封数，跟标签页标题一致；弹窗列表还是列未读会话（最多 10 个，最近的在前）。会话太多翻不完时，诊断日志里会说明只数了前多少个。
- 注意：如果设置里有两个 Proton 行是同一个邮箱（比如改名时旧的“proton 4”没删、新行又冒出来了），两个行会各数一遍，总数会翻倍——把重复的那行删掉，只留一个。

## v1.15.8：弹窗改成 Peekat 式统一列表 + 点账号不再串号
- **弹窗显示改成 Peekat 的思路**：不再按账号分组卡片，所有账号的未读邮件按时间排成一个列表（最新在前），每行带账号标签和时间，一眼看到所有收件箱的新邮件；点邮件还是在弹窗里读全文、读完自动标已读。账号条留在上面（每账号一行：邮箱 + 未读数 + 写邮件），点账号名打开这个号的收件箱。
- **点账号不再串号**：之前点 liu687836@outlook.com 会打开 adjlevis@hotmail.com 的邮箱，是因为收件箱地址用我们自己的序号拼 /mail/N/，那个序号跟浏览器里 Outlook 会话的槽位对不上。现在打开收件箱先找这个号已经打开的标签页（Outlook 靠 content-outlook.js 读标签页里当前登录的邮箱，对上了直接切过去），没找到才新开；新开的地址也按 Peekat 的办法：个人号（outlook/hotmail/live/msn）开 https://outlook.live.com/mail/0/inbox，工作/学校号开 https://outlook.office.com/mail/inbox，不再拼序号。点具体某封邮件的“在 Outlook 中打开”开 .../deeplink/read/<id> 定位到这封。
- **设置页每账号一行加了“打开”按钮**：直接打开这个号的收件箱（跟弹窗点账号名同一个办法）。

## v1.15.7：简介改成你给的那段话
- manifest.json 的 description 和 README 开头改成 2026-11-18 16:23 你给的简介原文（前面补了产品名当主语，Outlook.com 账号和 Proton 账号之间补了一个“、”）。
- 注意：简介里写了 Firefox，但当前 manifest 是 MV3 Chromium 写法，Firefox 上能不能装还没验证过——上架 Firefox 之前要先实测。
- 其余同 v1.15.6（Gmail/Outlook 全部用自己的应用）。

## v1.15.6：Gmail 也全部用自己的
- Google 下拉只剩“自己的 Google 应用”和“自定义”，雷鸟 / Peekat 的 Google ID 已从代码和下拉里拿掉（它俩登不进去，留着只会误导）；以前存的 thunderbird/peekat 选择，装上这版后一次性自动迁回 own。
- Outlook 那边 v1.15.5 已经是全部用自己的了，这版起 Gmail 和 Outlook 都是只用自己的应用。

## v1.15.5：Outlook 默认改回自己的 Azure 应用（v1.15.3 改错了）
- v1.15.3 把 Outlook 默认 Client ID 改成雷鸟公开 ID 是错的：在 login.live.com 端点实测，雷鸟和 Peekat 的微软 ID 都不认我们的回调地址（`invalid_request: redirect_uri is not valid`），只有自己的 Azure 应用认。之前说“微软对公开客户端回调放得宽”是误判——当时只看了 login.microsoftonline.com 的初始登录页，那里不校验回调地址，真正的校验在跳转到 live.com 之后才发生。
- Outlook 下拉只剩“自己的 Azure 应用”和“自定义”；被 v1.15.3 迁到 thunderbird/peekat 的选择，装上这版后一次性自动迁回 own（已登录账号的 token 刷新不受影响，走的还是原来那个 ID）。
- Gmail 那边没动，还是 v1.15.4 的隐式流程。

## v1.15.4：Gmail 改走隐式流程，密钥彻底不要了
- Gmail 改走**隐式流程**（跟 Peekat 一样）：`response_type=token`，Google 直接把 access_token 放在回调地址的 `#fragment` 里返回，**不拿 code 换 token、不要 client_secret、也不存 refresh_token**。之前那个“登录失败：请先在设置页填 Google Client Secret”就是因为密钥从来没存过——这版之后这个报错永远不会再出现，密钥行、密钥输入框、密钥提示全部没了。
- token 有效期约 1 小时，到期后台**静默续**（`launchWebAuthFlow` interactive:false + prompt=none，不弹窗；浏览器里还登着 Google 就能直接拿到新 token；静默续失败才标需重新登录；10 分钟内失败过的不重复撞）。
- 给别人用也不用填任何东西：Client ID 是内置的（自己的 Google 应用 MultiMailNotifier），用户只点“登录”。Outlook 那边 v1.15.5 起也只用自己的 Azure 应用（雷鸟/Peekat 的微软公开 ID 已拿掉）。
- 设置页 Google Client Secret 输入行和下面那句说明已整段删除。

## v1.15.3：默认 Client ID、Google 三个预设、Outlook 发现按钮、顶部说明改版
- **Outlook 默认改成雷鸟的公开 ID**：下拉顺序改成雷鸟（默认）/ 自己的 Azure 应用 / Peekat / 自定义。升级后之前存的“自己的”会一次性切到雷鸟（只切一次，之后你自己切回自己的不会再被改）。已登录的两个 Outlook 号不受影响：token 里现在记了发 token 时用的 clientId，刷新还走原来的 ID，不会掉线；新登录才用雷鸟的 ID。微软不认换了 client 的 refresh_token，不绑 ID 的话改默认会把已登录的号顶掉，这个坑已避开（Gmail 也一样绑了）。
- **Google 下拉也有三个预设了，但默认还是自己的**：雷鸟（406964657835-…）和 Peekat（596819905515-…）的 Google ID 都放进下拉了，只是让用户看得到——它俩在我们扩展上登不进去，2026-11-18 实测 Google 都报 redirect_uri_mismatch（Google 只认注册在它名下的回调地址，别人的 ID 永远登不进），选了它俩再点登录会直接拦截报错，不会打开一个必定失败的登录窗。默认保持自己的 Google 应用，是唯一能用的。**v1.15.6 已把这俩从下拉和代码里拿掉，全部用自己的。**
- **Google Client Secret 那行没全删**：用自己的 ID（Web 应用客户端）时换 token 必须带密钥，删了 Gmail 登录就坏；只有选雷鸟/Peekat 的公开 ID 时，这行和下面的说明会自动藏起来（公开客户端不用密钥），切回自己的/自定义又会出现。
- **“自动发现”那行加了 Outlook**：新增“从标签页发现 Outlook 账号”按钮——先把 Outlook 收件箱标签页打开（新版 Outlook 支持多账号，地址是 /mail/0/、/mail/1/……），再点按钮，按标签页序号加账号，邮箱能读到就直接填，读不到先留空、点“登录”时自动填。读邮箱只靠新加的 content-outlook.js 扫 DOM 里的账号信息，不碰凭证、不读邮件、不上报未读（未读数还是走 Graph）。
- **顶部“不用输密码”那段改成三行**：之前是一大段挤在一起的文字，现在是 Gmail / Outlook / Proton 各一行，名字在左、做法在右，扫一眼就看完。
- 其余同 v1.15.2。

## v1.15.2：Outlook 登录区加了 Peekat 的公开 Client ID
- Outlook Client ID 下拉现在有四个选项：自己的 Azure 应用（默认）、Thunderbird 公开 ID、Peekat 公开 ID（5343aed1-2695-42e9-8c57-3d9f213f58f3，从 Peekat Firefox 版 0.1.14 的 background.js 找到，它走 launchWebAuthFlow + getRedirectURL，跟我们同一路）、自定义。注意包里还有一个 9188040d-6c67-4c5b-b112-36a304b66dad，那不是 Client ID，是微软个人账号（MSA）的 consumers 租户 GUID，别当成 ID 用。
- 先实测过再加：用我们扩展的回调地址去微软授权页试，Peekat 的 ID 正常出登录页、没有任何 AADSTS 报错，跟雷鸟的 ID 表现完全一样；拿一个假 ID 试则报 AADSTS700038，说明测试本身能分出好坏。Google 那边两个作者的 ID 都报 redirect_uri_mismatch 用不了，微软这边能用，是因为微软对公开客户端的回调地址放得宽。**（v1.15.5 更正：这个结论是错的——当时只看了 login.microsoftonline.com 的初始登录页，那里不校验回调地址，真正的校验在跳转到 live.com 之后才发生；2026-11-18 直打 live.com 实测，雷鸟和 Peekat 的微软 ID 都报 invalid_request，只有自己的 Azure 应用能过。两家的公开 ID 都已从下拉拿掉。）**
- 其余同 v1.15.1。

## v1.15.1：设置页 Client ID 两行对齐；雷鸟 / Peekat 的 Google ID 都用不了
- 设置页 Gmail 和 Outlook 登录区的 Client ID 下拉、Client ID 值框、Client Secret 框全部对齐：标签固定 170px 宽，下拉和值框统一 340px——之前“Microsoft Client ID：”比“Google Client ID：”长两个字，两边的框起点不一样。顺手修了一个小毛病：切回“自定义”时自动填回上次保存的自定义值，之前框里还留着预设的 ID，得重输。
- 找过雷鸟和 Peekat 作者的 Google Client ID，都不能内置：雷鸟桌面版源码里的 Google ID（406964657835-aq8lmia8j95dhl1a2bvharmfk3t1hgqj）和 Peekat 扩展里的 Google ID（596819905515-2lf435m98fe3b461d8gsohnd2q8he5b6，从 Firefox 版 0.1.14 的 background.js 找到），用我们扩展的回调地址去 Google 授权页实测，Google 都直接返回 redirect_uri_mismatch；自己的 ID 则正常进入登录页。原因：Google 只认注册在那个客户端上的回调地址，每个扩展的回调地址都带自己的扩展 ID，别人的 ID 永远登不进本扩展——只有自己的 Google 应用（注册了本扩展回调）能用。**（v1.15.5 更正：微软那边也一样，雷鸟/Peekat 的微软公开 ID 在 live.com 端同样报 redirect_uri 不对，“微软对公开客户端回调放得宽”是误判；v1.15.5 起 Outlook 也只用自己的 Azure 应用，v1.15.6 起 Google 下拉也只剩自己的 + 自定义。）**
- 其余同 v1.15.0。

## v1.13.0：Gmail 改走 Gmail API OAuth，跟 Peekat 一样能回邮件、标已读、归档、删除、写邮件
- Gmail 弃用 Atom feed（只读），改走官方 Gmail API：每个号单独 OAuth 登录（launchWebAuthFlow + PKCE，不用 client secret），scope 是 gmail.modify + gmail.send。
- 用户要先在 Google Cloud Console 建项目、开 Gmail API、建 Web application 类型的 OAuth 客户端（Authorized redirect URIs 填设置页显示的 Google 回调地址 `https://<扩展 ID>.chromiumapp.org/`），把 Client ID 贴到设置页 Gmail 登录区保存；OAuth 同意屏幕用“测试”状态，把自己的两个 Gmail 加为测试用户。
- 弹窗里 Gmail 邮件也有 标已读 / 归档 / 删除 / 回复，每账号有“写邮件”；回复同 thread 发（带 In-Reply-To/References + threadId）。
- 自动发现还是扫 u/0～u/4 找邮箱，找到后各登一次。旧的 Atom 查未读已删。
- 其余同 v1.12.0（Outlook 的回邮件等不变）。

## v1.12.0：Outlook 像 Peekat 一样能回邮件、标已读、归档、删除、写邮件
- 授权 scope 加到 `Mail.ReadWrite + Mail.Send`（原来只有 Mail.Read）。Azure 应用 → API 权限加这两项，保存后每个 Outlook 号重新登录一次（旧 token 只有读权限，未读照常查，但操作会提示重新授权）。
- 弹窗里每封 Outlook 邮件下面有 标已读 / 归档 / 删除 / 回复；每个 Outlook 账号下面有“写邮件”（收件人、主题、正文）。回复会顺手把原邮件标已读。
- 未读邮件列表现在是 Graph 真取的（带 Graph ID），不再是旧版残留。
- Gmail 还是 Atom 只读（回邮件等操作 v1.13.0 换 Gmail API 再加）；Proton 不动。
- 其余同 v1.11.3。

## v1.11.3：加账号那排对齐 + 登录页直接显示要登的号
- 加账号那排改成两行整齐排列：第一行服务商 + 标签 + 添加账号，第二行两个发现按钮，不再挤在一行换行错位。
- 点 Outlook 行的“登录”时把行里的邮箱带给微软（login_hint），登录页直接显示这个号，不用再手动输邮箱。
- 其余同 v1.11.2。

## v1.11.2：添加账号时序号自动排号
- 加账号不用再手动填序号：点“添加账号”自动取该服务商下最小的未用序号（从 0 开始，删掉中间一个会补那个空位），序号输入框已去掉。
- 其余同 v1.11.1。

## v1.11.1：Client ID 两个都留着，可选
- 设置页 Outlook 登录区的 Client ID 改成下拉选择：自己的 Azure 应用 MultiMailNotifier（`8aacd0db-eeba-4300-9a7d-70a3c1d684c3`，已内置，默认用它）/ Thunderbird 公开 ID（也留着，实测可用）/ 自定义。选好点保存就生效，登录时按选中的 ID 走 OAuth；切来切去自定义值还在，不会丢。
- 其余同 v1.11.0。

## v1.11.0：Outlook 改走 OAuth（Peekat 方式），删掉 cookie 隔离
- Outlook 改走微软官方 Graph API：每个号单独点“登录”（chrome.identity.launchWebAuthFlow + PKCE，不用 client secret），各拿各的 token，未读数走 `GET /me/mailFolders/inbox?$select=unreadItemCount`。token 到期自动用 refresh_token 换，换不到才标“需重新登录”。
- Client ID 默认填 Thunderbird 的公开 client ID `9e5f94bc-e8a4-4e73-b8be-63364c29d753`（实测：用它 + 本扩展回调地址请求微软授权地址，返回正常登录页，无 AADSTS50011）。设置页可改成自己的 Azure 应用 client ID。
- 删掉的旧逻辑：CDP 调试器 cookie 隔离（cdpAttach / isoTabs / isoJars）、webRequest 抄 Outlook 凭证（x-owa-canary）、后台 service.svc 重放、Outlook 标签页上报自动新建账号行、content-outlook.js。`debugger` 权限也已去掉。
- 去重：启动时 Outlook 行按邮箱小写去重，同一邮箱只留一行（优先留有有效 token / 状态 ok 的）。
- Gmail（Atom）和 Proton（抄头重放 conversations）不动。

## v1.6：Outlook/Proton 也进诊断日志
- 之前诊断只记自定义邮箱和标签页上报，Outlook/Proton 后台查没记，所以日志里看不到 Outlook。v1.6 补上了：无凭证、HTTP 401/403 过期、HTTP 200 未读数都会记一行。

## v1.5：163 后台查修了
- v1.4 的问题：163 的 main.jsp 只是 JS 外壳，里面根本没有未读数，所以 HTTP 200 也解析失败。
- 改成真正的接口（源码 InfoSpider Spiders/mail/main.py get_wangyi）：
  POST https://mail.163.com/js6/s?sid={sid}&func=mbox:listMessages，body 是 form 的 var 字段 XML（fid=1 收件箱，limit 20，returnTotal=true），返回 XML，按每封的 read 字段数未读。
- 诊断日志现在还会记下返回里的 total 和实际字段名；如果还是没找到 read 字段，会把首封的 XML 结构记进日志，贴给我就能按实际字段名再修。
- 注意：只取最新 20 封，未读超过 20 封时可能算不全，日志里有 total 可对照。

## v1.4：诊断日志
- 设置页“诊断”区：立即检查 / 刷新 / 复制 / 清空，日志只存本地最近 100 行，不含 SID 和请求头的值。

## v1.3
- 自定义邮箱不用手动留标签页：先试 SID 后台查，查不到就由扩展自己开一个固定、不激活的后台标签页，关了自动重开。

## 安装
Chrome → chrome://extensions/，Edge → edge://extensions/，Brave → brave://extensions/，Dia → dia://extensions/ → 开发者模式 → 加载已解压的扩展程序 → 选本文件夹；Firefox → about:debugging → 此 Firefox → 临时载入附加组件（临时加载，重启失效）。或去 GitHub Releases 下 zip、解压后加载。
**注意：必须解压覆盖原来那个文件夹再点刷新，不要移除重装、不要换文件夹**，否则扩展 ID 变了、账号和 token 全丢。
装好后：设置页 Outlook 区域每个号点“登录”，在微软登录页选号登入即可。
新版本发布到 GitHub Releases 后，扩展（开着自动检查更新时）会弹通知提醒，点通知去下载新 zip，同样解压覆盖 + 刷新。

## 版权
Copyright © 2026 djkyc。本扩展按 Apache License 2.0 授权，详见文件夹里的 `LICENSE`（仓库根目录也有一份）。

## 联系作者
作者：djkyc。GitHub 仓库：https://github.com/djkyc/browser-plug-in ；反馈问题 / 提建议：https://github.com/djkyc/browser-plug-in/issues ；Telegram：https://t.me/djkyc 。
