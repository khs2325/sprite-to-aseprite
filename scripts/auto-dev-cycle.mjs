import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import YAML from "yaml";

const CHECK_COMMANDS = [
  ["npm", ["run", "typecheck"]],
  ["npm", ["run", "test"]],
  ["npm", ["run", "build"]]
];
const LOCKFILES = new Set(["package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock"]);
const GENERATED_PREFIXES = [".cache/", ".vite/", "build/", "coverage/", "dist/", "node_modules/", "prompts/generated/", "test-output/", "tmp/"];
const cliArgs = new Set(process.argv.slice(2));
const dryRun = cliArgs.has("--dry-run");
const mode = getMode();
const startedAt = Date.now();
const maxRepairAttempts = readNonNegativeInteger("AUTO_DEV_MAX_REPAIR_ATTEMPTS", 3);
const stopOnFailure = readBoolean("AUTO_DEV_STOP_ON_FAILURE", true);
const allowWorkflowChanges = readBoolean("AUTO_DEV_ALLOW_WORKFLOW_CHANGES", false);
const allowLockfileChanges = readBoolean("AUTO_DEV_ALLOW_LOCKFILE_CHANGES", false);
const maxTasks = readMaxTasks();
const maxMinutes = readMaxMinutes();
const deadline = Number.isFinite(maxMinutes) ? startedAt + maxMinutes * 60_000 : Infinity;

class AutomationStop extends Error {
  constructor(message, code, options = {}) {
    super(message, { cause: options.cause });
    this.name = "AutomationStop";
    this.code = code;
    this.command = options.command ?? options.cause?.command;
    this.stdout = options.stdout ?? options.cause?.stdout ?? "";
    this.stderr = options.stderr ?? options.cause?.stderr ?? "";
    this.status = options.status ?? options.cause?.status ?? null;
    this.hardStop = options.hardStop ?? true;
  }
}

function getMode() {
  if (cliArgs.has("--all") && cliArgs.has("--until-stop")) {
    throw new Error("Use either --all or --until-stop, not both.");
  }
  if (cliArgs.has("--until-stop")) return "until-stop";
  if (cliArgs.has("--all")) return "all";
  return "single";
}

function readBoolean(name, fallback) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  if (/^(?:1|true|yes)$/iu.test(value)) return true;
  if (/^(?:0|false|no)$/iu.test(value)) return false;
  throw new Error(`${name} must be true or false.`);
}

function readNonNegativeInteger(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer.`);
  return parsed;
}

function readPositiveNumber(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be greater than zero.`);
  return parsed;
}

function readMaxTasks() {
  if (process.env.AUTO_DEV_MAX_TASKS !== undefined) {
    return readNonNegativeInteger("AUTO_DEV_MAX_TASKS", 0);
  }
  if (mode === "until-stop") return 10;
  if (mode === "all") return null;
  return 1;
}

function readMaxMinutes() {
  if (process.env.AUTO_DEV_MAX_MINUTES !== undefined) {
    return readPositiveNumber("AUTO_DEV_MAX_MINUTES", Infinity);
  }
  return mode === "until-stop" ? 120 : Infinity;
}

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

function remainingRuntimeMs() {
  return Number.isFinite(deadline) ? Math.max(1, deadline - Date.now()) : undefined;
}

function run(command, commandArgs = [], options = {}) {
  const commandText = formatCommand(command, commandArgs);
  const printCommand = options.printCommand ?? true;
  const printOutput = options.printOutput ?? true;
  if (printCommand) console.log(`\n> ${commandText}`);

  const result = spawnCommand(command, commandArgs, {
    encoding: "utf8",
    input: options.input,
    maxBuffer: 20 * 1024 * 1024,
    shell: false,
    stdio: options.input === undefined ? "pipe" : ["pipe", "pipe", "pipe"],
    timeout: options.timeout ?? remainingRuntimeMs()
  });

  if (printOutput && result.stdout) process.stdout.write(result.stdout);
  if (printOutput && result.stderr) process.stderr.write(result.stderr);

  if (result.error || result.status !== 0) {
    const error = new Error(`Command failed: ${commandText}`, { cause: result.error });
    error.command = commandText;
    error.stdout = result.stdout ?? "";
    error.stderr = result.stderr ?? result.error?.message ?? "";
    error.status = result.status;
    error.timedOut = result.error?.code === "ETIMEDOUT";
    throw error;
  }

  return result;
}

