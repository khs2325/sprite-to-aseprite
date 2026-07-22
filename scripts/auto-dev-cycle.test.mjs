import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import {
  auditProductCompleteness,
  autoMergePolicyDecision,
  branchBehindMainRecoveryGuidance,
  buildExistingPrRecoverySummary,
  buildFailureLogContent,
  buildLoopSummaryLines,
  buildTaskYaml,
  canContinueWithoutPrChecks,
  canMoveTaskToDone,
  collectProjectPlanningContext,
  existingTaskRecoveryAction,
  failureTaskStatePolicy,
  getNextTaskId,
  guardDirtyTaskStateOnTaskBranch,
  hasAutomationSourceChanged,
  isRecoverableCodexSandboxVerificationFailure,
  isBranchBehindOriginMain,
  isWorkingTreeCleanStatus,
  npmCommand,
  normalizeTitle,
  productCompletionStopReason,
  prMergeSafetyDecision,
  prChecksFailurePolicy,
  productTaskDependencySuppression,
  selectRoadmapTasks,
  selectProductCompletionTasks,
  shouldContinueAfterCodexFailure,
  verifyRecoveredBranch
} from "./auto-dev-cycle.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function git(...args) {
  return spawnSync("git", args, { cwd: root, encoding: "utf8" }).stdout;
}

function taskSnapshot() {
  return ["backlog", "done", "failed"].flatMap((directory) => {
    const taskDir = path.join(root, "tasks", directory);
    if (!fs.existsSync(taskDir)) return [];
    return fs.readdirSync(taskDir).sort().map((file) => [
      path.join(directory, file),
      fs.readFileSync(path.join(taskDir, file), "utf8")
    ]);
  });
}

function generatedSnapshot() {
  const generatedDir = path.join(root, "prompts", "generated");
  return fs.readdirSync(generatedDir).sort().map((file) => {
    const filePath = path.join(generatedDir, file);
    const stat = fs.statSync(filePath);
    return [file, stat.mtimeMs, fs.readFileSync(filePath, "utf8")];
  });
}

function createPlanningWorkspace() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "sprite-auto-dev-"));
  for (const directory of ["tasks/backlog", "tasks/done", "tasks/failed", "src", "scripts", "prompts/generated"]) {
    fs.mkdirSync(path.join(workspace, directory), { recursive: true });
  }
  fs.writeFileSync(path.join(workspace, "AGENTS.md"), "# Test project\n", "utf8");
  return workspace;
}

