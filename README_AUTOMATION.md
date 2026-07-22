# Codex Automation Setup

This folder contains a basic automation framework for running Codex as a repeatable development pipeline.

## What this gives you

- YAML task cards in `tasks/backlog`
- Prompt generation from task cards
- Local Codex CLI execution
- Verification loop with typecheck/test/build
- Optional repair loop when verification fails
- Git branch, pull request, CI wait, PR metadata validation, and squash merge
- Bounded multi-task loop modes
- Basic GitHub Actions CI workflow

## Required local tools

Install these before using the full automation flow:

```bash
node --version
npm --version
git --version
codex --version
gh --version
```

`gh` must be installed and authenticated for real automation runs:

```bash
gh auth login
gh auth status
```

## Install dependencies

```bash
npm install
```

## Generate a prompt from a task

```bash
npm run prompt 001
```

Output:

```text
prompts/generated/001.md
```

## Run one Codex task

```bash
npm run codex:task 001
```

This runs:

```text
task YAML -> generated prompt -> codex exec
```

## Run the automation cycle locally

Dry run first:

```bash
npm run auto-dev:dry
```

Process exactly one task:

```bash
npm run auto-dev
```

Process the current backlog and stop on the first failure:

```bash
npm run auto-dev:all
```

Process tasks continuously with runtime and task-count safety limits:

```bash
npm run auto-dev:until-stop
```

Generate the next deterministic batch of backlog tasks:

```bash
npm run auto-dev:generate-tasks
```

The generator inspects project documentation, current source/test paths, and task files in `backlog`, `active`, `done`, and `failed`, plus detectable unmerged `codex/task-*` branches. It selects the next small roadmap items, applies state-aware duplicate handling, assigns the next numeric IDs, writes only `tasks/backlog/*.yaml`, and commits/pushes those files on `main`. The default batch size is five; override it with `AUTO_DEV_GENERATED_TASK_COUNT`.

Backlog exhaustion is not the same as product completion. When no normal roadmap task remains, the automation runs a deterministic product-completeness audit framework before it can report the product complete. A placeholder entry such as a constant export from `src/index.ts` or an `index.html` page that only says the automation is installed fails even when all core helpers and unit tests exist.

The framework currently has eight audit categories:

1. **UI:** Vite development command, app root and mount, file/drop/mode controls, preview/status/error output, download flow, responsive styling, and a non-placeholder production entry.
2. **Import coverage:** reachability of every implemented PNG sequence, spritesheet grid, and spritesheet JSON importer from `src/index.ts`.
3. **Export/download:** Aseprite exporter availability, reachable browser download, clear export failures, and a disabled state before a valid project exists.
4. **End-to-end conversion:** synthetic importer-to-`SpriteProject`-to-Aseprite coverage for every implemented input plus focused app-flow or DOM-free UI state tests.
5. **Documentation/manual usage:** browser-local/no-upload policy, supported inputs, flat-PNG layer limits, UI instructions, manual Aseprite output verification, and compatibility limits.
6. **Deployment readiness:** a static deployment guide or task and production build verification notes. The audit never enables workflow changes automatically.
7. **Error handling:** tested invalid file, unsupported format, grid, failed export, no-project, status, and error states.
8. **Performance/large-file readiness:** large-file/browser-memory warnings, long-running conversion status, and browser memory documentation.

The reachability checks follow local imports starting at `src/index.ts`; a helper merely existing under `src/app` or `src/core` does not make it part of the browser product. Each category reports its passed and missing checks independently.

If checks fail, the generator maps missing check keys to small, deterministic product-completion cards. These can mount or wire UI controls, connect individual importers and export, add importer-specific E2E tests, improve error states, add usage/compatibility/deployment/performance documentation, or add large-file and progress UI. Generated cards use the next repository-wide numeric IDs and include verification and acceptance criteria. They do not require `allowed_paths`, `forbidden_paths`, `max_changed_files`, or task-specific auto-merge policy fields. UI cards require plain TypeScript and DOM APIs, browser-local processing, reuse of existing helpers, no framework or other dependency additions, no server upload, no duplicated conversion logic, and focused tests.

Duplicate handling is state-aware rather than a single global skip:

- An identical backlog, active, or open-branch task blocks another copy because the work is still pending.
- A failed duplicate produces a uniquely named retry/remediation task that references the failed task and remaining check.
- A done duplicate does not count as proof that the product is complete when its audit is still red. It produces a uniquely named remediation task that identifies the audit category/check and prior task, and asks Codex to distinguish missing work, an incomplete implementation, and a stale detector or mapping.
- A failing check with no task mapping produces a focused investigation task. That task may repair the mapping/detector with a regression test, make a safely scoped product fix, or document why the audit is invalid.