function runQuiet(command, commandArgs = []) {
  return run(command, commandArgs, { printCommand: false, printOutput: false });
}

function hasCommand(command) {
  try {
    runQuiet(command, ["--version"]);
    return true;
  } catch {
    return false;
  }
}

function readStatus() {
  return runQuiet("git", ["status", "--porcelain"]).stdout.trim();
}

function currentBranch() {
  return runQuiet("git", ["branch", "--show-current"]).stdout.trim() || "unknown";
}

function ensureCleanGit() {
  if (readStatus()) {
    throw new AutomationStop("Git working tree is not clean; refusing unsafe cleanup.", "unclean_worktree");
  }
}

function ensureOnMain() {
  const branch = currentBranch();
  if (branch === "main") return;
  ensureCleanGit();
  run("git", ["checkout", "main"]);
}

function pullMain() {
  ensureOnMain();
  run("git", ["pull", "--ff-only", "origin", "main"]);
}

function ensureGhReady() {
  if (!hasCommand("gh")) {
    throw new AutomationStop("GitHub CLI (gh) is required. Install it, then run `gh auth login`.", "gh_missing");
  }
  try {
    runQuiet("gh", ["auth", "status"]);
  } catch (error) {
    throw new AutomationStop("GitHub CLI is not authenticated. Run `gh auth login` and try again.", "gh_auth", { cause: error });
  }
}

function listBacklogTasks() {
  const backlogDir = path.resolve("tasks", "backlog");
  if (!fs.existsSync(backlogDir)) return [];
  return fs.readdirSync(backlogDir).filter((file) => file.endsWith(".yaml")).sort();
}

function getTaskId(taskFile) {
  return taskFile.split("-")[0];
}

function readTask(taskFile) {
  return YAML.parse(fs.readFileSync(path.resolve("tasks", "backlog", taskFile), "utf8"));
}

function moveTaskFile(fromDirName, toDirName, taskFile) {
  const fromPath = path.resolve("tasks", fromDirName, taskFile);
  const toDir = path.resolve("tasks", toDirName);
  const toPath = path.join(toDir, taskFile);
  fs.mkdirSync(toDir, { recursive: true });
  fs.renameSync(fromPath, toPath);
  return toPath;
}

function createTaskBranch(taskId) {
  const branchName = `codex/task-${taskId}`;
  run("git", ["checkout", "-b", branchName]);
  return branchName;
}

function generatePrompt(taskId) {
  run("node", ["scripts/make-prompt.mjs", taskId]);
  return fs.readFileSync(path.resolve("prompts", "generated", `${taskId}.md`), "utf8");
}

function getCodexArgs() {
  const extraArgs = process.env.CODEX_EXEC_ARGS === undefined
    ? ["--sandbox", "workspace-write"]
    : process.env.CODEX_EXEC_ARGS.trim().split(/\s+/u).filter(Boolean);
  return ["exec", ...extraArgs, "-"];
}

function isQuotaOrTokenFailure(output) {
  return /(?:insufficient[_ ]quota|quota[_ ](?:exceeded|reached)|rate[_ -]?limit|too many requests|context[_ ](?:length|window)|maximum[_ ]context|tokens?[_ ](?:exhausted|limit)|out[_ ]of[_ ]tokens|usage[_ ]limit|credit[_ ]balance|billing[_ ]limit|authentication[_ ]failed|unauthorized|invalid[_ ]api[_ ]key|expired[_ ]api[_ ]key|login[_ ]required)/iu.test(output);
}

function writeFailureLog(error, context = {}) {
  const outDir = path.resolve("prompts", "generated");
  fs.mkdirSync(outDir, { recursive: true });
  const logPath = path.join(outDir, "last-failure.log");
  const content = [
    `TIMESTAMP: ${new Date().toISOString()}`,
    `MODE: ${mode}`,
    `TASK: ${context.taskId ?? "Unknown"}`,
    `PHASE: ${context.phase ?? "Unknown"}`,
    `COMMAND: ${error.command ?? "Unknown"}`,
    `EXIT STATUS: ${error.status ?? "Unknown"}`,
    "",
    "STDOUT:",
    error.stdout ?? "",
    "",
    "STDERR:",
    error.stderr ?? "",
    "",
    "MESSAGE:",
    error.message ?? String(error)
  ].join("\n");
  fs.writeFileSync(logPath, content, "utf8");
  return logPath;
}

