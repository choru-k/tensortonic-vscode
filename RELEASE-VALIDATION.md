# TensorTonic 0.10.0 acceptance — 2026-11-02

This record supersedes the pending-validation wording in the immutable candidate documentation bundled with 0.10.0. The accepted source and release artifacts were not rebuilt or changed after host validation. This remains a personal experimental build using the explicitly enabled proposed `browser` API, not a Marketplace release or a compatibility guarantee for other VS Code versions.

## Verified

- The exact candidate `d503d50940cbd2fc9d1af1a18363a65d76e7c570` passed actual Mac read-only checks: authenticated 30-problem catalog and existing Softmax problem reads, three navigations, cancellation and reconnect, zero DebugSession starts, zero grading calls, no remaining owned cleanup resources, and host exit code 0.
- The normal Mac profile subsequently activated 0.10.0 with the exact extension ID `choru-local.tensortonic-vscode` enabled for the proposed API. The 2026-11-02 00:40:12 UTC diagnostic confirmed a connected `pytorch-basics` catalog with 30 problems and successful Tensor Factory statement, starter code and three public test-case reads. No authentication, HTTP, transport or cleanup errors were reported. These were reads, not execution of those test cases.
- Publication recheck: 273 automated tests passed. The focused 36-test transport/request-policy run also passed; those tests are included in the 273, not additional unique tests.
- All 27 packaged source files match the accepted checkout byte for byte. ZIP integrity and the install bundle's embedded VSIX were verified.

## Limits

Normal-profile live DebugSession count, toolbar absence and browser automation-indicator absence were **not visually verified**, because the required UI tools were unavailable. The isolated acceptance test recorded zero DebugSession starts. Do not infer invisible automation or every normal-profile UI state from that result.

No new real Run/Submit was performed for 0.10.0 acceptance or publication. Earlier 0.8.0 grading results are historical and do not establish live grading validation for this transport. No account payload, solution, authentication material or personal filesystem path is included in this record.

## Unchanged accepted downloads

- [VSIX](releases/tensortonic-vscode-0.10.0.vsix): SHA-256 `c6512ac370d8c12aded149277e4ea63e8b54a7fed6330bdac2b8e02892d819df`
- [Install bundle](releases/tensortonic-native-browser-0.10.0.zip): SHA-256 `d038e2af2819e996f323c5ec610d563b2bd2612f750b49fdfc0a5d70fd5901f5`

Only current needed source and deliverables remain in the main tree. Earlier versions remain recoverable through ordinary Git history; no history rewrite or force push is used. No GitHub Actions workflow is configured, and no new workflow is enabled by this release.
