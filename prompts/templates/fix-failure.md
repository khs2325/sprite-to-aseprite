Read AGENTS.md first.

The previous automated task failed verification.

Task ID: {{id}}
Task title: {{title}}

Failed command:
{{failed_command}}

Failure log:
```text
{{failure_log}}
```

Fix only the smallest cause of the failure.

Rules:
- Do not refactor unrelated code.
- Do not start a new feature.
- Do not remove tests to make the build pass.
- If a test is wrong, explain why before changing it.
- Keep the diff small.
- Stop after making the fix.
