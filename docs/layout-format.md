# Layout format

A layout file is a normalized transcription of one Figma frame. It is the contract between the
Figma side (transcription, exported art) and the generators. It holds design values only, never
platform details, so every generator can read it.

Rules for every layout:

- Numbers are the designer's, in design px of the frame, relative to the parent node.
- Colors are verbatim from Figma (hex or `rgba()`).
- Art is referenced by logical asset name, resolved through the asset manifest.
- Live content is named: `bind` (DOM) or the node `name` (Babylon) is how the app finds it.
- A top-level `_comment` records the Figma file key, canvas, frame and component ids, which tool
  each value came from, and every deliberate deviation from the design. Generators ignore it.

Two formats exist today: the DOM layout (`*.dom.figma.json`) is the full one; the Babylon layout
(`*.figma.json`) is a flat subset for panels built from rectangles and text. Types are in
`src/dom/layout.ts` and `src/babylon/convert.ts`.

## DOM layout (`*.dom.figma.json`)

```json
{
    "frame": { "id": "174:10720", "name": "Preview Reference", "width": 1920, "height": 1080 },
    "surface": "briefing",
    "order": 1,
    "regions": [{ "name": "modal", "x": 533, "y": 105, "w": 854, "h": 823, "anchor": { "h": "CENTER", "v": "CENTER" } }],
    "defs": {},
    "nodes": [{ "region": "modal", "name": "title", "type": "text", "bind": "brief-title", "x": 345, "y": 81, "w": 340, "text": "Mission", "font": { "family": "Englebert", "size": 33.93, "color": "#222" } }]
}
```

- `surface`: output file name and CSS class prefix. Unique per project.
- `order`: stacking across surfaces in the preview (lower renders below).
- `regions`: screen-anchored boxes. `anchor.h` is LEFT, CENTER, RIGHT or STRETCH; `anchor.v` is
  TOP, CENTER, BOTTOM or STRETCH. Both STRETCH is a full-screen cover (a modal dim). Horizontal
  STRETCH is a full-width bar: its direct children are fixed-width slots plus one `grow` slot that
  takes the slack.
- `nodes`: each names its `region`. Order is paint order, back to front, as in Figma's layer list.
- `defs` and `use` nodes mirror Figma components and instances; `over` overrides descendants by
  name (any node field, or `remove: true`).

### Node types

| type          | Draws                                                    | Key fields                                     |
| ------------- | -------------------------------------------------------- | ---------------------------------------------- |
| `frame`       | A container; flex layout when `layout` is set            | `children`, `layout`, `clip`, `ticker`         |
| `rect`        | A box                                                    | `fill`, `stroke`, `sw`, `radius`, `shadow`     |
| `image`       | A raster centered on its box at half its 2x pixel size   | `asset`, `stretch: "x"`, `state`               |
| `imagefill`   | A photo cropped into a box (object-fit cover)            | `asset`, `img` box                             |
| `texturefill` | A shared texture tiled or cropped, optionally masked     | `asset`, `tile` / `cover` / `coverAuto`, `mask`|
| `text`        | Text; a run array styles parts separately                | `text`, `font`, `bind`                         |
| `spacer`      | Empty flex space                                         | `grow`                                         |
| `use`         | An instance of a `defs` entry                            | `def`, `over`                                  |

Common fields: `x`, `y`, `w`, `h` (a number or `"fill"`), `opacity`, `rotate` (degrees clockwise),
`blend` (Figma blend mode name), `isolate`, `z`, `filter`, `interactive`, `bind`.

- Text with a numeric `h` aligns inside that box (`font.alignH`, `font.alignV`) and stays on one
  line unless the text contains a line break. Text without `h` wraps within `w`.
- Every text run renders as its own span, so the app can set one run (a count) and keep the
  others' styling.
- `interactive` frames get a pointer cursor and generic hover/press feedback. Put `image`
  children with `state: "hover"` or `state: "active"` in the frame for designed state art; author
  default, hover, pressed in that order. A frame with state art skips the generic feedback.
- Blend modes with a CSS equivalent apply live; Figma-only modes (LINEAR_DODGE and similar) must
  stay baked into the raster, and the generator warns.

## Babylon layout (`*.figma.json`)

```json
{
    "frame": { "width": 1920, "height": 1080 },
    "honorNodeFonts": true,
    "regions": [{ "name": "left", "x": 40, "y": 400, "w": 300, "h": 200, "constraints": { "h": "LEFT" } }],
    "nodes": [{ "id": "12:3", "name": "score", "type": "TEXT", "x": 60, "y": 420, "w": 200, "h": 40, "text": "0", "font": "Inter", "size": 24 }]
}
```

- Node types: RECTANGLE, ELLIPSE, TEXT (LINE is ignored). Positions are absolute in the frame.
- A node belongs to the smallest region containing its center and is positioned against it;
  nodes outside every region sit on the root.
- A region without `constraints` is pinned to the nearest edge: left/right third, top/bottom
  third, else centered.
- Text uses the config's `fonts.defaultFamily` unless `honorNodeFonts` is true, in which case
  `font` maps through `fonts.map`.

## Asset manifest

Written by `figma-ui assets`; the generators read it.

```json
{
    "_source": "Figma <fileKey> frames ..., exported @2x",
    "aliases": { "banner-red": "banner-blue" },
    "assets": {
        "mission-bg": {
            "file": "mission-bg.webp",
            "bytes": 286172,
            "sha1": "…",
            "px": [1710, 1647],
            "node": { "id": "174:9845", "w": 854.29, "h": 823.06 },
            "kind": "photo"
        }
    }
}
```

`px` is the intrinsic size of the 2x export; the generator draws it at half that. `node` traces
every shipped pixel to a Figma node.

## Changing the format

Add a field only with a generator that reads it and a test in `test/`. Never add a field that
names a platform; express what the design says, and let each generator decide how to draw it.
Bump the minor version for additions and the major version for anything that changes how an
existing layout renders.
