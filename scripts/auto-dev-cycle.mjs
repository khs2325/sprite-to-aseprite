import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const maxRepairAttempts = Number(process.env.AUTO_DEV_MAX_REPAIR_ATTEMPTS ?? 3);

function quoteArg(arg) {
  return /[\s"]/u.test(arg) ? `"${arg.replaceAll('"', '\\"')}"` : arg;
}

function formatCommand(command, commandArgs) {
  return [command, ...commandArgs].map(quoteArg).join(" ");
}

function spawnCommand(command, commandArgs, options) {
  if (process.platform === "win32" && ["codex", "npm"].includes(command)) {
    return spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", formatCommand(command, commandArgs)], options);
  }

  return spawnSync(command, commandArgs, options);
}

function run(command, args = [], options = {}) {
  const { skipInDryRun = false, ...spawnOptions } = options;
  const commandText = formatCommand(command, args);
  console.log(`\n> ${commandText}`);

  if (dryRun && skipInDryRun) {
    console.log("[dry-run] skipped");
    return { stdout: "", stderr: "", status: 0 };
  }

  const result = spawnCommand(command, args, {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    shell: false,
    ...spawnOptions
  });

  if (spawnOptions.stdio === "inherit") {
    if (result.error || result.status !== 0) {
      const error = new Error(`Command failed: ${commandText}`);
      error.cause = result.error;
      error.status = result.status;
      throw error;
    }
    return result;
  }

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.error || result.status !== 0) {
    const error = new Error(`Command failed: ${commandText}`);
    error.cause = result.error;
    error.command = commandText;
    error.stdout = result.stdout ?? "";
    error.stderr = result.stderr ?? "";
    error.status = result.status;
    throw error;
  }

  return result;
}

function runVisible(command, args = [], options = {}) {
  return run(command, args, { stdio: "inherit", ...options });
}

function readStatus() {
  return run("git", ["status", "--porcelain"]).stdout.trim();
}

function ensureCleanGit() {
  const status = readStatus();

  if (status.length > 0) {
    console.error("Git working tree is not clean. Commit or stash changes first.");
    process.exit(1);
  }
}

function listBacklogTasks() {
  const backlogDir = path.resolve("tasks", "backlog");

  if (!fs.existsSync(backlogDir)) return [];

  return fs
    .readdirSync(backlogDir)
    .filter((file) => file.endsWith(".yaml"))
    .sort();
}

function moveTaskFile(fromDirName, toDirName, fileName) {
  const fromPath = path.resolve("tasks", fromDirName, fileName);
  const toDir = path.resolve("tasks", toDirName);
  const toPath = path.join(toDir, fileName);

  fs.mkdirSync(toDir, { recursive: true });

  if (dryRun) {
    console.log(`[dry-run] move ${fromPath} -> ${toPath}`);
    return toPath;
  }

  fs.renameSync(fromPath, toPath);
  return toPath;
}

function getTaskId(fileName) {
  return fileName.split("-")[0];
}

function runChecks() {
  run("npm", ["run", "typecheck"]);
  run("npm", ["run", "test"]);
  run("npm", ["run", "build"]);
}

function generatePrompt(taskId) {
  run("node", ["scripts/make-prompt.mjs", taskId]);
}

function getCodexArgs() {
  const extraArgs = process.env.CODEX_EXEC_ARGS === undefined
    ? ["--sandbox", "workspace-write"]
    : process.env.CODEX_EXEC_ARGS.trim().split(/\s+/u).filter(Boolean);

  return ["exec", ...extraArgs, "-"];
}

function runCodexWithPrompt(prompt) {
  const codexArgs = getCodexArgs();
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
    const error = new Error(`Command failed: ${commandText}`);
    error.cause = result.error;
    error.command = commandText;
    error.stdout = result.stdout ?? "";
    error.stderr = result.stderr ?? result.error?.message ?? "";
    error.status = result.status;
    writeFailureLog(error);
    throw error;
  }
}

function readPrompt(taskId) {
  const promptPath = path.resolve("prompts", "generated", `${taskId}.md`);
  return fs.readFileSync(promptPath, "utf8");
}

function writeFailureLog(error) {
  const outDir = path.resolve("prompts", "generated");
  fs.mkdirSync(outDir, { recursive: true });

  const logPath = path.join(outDir, "last-failure.log");
  const content = [
    "COMMAND:",
    error.command ?? "Unknown",
    "",
    "EXIT STATUS:",
    String(error.status ?? "Unknown"),
    "",
    "STDOUT:",
    error.stdout ?? "",
    "",
    "STDERR:",
    error.stderr ?? "",
    "",
    "MESSAGE:",
    error.message ?? ""
  ].join("\n");

  fs.writeFileSync(logPath, content, "utf8");
  return logPath;
}

