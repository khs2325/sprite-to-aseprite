import { describe, expect, it, vi } from "vitest";

import type { SpriteProject } from "../core/SpriteProject";
import { ApngImportError } from "../core/importers/apng";
import { GifImportError } from "../core/importers/gif";
import { OpenRasterImportError } from "../core/importers/openraster";
import { PixeloramaImportError } from "../core/importers/pixelorama";
import {
  PiskelImportError,
  type PiskelImportErrorCode,
} from "../core/importers/piskel";
import type { SpritesheetGridImportOptions } from "../core/importers/spritesheetGrid";
import { SpritesheetJsonImportError } from "../core/importers/spritesheetJson";
import {
  calculateExactFitGrid,
  calculateFrameSizeFromGrid,
  calculateGridFromImage,
  convertSourceFiles,
  createGridUpdateGuard,
  getConversionErrorMessage,
  getConversionSuccessStatus,
  getGridPreviewState,
  getSourceSelectionError,
  getSourceSelectionState,
  findNearestDivisor,
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

function gif(name: string): BrowserSourceFile {
  return {
    file: new File(["gif"], name, { type: "image/gif" }),
    kind: "gif",
    bytes: new ArrayBuffer(0),
  };
}

function apng(name: string): BrowserSourceFile {
  return {
    file: new File(["apng"], name, { type: "image/png" }),
    kind: "apng",
    bytes: new ArrayBuffer(0),
  };
}

function ora(name: string): BrowserSourceFile {
  return {
    file: new File(["ora"], name, { type: "image/openraster" }),
    kind: "ora",
    bytes: new ArrayBuffer(0),
  };
}

function pxo(name: string): BrowserSourceFile {
  return {
    file: new File(["pxo"], name, { type: "application/x-pixelorama" }),
    kind: "pxo",
    bytes: new ArrayBuffer(0),
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
    expect(getSourceSelectionError("gif", [gif("sprite.gif")])).toBeNull();
    expect(getSourceSelectionError("apng", [apng("sprite.apng")])).toBeNull();
    expect(getSourceSelectionError("apng", [png("sprite.png")])).toBeNull();
    expect(getSourceSelectionError("openraster", [ora("scene.ora")]))
      .toBeNull();
    expect(getSourceSelectionError("pixelorama", [pxo("scene.pxo")]))
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
    expect(getSourceSelectionError("gif", [png("sprite.png")]))
      .toContain("exactly one .gif file");
    expect(getSourceSelectionError("gif", [gif("one.gif"), gif("two.gif")]))
      .toContain("exactly one .gif file");
    expect(getSourceSelectionError("apng", [gif("sprite.gif")]))
      .toContain("exactly one .apng");
    expect(getSourceSelectionError("apng", [
      apng("one.apng"),
      apng("two.apng"),
    ])).toContain("exactly one .apng");
    expect(getSourceSelectionError("openraster", [png("sprite.png")]))
      .toContain("exactly one .ora file");
    expect(getSourceSelectionError("openraster", [
      ora("one.ora"),
      ora("two.ora"),
    ])).toContain("exactly one .ora file");
    expect(getSourceSelectionError("pixelorama", [png("sprite.png")]))
      .toContain("exactly one .pxo file");
    expect(getSourceSelectionError("pixelorama", [
      pxo("one.pxo"),
      pxo("two.pxo"),
    ])).toContain("exactly one .pxo file");
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

  it("disables single-file project conversion after removing or clearing the file", () => {
    expect(getSourceSelectionState("gif", [gif("sprite.gif")]).canConvert)
      .toBe(true);
    expect(getSourceSelectionState("gif", []).canConvert).toBe(false);
    expect(getSourceSelectionState("apng", [apng("sprite.apng")]).canConvert)
      .toBe(true);
    expect(getSourceSelectionState("apng", []).canConvert).toBe(false);
    expect(getSourceSelectionState("openraster", [ora("scene.ora")]).canConvert)
      .toBe(true);
    expect(getSourceSelectionState("openraster", []).canConvert).toBe(false);
    expect(getSourceSelectionState("pixelorama", [pxo("scene.pxo")]).canConvert)
      .toBe(true);
    expect(getSourceSelectionState("pixelorama", []).canConvert).toBe(false);
  });

  it("revalidates the same selected files when import mode changes", () => {
    const files = [png("sheet.png")];
    expect(getSourceSelectionState("spritesheet-grid", files).canConvert)
      .toBe(true);
    expect(getSourceSelectionState("piskel", files).canConvert).toBe(false);
    expect(getSourceSelectionState("pixelorama", files).canConvert).toBe(false);
  });
});

describe("spritesheet grid preview calculations", () => {
  it("preserves exact frame divisors and snaps frame edits to nearest divisors", () => {
    expect(calculateGridFromImage(128, 96, 32, 32)).toEqual({
      columns: 4,
      rows: 3,
      warning: null,
    });
    expect(calculateGridFromImage(384, 256, 30, 32)).toEqual({
      columns: 12,
      rows: 8,
      warning: null,
    });
    expect(calculateGridFromImage(384, 256, 32, 30)).toEqual({
      columns: 12,
      rows: 8,
      warning: null,
    });
  });

  it("snaps row and column edits and updates exact frame dimensions", () => {
    expect(calculateFrameSizeFromGrid(384, 256, 12, 8)).toEqual({
      frameHeight: 32,
      frameWidth: 32,
      warning: null,
    });
    expect(
      calculateExactFitGrid(
        384,
        256,
        { ...gridOptions, columns: 10, rows: 8 },
        "grid-size",
      ).values,
    ).toEqual({
      columns: 12,
      frameHeight: 32,
      frameWidth: 32,
      rows: 8,
    });
    expect(calculateFrameSizeFromGrid(384, 250, 12, 8)).toEqual({
      frameHeight: 25,
      frameWidth: 32,
      warning: null,
    });
  });

  it("chooses the larger divisor when nearest divisors are tied", () => {
    expect(findNearestDivisor(384, 10)).toBe(12);
    expect(findNearestDivisor(256, 10)).toBe(8);
  });

  it("returns normalized controls and an adjustment status", () => {
    expect(
      calculateExactFitGrid(
        384,
        256,
        { ...gridOptions, frameWidth: 30, frameHeight: 30 },
        "frame-size",
      ),
    ).toEqual({
      message: "Adjusted to exact fit: 12 columns × 8 rows, 32 × 32 px each.",
      values: {
        columns: 12,
        frameHeight: 32,
        frameWidth: 32,
        rows: 8,
      },
    });
    expect(
      calculateExactFitGrid(
        384,
        256,
        { ...gridOptions, columns: 12, rows: 8, frameWidth: 32, frameHeight: 32 },
        "grid-size",
      ).message,
    ).toBe("Exact fit: 12 columns × 8 rows, 32 × 32 px each.");
  });

  it("rejects invalid inputs without producing unsafe grid values", () => {
    expect(calculateGridFromImage(128, 96, 0, 32)).toMatchObject({
      columns: null,
      rows: null,
      warning: expect.stringContaining("positive whole numbers"),
    });
    for (const invalidValue of [
      0,
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      const result = calculateExactFitGrid(
        128,
        96,
        { ...gridOptions, columns: invalidValue },
        "grid-size",
      );
      expect(result.values).toBeNull();
      expect(result.message).toContain("Enter a valid");
    }
    expect(
      getGridPreviewState(128, 96, { ...gridOptions, frameWidth: 0 }),
    ).toMatchObject({
      canConvert: false,
      description:
        "Grid preview unavailable: choose one PNG and enter valid grid settings.",
    });
  });

  it("updates accessible preview details for manual row and column changes", () => {
    expect(getGridPreviewState(128, 96, gridOptions)).toMatchObject({
      canConvert: false,
      description:
        "Grid preview: 3 columns × 2 rows, 6 frames, 16 × 16 px each.",
      warning: expect.stringContaining("do not cover"),
    });
    expect(getGridPreviewState(48, 32, gridOptions)).toMatchObject({
      canConvert: true,
      description:
        "Grid preview: 3 columns × 2 rows, 6 frames, 16 × 16 px each.",
      details: {
        frameSize: "Frame size: 16 × 16 px",
        gridSize: "Grid: 3 columns × 2 rows",
        imageSize: "Image size: 48 × 32 px",
        totalFrames: "Total frames: 6",
      },
      warning: null,
    });
    expect(
      getGridPreviewState(48, 32, { ...gridOptions, columns: 4 }),
    ).toMatchObject({
      canConvert: false,
      description:
        "Grid preview: 4 columns × 2 rows, 8 frames, 16 × 16 px each.",
      warning: expect.stringContaining("exceeds"),
    });
  });

  it("shows an exact summary without an uneven warning after snapping", () => {
    const calculation = calculateExactFitGrid(
      384,
      250,
      { ...gridOptions, columns: 12, rows: 8 },
      "grid-size",
    );
    expect(calculation.values).toEqual({
      columns: 12,
      frameHeight: 25,
      frameWidth: 32,
      rows: 10,
    });
    const preview = getGridPreviewState(384, 250, {
      ...gridOptions,
      ...calculation.values!,
    });
    expect(preview.warning).toBeNull();
    expect(preview.description).toBe(
      "Grid preview: 12 columns × 10 rows, 120 frames, 32 × 25 px each.",
    );
    expect(preview.details).toEqual({
      frameSize: "Frame size: 32 × 25 px",
      gridSize: "Grid: 12 columns × 10 rows",
      imageSize: "Image size: 384 × 250 px",
      totalFrames: "Total frames: 120",
    });
  });

  it("recalculates dimensions and summary when the selected image changes", () => {
    const firstGrid = calculateExactFitGrid(
      384,
      256,
      { ...gridOptions, frameWidth: 32, frameHeight: 32 },
      "image-change",
    );
    const secondGrid = calculateExactFitGrid(
      320,
      160,
      { ...gridOptions, frameWidth: 32, frameHeight: 32 },
      "image-change",
    );
    expect(firstGrid.values).toMatchObject({ columns: 12, rows: 8 });
    expect(secondGrid.values).toMatchObject({ columns: 10, rows: 5 });

    expect(
      getGridPreviewState(320, 160, {
        ...gridOptions,
        ...secondGrid.values!,
      }).description,
    ).toBe("Grid preview: 10 columns × 5 rows, 50 frames, 32 × 32 px each.");
  });

  it("blocks nested grid updates to prevent recursive input loops", () => {
    const guard = createGridUpdateGuard();
    const updates: string[] = [];

    expect(guard.run("frame-size", () => {
      updates.push("frame-size");
      expect(guard.run("grid-size", () => updates.push("grid-size")))
        .toBe(false);
    })).toBe(true);
    expect(updates).toEqual(["frame-size"]);
    expect(guard.run("grid-size", () => updates.push("later"))).toBe(true);
    expect(updates).toEqual(["frame-size", "later"]);
  });
});

describe("convertSourceFiles", () => {
  it("delegates every mode to the existing importer with the selected files", async () => {
    const importPngSequence = vi.fn(async () => project);
    const importApng = vi.fn(async () => project);
    const importGif = vi.fn(async () => project);
    const importOpenRaster = vi.fn(async () => project);
    const importPixelorama = vi.fn(async () => project);
    const importPiskel = vi.fn(async () => project);
    const importSpritesheetGrid = vi.fn(async () => project);
    const importSpritesheetJson = vi.fn(async () => project);
    const importers = {
      importApng,
      importGif,
      importOpenRaster,
      importPixelorama,
      importPngSequence,
      importPiskel,
      importSpritesheetGrid,
      importSpritesheetJson,
    };
    const firstPng = png("walk-01.png");
    const secondPng = png("walk-02.png");
    const metadata = json("walk.json");
    const piskelProject = piskel("walk.piskel");
    const gifAnimation = gif("walk.gif");
    const apngAnimation = apng("walk.apng");
    const openRasterProject = ora("scene.ora");
    const pixeloramaProject = pxo("scene.pxo");

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

    await convertSourceFiles("gif", [gifAnimation], gridOptions, importers);
    expect(importGif).toHaveBeenCalledWith(gifAnimation.file);

    await convertSourceFiles("apng", [apngAnimation], gridOptions, importers);
    expect(importApng).toHaveBeenCalledWith(apngAnimation.file);

    const pngContainer = png("walk.png");
    await convertSourceFiles("apng", [pngContainer], gridOptions, importers);
    expect(importApng).toHaveBeenCalledWith(pngContainer.file);

    await convertSourceFiles(
      "openraster",
      [openRasterProject],
      gridOptions,
      importers,
    );
    expect(importOpenRaster).toHaveBeenCalledWith(openRasterProject.file);

    await convertSourceFiles(
      "pixelorama",
      [pixeloramaProject],
      gridOptions,
      importers,
    );
    expect(importPixelorama).toHaveBeenCalledWith(pixeloramaProject.file);
  });

  it("does not call an importer for an invalid selection", async () => {
    const importers = {
      importApng: vi.fn(async () => project),
      importGif: vi.fn(async () => project),
      importOpenRaster: vi.fn(async () => project),
      importPixelorama: vi.fn(async () => project),
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
    expect(importers.importGif).not.toHaveBeenCalled();
    expect(importers.importApng).not.toHaveBeenCalled();
    expect(importers.importOpenRaster).not.toHaveBeenCalled();
    expect(importers.importPixelorama).not.toHaveBeenCalled();
  });
});

describe("Pixelorama conversion messages", () => {
  const layeredProject: SpriteProject = {
    ...project,
    frames: [
      { index: 0, durationMs: 100 },
      { index: 1, durationMs: 150 },
    ],
    layers: [
      project.layers[0],
      {
        id: "shadow",
        name: "Shadow",
        visible: true,
        opacity: 128,
        cels: [],
      },
    ],
  };

  it("reports supported frames and raster layers without overclaiming unsupported features", () => {
    expect(getConversionSuccessStatus("pixelorama", layeredProject)).toBe(
      "Converted supported Pixelorama frames and raster layers into an editable Aseprite timeline with 2 frames and 2 preserved layers. Ready to download.",
    );
  });

  it("shows importer-authored diagnostics without exposing stack traces", () => {
    const error = new PixeloramaImportError(
      "unsupported-feature",
      "Pixelorama layer 1 uses unsupported blend mode 2.",
    );
    error.stack = "private-pixelorama-stack";

    expect(getConversionErrorMessage("pixelorama", error)).toBe(
      "Pixelorama import failed: Pixelorama layer 1 uses unsupported blend mode 2.",
    );
    expect(getConversionErrorMessage("pixelorama", error)).not.toContain(
      "private-pixelorama-stack",
    );
  });

  it("does not expose arbitrary Pixelorama errors", () => {
    const privateMessage = "private Pixelorama source details";

    const message = getConversionErrorMessage(
      "pixelorama",
      new Error(privateMessage),
    );

    expect(message).toBe(
      "Pixelorama import failed: Check that the .pxo file contains supported raster pixel layer data.",
    );
    expect(message).not.toContain(privateMessage);
  });
});

describe("OpenRaster conversion messages", () => {
  const layeredProject: SpriteProject = {
    ...project,
    layers: [
      project.layers[0],
      {
        id: "detail",
        name: "Detail",
        visible: true,
        opacity: 255,
        cels: [],
      },
    ],
  };

  it("reports supported raster layer data without overclaiming unsupported features", () => {
    expect(getConversionSuccessStatus("openraster", layeredProject)).toBe(
      "Converted supported OpenRaster raster layer data into an editable Aseprite timeline with 1 frame and 2 preserved layers. Ready to download.",
    );
  });

  it("shows importer-authored diagnostics without exposing stack traces", () => {
    const error = new OpenRasterImportError(
      "unsupported-feature",
      "OpenRaster nested stacks and layer groups are unsupported.",
    );
    error.stack = "private-openraster-stack";

    expect(getConversionErrorMessage("openraster", error)).toBe(
      "OpenRaster import failed: OpenRaster nested stacks and layer groups are unsupported.",
    );
    expect(getConversionErrorMessage("openraster", error)).not.toContain(
      "private-openraster-stack",
    );
  });

  it("does not expose arbitrary OpenRaster errors", () => {
    const privateMessage = "private OpenRaster source details";

    const message = getConversionErrorMessage(
      "openraster",
      new Error(privateMessage),
    );

    expect(message).toBe(
      "OpenRaster import failed: Check that the .ora file contains supported normal PNG-backed raster layer data.",
    );
    expect(message).not.toContain(privateMessage);
  });
});

describe("GIF and APNG conversion messages", () => {
  const animatedProject: SpriteProject = {
    ...project,
    frames: [
      { index: 0, durationMs: 100 },
      { index: 1, durationMs: 80 },
    ],
  };

  it("includes the imported frame count in success messages", () => {
    expect(getConversionSuccessStatus("gif", animatedProject)).toBe(
      "Converted 2 GIF frames into an editable Aseprite timeline. Ready to download.",
    );
    expect(getConversionSuccessStatus("apng", animatedProject)).toBe(
      "Converted 2 APNG frames into an editable Aseprite timeline. Ready to download.",
    );
  });

  it("shows importer-authored diagnostics without exposing stack traces", () => {
    const gifError = new GifImportError("unsupported-version", "Only GIF89a files are supported.");
    gifError.stack = "private-gif-stack";
    const apngError = new ApngImportError("not-animated", "PNG does not contain APNG animation chunks.");
    apngError.stack = "private-apng-stack";

    expect(getConversionErrorMessage("gif", gifError)).toBe(
      "GIF import failed: Only GIF89a files are supported.",
    );
    expect(getConversionErrorMessage("apng", apngError)).toBe(
      "APNG import failed: PNG does not contain APNG animation chunks.",
    );
    expect(getConversionErrorMessage("gif", gifError)).not.toContain("stack");
    expect(getConversionErrorMessage("apng", apngError)).not.toContain("stack");
  });

  it("does not expose arbitrary GIF or APNG errors", () => {
    const privateMessage = "private source details";
    expect(getConversionErrorMessage("gif", new Error(privateMessage)))
      .not.toContain(privateMessage);
    expect(getConversionErrorMessage("apng", new Error(privateMessage)))
      .not.toContain(privateMessage);
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

describe("spritesheet JSON conversion messages", () => {
  it("surfaces importer-authored format diagnostics without a stack trace", () => {
    const detail =
      "Phaser Multi-Atlas metadata is recognized but not supported because it contains nested atlas pages.";
    const error = new SpritesheetJsonImportError(
      "unsupported-variant",
      detail,
    );
    error.stack = `SpritesheetJsonImportError: ${detail}\n at private-atlas.json:1:1`;

    const message = getConversionErrorMessage("spritesheet-json", error);

    expect(message).toBe(detail);
    expect(message).not.toContain("private-atlas.json");
    expect(message).not.toContain("SpritesheetJsonImportError");
  });

  it("does not expose arbitrary atlas error content", () => {
    const privateContents = '{"privatePixelData":"do not display"}';

    const message = getConversionErrorMessage(
      "spritesheet-json",
      new Error(privateContents),
    );

    expect(message).toBe(
      "Could not convert the spritesheet atlas. " +
        "Check that the JSON uses a supported root-level frame layout.",
    );
    expect(message).not.toContain(privateContents);
  });
});
