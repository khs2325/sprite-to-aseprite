import { describe, expect, it, vi } from "vitest";

import type { SpriteProject } from "../core/SpriteProject";
import type { SpritesheetGridImportOptions } from "../core/importers/spritesheetGrid";
import {
  convertSourceFiles,
  getConversionErrorMessage,
  getConversionSuccessStatus,
  getSourceSelectionError,
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
      "Converted 1 Piskel frame and preserved 1 layer in an editable Aseprite timeline. Ready to download.",
    );
  });

  it("maps validation and unsupported-format failures to safe actionable errors", () => {
    const privateContents = '{"private pixels":"do not display"}';

    const validationMessage = getConversionErrorMessage(
      "piskel",
      new Error(`Piskel object.width must be valid. ${privateContents}`),
    );
    expect(validationMessage).toContain("failed validation");
    expect(validationMessage).not.toContain(privateContents);

    const unsupportedMessage = getConversionErrorMessage(
      "piskel",
      new Error(`Unsupported Piskel field. ${privateContents}`),
    );
    expect(unsupportedMessage).toContain("unsupported format or feature");
    expect(unsupportedMessage).not.toContain(privateContents);
  });
});
