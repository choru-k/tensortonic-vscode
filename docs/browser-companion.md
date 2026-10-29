# Browser companion: no-console connection

The companion replaces JavaScript console pasting. It does **not** copy your password, login cookies, or session into VS Code. A small one-use pairing ticket still needs to be copied from VS Code into the companion popup when connecting.

## One-time setup

Install the separately provided **TensorTonic Browser Companion** only in a browser where you are permitted to install it. It is an unpacked Manifest V3 extension, not a published Chrome Web Store listing. The supplied source can be packaged offline:

```sh
python3 scripts/package_companion.py
```

The command produces the unpacked `dist/tensortonic-browser-companion` folder and a ZIP. If your browser and organization allow developer-installed extensions, use the browser's normal Extensions → Developer mode → Load unpacked flow and select that folder. Installation grants `activeTab` and `scripting`: temporary access to the tab where you invoke the companion. The implementation refuses non-TensorTonic pages.

Do not disable an organization policy or browser security feature to install or connect it. Installation/enabling is a separate explicit user action; packaging the files does not install anything.

## Each connection

1. In the **same computer's browser**, open `https://www.tensortonic.com/` and sign in normally, including GitHub/2FA if needed. Confirm the intended account.
2. In VS Code run **TensorTonic: Connect browser companion**, then choose **Copy pairing code**.
3. On the signed-in TensorTonic tab, open the companion popup, paste the ticket into its pairing field, and choose **Connect this tab**. No DevTools/Console is used.
4. If the browser asks to allow local-network access, review the request. The connection is only to VS Code's temporary `127.0.0.1` server. Browser/organization policy may deny this; the extension does not bypass that decision.
5. Keep the tab open. Use **Disconnect browser** in VS Code or **Disconnect** in the companion to end the session.

Tickets expire after two minutes and are consumed on first successful redemption. A fresh ticket invalidates the previous unredeemed ticket. Refreshing the tab or restarting VS Code requires pairing again. Do not share a ticket. The popup clears the input after an attempt; no ticket or capability is intentionally retained in extension storage, address-bar/history entries, or application logs. The underlying loopback requests still carry the ephemeral capability in query parameters, so browser network diagnostics can expose it. Clipboard contents are not silently changed after your copy action; a consumed/expired ticket is unusable.

## Security boundaries

- Only explicit `activeTab` + `scripting` grants. No cookies, storage, history, broad tabs, background-worker, or host permissions.
- Connector runs in an isolated world on the exact HTTPS TensorTonic origins and top frame. No page/runtime message channel accepts arbitrary requests.
- Browser-origin CORS and local-network checks still apply.
- Pairing uses a separate 128-bit one-use, expiring ticket. The longer-lived bridge capability stays only in memory in VS Code and the isolated content-script closure.
- Host, origin, ticket, current session and request schemas are validated. The bridge's endpoint/body allowlist still applies. No account settings, billing, reference solutions or arbitrary fetch proxy is exposed.
- Closing/refreshing the tab, session expiry, or site/API changes can interrupt access. Never retry an uncertain Submit automatically.

## Validation limitation

Permissionless unit tests, real loopback HTTP tests and real VS Code-host tests can exercise this code with simulated browser APIs. They do not prove that an installed companion works under every browser's policies. The user approved installation in the assistant's managed Chromium, but this environment's browser automation URL policy blocked navigation to `chrome://extensions` (only HTTP/HTTPS URLs are permitted). No installation or activation was performed. No alternate UI/CLI route, browser-policy change, or Mac fallback was used to bypass the block. Live authenticated grading through the installed companion remains unverified until a permitted environment completes that test.

Primary implementation references: [Chrome activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab), [isolated content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts), and [content-script CORS](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests).
