# 0.3.2 Study workspace and sidebar validation — 2026-10-30 UTC

This patch starts from commit `2070e16`, whose tree was verified byte-identical to published main `aa59be448e8104989a2f40fea94213e8eb28e7fe`. All implementation and automated checks ran in the assistant's cloud workspace without user-computer access or live grading. The installable [0.3.2 VSIX](../releases/tensortonic-vscode-0.3.2.vsix) includes these source and validation documents.

## Scope and behavior

- **Start studying** asks for a local study folder once, remembers it in machine-local extension storage, and requests a new VS Code window using the official [`vscode.openFolder` command](https://code.visualstudio.com/api/references/commands) with `forceNewWindow: true`. It reuses the current window only when it already has that single folder and is not a saved/multi-root workspace. **Start studying in another folder…** lets the user explicitly change the destination.
- Canceling selection does not change state. Remote/browser/untrusted windows and nonlocal/non-directory selections are rejected. No project files, `.vscode` settings, workspace roots, layout or trust settings are modified by this workflow. Existing active-file operations are not redirected to the remembered folder; files are not migrated/copied/deleted.
- A five-minute, target-specific launch marker can focus the study sidebar on activation. Only explicit Start writes the shared marker; startup records a consumed nonce in workspace extension state and never opens windows, pairs a browser, or clears shared state. The marker, trust, folder and expiry are checked again after asynchronous consumption. Failed opens are not retried and their inert marker expires. VS Code Memento updates are not cross-window atomic, so simultaneous explicit starts may supersede this **best-effort UI handoff**; it is not a security capability or a guarantee that a window opened. Manual Show study plan remains available.

- The existing TensorTonic view is now **Study plan**: plan name → original ordered sections → clickable problems. Plan and section headers show solved counts; leaves keep solved checkmarks and mark the selected solution **Current**.
- Plan/section labels and stable IDs come from the already-supported public plan metadata endpoint. The adapter adds bounded, plain `studyPlanTitle` and `section: {id,title,order}` metadata to each ordered reference; no new API route or permission is added. Empty/unsupported-only sections and quizzes are not invented as problem rows.
- **TensorTonic: Show study plan sidebar** explicitly opens the view. Automatic solution-tab synchronization only reveals rows while the view is already visible, using `focus: false`. It does not replace another sidebar, move keyboard focus away from code/Agent, or silently switch the chosen plan.
- Existing Explorer, files, layout settings, solution contents and unsaved edits are preserved. Problem leaves reuse the existing guarded Open command. Free problems remain available without artificial curriculum sections.
- Loading, empty, disconnected and failed-refresh states remain actionable and do not leave stale clickable problem rows. Tree snapshots have cached nodes and parent links; old snapshots cannot expose stale descendants. Reveals are serialized so a slow older selection is followed by the newest one.

Interactive website cards and website-solution import remain outside this patch.

## Checks completed

- `npm test`: **188 passed**, no failures/skips. Covers plan/section structure, original order, solved counts, current markers, stable IDs, plain labels, API/alias collisions, cached parents, stale nodes, missing metadata, free/disconnected/loading/empty states, plan selection, refresh and reveal races, explicit sidebar opening, and preservation of unsaved files/settings. Dedicated-workspace coverage additionally checks first choice/cancel/change, invalid/missing/remote folder URIs, single-folder reuse versus multi-root/saved workspaces, unsupported/trust-revoked states, concurrent gestures, handoff expiry/supersession/consumption, failed opens without retry, and zero shared-state cleanup at startup.
- `npm run test:transport`: **15 passed**, no failures/skips. Real loopback HTTP with simulated browser/upstream only; no live account or grading requests.
- Independent read-only review cleared the adapter, tree and runtime integration, including visible-only non-focusing reveals and packaging inclusion. The final full suite includes all subsequent workspace and solved-progress regressions. Review identified the cross-window Memento cleanup race; the implementation removed startup/error writes to shared state rather than claiming atomic deletion.
- Saved first-party public responses replayed through the updated adapter produce PyTorch Sheet with all 30 problems in six original sections, retaining their service IDs/titles/order.
- JavaScript syntax and `git diff --check` passed. VSIX/companion archives passed integrity checks; packaged source parity and the canonical companion connector were verified. The new extension artifact is version **0.3.2**; historical release packages are unchanged.

## Native UI verification boundary

The earlier isolated Linux VS Code launch exited 133 before its extension-host tests started; this shell has no display server. No long repeat or alternate browser-policy route was attempted for the sidebar. **The new 0.3.2 new-window workflow and sidebar have not been visually verified in native VS Code.** Mocked VS Code API tests establish behavior, not pixel rendering or the user's saved layout.

The user's later 0.3.1 screenshots separately show formatted Simple Neural Network equations/headings, readable Softmax Run **3/3, 3 ms**, and Submit **43/43, 688 ms**. The user confirmed original ordering and Next navigation. Those observations establish the earlier patch's manual behavior, not an automated or visual pass for this new sidebar.

## Focused manual check after installation

1. From a development folder with an unsaved harmless edit, run **TensorTonic: Start studying**. Cancel once: nothing should change. Run again and choose a dedicated local study folder: a new window should open while the development window/edit remain intact. Review any normal folder-trust prompt yourself.
2. In the study window, connect normally and confirm the plan root, ordered sections and completion counts. Run Start studying again there: it should reuse that window. If the sidebar handoff was unavailable, use Show study plan sidebar.
3. Expand two sections and open problems. Edit a solution without saving, switch problems and return; confirm the edits remain.
4. Switch solution tabs while the Study plan view is visible: Current/selection should follow without moving editor focus. Switch to Explorer, then another solution: Explorer should stay visible.
5. Choose another plan or free problems, refresh, and disconnect/reconnect. Confirm old rows do not reappear and files remain accessible in Explorer.

No Run/Submit request is needed to check the study-workspace/sidebar patch. Existing old test folders remain untouched; check that new problem files use the chosen study folder’s configured solution subfolder.
