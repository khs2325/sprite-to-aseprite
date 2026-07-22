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
- `non_goals`
- `requirements`
- `acceptance_criteria`
- `verification`

Optional fields:

- `scope` (legacy planning context only; not enforced)
- `auto_merge`
- `notes`

## Risk levels

- `low`: docs, types, small tests, isolated helpers
- `medium`: importers, UI components, validation rules
- `high`: binary writer, parser security, dependencies, workflows

## Automation merge policy

Automation may auto-merge after mandatory local verification passes, required GitHub PR checks pass, and the PR head/base metadata is valid.

Legacy task fields such as `scope.allowed_paths`, `scope.forbidden_paths`, `auto_merge.allowed`, `auto_merge.max_changed_files`, and `auto_merge.forbidden_paths` may remain in existing YAML for compatibility, but they do not restrict implementation, PR validation, or merging.
