import { describe, expect, it, vi } from "vitest";

import type { SpriteProject } from "../core/SpriteProject";
import { mountLayerNamingUi } from "./layerNaming";

type Listener = () => void;

class ElementStub {
  readonly attributes = new Map<string, string>();
  readonly children: ElementStub[] = [];
  readonly listeners = new Map<string, Listener>();
  hidden = false;
  textContent = "";
  type = "";
  value = "";

  constructor(
    readonly tagName: string,
    readonly ownerDocument: DocumentStub,
  ) {}

  addEventListener(type: string, listener: EventListener): void {
    this.listeners.set(type, listener as Listener);
  }

  append(...children: ElementStub[]): void {
    this.children.push(...children);
  }

  click(): void {
    this.listeners.get("click")?.();
  }

  input(): void {
    this.listeners.get("input")?.();
  }

  removeEventListener(type: string, listener: EventListener): void {
    if (this.listeners.get(type) === listener) {
      this.listeners.delete(type);
    }
  }

  replaceChildren(...children: ElementStub[]): void {
    this.children.splice(0, this.children.length, ...children);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
}

class DocumentStub {
  createElement(tagName: string): ElementStub {
    return new ElementStub(tagName, this);
  }
}

function createProject(): SpriteProject {
  return {
    width: 1,
    height: 1,
    colorMode: "rgba",
    frames: [{ index: 0, durationMs: 100 }],
    layers: [
      { id: "line", name: "Line", visible: true, opacity: 255, cels: [] },
      { id: "color", name: "Color", visible: true, opacity: 255, cels: [] },
    ],
  };
}

function mountLayerNaming(
  onProjectChange?: (project: SpriteProject) => void,
) {
  const document = new DocumentStub();
  const container = document.createElement("main");
  const control = mountLayerNamingUi(
    container as unknown as HTMLElement,
    { onProjectChange },
  );
  const section = container.children[0];
  return {
    control,
    description: section.children[1],
    emptyState: section.children[2],
    layerList: section.children[3],
  };
}

function getLayerRow(layerList: ElementStub, position: number) {
  const row = layerList.children[position];
  return {
    error: row.children[2],
    input: row.children[0].children[0],
    label: row.children[0],
    renameButton: row.children[1],
  };
}

describe("mountLayerNamingUi", () => {
  it("shows an empty state before a project is imported", () => {
    const ui = mountLayerNaming();

    expect(ui.emptyState.hidden).toBe(false);
    expect(ui.layerList.hidden).toBe(true);
    expect(ui.layerList.children).toHaveLength(0);
    expect(ui.control.getProject()).toBeNull();
    expect(ui.description.textContent).toContain("single generated layer");
  });

  it("renames the selected layer and preserves displayed layer order", () => {
    const onProjectChange = vi.fn<(project: SpriteProject) => void>();
    const ui = mountLayerNaming(onProjectChange);
    const project = createProject();

    ui.control.setProject(project);
    const firstRow = getLayerRow(ui.layerList, 0);
    const secondRow = getLayerRow(ui.layerList, 1);
    expect([firstRow.label.textContent, secondRow.label.textContent]).toEqual([
      "Layer 1 name",
      "Layer 2 name",
    ]);
    expect([firstRow.input.value, secondRow.input.value]).toEqual([
      "Line",
      "Color",
    ]);

    secondRow.input.value = "Base color";
    secondRow.renameButton.click();

    const updated = ui.control.getProject();
    expect(updated?.layers.map((layer) => [layer.id, layer.name])).toEqual([
      ["line", "Line"],
      ["color", "Base color"],
    ]);
    expect(project.layers[1].name).toBe("Color");
    expect(onProjectChange).toHaveBeenCalledOnce();
    expect(onProjectChange).toHaveBeenCalledWith(updated);
    expect(secondRow.error.hidden).toBe(true);
  });

  it.each(["", "   "])(
    "rejects an empty layer name %j without changing the project",
    (name) => {
      const onProjectChange = vi.fn();
      const ui = mountLayerNaming(onProjectChange);
      ui.control.setProject(createProject());
      const projectBeforeEdit = ui.control.getProject();
      const row = getLayerRow(ui.layerList, 0);

      row.input.value = name;
      row.renameButton.click();

      expect(ui.control.getProject()).toBe(projectBeforeEdit);
      expect(row.error).toMatchObject({
        hidden: false,
        textContent:
          "Layer name must contain at least one non-whitespace character.",
      });
      expect(onProjectChange).not.toHaveBeenCalled();

      row.input.input();
      expect(row.error.hidden).toBe(true);
    },
  );

  it("removes row handlers when destroyed", () => {
    const ui = mountLayerNaming();
    ui.control.setProject(createProject());
    const row = getLayerRow(ui.layerList, 0);

    ui.control.destroy();

    expect(row.input.listeners.size).toBe(0);
    expect(row.renameButton.listeners.size).toBe(0);
    expect(ui.layerList.children).toHaveLength(0);
  });
});
