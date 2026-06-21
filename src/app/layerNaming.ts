import {
  LAYER_NAME_REQUIRED_MESSAGE,
  renameLayer,
  type SpriteProject,
} from "../core/SpriteProject";

export type LayerNamingDependencies = {
  onProjectChange?(project: SpriteProject): void;
};

export type LayerNamingControl = {
  destroy(): void;
  getProject(): SpriteProject | null;
  setProject(project: SpriteProject | null): void;
};

export type LayerNamingUi = LayerNamingControl & {
  element: HTMLElement;
};

export function mountLayerNamingUi(
  container: HTMLElement,
  dependencies: LayerNamingDependencies = {},
): LayerNamingUi {
  const document = container.ownerDocument;
  const element = document.createElement("section");
  const heading = document.createElement("h2");
  const description = document.createElement("p");
  const emptyState = document.createElement("p");
  const layerList = document.createElement("ol");

  element.setAttribute("aria-label", "Layer names");
  heading.textContent = "Layer names";
  description.textContent =
    "Rename project layers before export. Flat images are imported as a single generated layer.";
  emptyState.textContent = "Import sprite files to rename project layers.";
  emptyState.setAttribute("role", "status");
  layerList.setAttribute("aria-label", "Project layers");
  element.append(heading, description, emptyState, layerList);
  container.append(element);

  let currentProject: SpriteProject | null = null;
  let cleanupRows: Array<() => void> = [];

  const clearRows = (): void => {
    cleanupRows.forEach((cleanup) => cleanup());
    cleanupRows = [];
    layerList.replaceChildren();
  };

  const control: LayerNamingControl = {
    destroy(): void {
      clearRows();
    },
    getProject(): SpriteProject | null {
      return currentProject;
    },
    setProject(project: SpriteProject | null): void {
      currentProject = project;
      clearRows();

      const layers = project?.layers ?? [];
      const isEmpty = layers.length === 0;
      emptyState.hidden = !isEmpty;
      layerList.hidden = isEmpty;

      layers.forEach((layer, position) => {
        const item = document.createElement("li");
        const label = document.createElement("label");
        const input = document.createElement("input");
        const renameButton = document.createElement("button");
        const errorOutput = document.createElement("p");

        label.textContent = `Layer ${position + 1} name`;
        input.type = "text";
        input.value = layer.name;
        renameButton.type = "button";
        renameButton.textContent = "Rename layer";
        errorOutput.setAttribute("role", "alert");
        errorOutput.hidden = true;

        const clearError = (): void => {
          errorOutput.hidden = true;
          errorOutput.textContent = "";
        };
        const handleRename = (): void => {
          if (currentProject === null) {
            return;
          }

          try {
            currentProject = renameLayer(currentProject, layer.id, input.value);
          } catch (error) {
            errorOutput.textContent =
              error instanceof RangeError
                ? error.message
                : LAYER_NAME_REQUIRED_MESSAGE;
            errorOutput.hidden = false;
            return;
          }

          clearError();
          dependencies.onProjectChange?.(currentProject);
        };

        input.addEventListener("input", clearError);
        renameButton.addEventListener("click", handleRename);
        cleanupRows.push(() => {
          input.removeEventListener("input", clearError);
          renameButton.removeEventListener("click", handleRename);
        });

        label.append(input);
        item.append(label, renameButton, errorOutput);
        layerList.append(item);
      });
    },
  };

  control.setProject(null);
  return { ...control, element };
}