function runCodexWithPrompt(prompt, taskId, phase = "implementation") {
  const codexArgs = getCodexArgs();
  try {
    return run("codex", codexArgs, { input: prompt });
  } catch (error) {
    writeFailureLog(error, { taskId, phase });
    const output = `${error.stdout ?? ""}\n${error.stderr ?? ""}\n${error.message ?? ""}`;
    if (error.timedOut) {
      throw new AutomationStop("Maximum automation runtime reached while Codex was running.", "max_runtime", { cause: error });
    }
    if (isQuotaOrTokenFailure(output)) {
      throw new AutomationStop("Codex stopped because of a likely quota, token, context, rate-limit, or authentication error.", "codex_limit_or_auth", { cause: error });
    }
    throw new AutomationStop("Codex execution failed. See prompts/generated/last-failure.log.", "codex_failure", { cause: error });
  }
}

function runChecks() {
  for (const [command, commandArgs] of CHECK_COMMANDS) run(command, commandArgs);
}

function repair(taskId, error) {
  const logPath = writeFailureLog(error, { taskId, phase: "verification" });
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
- Keep the diff small.
- Stop after making the fix.
`;
  runCodexWithPrompt(prompt, taskId, "repair");
}

function verifyWithRepairs(taskId) {
  let lastError = null;
  for (let repairsUsed = 0; repairsUsed <= maxRepairAttempts; repairsUsed += 1) {
    try {
      runChecks();
      return repairsUsed;
    } catch (error) {
      lastError = error;
      if (error.timedOut) {
        throw new AutomationStop("Maximum automation runtime reached during local verification.", "max_runtime", { cause: error });
      }
      if (repairsUsed >= maxRepairAttempts) break;
      console.log(`Verification failed. Repair attempt ${repairsUsed + 1}/${maxRepairAttempts}.`);
      repair(taskId, error);
    }
  }
  writeFailureLog(lastError, { taskId, phase: "verification" });
  throw new AutomationStop("Local verification failed after all repair attempts.", "verification_failure", { cause: lastError });
}

function commitAndPush(taskId, branchName) {
  run("git", ["add", "."]);
  run("git", ["commit", "-m", `Task ${taskId}: automated Codex implementation`]);
  run("git", ["push", "-u", "origin", branchName]);
}

function createPr(taskId, taskFile, branchName, repairsUsed) {
  const title = `Task ${taskId}: automated Codex implementation`;
  const body = [
    "⚠️ This pull request was generated automatically by the Codex automation loop.",
    "",
    `Task file: \`tasks/backlog/${taskFile}\``,
    "",
    "Local verification:",
    "- `npm run typecheck`",
    "- `npm run test`",
    "- `npm run build`",
    "",
    `Repair attempts used: ${repairsUsed}`
  ].join("\n");

  try {
    run("gh", ["pr", "create", "--base", "main", "--head", branchName, "--title", title, "--body", body]);
    const result = runQuiet("gh", ["pr", "view", branchName, "--json", "number,url"]);
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new AutomationStop("Failed to create or inspect the pull request.", "pr_failure", { cause: error });
  }
}

function waitForPrChecks(prNumber) {
  try {
    run("gh", ["pr", "checks", String(prNumber), "--watch", "--interval", "10"]);
  } catch (error) {
    if (error.timedOut) {
      throw new AutomationStop("Maximum automation runtime reached while waiting for GitHub checks.", "max_runtime", { cause: error });
    }
    throw new AutomationStop("GitHub Actions or pull request checks failed.", "ci_failure", { cause: error });
  }
}

function pathMatchesRule(file, rule) {
  const normalizedRule = String(rule).replaceAll("\\", "/").replace(/\/?\*.*$/u, "").replace(/\/$/u, "");
  return file === normalizedRule || file.startsWith(`${normalizedRule}/`);
}

function extractScopePaths(task) {
  const values = Array.isArray(task.scope) ? task.scope : [task.scope ?? ""];
  return values.flatMap((value) => String(value).match(/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.*-]+)+/gu) ?? []);
}

