# NeoDEM — Visual identity

This is a brief for presentations, product materials, and design work. The full [brand and design contract](../../docs/brand.md) defines application tokens, components, interactions, and accessibility requirements.

## Direction

Use a dark matte background, mint accents, clear typography, and restrained layouts. Make the machine, workflow, or operational state the focus. Separate elements with spacing, borders, and surface changes.

Avoid decorative glows, glass effects, busy backgrounds, and science-fiction interface styling. Keep diagrams and screenshots legible at their intended display size.

## Logo

New concept explorations are available in [Logo alternatives](logos/README.md), including editable SVGs and a comparison preview. They are proposals for selection, separate from the established symbol below.

The product symbol combines an atom-like orbit with a processor. Reuse the existing [NeoDEM mark](../../app/src/components/common/NeoDEMMark.tsx) and preserve its proportions.

- Use the symbol with the **NeoDEM** wordmark for a full product signature.
- Use the symbol alone where the product name is already clear.
- Keep clear space at least equal to the height of the wordmark's “N.”
- Place the logo on a plain canvas or panel.
- Do not distort, rotate, add shadows, or recolor outside the brand palette.

## Core palette

| Role | Dark theme | Light theme |
|---|---|---|
| Background | `#080f18` | `#f5f7fa` |
| Panel | `#101d2c` | `#ffffff` |
| Primary text | `#f1f5fc` | `#0f1b2a` |
| Secondary text | `#b2c3d5` | `#3a4b5e` |
| Primary | `#b2f8df` | `#0f7a60` |
| Text on primary | `#0a2225` | `#ffffff` |
| Accent | `#a9e6d8` | `#0e7c6b` |
| Border | `#243649` | `#d5dde6` |

Use dark text on the dark theme's mint fills. For app implementation, use semantic tokens from [index.css](../../app/src/index.css), rather than copying hex values into components.

Status colors have a fixed meaning: mint for measured/live, lavender for estimated/simulated, amber for unknown/gated, and red for stopped/fault. Saturated red is reserved for stop controls and alarm surfaces. White-label branding must preserve these meanings.

## Typography

| Role | Typeface |
|---|---|
| Headlines and major titles | Archivo |
| Body text, labels, navigation, and buttons | Inter |
| Code, logs, and machine identifiers | JetBrains Mono |

Use sentence case. Keep monospace for technical output. Preserve readable contrast and hierarchy; do not rely on color alone to communicate status.

## Imagery and diagrams

- Show real robots, clear model renders, useful screenshots, and understandable workflow diagrams.
- Identify conceptual, simulated, and physical demonstrations accurately.
- Label robot models and configurations where compatibility matters.
- Use the Embodied Loop to explain how the lifecycle stages connect.
- Prefer existing product assets; review their accompanying licenses before reuse.

Asset references: [Landing assets and licenses](../../app/public/assets/landing/README.md), [robot model assets](../../app/public/assets/robots/), [product screenshots](../../app/public/screenshots/).

## White-label deployments

Implementation templates live in [`brand/_template/`](../../brand/_template/README.md). Use them for customer names, logos, and supported theme overrides. This Markdown pack documents the NeoDEM product identity; it does not configure the running app.
