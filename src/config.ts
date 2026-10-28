/**
 * Per-project configuration, `figma-ui.config.json` at the project root. Every
 * path is relative to that root. Each section is optional: a project uses only
 * the generators it needs.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { BabylonFontOptions } from "./babylon/convert.js";

export interface DomConfig {
    /** Folder of `*.dom.figma.json` layouts. */
    inputDir: string;
    /** Folder the `<surface>.html/.css` (and preview.html) are written to. */
    outDir: string;
    /** Asset manifest written by `figma-ui assets`. */
    manifest: string;
    /** Asset folder URL as the generated stylesheet sees it (relative to outDir). */
    assetUrlCss: string;
    /** Asset folder URL as the mounted fragment sees it (relative to the app page). */
    assetUrlHtml: string;
    /** CSS custom-property prefix the runtime publishes (`--<prefix>-scale`). Default "ui". */
    cssVarPrefix?: string;
    /** Writes `preview.html` into outDir when set. */
    preview?: {
        /** `<base href>` from outDir back to where the app page is served. */
        base: string;
        fontsCss?: string;
        /** outDir as a URL relative to `base`. */
        surfaceUrl: string;
        title?: string;
    };
    /** Readability floor the preview applies (match the runtime). Default 11px below scale 0.6. */
    textFloor?: { px: number; belowScale: number };
}

export interface BabylonConfig {
    /** Output file -> layout file. */
    panels: Record<string, string>;
    fonts: BabylonFontOptions;
}

export interface AssetsConfig {
    /** Folder of raw 2x PNG exports, `<name>.png` (keep it git-ignored). */
    rawDir: string;
    /** Folder the WebP files and manifest.json are written to. */
    outDir: string;
    /** Provenance line recorded in the manifest. */
    source: string;
    /**
     * name -> Figma node and its layout size in design px. kind: "photo" (lossy
     * q85), "shape" (lossless), "mask-source" (lossless plus a derived
     * `<name>-mask` alpha mask with the drop shadow removed).
     */
    list: Record<string, { node: string; w: number; h: number; kind: "photo" | "shape" | "mask-source" }>;
    /** Logical names that share another asset's file. */
    aliases?: Record<string, string>;
}

export interface FigmaUiConfig {
    dom?: DomConfig;
    babylon?: BabylonConfig;
    assets?: AssetsConfig;
}

export const CONFIG_FILE = "figma-ui.config.json";

export function loadConfig(root: string): FigmaUiConfig {
    const file = path.join(root, CONFIG_FILE);
    if (!fs.existsSync(file)) throw new Error(`no ${CONFIG_FILE} in ${root}`);
    return JSON.parse(fs.readFileSync(file, "utf8")) as FigmaUiConfig;
}