function isWithinScope(file, scopePaths) {
  return scopePaths.some((scopePath) => {
    const normalized = scopePath.replaceAll("\\", "/").replace(/[.,;:]$/u, "");
    const prefix = normalized.replace(/\*.*$/u, "").replace(/\/$/u, "");
    return file === prefix || file.startsWith(`${prefix}/`);
  });
}

function validatePrBeforeMerge(prNumber, branchName, taskFile, task) {
  let pr;
  try {
    const result = runQuiet("gh", ["pr", "view", String(prNumber), "--json", "baseRefName,files,headRefName,url"]);
    pr = JSON.parse(result.stdout);
  } catch (error) {
    throw new AutomationStop("Could not inspect pull request safety metadata.", "safety_check_failure", { cause: error });
  }

  const reasons = [];
  const files = pr.files ?? [];
  const changedPaths = files.map((file) => file.path.replaceAll("\\", "/"));
  const taskPolicy = task.auto_merge ?? {};
  const automationTaskPaths = new Set([`tasks/backlog/${taskFile}`, `tasks/done/${taskFile}`]);
  const scopePaths = extractScopePaths(task);
  const packageChanged = changedPaths.includes("package.json");
  const totalAdditions = files.reduce((sum, file) => sum + (file.additions ?? 0), 0);

  if (pr.headRefName !== branchName) reasons.push(`PR head is ${pr.headRefName}, expected ${branchName}`);
  if (pr.baseRefName !== "main") reasons.push(`PR base is ${pr.baseRefName}, expected main`);
  if (taskPolicy.allowed === false) reasons.push("task policy sets auto_merge.allowed to false");
  if (Number.isInteger(taskPolicy.max_changed_files) && files.length > taskPolicy.max_changed_files) {
    reasons.push(`changed file count ${files.length} exceeds task limit ${taskPolicy.max_changed_files}`);
  }
  if (totalAdditions > 10_000) reasons.push(`total additions ${totalAdditions} exceed the 10,000-line safety limit`);

  for (const file of files) {
    const filePath = file.path.replaceAll("\\", "/");
    const baseName = path.posix.basename(filePath);
    if (filePath.startsWith(".github/workflows/") && !allowWorkflowChanges) reasons.push(`workflow change is not allowed: ${filePath}`);
    if (LOCKFILES.has(baseName) && !packageChanged && !allowLockfileChanges) reasons.push(`lockfile changed without package.json: ${filePath}`);
    if (baseName === ".env" || baseName.startsWith(".env.")) reasons.push(`environment or secret file detected: ${filePath}`);
    if (/\.(?:key|p12|pem|pfx)$/iu.test(baseName) || /(?:credential|secret)/iu.test(baseName)) reasons.push(`possible secret material detected: ${filePath}`);
    if (GENERATED_PREFIXES.some((prefix) => filePath.startsWith(prefix)) || filePath.endsWith(".log")) reasons.push(`generated artifact detected: ${filePath}`);
    if ((file.additions ?? 0) > 5_000) reasons.push(`huge file addition detected: ${filePath}`);
    if ((taskPolicy.forbidden_paths ?? []).some((rule) => pathMatchesRule(filePath, rule))) reasons.push(`task policy forbids: ${filePath}`);
    if (scopePaths.length > 0 && !automationTaskPaths.has(filePath) && !isWithinScope(filePath, scopePaths)) reasons.push(`file is outside the declared task scope: ${filePath}`);
  }

  if (reasons.length > 0) {
    throw new AutomationStop(`PR safety validation rejected auto-merge:\n- ${[...new Set(reasons)].join("\n- ")}`, "suspicious_changes");
  }
  return pr;
}

function mergePr(prNumber) {
  let mergeError = null;
  try {
    run("gh", ["pr", "merge", String(prNumber), "--squash", "--delete-branch"]);
  } catch (error) {
    mergeError = error;
  }

  try {
    const result = runQuiet("gh", ["pr", "view", String(prNumber), "--json", "mergedAt,state,url"]);
    const merged = JSON.parse(result.stdout);
    if (merged.mergedAt) {
      if (mergeError) console.warn(`Warning: PR merged, but branch cleanup reported an error: ${mergeError.message}`);
      return merged;
    }
    throw new Error(`PR state is ${merged.state}; mergedAt is empty.`);
  } catch (error) {
    throw new AutomationStop("Pull request merge failed.", "merge_failure", { cause: mergeError ?? error });
  }
}

