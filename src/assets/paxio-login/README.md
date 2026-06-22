# Paxio Login Asset Pack

This pack contains the assets and implementation notes needed to rebuild the uploaded Paxio login screen in your app.

## Main files

- `codex_prompt.md` — paste this into Codex/Cline with the ZIP attached or after placing the assets in your repo.
- `paxio-login-prototype.html` — standalone HTML preview that shows how the assets fit together.
- `design-tokens.css` — CSS variables for colors, shadows, and font stack.
- `design-tokens.json` — same design tokens in JSON form.

## Assets

- `assets/hero-polar-bear-panel-composite.png` — left-side polar bear hero panel from the reference.
- `assets/hero-polar-bear-panel-composite.webp` — optimized web version.
- `assets/paxio-logo-horizontal.svg` — horizontal Paxio logo with byline.
- `assets/paxio-mark.svg` — Paxio icon mark.
- `assets/favicon.svg` — favicon/app icon.
- `assets/warm-wave-background.svg` — warm abstract page background.
- `assets/icons/` — form icons.

## Reference images

- `assets/reference/paxio-login-reference-16x9.png` — full target reference.
- `assets/reference/paxio-auth-card-reference.png` — main card reference.
- `assets/reference/paxio-login-form-reference.png` — right form reference.

## Recommended repo placement

Copy the `assets` folder into:

`src/assets/paxio-login/`

Then adjust imports in your login component.
