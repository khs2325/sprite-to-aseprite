# Support

Sprite to Aseprite Converter is free to use. Conversion stays browser-local:
source artwork and metadata are read in the browser and are not uploaded for
conversion.

Support links are optional. Donations help maintain development, documentation,
examples, and format support, but they are not required to use the converter
and do not unlock hidden functionality.

## Configure support links

Public support URLs are configured in `src/app/supportLinks.ts`.

The default configuration intentionally uses empty strings:

```ts
export const DEFAULT_SUPPORT_LINKS = {
  buyMeACoffee: "",
  githubSponsors: "",
  koFi: "",
  stripePaymentLink: "",
};
```

Only configured, non-empty links render in the website. If every provider is
empty or `null`, the support section shows:

```text
Support links are not configured yet.
```

Use public profile or payment-page URLs only, such as a GitHub Sponsors profile,
Stripe Payment Link, Ko-fi page, or Buy Me a Coffee page. Do not commit private
payment account settings, API keys, secrets, webhook secrets, or customer data.

Payment handling must remain on the external provider pages. The converter must
not collect credit card data, add backend payment processing, or upload artwork.
