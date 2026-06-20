# Codex Automation Setup

This folder contains a basic automation framework for running Codex as a repeatable development pipeline.

## What this gives you

- YAML task cards in `tasks/backlog`
- Prompt generation from task cards
- Local Codex CLI execution
- Verification loop with typecheck/test/build
- Optional repair loop when verification fails
- Git branch, pull request, CI wait, safety validation, and squash merge
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

The generator inspects project documentation, current source/test paths, and task files in `backlog`, `done`, and `failed`. It selects the next small roadmap items, skips normalized duplicate titles and work with known completion paths, assigns the next numeric IDs, writes only `tasks/backlog/*.yaml`, and commits/pushes those files on `main`. The default batch size is five; override it with `AUTO_DEV_GENERATED_TASK_COUNT`.

Preview generation without pulling, writing, committing, or pushing:

```bash
node scripts/auto-dev-cycle.mjs --dry-run --generate-tasks
```

Each real task cycle:

1. Requires a clean tree, checks out `main`, and pulls `origin/main` with `--ff-only`.
2. Picks the first YAML file from `tasks/backlog` and creates `codex/task-<id>`.
3. Generates the prompt and runs Codex with the prompt on stdin.
4. Runs typecheck, test, and build sequentially outside the Codex sandbox, with bounded repair attempts.
5. Leaves the backlog task unchanged while the implementation branch and PR are open.
6. Commits, pushes, and creates a PR into `main`.
7. Waits for GitHub checks and validates the PR head, base, task policy, scope, and changed files.
8. Squash-merges safe PRs and requests remote branch deletion.
9. Checks out `main`, pulls the merged result, moves the task from `backlog` to `done` on `main`, pushes that state-only commit, removes the local task branch, and continues.

If Codex implements the task but its managed Windows sandbox cannot start Vite/Vitest because of a known access-denied/config-resolution error, the outer automation treats that Codex exit as recoverable only when task-relevant source, test, or documentation changes exist. It then runs the full local verification sequence normally. A real local verification failure still stops the task.

The loop also resumes existing task work instead of recreating it: merged PRs with backlog cards are finalized on `main`; open PRs are checked out, locally verified, checked, validated, and merged; existing branches without PRs are verified and used to create one. Closed/stale PRs stop with recovery guidance.

`--all` is bounded by the backlog length found after its first refresh of `main`. `--until-stop` defaults to 10 tasks or 120 minutes, whichever comes first. Both stop on hard failures.

## Loop safety configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `AUTO_DEV_MAX_TASKS` | backlog length for `--all`; `10` for `--until-stop` | Maximum successful tasks in one process |
| `AUTO_DEV_MAX_MINUTES` | none for one/all; `120` for `--until-stop` | Wall-clock runtime limit |
| `AUTO_DEV_STOP_ON_FAILURE` | `true` | Return a failing exit code for task failures |
| `AUTO_DEV_ALLOW_WORKFLOW_CHANGES` | `false` | Permit `.github/workflows/*` during PR safety validation |
| `AUTO_DEV_ALLOW_LOCKFILE_CHANGES` | `false` | Permit lockfile-only changes |
| `AUTO_DEV_ALLOW_NO_PR_CHECKS` | `false` | Continue past GitHub's `no checks reported` response after mandatory local verification |
| `AUTO_DEV_GENERATE_TASKS_WHEN_EMPTY` | `false` | Generate deterministic tasks when `--until-stop` finds an empty backlog |
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

## Safety defaults

- Auto-merges only after local checks, GitHub checks, and changed-file safety validation pass.
- Never moves task state on `codex/task-*` branches. A task moves to `done` on refreshed `main` only after its implementation PR is confirmed merged.
- Leaves task state unchanged after pushed-branch, PR, CI, safety, or merge failures and prints recovery guidance.
- Refuses to run when task-state files are dirty on a `codex/task-*` branch.
- Limits repair attempts to 3.
- Stops on Codex limit/auth errors, verification failure, CI failure, unsafe diffs, merge failure, runtime limits, and unclean Git state.
- Leaves failed tasks in their existing state so recovery never creates an uncommitted `done`/`failed` rename on a task branch.
- Exits if the working tree is dirty.
- Keeps generated prompts under `prompts/generated`.
- Rejects workflow changes by default, unsafe lockfile changes, generated artifacts, secrets, huge additions, and files outside explicit task scope.
- Treats `no checks reported` as a failure unless `AUTO_DEV_ALLOW_NO_PR_CHECKS=true`; safety validation remains mandatory either way.
- Generated prompts do not require `rg` and tell Codex to use PowerShell or Node filesystem fallbacks when it is unavailable.

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
