import { describe, expect, it, vi } from "vitest";

import {
  bindFileImportControl,
  type BrowserSourceFile,
} from "./fileImport";

type InputStub = {
  files: File[];
  listener?: () => void;
  value: string;
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

describe("bindFileImportControl", () => {
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
        'Unsupported file "sprite.gif". Choose PNG or JSON files only.',
    });
    expect(statusOutput.hidden).toBe(true);
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
});
