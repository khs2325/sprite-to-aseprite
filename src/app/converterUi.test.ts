import { describe, expect, it, vi } from "vitest";

import type { SpriteProject } from "../core/SpriteProject";
import {
  PiskelImportError,
  type PiskelImportErrorCode,
} from "../core/importers/piskel";
import type { SpritesheetGridImportOptions } from "../core/importers/spritesheetGrid";
import {
  calculateGridFromImage,
  convertSourceFiles,
  getConversionErrorMessage,
  getConversionSuccessStatus,
  getGridPreviewState,
  getSourceSelectionError,
  getSourceSelectionState,
  renderConversionState,
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

function piskel(name: string): BrowserSourceFile {
  return {
    file: new File(["{}"], name, { type: "application/octet-stream" }),
    kind: "piskel",
    text: "{}",
  };
}

function elementStub(): HTMLElement {
  const attributes = new Map<string, string>();
  return {
    hidden: false,
    inert: false,
    textContent: "",
    setAttribute(name: string, value: string): void {
      attributes.set(name, value);
    },
    getAttribute(name: string): string | null {
      return attributes.get(name) ?? null;
    },
  } as unknown as HTMLElement;
}

describe("renderConversionState", () => {
  it("exposes an accessible working state and locks conversion controls", () => {
    const activityControl = elementStub();
    const progress = elementStub();
    const status = elementStub();
    const error = elementStub();
    const dropZone = elementStub();
    const modeSelect = { disabled: false } as HTMLSelectElement;
    const fileInput = { disabled: false } as HTMLInputElement;
    const convertButton = { disabled: false } as HTMLButtonElement;
    const elements = {
      activityControl,
      progress,
      status,
      error,
      sourceControls: [modeSelect, fileInput],
      dropZone,
      convertButton,
    };

    renderConversionState(elements, {
      isWorking: true,
      canConvert: true,
      status: "Converting files browser-locally. This may take a while.",
    });

    expect(activityControl.getAttribute("aria-busy")).toBe("true");
    expect(progress.hidden).toBe(false);
    expect(status.textContent).toContain("browser-locally");
    expect(error).toMatchObject({ hidden: true, textContent: "" });
    expect(convertButton.disabled).toBe(true);
    expect(modeSelect.disabled).toBe(true);
    expect(fileInput.disabled).toBe(true);
    expect(dropZone.inert).toBe(true);
    expect(dropZone.getAttribute("aria-disabled")).toBe("true");

    renderConversionState(elements, {
      isWorking: false,
      canConvert: true,
      status: "Conversion did not complete.",
      error: "The spritesheet grid is invalid.",
    });

    expect(activityControl.getAttribute("aria-busy")).toBe("false");
    expect(progress.hidden).toBe(true);
    expect(status.textContent).toBe("Conversion did not complete.");
    expect(error).toMatchObject({
      hidden: false,
      textContent: "The spritesheet grid is invalid.",
    });
    expect(convertButton.disabled).toBe(false);
    expect(modeSelect.disabled).toBe(false);
    expect(fileInput.disabled).toBe(false);
    expect(dropZone.inert).toBe(false);
    expect(dropZone.getAttribute("aria-disabled")).toBe("false");
  });
});

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
    expect(getSourceSelectionError("piskel", [piskel("sprite.piskel")]))
      .toBeNull();
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
    expect(getSourceSelectionError("piskel", [png("sprite.png")]))
      .toContain("exactly one .piskel file");
    expect(
      getSourceSelectionError("piskel", [
        piskel("one.piskel"),
        piskel("two.piskel"),
      ]),
    ).toContain("exactly one .piskel file");
  });

  it("revalidates remaining and cleared files without a second selection state", () => {
    const files = [png("sheet.png"), json("sheet.json")];
    expect(getSourceSelectionState("spritesheet-json", files).canConvert)
      .toBe(true);
    expect(
      getSourceSelectionState("spritesheet-json", files.slice(0, 1)),
    ).toMatchObject({
      canConvert: false,
      error: expect.stringContaining("one PNG and one JSON"),
    });
    expect(getSourceSelectionState("spritesheet-json", [])).toEqual({
      canConvert: false,
      error: null,
      status: "Choose source files to begin.",
    });
  });

  it("revalidates the same selected files when import mode changes", () => {
    const files = [png("sheet.png")];
    expect(getSourceSelectionState("spritesheet-grid", files).canConvert)
      .toBe(true);
    expect(getSourceSelectionState("piskel", files).canConvert).toBe(false);
  });
});

describe("spritesheet grid preview calculations", () => {
  it("auto-calculates rows and columns and recalculates for frame-size changes", () => {
    expect(calculateGridFromImage(128, 96, 32, 32)).toEqual({
      columns: 4,
      rows: 3,
      warning: null,
    });
    expect(calculateGridFromImage(128, 96, 16, 24)).toEqual({
      columns: 8,
      rows: 4,
      warning: null,
    });
  });

  it("reports invalid frame sizes and uneven image division", () => {
    expect(calculateGridFromImage(128, 96, 0, 32)).toMatchObject({
      columns: null,
      rows: null,
      warning: expect.stringContaining("positive whole numbers"),
    });
    expect(calculateGridFromImage(130, 97, 32, 32)).toMatchObject({
      columns: 4,
      rows: 3,
      warning: expect.stringContaining("not evenly divisible"),
    });
  });

  it("updates accessible preview details for manual row and column changes", () => {
    expect(getGridPreviewState(128, 96, gridOptions)).toMatchObject({
      canConvert: false,
      description: "Grid preview: 3 columns by 2 rows, 6 frames.",
      warning: expect.stringContaining("do not cover"),
    });
    expect(getGridPreviewState(48, 32, gridOptions)).toMatchObject({
      canConvert: true,
      description: "Grid preview: 3 columns by 2 rows, 6 frames.",
      warning: null,
    });
    expect(
      getGridPreviewState(48, 32, { ...gridOptions, columns: 4 }),
    ).toMatchObject({
      canConvert: false,
      description: "Grid preview: 4 columns by 2 rows, 8 frames.",
      warning: expect.stringContaining("exceeds"),
    });
  });
});

