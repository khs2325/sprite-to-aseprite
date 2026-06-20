import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const maxRepairAttempts = Number(process.env.AUTO_DEV_MAX_REPAIR_ATTEMPTS ?? 3);

function run(command, args = [], options = {}) {
  console.log(`\n> ${command} ${args.join(" ")}`);

  if (dryRun && options.skipInDryRun) {
    console.log("[dry-run] skipped");
    return { stdout: "", stderr: "", status: 0 };
  }

  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: false,
    ...options
  });

  if (options.stdio === "inherit") {
    if (result.status !== 0) {
      throw new Error(`Command failed: ${command} ${args.join(" ")}`);
    }
    return result;
  }

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.status !== 0) {
    const error = new Error(`Command failed: ${command} ${args.join(" ")}`);
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
  runVisible("npm", ["run", "typecheck"]);
  runVisible("npm", ["run", "test"]);
  runVisible("npm", ["run", "build"]);
}

function generatePrompt(taskId) {
  runVisible("node", ["scripts/make-prompt.mjs", taskId]);
}

function runCodexWithPrompt(prompt) {
  console.log("\n> codex exec --sandbox workspace-write --ask-for-approval never -");

  if (dryRun) {
    console.log("[dry-run] skipped");
    return;
  }

  const result = spawnSync(
    "codex",
    ["exec", "--sandbox", "workspace-write", "--ask-for-approval", "never", "-"],
    {
      input: prompt,
      stdio: ["pipe", "inherit", "inherit"],
      encoding: "utf8",
      shell: false
    }
  );

  if (result.status !== 0) {
    throw new Error(
      "Command failed: codex exec --sandbox workspace-write --ask-for-approval never -"
    );
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
  const result = spawnSync(command, ["--version"], {
    stdio: "ignore",
    shell: false
  });

  return result.status === 0;
}

function commitAndPush(taskId, branchName) {
  runVisible("git", ["add", "."]);
  runVisible("git", ["commit", "-m", `Task ${taskId}: automated Codex implementation`]);
  runVisible("git", ["push", "-u", "origin", branchName], { skipInDryRun: true });
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
    ],
    { skipInDryRun: true }
  );
}

function main() {
  ensureCleanGit();

  const backlog = listBacklogTasks();

  if (backlog.length === 0) {
    console.log("No backlog tasks found.");
    return;
  }

  const taskFile = backlog[0];
  const taskId = getTaskId(taskFile);
  const branchName = `codex/task-${taskId}`;

  console.log(`Selected task: ${taskFile}`);

  moveTaskFile("backlog", "active", taskFile);

  try {
    runVisible("git", ["checkout", "-b", branchName], { skipInDryRun: true });

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

    moveTaskFile("active", "done", taskFile);
    console.log("Automation cycle completed.");
  } catch (error) {
    console.error(error);
    moveTaskFile("active", "failed", taskFile);
    process.exit(1);
  }
}

main();