Every product-audit generation pass prints the failing category and check, mapped candidate title, duplicate ID/location/state, whether a done task still fails, and the generation/blocking decision. If every candidate is blocked, the loop prints the exact non-mutating inspection command and the next recovery action instead of calling the product complete.

To add an audit later, add its evidence check to `auditProductCompleteness`, register the check key under a category in `PRODUCT_AUDIT_DEFINITIONS` (or add a new category), and map the missing key to one or more safe templates in `PRODUCT_COMPLETION_TASKS`. Add one passing fixture and one missing-work test for the new check.

When product-completion cards are generated outside a continuing `--until-stop` run, rerun the automation with:

```bash
npm run auto-dev:until-stop
```

To let that process refill an empty backlog and continue automatically, set `AUTO_DEV_GENERATE_TASKS_WHEN_EMPTY=true` as described below. The successful terminal reason is `No backlog tasks remain and product completeness audits passed`; generating new product work reports `Generated product-completion tasks; rerun automation to continue` unless the current mode continues automatically.

Preview generation without pulling, writing, committing, or pushing:

```bash
node scripts/auto-dev-cycle.mjs --dry-run --generate-tasks
```

This dry run is the preferred first diagnostic for an audit dead-end. It shows which checks remain red and whether the next work item will be normal missing work, done-task remediation, failed-task retry, unmapped-check investigation, or a pending-duplicate block. It never writes or moves task files.

### Troubleshooting audit-generation dead ends

The older stop reason `Product completeness audits failed and no non-duplicate product-completion tasks could be generated` meant task history and product evidence disagreed: a card could be marked done even though its detector remained red, or the detector/mapping itself could be stale. It never meant that the product was complete. Current automation reports the conflicting task and creates remediation or investigation work whenever it can do so safely. If every candidate is genuinely still pending in backlog, active state, or an open branch, the diagnostic names those blockers and recommends the dry-run command above instead of generating backlog spam.

Each real task cycle:

1. Requires a clean tree, checks out `main`, and pulls `origin/main` with `--ff-only`.
2. Picks the first YAML file from `tasks/backlog` and creates `codex/task-<id>`.
3. Generates the prompt and runs Codex with the prompt on stdin.
4. Runs typecheck, test, and build sequentially outside the Codex sandbox, with bounded repair attempts.
5. Leaves the backlog task unchanged while the implementation branch and PR are open.
6. Commits, pushes, and creates a PR into `main`.
7. Waits for GitHub checks and validates the PR head branch and base branch.
8. Squash-merges safe PRs and requests remote branch deletion.
9. Checks out `main`, pulls the merged result, moves the task from `backlog` to `done` on `main`, pushes that state-only commit, removes the local task branch, and continues.

If Codex implements the task but its managed Windows sandbox cannot start Vite/Vitest because of a known access-denied/config-resolution error, the outer automation treats that Codex exit as recoverable only when task-relevant non-generated repository changes exist. It then runs the full local verification sequence normally. A real local verification failure still stops the task.

The loop also resumes existing task work instead of recreating it: merged PRs with backlog cards are finalized on `main`; open PRs are checked out, locally verified, checked, validated, and merged; existing branches without PRs are verified and used to create one. Closed/stale PRs stop with recovery guidance.

`--all` is bounded by the backlog length found after its first refresh of `main`. `--until-stop` defaults to 10 tasks or 120 minutes, whichever comes first. Both stop on hard failures.

## Loop safety configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `AUTO_DEV_MAX_TASKS` | backlog length for `--all`; `10` for `--until-stop` | Maximum successful tasks in one process |
| `AUTO_DEV_MAX_MINUTES` | none for one/all; `120` for `--until-stop` | Wall-clock runtime limit |
| `AUTO_DEV_STOP_ON_FAILURE` | `true` | Return a failing exit code for task failures |
| `AUTO_DEV_ALLOW_NO_PR_CHECKS` | `false` | Continue past GitHub's `no checks reported` response after mandatory local verification |
| `AUTO_DEV_GENERATE_TASKS_WHEN_EMPTY` | `false` | Generate normal roadmap tasks and continue processing generated product-completion tasks when `--until-stop` finds an empty backlog |
| `AUTO_DEV_GENERATED_TASK_COUNT` | `5` | Number of tasks in each generated batch |
| `AUTO_DEV_MAX_GENERATION_ROUNDS` | `1` | Maximum generated batches in one `--until-stop` process |

