import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const CHECK_COMMANDS = [
  ["npm", ["run", "typecheck"]],
  ["npm", ["run", "test"]],
  ["npm", ["run", "build"]]
];
const LOCKFILES = new Set(["package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock"]);
const GENERATED_PREFIXES = [".cache/", ".vite/", "build/", "coverage/", "dist/", "node_modules/", "prompts/generated/", "test-output/", "tmp/"];
const DEFAULT_FORBIDDEN_PATHS = [".github/workflows/**", ".env", ".env.*", "dist/**", "build/**"];
const ROADMAP = [
  {
    title: "Define SpriteProject core model",
    summary: "Create the format-agnostic SpriteProject data model shared by importers and exporters.",
    allowedPaths: ["src/core/**", "src/**/*.test.*", "docs/**"],
    requirements: [
      "Represent canvas size, RGBA color mode, frames, layers, cels, frame duration, and cel placement.",
      "Keep the core model independent from browser UI code and file formats.",
      "Add focused construction tests without implementing importers or exporters."
    ],
    completionPaths: ["src/core/SpriteProject.ts"],
    autoMerge: true
  },
  {
    title: "Add SpriteProject validation helpers",
    summary: "Validate SpriteProject dimensions, frame references, layer data, opacity, and cel placement.",
    allowedPaths: ["src/core/validation/**", "src/core/**/*.test.*", "src/**/*.test.*"],
    requirements: [
      "Return clear validation errors for malformed project data.",
      "Reject invalid dimensions, frame indexes, opacity, and cel references.",
      "Add unit tests for valid and invalid projects."
    ],
    completionPaths: ["src/core/validation/index.ts"],
    autoMerge: true
  },
  {
    title: "Implement PNG sequence importer",
    summary: "Convert an ordered browser-local PNG sequence into a single-layer SpriteProject timeline.",
    allowedPaths: ["src/core/importers/pngSequence/**", "src/core/**/*.test.*", "src/**/*.test.*"],
    requirements: [
      "Keep all image processing browser-only and never upload user artwork.",
      "Create one layer because flat PNG files do not contain original layer data.",
      "Validate consistent frame dimensions and preserve input ordering.",
      "Add unit tests using synthetic image data rather than real user files."
    ],
    completionPaths: ["src/core/importers/pngSequence/index.ts"],
    autoMerge: true
  },
  {
    title: "Implement spritesheet grid importer",
    summary: "Slice a browser-local spritesheet grid into ordered SpriteProject frames.",
    allowedPaths: ["src/core/importers/spritesheetGrid/**", "src/core/**/*.test.*", "src/**/*.test.*"],
    requirements: [
      "Support explicit frame width, frame height, rows, columns, and frame order.",
      "Reject grids that exceed or do not fit the source image dimensions.",
      "Create one layer and do not claim original layers can be recovered.",
      "Add focused grid slicing tests with synthetic data."
    ],
    completionPaths: ["src/core/importers/spritesheetGrid/index.ts"],
    autoMerge: true
  },
  {
    title: "Implement spritesheet JSON metadata importer",
    summary: "Build SpriteProject frames from a spritesheet PNG and supported JSON frame metadata.",
    allowedPaths: ["src/core/importers/spritesheetJson/**", "src/core/**/*.test.*", "src/**/*.test.*"],
    requirements: [
      "Parse a small documented JSON metadata subset with explicit validation.",
      "Preserve frame order and duration when the metadata provides them.",
      "Reject malformed or out-of-bounds frame rectangles.",
      "Add parser and frame mapping tests without external services."
    ],
    completionPaths: ["src/core/importers/spritesheetJson/index.ts"],
    autoMerge: true
  },
  {
    title: "Create Aseprite writer skeleton",
    summary: "Define a minimal exporter boundary that consumes SpriteProject and produces binary output.",
    allowedPaths: ["src/core/exporters/aseprite/**", "src/core/**/*.test.*", "docs/**"],
    requirements: [
      "Keep the exporter independent from UI code.",
      "Define explicit binary writer helpers and unsupported-feature errors.",
      "Add tests for deterministic empty or minimal output structure without claiming full format support."
    ],
    completionPaths: ["src/core/exporters/aseprite/index.ts"],
    autoMerge: false
  },
  {
    title: "Write minimal Aseprite binary header",
    summary: "Write and test the minimal .aseprite file and frame headers for RGBA projects.",
    allowedPaths: ["src/core/exporters/aseprite/**", "src/core/**/*.test.*", "docs/**"],
    requirements: [
      "Write correct little-endian header fields for the supported RGBA subset.",
      "Validate dimensions and frame count before writing.",
      "Add byte-level tests against documented constants and offsets."
    ],
    completionPaths: ["src/core/exporters/aseprite/header.ts"],
    autoMerge: false
  },
  {
    title: "Write Aseprite layers and cels",
    summary: "Encode normal layer and cel chunks from SpriteProject into the supported Aseprite subset.",
    allowedPaths: ["src/core/exporters/aseprite/**", "src/core/**/*.test.*", "docs/**"],
    requirements: [
      "Support normal visible layers, opacity, names, cel coordinates, and frame duration.",
      "Reject unsupported modes explicitly rather than silently accepting them.",
      "Add byte-level tests for multiple frames, layers, and cels."
    ],
    completionPaths: ["src/core/exporters/aseprite/cels.ts"],
    autoMerge: false
  },
  {
    title: "Add export download UI",
    summary: "Add a browser-only action that exports the current SpriteProject and downloads an .aseprite file.",
    allowedPaths: ["src/app/**", "src/**/*.test.*", "docs/**"],
    requirements: [
      "Use Blob and browser download APIs without uploading project data.",
      "Disable export when no valid project is loaded.",
      "Show clear export errors and add focused UI tests."
    ],
    completionPaths: ["src/app/components/ExportDownload.ts"],
    autoMerge: true
  },
  {
    title: "Add browser file import UI",
    summary: "Add browser-local file selection for supported sprite source files.",
    allowedPaths: ["src/app/**", "src/**/*.test.*", "docs/**"],
    requirements: [
      "Read files only through browser APIs and never upload user artwork.",
      "Expose supported file types and reject unsupported inputs clearly.",
      "Add UI tests using synthetic File objects."
    ],
    completionPaths: ["src/app/components/FileImport.ts"],
    autoMerge: true
  },
  {
    title: "Add import error and validation UI",
    summary: "Present importer and SpriteProject validation failures in a clear browser UI.",
    allowedPaths: ["src/app/**", "src/**/*.test.*"],
    requirements: [
      "Display actionable errors without exposing file contents.",
      "Keep validation messages format-specific where useful.",
      "Add UI tests for common invalid inputs."
    ],
    completionPaths: ["src/app/components/ImportErrors.ts"],
    autoMerge: true
  },
  {
    title: "Expand importer unit tests",
    summary: "Add edge-case unit coverage across the supported importers.",
    allowedPaths: ["src/core/importers/**/*.test.*", "src/**/*.test.*", "tests/**"],
    requirements: [
      "Cover invalid dimensions, ordering, bounds, and duration metadata.",
      "Use synthetic fixtures and avoid real user artwork.",
      "Do not change importer behavior unless a test exposes a verified defect."
    ],
    autoMerge: true
  },
  {
    title: "Expand Aseprite exporter unit tests",
    summary: "Add byte-level regression coverage for the supported Aseprite exporter subset.",
    allowedPaths: ["src/core/exporters/aseprite/**/*.test.*", "src/**/*.test.*", "tests/**"],
    requirements: [
      "Cover headers, frames, layers, cels, names, opacity, and duration.",
      "Assert deterministic bytes and explicit rejection of unsupported data.",
      "Do not broaden the exporter feature set in this task."
    ],
    autoMerge: true
  },
  {
    title: "Add conversion integration smoke tests",
    summary: "Add small end-to-end tests from synthetic importer input through Aseprite export.",
    allowedPaths: ["tests/**", "src/**/*.test.*", "docs/**"],
    requirements: [
      "Cover one small happy path for each supported importer.",
      "Keep fixtures synthetic and tiny.",
      "Assert output structure without claiming unsupported lossless conversion."
    ],
    autoMerge: true
  },
  {
    title: "Document supported conversion behavior",
    summary: "Document supported inputs, browser-only processing, and the limits of flat image formats.",
    allowedPaths: ["README.md", "docs/**"],
    requirements: [
      "Describe frame conversion and timeline rebuilding accurately.",
      "State that flat PNG sources cannot recover original layers.",
      "Document supported and unsupported Aseprite features."
    ],
    completionPaths: ["README.md"],
    autoMerge: true
  },
  {
    title: "Add synthetic sample fixtures",
    summary: "Add tiny synthetic sprite fixtures for demos and automated tests.",
    allowedPaths: ["tests/fixtures/**", "docs/**"],
    requirements: [
      "Use newly generated synthetic artwork only.",
      "Keep files small and document expected frame geometry.",
      "Do not include real user sprite files or copyrighted assets."
    ],
    autoMerge: true
  },
  {
    title: "Add drag-and-drop file import",
    summary: "Add drag-and-drop as an alternative browser-local file import interaction.",
    allowedPaths: ["src/app/**", "src/**/*.test.*", "docs/**"],
    requirements: [
      "Reuse the existing browser-local import pipeline.",
      "Provide keyboard-accessible fallback controls.",
      "Add tests for accepted, rejected, and mixed drops."
    ],
    completionPaths: ["src/app/components/DropImport.ts"],
    autoMerge: true
  },
  {
    title: "Add preview timeline UI",
    summary: "Show imported SpriteProject frames in a simple browser preview timeline.",
    allowedPaths: ["src/app/**", "src/**/*.test.*"],
    requirements: [
      "Render frame order and active-frame state without mutating project data.",
      "Keep artwork local to the browser.",
      "Add tests for navigation and empty state."
    ],
    completionPaths: ["src/app/components/TimelinePreview.ts"],
    autoMerge: true
  },
  {
    title: "Add frame duration editing",
    summary: "Allow editing SpriteProject frame durations with validation in the browser UI.",
    allowedPaths: ["src/app/**", "src/core/**", "src/**/*.test.*"],
    requirements: [
      "Require finite positive frame durations within documented bounds.",
      "Update only the selected frame and preserve timeline ordering.",
      "Add model and UI tests."
    ],
    completionPaths: ["src/app/components/FrameDurationEditor.ts"],
    autoMerge: true
  },
  {
    title: "Add basic layer naming",
    summary: "Allow users to rename SpriteProject layers before export.",
    allowedPaths: ["src/app/**", "src/core/**", "src/**/*.test.*"],
    requirements: [
      "Validate non-empty layer names and preserve layer ordering.",
      "Do not imply that source layers were recovered from flat images.",
      "Add model and UI tests for rename behavior."
    ],
    completionPaths: ["src/app/components/LayerNameEditor.ts"],
    autoMerge: true
  }
];
const cliArgs = new Set(process.argv.slice(2));
const dryRun = cliArgs.has("--dry-run");
const mode = getMode();
const startedAt = Date.now();
const maxRepairAttempts = readNonNegativeInteger("AUTO_DEV_MAX_REPAIR_ATTEMPTS", 3);
const stopOnFailure = readBoolean("AUTO_DEV_STOP_ON_FAILURE", true);
const allowWorkflowChanges = readBoolean("AUTO_DEV_ALLOW_WORKFLOW_CHANGES", false);
const allowLockfileChanges = readBoolean("AUTO_DEV_ALLOW_LOCKFILE_CHANGES", false);
const allowNoPrChecks = readBoolean("AUTO_DEV_ALLOW_NO_PR_CHECKS", false);
const generateTasksWhenEmpty = readBoolean("AUTO_DEV_GENERATE_TASKS_WHEN_EMPTY", false);
const generatedTaskCount = readNonNegativeInteger("AUTO_DEV_GENERATED_TASK_COUNT", 5);
const maxGenerationRounds = readNonNegativeInteger("AUTO_DEV_MAX_GENERATION_ROUNDS", 1);
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
  const selectedModes = ["--all", "--until-stop", "--generate-tasks"].filter((flag) => cliArgs.has(flag));
  if (selectedModes.length > 1) throw new Error(`Use only one automation mode, not ${selectedModes.join(", ")}.`);
  if (cliArgs.has("--generate-tasks")) return "generate-tasks";
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
  if (process.platform === "win32" && (command === "codex" || command.endsWith(".cmd"))) {
    return spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", formatCommand(command, commandArgs)], options);
  }
  return spawnSync(command, commandArgs, options);
}

