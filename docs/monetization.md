# Monetization

The project may use optional external support links for donations. The safe
default is no configured support links and no clickable donation provider
buttons.

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
