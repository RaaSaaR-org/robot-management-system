# NeoDEM — Logo explorations

One folder, one [HTML gallery](index.html), and one growing collection of editable SVGs. The gallery shows all 28 concepts with the newest first; filter by **Newest**, **Trees**, or **Monograms** and switch between mint, ink, and white. It works offline.

The [SVG comparison sheet](overview.svg) includes the entire collection.

## New: ND and NDEM monograms

| # | Concept | Construction | Logo | Icon |
|---|---|---|---|---|
| 23 | ND / Shared stem | N and D share a vertical stroke. | [SVG](23-nd-spine-logo-mint.svg) | [SVG](23-nd-spine-icon-mint.svg) |
| 24 | ND / Cutout | One D-shaped shell with N-shaped negative space. | [SVG](24-nd-counter-logo-mint.svg) | [SVG](24-nd-counter-icon-mint.svg) |
| 25 | ND / Continuous | One open line connects both letters. | [SVG](25-nd-thread-logo-mint.svg) | [SVG](25-nd-thread-icon-mint.svg) |
| 26 | NDEM / Matrix | All four letters in a compact square. | [SVG](26-ndem-matrix-logo-mint.svg) | [SVG](26-ndem-matrix-icon-mint.svg) |
| 27 | NDEM / Ligature | A horizontal four-letter signature with shared strokes. | [SVG](27-ndem-ligature-logo-mint.svg) | [SVG](27-ndem-ligature-icon-mint.svg) |
| 28 | NDEM / Wire | A linked monoline letter construction. | [SVG](28-ndem-wire-logo-mint.svg) | [SVG](28-ndem-wire-icon-mint.svg) |

ND and NDEM are symbol explorations; the product name remains **NeoDEM**. The horizontal NDEM ligature is best used at larger sizes; ND or the compact Matrix layout provides a clearer small symbol.

## Previous: refined directions

| # | Concept | Idea | Logo | Icon |
|---|---|---|---|---|
| 19 | Nova | One N ribbon with curved returns and a taut diagonal. | [SVG](19-nova-logo-mint.svg) | [SVG](19-nova-icon-mint.svg) |
| 20 | Trine | Three folded corners frame a triangular aperture. | [SVG](20-trine-logo-mint.svg) | [SVG](20-trine-icon-mint.svg) |
| 21 | Sylva | A sculpted tree canopy above three squared roots. | [SVG](21-sylva-logo-mint.svg) | [SVG](21-sylva-icon-mint.svg) |
| 22 | Lamina | Three open bands define an architectural symbol. | [SVG](22-lamina-logo-mint.svg) | [SVG](22-lamina-icon-mint.svg) |

These four use a new wordmark outlined from Helvetica Neue Medium, with adjusted spacing. The finished SVGs need no font installation. Its reusable vector contours are stored as wordmark `3` in `concepts.json`. Earlier lettering and designs remain unchanged.

## Previous: simpler, futuristic directions

| # | Concept | Idea | Logo | Icon |
|---|---|---|---|---|
| 13 | Vector | One angular ribbon forms an N. | [SVG](13-vector-logo-mint.svg) | [SVG](13-vector-icon-mint.svg) |
| 14 | Delta | Three plain triangular planes; a simpler continuation of the Triforce-inspired direction. | [SVG](14-delta-logo-mint.svg) | [SVG](14-delta-icon-mint.svg) |
| 15 | Phase | Two offset orbital bands, separated by a diagonal seam. | [SVG](15-phase-logo-mint.svg) | [SVG](15-phase-icon-mint.svg) |
| 16 | Port | Opposed corners and one diagonal form an open N. | [SVG](16-port-logo-mint.svg) | [SVG](16-port-icon-mint.svg) |
| 17 | Origin | A tree reduced to branches, trunk, and roots in one glyph. | [SVG](17-origin-logo-mint.svg) | [SVG](17-origin-icon-mint.svg) |
| 18 | Flux | Two bent planes form a forward-moving channel. | [SVG](18-flux-logo-mint.svg) | [SVG](18-flux-icon-mint.svg) |

## Earlier concepts

All previous geometry and lettering are retained in the same gallery and folder:

01 Living circuit · 02 Signal tree · 03 Continuum · 04 Orbit core · 05 Many forms · 06 Rooted · 07 Radix · 08 Banyan · 09 Fold · 10 Threshold · 11 Common ground · 12 Triad.

## File naming and use

Every concept has six standalone SVGs, with descriptive flat filenames:

```text
13-vector-icon-mint.svg
13-vector-icon-ink.svg
13-vector-icon-white.svg
13-vector-logo-mint.svg
13-vector-logo-ink.svg
13-vector-logo-white.svg
```

Mint assets are for dark backgrounds; full mint logos use light lettering. Ink is for light backgrounds, and white is for dark backgrounds. All logo assets have transparent backgrounds, native vector geometry, and path-based lettering, without fonts, raster images, scripts, or linked dependencies.

The first five concepts retain their original `128 × 128` icon and `480 × 128` logo artboards. Later concepts use `160 × 160` icons and `558 × 160` logos. Scale proportionally; use the icon alone for small placements. The gallery includes 24, 32, and 48 pixel previews. A final 16-pixel favicon should receive an optical refinement after selection.

Keep clear space at least equal to the wordmark’s N height. The custom logo lettering does not change the product’s Archivo and Inter typography. These remain proposals; no concept has been applied to the app.

## Extend this collection

1. Add a concept to [concepts.json](concepts.json), using a unique numbered `id`, a name, description, geometry, family, batch, icon size, and wordmark reference.
2. Use `family: "tree"` for tree concepts, `"monogram"` for letter combinations, or `"abstract"` for other symbols. Use a new batch number for the next set; the largest batch becomes **Newest** automatically.
3. Author geometry in the declared icon size. The current layout supports `128` or `160`. Filled geometry inherits the variant color; explicit strokes can use the `COLOR` placeholder.
4. Run the generator from the repository root:

```sh
python3 brands/neodem/logos/generate.py
```

[generate.py](generate.py) uses only the Python standard library. It rebuilds all SVGs, the comparison sheet, and this folder’s single `index.html`. Counts, filtering, and ordering update automatically. Preserve any direct SVG editor changes in the source geometry before regenerating.