function npmCommand(platform = process.platform) {
  return platform === "win32" ? "npm.cmd" : "npm";
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

function taskStateRecoveryCommands(status) {
  const commands = [];
  for (const line of status.split(/\r?\n/u).filter(Boolean)) {
    const state = line.slice(0, 2);
    const rawPath = line.slice(3).split(" -> ").at(-1);
    if (!rawPath || !/^tasks\/(?:backlog|done|failed)\//u.test(rawPath)) continue;
    if (state === "??") commands.push(`Remove-Item ${quoteArg(rawPath)} -Force`);
    else commands.push(`git restore ${quoteArg(rawPath)}`);
  }
  return [...new Set(commands)];
}

function guardDirtyTaskStateOnTaskBranch(branch = currentBranch(), status = readStatus()) {
  if (!branch.startsWith("codex/task-") || !/^.. tasks\/(?:backlog|done|failed)\//mu.test(status)) return;
  const recovery = taskStateRecoveryCommands(status);
  throw new AutomationStop(
    [
      "Task state is dirty on a task branch. Clean it before continuing:",
      ...(recovery.length > 0 ? recovery : ["git status --short"])
    ].join("\n"),
    "dirty_task_state"
  );
}

function ensureCleanGit() {
  const status = readStatus();
  guardDirtyTaskStateOnTaskBranch(currentBranch(), status);
  if (status) {
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

function walkFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(entryPath) : [path.relative(process.cwd(), entryPath).replaceAll("\\", "/")];
  });
}

function collectProjectPlanningContext() {
  const docPaths = ["AGENTS.md", "README.md", "docs/architecture.md", "docs/product-spec.md", "docs/roadmap.md"];
  const docs = Object.fromEntries(docPaths.filter((file) => fs.existsSync(file)).map((file) => [file, fs.readFileSync(file, "utf8")]));
  const sourceFiles = walkFiles(path.resolve("src"));
  const testFiles = [
    ...walkFiles(path.resolve("test")),
    ...walkFiles(path.resolve("tests")),
    ...walkFiles(path.resolve("scripts")).filter((file) => /\.(?:test|spec)\./u.test(file)),
    ...sourceFiles.filter((file) => /\.(?:test|spec)\./u.test(file))
  ];
  const tasks = [];

  for (const state of ["backlog", "done", "failed"]) {
    const directory = path.resolve("tasks", state);
    if (!fs.existsSync(directory)) continue;
    for (const file of fs.readdirSync(directory).filter((name) => name.endsWith(".yaml")).sort()) {
      const filePath = path.join(directory, file);
      try {
        tasks.push({ state, file, data: YAML.parse(fs.readFileSync(filePath, "utf8")) });
      } catch (error) {
        throw new AutomationStop(`Could not parse existing task ${path.relative(process.cwd(), filePath)}: ${error.message}`, "task_parse_failure");
      }
    }
  }

  return { docs, sourceFiles, testFiles: [...new Set(testFiles)].sort(), tasks };
}

function listExistingTaskIds(context = collectProjectPlanningContext()) {
  return context.tasks.map((task) => String(task.data?.id ?? getTaskId(task.file))).filter(Boolean);
}

function getNextTaskId(existingIds, offset = 0) {
  const numericIds = existingIds.map((id) => Number.parseInt(String(id), 10)).filter(Number.isFinite);
  const next = (numericIds.length > 0 ? Math.max(...numericIds) : 0) + 1 + offset;
  return String(next).padStart(Math.max(3, String(next).length), "0");
}

function normalizeTitle(title) {
  return String(title).toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/gu, " ").trim();
}

function slugify(title) {
  return normalizeTitle(title).replaceAll(" ", "-").slice(0, 70).replace(/-$/u, "");
}

function buildGeneratedTask(roadmapItem, id) {
  return {
    id,
    title: roadmapItem.title,
    status: "backlog",
    priority: "high",
    goal: roadmapItem.summary,
    context: "This task was generated deterministically from the repository roadmap, architecture, current source tree, and existing task history.",
    scope: {
      summary: roadmapItem.summary,
      allowed_paths: roadmapItem.allowedPaths,
      forbidden_paths: DEFAULT_FORBIDDEN_PATHS
    },
    non_goals: [
      "Do not implement unrelated roadmap features.",
      "Do not upload user artwork or use external processing services.",
      "Do not change dependencies, lockfiles, or GitHub workflows."
    ],
    requirements: roadmapItem.requirements,
    acceptance_criteria: [
      roadmapItem.summary,
      "Focused tests cover the behavior introduced by this task.",
      "Typecheck, tests, and build pass."
    ],
    verification: CHECK_COMMANDS.map(([command, args]) => `${command} ${args.join(" ")}`),
    auto_merge: {
      allowed: roadmapItem.autoMerge,
      max_changed_files: 8,
      forbidden_paths: DEFAULT_FORBIDDEN_PATHS
    }
  };
}

function selectRoadmapTasks(context, count = generatedTaskCount) {
  const existingTitles = new Set(context.tasks.map((task) => normalizeTitle(task.data?.title ?? "")));
  const existingPaths = new Set(context.sourceFiles);
  const available = ROADMAP.filter((item) => {
    if (existingTitles.has(normalizeTitle(item.title))) return false;
    return !(item.completionPaths ?? []).some((file) => existingPaths.has(file));
  }).slice(0, count);
  const existingIds = listExistingTaskIds(context);
  return available.map((item, index) => buildGeneratedTask(item, getNextTaskId(existingIds, index)));
}

function buildTaskYaml(task) {
  return YAML.stringify(task, { lineWidth: 0 });
}

function generatedTaskFileName(task) {
  return `${task.id}-${slugify(task.title)}.yaml`;
}

function writeGeneratedTaskFiles(tasks, options = {}) {
  const backlogDir = path.resolve("tasks", "backlog");
  if (!options.dryRun) fs.mkdirSync(backlogDir, { recursive: true });
  return tasks.map((task) => {
    const fileName = generatedTaskFileName(task);
    const filePath = path.join(backlogDir, fileName);
    if (!options.dryRun) {
      if (fs.existsSync(filePath)) throw new AutomationStop(`Refusing to overwrite existing task ${fileName}.`, "task_generation_collision");
      fs.writeFileSync(filePath, buildTaskYaml(task), "utf8");
    }
    return { task, fileName, filePath };
  });
}

function generateBacklogTasks(options = {}) {
  const context = options.context ?? collectProjectPlanningContext();
  const tasks = selectRoadmapTasks(context, options.count ?? generatedTaskCount);
  return writeGeneratedTaskFiles(tasks, { dryRun: options.dryRun ?? false });
}

function printGeneratedTaskSummary(generated, prefix = "Generated") {
  if (generated.length === 0) {
    console.log(`${prefix} tasks: none`);
    return;
  }
  console.log(`${prefix} tasks:`);
  for (const { task, fileName } of generated) console.log(`- ${task.id}: ${task.title} (${fileName})`);
}

function commitAndPushGeneratedTasks(generated) {
  const relativePaths = generated.map(({ filePath }) => path.relative(process.cwd(), filePath));
  run("git", ["add", "--", ...relativePaths]);
  run("git", ["commit", "-m", `chore(tasks): generate ${generated.length} backlog tasks`]);
  run("git", ["push", "origin", "main"]);
}

function runGenerateTasksMode() {
  if (dryRun) {
    const generated = generateBacklogTasks({ dryRun: true });
    printGeneratedTaskSummary(generated, "[dry-run] would generate");
    console.log("[dry-run] no task files, commits, pushes, or pulls were created");
    return generated;
  }

  ensureCleanGit();
  ensureOnMain();
  pullMain();
  ensureCleanGit();
  const generated = generateBacklogTasks();
  if (generated.length > 0) commitAndPushGeneratedTasks(generated);
  printGeneratedTaskSummary(generated);
  return generated;
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

function isRecoverableCodexSandboxVerificationFailure(output) {
  return /(?:Cannot read directory ["']\.\.\/\.\.["']: Access is denied|Could not resolve|vite\.config\.ts|failed to load config|UnauthorizedAccessException|npm\.ps1|Test-Path\s*:\s*Access is denied)/iu.test(output);
}

function changedPaths() {
  return readStatus().split(/\r?\n/u).filter(Boolean).map((line) => line.slice(3).split(" -> ").at(-1)).filter(Boolean);
}

function hasTaskRelevantChanges(paths, task = null) {
  const allowedPaths = extractScopePaths(task ?? {});
  return paths.some((file) => {
    const normalized = file.replaceAll("\\", "/");
    if (/^(?:tasks|prompts\/generated|dist|build|coverage|node_modules)\//u.test(normalized)) return false;
    if (/^(?:src|test|tests|docs)\//u.test(normalized) || /(?:^|\/)README(?:\.[^/]+)?$/iu.test(normalized) || /\.(?:test|spec)\.[^/]+$/u.test(normalized)) return true;
    return allowedPaths.length > 0 && isWithinScope(normalized, allowedPaths);
  });
}

function shouldContinueAfterCodexFailure(output, paths, task = null) {
  return isRecoverableCodexSandboxVerificationFailure(output) && hasTaskRelevantChanges(paths, task);
}

function readFailureGitState() {
  try {
    return { branch: currentBranch(), status: readStatus() };
  } catch {
    return { branch: "unknown", status: "Unable to read git status" };
  }
}

function buildFailureLogContent(error, context = {}, gitState = readFailureGitState()) {
  const recoveryCommands = (context.suggestedRecovery
    ?? error.suggestedRecovery
    ?? taskStateRecoveryCommands(gitState.status).join("\n"))
    || "Inspect `git status --short` and preserve task implementation changes before cleanup.";
  return [
    `TIMESTAMP: ${new Date().toISOString()}`,
    `MODE: ${mode}`,
    `TASK: ${context.taskId ?? "Unknown"}`,
    `TASK FILE: ${context.taskFile ?? "Unknown"}`,
    `BRANCH: ${context.branch ?? gitState.branch}`,
    `PHASE: ${context.phase ?? "Unknown"}`,
    `COMMAND: ${error.command ?? "Unknown"}`,
    `EXIT STATUS: ${error.status ?? "Unknown"}`,
    `ENVIRONMENT ONLY: ${context.environmentOnly ?? error.environmentOnly ?? false}`,
    `CHANGES PRODUCED: ${context.changesProduced ?? "Unknown"}`,
    `PR URL: ${context.prUrl ?? "None"}`,
    "",
    "STDOUT:",
    error.stdout ?? "",
    "",
    "STDERR:",
    error.stderr ?? "",
    "",
    "MESSAGE:",
    error.message ?? String(error),
    "",
    "GIT STATUS:",
    gitState.status || "Clean",
    "",
    "SUGGESTED RECOVERY:",
    recoveryCommands
  ].join("\n");
}

function writeFailureLog(error, context = {}) {
  const outDir = path.resolve("prompts", "generated");
  fs.mkdirSync(outDir, { recursive: true });
  const logPath = path.join(outDir, "last-failure.log");
  const content = buildFailureLogContent(error, context);
  fs.writeFileSync(logPath, content, "utf8");
  return logPath;
}

function runCodexWithPrompt(prompt, taskId, phase = "implementation", task = null) {
  const codexArgs = getCodexArgs();
  try {
    return run("codex", codexArgs, { input: prompt });
  } catch (error) {
    const output = `${error.stdout ?? ""}\n${error.stderr ?? ""}\n${error.message ?? ""}`;
    const paths = changedPaths();
    const changesProduced = hasTaskRelevantChanges(paths, task);
    if (error.timedOut) {
      writeFailureLog(error, { taskId, phase, changesProduced });
      throw new AutomationStop("Maximum automation runtime reached while Codex was running.", "max_runtime", { cause: error });
    }
    if (isQuotaOrTokenFailure(output)) {
      writeFailureLog(error, { taskId, phase, changesProduced });
      throw new AutomationStop("Codex stopped because of a likely quota, token, context, rate-limit, or authentication error.", "codex_limit_or_auth", { cause: error });
    }
    if (shouldContinueAfterCodexFailure(output, paths, task)) {
      error.environmentOnly = true;
      writeFailureLog(error, {
        taskId,
        phase,
        environmentOnly: true,
        changesProduced,
        suggestedRecovery: "No recovery is needed yet. The outer automation is continuing with local typecheck, test, and build."
      });
      console.warn("Codex hit a managed Windows sandbox verification limitation after producing task-relevant changes. Continuing to outer local verification.");
      return { status: error.status, stdout: error.stdout, stderr: error.stderr, recoverableEnvironmentFailure: true };
    }
    writeFailureLog(error, { taskId, phase, environmentOnly: false, changesProduced });
    throw new AutomationStop("Codex execution failed. See prompts/generated/last-failure.log.", "codex_failure", { cause: error });
  }
}

function runChecks() {
  for (const [, commandArgs] of CHECK_COMMANDS) run(npmCommand(), commandArgs);
}

function repair(taskId, task, error) {
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
  runCodexWithPrompt(prompt, taskId, "repair", task);
}

function verifyWithRepairs(taskId, task) {
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
      repair(taskId, task, error);
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

function isNoPrChecksReported(output) {
  return /no checks reported/iu.test(output);
}

function prChecksFailurePolicy(output, allowNoChecks = allowNoPrChecks) {
  if (!isNoPrChecksReported(output)) return "fail";
  return allowNoChecks ? "continue" : "fail-no-checks";
}

function canContinueWithoutPrChecks(output, allowNoChecks, localVerificationPassed) {
  return localVerificationPassed && prChecksFailurePolicy(output, allowNoChecks) === "continue";
}

function waitForPrChecks(prNumber, localVerificationPassed = true) {
  try {
    run("gh", ["pr", "checks", String(prNumber), "--watch", "--interval", "10"]);
  } catch (error) {
    const output = `${error.stdout ?? ""}\n${error.stderr ?? ""}\n${error.message ?? ""}`;
    const policy = prChecksFailurePolicy(output);
    if (policy === "continue") {
      if (!canContinueWithoutPrChecks(output, allowNoPrChecks, localVerificationPassed)) {
        throw new AutomationStop("Cannot bypass missing PR checks because mandatory local verification has not passed.", "verification_required", { cause: error });
      }
      console.warn("Warning: GitHub reported no PR checks. AUTO_DEV_ALLOW_NO_PR_CHECKS=true, so automation will continue to mandatory safety validation.");
      return { noChecks: true };
    }
    if (policy === "fail-no-checks") {
      throw new AutomationStop("No GitHub PR checks were reported. Configure CI or set AUTO_DEV_ALLOW_NO_PR_CHECKS=true explicitly.", "no_pr_checks", { cause: error });
    }
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
  if (task.scope && !Array.isArray(task.scope) && typeof task.scope === "object") {
    return task.scope.allowed_paths ?? [];
  }
  const values = Array.isArray(task.scope) ? task.scope : [task.scope ?? ""];
  return values.flatMap((value) => String(value).match(/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.*-]+)+/gu) ?? []);
}

function isWithinScope(file, scopePaths) {
  return scopePaths.some((scopePath) => {
    const normalized = scopePath.replaceAll("\\", "/").replace(/[.,;:]$/u, "");
    if (!normalized.includes("*")) {
      const prefix = normalized.replace(/\/$/u, "");
      return file === prefix || file.startsWith(`${prefix}/`);
    }
    const segments = normalized.split("/");
    let pattern = "^";
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      if (segment === "**") {
        pattern += index === segments.length - 1 ? ".*" : "(?:[^/]+/)*";
        continue;
      }
      pattern += segment.replace(/[.+?^${}()|[\]\\]/gu, "\\$&").replaceAll("*", "[^/]*");
      if (index < segments.length - 1) pattern += "/";
    }
    return new RegExp(`${pattern}$`, "u").test(file);
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
  const forbiddenPaths = [...(taskPolicy.forbidden_paths ?? []), ...(task.scope?.forbidden_paths ?? [])];
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
    if (forbiddenPaths.some((rule) => pathMatchesRule(filePath, rule))) reasons.push(`task policy forbids: ${filePath}`);
    if (scopePaths.length > 0 && !isWithinScope(filePath, scopePaths)) reasons.push(`file is outside the declared task scope: ${filePath}`);
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

function canMoveTaskToDone(merged, branch) {
  return merged && branch === "main";
}

function moveTaskToDoneAfterMerge(taskId, taskFile, merged) {
  const branch = currentBranch();
  if (!canMoveTaskToDone(merged, branch)) {
    throw new AutomationStop("Refusing to move task to done before merge or outside main.", "task_state_failure");
  }
  const backlogPath = path.resolve("tasks", "backlog", taskFile);
  if (!fs.existsSync(backlogPath)) {
    throw new AutomationStop(`Expected backlog task is missing after merge: tasks/backlog/${taskFile}.`, "task_state_failure");
  }
  moveTaskFile("backlog", "done", taskFile);
  let committed = false;
  try {
    run("git", ["add", "--", path.join("tasks", "backlog", taskFile), path.join("tasks", "done", taskFile)]);
    run("git", ["commit", "-m", `Task ${taskId}: mark automation task done`]);
    committed = true;
    run("git", ["push", "origin", "main"]);
  } catch (error) {
    const suggestedRecovery = committed
      ? "The implementation is merged and the task-state commit is local on main. Run: git push origin main"
      : "The implementation is merged, but the task-state commit did not finish. Inspect git status, then commit only the backlog-to-done move on main.";
    const stop = new AutomationStop("Implementation merged, but updating task state on main failed.", "task_state_failure", { cause: error });
    stop.suggestedRecovery = suggestedRecovery;
    throw stop;
  }
}

function cleanupAfterTask(taskId, branchName, taskFile, merged) {
  run("git", ["checkout", "main"]);
  pullMain();
  moveTaskToDoneAfterMerge(taskId, taskFile, merged);
  if (localBranchExists(branchName)) {
    try {
      run("git", ["branch", "-D", branchName]);
    } catch (error) {
      console.warn(`Warning: could not delete local branch ${branchName}: ${error.message}`);
    }
  }
  ensureCleanGit();
}

function failureTaskStatePolicy(branchPushed, prCreated) {
  if (branchPushed || prCreated) {
    return "Implementation was already pushed or a PR may exist. Task state was left unchanged. Recover the PR/branch first; do not move the task locally on the task branch.";
  }
  return "Task state was left unchanged in backlog. Preserve or inspect implementation changes on the task branch before cleanup.";
}

function localBranchExists(branchName) {
  try {
    runQuiet("git", ["show-ref", "--verify", `refs/heads/${branchName}`]);
    return true;
  } catch {
    return false;
  }
}

function remoteBranchExists(branchName) {
  try {
    runQuiet("git", ["ls-remote", "--exit-code", "--heads", "origin", branchName]);
    return true;
  } catch {
    return false;
  }
}

function findExistingPr(branchName) {
  try {
    const result = runQuiet("gh", ["pr", "list", "--head", branchName, "--state", "all", "--limit", "1", "--json", "baseRefName,headRefName,mergedAt,number,state,url"]);
    return JSON.parse(result.stdout)[0] ?? null;
  } catch (error) {
    throw new AutomationStop(`Could not inspect existing PRs for ${branchName}.`, "pr_recovery_failure", { cause: error });
  }
}

function existingTaskRecoveryAction(pr, hasLocalBranch, hasRemoteBranch) {
  if (pr?.mergedAt || pr?.state === "MERGED") return "complete-merged";
  if (pr?.state === "OPEN") return hasLocalBranch || hasRemoteBranch ? "resume-pr" : "stale-pr";
  if (pr) return "stale-pr";
  if (hasLocalBranch || hasRemoteBranch) return "resume-branch";
  return "start";
}

function checkoutExistingTaskBranch(branchName, hasLocalBranch, hasRemoteBranch) {
  ensureCleanGit();
  if (currentBranch() === branchName) return;
  if (hasLocalBranch) {
    run("git", ["checkout", branchName]);
    return;
  }
  if (hasRemoteBranch) {
    run("git", ["fetch", "origin", branchName]);
    run("git", ["checkout", "-b", branchName, "--track", `origin/${branchName}`]);
    return;
  }
  throw new AutomationStop(`PR exists but branch ${branchName} is missing locally and remotely.`, "stale_pr", {
    command: `gh pr view --web ${branchName}`
  });
}

function verifyRecoveredBranch(taskId, checkRunner = runChecks, failureLogger = writeFailureLog) {
  try {
    checkRunner();
  } catch (error) {
    failureLogger(error, { taskId, phase: "existing-branch-verification", environmentOnly: false });
    throw new AutomationStop("Existing task branch failed mandatory local verification; it was not merged.", "verification_failure", { cause: error });
  }
}

function recoverExistingTask(taskId, taskFile, task, branchName) {
  const pr = findExistingPr(branchName);
  const hasLocalBranch = localBranchExists(branchName);
  const hasRemoteBranch = remoteBranchExists(branchName);
  const action = existingTaskRecoveryAction(pr, hasLocalBranch, hasRemoteBranch);
  if (action === "start") return null;
  let recoveredMerged = action === "complete-merged";

  try {
    console.log(`Existing task recovery: ${action} for ${branchName}${pr?.url ? ` (${pr.url})` : ""}`);
    if (action === "complete-merged") {
      cleanupAfterTask(taskId, branchName, taskFile, true);
      return { taskId, prUrl: pr.url, merged: true, repairsUsed: 0, recovered: true };
    }
    if (action === "stale-pr") {
      throw new AutomationStop(
        `Existing PR ${pr?.url ?? ""} is closed/stale or its branch is missing. Inspect it before retrying.`,
        "stale_pr",
        { command: pr?.url ? `gh pr view ${pr.number} --web` : `git branch -a --list "*${branchName}"` }
      );
    }

    checkoutExistingTaskBranch(branchName, hasLocalBranch, hasRemoteBranch);
    verifyRecoveredBranch(taskId);
    let recoveredPr = pr;
    if (action === "resume-branch") {
      const ahead = Number(runQuiet("git", ["rev-list", "--count", `main..${branchName}`]).stdout.trim());
      if (!ahead) throw new AutomationStop(`Existing branch ${branchName} has no commits ahead of main.`, "stale_branch");
      if (!hasRemoteBranch) run("git", ["push", "-u", "origin", branchName]);
      recoveredPr = createPr(taskId, taskFile, branchName, 0);
    }
    waitForPrChecks(recoveredPr.number);
    validatePrBeforeMerge(recoveredPr.number, branchName, taskFile, task);
    mergePr(recoveredPr.number);
    recoveredMerged = true;
    cleanupAfterTask(taskId, branchName, taskFile, true);
    return { taskId, prUrl: recoveredPr.url, merged: true, repairsUsed: 0, recovered: true };
  } catch (error) {
    error.prUrl = error.prUrl ?? pr?.url;
    error.prMerged = error.prMerged ?? recoveredMerged;
    throw error;
  }
}

function runOneTask(taskFile) {
  const taskId = getTaskId(taskFile);
  const task = readTask(taskFile);
  let branchName = null;
  let branchPushed = false;
  let merged = false;
  let pr = null;

  try {
    ensureCleanGit();
    ensureOnMain();
    const recovered = recoverExistingTask(taskId, taskFile, task, `codex/task-${taskId}`);
    if (recovered) return recovered;
    branchName = createTaskBranch(taskId);
    const prompt = generatePrompt(taskId);
    runCodexWithPrompt(prompt, taskId, "implementation", task);
    const repairsUsed = verifyWithRepairs(taskId, task);
    commitAndPush(taskId, branchName);
    branchPushed = true;
    pr = createPr(taskId, taskFile, branchName, repairsUsed);
    waitForPrChecks(pr.number);
    validatePrBeforeMerge(pr.number, branchName, taskFile, task);
    mergePr(pr.number);
    merged = true;
    cleanupAfterTask(taskId, branchName, taskFile, merged);
    return { taskId, prUrl: pr.url, merged: true, repairsUsed };
  } catch (error) {
    const stop = error instanceof AutomationStop
      ? error
      : new AutomationStop(error.message ?? String(error), "unexpected_failure", { cause: error, hardStop: stopOnFailure });
    stop.prUrl = stop.prUrl ?? error.prUrl ?? pr?.url;
    const recoveryMessage = stop.suggestedRecovery ?? failureTaskStatePolicy(branchPushed, Boolean(pr || stop.prUrl));
    stop.message += `\n${recoveryMessage}`;
    stop.suggestedRecovery = recoveryMessage;
    writeFailureLog(stop, {
      taskId,
      taskFile,
      phase: stop.code,
      environmentOnly: stop.environmentOnly ?? false,
      changesProduced: hasTaskRelevantChanges(changedPaths(), task),
      prUrl: stop.prUrl,
      suggestedRecovery: recoveryMessage
    });
    stop.taskId = taskId;
    stop.branchName = branchName;
    stop.prMerged = stop.prMerged ?? error.prMerged ?? merged;
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

function printDryRunTaskPlan(taskFile, task) {
    const taskId = getTaskId(taskFile);
    const branchName = `codex/task-${taskId}`;
    console.log(`\n[dry-run] planned task ${taskId}: ${taskFile}`);
    console.log("  1. Verify the working tree is clean and checkout main");
    console.log("  2. Pull origin/main with --ff-only and verify gh authentication");
    console.log(`  3. Create ${branchName} and generate prompts/generated/${taskId}.md`);
    console.log(`  4. Run ${formatCommand("codex", getCodexArgs())} with the prompt on stdin`);
    console.log("  5. Run typecheck, test, and build; use bounded repairs if needed");
    console.log("  6. Commit implementation changes, push, and create an automated PR into main");
    console.log("  7. Keep task state unchanged while the implementation PR is open");
    console.log("  8. Wait for GitHub checks and validate changed-file safety");
    console.log("  9. Squash-merge the PR and request remote branch deletion");
    console.log(` 10. Checkout main, pull the merge, move ${taskFile} from backlog to done on main, push that state commit, and continue`);
    if (task.auto_merge?.allowed === false) console.log("  Safety note: this task sets auto_merge.allowed=false, so a real run would stop before merge");
}

function printDryRunPlan() {
  const backlog = listBacklogTasks();
  const dryRunTaskLimit = maxTasks ?? backlog.length;
  let plannedTasks = backlog.slice(0, dryRunTaskLimit).map((fileName) => ({ fileName, task: readTask(fileName) }));
  console.log(`[dry-run] mode: ${mode}`);
  console.log(`[dry-run] safety limits: max tasks=${maxTasks === null ? "backlog length" : maxTasks}, max minutes=${Number.isFinite(maxMinutes) ? maxMinutes : "none"}, generation rounds=${maxGenerationRounds}`);

  if (plannedTasks.length === 0 && mode === "until-stop" && generateTasksWhenEmpty) {
    if (maxGenerationRounds === 0) {
      console.log("[dry-run] backlog is empty and task generation limit is already reached");
    } else {
      const generated = generateBacklogTasks({ dryRun: true, count: Math.min(generatedTaskCount, dryRunTaskLimit) });
      printGeneratedTaskSummary(generated, "[dry-run] would generate");
      plannedTasks = generated.map(({ task, fileName }) => ({ task, fileName }));
    }
  }

  if (plannedTasks.length === 0) console.log("[dry-run] no backlog tasks remain and no tasks would be generated");
  for (const { fileName, task } of plannedTasks) printDryRunTaskPlan(fileName, task);

  if (backlog.length > plannedTasks.length) console.log(`\n[dry-run] would stop at the max task limit with ${backlog.length - plannedTasks.length} task(s) remaining`);
  else if (mode === "until-stop" && generateTasksWhenEmpty && maxGenerationRounds > 0) console.log("\n[dry-run] would stop when the generation-round or task/runtime limit is reached");
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
  console.log(`Generated task IDs: ${summary.generatedTaskIds.join(", ") || "None"}`);
}

function runLoop() {
  const summary = {
    mode,
    completedTaskIds: [],
    failedTaskId: null,
    stopReason: "Not started",
    prUrls: [],
    mergedPrUrls: [],
    generatedTaskIds: []
  };

  if (dryRun) {
    printDryRunPlan();
    summary.stopReason = "Dry-run plan completed without mutations";
    if (mode !== "single") printLoopSummary(summary);
    return summary;
  }

  let effectiveMaxTasks = maxTasks;
  let generationRounds = 0;

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
      if (effectiveMaxTasks !== null && summary.completedTaskIds.length >= effectiveMaxTasks) {
        summary.stopReason = `Max task limit reached (${effectiveMaxTasks})`;
        break;
      }
      if (backlog.length === 0) {
        if (mode === "until-stop" && generateTasksWhenEmpty) {
          if (generationRounds >= maxGenerationRounds) {
            summary.stopReason = `No backlog tasks remain and task generation limit reached (${maxGenerationRounds})`;
            break;
          }
          const generated = generateBacklogTasks();
          if (generated.length === 0) {
            summary.stopReason = "No backlog tasks remain and no tasks could be generated";
            break;
          }
          commitAndPushGeneratedTasks(generated);
          printGeneratedTaskSummary(generated);
          summary.generatedTaskIds.push(...generated.map(({ task }) => task.id));
          generationRounds += 1;
          continue;
        }
        summary.stopReason = "No backlog tasks remain";
        break;
      }
      if (effectiveMaxTasks === null) effectiveMaxTasks = backlog.length;
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
    if (mode === "single") console.error(summary.stopReason);
    process.exitCode = 1;
  }

  if (mode !== "single" || summary.failedTaskId) printLoopSummary(summary);
  return summary;
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  try {
    if (mode === "generate-tasks") runGenerateTasksMode();
    else runLoop();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

export {
  buildFailureLogContent,
  buildTaskYaml,
  canContinueWithoutPrChecks,
  canMoveTaskToDone,
  collectProjectPlanningContext,
  existingTaskRecoveryAction,
  failureTaskStatePolicy,
  generateBacklogTasks,
  getNextTaskId,
  guardDirtyTaskStateOnTaskBranch,
  hasTaskRelevantChanges,
  isRecoverableCodexSandboxVerificationFailure,
  isNoPrChecksReported,
  listExistingTaskIds,
  npmCommand,
  normalizeTitle,
  prChecksFailurePolicy,
  selectRoadmapTasks,
  shouldContinueAfterCodexFailure,
  verifyRecoveredBranch,
  writeGeneratedTaskFiles
};
