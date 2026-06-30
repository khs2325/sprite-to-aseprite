import { describe, expect, it, vi } from "vitest";

import { KritaImportError } from "../core/importers/krita";
import { OpenRasterImportError } from "../core/importers/openraster";
import { PixeloramaImportError } from "../core/importers/pixelorama";
import { PiskelImportError } from "../core/importers/piskel";
import { PsdParserAdapterError } from "../core/importers/psd";
import { SpritesheetJsonImportError } from "../core/importers/spritesheetJson";
import {
  bindFileImportControl,
  createSourcePreviewUrlStore,
  formatFileSize,
  getSourceFilePresentation,
  getSourceKind,
  SUPPORTED_SOURCE_ACCEPT,
  type BrowserSourceFile,
} from "./fileImport";

type InputStub = {
  files: File[];
  listener?: () => void;
  value: string;
};

type DropTargetStub = {
  listeners: Partial<Record<"dragover" | "drop", EventListener>>;
};

function createInput(): HTMLInputElement & InputStub {
  const input: InputStub = { files: [], value: "selected" };
  return Object.assign(input, {
    addEventListener(_type: string, listener: () => void): void {
      input.listener = listener;
    },
    removeEventListener(_type: string, listener: () => void): void {
      if (input.listener === listener) {
        input.listener = undefined;
      }
    },
  }) as HTMLInputElement & InputStub;
}

function createOutput(): HTMLElement {
  return { hidden: false, textContent: "stale message" } as HTMLElement;
}

function createDropTarget(): HTMLElement & DropTargetStub {
  const target: DropTargetStub = { listeners: {} };
  return Object.assign(target, {
    addEventListener(type: "dragover" | "drop", listener: EventListener): void {
      target.listeners[type] = listener;
    },
    removeEventListener(
      type: "dragover" | "drop",
      listener: EventListener,
    ): void {
      if (target.listeners[type] === listener) {
        delete target.listeners[type];
      }
    },
  }) as unknown as HTMLElement & DropTargetStub;
}

function dropFiles(target: DropTargetStub, files: File[]): void {
  const event = {
    dataTransfer: { files },
    preventDefault: vi.fn(),
  } as unknown as DragEvent;
  target.listeners.drop?.(event);
  expect(event.preventDefault).toHaveBeenCalledOnce();
}

function dragFilesOver(target: DropTargetStub): void {
  const event = {
    dataTransfer: { dropEffect: "none" },
    preventDefault: vi.fn(),
  } as unknown as DragEvent;
  target.listeners.dragover?.(event);
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(event.dataTransfer?.dropEffect).toBe("copy");
}

