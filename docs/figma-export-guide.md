# Getting UI out of Figma

How to turn a Figma frame into a layout file and shipped art whose pixels are the designer's own
exports, never a hand recreation, and the traps that cost days when missed.

## Rules

- Every raster comes from a Figma export and traces to a node id in the manifest.
- Every layout number (position, size, color, shadow, type) is transcribed verbatim.
- Mock backgrounds and presentation chrome around a component (sample game shots, cursors,
  annotation lines, slide titles) are never transcribed. A placement frame's position and dim
  are real; the picture behind them is not.
- Fonts are the design's fonts, self-hosted with the app; never loaded from a CDN at runtime.

## Figma MCP servers

Use both; each sees things the other misses.

| Server                                   | Tools                                                                 | Use for                                                                     |
| ---------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Framelink `figma-developer-mcp`          | `get_figma_data`, `download_figma_images`                             | Node tree (geometry, text, fills, effects); PNG/SVG exports                 |
| Official Figma MCP                       | `get_metadata`, `get_design_context`, `get_screenshot`, `use_figma`, `download_assets` | Layer opacity, blend, exact tile sizes, hidden canvases, 2x export URLs |

Register Framelink with a personal access token from an environment variable; never commit or
log it:

```bash
claude mcp add figma -- npx -y figma-developer-mcp --figma-api-key="$FIGMA_API_KEY" --stdio
```

From a "Copy link to selection" URL: the file key is the segment after `/design/`; the node id is
the `node-id` parameter with the dash turned into a colon (`12-345` → `12:345`).

## Procedure

1. **Read the frame.** Take Figma's render first (`get_design_context` with a screenshot, or
   `get_screenshot`): it is the target the result must match, never an asset. Then
   `get_metadata` for the tree, `get_figma_data` for values, `get_design_context` on every
   blended, textured or semi-transparent node. When `get_design_context` flags a response as
   sparse, don't transcribe from it: match its child node ids to the render and request the
   visible children in one parallel batch. Large results land in files; parse them rather than
   reading them whole.
2. **Transcribe** into a layout file (see [layout-format.md](layout-format.md)), back to front.
   Record ids, sources and deviations in `_comment`.
3. **Export art at 2x** into the git-ignored raw folder, `<logical-name>.png`. Raw files are
   never edited. Export a shared asset once and alias it. Prefer CSS for flat shapes Figma
   describes exactly (solid rects, simple borders).
4. **Composite** when live content sits between painted layers (below).
5. `figma-ui assets`, then `figma-ui generate`.
6. **Bind** live data in the app by `bind` / control name. Never edit generated markup.
7. **Verify** against Figma's own render (below).

## Compositing layered art

A modal whose text, bars and buttons sit between paper layers can't be one export: the export
bakes in the text. Export each static layer at 2x instead and stack them:

1. Export Figma's render of the whole component as the reference (`full.png`).
2. Export every static layer (not text, bars or buttons) at 2x.
3. Write a recipe listing the layers back to front with their layout positions × 2, each
   layer's blend mode (`multiply` where Figma says MULTIPLY), and `exclude` boxes over the live
   content (pad them a few px).
4. `figma-ui composite <recipe> --fit`. It nudges each layer up to 3 px to match the reference
   and writes the fitted positions back. The `-diff.png` should show differences only inside the
   excluded boxes.
5. Commit the recipe next to the layout so the art can be rebuilt; the raw layers stay
   git-ignored.

Button states work the same way: composite each state's non-text layers into
`<name>-default/-hover/-pressed` and use `state` art in the layout.

## Traps

1. **Framelink drops layer opacity.** A 20% multiply texture transcribes as `blend: "MULTIPLY"`
   with no opacity and ships four times too dark. Read `opacity` from `get_design_context` for
   every blended or texture layer.
2. **Tile size is intrinsic px × `scalingFactor`**, not a DPR guess. A 740 px texture at
   scalingFactor 0.928 tiles at 687 design px; `get_design_context` prints it as `bg-size-[687px]`.
3. **A group exported on its own renders a few px differently than inside its parent.** Never
   trust isolated renders for placement; fit against the parent's render.
4. **Exports include effect padding.** A render with a drop shadow is larger than the node box;
   the generator centers the raster on the box, so don't crop or offset it by hand.
5. **`get_screenshot` is 1x only.** For 2x art use `download_figma_images` (pngScale 2) or
   `download_assets` with scale 2 and fetch the returned URL.
6. **Some canvases are hidden from the page listing** (wireframe and hand-off pages). Resolve
   explicit node ids from the designer's link.
7. **Blend modes without a CSS equivalent** (Linear Dodge, Linear Burn, Vivid Light...) can't be
   live; leave those layers baked into the art.
8. **Text boxes are sized to the designer's sample text.** Widen them for live copy and note it
   in `_comment`; a single-line label never wraps.
9. **`use_figma` responses are capped (about 48 KB).** Don't stream images through it; get an
   export URL instead.
10. **Figma's own `figma-design-to-code` skill says to use only the assets
    `get_design_context` downloads.** Those are 1x temporary URLs written into hand-made code.
    Here art comes from the 2x exports in the raw folder and ships through `figma-ui assets`;
    follow this guide's export step instead.

## Verify against Figma's render

Numbers matching is not enough. Serve the generated `preview.html` (not `file://`), screenshot
it at the design size with DPR 1 in a headless browser with audio muted, and compare against
Figma's 1x render of the same frame: mean and spread of luminance on plain areas, grid periods
of textures, edge positions. Keep the comparison images out of git and attach them to the pull
request.

## Checklist

- [ ] Every raster's untouched raw export exists; every shipped asset has a manifest entry with a
      real node id; shared art is an alias.
- [ ] `_comment` names the file key, canvas and frame, and lists every deviation.
- [ ] Colors, shadows, gradients and type match the Figma data verbatim.
- [ ] Every blended or textured layer has its Figma opacity.
- [ ] Composited art has a committed recipe and a clean diff outside the live content.
- [ ] Fonts are the design's, self-hosted.
- [ ] A render comparison at the design size was done.
- [ ] Every visible static asset in the render has a non-empty shipped file, sits in the right
      layer slot, is referenced by the generated output, and renders at the node's size and
      position. One missing, swapped or misproportioned asset fails the frame.
