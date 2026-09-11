# White-Label Brand Setup

Customize the app's name, logo, colors, and more by creating a brand configuration.

## Quick Start

1. Copy the template files to the `brand/` root:

   ```bash
   cp brand/_template/brand.config.ts brand/brand.config.ts
   cp brand/_template/logo.svg brand/logo.svg
   cp brand/_template/custom.css brand/custom.css
   ```

2. Edit `brand/brand.config.ts` with your company details.

3. Replace `brand/logo.svg` with your logo.

4. Run the app — your brand is auto-detected:

   ```bash
   cd app && npm run dev
   ```

## Configuration Levels

| Level | What you set | Result |
|-------|-------------|--------|
| **Text only** | `name`, `tagline`, `copyright` | Custom text, default mint colors |
| **Colors + logo** | + `primaryColors`, `accentColors`, `logo` (optionally `onPrimary`, `onAccent`) | Full visual rebrand |
| **Deep customization** | + `custom.css`, `darkOverrides`, `lightOverrides` | Custom surfaces, fonts, radii |

## File Reference

| File | Purpose |
|------|---------|
| `brand.config.ts` | Main config — name, colors, logo path |
| `logo.svg` | Your logo (SVG recommended, PNG/JPG also work) |
| `custom.css` | Additional CSS overrides (fonts, radii, component styles) |

## Color Slots

A brand controls two color slots, **primary** and **accent**. Each takes a
50–900 shade scale; provide all shades or only the ones you want to override:

```typescript
primaryColors: {
  DEFAULT: '#FF6700',  // Fill of primary buttons, links, focus ring (bg-primary, text-primary)
  '500': '#FF6700',    // Mid shade; mirrors DEFAULT when only one is given
  '100': '#FFE0C2',    // Light tints (bg-primary/10 uses DEFAULT, primary-100 uses this)
  // ... add more shades as needed
},
// Optional. Omit it and white or #0a2225 is chosen by contrast against DEFAULT.
onPrimary: '#1a0d00',
```

- The hover shade of primary buttons is derived from `DEFAULT` (lighter for a
  light fill, darker for a dark one).
- The legacy `cobalt-*` / `turquoise-*` utilities are aliases of these slots,
  so older code follows your brand too.
- The stock mint uses a deeper green in the light theme; a brand `DEFAULT` is
  used as given in both themes, so pick one that works on dark and light
  surfaces (or set `onPrimary` explicitly).
- **Signal colors are not brandable.** Live/measured, Sim/estimated,
  unknown/gated and stopped/fault carry safety meaning and look the same on
  every deployment.

See `docs/brand.md` for the full token table.

## Notes

- Files in `brand/` (except `_template/`) are gitignored
- The app falls back to the default NeoDEM design when no `brand/brand.config.ts` exists
- See `app/src/brand/types.ts` for the full `BrandConfig` interface
