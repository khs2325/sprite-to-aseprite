# Support

Sprite to Aseprite Converter is free to use. Conversion stays browser-local:
source artwork and metadata are read in the browser and are not uploaded for
conversion.

Support links are optional. Donations help maintain development, documentation,
examples, and format support, but they are not required to use the converter
and do not unlock hidden functionality.

Contributions are welcome too. Helpful issues, compatibility notes, small test
fixtures made from original throwaway artwork, documentation fixes, and focused
pull requests all help the project.

## Configure support links

Public support URLs are configured in `src/app/supportLinks.ts`. The GitHub
Sponsors entry currently uses this configurable placeholder:

```text
https://github.com/sponsors/khs2325
```

Clear the value before deployment if the Sponsors page is not ready. Keep the
other provider placeholders empty unless their public pages are ready:

```ts
export const DEFAULT_SUPPORT_LINKS = {
  buyMeACoffee: "",
  githubSponsors: "https://github.com/sponsors/khs2325",
  koFi: "",
  stripePaymentLink: "",
};
```

Only configured, non-empty links render in the website. If every provider is set
to an empty string or `null`, the support section shows:

```text
Support links are not configured yet.
```

Use public profile or payment-page URLs only, such as a GitHub Sponsors profile,
Stripe Payment Link, Ko-fi page, or Buy Me a Coffee page. Do not commit private
payment account settings, API keys, secrets, webhook secrets, or customer data.

Payment handling must remain on the external provider pages. The converter must
not collect credit card data, add backend payment processing, or upload artwork.

## Suggested GitHub Sponsors tiers

These are optional wording ideas for GitHub Sponsors. They should not promise
private support queues, hidden app features, faster conversion, or access to
user-file processing.

- **$1/month - Pixel thanks:** helps cover maintenance time and dependency
  updates.
- **$3/month - Format friend:** supports documentation, examples, and small
  compatibility fixtures.
- **$5/month - Timeline helper:** supports continued importer/exporter testing
  and browser compatibility checks.
- **$10/month - Project backer:** supports roadmap work for documented free and
  open art-tool formats.
- **One-time support:** a simple thank-you option for users who found the
  converter useful.

Keep the tone low-pressure. Sponsorship is appreciated, but the converter stays
free and browser-local.
