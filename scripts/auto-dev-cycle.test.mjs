import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function git(...args) {
  return spawnSync("git", args, { cwd: root, encoding: "utf8" }).stdout;
}

function taskSnapshot() {
  return ["backlog", "done", "failed"].flatMap((directory) => {
    const taskDir = path.join(root, "tasks", directory);
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
    const hasBacklogTask = fs.readdirSync(path.join(root, "tasks", "backlog")).some((file) => file.endsWith(".yaml"));

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
      expect(result.stdout).toContain("no backlog tasks found");
    }
    expect(result.stdout).not.toContain("\n> ");
    expect(git("branch", "--show-current")).toBe(branchBefore);
    expect(git("status", "--porcelain")).toBe(statusBefore);
    expect(taskSnapshot()).toEqual(tasksBefore);
    expect(generatedSnapshot()).toEqual(generatedBefore);
  });
});