function cleanupAfterTask(branchName, taskFile) {
  run("git", ["checkout", "main"]);
  pullMain();
  if (!fs.existsSync(path.resolve("tasks", "done", taskFile))) {
    throw new AutomationStop(`Merged main does not contain tasks/done/${taskFile}.`, "task_state_failure");
  }
  try {
    run("git", ["branch", "-D", branchName]);
  } catch (error) {
    console.warn(`Warning: could not delete local branch ${branchName}: ${error.message}`);
  }
  ensureCleanGit();
}

function moveTaskToFailed(taskFile) {
  for (const source of ["backlog", "done"]) {
    if (fs.existsSync(path.resolve("tasks", source, taskFile))) {
      moveTaskFile(source, "failed", taskFile);
      return true;
    }
  }
  return false;
}

function runOneTask(taskFile) {
  const taskId = getTaskId(taskFile);
  const task = readTask(taskFile);
  let branchName = null;
  let taskMoved = false;
  let merged = false;
  let pr = null;

  try {
    ensureCleanGit();
    ensureOnMain();
    branchName = createTaskBranch(taskId);
    const prompt = generatePrompt(taskId);
    runCodexWithPrompt(prompt, taskId);
    const repairsUsed = verifyWithRepairs(taskId);
    moveTaskFile("backlog", "done", taskFile);
    taskMoved = true;
    commitAndPush(taskId, branchName);
    pr = createPr(taskId, taskFile, branchName, repairsUsed);
    waitForPrChecks(pr.number);
    validatePrBeforeMerge(pr.number, branchName, taskFile, task);
    mergePr(pr.number);
    merged = true;
    cleanupAfterTask(branchName, taskFile);
    return { taskId, prUrl: pr.url, merged: true, repairsUsed };
  } catch (error) {
    const stop = error instanceof AutomationStop
      ? error
      : new AutomationStop(error.message ?? String(error), "unexpected_failure", { cause: error, hardStop: stopOnFailure });
    if (!merged && stop.code !== "codex_limit_or_auth" && stop.code !== "max_runtime") {
      try {
        if (!taskMoved || fs.existsSync(path.resolve("tasks", "done", taskFile))) moveTaskToFailed(taskFile);
      } catch (moveError) {
        stop.message += ` Failed to move task to tasks/failed: ${moveError.message}`;
      }
    }
    writeFailureLog(stop, { taskId, phase: stop.code });
    stop.taskId = taskId;
    stop.branchName = branchName;
    stop.prUrl = pr?.url;
    stop.prMerged = merged;
    throw stop;
  }
}

function inspectGitState() {
  try {
    const branchResult = spawnCommand("git", ["branch", "--show-current"], { encoding: "utf8", shell: false });
    const statusResult = spawnCommand("git", ["status", "--porcelain"], { encoding: "utf8", shell: false });
    return {
      branch: branchResult.status === 0 ? branchResult.stdout.trim() || "unknown" : "unknown",
      clean: statusResult.status === 0 ? statusResult.stdout.trim().length === 0 : false
    };
  } catch {
    return { branch: "unknown", clean: false };
  }
}

