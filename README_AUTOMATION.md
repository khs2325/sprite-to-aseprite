# Codex Automation Setup

This folder contains a basic automation framework for running Codex as a repeatable development pipeline.

## What this gives you

- YAML task cards in `tasks/backlog`
- Prompt generation from task cards
- Local Codex CLI execution
- Verification loop with typecheck/test/build
- Optional repair loop when verification fails
- Optional Git branch, commit, push, and PR creation
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

`gh` is only required if you want automatic PR creation.

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
npm run auto-dev -- --dry-run
```

Real run:

```bash
npm run auto-dev
```

The real cycle:

1. Picks the next YAML file from `tasks/backlog`
2. Moves it to `tasks/active`
3. Creates a branch
4. Generates a Codex prompt
5. Runs `codex exec`
6. Runs typecheck/test/build
7. Tries a limited repair loop if checks fail
8. Commits changes
9. Pushes the branch
10. Creates a PR if `gh` is available
11. Moves the task to `tasks/done`

## Safety defaults

- Does not auto-merge PRs.
- Does not push directly to `main`.
- Limits repair attempts to 3.
- Moves failed tasks to `tasks/failed`.
- Exits if the working tree is dirty.
- Keeps generated prompts under `prompts/generated`.

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
