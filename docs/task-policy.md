# Task Policy

## Task size

Each task should be small enough for one PR.

Good task examples:

- Define `SpriteProject` types.
- Add validation for frame references.
- Implement PNG sequence sorting.
- Add one importer test fixture.
- Add one UI component.

Bad task examples:

- Build the whole app.
- Implement all importers.
- Rewrite architecture.
- Add Aseprite writer, UI, and docs in one PR.

## Task card format

Tasks live in `tasks/backlog/*.yaml`.

Required fields:

- `id`
- `title`
- `priority`
- `risk`
- `goal`
- `context`
- `scope`
- `non_goals`
- `requirements`
- `acceptance_criteria`
- `verification`

Optional fields:

- `auto_merge`
- `notes`

## Risk levels

- `low`: docs, types, small tests, isolated helpers
- `medium`: importers, UI components, validation rules
- `high`: binary writer, parser security, dependencies, workflows

## Auto-merge policy

Default: do not auto-merge.

Only allow auto-merge when:

- Risk is low
- CI passes
- Changed files are limited
- No package/workflow/lockfile changes
- No binary writer changes

This automation setup creates PRs but does not auto-merge them by default.
