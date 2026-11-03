# Session acquisition and consent

The fixed production policy is defined in `src/session/tensortonic.js` and described
in [the HTTPS design](session-http.md). No user setting or environment variable
can broaden its cookie names, hosts, domain/path or security attributes.

Every new import requires scoped in-app consent before a dedicated page opens.
The dialog names the cookie, exact API read URL, domain/path/security rules and
server-expiry retention. It explains the account-access risk and the protocol's
per-URL response: other applicable cookies briefly enter memory before local name
filtering, but only the selected session is persisted and other names are not
logged. Google/GitHub URLs and other profiles are not queried.

The user completes normal login/2FA in the new page and returns to a canonical
www.tensortonic.com route. Capture and Cancel are temporary status actions rather
than a login-blocking notification. Closing the owned tab also cancels. All
commands/items/listeners are removed after capture or cancellation. Queries,
fragments, userinfo, foreign origins and ambiguous frames are not accepted as
return pages. The cookie source remains the exact API `/api/me` URL even when
the website routes the top page to another normal www path.

`BrowserSessionAcquirer` validates all batches before one fenced import. A shared
revocation epoch captured before acquisition prevents another window's Clear
from being undone by late completion. Cookie metadata is validated before
persistence; changed scope is rejected rather than guessed or broadened.

`ProposedBrowserCookieSource` opens only a new BrowserTab and the CDP group created
from it. It never searches/adopts other tabs or profiles. Only scoped attachment,
root frame inspection and `Network.getCookies` with one exact URL are used.
No Network monitoring, global `getAllCookies`, browser-storage reader or runtime
cookie expression is used. Chromium's leading-domain-dot convention preserves
host-only versus domain-cookie behavior. Partitioned/SameParty cookies are
refused. Session-only cookies receive no invented persistent expiry in production.

After import, actual tab/CDP cleanup completes before direct account verification.
Saved state and optional Web problem presentation are independent. A failed
post-import close reports the saved-session result separately and retains the
owner for Stop/Clear/Dispose retries; it cannot disappear from pending status.
Clear's credential invalidation/deletion is independent from browser cleanup.
No real browser cookie or server session is deleted by local Clear.

The browser API is proposed/unstable and must be explicitly enabled for this
extension only. The code does not patch product.json, change security settings,
copy a profile, spoof a built-in identity, start a VS Code DebugSession or hide
an automation indicator. [Host setup](native-browser.md).

Validation separates actual v3 fake-browser/SecretStorage proof, a bounded
real-account read whose copied session was deleted, and the integrated candidate's
current automated checks. No native integration pass is claimed without running
that exact candidate. See [current evidence](../RELEASE-VALIDATION.md).
