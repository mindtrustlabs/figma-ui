---
name: figma-ui
description: Build or update game/app UI from a Figma frame with @mindtrustlabs/figma-ui. Use when asked to pull a Figma design into the project, replace a UI with a Figma component, or regenerate UI from Figma.
---

# Figma frame to working UI

Read `node_modules/@mindtrustlabs/figma-ui/docs/figma-export-guide.md` (the traps) and
`docs/layout-format.md` (the contract) before starting. The project's settings are in
`figma-ui.config.json`.

1. From the designer's link, take the file key and node id (`12-345` → `12:345`). Read the
   tree with `get_metadata` and values with `get_figma_data`; run `get_design_context` on every
   blended, textured or semi-transparent node for opacity and tile sizes.
2. Decide what is live (text the game changes, bars, buttons) and what is static art. Name every
   live element with a `bind` (DOM) or a stable node name (Babylon).
3. Write the layout file in the configured input folder, nodes back to front, with a `_comment`
   recording the file key, canvas, frame and component ids and every deviation.
4. Export static art at 2x into the raw folder as `<logical-name>.png`. If live content sits
   between painted layers, export each static layer plus Figma's render of the whole component,
   write a recipe and run `npx figma-ui composite <recipe> --fit`; check the `-diff.png`.
   Commit the recipe.
5. Add each asset to `assets.list` in the config and run `npx figma-ui assets`.
6. Run `npx figma-ui generate`, then bind data in the app through the runtime
   (`figma-ui/dom` `DomSurface` or `figma-ui/babylon` helpers). Never edit generated files.
7. Add the project's own tests for the bindings, run `npx figma-ui generate --check`, and compare
   the preview against Figma's render (headless, audio muted). Report what you could not verify.
