import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const taskId = process.argv[2];

if (!taskId) {
  console.error("Usage: npm run codex:task <task-id>");
  process.exit(1);
}

function quoteArg(arg) {
  return /[\s"]/u.test(arg) ? `"${arg.replaceAll('"', '\\"')}"` : arg;
}

function formatCommand(command, args) {
  return [command, ...args].map(quoteArg).join(" ");
}

function spawnCommand(command, args, options) {
  if (process.platform === "win32" && command === "codex") {
    return spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", formatCommand(command, args)], options);
  }

  return spawnSync(command, args, options);
}

function run(command, args, options = {}) {
  console.log(`\n> ${command} ${args.join(" ")}`);
  const result = spawnCommand(command, args, {
    stdio: "inherit",
    shell: false,
    ...options
  });

  if (result.error || result.status !== 0) {
    if (result.error) console.error(result.error.message);
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

const extraArgs = process.env.CODEX_EXEC_ARGS === undefined
  ? ["--sandbox", "workspace-write"]
  : process.env.CODEX_EXEC_ARGS.trim().split(/\s+/u).filter(Boolean);
const codexArgs = ["exec", ...extraArgs, "-"];
const commandText = formatCommand("codex", codexArgs);

console.log(`\n> ${commandText}`);

const result = spawnCommand("codex", codexArgs, {
  input: prompt,
  stdio: ["pipe", "pipe", "pipe"],
  encoding: "utf8",
  maxBuffer: 10 * 1024 * 1024,
  shell: false
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

if (result.error || result.status !== 0) {
  console.error(`Command failed: ${commandText}`);
  if (result.error) console.error(result.error.message);
  process.exit(result.status ?? 1);
}
