# Codex prompt: Rebuild login screen as Paxio

You are updating the existing app login screen. Recreate the attached Paxio login design using the assets in this folder.

## Brand
- Product name: Paxio
- Subtitle/byline: by Paxth Automation Solutions
- Main form heading: Sign In
- Supporting copy: Sign in with your approved email and internal access code.
- Hero text is already inside the `hero-polar-bear-panel-composite.png` asset, so do not overlay duplicate hero text unless you replace that asset with a clean background later.

## Assets
Place these files under your frontend assets folder, recommended:
`src/assets/paxio-login/`

Use:
- `hero-polar-bear-panel-composite.png` for the left visual panel.
- `paxio-logo-horizontal.svg` for the logo.
- `warm-wave-background.svg` as the page background.
- `icons/mail.svg`, `icons/lock.svg`, `icons/eye.svg`, `icons/shield.svg`, `icons/checkbox-empty.svg`.
- Keep `assets/reference/paxio-login-reference-16x9.png` only as a visual reference.

## Layout
- Overall page should be 16:9 friendly and center aligned.
- Background: warm cream/pink with very subtle wavy shapes.
- Main card: white/off-white, rounded corners around 30–32px, soft brown shadow.
- Desktop card: two columns.
  - Left: about 55%, image panel with 24px radius.
  - Right: about 45%, centered form with width around 325–340px.
- Mobile/tablet: stack image on top and form below.

## Styling
Use the colors from `design-tokens.css`.
Important values:
- Text: #303237
- Muted text: #7B706B
- Brand/rust button: #B56654 to #9C4F41
- Input border: #DAB8AE
- Page background: #F8EEE7
- Main surface: #FFFDFB

## Form requirements
Keep existing auth logic intact. Only redesign the UI.
- Email field
- Access code/password field
- Eye icon button for show/hide code if existing logic supports it
- Remember me checkbox
- Need help? link
- Sign in button
- Footer trust line: Secure access. Trusted by your team.

## Implementation rules
1. Do not remove or break existing login API/auth handlers.
2. Do not hardcode credentials.
3. Preserve existing form validation and error rendering.
4. Make sure text remains readable at all screen sizes.
5. Use semantic HTML labels and accessible button names.
6. Import SVG/PNG assets normally through the current build setup.
7. Keep the screen visually close to `assets/reference/paxio-login-reference-16x9.png`.

## Useful reference
Open `paxio-login-prototype.html` in a browser to see a standalone implementation using these assets. Port the styling into the app’s actual login component.
