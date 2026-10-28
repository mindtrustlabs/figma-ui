/**
 * Builds every generated file a config describes, in memory, so `generate`
 * can write them and `generate --check` can compare them with what is on disk.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { babylonJson, type BabylonLayout } from "./babylon/convert.js";
import { domTargets, type DomConfig, type FigmaUiConfig } from "./config.js";
import { convertDom, handAuthoredTail, previewHtml } from "./dom/convert.js";
import type { DomLayout, Manifest } from "./dom/layout.js";

export interface GeneratedFile {
    /** Path relative to the project root, forward slashes. */
    path: string;
    content: string;
}

const readJson = <T>(file: string): T => JSON.parse(fs.readFileSync(file, "utf8")) as T;
const posix = (p: string): string => p.split(path.sep).join("/");

export function generateFiles(root: string, config: FigmaUiConfig, warn: (m: string) => void): GeneratedFile[] {
    const out: GeneratedFile[] = [];
    const outDirs = new Set<string>();
    for (const dom of domTargets(config)) {
        if (outDirs.has(dom.outDir)) throw new Error(`two dom targets write to ${dom.outDir}`);
        outDirs.add(dom.outDir);
        out.push(...generateDomTarget(root, dom, warn));
    }

    if (config.babylon) {
        for (const [output, input] of Object.entries(config.babylon.panels)) {
            const layout = readJson<BabylonLayout>(path.join(root, input));
            out.push({ path: posix(output), content: babylonJson(layout, config.babylon.fonts) });
        }
    }

    return out;
}

function generateDomTarget(root: string, dom: DomConfig, warn: (m: string) => void): GeneratedFile[] {
    const out: GeneratedFile[] = [];
    const prefix = dom.cssVarPrefix ?? "ui";
    const manifest = readJson<Manifest>(path.join(root, dom.manifest));
    const inputs = fs
        .readdirSync(path.join(root, dom.inputDir))
        .filter((f) => f.endsWith(".dom.figma.json"))
        .sort();
    if (inputs.length === 0) throw new Error(`no *.dom.figma.json layouts in ${dom.inputDir}`);
    const surfaces: { name: string; order: number }[] = [];
    let design: { width: number; height: number } | null = null;
    for (const f of inputs) {
        const source = posix(path.join(dom.inputDir, f));
        const layout = readJson<DomLayout>(path.join(root, source));
        design ??= { width: layout.frame.width, height: layout.frame.height };
        const { html, css } = convertDom(layout, manifest, {
            cssVarPrefix: prefix,
            assetUrlCss: dom.assetUrlCss,
            assetUrlHtml: dom.assetUrlHtml,
            source,
            warn: (m) => warn(`${source}: ${m}`),
        });
        const cssPath = posix(path.join(dom.outDir, `${layout.surface}.css`));
        const existing = path.join(root, cssPath);
        const tail = fs.existsSync(existing) ? handAuthoredTail(fs.readFileSync(existing, "utf8")) : "";
        out.push({ path: posix(path.join(dom.outDir, `${layout.surface}.html`)), content: html });
        out.push({ path: cssPath, content: tail ? `${css}\n${tail}` : css });
        surfaces.push({ name: layout.surface, order: layout.order ?? 0 });
    }
    if (dom.preview && design) {
        surfaces.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
        out.push({
            path: posix(path.join(dom.outDir, "preview.html")),
            content: previewHtml(
                surfaces.map((s) => s.name),
                {
                    base: dom.preview.base,
                    fontsCss: dom.preview.fontsCss,
                    surfaceUrl: dom.preview.surfaceUrl,
                    title: dom.preview.title ?? "figma-ui preview",
                    cssVarPrefix: prefix,
                    design,
                    textFloor: dom.textFloor ?? { px: 11, belowScale: 0.6 },
                },
            ),
        });
    }
    return out;
}

/** Files whose committed content differs from what their layout generates. */
export function staleFiles(root: string, files: GeneratedFile[]): string[] {
    return files
        .filter((f) => {
            const p = path.join(root, f.path);
            return !fs.existsSync(p) || fs.readFileSync(p, "utf8") !== f.content;
        })
        .map((f) => f.path);
}

export function writeFiles(root: string, files: GeneratedFile[]): void {
    for (const f of files) {
        const p = path.join(root, f.path);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, f.content);
    }
}
