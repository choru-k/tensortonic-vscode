# TensorTonic VS Code Companion — Unofficial

This small Manifest V3 browser extension replaces console-code pasting with an explicit popup. It is not an official TensorTonic product or an authentication provider. GitHub/TensorTonic login stays in the normal website.

## User flow

1. After reviewing and explicitly approving installation, install this companion in a browser permitted by your organization's policies.
2. Sign in normally on `https://www.tensortonic.com` (or `https://tensortonic.com`). Keep VS Code and the browser on the same computer.
3. In VS Code, run **TensorTonic: Connect browser companion** and use its explicit **Copy pairing code** action.
4. On the signed-in TensorTonic tab, open this companion's toolbar popup. Paste the one-use code into its masked field and click **Connect this tab**.
5. If the browser asks for local-network access, review and allow it only when that permission is permitted for this connection. The popup distinguishes “connecting” from a confirmed poll.

The code expires after two minutes and is consumed once. Refreshing or closing the TensorTonic tab requires a new pairing code. The popup's Disconnect action stops the page connector and notifies the local editor. The VS Code Disconnect command also revokes the connection.

A small product-UI copy/paste remains; there is **no developer console, login-cookie copying, password entry in the extension, or unattended discovery of local ports**.

## Permissions and security boundary

- Manifest permissions are only `activeTab` and `scripting`. No permanent site permissions, background worker, automatic content scripts, `cookies`, `storage`, `tabs`, `history`, clipboard-reading permissions, externally connectable messages, or web-accessible resources.
- Access follows the user's extension action and is restricted by the code to the two exact HTTPS TensorTonic origins, top frame only. Script execution uses Chrome's isolated world, not the page's main JavaScript world.
- The pairing code selects only `http://127.0.0.1:<valid-port>/pair`. It cannot select an arbitrary host/path. Requests refuse redirects; returned configuration must name the exact requested origin.
- Only the one-use pairing ticket reaches the popup. The longer-lived connection capability remains in an ephemeral isolated-script closure and is never returned to the popup, placed in the DOM, persisted, or logged.
- No page/runtime message listeners expose a general fetch service. The packaged canonical connector keeps its narrow TensorTonic problem API allowlist. Cookies are included by the browser's normal fetch rules, never read by this extension.
- Content-script network calls are still subject to the page's origin/CORS and browser local-network policies. This extension is **not** a bypass for managed-browser policy. If installation, scripting, or local-network access is blocked, stop and ask the relevant administrator.

Official platform references: [activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab), [isolated content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts), and [content-script cross-origin requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests).

## Build and test

From the VS Code repository root:

```sh
python3 scripts/package_companion.py
node --test test/companion.test.js
```

The packager creates `dist/tensortonic-browser-companion/` and a versioned ZIP. It copies the canonical `src/browser-connector.js` as `connector.js`; do not load the unbuilt source folder, which intentionally does not contain a second drifting copy of that script. The ZIP contains only allowlisted package files.

Unpacked installation, enabling developer mode, a store listing, or installing/activating this extension in an existing browser is a **separate user/admin-authorized step**. No such operation is performed by the build or the permissionless Node tests. Do not use another browser, a hidden injection channel, or a policy change to work around a denied action.

Node tests simulate extension/browser APIs and fake network responses. Passing them is not proof that a particular managed browser permits installation or that live account/browser networking works. Actual browser and live account validation must be reported separately.
