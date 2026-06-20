import { describe, expect, it, vi } from "vitest";

import type { SpriteProject } from "../core/SpriteProject";
import { bindExportDownloadControl } from "./exportDownload";

type ButtonStub = {
  disabled: boolean;
  listener?: () => void;
};

function createButton(): HTMLButtonElement & ButtonStub {
  const button: ButtonStub = { disabled: false };
  return Object.assign(button, {
    addEventListener(_type: string, listener: () => void): void {
      button.listener = listener;
    },
    removeEventListener(_type: string, listener: () => void): void {
      if (button.listener === listener) {
        button.listener = undefined;
      }
    },
  }) as HTMLButtonElement & ButtonStub;
}

function createErrorOutput(): HTMLElement {
  return { hidden: false, textContent: "stale error" } as HTMLElement;
}

function createProject(): SpriteProject {
  return {
    width: 1,
    height: 1,
    colorMode: "rgba",
    frames: [{ index: 0, durationMs: 100 }],
    layers: [
      {
        id: "main",
        name: "Main",
        visible: true,
        opacity: 255,
        cels: [],
      },
    ],
  };
}

describe("bindExportDownloadControl", () => {
  it("disables export until a valid SpriteProject is loaded", () => {
    const button = createButton();
    const errorOutput = createErrorOutput();
    const control = bindExportDownloadControl(button, errorOutput);

    expect(button.disabled).toBe(true);
    expect(errorOutput.hidden).toBe(true);

    control.setProject({ width: 0 });
    expect(button.disabled).toBe(true);

    control.setProject(createProject());
    expect(button.disabled).toBe(false);
    expect(errorOutput.textContent).toBe("");
  });

  it("exports to a Blob and starts a local .aseprite download", async () => {
    const button = createButton();
    const errorOutput = createErrorOutput();
    const link = { click: vi.fn(), download: "", href: "" };
    const createObjectUrl = vi.fn((_blob: Blob) => "blob:aseprite-file");
    const revokeObjectUrl = vi.fn();
    const exportProject = vi.fn(() => new Uint8Array([1, 2, 3]));
    const control = bindExportDownloadControl(
      button,
      errorOutput,
      "walk-cycle.aseprite",
      {
        createDownloadLink: () => link,
        createObjectUrl,
        exportProject,
        revokeObjectUrl,
      },
    );
    const project = createProject();

    control.setProject(project);
    button.listener?.();

    expect(exportProject).toHaveBeenCalledWith(project);
    expect(createObjectUrl).toHaveBeenCalledOnce();
    const blob = createObjectUrl.mock.calls[0][0];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("application/x-aseprite");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(link).toMatchObject({
      download: "walk-cycle.aseprite",
      href: "blob:aseprite-file",
    });
    expect(link.click).toHaveBeenCalledOnce();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:aseprite-file");
    expect(errorOutput.hidden).toBe(true);
  });

  it("shows a clear error and does not download when export fails", () => {
    const button = createButton();
    const errorOutput = createErrorOutput();
    const link = { click: vi.fn(), download: "", href: "" };
    const control = bindExportDownloadControl(
      button,
      errorOutput,
      undefined,
      {
        createDownloadLink: () => link,
        exportProject: () => {
          throw new Error("Frame duration is out of range.");
        },
      },
    );

    control.setProject(createProject());

    expect(control.exportCurrentProject()).toBe(false);
    expect(link.click).not.toHaveBeenCalled();
    expect(errorOutput.hidden).toBe(false);
    expect(errorOutput.textContent).toBe(
      "Could not export the Aseprite file. Frame duration is out of range.",
    );
  });

  it("removes the click handler when destroyed", () => {
    const button = createButton();
    const control = bindExportDownloadControl(button, createErrorOutput());

    expect(button.listener).toBeTypeOf("function");
    control.destroy();
    expect(button.listener).toBeUndefined();
  });
});
