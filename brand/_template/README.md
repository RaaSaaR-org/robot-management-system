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
| **Text only** | `name`, `tagline`, `copyright` | Custom text, default blue colors |
| **Colors + logo** | + `primaryColors`, `accentColors`, `logo` | Full visual rebrand |
| **Deep customization** | + `custom.css`, `darkOverrides` | Custom CSS, fonts, glass effects |

## File Reference

| File | Purpose |
|------|---------|
| `brand.config.ts` | Main config — name, colors, logo path |
| `logo.svg` | Your logo (SVG recommended, PNG/JPG also work) |
| `custom.css` | Additional CSS overrides (fonts, component styles) |

## Color Scales

Primary and accent colors use a 50-900 shade scale. You can provide all shades or just the ones you want to override:

```typescript
primaryColors: {
  DEFAULT: '#FF6700',  // Main color (used by bg-cobalt, text-cobalt, etc.)
  '500': '#FF6700',    // Same as DEFAULT (Tailwind convention)
  '600': '#CC5200',    // Darker (hover states)
  '400': '#FF8534',    // Lighter
  // ... add more shades as needed
},
```

## Notes

- Files in `brand/` (except `_template/`) are gitignored
- The app falls back to the default NeoDEM design when no `brand/brand.config.ts` exists
- See `app/src/brand/types.ts` for the full `BrandConfig` interface
