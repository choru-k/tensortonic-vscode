# TensorTonic browser companion 0.2.0

Unofficial Chromium Manifest V3 companion for VS Code extension 0.6.0. Pair one browser profile with one local editor workspace for **at most 30 days**. This is a local editor capability, not a TensorTonic password, cookie, or website login session.

## Install and pair

1. Build with `python3 scripts/package_companion.py`; use the resulting unpacked folder or ZIP through the browser's normal extension installation flow. Do not bypass managed-browser restrictions.
2. Open a signed-in TensorTonic tab on the same computer.
3. In VS Code, run **TensorTonic: Connect browser companion** and use **Copy pairing code**.
4. Open the companion popup, paste the code, and choose **Connect this tab**. Review the optional access request for that exact TensorTonic HTTPS site. The other TensorTonic hostname is not silently granted.
5. Review any browser local-network prompt normally. Wait for “Connected to VS Code.”

The setup code still expires after **two minutes**, is consumed once, and is never saved. The remembered pairing expires 30 days after creation, not 30 days after last use. Website login can expire sooner; sign in normally if necessary. The companion uses the account currently signed in on the paired exact website origin. Disconnect before switching accounts or sharing the computer.

## Reconnection and limits

Refresh/reopen the TensorTonic tab, restart the browser or the same VS Code workspace, or recover from sleep/network failure: the companion retries the local connection while a permitted TensorTonic tab is open. Recovery may take around a minute because a previous tab's connection must time out before another takes ownership. No background website tab is opened. At absolute expiry, pair again.

One remembered editor is supported per browser profile. A second workspace requires **Disconnect** first; a different tab/window cannot silently take over the active editor. VS Code stores a fixed loopback port for that workspace; if another process owns it, the editor fails closed rather than redirecting credentials or scanning other ports. Reopening a different workspace does not inherit this pairing.

Reconnection never replays Run, Submit, or a pending command. Check TensorTonic before retrying an operation whose outcome is uncertain.

## Disconnect and revoke

The popup's **Disconnect** button works even without a TensorTonic tab. It immediately forgets the active browser pairing and stops known content connectors. When a permitted TensorTonic tab can reach the editor, the companion also revokes the editor-side grant. If the editor is offline or no permitted tab exists, a **revoke-only tombstone** remains until a later permitted visit can deliver revocation or the original expiry is reached. The UI states that revocation is pending; it does not claim the remote grant was deleted. Use VS Code's **TensorTonic: Disconnect** for immediate editor-side revocation.

Removing TensorTonic site access forgets active remembered access and removes automatic script registration for that site. Pending revocation still needs a permitted tab, or editor-side Disconnect. Removing the entire browser extension deletes its local data but cannot contact an offline editor: revoke from VS Code as well.

## Exact permissions and storage

- Required: `activeTab`, `scripting`, `storage`.
- Optional site access: `https://www.tensortonic.com/*` and `https://tensortonic.com/*`; only the current exact origin is requested when Connect is clicked.
- No `cookies`, `tabs`, `history`, clipboard-reading, all-sites, API-host, or localhost host permission. No externally connectable messages or web-accessible resources.
- A service worker restricts `storage.local` and `storage.session` to trusted extension contexts before serving requests. It dynamically registers top-frame isolated scripts only on granted TensorTonic origins.
- Local browser storage contains the editor loopback address, a random resume secret, exact origin, and absolute expiry. It is **not an encrypted password vault** and is **not synced**. The ephemeral connection token is not persisted. Protect the browser profile and computer.
- The worker returns secrets only to this extension's exact-origin, top-frame script; popup messages/UI never contain them. No webpage DOM or page-message bridge exposes them. Trusted extension contexts, including the popup, technically have storage access; this implementation's popup only requests non-secret summaries.
- Session storage holds one tab-owner lease and in-flight reservation nonce, not website credentials. Disconnect invalidates reservations so late pairing responses cannot restore access.
- Pair/resume/revoke only target the previously validated canonical `http://127.0.0.1:<port>` address, refuse redirects, and omit cookies. Website API requests remain narrowly allowlisted and use normal browser-managed login.

Automated worker/content tests simulate browser APIs. Real-browser permission dialogs, managed policies, restart behavior and website authentication still require installation-time manual verification.