describe("bindFileImportControl", () => {
  it("builds readable source card details without exposing source contents", () => {
    expect(getSourceFilePresentation({
      file: new File([new Uint8Array(1536)], "sheet.png"),
      kind: "png",
      bytes: new ArrayBuffer(0),
    })).toEqual({
      fileName: "sheet.png",
      fileSize: "1.5 KB",
      kind: "png",
      typeLabel: "PNG image",
    });
    expect(getSourceFilePresentation({
      file: new File(["private metadata"], "sheet.json"),
      kind: "json",
      text: "private metadata",
    })).toMatchObject({ typeLabel: "JSON metadata" });
    expect(getSourceFilePresentation({
      file: new File(["private project"], "sprite.piskel"),
      kind: "piskel",
      text: "private project",
    })).toMatchObject({ typeLabel: "Piskel project" });
    expect(getSourceFilePresentation({
      file: new File(["gif"], "sprite.gif"),
      kind: "gif",
      bytes: new ArrayBuffer(0),
    })).toMatchObject({ typeLabel: "GIF animation" });
    expect(getSourceFilePresentation({
      file: new File(["apng"], "sprite.apng"),
      kind: "apng",
      bytes: new ArrayBuffer(0),
    })).toMatchObject({ typeLabel: "APNG animation" });
    expect(getSourceFilePresentation({
      file: new File(["apng"], "sprite.png"),
      kind: "png",
      bytes: new ArrayBuffer(0),
    }, "apng")).toMatchObject({ typeLabel: "APNG animation" });
    expect(getSourceFilePresentation({
      file: new File(["ora"], "sprite.ora"),
      kind: "ora",
      bytes: new ArrayBuffer(0),
    })).toMatchObject({ typeLabel: "OpenRaster project" });
    expect(getSourceFilePresentation({
      file: new File(["pxo"], "sprite.pxo"),
      kind: "pxo",
      bytes: new ArrayBuffer(0),
    })).toMatchObject({ typeLabel: "Pixelorama project" });
    expect(getSourceFilePresentation({
      file: new File(["kra"], "sprite.kra"),
      kind: "kra",
      bytes: new ArrayBuffer(0),
    })).toMatchObject({ typeLabel: "Krita project" });
    expect(getSourceFilePresentation({
      file: new File(["psd"], "sprite.psd"),
      kind: "psd",
      bytes: new ArrayBuffer(0),
    })).toMatchObject({ typeLabel: "PSD project" });
    expect(formatFileSize(1)).toBe("1 byte");
  });

  it("reuses and revokes browser-local preview URLs", () => {
    const createObjectURL = vi.fn((file: File) => `blob:${file.name}`);
    const revokeObjectURL = vi.fn();
    const urls = createSourcePreviewUrlStore({
      createObjectURL,
      revokeObjectURL,
    });
    const first = new File(["first"], "first.png");
    const second = new File(["second"], "second.png");

    expect(urls.get(first)).toBe("blob:first.png");
    expect(urls.get(first)).toBe("blob:first.png");
    expect(urls.get(second)).toBe("blob:second.png");
    expect(createObjectURL).toHaveBeenCalledTimes(2);

    urls.retain([second]);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:first.png");

    urls.clear();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:second.png");
  });

  it("advertises and classifies .piskel files by extension for generic MIME types", () => {
    expect(SUPPORTED_SOURCE_ACCEPT.split(",")).toContain(".piskel");
    expect(
      getSourceKind({ name: "character.PISKEL", type: "" }),
    ).toBe("piskel");
    expect(
      getSourceKind({
        name: "character.piskel",
        type: "application/octet-stream",
      }),
    ).toBe("piskel");
  });

  it("advertises and classifies GIF and APNG sources", () => {
    const acceptedTypes = SUPPORTED_SOURCE_ACCEPT.split(",");
    expect(acceptedTypes).toEqual(expect.arrayContaining([
      ".gif",
      "image/gif",
      ".apng",
      "image/apng",
    ]));
    expect(getSourceKind({ name: "walk.GIF", type: "" })).toBe("gif");
    expect(getSourceKind({ name: "animation", type: "image/gif" })).toBe("gif");
    expect(getSourceKind({ name: "walk.APNG", type: "image/png" })).toBe("apng");
    expect(getSourceKind({ name: "animation", type: "image/apng" })).toBe("apng");
  });

  it("advertises and classifies OpenRaster sources", () => {
    const acceptedTypes = SUPPORTED_SOURCE_ACCEPT.split(",");
    expect(acceptedTypes).toEqual(expect.arrayContaining([
      ".ora",
      "image/openraster",
    ]));
    expect(getSourceKind({ name: "scene.ORA", type: "" })).toBe("ora");
    expect(getSourceKind({ name: "scene", type: "image/openraster" }))
      .toBe("ora");
    expect(
      getSourceKind({ name: "scene.ora", type: "application/octet-stream" }),
    ).toBe("ora");
  });

  it("advertises and classifies Pixelorama sources", () => {
    const acceptedTypes = SUPPORTED_SOURCE_ACCEPT.split(",");
    expect(acceptedTypes).toEqual(expect.arrayContaining([
      ".pxo",
      "application/x-pixelorama",
    ]));
    expect(getSourceKind({ name: "scene.PXO", type: "" })).toBe("pxo");
    expect(getSourceKind({
      name: "scene",
      type: "application/x-pixelorama",
    })).toBe("pxo");
    expect(
      getSourceKind({ name: "scene.pxo", type: "application/octet-stream" }),
    ).toBe("pxo");
  });

  it("advertises and classifies Krita sources", () => {
    const acceptedTypes = SUPPORTED_SOURCE_ACCEPT.split(",");
    expect(acceptedTypes).toEqual(expect.arrayContaining([
      ".kra",
      "application/x-krita",
      "application/x-kra",
    ]));
    expect(getSourceKind({ name: "scene.KRA", type: "" })).toBe("kra");
    expect(getSourceKind({
      name: "scene",
      type: "application/x-krita",
    })).toBe("kra");
    expect(
      getSourceKind({ name: "scene.kra", type: "application/octet-stream" }),
    ).toBe("kra");
  });

  it("advertises and classifies PSD sources", () => {
    const acceptedTypes = SUPPORTED_SOURCE_ACCEPT.split(",");
    expect(acceptedTypes).toEqual(expect.arrayContaining([
      ".psd",
      "image/vnd.adobe.photoshop",
      "image/x-photoshop",
      "application/x-photoshop",
      "application/psd",
    ]));
    expect(getSourceKind({ name: "scene.PSD", type: "" })).toBe("psd");
    expect(getSourceKind({
      name: "scene",
      type: "image/vnd.adobe.photoshop",
    })).toBe("psd");
    expect(getSourceKind({
      name: "scene",
      type: "application/x-photoshop",
    })).toBe("psd");
    expect(
      getSourceKind({ name: "scene.psd", type: "application/octet-stream" }),
    ).toBe("psd");
  });

  it("reads PNG and JSON files locally with browser File APIs", async () => {
    const input = createInput();
    const errorOutput = createOutput();
    const statusOutput = createOutput();
    const onFilesImported = vi.fn<(files: readonly BrowserSourceFile[]) => void>();
    const control = bindFileImportControl(input, errorOutput, statusOutput, {
      onFilesImported,
    });
    const png = new File([new Uint8Array([137, 80, 78, 71])], "walk-01.PNG", {
      type: "image/png",
    });
    const json = new File(['{"frames":[]}'], "walk.json", {
      type: "application/json",
    });

    expect(await control.selectFiles([png, json])).toBe(true);

    expect(onFilesImported).toHaveBeenCalledOnce();
    const imported = onFilesImported.mock.calls[0][0];
    expect(imported[0]).toMatchObject({ file: png, kind: "png" });
    if (imported[0]?.kind !== "png") {
      throw new Error("Expected the first imported file to be PNG data.");
    }
    expect(new Uint8Array(imported[0].bytes)).toEqual(
      new Uint8Array([137, 80, 78, 71]),
    );
    expect(imported[1]).toMatchObject({
      file: json,
      kind: "json",
      text: '{"frames":[]}',
    });
    expect(errorOutput.hidden).toBe(true);
    expect(statusOutput).toMatchObject({
      hidden: false,
      textContent: "Selected 2 supported files.",
    });
  });

  it("reads one Piskel file locally and shows a Piskel selection status", async () => {
    const input = createInput();
    const errorOutput = createOutput();
    const statusOutput = createOutput();
    const onFilesImported = vi.fn<(files: readonly BrowserSourceFile[]) => void>();
    const control = bindFileImportControl(input, errorOutput, statusOutput, {
      format: "piskel",
      onFilesImported,
    });
    const contents = '{"modelVersion":2,"piskel":{}}';
    const file = new File([contents], "sprite.piskel", {
      type: "application/octet-stream",
    });

    expect(await control.selectFiles([file])).toBe(true);

    expect(onFilesImported).toHaveBeenCalledOnce();
    expect(onFilesImported.mock.calls[0][0][0]).toMatchObject({
      file,
      kind: "piskel",
      text: contents,
    });
    expect(statusOutput).toMatchObject({
      hidden: false,
      textContent: "Selected 1 Piskel file. Ready to convert browser-locally.",
    });
  });

  it.each([
    ["gif", "sprite.gif", "image/gif", "Selected 1 GIF animation"],
    ["apng", "sprite.apng", "image/png", "Selected 1 APNG animation"],
    ["openraster", "sprite.ora", "image/openraster", "Selected 1 OpenRaster project"],
    ["pixelorama", "sprite.pxo", "application/x-pixelorama", "Selected 1 Pixelorama project"],
    ["krita", "sprite.kra", "application/x-krita", "Selected 1 Krita project"],
    ["psd", "sprite.psd", "image/vnd.adobe.photoshop", "Selected 1 PSD project. The supported RGB 8-bit raster-layer subset will be checked browser-locally."],
  ] as const)("reads one %s source locally", async (format, name, type, status) => {
    const statusOutput = createOutput();
    const onFilesImported = vi.fn<(files: readonly BrowserSourceFile[]) => void>();
    const control = bindFileImportControl(
      createInput(),
      createOutput(),
      statusOutput,
      { format, onFilesImported },
    );
    const file = new File([new Uint8Array([1, 2, 3])], name, { type });

    expect(await control.selectFiles([file])).toBe(true);
    expect(onFilesImported.mock.calls[0][0][0]).toMatchObject({
      file,
      kind:
        format === "openraster"
          ? "ora"
          : format === "pixelorama"
            ? "pxo"
            : format === "krita"
              ? "kra"
              : format,
    });
    expect(statusOutput.textContent).toContain(status);
  });

  it("rejects an unsupported file before reading or importing any selection", async () => {
    const input = createInput();
    const errorOutput = createOutput();
    const statusOutput = createOutput();
    const onFilesImported = vi.fn();
    const control = bindFileImportControl(input, errorOutput, statusOutput, {
      onFilesImported,
    });
    const supported = new File(["png"], "sprite.png", { type: "image/png" });
    const unsupported = new File(["text"], "notes.txt", { type: "text/plain" });
    const readSupported = vi.spyOn(supported, "arrayBuffer");

    expect(await control.selectFiles([supported, unsupported])).toBe(false);

    expect(readSupported).not.toHaveBeenCalled();
    expect(onFilesImported).not.toHaveBeenCalled();
    expect(input.value).toBe("");
    expect(errorOutput).toMatchObject({
      hidden: false,
      textContent:
        'Unsupported file "notes.txt". Choose PNG, JSON, Piskel, GIF, APNG, OpenRaster, Pixelorama, Krita, or PSD files only.',
    });
    expect(statusOutput.hidden).toBe(true);
  });

  it("shows format-specific importer errors without displaying file contents", async () => {
    const input = createInput();
    const errorOutput = createOutput();
    const statusOutput = createOutput();
    const control = bindFileImportControl(input, errorOutput, statusOutput, {
      onFilesImported: () => {
        throw new SpritesheetJsonImportError(
          "invalid-json",
          "Spritesheet metadata is not valid JSON.",
        );
      },
    });
    const privateContents = '{"privatePixelData":"do not display"}';
    const png = new File(["png"], "atlas.png", { type: "image/png" });
    const json = new File([privateContents], "atlas.json", {
      type: "application/json",
    });

    expect(await control.selectFiles([png, json])).toBe(false);

    expect(input.value).toBe("");
    expect(errorOutput).toMatchObject({
      hidden: false,
      textContent:
        "Spritesheet PNG + JSON import failed. " +
        "Spritesheet metadata is not valid JSON. " +
        "Check that the JSON frame data is valid and fits inside the PNG.",
    });
    expect(errorOutput.textContent).not.toContain(privateContents);
    expect(statusOutput.hidden).toBe(true);
  });

  it("does not expose arbitrary atlas errors or stack traces", async () => {
    const privateContents = '{"privatePixelData":"do not display"}';
    const errorOutput = createOutput();
    const error = new Error(privateContents);
    error.stack = `Error: ${privateContents}\n at private-atlas.json:1:1`;
    const control = bindFileImportControl(
      createInput(),
      errorOutput,
      createOutput(),
      {
        format: "spritesheet-json",
        onFilesImported: () => {
          throw error;
        },
      },
    );

    expect(await control.selectFiles([
      new File(["png"], "sheet.png"),
      new File([privateContents], "sheet.json"),
    ])).toBe(false);

    expect(errorOutput.textContent).toBe(
      "Spritesheet PNG + JSON import failed. " +
        "Check that the JSON frame data is valid and fits inside the PNG.",
    );
    expect(errorOutput.textContent).not.toContain(privateContents);
    expect(errorOutput.textContent).not.toContain("private-atlas.json");
  });

  it("shows SpriteProject validation messages before reporting success", async () => {
    const input = createInput();
    const errorOutput = createOutput();
    const statusOutput = createOutput();
    const control = bindFileImportControl(input, errorOutput, statusOutput, {
      format: "png-sequence",
      onFilesImported: () => ({
        width: 0,
        height: 16,
        colorMode: "rgba",
        frames: [],
        layers: [],
      }),
    });

    expect(
      await control.selectFiles([
        new File(["png"], "walk-01.png", { type: "image/png" }),
      ]),
    ).toBe(false);

    expect(errorOutput.hidden).toBe(false);
    expect(errorOutput.textContent).toContain(
      "PNG sequence import produced an invalid sprite project.",
    );
    expect(errorOutput.textContent).toContain(
      "width: Project width must be a positive integer.",
    );
    expect(errorOutput.textContent).toContain(
      "frames: Project must contain at least one frame.",
    );
    expect(errorOutput.textContent).toContain(
      "layers: Project must contain at least one layer.",
    );
    expect(errorOutput.textContent).toContain(
      "Check that every frame is a valid PNG with matching dimensions.",
    );
    expect(statusOutput.hidden).toBe(true);
  });

  it("does not expose unexpected thrown values", async () => {
    const errorOutput = createOutput();
    const control = bindFileImportControl(
      createInput(),
      errorOutput,
      createOutput(),
      {
        format: "spritesheet-grid",
        onFilesImported: () => {
          throw { fileContents: "private bytes" };
        },
      },
    );

    expect(
      await control.selectFiles([new File(["png"], "sheet.png")]),
    ).toBe(false);

    expect(errorOutput.textContent).toBe(
      "Spritesheet grid import failed. " +
        "Check the PNG dimensions and the configured frame grid values.",
    );
    expect(errorOutput.textContent).not.toContain("private bytes");
  });

  it("does not expose Piskel source contents from selection errors", async () => {
    const errorOutput = createOutput();
    const privateContents = '{"private pixels":"do not display"}';
    const control = bindFileImportControl(
      createInput(),
      errorOutput,
      createOutput(),
      {
        format: "piskel",
        onFilesImported: () => {
          throw new Error(privateContents);
        },
      },
    );

    expect(
      await control.selectFiles([
        new File([privateContents], "sprite.piskel", { type: "" }),
      ]),
    ).toBe(false);

    expect(errorOutput.textContent).toBe(
      "Piskel import failed. " +
        "Check that the file is a supported model-version-2 .piskel file.",
    );
    expect(errorOutput.textContent).not.toContain(privateContents);
  });

  it("includes safe Piskel importer detail in selection errors", async () => {
    const errorOutput = createOutput();
    const control = bindFileImportControl(
      createInput(),
      errorOutput,
      createOutput(),
      {
        format: "piskel",
        onFilesImported: () => {
          throw new PiskelImportError(
            "unsupported-model-version",
            "Unsupported Piskel modelVersion; expected integer 2.",
          );
        },
      },
    );

    expect(
      await control.selectFiles([
        new File(["{}"], "sprite.piskel", { type: "" }),
      ]),
    ).toBe(false);

    expect(errorOutput.textContent).toBe(
      "Piskel import failed. " +
        "Unsupported Piskel modelVersion; expected integer 2. " +
        "Check that the file is a supported model-version-2 .piskel file.",
    );
  });

  it("includes safe OpenRaster importer detail in selection errors", async () => {
    const errorOutput = createOutput();
    const control = bindFileImportControl(
      createInput(),
      errorOutput,
      createOutput(),
      {
        format: "openraster",
        onFilesImported: () => {
          throw new OpenRasterImportError(
            "unsupported-feature",
            "OpenRaster nested stacks and layer groups are unsupported.",
          );
        },
      },
    );

    expect(
      await control.selectFiles([
        new File(["ora"], "scene.ora", { type: "image/openraster" }),
      ]),
    ).toBe(false);

    expect(errorOutput.textContent).toBe(
      "OpenRaster project import failed. " +
        "OpenRaster nested stacks and layer groups are unsupported. " +
        "Check that the .ora file contains supported normal PNG-backed raster layer data.",
    );
  });

  it("includes safe Pixelorama importer detail in selection errors", async () => {
    const errorOutput = createOutput();
    const control = bindFileImportControl(
      createInput(),
      errorOutput,
      createOutput(),
      {
        format: "pixelorama",
        onFilesImported: () => {
          throw new PixeloramaImportError(
            "unsupported-feature",
            "Pixelorama layer 1 uses unsupported blend mode 2.",
          );
        },
      },
    );

    expect(
      await control.selectFiles([
        new File(["pxo"], "scene.pxo", { type: "application/x-pixelorama" }),
      ]),
    ).toBe(false);

    expect(errorOutput.textContent).toBe(
      "Pixelorama project import failed. " +
        "Pixelorama layer 1 uses unsupported blend mode 2. " +
        "Check that the .pxo file contains supported raster pixel layer data.",
    );
    expect(errorOutput.textContent).not.toContain("PixeloramaImportError");
  });

  it("includes safe Krita importer detail in selection errors", async () => {
    const errorOutput = createOutput();
    const control = bindFileImportControl(
      createInput(),
      errorOutput,
      createOutput(),
      {
        format: "krita",
        onFilesImported: () => {
          throw new KritaImportError(
            "unsupported-feature",
            "Krita animation timelines are unsupported.",
          );
        },
      },
    );

    expect(
      await control.selectFiles([
        new File(["kra"], "scene.kra", { type: "application/x-krita" }),
      ]),
    ).toBe(false);

    expect(errorOutput.textContent).toBe(
      "Krita project import failed. " +
        "Krita animation timelines are unsupported. " +
        "Check that the .kra file contains documented minimal 8-bit RGBA paint-layer data.",
    );
    expect(errorOutput.textContent).not.toContain("KritaImportError");
  });

  it("does not expose arbitrary Krita source details from selection errors", async () => {
    const privateMessage = "private Krita source details";
    const errorOutput = createOutput();
    const control = bindFileImportControl(
      createInput(),
      errorOutput,
      createOutput(),
      {
        format: "krita",
        onFilesImported: () => {
          throw new Error(privateMessage);
        },
      },
    );

    expect(
      await control.selectFiles([
        new File(["kra"], "scene.kra", { type: "application/x-krita" }),
      ]),
    ).toBe(false);

    expect(errorOutput.textContent).toBe(
      "Krita project import failed. " +
        "Check that the .kra file contains documented minimal 8-bit RGBA paint-layer data.",
    );
    expect(errorOutput.textContent).not.toContain(privateMessage);
  });

  it("includes safe PSD importer detail in selection errors", async () => {
    const errorOutput = createOutput();
    const control = bindFileImportControl(
      createInput(),
      errorOutput,
      createOutput(),
      {
        format: "psd",
        onFilesImported: () => {
          throw new PsdParserAdapterError(
            "unsupported-feature",
            "PSD text layers are not supported.",
          );
        },
      },
    );

    expect(
      await control.selectFiles([
        new File(["psd"], "scene.psd", {
          type: "image/vnd.adobe.photoshop",
        }),
      ]),
    ).toBe(false);

    expect(errorOutput.textContent).toBe(
      "PSD project import failed. " +
        "PSD text layers are not supported. " +
        "Check that the .psd file contains supported RGB 8-bit raster layers from the documented subset.",
    );
    expect(errorOutput.textContent).not.toContain("PsdParserAdapterError");
  });

  it("does not expose arbitrary PSD source details from selection errors", async () => {
    const privateMessage = "private PSD source details";
    const errorOutput = createOutput();
    const control = bindFileImportControl(
      createInput(),
      errorOutput,
      createOutput(),
      {
        format: "psd",
        onFilesImported: () => {
          throw new Error(privateMessage);
        },
      },
    );

    expect(
      await control.selectFiles([
        new File(["psd"], "scene.psd", {
          type: "image/vnd.adobe.photoshop",
        }),
      ]),
    ).toBe(false);

    expect(errorOutput.textContent).toBe(
      "PSD project import failed. " +
        "Check that the .psd file contains supported RGB 8-bit raster layers from the documented subset.",
    );
    expect(errorOutput.textContent).not.toContain(privateMessage);
  });

  it("uses files from the browser input change event and removes its handler", async () => {
    const input = createInput();
    const onFilesImported = vi.fn();
    const control = bindFileImportControl(
      input,
      createOutput(),
      createOutput(),
      { onFilesImported },
    );
    input.files = [new File(["{}"], "atlas.json")] as unknown as FileList &
      File[];

    input.listener?.();
    await vi.waitFor(() => expect(onFilesImported).toHaveBeenCalledOnce());

    control.destroy();
    expect(input.listener).toBeUndefined();
  });

  it("imports an accepted drop through the existing browser-local pipeline", async () => {
    const dropTarget = createDropTarget();
    const onFilesImported = vi.fn();
    const control = bindFileImportControl(
      createInput(),
      createOutput(),
      createOutput(),
      { onFilesImported },
      dropTarget,
    );
    const png = new File(["png"], "sprite.png", { type: "image/png" });

    dragFilesOver(dropTarget);
    dropFiles(dropTarget, [png]);

    await vi.waitFor(() => expect(onFilesImported).toHaveBeenCalledOnce());
    expect(onFilesImported.mock.calls[0][0][0]).toMatchObject({
      file: png,
      kind: "png",
    });

    control.destroy();
    expect(dropTarget.listeners).toEqual({});
  });

  it("imports a dropped .piskel file through the browser-local pipeline", async () => {
    const dropTarget = createDropTarget();
    const statusOutput = createOutput();
    const onFilesImported = vi.fn();
    bindFileImportControl(
      createInput(),
      createOutput(),
      statusOutput,
      { format: "piskel", onFilesImported },
      dropTarget,
    );
    const piskel = new File(["{}"], "sprite.piskel", { type: "" });

    dropFiles(dropTarget, [piskel]);

    await vi.waitFor(() => expect(onFilesImported).toHaveBeenCalledOnce());
    expect(onFilesImported.mock.calls[0][0][0]).toMatchObject({
      file: piskel,
      kind: "piskel",
      text: "{}",
    });
    expect(statusOutput.textContent).toContain("Selected 1 Piskel file");
  });

  it("rejects an unsupported drop", async () => {
    const dropTarget = createDropTarget();
    const errorOutput = createOutput();
    const onFilesImported = vi.fn();
    bindFileImportControl(
      createInput(),
      errorOutput,
      createOutput(),
      { onFilesImported },
      dropTarget,
    );

    dropFiles(dropTarget, [new File(["text"], "notes.txt")]);

    await vi.waitFor(() => expect(errorOutput.hidden).toBe(false));
    expect(errorOutput.textContent).toBe(
      'Unsupported file "notes.txt". Choose PNG, JSON, Piskel, GIF, APNG, OpenRaster, Pixelorama, Krita, or PSD files only.',
    );
    expect(onFilesImported).not.toHaveBeenCalled();
  });

  it("rejects a mixed drop before reading any accepted files", async () => {
    const dropTarget = createDropTarget();
    const errorOutput = createOutput();
    const onFilesImported = vi.fn();
    bindFileImportControl(
      createInput(),
      errorOutput,
      createOutput(),
      { onFilesImported },
      dropTarget,
    );
    const png = new File(["png"], "sprite.png");
    const readPng = vi.spyOn(png, "arrayBuffer");

    dropFiles(dropTarget, [png, new File(["text"], "notes.txt")]);

    await vi.waitFor(() => expect(errorOutput.hidden).toBe(false));
    expect(errorOutput.textContent).toBe(
      'Unsupported file "notes.txt". Choose PNG, JSON, Piskel, GIF, APNG, OpenRaster, Pixelorama, Krita, or PSD files only.',
    );
    expect(readPng).not.toHaveBeenCalled();
    expect(onFilesImported).not.toHaveBeenCalled();
  });
});