Example:

```bash
AUTO_DEV_MAX_TASKS=20 AUTO_DEV_MAX_MINUTES=240 npm run auto-dev:until-stop
```

PowerShell equivalent:

```powershell
$env:AUTO_DEV_MAX_TASKS = "20"
$env:AUTO_DEV_MAX_MINUTES = "240"
npm run auto-dev:until-stop
```

To let `--until-stop` refill an empty backlog once and continue:

```bash
AUTO_DEV_GENERATE_TASKS_WHEN_EMPTY=true npm run auto-dev:until-stop
```

PowerShell:

```powershell
$env:AUTO_DEV_GENERATE_TASKS_WHEN_EMPTY = "true"
npm run auto-dev:until-stop
```

Override the default Codex arguments with `CODEX_EXEC_ARGS` when needed:

```bash
CODEX_EXEC_ARGS="--sandbox workspace-write" npm run auto-dev
```

PowerShell equivalent:

```powershell
$env:CODEX_EXEC_ARGS = "--sandbox workspace-write"
npm run auto-dev
```

## Legacy task policy fields

Existing task YAML may still contain `scope.allowed_paths`, `scope.forbidden_paths`, `auto_merge.allowed`, `auto_merge.max_changed_files`, or `auto_merge.forbidden_paths`. Automation accepts those fields for backward compatibility only. They do not restrict implementation, PR validation, or auto-merge.

## Safety defaults

- Auto-merges only after local checks, GitHub checks, and PR head/base metadata validation pass.
- Never moves task state on `codex/task-*` branches. A task moves to `done` on refreshed `main` only after its implementation PR is confirmed merged.
- Leaves task state unchanged after pushed-branch, PR, CI, safety, or merge failures and prints recovery guidance.
- Refuses to run when task-state files are dirty on a `codex/task-*` branch.
- Limits repair attempts to 3.
- Stops on Codex limit/auth errors, verification failure, CI failure, PR metadata failure, merge failure, runtime limits, and unclean Git state.
- Leaves failed tasks in their existing state so recovery never creates an uncommitted `done`/`failed` rename on a task branch.
- Exits if the working tree is dirty.
- Keeps generated prompts under `prompts/generated`.
- Does not reject a PR because of changed-file count, file location, declared task scope, forbidden-path fields, package files, workflow files, generated files, or `auto_merge.allowed: false`.
- Treats `no checks reported` as a failure unless `AUTO_DEV_ALLOW_NO_PR_CHECKS=true`; local verification and PR head/base metadata validation remain mandatory either way.
- Generated prompts do not require `rg` and tell Codex to use PowerShell or Node filesystem fallbacks when it is unavailable.

## Troubleshooting automation recovery

### Generated task ID drift

Generated IDs are repository-wide and always advance past task cards in `backlog`, `active`, `done`, and `failed`. A test must calculate the next ID from its fixture context or create an isolated task history; it must not assume that a number such as `022` stays available after more tasks are completed.

### Existing PR branch recovery

When an existing task PR fails local verification, check whether its branch is behind `origin/main`. Merge the latest main changes explicitly, rerun every mandatory check, and push the merge:

```bash
git checkout codex/task-<id>
git fetch origin main
git merge origin/main
npm run typecheck
npm run test
npm run build
git push
```

The automation reports whether the failure looks like an implementation problem, a branch behind main, a PR metadata problem, a managed sandbox limitation, or a failure from mandatory outer local verification. It does not force-merge `origin/main` into task branches.

### Managed Windows sandbox verification

Codex may be unable to start Vitest or Vite inside its managed Windows sandbox because of an access-denied, `EACCES`, or `EPERM` error before tests run. When task-relevant changes exist, this is classified as an environment limitation rather than an implementation failure. The outer automation still runs `typecheck`, `test`, and `build`; an outer verification failure remains final and cannot be bypassed.

### Product-completion task dependencies

While the broad `Mount browser converter UI` task remains in backlog/active work or has an open task branch, generation suppresses narrower file-input, drag/drop, mode-selector, importer wiring, preview, download, status, and responsive-style tasks that the broad task already covers. The summary lists skipped task titles. Once the broad task is in `done`, any audit gap that remains may generate the specific follow-up task.

## Recommended first command

```bash
npm run prompt 001
npm run auto-dev:dry
```

Then run:

```bash
npm run auto-dev
```

## Important

If this repository already has a `package.json`, merge the scripts/dependencies instead of blindly replacing it.
