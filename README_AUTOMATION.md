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

Each real task cycle:

1. Requires a clean tree, checks out `main`, and pulls `origin/main` with `--ff-only`.
2. Picks the first YAML file from `tasks/backlog` and creates `codex/task-<id>`.
3. Generates the prompt and runs Codex with the prompt on stdin.
4. Runs typecheck/test/build and bounded repair attempts.
5. Moves the task to `tasks/done` in the task branch.
6. Commits, pushes, and creates a PR into `main`.
7. Waits for GitHub checks and validates the PR head, base, task policy, scope, and changed files.
8. Squash-merges safe PRs and requests remote branch deletion.
9. Checks out `main`, pulls the merged result, removes the local task branch, and continues in loop modes.

`--all` is bounded by the backlog length found after its first refresh of `main`. `--until-stop` defaults to 10 tasks or 120 minutes, whichever comes first. Both stop on hard failures.

## Loop safety configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `AUTO_DEV_MAX_TASKS` | backlog length for `--all`; `10` for `--until-stop` | Maximum successful tasks in one process |
| `AUTO_DEV_MAX_MINUTES` | none for one/all; `120` for `--until-stop` | Wall-clock runtime limit |
| `AUTO_DEV_STOP_ON_FAILURE` | `true` | Return a failing exit code for task failures |
| `AUTO_DEV_ALLOW_WORKFLOW_CHANGES` | `false` | Permit `.github/workflows/*` during PR safety validation |
| `AUTO_DEV_ALLOW_LOCKFILE_CHANGES` | `false` | Permit lockfile-only changes |

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
- Never pushes task results or queue movement directly to `main`; the task movement is included in the reviewed PR.
- Limits repair attempts to 3.
- Stops on Codex limit/auth errors, verification failure, CI failure, unsafe diffs, merge failure, runtime limits, and unclean Git state.
- Moves real failed tasks to `tasks/failed` when it can do so without masking the original failure.
- Exits if the working tree is dirty.
- Keeps generated prompts under `prompts/generated`.
- Rejects workflow changes by default, unsafe lockfile changes, generated artifacts, secrets, huge additions, and files outside explicit task scope.

## Recommended first command

```bash
npm run prompt 001
npm run auto-dev -- --dry-run
```

Then run:

```bash
npm run auto-dev
```

## Important

If this repository already has a `package.json`, merge the scripts/dependencies instead of blindly replacing it.