function printDryRunPlan() {
  const backlog = listBacklogTasks();
  const dryRunTaskLimit = maxTasks ?? backlog.length;
  const plannedTasks = backlog.slice(0, dryRunTaskLimit);
  console.log(`[dry-run] mode: ${mode}`);
  console.log(`[dry-run] safety limits: max tasks=${maxTasks === null ? "backlog length" : maxTasks}, max minutes=${Number.isFinite(maxMinutes) ? maxMinutes : "none"}`);
  if (plannedTasks.length === 0) console.log("[dry-run] no backlog tasks found; no repository changes would be made");

  for (const taskFile of plannedTasks) {
    const taskId = getTaskId(taskFile);
    const branchName = `codex/task-${taskId}`;
    const task = readTask(taskFile);
    console.log(`\n[dry-run] planned task ${taskId}: ${taskFile}`);
    console.log("  1. Verify the working tree is clean and checkout main");
    console.log("  2. Pull origin/main with --ff-only and verify gh authentication");
    console.log(`  3. Create ${branchName} and generate prompts/generated/${taskId}.md`);
    console.log(`  4. Run ${formatCommand("codex", getCodexArgs())} with the prompt on stdin`);
    console.log("  5. Run typecheck, test, and build; use bounded repairs if needed");
    console.log(`  6. Move ${taskFile} from backlog to done in the task branch`);
    console.log("  7. Commit, push, and create an automated PR into main");
    console.log("  8. Wait for GitHub checks and validate changed-file safety");
    console.log("  9. Squash-merge the PR and request remote branch deletion");
    console.log(" 10. Checkout main, pull origin/main, delete the local task branch, and continue if loop mode is enabled");
    if (task.auto_merge?.allowed === false) console.log("  Safety note: this task sets auto_merge.allowed=false, so a real run would stop before merge");
  }

  if (backlog.length > plannedTasks.length) console.log(`\n[dry-run] would stop at the max task limit with ${backlog.length - plannedTasks.length} task(s) remaining`);
  else console.log("\n[dry-run] would stop when the backlog is empty");
  console.log("[dry-run] no commands or repository mutations were performed");
}

function printLoopSummary(summary) {
  const gitState = inspectGitState();
  const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log("\nAutomation loop summary");
  console.log(`Mode: ${summary.mode}`);
  console.log(`Completed task IDs: ${summary.completedTaskIds.join(", ") || "None"}`);
  console.log(`Failed task ID: ${summary.failedTaskId ?? "None"}`);
  console.log(`Stop reason: ${summary.stopReason}`);
  console.log(`Elapsed time: ${elapsedSeconds}s`);
  console.log(`Current branch: ${gitState.branch}`);
  console.log(`Working tree clean: ${gitState.clean ? "yes" : "no"}`);
  console.log(`PR URLs created: ${summary.prUrls.join(", ") || "None"}`);
  console.log(`PRs merged: ${summary.mergedPrUrls.join(", ") || "None"}`);
}

function runLoop() {
  const summary = {
    mode,
    completedTaskIds: [],
    failedTaskId: null,
    stopReason: "Not started",
    prUrls: [],
    mergedPrUrls: []
  };

  if (dryRun) {
    printDryRunPlan();
    summary.stopReason = "Dry-run plan completed without mutations";
    if (mode !== "single") printLoopSummary(summary);
    return summary;
  }

  let effectiveMaxTasks = maxTasks;

  try {
    while (true) {
      if (Date.now() >= deadline) {
        summary.stopReason = `Max runtime limit reached (${maxMinutes} minutes)`;
        break;
      }

      ensureCleanGit();
      ensureOnMain();
      pullMain();
      const backlog = listBacklogTasks();
      if (backlog.length === 0) {
        summary.stopReason = "No backlog tasks remain";
        break;
      }
      if (effectiveMaxTasks === null) effectiveMaxTasks = backlog.length;
      if (summary.completedTaskIds.length >= effectiveMaxTasks) {
        summary.stopReason = `Max task limit reached (${effectiveMaxTasks})`;
        break;
      }
      ensureGhReady();

      const taskFile = backlog[0];
      console.log(`\nSelected task: ${taskFile}`);
      try {
        const result = runOneTask(taskFile);
        summary.completedTaskIds.push(result.taskId);
        summary.prUrls.push(result.prUrl);
        if (result.merged) summary.mergedPrUrls.push(result.prUrl);
      } catch (error) {
        summary.failedTaskId = error.taskId ?? getTaskId(taskFile);
        summary.stopReason = error.message;
        if (error.prUrl) summary.prUrls.push(error.prUrl);
        if (error.prUrl && error.prMerged) summary.mergedPrUrls.push(error.prUrl);
        if (stopOnFailure || error.hardStop || mode === "all") process.exitCode = 1;
        break;
      }

      if (mode === "single") {
        summary.stopReason = "Single task completed";
        break;
      }
    }
  } catch (error) {
    summary.stopReason = error.message ?? String(error);
    process.exitCode = 1;
  }

  if (mode !== "single" || summary.failedTaskId) printLoopSummary(summary);
  return summary;
}

try {
  runLoop();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
