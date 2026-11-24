# Multi Mail Notifier 使用说明

版本：v1.15.77（2026-11-24）

## 一、这是什么

Multi Mail Notifier 是一个 Chrome 扩展，把 **Gmail、Outlook（Hotmail / Live）、Proton** 多个邮箱的未读邮件集中到一个弹窗里提醒。登录一次，长期有效，不用天天重登。

支持的账号数没有上限：Gmail、Outlook、Proton 各加几个都行。

## 二、安装

1. 下载 zip，解压到一个固定文件夹（比如 `D:\multi-mail-notifier`）。
2. Chrome 打开 `chrome://extensions`，右上角开启**开发者模式**。
3. 点左上角**加载已解压的扩展程序**，选解压后的 `multi-mail-notifier` 文件夹。
4. 扩展图标出现后点一下，再点右下角的设置齿轮进设置页。

**更新时注意：直接覆盖文件夹里的文件，然后在扩展管理页点刷新。不要删除重装。** 删除重装会换扩展 ID，Gmail / Outlook 的登录回调就失效了，存的账号也要重加。

## 三、加账号

1. 设置页最上面 **怎么加账号** 一节有步骤，照着做。
2. **账号**一节：选服务商（Gmail / Outlook / Proton），填邮箱，点**添加账号**。
3. 加完后到下面对应的登录节登录。没登录的号显示 `need-tab` 或 `未登录`，登录后显示 `ok`。

账号列表可以拖动排序；每行有**登录 / 打开 / 删除**三个按钮。

## 四、三家登录方式（都是长期有效）

### Gmail

- **Chrome 默认账号**：走浏览器自带的 `getAuthToken`，不用额外操作，点登录就行。
- **其他账号**：走 PKCE + Cloudflare Worker + refresh_token，点**登录 Gmail**，在 Google 页面授权。
- refresh_token 会滚动续期，插件每天运行就一直有效；连续 90 天不用、改密码或撤销授权才会过期。

### Outlook（含 Hotmail / Live）

- 点**登录 Outlook**，在微软页面授权登录。
- 通过自建 Worker 换 token，refresh_token 90 天滚动续期，效果同 Gmail。
- 每个 Outlook 账号都要各自登一次；打开收件箱时用 `login_hint`，不会串号。

### Proton

- 设置页 **Proton 登录（SRP，长期有效）**：填邮箱和密码，点**登录 Proton**。
- **密码只在登录这一刻用，绝不保存**；登录后拿到的 refresh_token 存在本地，到期自动续。
- 开了两步验证的号，登录时会要 6 位 TOTP 码，输进去就登上了。
- 密码框默认显示明文（“显示密码”默认勾上），输错能看见。

## 五、设置页各节说明

从上到下：

| 节 | 作用 |
|---|---|
| 怎么加账号 | 加账号的步骤说明（默认展开） |
| 账号 | 账号列表、拖动排序、登录 / 打开 / 删除 |
| Gmail 登录 | Gmail 授权状态；里面还有高级设置（Client ID、回调地址、中转 Worker 地址） |
| Outlook 登录 | Outlook 授权状态；高级设置同 Gmail |
| Proton 登录 | SRP 登录区：邮箱、密码、登录按钮、每号的登录状态和登出按钮 |
| 提醒设置 | 桌面通知、声音、只提醒含验证码的邮件（安静模式）、勿扰时段 |
| 更新 | 检查扩展有没有新版本 |
| 诊断 | 出问题时，把这里的日志贴给作者看 |
| 数据 | 导出 / 清空本地数据 |
| WebDAV 备份 | 备份到 InfiniCLOUD 等 WebDAV（备份里不含 token 和 WebDAV 密码） |
| 联系作者 | 作者信息（默认展开） |

## 六、弹窗使用

- 点扩展图标：左边是账号栏（按服务商着色：Gmail 绿、Outlook 蓝、Proton 紫），右边是邮件列表。
- 点一封邮件看正文：Gmail / Outlook 可以在弹窗里直接读，Proton 点开跳网页版（正文是端到端加密的，后台解不开）。
- 正文支持翻译（点翻译按钮）。
- 验证码会自动提取出来显示在邮件上。
- 点开邮件**不会**自动标已读；要标已读、归档、删除，用邮件上的按钮。
- **垃圾邮件默认一起查**：Gmail 的 SPAM、Outlook 的垃圾邮件、Proton 的垃圾箱（LabelID=4）都会算进未读数，带黄色“垃圾邮件”标记，但不弹桌面通知。

## 七、常见问题

**Q：账号显示 need-tab 怎么办？**
A：去浏览器打开一次对应网页版（Gmail / Outlook / mail.proton.me），登录并等加载完，扩展会自动抄到会话，回来就好了。

**Q：Proton 显示 error:422 怎么办？**
A：去浏览器打开一次 mail.proton.me，刷新一下页面，再回来等 30 秒。Proton 网页版会不定期更新，扩展抄到的版本过期就会报 422。

**Q：登录状态里“token 有效至”比现在晚约 1 小时，是时钟错了吗？**
A：不是，那是 token 的到期时间。token 有效期大约 1 小时，到期前扩展会自动续。

**Q：诊断日志里只有 Proton，没有 Gmail / Outlook，是不是它们没在查？**
A：不是。Gmail / Outlook 查成功时不写日志，只有失败才写；Proton 每次查都写。所以日志里只有 Proton 是正常的，看账号表的状态和未读数才准。

**Q：换电脑或重装浏览器后怎么办？**
A：账号列表要重加，各家要重新登录一次。WebDAV 有备份的话可以先恢复账号列表，再逐个登录。

**Q：别人装这个插件，能用我的登录吗？**
A：不能。每个人的 token 只存在自己的浏览器里。Gmail 的同意屏幕目前是测试状态，陌生人登不进去；Outlook 的话别人能经同一个 Azure 应用登录，流量算 Cloudflare 免费额度。想给别人用，让他们自搭 Worker 并在高级设置里改地址。

## 八、隐私

- **密码绝不保存**：Proton 密码只在登录那一刻用，用完就清掉。
- token（登录凭证）只存在自己的浏览器本地，不发给任何人。
- WebDAV 备份里不含 token 和 WebDAV 密码。
- 扩展不收集、不上传任何邮箱内容。

## 九、版本记录（近期）

- v1.15.77：设置页“提醒”一节改名“提醒设置”。
- v1.15.76：修 Proton 422——appversion 全换成当前网页版的 5.0.142.3，SRP 查未读优先用抄到的当前版；adjlevis、liu687836 两个 Proton 号 SRP 登录全部成功。
- v1.15.75：显示密码默认勾上；auth/info 422 加多层兜底。
- v1.15.74：Proton 邮箱示例不再显示真实邮箱。
- v1.15.73：修登录成功后刷新列表报 `renderLoginLists is not defined`。
- v1.15.72：Proton 密码框加“显示密码”开关。
- v1.15.71：SRP 用浏览器抄到的真实 appversion，auth/info 422 时换 /core 端点再试。
- v1.15.70：Proton SRP 登录上线（长期有效）。
- v1.15.65：Outlook 走 Worker 中转（Web 平台 refresh_token 90 天）。
- v1.15.62：Gmail 混用方案（默认账号 getAuthToken，其他账号 PKCE + Worker + refresh_token）。
