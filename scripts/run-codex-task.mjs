import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const taskId = process.argv[2];

if (!taskId) {
  console.error("Usage: npm run codex:task <task-id>");
  process.exit(1);
}

function run(command, args, options = {}) {
  console.log(`\n> ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: false,
    ...options
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run("node", ["scripts/make-prompt.mjs", taskId]);

const promptPath = path.resolve("prompts", "generated", `${taskId}.md`);

if (!fs.existsSync(promptPath)) {
  console.error(`Generated prompt not found: ${promptPath}`);
  process.exit(1);
}

const prompt = fs.readFileSync(promptPath, "utf8");

run("codex", ["exec", "--sandbox", "workspace-write", prompt]);
