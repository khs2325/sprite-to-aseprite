# Monetization

The project may use optional external support links for donations. The GitHub
Sponsors entry is configured through `src/app/supportLinks.ts` with the public
placeholder `https://github.com/sponsors/khs2325`; clear it before deployment if
that page is not ready. Other providers remain empty until their public pages
are configured.

## Rules

- Keep the converter free to use.
- Keep conversion browser-local; do not upload artwork for conversion.
- Do not add direct payment processing to the app.
- Do not collect credit card data.
- Do not add a backend for payments.
- Do not commit private payment/account secrets.
- Use only public provider/profile URLs when configuring links.
- Keep payment handling on external provider pages.
- Keep support messaging low-pressure and honest.
- Make it clear that contributions, bug reports, docs fixes, and compatibility
  notes are welcome even without sponsorship.
- Do not place donation CTAs next to file picking, drag-and-drop, Convert,
  Download, error messages, or ad slots.

## Supported provider placeholders

`src/app/supportLinks.ts` supports optional public URLs for:

- GitHub Sponsors
- Stripe Payment Link
- Ko-fi
- Buy Me a Coffee

Empty strings and `null` values are treated as unconfigured and do not render as
clickable provider buttons.
