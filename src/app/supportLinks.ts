export type SupportLinkConfig = {
  buyMeACoffee?: string | null;
  githubSponsors?: string | null;
  koFi?: string | null;
  stripePaymentLink?: string | null;
};

export type ConfiguredSupportLink = {
  href: string;
  key: keyof SupportLinkConfig;
  label: string;
};

const SUPPORT_PROVIDERS: readonly {
  key: keyof SupportLinkConfig;
  label: string;
}[] = [
  { key: "githubSponsors", label: "GitHub Sponsors" },
  { key: "stripePaymentLink", label: "Stripe Payment Link" },
  { key: "koFi", label: "Ko-fi" },
  { key: "buyMeACoffee", label: "Buy Me a Coffee" },
];

// Configure these with public provider/profile URLs before deployment.
// Keep secrets and private account settings out of the repository.
export const DEFAULT_SUPPORT_LINKS: Required<SupportLinkConfig> = {
  buyMeACoffee: "",
  githubSponsors: "",
  koFi: "",
  stripePaymentLink: "",
};

function normalizeSupportUrl(url: string | null | undefined): string | null {
  const trimmedUrl = url?.trim() ?? "";
  return trimmedUrl.length > 0 ? trimmedUrl : null;
}

export function getConfiguredSupportLinks(
  config: SupportLinkConfig = DEFAULT_SUPPORT_LINKS,
): ConfiguredSupportLink[] {
  return SUPPORT_PROVIDERS.flatMap((provider) => {
    const href = normalizeSupportUrl(config[provider.key]);
    return href === null
      ? []
      : [{ href, key: provider.key, label: provider.label }];
  });
}

function applySafeExternalLinkAttributes(link: HTMLAnchorElement): void {
  link.target = "_blank";
  link.rel = "noopener noreferrer";
}

export function createSupportEntryPoint(
  document: Document,
  label = "Support",
): HTMLAnchorElement {
  const link = document.createElement("a");
  link.className = "support-entry-link";
  link.href = "#support";
  link.textContent = label;
  return link;
}

export function createSupportSection(
  document: Document,
  config: SupportLinkConfig = DEFAULT_SUPPORT_LINKS,
): HTMLElement {
  const section = document.createElement("section");
  const heading = document.createElement("h2");
  const freeNotice = document.createElement("p");
  const privacyNotice = document.createElement("p");
  const purpose = document.createElement("p");
  const optionalNotice = document.createElement("p");
  const linkContainer = document.createElement("div");
  const configuredLinks = getConfiguredSupportLinks(config);

  section.id = "support";
  section.className = "panel support-section";
  section.setAttribute("aria-labelledby", "support-heading");
  heading.id = "support-heading";
  heading.textContent = "Support the project";
  freeNotice.textContent =
    "Sprite to Aseprite Converter is free to use.";
  privacyNotice.textContent =
    "Conversion stays browser-local, and files are not uploaded for conversion.";
  purpose.textContent =
    "Optional donations help maintain development, docs, examples, and format support.";
  optionalNotice.textContent =
    "Support is optional, not required to use the converter, and does not unlock hidden functionality.";
  linkContainer.className = "support-links";

  if (configuredLinks.length === 0) {
    const emptyState = document.createElement("p");
    emptyState.className = "support-empty-state";
    emptyState.textContent = "Support links are not configured yet.";
    linkContainer.append(emptyState);
  } else {
    const list = document.createElement("ul");
    list.className = "support-provider-list";
    for (const provider of configuredLinks) {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.className = "support-provider-link";
      link.href = provider.href;
      link.textContent = provider.label;
      applySafeExternalLinkAttributes(link);
      item.append(link);
      list.append(item);
    }
    linkContainer.append(list);
  }

  section.append(
    heading,
    freeNotice,
    privacyNotice,
    purpose,
    optionalNotice,
    linkContainer,
  );
  return section;
}

export function createSupportFooter(document: Document): HTMLElement {
  const footer = document.createElement("footer");
  const text = document.createElement("p");
  const supportLink = createSupportEntryPoint(document);

  footer.className = "site-footer";
  text.textContent = "Built for browser-local sprite conversion. ";
  text.append(supportLink);
  footer.append(text);
  return footer;
}
