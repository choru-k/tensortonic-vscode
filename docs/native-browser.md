# Direct native browser connection (0.10.0 personal experimental build)

Version **0.10.0** uses VS Code's **proposed `browser` API directly**. The production path does not launch a debug adapter, call `debug.startDebugging`, or attach to a user debug session. This replaces the earlier debugger-based candidate; it is not merely a flag that hides its toolbar. A browser automation indicator may still appear and must not be concealed by bypassing host safeguards.

This is a **personal experimental VSIX**, not a standard Marketplace release. The proposal can change between VS Code versions. A successful prototype on one host is not a general stable-API compatibility guarantee. No companion, pairing code, Legacy selector, or alternate transport is included.

## Install and explicitly enable the proposal

The extension ID is **`choru-local.tensortonic-vscode`**. Its manifest declares:

```json
"enabledApiProposals": ["browser"]
```

That declaration alone does not enable the proposal. Install the supplied VSIX normally, save your work, fully quit VS Code, and relaunch a supporting installation with the explicit per-extension startup opt-in:

```sh
code --enable-proposed-api choru-local.tensortonic-vscode "/path/to/TensorTonic Study"
```

Use the CLI belonging to the installation under review; an Insiders installation may use `code-insiders`. A reload or launching the CLI while an earlier process remains alive may leave its original startup configuration in effect. The CLI flag is per-launch, not a permanent setting. Use the optional manual procedure below only if you want persistence.

Microsoft documents proposed APIs as unstable development interfaces, normally used with Insiders, and explains VSIX sharing plus explicit opt-in rather than Marketplace distribution. See [Using Proposed API](https://code.visualstudio.com/api/advanced-topics/using-proposed-api). Support for this personal build must be verified on the actual host, not inferred merely because installation succeeded.

Only **trusted local desktop** study windows are supported. If the API is absent or disabled, Connect reports the missing requirement. Check the exact extension ID, opt-in, and full restart; update to a host supporting the proposal where permitted. Do not patch `product.json`, impersonate a built-in extension, enable proposed APIs for every extension, disable global security features, or bypass a managed policy. Remote/browser workspaces and unsupported alternative editors do not gain a fallback route.

## Optional persistent opt-in

The host offers **Preferences: Configure Runtime Arguments** to edit its `argv.json`. If you deliberately choose persistent enablement, add **only** `choru-local.tensortonic-vscode` to the `enable-proposed-api` array. Preserve the rest of the object and any existing array entries; the following is a property example, not a replacement file:

```json
"enable-proposed-api": ["choru-local.tensortonic-vscode"]
```

Save your work, fully quit, and restart the same VS Code installation. The extension does not edit this configuration automatically. To reverse the opt-in, remove only its ID from that array and fully restart; retain unrelated entries/settings. This does not delete study files or website login data.

Microsoft's guide describes Insiders. The direct-browser prototype also verified the explicit CLI flag on **VS Code 1.144.0 stable**, but this is host-specific evidence, not general stable-build support or an integrated 0.10 validation result. Normal-profile persistent setup is a separately coordinated user-authorized action; documentation alone does not establish that it has occurred.

## Connect and sign in

1. Run **TensorTonic: Connect browser** in the trusted local study window.
2. Review **Connect built-in browser**. The extension creates and controls only its own dedicated browser page through the opted-in API, not an existing user tab.
3. Sign in normally on the website, including GitHub/2FA if requested. No password, cookie, local-storage value, session token, or Authorization header is extracted or copied.
4. Use **Refresh problems** or Connect again after login. Connected browser transport does not prove website login, subscription entitlement, or any particular API call succeeded.

Ordinary activation and editor restart do not launch or attach automatically. Use Connect again. Authentication expiry is controlled by the website; complete normal login and explicitly retry only the desired action. No authentication automation, external-browser session transfer, or storage-policy change is performed.

Browser login persistence follows the existing host/browser storage configuration and the website's expiry. The extension does not alter `workbench.browser.dataStorage` or promise a fixed login lifetime. See [official Integrated Browser session-storage documentation](https://code.visualstudio.com/docs/debugtest/integrated-browser#session-storage).

## Local editor and original web page

Catalogs, study plans, descriptions, and explicit local-editor Run/Submit use the same narrow TensorTonic request allowlist from the owned page with normal browser credentials. Account/billing/settings, arbitrary URLs, and reference-solution endpoints remain unsupported.

`tensortonic.problemView` defaults to `markdown`. **Choose problem view (Markdown / Web)** makes explicit problem opens and Previous/Next show the owned original page beside the Python editor when Web is selected. Only the expected TensorTonic study surface may be reused; account pages, external navigation, and login flows are not silently redirected. Changing the setting alone does not navigate. Direct native transport also works with Markdown presentation; explicit **Description** stays Markdown.

Dirty solutions, existing tests, protected Markdown notes, and dedicated Python environments remain unchanged. The website's own editor/actions are separate from the extension sending the current local file through Run/Submit. This is top-level navigation, not iframe embedding, copied site code, a proxy, or a header/CSP bypass.

## Safety and failure behavior

- Operate only on the browser object/page created by this connection. Do not search for or adopt unrelated existing tabs, browser profiles, or debugger sessions.
- Serialize operations. Reject a new action as busy rather than queueing grading or navigating through an in-flight request.
- Dispatch Run/Submit at most once. Timeout or cancellation can leave the outcome uncertain: inspect the website before explicitly trying again. No automatic POST retry or transport fallback is allowed.
- Retain bounded request/response handling, exact allowed origins/endpoints, and fail-closed validation. Any chunk reads must read the existing result, not repeat its HTTP request.
- Remove transient request data after completion or cancellation. Do not log page globals, authentication material, raw browser errors, or account payloads.
- Disconnect releases only the owned connection. It does not sign out, erase cookies, or modify unrelated tabs/debuggers. If cleanup is uncertain, report it and refuse silent reuse; close the owned page normally when instructed.
- Do not change global debug settings, user launch configurations, browser security policies, or authentication. The direct path has no debugger source-map/console configuration because it does not create a debugger session.
- A missing proposal/opt-in produces actionable enablement/update guidance, not a debugger route, legacy companion, or policy bypass.

## Validation

Cloud tests simulate the proposed browser API and page realm. They test ownership, request policy, bounded results, exactly-once dispatch, cancellation/cleanup, and navigation races. They do not establish actual host UI, browser indicators, website login/grading, package installation, or every platform/API revision.

Earlier **0.8.0** Mac validation on VS Code **1.144.0** covered the then-debugger-based connection, a 30-problem list, full JSON reads, Markdown, dirty temporary-solution preservation, Web navigation, cancellation, and reconnect. One specifically approved existing solution was run once (3/3) and submitted once (43/43). Those results are historical and **do not validate the 0.10 direct-API transport**. Account and solution payloads are not distributed here.

A separately tested direct-browser prototype demonstrated no debug session. The integrated **0.10.0 candidate still awaits its coordinated actual read-only/visual check**; the prototype alone does not prove production integration or absence of every browser indicator. No new live grading is authorized or implied by that check. The 0.9 work remained an unpublished candidate; the published baseline before this candidate was 0.8.1.

Use any actual-host runner only with explicit authorization for the target session and normal user login. `test/vscode-native-readonly-validation.js` is gated by `TENSORTONIC_TEST_ALLOW_REAL_READ=1`, calls fixed read endpoints, and does not contain Run/Submit. Its host must also meet the proposal opt-in requirements. Real grading requires separate approval for the exact existing solution and action; never submit a starter placeholder or infer grading permission from a read-only check.
