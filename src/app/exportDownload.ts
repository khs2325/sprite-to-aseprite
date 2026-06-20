import type { SpriteProject } from "../core/SpriteProject";
import { exportAseprite } from "../core/exporters/aseprite";
import { isValidSpriteProject } from "../core/validation";

const DEFAULT_FILENAME = "sprite-project.aseprite";
const EXPORT_ERROR_PREFIX = "Could not export the Aseprite file.";

type DownloadLink = Pick<HTMLAnchorElement, "click" | "download" | "href">;

export type ExportDownloadDependencies = {
  createDownloadLink?: () => DownloadLink;
  createObjectUrl?: (blob: Blob) => string;
  exportProject?: (project: SpriteProject) => Uint8Array;
  revokeObjectUrl?: (url: string) => void;
};

export type ExportDownloadControl = {
  destroy(): void;
  exportCurrentProject(): boolean;
  setProject(project: unknown): void;
};

export type ExportDownloadUi = ExportDownloadControl & {
  element: HTMLElement;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return `${EXPORT_ERROR_PREFIX} ${error.message}`;
  }
  return EXPORT_ERROR_PREFIX;
}

export function bindExportDownloadControl(
  button: HTMLButtonElement,
  errorOutput: HTMLElement,
  filename = DEFAULT_FILENAME,
  dependencies: ExportDownloadDependencies = {},
): ExportDownloadControl {
  let currentProject: unknown = null;

  const clearError = (): void => {
    errorOutput.hidden = true;
    errorOutput.textContent = "";
  };

  const showError = (message: string): void => {
    errorOutput.textContent = message;
    errorOutput.hidden = false;
  };

  const exportCurrentProject = (): boolean => {
    clearError();

    if (!isValidSpriteProject(currentProject)) {
      button.disabled = true;
      showError("Load a valid sprite project before exporting.");
      return false;
    }

    let objectUrl: string | undefined;
    try {
      const bytes = (dependencies.exportProject ?? exportAseprite)(
        currentProject,
      );
      const blobBuffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(blobBuffer).set(bytes);
      const blob = new Blob([blobBuffer], { type: "application/x-aseprite" });
      objectUrl = (dependencies.createObjectUrl ?? URL.createObjectURL)(blob);

      const link = (
        dependencies.createDownloadLink ?? (() => document.createElement("a"))
      )();
      link.href = objectUrl;
      link.download = filename;
      link.click();
      return true;
    } catch (error) {
      showError(getErrorMessage(error));
      return false;
    } finally {
      if (objectUrl !== undefined) {
        (dependencies.revokeObjectUrl ?? URL.revokeObjectURL)(objectUrl);
      }
    }
  };

  const handleClick = (): void => {
    exportCurrentProject();
  };

  button.disabled = true;
  clearError();
  button.addEventListener("click", handleClick);

  return {
    destroy(): void {
      button.removeEventListener("click", handleClick);
    },
    exportCurrentProject,
    setProject(project: unknown): void {
      currentProject = project;
      button.disabled = !isValidSpriteProject(project);
      clearError();
    },
  };
}

export function mountExportDownloadUi(
  container: HTMLElement,
  filename = DEFAULT_FILENAME,
  dependencies: ExportDownloadDependencies = {},
): ExportDownloadUi {
  const document = container.ownerDocument;
  const element = document.createElement("section");
  const button = document.createElement("button");
  const errorOutput = document.createElement("p");

  element.setAttribute("aria-label", "Aseprite export");
  button.type = "button";
  button.textContent = "Download .aseprite";
  errorOutput.setAttribute("role", "alert");
  errorOutput.setAttribute("aria-live", "assertive");
  element.append(button, errorOutput);
  container.append(element);

  const control = bindExportDownloadControl(
    button,
    errorOutput,
    filename,
    dependencies,
  );

  return { ...control, element };
}
