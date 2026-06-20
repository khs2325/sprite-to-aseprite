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

describe("auto-dev dry run", () => {
  it("prints the plan without mutating the repository", () => {
    const branchBefore = git("branch", "--show-current");
    const statusBefore = git("status", "--porcelain");
    const tasksBefore = taskSnapshot();

    const result = spawnSync(process.execPath, ["scripts/auto-dev-cycle.mjs", "--dry-run"], {
      cwd: root,
      encoding: "utf8"
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("[dry-run]");
    expect(git("branch", "--show-current")).toBe(branchBefore);
    expect(git("status", "--porcelain")).toBe(statusBefore);
    expect(taskSnapshot()).toEqual(tasksBefore);
  });
});
