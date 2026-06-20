import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import {
  buildFailureLogContent,
  buildTaskYaml,
  canContinueWithoutPrChecks,
  canMoveTaskToDone,
  existingTaskRecoveryAction,
  failureTaskStatePolicy,
  getNextTaskId,
  guardDirtyTaskStateOnTaskBranch,
  isRecoverableCodexSandboxVerificationFailure,
  npmCommand,
  prChecksFailurePolicy,
  selectRoadmapTasks,
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
      expect(result.stdout).toContain("no backlog tasks remain");
    }
    expect(result.stdout).not.toContain("\n> ");
    expect(git("branch", "--show-current")).toBe(branchBefore);
    expect(git("status", "--porcelain")).toBe(statusBefore);
    expect(taskSnapshot()).toEqual(tasksBefore);
    expect(generatedSnapshot()).toEqual(generatedBefore);
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

  it("builds YAML with required planning and safety fields", () => {
    const task = selectRoadmapTasks({ docs: {}, sourceFiles: [], testFiles: [], tasks: [] }, 1)[0];
    const parsed = YAML.parse(buildTaskYaml(task));
    expect(parsed.id).toBe("001");
    expect(parsed.scope.summary).toBeTruthy();
    expect(parsed.scope.allowed_paths.length).toBeGreaterThan(0);
    expect(parsed.scope.forbidden_paths).toContain(".github/workflows/**");
    expect(parsed.requirements.length).toBeGreaterThan(0);
    expect(parsed.verification).toEqual(["npm run typecheck", "npm run test", "npm run build"]);
    expect(typeof parsed.auto_merge.allowed).toBe("boolean");
  });

  it("generates an implementation prompt from the structured task scope", () => {
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
      expect(prompt).toContain("Allowed paths:");
      expect(prompt).toContain("src/core/**");
      expect(prompt).not.toContain("[object Object]");
      expect(prompt).toContain("managed sandbox verification limitation");
      expect(prompt).toContain("outer automation will run local verification");
      expect(prompt).toContain("If `rg` is unavailable");
      expect(prompt).toContain("Get-ChildItem");
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
