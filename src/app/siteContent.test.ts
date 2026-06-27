import { describe, expect, it } from "vitest";

import { mountConverterUi } from "./converterUi";
import {
  createFutureAdPlaceholder,
  createInformationalPages,
  createSiteNavigationLinks,
  INFORMATION_PAGE_LINKS,
} from "./siteContent";

type Listener = EventListenerOrEventListenerObject;

class ElementStub {
  readonly attributes = new Map<string, string>();
  readonly children: ElementStub[] = [];
  readonly listeners = new Map<string, Listener>();
  accept = "";
  alt = "";
  className = "";
  disabled = false;
  hidden = false;
  href = "";
  id = "";
  inert = false;
  max = "";
  min = "";
  multiple = false;
  rel = "";
  required = false;
  src = "";
  step = "";
  style = { backgroundSize: "" };
  target = "";
  textContent = "";
  type = "";
  value = "";

  constructor(
    readonly tagName: string,
    readonly ownerDocument: DocumentStub,
  ) {}

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, listener);
  }

  append(...children: (ElementStub | string)[]): void {
    for (const child of children) {
      if (typeof child === "string") {
        this.textContent += child;
      } else {
        this.children.push(child);
        if (
          this.tagName === "select" &&
          child.tagName === "option" &&
          this.value.length === 0
        ) {
          this.value = child.value;
        }
      }
    }
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  removeEventListener(type: string, listener: Listener): void {
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

function createDocument(): Document {
  return new DocumentStub() as unknown as Document;
}

function getText(element: ElementStub): string {
  return [
    element.textContent,
    ...element.children.map((child) => getText(child)),
  ].join("");
}

function findAll(
  element: ElementStub,
  predicate: (element: ElementStub) => boolean,
): ElementStub[] {
  return [
    ...(predicate(element) ? [element] : []),
    ...element.children.flatMap((child) => findAll(child, predicate)),
  ];
}

function findByClass(element: ElementStub, className: string): ElementStub {
  const match = findAll(element, (candidate) =>
    candidate.className.split(/\s+/).includes(className),
  )[0];
  if (match === undefined) {
    throw new Error(`Could not find .${className}.`);
  }
  return match;
}

function contains(parent: ElementStub, child: ElementStub): boolean {
  return parent === child || parent.children.some((node) => contains(node, child));
}

describe("AdSense readiness site content", () => {
  it("defines navigation for every required static informational section", () => {
    expect(INFORMATION_PAGE_LINKS.map((page) => page.id)).toEqual([
      "about",
      "contact",
      "privacy-policy",
      "terms",
      "guides",
      "browser-local-conversion-guide",
      "supported-formats-guide",
      "conversion-limitations-guide",
    ]);

    const links = createSiteNavigationLinks(createDocument());
    expect(links.map((link) => link.href)).toEqual([
      "#about",
      "#contact",
      "#privacy-policy",
      "#terms",
      "#guides",
      "#browser-local-conversion-guide",
      "#supported-formats-guide",
      "#conversion-limitations-guide",
    ]);
  });

  it("renders required privacy policy wording for browser-local conversion and future ads", () => {
    const pages = createInformationalPages(createDocument()) as unknown as ElementStub;
    const text = getText(pages);

    expect(text).toContain("File conversion happens in your browser.");
    expect(text).toContain(
      "Files are not uploaded to a project server for conversion.",
    );
    expect(text).toContain(
      "The site may use third-party advertising services in the future, including Google AdSense.",
    );
    expect(text).toContain(
      "Third-party vendors, including Google, may use cookies to serve ads.",
    );
    expect(text).toContain(
      "Google may use advertising cookies to serve ads based on prior visits to this site or other sites.",
    );
    expect(text).toContain(
      "Users can opt out of personalized advertising through Google Ads Settings.",
    );
    expect(text).toContain("No payment information is processed by this site.");
  });

  it("links Google Ads Settings safely without adding ad or tracking scripts", () => {
    const pages = createInformationalPages(createDocument()) as unknown as ElementStub;
    const links = findAll(
      pages,
      (element) => element.tagName === "a" && element.textContent === "Google Ads Settings",
    );

    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      href: "https://adssettings.google.com/",
      target: "_blank",
      rel: "noopener noreferrer",
    });
    expect(findAll(pages, (element) => element.tagName === "script")).toHaveLength(0);
  });

  it("renders a disabled future ad placeholder without fake ads or click prompts", () => {
    const placeholder = createFutureAdPlaceholder(createDocument()) as unknown as ElementStub;
    const text = getText(placeholder).toLowerCase();

    expect(placeholder.className).toBe("future-ad-placeholder");
    expect(placeholder.getAttribute("data-ad-status")).toBe("disabled");
    expect(text).toContain("ads are not active yet");
    expect(text).toContain("no advertising script is loaded");
    expect(text).not.toContain("click");
    expect(findAll(placeholder, (element) => element.tagName === "a")).toHaveLength(0);
    expect(findAll(placeholder, (element) => element.tagName === "button")).toHaveLength(0);
  });

  it("mounts the ad placeholder away from converter, download, support, and private-file UI", () => {
    const document = new DocumentStub();
    const root = document.createElement("main");
    mountConverterUi(root as unknown as HTMLElement);

    const placeholder = findByClass(root, "future-ad-placeholder");
    const controls = root.children[1];
    const importPanel = root.children[2];
    const convertPanel = root.children[3];
    const supportSection = root.children[5];
    const dropZone = findByClass(root, "drop-zone");
    const downloadArea = findByClass(root, "download-area");
    const selectedFiles = findByClass(root, "selected-files");

    for (const unsafeArea of [
      controls,
      importPanel,
      convertPanel,
      supportSection,
      dropZone,
      downloadArea,
      selectedFiles,
    ]) {
      expect(contains(unsafeArea, placeholder)).toBe(false);
    }
  });
});