describe("convertSourceFiles", () => {
  it("delegates every mode to the existing importer with the selected files", async () => {
    const importPngSequence = vi.fn(async () => project);
    const importPiskel = vi.fn(async () => project);
    const importSpritesheetGrid = vi.fn(async () => project);
    const importSpritesheetJson = vi.fn(async () => project);
    const importers = {
      importPngSequence,
      importPiskel,
      importSpritesheetGrid,
      importSpritesheetJson,
    };
    const firstPng = png("walk-01.png");
    const secondPng = png("walk-02.png");
    const metadata = json("walk.json");
    const piskelProject = piskel("walk.piskel");

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

    await convertSourceFiles(
      "piskel",
      [piskelProject],
      gridOptions,
      importers,
    );
    expect(importPiskel).toHaveBeenCalledWith(piskelProject.file);
  });

  it("does not call an importer for an invalid selection", async () => {
    const importers = {
      importPngSequence: vi.fn(async () => project),
      importPiskel: vi.fn(async () => project),
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
    expect(importers.importPiskel).not.toHaveBeenCalled();
    expect(importers.importSpritesheetGrid).not.toHaveBeenCalled();
    expect(importers.importSpritesheetJson).not.toHaveBeenCalled();
  });
});

describe("Piskel conversion messages", () => {
  it("reports converted frames and preserved source layers", () => {
    expect(getConversionSuccessStatus("piskel", project)).toBe(
      "Converted 1 visible Piskel frame and preserved 1 layer in an editable Aseprite timeline. Ready to download.",
    );
  });

  it.each<[PiskelImportErrorCode, string]>([
    ["invalid-json", "Piskel file is not valid JSON."],
    ["unsupported-model-version", "Unsupported Piskel modelVersion; expected integer 2."],
    ["missing-field", "Piskel object.layers is required."],
    ["invalid-dimension", "Piskel object.width must be an integer from 1 to 1024."],
    ["invalid-fps", "Piskel object.fps must be a finite number greater than zero."],
    ["hidden-frames", "Piskel object.hiddenFrames contains a duplicate frame index."],
    ["legacy-layer-layout", "Piskel layer 1 cannot contain both chunks and a legacy base64PNG field."],
    ["invalid-layer-json", "Piskel layer 1 is not valid JSON."],
    ["missing-chunks", "Piskel layer 1 must contain chunks or a legacy base64PNG field."],
    ["invalid-chunk-layout", "Piskel layer 1, chunk 1.layout must be rectangular."],
    ["frame-coverage", "Piskel layer 1 frame coverage is incomplete."],
    ["invalid-png-data-url", "Piskel layer 1, chunk 1.base64PNG must be an embedded PNG data URL."],
    ["png-dimension-mismatch", "Piskel layer 1, chunk 1.base64PNG PNG dimensions must be 4x2."],
  ])("surfaces safe %s importer detail", (code, detail) => {
    const message = getConversionErrorMessage(
      "piskel",
      new PiskelImportError(code, detail),
    );

    expect(message).toBe(
      `The Piskel file failed validation: ${detail} ` +
        "Check that it is a supported model-version-2 .piskel file.",
    );
    expect(message).not.toContain("PiskelImportError");
  });

  it("reports browser image decode detail without a stack trace", () => {
    const detail = "Could not decode PNG for Piskel layer 1, chunk 1.";
    expect(
      getConversionErrorMessage(
        "piskel",
        new PiskelImportError("browser-image-decode", detail),
      ),
    ).toBe(
      `Could not decode an embedded Piskel layer image in this browser: ${detail} ` +
        "Check that the .piskel file is complete and try again.",
    );
  });

  it("reports invalid hiddenFrames precisely without exposing a stack trace", () => {
    const detail =
      "Piskel object.hiddenFrames must contain safe integer frame indexes or strict decimal index strings.";
    const error = new PiskelImportError("hidden-frames", detail);
    error.stack = `PiskelImportError: ${detail}\n    at parseVisibleFrameIndexes (private-source.ts:1:1)`;

    const message = getConversionErrorMessage("piskel", error);

    expect(message).toBe(
      `The Piskel file failed validation: ${detail} ` +
        "Check that it is a supported model-version-2 .piskel file.",
    );
    expect(message).not.toContain("parseVisibleFrameIndexes");
    expect(message).not.toContain("private-source.ts");
  });

  it("does not expose arbitrary thrown content as an importer diagnostic", () => {
    const privateContents = '{"private pixels":"do not display"}';

    const message = getConversionErrorMessage(
      "piskel",
      new Error(`Piskel object.width must be valid. ${privateContents}`),
    );
    expect(message).toBe(
      "Could not convert the Piskel file. " +
        "Check that it is a supported model-version-2 .piskel file.",
    );
    expect(message).not.toContain(privateContents);
  });
});
