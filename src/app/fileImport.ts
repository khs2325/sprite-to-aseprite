export const SUPPORTED_SOURCE_ACCEPT =
  ".png,.json,image/png,application/json";

export type BrowserSourceFile =
  | {
      file: File;
      kind: "png";
      bytes: ArrayBuffer;
    }
  | {
      file: File;
      kind: "json";
      text: string;
    };

export type FileImportDependencies = {
  onFilesImported?: (
    files: readonly BrowserSourceFile[],
  ) => void | Promise<void>;
};

export type FileImportControl = {
  destroy(): void;
  selectFiles(files: Iterable<File>): Promise<boolean>;
};

export type FileImportUi = FileImportControl & {
  element: HTMLElement;
};

function getSourceKind(file: File): BrowserSourceFile["kind"] | null {
  const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();

  if (extension === ".png") {
    return "png";
  }
  if (extension === ".json") {
    return "json";
  }
  return null;
}

async function readSourceFile(
  file: File,
  kind: BrowserSourceFile["kind"],
): Promise<BrowserSourceFile> {
  if (kind === "png") {
    return { file, kind, bytes: await file.arrayBuffer() };
  }
  return { file, kind, text: await file.text() };
}

export function bindFileImportControl(
  input: HTMLInputElement,
  errorOutput: HTMLElement,
  statusOutput: HTMLElement,
  dependencies: FileImportDependencies = {},
): FileImportControl {
  const clearMessages = (): void => {
    errorOutput.hidden = true;
    errorOutput.textContent = "";
    statusOutput.hidden = true;
    statusOutput.textContent = "";
  };

  const showError = (message: string): void => {
    errorOutput.textContent = message;
    errorOutput.hidden = false;
  };

  const selectFiles = async (files: Iterable<File>): Promise<boolean> => {
    clearMessages();
    const selectedFiles = Array.from(files);

    if (selectedFiles.length === 0) {
      return false;
    }

    const classifiedFiles: Array<{
      file: File;
      kind: BrowserSourceFile["kind"];
    }> = [];
    for (const file of selectedFiles) {
      const kind = getSourceKind(file);
      if (kind === null) {
        input.value = "";
        showError(
          `Unsupported file "${file.name}". Choose PNG or JSON files only.`,
        );
        return false;
      }
      classifiedFiles.push({ file, kind });
    }

    try {
      const importedFiles = await Promise.all(
        classifiedFiles.map(({ file, kind }) => readSourceFile(file, kind)),
      );
      await dependencies.onFilesImported?.(importedFiles);
      const noun = importedFiles.length === 1 ? "file" : "files";
      statusOutput.textContent = `Selected ${importedFiles.length} supported ${noun}.`;
      statusOutput.hidden = false;
      return true;
    } catch {
      input.value = "";
      showError("Could not read the selected files in this browser.");
      return false;
    }
  };

  const handleChange = (): void => {
    void selectFiles(input.files ?? []);
  };

  clearMessages();
  input.addEventListener("change", handleChange);

  return {
    destroy(): void {
      input.removeEventListener("change", handleChange);
    },
    selectFiles,
  };
}

export function mountFileImportUi(
  container: HTMLElement,
  dependencies: FileImportDependencies = {},
): FileImportUi {
  const document = container.ownerDocument;
  const element = document.createElement("section");
  const heading = document.createElement("h2");
  const supportedTypes = document.createElement("p");
  const privacyNotice = document.createElement("p");
  const input = document.createElement("input");
  const errorOutput = document.createElement("p");
  const statusOutput = document.createElement("p");

  element.setAttribute("aria-label", "Sprite source import");
  heading.textContent = "Choose sprite source files";
  supportedTypes.textContent =
    "Supported files: PNG images (.png) and JSON metadata (.json).";
  privacyNotice.textContent =
    "Your files stay in this browser and are never uploaded.";
  input.type = "file";
  input.multiple = true;
  input.accept = SUPPORTED_SOURCE_ACCEPT;
  input.setAttribute("aria-label", "Choose PNG or JSON sprite source files");
  errorOutput.setAttribute("role", "alert");
  errorOutput.setAttribute("aria-live", "assertive");
  statusOutput.setAttribute("role", "status");
  statusOutput.setAttribute("aria-live", "polite");
  element.append(
    heading,
    supportedTypes,
    privacyNotice,
    input,
    errorOutput,
    statusOutput,
  );
  container.append(element);

  const control = bindFileImportControl(
    input,
    errorOutput,
    statusOutput,
    dependencies,
  );

  return { ...control, element };
}
