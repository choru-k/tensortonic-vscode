# Remembered pairing (0.6.0 / companion 0.2.0)

This is a local release candidate. It is not installed on the user's computer or published to GitHub automatically.

## What changes

Pair once using the normal two-minute, single-use code. A distinct randomly generated remembered capability expires exactly 30 days after pairing; ordinary reconnects never extend it. VS Code keeps it in **SecretStorage**, scoped to the study workspace. The browser companion keeps it in **extension-owned local storage**, restricted to trusted extension contexts; it is not OS-backed secret storage and someone controlling the browser profile may access it. Neither component extracts or persists the site's password, cookies, or session tokens.

A signed-in TensorTonic tab is still necessary. This feature remembers the link between VS Code and that tab; it does not extend TensorTonic/GitHub login validity. If the website logs out or browser permissions are removed, sign in/review permissions normally. Do not weaken browser or organizational security settings.

## Permission changes

The companion adds `storage` to its existing `activeTab` and `scripting` permissions. It requests optional access only to `https://www.tensortonic.com/*` and `https://tensortonic.com/*` during the explicit Connect action. Its service worker registers an isolated, top-frame script for permitted TensorTonic pages. No `<all_urls>`, cookie access, API-origin host permission, loopback host permission, clipboard reading, external messaging, or arbitrary code execution interface is added.

## Restarts, tabs, and windows

Open the same study folder/workspace after restarting VS Code. Its stable loopback port is derived from workspace identity; the credential remains secret. Different workspace identities do not share credentials. A second window for the same workspace, or a port collision with another application, fails closed instead of taking over or scanning ports. Close the conflicting study window normally, then use the intended window. Do not terminate unrelated processes to free a port.

One remembered editor is supported per browser profile. Explicitly disconnect before pairing another workspace/account. Only one TensorTonic tab at a time owns the browser connection; another tab waits rather than switching the active account unexpectedly. Refresh/sleep may take approximately a minute to recover while an old lease times out. No tab is automatically opened, and no grading action is automatically started or replayed.

## Disconnect and expiry

VS Code **TensorTonic: Disconnect** revokes the remembered credential on the editor immediately and removes secure storage; the companion recognizes rejection when it next contacts the editor. **Disconnect and forget** in the companion immediately prevents automatic resume and aborts its active connector, even when the currently selected tab is unrelated. It also requests server-side revocation through an available permitted TensorTonic tab.

When the editor is offline, no eligible tab exists, or permission was removed, the companion retains a revoke-only tombstone. Server-side revocation is pending until a permitted TensorTonic page can contact that editor again; it never resumes with that tombstone. For immediate revocation on the editor, use its Disconnect command. Secure-storage failure is reported rather than claimed as successful revocation. Delete failures may require a retry; do not assume closing the editor revokes access.

Both endpoints reject expired remembered access, including an already-open connection. Re-pair explicitly after 30 days. Account login and subscription access remain separate.

## Verification boundary

Automated unit and real-loopback tests use synthetic credentials and no real TensorTonic account. They cover the protocol, storage failures, restart lifecycle, expiry, and no-replay behavior. They do not establish actual Chrome/Helium permission acceptance, OS keychain behavior, live website login, or actual 30-day wall-clock operation. This environment has no display server/Xvfb, so new native host/browser UI verification is not claimed. No Mac access or live Run/Submit was performed for this change.
