# 0.5.0 original-page integration — 2026-10-30 UTC

Base: published 0.4.0 commit `87c98e338ca35f9e833246c39251e1eb58377e0d`, tree `eff8caaeff63f260f13e7860525b0442ddd9e657`. The local base commit `6c18b847660057de6dea86415d7afd0cd3d9ac95` has the exact same tree.

## Behavior and architecture

The primary **Interactive explanation** solution CodeLens/sidebar action and **Open original problem in VS Code** command now request the original TensorTonic problem page through `workbench.action.browser.open`. The full site owns content, cards, login and entitlement. The extension does not recreate each problem or extract/modify the live page. A complete site page, including its editor, may be visible.

The optional independent 0.4.0 examples remain unchanged under **Offline learning exploration**, a separately labeled command/sidebar action. The external-browser action is unchanged. Existing native Markdown/math and the 0.3.2 dedicated study-window workflow remain intact.

The native command is feature-detected. Parameters are `{url, openToSide:true, reuseUrlFilter:url}`; URL construction fixes HTTPS and `www.tensortonic.com`, using validated/encoded problem and optional plan identifiers. No input supplies an origin, arbitrary URL, wildcard filter or extra browser arguments. The native host matches the URL scheme/authority/path and supplied query parameters; extra existing query parameters or fragments do not prevent matching. This is not strict full-URL equality. VS Code can reuse a matching original page; different problems may open separate tabs. The host owns native tab lifecycle. Startup, refresh, opening a solution and Previous/Next never open or navigate native pages automatically.

If the native command is absent or throws, an explicit notification offers **Open in external browser**. Cancel means no fallback. A failed/uncertain command is not automatically retried. Success means dispatch only, not proven load/authentication. Pending metadata/discovery/fallback is invalidated after newer navigation, selection, disconnect or another explanation request. Already-dispatched native browser navigation cannot be canceled by this extension.

## First-party evidence and bounded read-only checks

- [VS Code integrated browser documentation](https://code.visualstudio.com/docs/debugtest/integrated-browser) describes normal web navigation and separately managed browser session storage. [Release 1.109](https://code.visualstudio.com/updates/v1_109) introduced the native browser; supported arguments were checked in the installed official **1.144.0** desktop build, not assumed for all older versions.
- [Official architecture](https://github.com/microsoft/vscode/blob/main/.github/skills/integrated-browser/SKILL.md) distinguishes native Chromium `WebContentsView` from the old Simple Browser iframe. Installed `out/mainImpl.js` confirms `WebContentsView` and normal `webContents.loadURL`; `out/vs/workbench/workbench.desktop.main.js` confirms command ID, string/object arguments, `openToSide` and `reuseUrlFilter` handling.
- Unauthenticated GET of `https://www.tensortonic.com/problems/pytorch-softmax-from-scratch?studyPlan=pytorch-basics` at approximately **18:37 UTC** returned 200 with no `X-Frame-Options` or CSP response header; no CSP meta was found. GET `/login` redirected 307 to `/auth`, which returned 200 with no XFO/CSP response header. These observations are **not** proof about authenticated responses, OAuth providers, runtime framing or successful login. No authenticated page or account data was fetched.
- Site terms and subscription ownership do not themselves prove embedding permission. This change uses ordinary original-site top-level browser navigation; it does not assert a legal conclusion or redistribute/frame site content.

## Security and sessions

No custom iframe, proxy, header stripping, CSP changes, cookie/token extraction, credential transfer, injected website script, browser permission change, trust change or automatic AI page sharing. The extension does not inspect native page DOM or use CDP/browser-agent tools. No remote debugging or browser security flags are introduced.

Users sign in normally in the native browser. Its browser session is separate from the user's external Chrome/Helium/Safari session. The existing external companion remains the Run/Submit bridge; native browsing neither imports that session nor pairs the companion. User credentials, OAuth confirmation and normal browser/site permission prompts remain user-owned. The extension does not change storage policy; global/workspace/ephemeral behavior is controlled by VS Code and the user.

## Verification

- Full integrated suite: **247 passed**, zero failed/skipped.
- Loopback transport suite: **15 passed**, zero failed/skipped; mocked upstream, no live grading.
- Six added native-action tests cover exact arguments, arbitrary-destination/filter rejection, feature absence, explicit external fallback/cancellation, failed dispatch without replay, stale command discovery and disconnect during fallback, all-plan URL support, and absence of automatic opening on normal problem navigation.
- Retained 47 numerical/card tests and offline lifecycle tests remain passing under the newly separated offline action.
- Syntax and whitespace checks passed. Final VSIX integrity and source/document byte parity are checked after packaging.
- Independent integration review is performed separately before publication.

## Remaining limits

No native browser GUI was launched for this patch. Native side placement, actual CSP/browser enforcement, TensorTonic login, GitHub/OAuth, subscriber entitlement, original-card controls and final page rendering are **not verified**. Prior cloud native-host attempts were blocked and were not retried using security bypasses. No Mac access or live Run/Submit was used. The tests prove extension dispatch/control flow, not end-to-end website usability. Original pages remain dependent on the website, installed VS Code and user-owned authentication.
