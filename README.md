# figma-ui

Turns Figma frames into working UI that uses the designer's own exported art, with live data
bound by name. One layout format, a generator per platform, and the tools to export and
composite the art.

| Piece               | What it does                                                                 | Used by                     |
| ------------------- | ---------------------------------------------------------------------------- | --------------------------- |
| `figma-ui generate` | Layout files → HTML/CSS surfaces and Babylon GUI JSON; `--check` for CI      | build time                  |
| `figma-ui assets`   | Raw 2x Figma exports → WebP + `manifest.json` (dedupe, masks, provenance)    | build time (Python, Pillow) |
| `figma-ui composite`| Stacks per-layer renders into one image and fits offsets to Figma's render   | build time (Python, Pillow) |
| `figma-ui/dom`      | `DomSurface`: mounts a generated surface, scales it, binds text/fills/clicks | your app (any web stack)    |
| `figma-ui/babylon`  | `loadPanel`, `findControl`, `applyNamedText` for generated Babylon panels    | your app (Babylon only)     |

Generators and asset tools run on your machine or in CI; none of that code ships in your app.
Your app imports only the runtime it uses: a React/Next or plain web project imports
`figma-ui/dom` and never pulls in Babylon (it's an optional peer dependency).

## Install

```bash
npm i -D github:mindtrustlabs/figma-ui#v0.2.0
```

Pin a tag; upgrade per project when you want a newer generator. Node 20+. The asset tools need
Python 3 with Pillow (`pip install pillow`); `cwebp` on PATH is used when present.

## Configure

`figma-ui.config.json` at the project root. Every section is optional; paths are relative to the
root.

```json
{
    "dom": {
        "inputDir": "ui/layouts",
        "outDir": "public/ui",
        "manifest": "public/ui/art/manifest.json",
        "assetUrlCss": "./art",
        "assetUrlHtml": "./public/ui/art",
        "cssVarPrefix": "ui",
        "preview": { "base": "../../", "surfaceUrl": "./public/ui", "fontsCss": "./public/fonts/fonts.css" }
    },
    "babylon": {
        "panels": { "public/ui/Brief.json": "ui/layouts/brief.figma.json" },
        "fonts": { "defaultFamily": "Inter", "map": [{ "match": "mono", "family": "Roboto Mono" }] }
    },
    "assets": {
        "rawDir": "public/ui/art/_raw",
        "outDir": "public/ui/art",
        "source": "Figma <fileKey> frame <id>, exported @2x",
        "list": { "modal-bg": { "node": "174:9845", "w": 854.29, "h": 823.06, "kind": "photo" } }
    }
}
```

- `assetUrlCss` is the art folder relative to `outDir` (CSS `url()` resolves against the
  stylesheet); `assetUrlHtml` is the art folder relative to the app page (`<img src>` resolves
  against the page).
- `cssVarPrefix` names the custom properties the runtime publishes (`--ui-scale`,
  `--ui-text-floor`); pass the same value to `DomSurface`.
- Keep `rawDir` git-ignored; commit the WebP files and the manifest.

## Commands

```bash
npx figma-ui generate            # write every configured output
npx figma-ui generate --check    # CI: fail if a committed output differs from its layout
npx figma-ui assets              # rawDir/*.png -> outDir/*.webp + manifest.json
npx figma-ui composite art/mission.recipe.json --fit
```

Generated files are never edited by hand. Rules a design can't express go at the end of a
generated stylesheet after a comment containing `(added, not Figma-authored)`; regeneration keeps
everything from that comment on.

## Runtime: web (DOM)

```ts
import { DomSurface } from "@mindtrustlabs/figma-ui/dom";

class Briefing extends DomSurface {
    constructor(private onBegin: () => void) {
        super("briefing", { baseDir: "./public/ui", zIndex: 20, cssVarPrefix: "ui" });
    }
    protected onMounted(): void {
        this.setText("brief-title", "Microchip Shortage");
        this.setRun("brief-count", "4"); // last run of "x4", keeps its styling
        this.setFillWidth("brief-meter-fill", 0.62, 223.59);
        this.onClick("brief-begin-btn", this.onBegin);
    }
}
const ui = new Briefing(() => ui.dispose());
await ui.mount();
```

`resolveUrl` adds cache-busting, `onFragment` applies a string table before `onMounted`, and
`listen` tracks listeners that `dispose()` removes. In React, mount in an effect and dispose in
its cleanup.

## Runtime: Babylon

```ts
import { loadPanel, findControl, applyNamedText } from "@mindtrustlabs/figma-ui/babylon";

const gui = await loadPanel("./public/ui/Brief.json");
applyNamedText(gui.rootContainer, (name) => strings[`ui.Brief.${name}`]);
findControl(gui, "begin")!.isHitTestVisible = true;
```

## Platforms

The layout format is the contract and has no platform in it, so a new generator can be added
without touching the Figma side. Built: HTML/CSS and Babylon GUI. Add when a project needs them:
React components; Unity (UI Toolkit UXML/USS or uGUI prefabs); Roblox (ScreenGui models). Unity
and Roblox also need a small runtime in C# or Luau, which ships as a folder copied into the
project rather than through npm.

## Docs

- [Layout format](docs/layout-format.md): the contract every generator reads.
- [Figma export guide](docs/figma-export-guide.md): getting exact values and art out of Figma,
  and the traps.
- [SKILL.md](SKILL.md): the procedure as steps an agent can follow.

## Develop

```bash
npm install
npm test                         # builds, then runs every test
UPDATE_GOLDEN=1 npm test         # accept intended output changes in test/fixtures/project/out
```

Release: bump `version`, commit, tag `vX.Y.Z`, push the tag.