function repair(taskId, error) {
  const logPath = writeFailureLog(error);
  const failureLog = fs.readFileSync(logPath, "utf8");

  const prompt = `Read AGENTS.md first.

The previous automated task ${taskId} failed verification.

Failure log:
\`\`\`text
${failureLog.slice(0, 20000)}
\`\`\`

Fix only the smallest cause of the failure.

Rules:
- Do not refactor unrelated code.
- Do not start a new feature.
- Do not remove tests to make checks pass.
- If a test is wrong, explain why before changing it.
- Keep the diff small.
- Stop after making the fix.
`;

  runCodexWithPrompt(prompt);
}

function hasCommand(command) {
  const result = spawnCommand(command, ["--version"], {
    stdio: "ignore",
    shell: false
  });

  return !result.error && result.status === 0;
}

function commitAndPush(taskId, branchName) {
  runVisible("git", ["add", "."]);
  runVisible("git", ["commit", "-m", `Task ${taskId}: automated Codex implementation`]);
  runVisible("git", ["push", "-u", "origin", branchName]);
}

function commitTaskCompletion(taskId, taskFile) {
  runVisible("git", ["add", "--", path.join("tasks", "backlog", taskFile), path.join("tasks", "done", taskFile)]);
  runVisible("git", ["commit", "-m", `Task ${taskId}: mark automation task done`]);
  runVisible("git", ["push"]);
}

function createPr(taskId, branchName) {
  if (!hasCommand("gh")) {
    console.log("GitHub CLI not found. Skipping PR creation.");
    return;
  }

  runVisible(
    "gh",
    [
      "pr",
      "create",
      "--title",
      `Task ${taskId}: automated Codex implementation`,
      "--body",
      "Automated Codex task. Local verification attempted: typecheck, test, build.",
      "--head",
      branchName
    ]
  );
}

function printDryRun(taskId, taskFile, branchName) {
  console.log(`[dry-run] would create branch ${branchName}`);
  console.log(`[dry-run] would generate prompts/generated/${taskId}.md from ${taskFile}`);
  console.log(`[dry-run] would run ${formatCommand("codex", getCodexArgs())} with the prompt on stdin`);
  console.log("[dry-run] would run npm run typecheck, npm run test, and npm run build");
  console.log(`[dry-run] would commit and push ${branchName} only after checks pass`);
  console.log(`[dry-run] would create a PR if gh is available`);
  console.log(`[dry-run] would then move ${taskFile} from tasks/backlog to tasks/done`);
  console.log("[dry-run] no repository changes were made");
}

function failTask(taskFile) {
  for (const fromDir of ["backlog", "done"]) {
    if (fs.existsSync(path.resolve("tasks", fromDir, taskFile))) {
      moveTaskFile(fromDir, "failed", taskFile);
      return;
    }
  }
}

function main() {
  if (!dryRun) ensureCleanGit();

  const backlog = listBacklogTasks();

  if (backlog.length === 0) {
    console.log(dryRun ? "[dry-run] no backlog tasks found; no repository changes were made" : "No backlog tasks found.");
    return;
  }

  const taskFile = backlog[0];
  const taskId = getTaskId(taskFile);
  const branchName = `codex/task-${taskId}`;

  console.log(`Selected task: ${taskFile}`);

  if (dryRun) {
    printDryRun(taskId, taskFile, branchName);
    return;
  }

  try {
    runVisible("git", ["checkout", "-b", branchName]);

    generatePrompt(taskId);
    const prompt = readPrompt(taskId);

    runCodexWithPrompt(prompt);

    let checksPassed = false;
    let lastError = null;

    for (let attempt = 0; attempt <= maxRepairAttempts; attempt += 1) {
      try {
        runChecks();
        checksPassed = true;
        break;
      } catch (error) {
        lastError = error;

        if (attempt >= maxRepairAttempts) {
          break;
        }

        console.log(`Verification failed. Repair attempt ${attempt + 1}/${maxRepairAttempts}.`);
        repair(taskId, error);
      }
    }

    if (!checksPassed) {
      throw lastError ?? new Error("Verification failed.");
    }

    commitAndPush(taskId, branchName);
    createPr(taskId, branchName);

    moveTaskFile("backlog", "done", taskFile);
    commitTaskCompletion(taskId, taskFile);
    console.log("Automation cycle completed.");
  } catch (error) {
    console.error(error);
    failTask(taskFile);
    process.exit(1);
  }
}

main();