function writeWorkspaceFile(workspace, relativePath, content) {
  const filePath = path.join(workspace, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function markNormalRoadmapComplete(workspace) {
  for (const file of fs.readdirSync(path.join(root, "tasks", "done")).filter((name) => {
    const taskId = Number.parseInt(name, 10);
    return name.endsWith(".yaml") && Number.isInteger(taskId) && taskId <= 21;
  })) {
    fs.copyFileSync(path.join(root, "tasks", "done", file), path.join(workspace, "tasks", "done", file));
  }
}

function nextTaskIdForContext(context) {
  return getNextTaskId(context.tasks.map((task) => String(task.data?.id ?? "")));
}

function createMountedMvpWorkspace(options = {}) {
  const workspace = createPlanningWorkspace();
  writeWorkspaceFile(workspace, "package.json", JSON.stringify({ scripts: options.devScript === false ? {} : { dev: "vite" } }));
  writeWorkspaceFile(workspace, "index.html", `
    <div id="app"></div>
    <style>@media (max-width: 600px) { #app { width: 100%; } }</style>
    <script type="module" src="/src/index.ts"></script>
  `);
  writeWorkspaceFile(workspace, "src/index.ts", `
    import { mountConverterApp } from "./app/converter";
    const root = document.getElementById("app");
    if (root) mountConverterApp(root);
  `);
  writeWorkspaceFile(workspace, "src/app/converter.ts", `
    import { importPngSequence } from "../core/importers/pngSequence";
    import { importSpritesheetGrid } from "../core/importers/spritesheetGrid";
    import { importSpritesheetJson } from "../core/importers/spritesheetJson";
    import { exportAseprite } from "../core/exporters/aseprite";
    void importPngSequence; void importSpritesheetGrid; void importSpritesheetJson; void exportAseprite;
    export function mountConverterApp(root) {
      const input = document.createElement("input");
      input.type = "file";
      input.addEventListener("change", () => {});
      ${options.modeSelector === false ? "" : 'const select = document.createElement("select"); select.textContent = "PNG sequence spritesheet grid spritesheet JSON";'}
      const statusOutput = document.createElement("p");
      const errorOutput = document.createElement("p");
      const conversionProgress = document.createElement("progress");
      const conversionState = {
        isWorking: true,
        status: "Converting files browser-locally. This may take a while."
      };
      statusOutput.setAttribute("aria-live", "polite");
      conversionProgress.hidden = !conversionState.isWorking;
      statusOutput.textContent = conversionState.status;
      input.disabled = conversionState.isWorking;
      errorOutput.textContent = "Unsupported format or invalid grid settings";
      const warning = document.createElement("p");
      warning.textContent = "Large files may exceed browser memory limits";
      root.addEventListener("dragover", (event) => event.dataTransfer);
      root.addEventListener("drop", (event) => event.dataTransfer);
      root.append(input, ${options.modeSelector === false ? "" : "select,"} conversionProgress, statusOutput, errorOutput, warning);
      ${options.download === false ? "" : 'const button = document.createElement("button"); button.textContent = "Download .aseprite"; button.disabled = true; try { /* enable only for a valid SpriteProject */ } catch (error) { errorOutput.textContent = "Could not export"; } root.append(button);'}
    }
  `);
  for (const importer of ["pngSequence", "spritesheetGrid", "spritesheetJson"]) {
    const exportName = importer === "pngSequence" ? "importPngSequence" : importer === "spritesheetGrid" ? "importSpritesheetGrid" : "importSpritesheetJson";
    writeWorkspaceFile(workspace, `src/core/importers/${importer}/index.ts`, `export function ${exportName}() {}`);
  }
  writeWorkspaceFile(workspace, "src/core/exporters/aseprite/index.ts", "export function exportAseprite() {}\n");
  writeWorkspaceFile(workspace, "src/app/converter.test.ts", 'describe("mountConverterApp", () => { it("tracks converter state", () => { const disabled = true; expect(disabled).toBe(true); }); it("shows could not export before exporting with no valid project", () => {}); });\n');
  writeWorkspaceFile(workspace, "src/core/conversion.integration.test.ts", "// synthetic fixtures\nimportPngSequence(); importSpritesheetGrid(); importSpritesheetJson(); exportAseprite();\n");
  writeWorkspaceFile(workspace, "docs/manual-usage.md", "Run `npm run dev`, choose PNG sequence, spritesheet grid, or spritesheet JSON, then convert and download the result. Artwork stays browser-local and is never uploaded. Flat PNG files cannot recover original layers. Open the generated `.aseprite` file in Aseprite and inspect frames and durations. Unsupported features include linked cels and tilemaps.\n");
  writeWorkspaceFile(workspace, "docs/deployment.md", "For static deployment, run `npm run build`, serve the built `dist` output locally, then deploy it to a static host. Keep processing browser-only.\n");
  writeWorkspaceFile(workspace, "docs/performance.md", "Large decoded RGBA sequences can use substantial browser memory. Browser memory limits vary, so split large files when needed.\n");
  return workspace;
}

function runPlanner(workspace, args, env = {}) {
  return spawnSync(process.execPath, [path.join(root, "scripts", "auto-dev-cycle.mjs"), ...args], {
    cwd: workspace,
    encoding: "utf8",
    env: { ...process.env, ...env }
  });
}

describe("auto-dev dry run", () => {
  it.each([
    ["single", ["--dry-run"]],
    ["all", ["--dry-run", "--all"]],
    ["until-stop", ["--dry-run", "--until-stop"]]
  ])("prints the %s plan without mutating the repository", (_mode, args) => {
    const branchBefore = git("branch", "--show-current");
    const statusBefore = git("status", "--porcelain");
    const tasksBefore = taskSnapshot();
    const generatedBefore = generatedSnapshot();
    const backlogDir = path.join(root, "tasks", "backlog");
    const hasBacklogTask = fs.existsSync(backlogDir) && fs.readdirSync(backlogDir).some((file) => file.endsWith(".yaml"));

    const result = spawnSync(process.execPath, ["scripts/auto-dev-cycle.mjs", ...args], {
      cwd: root,
      encoding: "utf8"
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`[dry-run] mode: ${_mode}`);
    if (hasBacklogTask) {
      expect(result.stdout).toContain("Wait for GitHub checks");
      expect(result.stdout).toContain("Squash-merge the PR");
    } else {
      expect(result.stdout).toMatch(/(?:no backlog tasks remain|Running product completeness audits)/u);
    }
    expect(result.stdout).not.toContain("\n> ");
    expect(git("branch", "--show-current")).toBe(branchBefore);
    expect(git("status", "--porcelain")).toBe(statusBefore);
    expect(taskSnapshot()).toEqual(tasksBefore);
    expect(generatedSnapshot()).toEqual(generatedBefore);
  });
});

describe("automation source freshness", () => {
  it("requires a restart after the running automation module changes on disk", () => {
    const workspace = createPlanningWorkspace();
    const automationPath = path.join(workspace, "scripts", "auto-dev-cycle.mjs");
    try {
      const loadedSource = "export const detector = 'old';\n";
      fs.writeFileSync(automationPath, loadedSource, "utf8");
      expect(hasAutomationSourceChanged(automationPath, loadedSource)).toBe(false);

      fs.writeFileSync(automationPath, "export const detector = 'fixed';\n", "utf8");
      expect(hasAutomationSourceChanged(automationPath, loadedSource)).toBe(true);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });
});

describe("Windows sandbox recovery and task-state safety", () => {
  it.each([
    'Cannot read directory "../..": Access is denied',
    "Could not resolve C:\\repo\\vite.config.ts",
    "failed to load config from vite.config.ts",
    "UnauthorizedAccessException",
    "npm.ps1 cannot be loaded",
    "Test-Path : Access is denied"
  ])("recognizes recoverable Codex sandbox verification output: %s", (output) => {
    expect(isRecoverableCodexSandboxVerificationFailure(output)).toBe(true);
  });

  it("selects the platform-safe npm executable", () => {
    expect(npmCommand("win32")).toBe("npm.cmd");
    expect(npmCommand("linux")).toBe("npm");
  });

  it("does not require rg for dry-run planning", () => {
    const workspace = createPlanningWorkspace();
    try {
      const result = runPlanner(workspace, ["--dry-run", "--generate-tasks"], { PATH: "" });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("would generate tasks");
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("continues to outer verification only when recoverable output has task-relevant changes", () => {
    const output = "failed to load config from C:\\repo\\vite.config.ts";
    expect(shouldContinueAfterCodexFailure(output, ["src/core/SpriteProject.ts"])).toBe(true);
    expect(shouldContinueAfterCodexFailure(output, ["prompts/generated/002.md"])).toBe(false);
    expect(shouldContinueAfterCodexFailure("TypeScript syntax error", ["src/core/SpriteProject.ts"])).toBe(false);
  });

  it("leaves task state unchanged after the implementation branch was pushed", () => {
    const policy = failureTaskStatePolicy(true, false);
    expect(policy).toContain("Task state was left unchanged");
    expect(policy).toContain("already pushed");
  });

  it("does not allow a task to move to done before merge on main", () => {
    expect(canMoveTaskToDone(false, "main")).toBe(false);
    expect(canMoveTaskToDone(true, "codex/task-002")).toBe(false);
    expect(canMoveTaskToDone(true, "main")).toBe(true);
  });

  it("fails on missing PR checks by default and allows them only by opt-in", () => {
    const output = "no checks reported on the 'codex/task-003' branch";
    expect(prChecksFailurePolicy(output, false)).toBe("fail-no-checks");
    expect(prChecksFailurePolicy(output, true)).toBe("continue");
    expect(prChecksFailurePolicy("CI failed", true)).toBe("fail");
  });

  it("never bypasses missing PR checks before local verification passes", () => {
    const output = "no checks reported on the branch";
    expect(canContinueWithoutPrChecks(output, true, false)).toBe(false);
    expect(canContinueWithoutPrChecks(output, true, true)).toBe(true);
  });

  it("still fails the task when outer local verification fails", () => {
    const failingCheck = () => {
      throw Object.assign(new Error("test failed"), { command: "npm.cmd run test", status: 1 });
    };
    expect(() => verifyRecoveredBranch("004", failingCheck, () => {})).toThrowError(/failed mandatory local verification/u);
  });

  it("recovers existing PRs without creating duplicates", () => {
    const openPr = { state: "OPEN", mergedAt: null };
    const mergedPr = { state: "MERGED", mergedAt: "2026-06-21T00:00:00Z" };
    expect(existingTaskRecoveryAction(openPr, false, true)).toBe("resume-pr");
    expect(existingTaskRecoveryAction(mergedPr, false, false)).toBe("complete-merged");
    expect(existingTaskRecoveryAction(null, false, false)).toBe("start");
  });

  it("ignores task auto_merge.allowed=false after mandatory gates pass", () => {
    expect(autoMergePolicyDecision({
      taskPolicyAllowed: false,
      localVerificationPassed: true,
      requiredPrChecksPassed: true,
      safetyValidationPassed: true
    })).toBe("allow");
  });

  it("keeps local verification, PR checks, and PR metadata validation mandatory", () => {
    expect(autoMergePolicyDecision({
      taskPolicyAllowed: false,
      localVerificationPassed: false,
      requiredPrChecksPassed: true,
      safetyValidationPassed: true
    })).toBe("block-verification");
    expect(autoMergePolicyDecision({
      taskPolicyAllowed: false,
      localVerificationPassed: true,
      requiredPrChecksPassed: false,
      safetyValidationPassed: true
    })).toBe("block-ci");
    expect(autoMergePolicyDecision({
      taskPolicyAllowed: false,
      localVerificationPassed: true,
      requiredPrChecksPassed: true,
      safetyValidationPassed: false
    })).toBe("block-safety");
  });

  it("resumes an existing policy-false PR without recreating it", () => {
    const existingPr = { state: "OPEN", mergedAt: null };
    expect(existingTaskRecoveryAction(existingPr, false, true)).toBe("resume-pr");
    expect(autoMergePolicyDecision({
      taskPolicyAllowed: false,
      localVerificationPassed: true,
      requiredPrChecksPassed: true,
      safetyValidationPassed: true
    })).toBe("allow");
  });

  function legacyRestrictedMergeDecision(files, overrides = {}) {
    const restrictiveTask = {
      scope: {
        allowed_paths: ["src/app/**"],
        forbidden_paths: ["scripts/**"]
      },
      auto_merge: {
        allowed: false,
        max_changed_files: 1,
        forbidden_paths: [".github/workflows/**", "package-lock.json"]
      }
    };
    return prMergeSafetyDecision({
      baseRefName: "main",
      files,
      headRefName: "codex/task-123",
      url: "https://github.com/example/repo/pull/123"
    }, "codex/task-123", { ...restrictiveTask, ...overrides });
  }

  it("allows a task to change a file not listed in allowed_paths", () => {
    expect(legacyRestrictedMergeDecision([
      { path: "scripts/auto-dev-cycle.mjs", additions: 1 }
    ])).toMatchObject({ allowed: true, policy: "allow", reasons: [] });
  });

  it("allows a task to change more files than max_changed_files", () => {
    expect(legacyRestrictedMergeDecision(
      Array.from({ length: 12 }, (_, index) => ({ path: `docs/generated-${index}.md`, additions: 1 }))
    )).toMatchObject({ allowed: true, policy: "allow", reasons: [] });
  });

  it("allows a task to change paths listed in forbidden_paths", () => {
    expect(legacyRestrictedMergeDecision([
      { path: ".github/workflows/ci.yml", additions: 1 },
      { path: "package-lock.json", additions: 1 },
      { path: ".env.example", additions: 1 }
    ])).toMatchObject({ allowed: true, policy: "allow", reasons: [] });
  });

  it("keeps dirty working tree protection independent from task policy", () => {
    expect(isWorkingTreeCleanStatus("")).toBe(true);
    expect(isWorkingTreeCleanStatus(" M src/app/converterUi.ts")).toBe(false);
    expect(isWorkingTreeCleanStatus("?? package.json")).toBe(false);
  });

  it("blocks merge metadata when local verification or required PR checks fail", () => {
    const pr = {
      baseRefName: "main",
      files: [{ path: "src/app/converterUi.ts", additions: 1 }],
      headRefName: "codex/task-123",
      url: "https://github.com/example/repo/pull/123"
    };
    expect(prMergeSafetyDecision(pr, "codex/task-123", {}, { localVerificationPassed: false })).toMatchObject({
      allowed: false,
      policy: "block-verification"
    });
    expect(prMergeSafetyDecision(pr, "codex/task-123", {}, { requiredPrChecksPassed: false })).toMatchObject({
      allowed: false,
      policy: "block-ci"
    });
  });

  it("includes recovery commands and workflow context in failure logs", () => {
    const error = Object.assign(new Error("checks failed"), {
      command: "gh pr checks 4 --watch",
      status: 1,
      stdout: "no checks reported",
      stderr: ""
    });
    const log = buildFailureLogContent(error, {
      taskId: "004",
      taskFile: "004-importer.yaml",
      phase: "no_pr_checks",
      environmentOnly: false,
      changesProduced: true,
      prUrl: "https://github.com/example/repo/pull/4",
      suggestedRecovery: "gh pr view 4 --web"
    }, { branch: "codex/task-004", status: " M src/file.ts" });
    expect(log).toContain("TASK FILE: 004-importer.yaml");
    expect(log).toContain("PR URL: https://github.com/example/repo/pull/4");
    expect(log).toContain("SUGGESTED RECOVERY:\ngh pr view 4 --web");
  });

  it("guards dirty task state on a task branch with concrete recovery commands", () => {
    const status = [
      " D tasks/done/002-define-spriteproject-core-model.yaml",
      "?? tasks/failed/002-define-spriteproject-core-model.yaml"
    ].join("\n");
    expect(() => guardDirtyTaskStateOnTaskBranch("codex/task-002", status)).toThrowError(/Task state is dirty on a task branch/u);
    expect(() => guardDirtyTaskStateOnTaskBranch("codex/task-002", status)).toThrowError(/git restore tasks\/done\/002/u);
    expect(() => guardDirtyTaskStateOnTaskBranch("codex/task-002", status)).toThrowError(/Remove-Item tasks\/failed\/002/u);
    expect(() => guardDirtyTaskStateOnTaskBranch("main", status)).not.toThrow();
  });

  it("classifies access-denied verification as sandbox-only but still requires outer checks", () => {
    const output = "npm run test was blocked by the managed Windows sandbox: Access is denied before tests ran";
    expect(isRecoverableCodexSandboxVerificationFailure(output)).toBe(true);
    expect(shouldContinueAfterCodexFailure(output, ["src/app/converter.ts"], {
      scope: { allowed_paths: ["src/app/**"] }
    })).toBe(true);

    let outerVerificationRuns = 0;
    verifyRecoveredBranch("023", () => { outerVerificationRuns += 1; }, () => {});
    expect(outerVerificationRuns).toBe(1);
    expect(() => verifyRecoveredBranch("023", () => {
      throw new Error("outer npm run test failed");
    }, () => {})).toThrowError(/mandatory local verification in the outer automation/u);
  });

  it("summarizes existing PR recovery and suggests merging origin/main only when behind", () => {
    expect(isBranchBehindOriginMain("codex/task-023", () => ({ stdout: "2\n" }))).toBe(true);
    expect(isBranchBehindOriginMain("codex/task-023", () => ({ stdout: "0\n" }))).toBe(false);

    const summary = buildExistingPrRecoverySummary({
      branchName: "codex/task-023",
      prUrl: "https://github.com/example/repo/pull/24",
      implementationFailure: false,
      branchBehindMain: true,
      managedSandboxFailure: false,
      localVerificationFailed: true,
      safetyValidationFailed: false
    });
    expect(summary).toContain("Existing PR URL: https://github.com/example/repo/pull/24");
    expect(summary).toContain("Stale branch needs origin/main: yes");
    expect(summary).toContain("Outer local verification failed: yes");
    expect(summary).toContain("git checkout codex/task-023");
    expect(summary).toContain("git merge origin/main");
    expect(branchBehindMainRecoveryGuidance("codex/task-023")).toContain("npm run build");
  });

  it("builds a concise loop summary with actionable recovery state", () => {
    const lines = buildLoopSummaryLines({
      mode: "until-stop",
      completedTaskIds: [],
      failedTaskId: "023",
      stopReason: "Existing branch verification failed",
      prUrls: ["https://github.com/example/repo/pull/24"],
      mergedPrUrls: [],
      generatedTaskIds: [],
      existingPrUrl: "https://github.com/example/repo/pull/24",
      localVerificationFailed: true,
      safetyValidationFailed: true,
      branchBehindMain: true,
      skippedCoveredTasks: ["Add browser drag-and-drop import area"]
    }, { branch: "codex/task-023", clean: true }, "12.3");

    expect(lines).toContain("Current branch: codex/task-023");
    expect(lines).toContain("Working tree clean: yes");
    expect(lines).toContain("Existing PR URL: https://github.com/example/repo/pull/24");
    expect(lines).toContain("Local verification failed: yes");
    expect(lines).toContain("PR metadata validation failed: yes");
    expect(lines).toContain("Task branch behind main: yes");
    expect(lines.join("\n")).toContain("Add browser drag-and-drop import area");
  });
});

describe("backlog task generation", () => {
  it("calculates the next padded numeric task ID", () => {
    expect(getNextTaskId(["001", "007", "not-numeric"])).toBe("008");
    expect(getNextTaskId([], 1)).toBe("002");
  });

  it("filters duplicate titles from all task states", () => {
    const context = {
      docs: {},
      sourceFiles: [],
      testFiles: [],
      tasks: [{ state: "done", file: "001-model.yaml", data: { id: "001", title: "Define SpriteProject core model" } }]
    };
    const generated = selectRoadmapTasks(context, 2);
    expect(generated.map((task) => task.title)).not.toContain("Define SpriteProject core model");
    expect(generated[0].id).toBe("002");
  });

  it("builds YAML without generated path or changed-file restrictions", () => {
    const task = selectRoadmapTasks({ docs: {}, sourceFiles: [], testFiles: [], tasks: [] }, 1)[0];
    const parsed = YAML.parse(buildTaskYaml(task));
    expect(parsed.id).toBe("001");
    expect(parsed.scope.summary).toBeTruthy();
    expect(parsed.scope.allowed_paths).toBeUndefined();
    expect(parsed.scope.forbidden_paths).toBeUndefined();
    expect(parsed.requirements.length).toBeGreaterThan(0);
    expect(parsed.verification).toEqual(["npm run typecheck", "npm run test", "npm run build"]);
    expect(parsed.auto_merge).toBeUndefined();
  });

  it("generates an implementation prompt without path restriction guardrails", () => {
    const workspace = createPlanningWorkspace();
    try {
      const task = selectRoadmapTasks({ docs: {}, sourceFiles: [], testFiles: [], tasks: [] }, 1)[0];
      const taskFile = `${task.id}-model.yaml`;
      fs.writeFileSync(path.join(workspace, "tasks", "backlog", taskFile), buildTaskYaml(task), "utf8");
      fs.mkdirSync(path.join(workspace, "prompts", "templates"), { recursive: true });
      fs.copyFileSync(path.join(root, "prompts", "templates", "implement-task.md"), path.join(workspace, "prompts", "templates", "implement-task.md"));

      const result = spawnSync(process.execPath, [path.join(root, "scripts", "make-prompt.mjs"), task.id], {
        cwd: workspace,
        encoding: "utf8"
      });

      expect(result.status).toBe(0);
      const prompt = fs.readFileSync(path.join(workspace, "prompts", "generated", `${task.id}.md`), "utf8");
      expect(prompt).toContain("Task focus:");
      expect(prompt).toContain(task.goal);
      expect(prompt).not.toContain("Allowed paths:");
      expect(prompt).not.toContain("Forbidden paths:");
      expect(prompt).not.toContain("[object Object]");
      expect(prompt).toContain("managed sandbox verification limitation");
      expect(prompt).toContain("outer automation will run local verification");
      expect(prompt).toContain("If `rg` is unavailable");
      expect(prompt).toContain("Get-ChildItem");
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("adds product-completion focus guidance without out-of-scope guardrails", () => {
    const workspace = createPlanningWorkspace();
    try {
      const context = collectProjectPlanningContext(workspace);
      const audit = auditProductCompleteness({ rootDirectory: workspace, context });
      const task = selectProductCompletionTasks(audit, context, 5)
        .find((candidate) => candidate.title === "Mount browser converter UI");
      const taskFile = `${task.id}-mount-ui.yaml`;
      fs.writeFileSync(path.join(workspace, "tasks", "backlog", taskFile), buildTaskYaml(task), "utf8");
      fs.mkdirSync(path.join(workspace, "prompts", "templates"), { recursive: true });
      fs.copyFileSync(path.join(root, "prompts", "templates", "implement-task.md"), path.join(workspace, "prompts", "templates", "implement-task.md"));

      const result = spawnSync(process.execPath, [path.join(root, "scripts", "make-prompt.mjs"), task.id], {
        cwd: workspace,
        encoding: "utf8"
      });
      const prompt = fs.readFileSync(path.join(workspace, "prompts", "generated", `${task.id}.md`), "utf8");

      expect(result.status).toBe(0);
      expect(prompt).toContain("Product-completion task focus");
      expect(prompt).toContain("Modify any repository file required to complete the task");
      expect(prompt).not.toContain("Do not edit files outside the Allowed paths");
      expect(prompt).not.toContain("out-of-scope files");
      expect(prompt).not.toContain("scripts/**");
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("previews generated files without writing them", () => {
    const workspace = createPlanningWorkspace();
    try {
      const result = runPlanner(workspace, ["--dry-run", "--generate-tasks"], { AUTO_DEV_GENERATED_TASK_COUNT: "2" });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("[dry-run] would generate tasks:");
      expect(result.stdout).toContain("001-define-spriteproject-core-model.yaml");
      expect(fs.readdirSync(path.join(workspace, "tasks", "backlog"))).toEqual([]);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("plans generated work in until-stop mode when backlog is empty", () => {
    const workspace = createPlanningWorkspace();
    try {
      const result = runPlanner(workspace, ["--dry-run", "--until-stop"], {
        AUTO_DEV_GENERATE_TASKS_WHEN_EMPTY: "true",
        AUTO_DEV_GENERATED_TASK_COUNT: "2"
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("[dry-run] would generate tasks:");
      expect(result.stdout).toContain("[dry-run] planned task 001");
      expect(fs.readdirSync(path.join(workspace, "tasks", "backlog"))).toEqual([]);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("stops dry-run generation when the round limit is reached", () => {
    const workspace = createPlanningWorkspace();
    try {
      const result = runPlanner(workspace, ["--dry-run", "--until-stop"], {
        AUTO_DEV_GENERATE_TASKS_WHEN_EMPTY: "true",
        AUTO_DEV_MAX_GENERATION_ROUNDS: "0"
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("task generation limit is already reached");
      expect(fs.readdirSync(path.join(workspace, "tasks", "backlog"))).toEqual([]);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });
});

describe("product completeness audits and task generation", () => {
  it("advances product task IDs when 022 already exists in done", () => {
    const audit = { missing: [{ key: "browserAppMounted", message: "browser UI mount missing" }] };
    const context = {
      docs: {},
      sourceFiles: [],
      testFiles: [],
      openTaskBranchIds: [],
      tasks: [{ state: "done", file: "022-add-vite-dev-script.yaml", data: { id: "022", title: "Add Vite dev script" } }]
    };

    const [task] = selectProductCompletionTasks(audit, context, 1);
    expect(task).toMatchObject({ id: "023", title: "Mount browser converter UI" });
  });

  it("advances past numeric IDs across done, backlog, and failed states", () => {
    const audit = { missing: [{ key: "modeSelector", message: "mode selector missing" }] };
    const context = {
      docs: {},
      sourceFiles: [],
      testFiles: [],
      openTaskBranchIds: [],
      tasks: [
        { state: "done", file: "022-done.yaml", data: { id: "022", title: "Done work" } },
        { state: "backlog", file: "023-backlog.yaml", data: { id: "023", title: "Pending work" } },
        { state: "failed", file: "024-failed.yaml", data: { id: "024", title: "Failed work" } }
      ]
    };

    const [task] = selectProductCompletionTasks(audit, context, 1);
    expect(task).toMatchObject({ id: "025", title: "Add converter import mode selector" });
  });

  it("suppresses narrow UI tasks while the broad mount task is pending, then releases them after completion", () => {
    const audit = {
      missing: [
        "fileImportUi",
        "dragAndDrop",
        "modeSelector",
        "previewTimelineUi",
        "asepriteDownloadUi",
        "responsiveStyling"
      ].map((key) => ({ key, message: `${key} missing` }))
    };
    const broadTask = { file: "023-mount-browser-converter-ui.yaml", data: { id: "023", title: "Mount browser converter UI" } };
    const pendingContext = {
      docs: {}, sourceFiles: [], testFiles: [], openTaskBranchIds: ["023"],
      tasks: [{ ...broadTask, state: "backlog" }]
    };

    const pendingTasks = selectProductCompletionTasks(audit, pendingContext, 10);
    expect(pendingTasks).toHaveLength(0);
    expect(productTaskDependencySuppression(audit, pendingContext)).toMatchObject({
      active: true,
      broadTask: { id: "023", branchOpen: true }
    });
    expect(pendingTasks.dependencySuppression.skippedTitles).toEqual(expect.arrayContaining([
      "Wire browser-local file import into UI",
      "Add browser drag-and-drop import area",
      "Add converter import mode selector",
      "Wire browser preview timeline into converter UI",
      "Wire Aseprite export download into UI",
      "Add basic responsive styling"
    ]));

    const completedContext = { ...pendingContext, tasks: [{ ...broadTask, state: "done" }] };
    const completedTitles = selectProductCompletionTasks(audit, completedContext, 10).map((task) => task.title);
    expect(productTaskDependencySuppression(audit, completedContext).active).toBe(false);
    expect(completedTitles).toEqual(expect.arrayContaining([
      "Wire browser-local file import into UI",
      "Add browser drag-and-drop import area",
      "Add converter import mode selector"
    ]));
  });

  it("passes only when the mounted browser product exposes the complete audited flow", () => {
    const workspace = createMountedMvpWorkspace();
    try {
      const context = collectProjectPlanningContext(workspace);
      const audit = auditProductCompleteness({ rootDirectory: workspace, context });

      expect(audit.passed).toBe(true);
      expect(audit.missing).toEqual([]);
      expect(audit.audits.map(({ id }) => id)).toEqual([
        "ui",
        "import-coverage",
        "export-download",
        "end-to-end-conversion",
        "documentation",
        "deployment-readiness",
        "error-handling",
        "performance-large-file"
      ]);
      expect(selectProductCompletionTasks(audit, context, 5)).toEqual([]);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("recognizes conversion progress when working state and control locking are rendered through state", () => {
    const workspace = createMountedMvpWorkspace();
    try {
      const context = collectProjectPlanningContext(workspace);
      const audit = auditProductCompleteness({ rootDirectory: workspace, context });

      expect(audit.checks.conversionProgress.passed).toBe(true);

      const converterPath = path.join(workspace, "src", "app", "converter.ts");
      const converterSource = fs.readFileSync(converterPath, "utf8");
      fs.writeFileSync(
        converterPath,
        converterSource.replace('document.createElement("progress")', 'document.createElement("span")'),
        "utf8"
      );

      expect(auditProductCompleteness({ rootDirectory: workspace, context }).checks.conversionProgress.passed).toBe(false);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("recognizes the production converter entry and does not queue another UI mount task", () => {
    const workspace = createMountedMvpWorkspace();
    try {
      const converterPath = path.join(workspace, "src", "app", "converter.ts");
      const converterSource = fs.readFileSync(converterPath, "utf8");
      fs.writeFileSync(
        converterPath,
        converterSource.replaceAll("mountConverterApp", "mountConverterUi"),
        "utf8"
      );
      writeWorkspaceFile(workspace, "src/index.ts", `
        import { mountConverterUi } from "./app/converter";
        const appRoot = document.querySelector<HTMLElement>("#app");
        if (appRoot === null) throw new Error("The Sprite to Aseprite app root is missing.");
        mountConverterUi(appRoot);
      `);
      writeWorkspaceFile(
        workspace,
        "tasks/done/030-browser-ui-audit-gap.yaml",
        'id: "030"\ntitle: Complete browser converter UI audit gap after task 029\n'
      );
      const context = collectProjectPlanningContext(workspace);
      const audit = auditProductCompleteness({ rootDirectory: workspace, context });
      const taskTitles = selectProductCompletionTasks(audit, context, 10)
        .map((task) => task.title);

      expect(audit.checks.browserAppMounted.passed).toBe(true);
      expect(audit.checks.productionBundle.passed).toBe(true);
      expect(taskTitles).not.toContain("Mount browser converter UI");
      expect(taskTitles.some((title) =>
        title.startsWith("Complete browser converter UI audit gap")
      )).toBe(false);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("generates importer-specific end-to-end tasks when conversion coverage is missing", () => {
    const workspace = createMountedMvpWorkspace();
    try {
      fs.rmSync(path.join(workspace, "src/core/conversion.integration.test.ts"));
      const context = collectProjectPlanningContext(workspace);
      const audit = auditProductCompleteness({ rootDirectory: workspace, context });
      const titles = selectProductCompletionTasks(audit, context, 10).map((task) => task.title);

      expect(audit.audits.find(({ id }) => id === "end-to-end-conversion")?.passed).toBe(false);
      expect(titles).toEqual(expect.arrayContaining([
        "Add end-to-end PNG sequence conversion smoke test",
        "Add end-to-end spritesheet grid conversion smoke test",
        "Add end-to-end spritesheet JSON conversion smoke test"
      ]));
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("generates manual documentation work when the usage guide is missing", () => {
    const workspace = createMountedMvpWorkspace();
    try {
      fs.rmSync(path.join(workspace, "docs/manual-usage.md"));
      const context = collectProjectPlanningContext(workspace);
      const audit = auditProductCompleteness({ rootDirectory: workspace, context });
      const titles = selectProductCompletionTasks(audit, context, 10).map((task) => task.title);

      expect(audit.checks.manualUsageGuide.passed).toBe(false);
      expect(titles).toContain("Add manual usage guide");
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("generates deployment-readiness work when static deployment docs are missing", () => {
    const workspace = createMountedMvpWorkspace();
    try {
      fs.rmSync(path.join(workspace, "docs/deployment.md"));
      const context = collectProjectPlanningContext(workspace);
      const audit = auditProductCompleteness({ rootDirectory: workspace, context });
      const titles = selectProductCompletionTasks(audit, context, 10).map((task) => task.title);

      expect(audit.audits.find(({ id }) => id === "deployment-readiness")?.passed).toBe(false);
      expect(titles).toContain("Add static deployment guide");
      expect(titles).toContain("Add production build verification notes");
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("generates a mounting task when the empty-backlog product is placeholder-only", () => {
    const workspace = createPlanningWorkspace();
    try {
      markNormalRoadmapComplete(workspace);
      writeWorkspaceFile(workspace, "package.json", JSON.stringify({ scripts: { dev: "vite" } }));
      writeWorkspaceFile(workspace, "index.html", '<main><p>Automation framework installed.</p></main><script type="module" src="/src/index.ts"></script>');
      writeWorkspaceFile(workspace, "src/index.ts", 'export const projectName = "sprite-to-aseprite";\n');
      const context = collectProjectPlanningContext(workspace);
      const expectedTaskId = nextTaskIdForContext(context);
      const audit = auditProductCompleteness({ rootDirectory: workspace, context });
      const tasks = selectProductCompletionTasks(audit, context, 5);

      expect(audit.passed).toBe(false);
      expect(audit.checks.browserAppMounted.passed).toBe(false);
      expect(tasks.map((task) => task.title)).toContain("Mount browser converter UI");
      expect(tasks.find((task) => task.title === "Mount browser converter UI")?.id).toBe(expectedTaskId);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("generates a Vite dev-script task when package.json lacks dev", () => {
    const workspace = createMountedMvpWorkspace({ devScript: false });
    try {
      const context = collectProjectPlanningContext(workspace);
      const audit = auditProductCompleteness({ rootDirectory: workspace, context });
      const tasks = selectProductCompletionTasks(audit, context, 5);

      expect(audit.checks.devScript.passed).toBe(false);
      expect(tasks.map((task) => task.title)).toContain("Add Vite dev script");
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("generates export-download work when the exporter exists but the mounted UI has no download path", () => {
    const workspace = createMountedMvpWorkspace({ devScript: false, download: false });
    try {
      const context = collectProjectPlanningContext(workspace);
      const audit = auditProductCompleteness({ rootDirectory: workspace, context });
      const tasks = selectProductCompletionTasks(audit, context, 10);

      expect(audit.checks.asepriteDownloadUi.passed).toBe(false);
      expect(tasks.map((task) => task.title)).toContain("Wire Aseprite export download into UI");
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("generates mode-selector wiring when implemented importers are not selectable", () => {
    const workspace = createMountedMvpWorkspace({ modeSelector: false });
    try {
      const context = collectProjectPlanningContext(workspace);
      const audit = auditProductCompleteness({ rootDirectory: workspace, context });
      const tasks = selectProductCompletionTasks(audit, context, 10);

      expect(audit.checks.modeSelector.passed).toBe(false);
      expect(tasks.map((task) => task.title)).toContain("Add converter import mode selector");
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("blocks pending duplicates but remediates done and failed audit gaps", () => {
    const workspace = createMountedMvpWorkspace({ devScript: false, download: false, modeSelector: false });
    try {
      writeWorkspaceFile(workspace, "tasks/backlog/019-dev.yaml", 'id: "019"\ntitle: Prepare local development\ngoal: Add the missing npm development command so the browser product can be run locally with Vite.\n');
      writeWorkspaceFile(workspace, "tasks/done/020-export.yaml", 'id: "020"\ntitle: Wire Aseprite export download into UI\n');
      writeWorkspaceFile(workspace, "tasks/failed/021-mode.yaml", 'id: "021"\ntitle: Add converter import mode selector\n');
      const context = collectProjectPlanningContext(workspace);
      const audit = auditProductCompleteness({ rootDirectory: workspace, context });
      const tasks = selectProductCompletionTasks(audit, context, 10);

      expect(tasks.map((task) => task.title)).not.toContain("Add Vite dev script");
      expect(tasks.map((task) => task.title)).toContain("Complete Aseprite export download into UI audit gap after task 020");
      expect(tasks.map((task) => task.title)).toContain("Retry converter import mode selector audit gap after task 021");
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("creates a focused remediation when a done candidate still fails its audit", () => {
    const audit = {
      missing: [{ key: "asepriteDownloadUi", message: ".aseprite download is not reachable" }],
      audits: [{ id: "export-download", label: "Export/download audit", checks: [{ key: "asepriteDownloadUi" }] }]
    };
    const context = {
      docs: {}, sourceFiles: [], testFiles: [], openTaskBranchIds: [],
      tasks: [{
        state: "done",
        file: "028-export.yaml",
        data: {
          id: "028",
          title: "Wire Aseprite export download into UI",
          goal: "Make the implemented .aseprite exporter and browser download control reachable after conversion."
        }
      }]
    };

    const [task] = selectProductCompletionTasks(audit, context, 5);

    expect(task.title).toBe("Complete Aseprite export download into UI audit gap after task 028");
    expect(task.goal).toContain('done task 028 "Wire Aseprite export download into UI"');
    expect(normalizeTitle(task.title)).not.toBe(normalizeTitle(context.tasks[0].data.title));
    expect(normalizeTitle(task.goal)).not.toBe(normalizeTitle(context.tasks[0].data.goal));
    expect(task.audit_gap).toMatchObject({ kind: "remediation", category: "export-download", check_keys: ["asepriteDownloadUi"], previous_task_id: "028" });
    const parsed = YAML.parse(buildTaskYaml(task));
    expect(parsed.scope).toEqual({ summary: task.goal });
    expect(parsed.scope.allowed_paths).toBeUndefined();
    expect(parsed.scope.forbidden_paths).toBeUndefined();
    expect(task.verification).toEqual(["npm run typecheck", "npm run test", "npm run build"]);
  });

  it("blocks an identical active task", () => {
    const audit = { missing: [{ key: "modeSelector", message: "mode selector missing" }] };
    const context = {
      docs: {}, sourceFiles: [], testFiles: [], openTaskBranchIds: [],
      tasks: [{ state: "active", file: "029-mode.yaml", data: { id: "029", title: "Add converter import mode selector" } }]
    };

    const tasks = selectProductCompletionTasks(audit, context, 5);

    expect(tasks).toHaveLength(0);
    expect(tasks.auditPlan.decisions[0]).toMatchObject({ decision: "blocked by identical active task" });
  });

  it("blocks an identical task with an open task branch", () => {
    const audit = { missing: [{ key: "modeSelector", message: "mode selector missing" }] };
    const context = {
      docs: {}, sourceFiles: [], testFiles: [], openTaskBranchIds: ["029"],
      tasks: [{ state: "failed", file: "029-mode.yaml", data: { id: "029", title: "Add converter import mode selector" } }]
    };

    const tasks = selectProductCompletionTasks(audit, context, 5);

    expect(tasks).toHaveLength(0);
    expect(tasks.auditPlan.decisions[0].duplicate).toMatchObject({ state: "open-branch", location: "codex/task-029" });
    expect(tasks.auditPlan.decisions[0].decision).toBe("blocked by identical open-branch task");
  });

  it("creates a unique retry/remediation after a failed duplicate", () => {
    const audit = { missing: [{ key: "modeSelector", message: "mode selector missing" }] };
    const context = {
      docs: {}, sourceFiles: [], testFiles: [], openTaskBranchIds: [],
      tasks: [{ state: "failed", file: "029-mode.yaml", data: { id: "029", title: "Add converter import mode selector" } }]
    };

    const [task] = selectProductCompletionTasks(audit, context, 5);

    expect(task.title).toBe("Retry converter import mode selector audit gap after task 029");
    expect(task.audit_gap).toMatchObject({ kind: "retry", previous_task_id: "029", previous_task_state: "failed" });
  });

  it("creates an investigation task for an unmapped failing audit check", () => {
    const audit = {
      missing: [{ key: "newUnknownCheck", message: "new product evidence is absent" }],
      audits: [{ id: "new-category", label: "New category audit", checks: [{ key: "newUnknownCheck" }] }]
    };
    const context = { docs: {}, sourceFiles: [], testFiles: [], openTaskBranchIds: [], tasks: [] };

    const [task] = selectProductCompletionTasks(audit, context, 5);

    expect(task.title).toBe("Investigate unmapped product audit gap: newUnknownCheck");
    expect(task.goal).toContain("newUnknownCheck");
    expect(task.audit_gap).toMatchObject({ kind: "investigation", category: "new-category", check_keys: ["newUnknownCheck"] });
    expect(task.requirements.join("\n")).toContain("task mapping is missing");
  });

  it("prints dry-run audit diagnostics and remediation decisions without writing tasks", () => {
    const workspace = createPlanningWorkspace();
    try {
      markNormalRoadmapComplete(workspace);
      writeWorkspaceFile(workspace, "tasks/done/023-mount.yaml", 'id: "023"\ntitle: Mount browser converter UI\n');
      writeWorkspaceFile(workspace, "package.json", JSON.stringify({ scripts: { dev: "vite" } }));
      writeWorkspaceFile(workspace, "index.html", '<main id="app">placeholder</main><script type="module" src="/src/index.ts"></script>');
      writeWorkspaceFile(workspace, "src/index.ts", 'export const product = "placeholder";\n');

      const result = runPlanner(workspace, ["--dry-run", "--generate-tasks"]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Product audit task decisions:");
      expect(result.stdout).toContain("UI audit / browserAppMounted");
      expect(result.stdout).toContain("Candidate: Mount browser converter UI");
      expect(result.stdout).toContain("tasks/done/023-mount.yaml (done)");
      expect(result.stdout).toContain("Done-but-audit-still-fails: yes");
      expect(result.stdout).toContain("generate unique remediation task");
      expect(result.stdout).toContain("Complete browser converter UI audit gap after task 023");
      expect(result.stdout).not.toContain("no non-duplicate product-completion tasks");
      expect(fs.readdirSync(path.join(workspace, "tasks", "backlog"))).toEqual([]);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("uses local, dependency-free implementation rules without generated path restrictions", () => {
    const workspace = createPlanningWorkspace();
    try {
      const context = collectProjectPlanningContext(workspace);
      const audit = auditProductCompleteness({ rootDirectory: workspace, context });
      const task = selectProductCompletionTasks(audit, context, 5).find((item) => item.title === "Mount browser converter UI");
      const parsed = YAML.parse(buildTaskYaml(task));
      const requirements = parsed.requirements.join("\n");

      expect(parsed.scope).toEqual({ summary: task.goal });
      expect(parsed.scope.allowed_paths).toBeUndefined();
      expect(parsed.scope.forbidden_paths).toBeUndefined();
      expect(parsed.auto_merge).toBeUndefined();
      expect(requirements).toContain("Use plain TypeScript and DOM APIs.");
      expect(requirements).toContain("Do not add React, Vue, Svelte, or other dependencies.");
      expect(requirements).toContain("Keep files processed browser-locally.");
      expect(requirements).toContain("Do not upload user artwork.");
      expect(requirements).toContain("Do not duplicate conversion logic.");
      expect(requirements).toContain("Add focused tests.");
      expect(parsed.non_goals.join("\n")).toContain("Do not upload user artwork");
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("distinguishes audit success, generated work, and unresolved audit failure stop reasons", () => {
    expect(productCompletionStopReason({ passed: true }, 0)).toBe("No backlog tasks remain and product completeness audits passed");
    expect(productCompletionStopReason({ passed: false }, 2)).toBe("Generated product-completion tasks; rerun automation to continue");
    expect(productCompletionStopReason({ passed: false }, 0)).toContain("Product completeness audits failed");
  });

  it("does not claim completion when pending duplicates block every failing audit gap", () => {
    const audit = { passed: false, missing: [{ key: "modeSelector", message: "mode selector missing" }] };
    const context = {
      docs: {}, sourceFiles: [], testFiles: [], openTaskBranchIds: [],
      tasks: [{ state: "backlog", file: "029-mode.yaml", data: { id: "029", title: "Add converter import mode selector" } }]
    };
    const tasks = selectProductCompletionTasks(audit, context, 5);
    const reason = productCompletionStopReason(audit, tasks.length, tasks.auditPlan);

    expect(reason).toContain("all candidate tasks are blocked");
    expect(reason).not.toContain("audits passed");
    const lines = buildLoopSummaryLines({
      mode: "until-stop", completedTaskIds: [], failedTaskId: null, stopReason: reason,
      prUrls: [], mergedPrUrls: [], generatedTaskIds: [], existingPrUrl: null,
      localVerificationFailed: false, safetyValidationFailed: false, branchBehindMain: false,
      skippedCoveredTasks: [], auditGenerationBlocked: true, doneAuditDuplicates: ["023 Mount browser converter UI"]
    }, { branch: "main", clean: true }, "1.0");
    expect(lines).toContain("All failing audit gaps blocked by pending duplicates: yes");
    expect(lines).toContain("Done duplicates whose audits still fail: 023 Mount browser converter UI");
    expect(lines).toContain("Audit generation dry-run: node scripts/auto-dev-cycle.mjs --dry-run --generate-tasks");
    expect(lines.join("\n")).toContain("Next action:");
  });

  it("does not report full completion when placeholder UI fails the audit", () => {
    const workspace = createPlanningWorkspace();
    try {
      markNormalRoadmapComplete(workspace);
      writeWorkspaceFile(workspace, "src/index.ts", 'export const projectName = "placeholder";\n');
      const expectedTaskId = nextTaskIdForContext(collectProjectPlanningContext(workspace));
      const result = runPlanner(workspace, ["--dry-run", "--generate-tasks"]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Running product completeness audits...");
      for (const label of [
        "UI audit:",
        "Import coverage audit:",
        "Export/download audit:",
        "End-to-end conversion audit:",
        "Documentation/manual usage audit:",
        "Deployment readiness audit:",
        "Error handling audit:",
        "Performance/large-file readiness audit:"
      ]) expect(result.stdout).toContain(label);
      expect(result.stdout).toContain("Mount browser converter UI");
      expect(result.stdout).not.toContain("product completeness audits passed");
      expect(result.stdout).toContain(`product-completion tasks: ${expectedTaskId}`);
      expect(fs.readdirSync(path.join(workspace, "tasks", "backlog"))).toEqual([]);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });
});
