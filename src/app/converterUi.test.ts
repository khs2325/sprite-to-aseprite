import { describe, expect, it, vi } from "vitest";

import type { SpriteProject } from "../core/SpriteProject";
import type { SpritesheetGridImportOptions } from "../core/importers/spritesheetGrid";
import {
  convertSourceFiles,
  getSourceSelectionError,
} from "./converterUi";
import type { BrowserSourceFile } from "./fileImport";

const gridOptions: SpritesheetGridImportOptions = {
  frameWidth: 16,
  frameHeight: 16,
  rows: 2,
  columns: 3,
  frameOrder: "row-major",
};

const project: SpriteProject = {
  width: 16,
  height: 16,
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

function png(name: string): BrowserSourceFile {
  return {
    file: new File(["png"], name, { type: "image/png" }),
    kind: "png",
    bytes: new ArrayBuffer(0),
  };
}

function json(name: string): BrowserSourceFile {
  return {
    file: new File(["{}"], name, { type: "application/json" }),
    kind: "json",
    text: "{}",
  };
}

describe("getSourceSelectionError", () => {
  it("accepts the required file combination for each import mode", () => {
    expect(getSourceSelectionError("png-sequence", [png("1.png"), png("2.png")]))
      .toBeNull();
    expect(getSourceSelectionError("spritesheet-grid", [png("sheet.png")]))
      .toBeNull();
    expect(
      getSourceSelectionError("spritesheet-json", [
        png("sheet.png"),
        json("sheet.json"),
      ]),
    ).toBeNull();
  });

  it("rejects mode/file mismatches before conversion", () => {
    expect(getSourceSelectionError("png-sequence", [json("frames.json")]))
      .toContain("one or more PNG files");
    expect(
      getSourceSelectionError("spritesheet-grid", [
        png("one.png"),
        png("two.png"),
      ]),
    ).toContain("exactly one PNG file");
    expect(getSourceSelectionError("spritesheet-json", [png("sheet.png")]))
      .toContain("one PNG and one JSON file");
  });
});

describe("convertSourceFiles", () => {
  it("delegates every mode to the existing importer with the selected files", async () => {
    const importPngSequence = vi.fn(async () => project);
    const importSpritesheetGrid = vi.fn(async () => project);
    const importSpritesheetJson = vi.fn(async () => project);
    const importers = {
      importPngSequence,
      importSpritesheetGrid,
      importSpritesheetJson,
    };
    const firstPng = png("walk-01.png");
    const secondPng = png("walk-02.png");
    const metadata = json("walk.json");

    await expect(
      convertSourceFiles(
        "png-sequence",
        [firstPng, secondPng],
        gridOptions,
        importers,
      ),
    ).resolves.toBe(project);
    expect(importPngSequence).toHaveBeenCalledWith([
      firstPng.file,
      secondPng.file,
    ]);

    await convertSourceFiles(
      "spritesheet-grid",
      [firstPng],
      gridOptions,
      importers,
    );
    expect(importSpritesheetGrid).toHaveBeenCalledWith(
      firstPng.file,
      gridOptions,
    );

    await convertSourceFiles(
      "spritesheet-json",
      [firstPng, metadata],
      gridOptions,
      importers,
    );
    expect(importSpritesheetJson).toHaveBeenCalledWith(
      firstPng.file,
      metadata.file,
    );
  });

  it("does not call an importer for an invalid selection", async () => {
    const importers = {
      importPngSequence: vi.fn(async () => project),
      importSpritesheetGrid: vi.fn(async () => project),
      importSpritesheetJson: vi.fn(async () => project),
    };

    await expect(
      convertSourceFiles(
        "spritesheet-json",
        [png("sheet.png")],
        gridOptions,
        importers,
      ),
    ).rejects.toThrow("exactly one PNG and one JSON file");
    expect(importers.importPngSequence).not.toHaveBeenCalled();
    expect(importers.importSpritesheetGrid).not.toHaveBeenCalled();
    expect(importers.importSpritesheetJson).not.toHaveBeenCalled();
  });
});
