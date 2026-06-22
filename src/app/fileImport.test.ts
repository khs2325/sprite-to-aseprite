import { describe, expect, it, vi } from "vitest";

import {
  bindFileImportControl,
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

  it("rejects an unsupported file before reading or importing any selection", async () => {
    const input = createInput();
    const errorOutput = createOutput();
    const statusOutput = createOutput();
    const onFilesImported = vi.fn();
    const control = bindFileImportControl(input, errorOutput, statusOutput, {
      onFilesImported,
    });
    const supported = new File(["png"], "sprite.png", { type: "image/png" });
    const unsupported = new File(["gif"], "sprite.gif", { type: "image/gif" });
    const readSupported = vi.spyOn(supported, "arrayBuffer");

    expect(await control.selectFiles([supported, unsupported])).toBe(false);

    expect(readSupported).not.toHaveBeenCalled();
    expect(onFilesImported).not.toHaveBeenCalled();
    expect(input.value).toBe("");
    expect(errorOutput).toMatchObject({
      hidden: false,
      textContent:
        'Unsupported file "sprite.gif". Choose PNG, JSON, or Piskel files only.',
    });
    expect(statusOutput.hidden).toBe(true);
  });

  it("shows format-specific importer errors without displaying file contents", async () => {
    const input = createInput();
    const errorOutput = createOutput();
    const statusOutput = createOutput();
    const control = bindFileImportControl(input, errorOutput, statusOutput, {
      onFilesImported: () => {
        throw new Error("Spritesheet metadata is not valid JSON.");
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

    dropFiles(dropTarget, [new File(["gif"], "sprite.gif")]);

    await vi.waitFor(() => expect(errorOutput.hidden).toBe(false));
    expect(errorOutput.textContent).toBe(
      'Unsupported file "sprite.gif". Choose PNG, JSON, or Piskel files only.',
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
      'Unsupported file "notes.txt". Choose PNG, JSON, or Piskel files only.',
    );
    expect(readPng).not.toHaveBeenCalled();
    expect(onFilesImported).not.toHaveBeenCalled();
  });
});
