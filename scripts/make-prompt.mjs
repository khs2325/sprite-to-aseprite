import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

const taskId = process.argv[2];

if (!taskId) {
  console.error("Usage: npm run prompt <task-id>");
  process.exit(1);
}

const root = process.cwd();
const taskDirs = [
  path.join(root, "tasks", "backlog"),
  path.join(root, "tasks", "active"),
  path.join(root, "tasks", "done"),
  path.join(root, "tasks", "failed")
];

function findTaskFile(id) {
  for (const dir of taskDirs) {
    if (!fs.existsSync(dir)) continue;

    const found = fs
      .readdirSync(dir)
      .find((file) => file.startsWith(`${id}-`) && file.endsWith(".yaml"));

    if (found) {
      return path.join(dir, found);
    }
  }

  return null;
}

function asList(value) {
  if (!value) return "- None";
  if (Array.isArray(value)) return value.map((item) => `- ${item}`).join("\n");
  return String(value).trim();
}

function formatTaskFocus(value) {
  if (!value || Array.isArray(value) || typeof value !== "object") return asList(value);
  return String(value.summary ?? "").trim() || "- Follow the task goal and requirements.";
}

function required(task, key) {
  if (task[key] === undefined || task[key] === null || task[key] === "") {
    throw new Error(`Task is missing required field: ${key}`);
  }
  return task[key];
}

const taskPath = findTaskFile(taskId);

if (!taskPath) {
  console.error(`Task not found: ${taskId}`);
  process.exit(1);
}

const task = YAML.parse(fs.readFileSync(taskPath, "utf8"));

for (const key of [
  "id",
  "title",
  "goal",
  "context",
  "non_goals",
  "requirements",
  "acceptance_criteria",
  "verification"
]) {
  required(task, key);
}

const templatePath = path.join(root, "prompts", "templates", "implement-task.md");
const template = fs.readFileSync(templatePath, "utf8");
const isProductCompletionTask = task.task_origin === "product-completion"
  || /product-completeness audit/iu.test(String(task.context ?? ""));
const isAuditGapTask = Boolean(task.audit_gap);
const productCompletionGuidance = isProductCompletionTask ? `

## Product-completion task focus

- Modify any repository file required to complete the task, while keeping the diff focused on the task goal.
- If verification fails because of clearly unrelated existing problems, report the failure instead of making an unrelated fix.
${isAuditGapTask
    ? "- This is an explicit audit-gap task. Change the audit detector or mapping only when the product evidence shows it is stale or wrong."
    : "- Do not repair the automation system unless the task goal or verification failure directly requires it."}
` : "";

const prompt = template
  .replaceAll("{{id}}", String(task.id))
  .replaceAll("{{title}}", String(task.title))
  .replaceAll("{{goal}}", String(task.goal).trim())
  .replaceAll("{{context}}", String(task.context).trim())
  .replaceAll("{{scope}}", formatTaskFocus(task.scope))
  .replaceAll("{{non_goals}}", asList(task.non_goals))
  .replaceAll("{{requirements}}", asList(task.requirements))
  .replaceAll("{{acceptance_criteria}}", asList(task.acceptance_criteria))
  .replaceAll("{{verification}}", asList(task.verification))
  .concat(productCompletionGuidance)
  .concat(`

## Managed Windows sandbox verification

If Vite/Vitest/build commands fail inside Codex with Windows sandbox access-denied errors before tests actually run, report it as a managed sandbox verification limitation. Do not keep retrying unrelated fixes. The outer automation will run local verification after Codex exits.

If \`rg\` is unavailable, use PowerShell \`Get-ChildItem\`, \`Select-String\`, or Node \`fs\` APIs instead.
`);

const outDir = path.join(root, "prompts", "generated");
fs.mkdirSync(outDir, { recursive: true });

const outPath = path.join(outDir, `${task.id}.md`);
fs.writeFileSync(outPath, prompt, "utf8");

console.log(`Generated prompt: ${path.relative(root, outPath)}`);
