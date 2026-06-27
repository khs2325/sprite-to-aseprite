import { describe, expect, it } from "vitest";

import { mountConverterUi } from "./converterUi";
import {
  createSupportSection,
  DEFAULT_SUPPORT_LINKS,
  getConfiguredSupportLinks,
  type SupportLinkConfig,
} from "./supportLinks";

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

  click(): void {
    const listener = this.listeners.get("click");
    if (typeof listener === "function") {
      listener({} as Event);
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

function mountStubbedConverter(): ElementStub {
  const document = new DocumentStub();
  const root = document.createElement("main");
  mountConverterUi(root as unknown as HTMLElement);
  return root;
}

describe("support link configuration", () => {
  it("keeps empty support links from rendering fake provider buttons", () => {
    expect(getConfiguredSupportLinks(DEFAULT_SUPPORT_LINKS)).toEqual([]);

    const section = createSupportSection(createDocument(), DEFAULT_SUPPORT_LINKS);
    const root = section as unknown as ElementStub;

    expect(findAll(root, (element) => element.className === "support-provider-link"))
      .toHaveLength(0);
    expect(getText(root)).toContain("Support links are not configured yet.");
  });

  it.each<[keyof SupportLinkConfig, string]>([
    ["githubSponsors", "GitHub Sponsors"],
    ["stripePaymentLink", "Stripe Payment Link"],
    ["koFi", "Ko-fi"],
    ["buyMeACoffee", "Buy Me a Coffee"],
  ])("renders a configured %s link", (key, label) => {
    const configuredUrl = `https://configured.example/${key}`;
    const section = createSupportSection(createDocument(), {
      [key]: configuredUrl,
    });
    const links = findAll(
      section as unknown as ElementStub,
      (element) => element.className === "support-provider-link",
    );

    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      href: configuredUrl,
      textContent: label,
    });
  });

  it("uses safe external-link attributes for configured provider links", () => {
    const section = createSupportSection(createDocument(), {
      githubSponsors: "https://configured.example/github-sponsors",
      koFi: "https://configured.example/ko-fi",
    });
    const links = findAll(
      section as unknown as ElementStub,
      (element) => element.className === "support-provider-link",
    );

    expect(links).toHaveLength(2);
    expect(links.map((link) => link.target)).toEqual(["_blank", "_blank"]);
    expect(links.map((link) => link.rel)).toEqual([
      "noopener noreferrer",
      "noopener noreferrer",
    ]);
  });

  it("states that support is optional and conversion remains browser-local", () => {
    const section = createSupportSection(createDocument(), {
      stripePaymentLink: "https://configured.example/stripe",
    });
    const text = getText(section as unknown as ElementStub);

    expect(text).toContain("Support is optional");
    expect(text).toContain("not required to use the converter");
    expect(text).toContain("does not unlock hidden functionality");
    expect(text).toContain("Conversion stays browser-local");
    expect(text).toContain("files are not uploaded for conversion");
  });
});

describe("support entry placement", () => {
  it("does not render support CTAs inside import, drop, convert, or download areas", () => {
    const root = mountStubbedConverter();
    const supportLinks = findAll(root, (element) =>
      element.className.split(/\s+/).some((className) =>
        className === "support-entry-link" ||
        className === "support-provider-link",
      ),
    );
    const importPanel = root.children[2];
    const convertPanel = root.children[3];
    const dropZone = findByClass(root, "drop-zone");
    const downloadArea = findByClass(root, "download-area");

    expect(supportLinks.map((link) => getText(link))).toEqual([
      "Support",
      "Support",
    ]);
    for (const unsafeArea of [
      importPanel,
      dropZone,
      convertPanel,
      downloadArea,
    ]) {
      expect(supportLinks.some((link) => contains(unsafeArea, link))).toBe(false);
    }
  });
});
