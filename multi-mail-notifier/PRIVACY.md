# Privacy Policy — Multi Mail Notifier

Last updated: 2026-11-19

Multi Mail Notifier ("the Extension") is developed by djkyc. This policy explains what data the Extension accesses and how it is handled.

## What the Extension accesses

- **Your email accounts.** The Extension reads unread mail (sender, subject, summary, and message body when you open it) from the Gmail, Outlook/Hotmail/Live, and Proton Mail accounts you add, so it can show them in the popup.
- **OAuth tokens.** Gmail and Outlook sign in with OAuth. The Extension stores the access tokens it receives in your browser's local storage so it can check mail without asking you to sign in every time. Tokens are never sent anywhere except to Google's and Microsoft's own servers.
- **Settings and account list.** Your account list, display order, and settings are stored in your browser's local storage. If you enable WebDAV backup, a copy is uploaded to the WebDAV server you configure. Tokens and WebDAV passwords are never included in a backup.

## What the Extension does NOT do

- It does not send your mail, tokens, or account list to the developer or to any third-party server, except to the mail providers themselves (Google, Microsoft, Proton) and to your own WebDAV server if you enable backup.
- It does not collect analytics, tracking data, or advertising identifiers.
- It does not sell or share your data with anyone.

## Data storage

All data stays in your browser (local storage) and, for mail content, in your mail provider's servers. The Extension has no server of its own. If you uninstall the Extension, its local storage is removed by the browser.

## Permissions

- `alarms`, `notifications`, `storage`: schedule mail checks, show new-mail notifications, and store your accounts and settings locally.
- `identity`: sign in to Gmail and Outlook with OAuth.
- Host permissions for `mail.google.com`, `outlook.live.com`, `mail.proton.me`, and `raw.githubusercontent.com` (update check only): read mail from the providers you use and check for new versions of the Extension.

## Contact

Questions about this policy: https://t.me/djkyc or https://github.com/djkyc/browser-plug-in/issues
