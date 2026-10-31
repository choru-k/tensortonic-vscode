# Contributing

## Language and scope

Maintain this public repository in English: documentation, changelog entries, user-facing extension and companion text, code comments, and test descriptions. Preserve TensorTonic's original problem content, proper names, and intentional multilingual fixtures. Do not translate user-authored solutions or notes.

The extension is unofficial and supports Python free and study-plan problems. Preserve its existing authentication and security boundaries: login stays in the browser, setup pairing is explicit and short-lived; remembered access is a separate revocable capability with an absolute 30-day limit, and requests use the narrow supported API allowlist.

## Checks before submitting a change

No external npm packages are needed. From the repository root:

```sh
npm test
npm run test:transport
python3 scripts/package.py
python3 scripts/package_companion.py
```

Run the applicable real-host checks described in [docs/vm-validation.md](docs/vm-validation.md) when changing extension behavior. Use the separate fixture workspace. Keep simulated browser/upstream checks distinct from live-account E2E evidence; a passing mock test is not proof of browser-policy compatibility.

The companion package copies `src/browser-connector.js` as `connector.js`. Edit the canonical source, not a generated copy. After changing packaged files, rebuild the affected artifacts and verify their contents match the source. Do not include pairing codes, credentials, cookies, private solutions, runtime logs, or account-specific reports in commits or release packages.

## Live testing

Install or enable the companion only with explicit permission and where browser and organization policies allow it. Never bypass a denied installation, scripting, or local-network action. The live E2E runner submits the already-solved Softmax exercise once and restores editor contents; read its checks before running it with an account. Never automatically retry a Submit whose outcome is uncertain. Agent-composer checks must not be described as verification of an actual AI response.

Explain the change, the tests actually run, and any remaining limitations in the pull request. Keep new pull requests in draft until ready for review.
