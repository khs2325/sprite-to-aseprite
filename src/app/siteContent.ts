export type SitePageLink = {
  href: `#${string}`;
  id: string;
  label: string;
};

export const INFORMATION_PAGE_LINKS: readonly SitePageLink[] = [
  { href: "#about", id: "about", label: "About" },
  { href: "#contact", id: "contact", label: "Contact" },
  { href: "#privacy-policy", id: "privacy-policy", label: "Privacy Policy" },
  { href: "#terms", id: "terms", label: "Terms" },
  { href: "#guides", id: "guides", label: "Guides" },
  {
    href: "#browser-local-conversion-guide",
    id: "browser-local-conversion-guide",
    label: "Browser-local conversion guide",
  },
  {
    href: "#supported-formats-guide",
    id: "supported-formats-guide",
    label: "Supported formats guide",
  },
  {
    href: "#conversion-limitations-guide",
    id: "conversion-limitations-guide",
    label: "Conversion limitations guide",
  },
];

function createParagraph(document: Document, text: string): HTMLParagraphElement {
  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  return paragraph;
}

function createExternalLink(
  document: Document,
  href: string,
  text: string,
): HTMLAnchorElement {
  const link = document.createElement("a");
  link.href = href;
  link.textContent = text;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}

function createSection(
  document: Document,
  id: string,
  headingText: string,
  children: readonly HTMLElement[],
): HTMLElement {
  const section = document.createElement("section");
  const heading = document.createElement("h2");
  section.id = id;
  section.className = "panel site-info-section";
  section.setAttribute("aria-labelledby", `${id}-heading`);
  heading.id = `${id}-heading`;
  heading.textContent = headingText;
  section.append(heading, ...children);
  return section;
}

function createList(document: Document, items: readonly string[]): HTMLUListElement {
  const list = document.createElement("ul");
  for (const text of items) {
    const item = document.createElement("li");
    item.textContent = text;
    list.append(item);
  }
  return list;
}

export function createSiteNavigationLinks(
  document: Document,
): HTMLAnchorElement[] {
  return INFORMATION_PAGE_LINKS.map((page) => {
    const link = document.createElement("a");
    link.href = page.href;
    link.textContent = page.label;
    return link;
  });
}

export function createFutureAdPlaceholder(document: Document): HTMLElement {
  const placeholder = document.createElement("aside");
  const heading = document.createElement("h2");
  const status = document.createElement("p");
  const policy = document.createElement("p");

  placeholder.className = "future-ad-placeholder";
  placeholder.setAttribute("aria-labelledby", "future-ad-placeholder-heading");
  placeholder.setAttribute("data-ad-status", "disabled");
  heading.id = "future-ad-placeholder-heading";
  heading.textContent = "Future advertising space";
  status.textContent =
    "Ads are not active yet. No advertising script is loaded on this site.";
  policy.textContent =
    "This reserved area is intentionally separated from converter controls, downloads, support links, errors, and private file information.";
  placeholder.append(heading, status, policy);
  return placeholder;
}

export function createInformationalPages(document: Document): HTMLElement {
  const container = document.createElement("div");
  container.className = "site-info-pages";

  const about = createSection(document, "about", "About", [
    createParagraph(
      document,
      "Sprite to Aseprite Converter is a browser-based tool that rebuilds editable Aseprite timelines from supported sprite files.",
    ),
    createParagraph(
      document,
      "The converter is designed for local file processing in the browser. It does not add a backend or upload artwork for conversion.",
    ),
  ]);

  const contact = createSection(document, "contact", "Contact", [
    createParagraph(
      document,
      "For compatibility questions, bug reports, or documentation fixes, use the project repository issue tracker when it is available.",
    ),
    createParagraph(
      document,
      "Do not share private artwork in public reports. A small original test sprite is enough when a reproducible file is needed.",
    ),
  ]);

  const privacy = createSection(document, "privacy-policy", "Privacy Policy", [
    createParagraph(
      document,
      "File conversion happens in your browser. Files are not uploaded to a project server for conversion.",
    ),
    createParagraph(
      document,
      "The generated .aseprite file is created locally by browser APIs and downloaded by your browser.",
    ),
    createParagraph(
      document,
      "The site may use third-party advertising services in the future, including Google AdSense.",
    ),
    createParagraph(
      document,
      "Third-party vendors, including Google, may use cookies to serve ads.",
    ),
    createParagraph(
      document,
      "Google may use advertising cookies to serve ads based on prior visits to this site or other sites.",
    ),
    createParagraph(
      document,
      "Users can opt out of personalized advertising through Google Ads Settings.",
    ),
    (() => {
      const paragraph = document.createElement("p");
      paragraph.append(
        "Google Ads Settings: ",
        createExternalLink(
          document,
          "https://adssettings.google.com/",
          "Google Ads Settings",
        ),
      );
      return paragraph;
    })(),
    createParagraph(
      document,
      "No payment information is processed by this site. Optional support links, if configured, send users to external provider pages.",
    ),
  ]);

  const terms = createSection(document, "terms", "Terms", [
    createParagraph(
      document,
      "Use the converter only with files you have the right to process.",
    ),
    createParagraph(
      document,
      "Conversion is provided as a best-effort tool for documented supported subsets. It is not promised to be perfect, lossless, or compatible with every file variant.",
    ),
    createParagraph(
      document,
      "The site does not provide direct payment processing, backend storage, or private file hosting.",
    ),
  ]);

  const guides = createSection(document, "guides", "Guides", [
    createParagraph(
      document,
      "These guides explain how to use the converter safely without overclaiming conversion behavior.",
    ),
    createList(document, [
      "Use browser-local conversion for supported source files.",
      "Choose the import mode that matches the source format.",
      "Review the downloaded .aseprite file in Aseprite for the exact file and version you care about.",
    ]),
  ]);

  const browserLocalGuide = createSection(
    document,
    "browser-local-conversion-guide",
    "Browser-local conversion guide",
    [
      createParagraph(
        document,
        "Select source files in the browser, choose the matching import mode, convert, review the rebuilt timeline, and download the generated .aseprite file.",
      ),
      createParagraph(
        document,
        "The app reads selected files locally. It does not upload artwork to a project server for conversion.",
      ),
    ],
  );

  const supportedFormatsGuide = createSection(
    document,
    "supported-formats-guide",
    "Supported formats guide",
    [
      createParagraph(
        document,
        "Supported inputs include PNG sequence, spritesheet grid, spritesheet PNG + JSON, Piskel, OpenRaster, Pixelorama, Krita, GIF, and APNG.",
      ),
      createParagraph(
        document,
        "Project-format support preserves supported raster layer data only when the source format contains that data and the documented importer subset supports it.",
      ),
    ],
  );

  const limitationsGuide = createSection(
    document,
    "conversion-limitations-guide",
    "Conversion limitations guide",
    [
      createParagraph(
        document,
        "The converter does not claim perfect or lossless conversion.",
      ),
      createParagraph(
        document,
        "Flat images such as PNG sequences, spritesheets, GIF, and APNG do not contain original source-layer structure, so the converter cannot recover original layers from them.",
      ),
      createParagraph(
        document,
        "Unsupported source features are rejected or omitted only when documented; they are not silently presented as preserved.",
      ),
    ],
  );

  container.append(
    about,
    contact,
    privacy,
    terms,
    guides,
    browserLocalGuide,
    supportedFormatsGuide,
    limitationsGuide,
    createFutureAdPlaceholder(document),
  );
  return container;
}
