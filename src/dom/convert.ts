/**
 * DOM generator: a `DomLayout` becomes an HTML fragment and a stylesheet.
 *
 * RESPONSIVE MODEL (landscape, uniform scale): the runtime publishes one scale
 * s = min(vw / designW, vh / designH) as `--<prefix>-scale`. Every region is an
 * absolutely positioned outer box sized design-size * s, holding an inner box
 * authored in design px with `transform: scale(s)`. Rasters keep both
 * dimensions from one intrinsic size, so art never stretches unevenly (except
 * fills marked `stretch: "x"`). STRETCH regions lay their children out as a
 * real-width flex row whose `grow` child takes the slack. `--<prefix>-text-floor`
 * lifts small text toward a readable size at small scales, capped at 1.35x.
 *
 * STACKING: nodes carry no z-index and paint in source order, which is Figma's
 * rule (a later sibling is on top). Author every node list back to front.
 *
 * Deterministic: the same layout, manifest and options give byte-identical output.
 */

import type { DomLayout, LayoutNode, Manifest, ManifestAsset, NodeOverride, Region } from "./layout.js";

export interface DomOptions {
    /** CSS custom-property prefix: `--<prefix>-scale`, `--<prefix>-text-floor`. */
    cssVarPrefix: string;
    /** Asset folder as a CSS `url()` sees it (relative to the generated stylesheet). */
    assetUrlCss: string;
    /** Asset folder as an `<img src>` in the mounted fragment sees it (relative to the page). */
    assetUrlHtml: string;
    /** Path of the layout file, for the generated-file header. */
    source: string;
    /** Receives warnings (a blend mode with no CSS equivalent). */
    warn?: (message: string) => void;
}

export const round = (n: number): number => Math.round(n * 100) / 100;
const px = (n: number): string => `${round(n)}px`;

const esc = (s: string): string =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const slug = (s: string): string =>
    s
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "n";

/**
 * Figma blend modes with a 1:1 CSS `mix-blend-mode` keyword. Figma-only modes
 * (LINEAR_DODGE, LINEAR_BURN, VIVID_LIGHT, ...) are absent on purpose: there is
 * no faithful live blend, so those layers stay baked in their raster.
 */
export const FIGMA_BLEND_TO_CSS: Readonly<Record<string, string>> = {
    NORMAL: "normal",
    PASS_THROUGH: "normal",
    MULTIPLY: "multiply",
    SCREEN: "screen",
    OVERLAY: "overlay",
    DARKEN: "darken",
    LIGHTEN: "lighten",
    COLOR_DODGE: "color-dodge",
    COLOR_BURN: "color-burn",
    HARD_LIGHT: "hard-light",
    SOFT_LIGHT: "soft-light",
    DIFFERENCE: "difference",
    EXCLUSION: "exclusion",
    HUE: "hue",
    SATURATION: "saturation",
    COLOR: "color",
    LUMINOSITY: "luminosity",
};

/**
 * The `mix-blend-mode` to emit for a Figma blend mode, or null to emit nothing
 * (normal modes and Figma-only modes). Case-insensitive; accepts CSS spelling.
 */
export function figmaBlendToCss(blend: string | undefined): string | null {
    if (!blend) return null;
    const key = blend
        .trim()
        .toUpperCase()
        .replace(/[\s-]+/g, "_");
    const css = FIGMA_BLEND_TO_CSS[key];
    if (!css || css === "normal") return null;
    return css;
}

/** Opens the hand-authored rules at the end of a generated stylesheet; kept across regenerations. */
export const HAND_AUTHORED_MARKER = "(added, not Figma-authored)";

/** The hand-authored tail of an existing stylesheet, or "" when it has none. */
export function handAuthoredTail(existingCss: string): string {
    const marker = existingCss.indexOf(HAND_AUTHORED_MARKER);
    if (marker < 0) return "";
    return existingCss.slice(existingCss.lastIndexOf("/*", marker));
}

export class DomConverter {
    private css: string[] = [];
    private classCounts = new Map<string, number>();
    private readonly prefix: string;
    private readonly scaleVar: string;
    private readonly floorVar: string;

    constructor(
        private readonly layout: DomLayout,
        private readonly manifest: Manifest,
        private readonly opts: DomOptions,
    ) {
        this.prefix = layout.surface;
        this.scaleVar = `--${opts.cssVarPrefix}-scale`;
        this.floorVar = `--${opts.cssVarPrefix}-text-floor`;
    }

    private get designW(): number {
        return this.layout.frame.width;
    }

    private get designH(): number {
        return this.layout.frame.height;
    }

    private cls(name: string): string {
        const base = `${this.prefix}-${slug(name)}`;
        const n = this.classCounts.get(base) ?? 0;
        this.classCounts.set(base, n + 1);
        return n === 0 ? base : `${base}-${n + 1}`;
    }

    private asset(name: string): ManifestAsset {
        const resolved = this.manifest.aliases?.[name] ?? name;
        // "<base>-mask" also resolves through the alias of its base.
        const m =
            this.manifest.assets[resolved] ??
            this.manifest.assets[`${this.manifest.aliases?.[name.replace(/-mask$/, "")] ?? ""}-mask`];
        if (!m) throw new Error(`asset not in manifest: ${name}`);
        return m;
    }

    private requireAsset(node: LayoutNode): ManifestAsset {
        if (!node.asset) throw new Error(`node "${node.name}" (${node.type}) has no asset`);
        return this.asset(node.asset);
    }

    private rule(sel: string, decls: string[]): void {
        if (decls.length === 0) return;
        this.css.push(`${sel} {\n    ${decls.join(";\n    ")};\n}`);
    }

    /** Font size with the capped readability floor. */
    private fontSize(size: number): string {
        const cap = round(size * 1.35);
        return `max(${px(size)}, min(calc(var(${this.floorVar}, 0px) / var(${this.scaleVar}, 1)), ${px(cap)}))`;
    }

    private textDecls(node: LayoutNode): string[] {
        const f = node.font;
        if (!f) throw new Error(`text node "${node.name}" has no font`);
        const d = [
            `font-family: "${f.family}"`,
            `font-size: ${this.fontSize(f.size)}`,
            `font-weight: ${f.weight ?? 400}`,
            `color: ${f.color}`,
        ];
        if (f.case === "upper") d.push("text-transform: uppercase");
        if (f.lineHeight) d.push(`line-height: ${f.lineHeight}`);
        if (f.alignH) d.push(`text-align: ${f.alignH}`);
        return d;
    }

    /** Position, size and chrome declarations shared by every node type. */
    private boxDecls(node: LayoutNode, inFlex: boolean): string[] {
        const d: string[] = [];
        if (!inFlex) {
            d.push("position: absolute", `left: ${px(node.x ?? 0)}`, `top: ${px(node.y ?? 0)}`);
        } else {
            d.push("position: relative", "flex: none");
            if (node.grow) d.push("flex-grow: 1");
            if (node.selfAlign === "stretch") d.push("align-self: stretch");
        }
        if (node.w === "fill") d.push(inFlex ? "align-self: stretch" : "width: 100%");
        else if (typeof node.w === "number") d.push(`width: ${px(node.w)}`);
        if (node.h === "fill") d.push("height: 100%");
        else if (typeof node.h === "number") d.push(`height: ${px(node.h)}`);
        if (node.opacity != null) d.push(`opacity: ${node.opacity}`);
        if (node.clip) d.push("overflow: hidden");
        if (node.fill) d.push(`background: ${node.fill}`);
        if (node.stroke) d.push(`border: ${px(node.sw ?? 1)} solid ${node.stroke}`, "box-sizing: border-box");
        if (node.radius) d.push(`border-radius: ${node.radius}`);
        if (node.shadow) d.push(`box-shadow: ${node.shadow}`);
        if (node.filter) d.push(`filter: ${node.filter}`);
        if (node.z != null) d.push(`z-index: ${node.z}`);
        if (node.rotate) d.push(`transform: rotate(${round(node.rotate)}deg)`);
        if (node.state) d.push("visibility: hidden");
        if (node.isolate) d.push("isolation: isolate");
        if (node.blend) {
            const css = figmaBlendToCss(node.blend);
            if (css) {
                d.push(`mix-blend-mode: ${css}`);
            } else {
                const up = node.blend.trim().toUpperCase();
                if (up !== "NORMAL" && up !== "PASS_THROUGH") {
                    this.opts.warn?.(
                        `node "${node.name}" blend "${node.blend}" has no CSS mix-blend-mode; keep it baked in the raster asset.`,
                    );
                }
            }
        }
        if (node.interactive) d.push("pointer-events: auto", "cursor: pointer");
        return d;
    }

    private bindAttr(node: LayoutNode): string {
        return node.bind ? ` data-bind="${esc(node.bind)}"` : "";
    }

    private img(a: ManifestAsset): string {
        return `<img src="${this.opts.assetUrlHtml}/${a.file}" width="${a.px[0]}" height="${a.px[1]}" alt="" draggable="false">`;
    }

    /**
     * A raster: wrapper at the node's layout box, image centered on it at
     * intrinsic-size / 2. Figma renders pad for effects, so the image can be
     * larger (or smaller) than the box; centering places the art exactly.
     */
    private emitImage(node: LayoutNode, inFlex: boolean, indent: string): string {
        const a = this.requireAsset(node);
        const iw = a.px[0] / 2;
        const ih = a.px[1] / 2;
        const c = this.cls(node.name);
        this.rule(`.${c}`, this.boxDecls(node, inFlex));
        const imgDecls =
            node.stretch === "x"
                ? ["position: absolute", "inset: 0", "width: 100%", "height: 100%", "max-width: none"]
                : [
                      "position: absolute",
                      `left: calc(50% - ${px(iw / 2)})`,
                      `top: calc(50% - ${px(ih / 2)})`,
                      `width: ${px(iw)}`,
                      `height: ${px(ih)}`,
                      "max-width: none",
                  ];
        this.rule(`.${c} > img`, imgDecls);
        if (node.state) this.rule(`:${node.state} > .${c}`, ["visibility: visible"]);
        const stretchAttr = node.stretch ? ` data-stretch="${node.stretch}"` : "";
        const stateAttr = node.state ? ` data-state="${node.state}"` : "";
        return `${indent}<div class="${c}"${this.bindAttr(node)}${stretchAttr}${stateAttr} data-name="${esc(node.name)}">${this.img(a)}</div>\n`;
    }

    /** A photo in a (rounded) box, object-fit cover. */
    private emitImagefill(node: LayoutNode, inFlex: boolean, indent: string): string {
        const a = this.requireAsset(node);
        const b = node.img;
        if (!b) throw new Error(`imagefill "${node.name}" has no img box`);
        const c = this.cls(node.name);
        this.rule(`.${c}`, this.boxDecls(node, inFlex));
        const d = [
            "position: absolute",
            `left: ${px(b.x)}`,
            `top: ${px(b.y)}`,
            `width: ${px(b.w)}`,
            `height: ${px(b.h)}`,
            "object-fit: cover",
            "max-width: none",
        ];
        if (b.radius) d.push(`border-radius: ${b.radius}`);
        if (b.stroke) d.push(`border: ${px(b.sw ?? 1)} solid ${b.stroke}`, "box-sizing: border-box");
        this.rule(`.${c} > img`, d);
        return `${indent}<div class="${c}"${this.bindAttr(node)} data-name="${esc(node.name)}">${this.img(a)}</div>\n`;
    }

    /** A shared texture (exported once) tiled or cropped, optionally clipped by a mask render. */
    private emitTexturefill(node: LayoutNode, inFlex: boolean, indent: string): string {
        const a = this.requireAsset(node);
        const c = this.cls(node.name);
        const d = this.boxDecls(node, inFlex);
        d.push(`background-image: url("${this.opts.assetUrlCss}/${a.file}")`);
        if (node.tile) {
            d.push(
                `background-size: ${px(node.tile.size)} ${px(node.tile.size)}`,
                "background-repeat: repeat",
                `background-position: ${px(node.tile.x)} ${px(node.tile.y)}`,
            );
        } else if (node.cover) {
            d.push(
                `background-size: ${px(node.cover.bgW)} ${px(node.cover.bgH)}`,
                "background-repeat: no-repeat",
                `background-position: ${px(node.cover.bgX)} ${px(node.cover.bgY)}`,
            );
        } else if (node.coverAuto) {
            d.push("background-size: cover", "background-repeat: no-repeat", "background-position: center");
        }
        if (node.mask) {
            const m = this.asset(node.mask.asset);
            const mw = m.px[0] / 2;
            const mh = m.px[1] / 2;
            // Center the padded mask render on the mask shape's layout box.
            const mx = node.mask.x - (mw - node.mask.w) / 2;
            const my = node.mask.y - (mh - node.mask.h) / 2;
            const value = `url("${this.opts.assetUrlCss}/${m.file}") ${px(mx)} ${px(my)} / ${px(mw)} ${px(mh)} no-repeat`;
            d.push(`-webkit-mask: ${value}`, `mask: ${value}`);
        }
        this.rule(`.${c}`, d);
        return `${indent}<div class="${c}" data-name="${esc(node.name)}"></div>\n`;
    }

    private emitText(node: LayoutNode, inFlex: boolean, indent: string): string {
        const text = node.text;
        const singleLine =
            typeof text === "string" ? !text.includes("\n") : !text || text.every((r) => !r.t.includes("\n"));
        const c = this.cls(node.name);
        const d = this.boxDecls(node, inFlex);
        d.push(...this.textDecls(node));
        // A fixed-height box reproduces Figma's horizontal and vertical alignment with flex.
        if (typeof node.h === "number") {
            const f = node.font!;
            d.push("display: flex");
            d.push(`align-items: ${f.alignV === "top" ? "flex-start" : f.alignV === "bottom" ? "flex-end" : "center"}`);
            d.push(
                `justify-content: ${f.alignH === "left" ? "flex-start" : f.alignH === "right" ? "flex-end" : "center"}`,
            );
            // A single-line label never wraps in Figma; the text floor must not wrap it here either.
            d.push(singleLine ? "white-space: nowrap" : "white-space: pre-line");
        } else {
            d.push("white-space: pre-line");
        }
        this.rule(`.${c}`, d);
        let inner: string;
        if (typeof text === "string" || text == null) {
            inner = esc(text ?? "");
        } else {
            inner = text
                .map((r) => {
                    const rd: string[] = [];
                    if (r.size != null) rd.push(`font-size: ${this.fontSize(r.size)}`);
                    if (r.family) rd.push(`font-family: "${r.family}"`);
                    if (r.weight != null) rd.push(`font-weight: ${r.weight}`);
                    if (r.color) rd.push(`color: ${r.color}`);
                    // Every run gets a <span>, so the runtime can address runs by position.
                    return rd.length ? `<span style="${rd.join("; ")}">${esc(r.t)}</span>` : `<span>${esc(r.t)}</span>`;
                })
                .join("");
        }
        return `${indent}<div class="${c}"${this.bindAttr(node)} data-name="${esc(node.name)}">${inner}</div>\n`;
    }

    private emitNode(node: LayoutNode, inFlex: boolean, indent: string): string {
        switch (node.type) {
            case "use": {
                const def = this.layout.defs?.[node.def ?? ""];
                if (!def) throw new Error(`unknown def: ${node.def}`);
                const merged = applyOverrides(structuredClone(def), node.over ?? {});
                // The use node supplies placement; the def supplies everything else.
                merged.name = node.name;
                merged.x = node.x;
                merged.y = node.y;
                if (node.w != null) merged.w = node.w;
                if (node.h != null) merged.h = node.h;
                if (node.opacity != null) merged.opacity = node.opacity;
                if (node.bind != null) merged.bind = node.bind;
                return this.emitNode(merged, inFlex, indent);
            }
            case "image":
                return this.emitImage(node, inFlex, indent);
            case "imagefill":
                return this.emitImagefill(node, inFlex, indent);
            case "texturefill":
                return this.emitTexturefill(node, inFlex, indent);
            case "text":
                return this.emitText(node, inFlex, indent);
            case "spacer": {
                const c = this.cls(node.name);
                this.rule(`.${c}`, this.boxDecls(node, inFlex));
                return `${indent}<div class="${c}"></div>\n`;
            }
            case "rect":
            case "frame": {
                const c = this.cls(node.name);
                const d = this.boxDecls(node, inFlex);
                if (node.layout) {
                    d.push("display: flex", `flex-direction: ${node.layout.mode}`);
                    if (node.layout.gap != null) d.push(`gap: ${px(node.layout.gap)}`);
                    if (node.layout.padding) d.push(`padding: ${node.layout.padding}`, "box-sizing: border-box");
                    if (node.layout.justify) d.push(`justify-content: ${node.layout.justify}`);
                    if (node.layout.align) d.push(`align-items: ${node.layout.align}`);
                }
                this.rule(`.${c}`, d);
                const extra = node.ticker ? ` ${this.prefix}-ticker-track` : "";
                let html = `${indent}<div class="${c}${extra}"${this.bindAttr(node)} data-name="${esc(node.name)}">\n`;
                for (const child of node.children ?? []) {
                    html += this.emitNode(child, !!node.layout, indent + "    ");
                }
                html += `${indent}</div>\n`;
                return html;
            }
            default:
                throw new Error(`unknown node type: ${(node as LayoutNode).type}`);
        }
    }

    /** Outer region box: real size via calc, anchored to the screen; inner box: design px, scaled. */
    private emitRegion(r: Region, body: string): string {
        const outer = `${this.prefix}-region-${slug(r.name)}`;
        const inner = `${outer}-in`;
        const s = `var(${this.scaleVar}, 1)`;
        const d: string[] = ["position: absolute", "pointer-events: none"];
        if (r.anchor.h === "STRETCH" && r.anchor.v === "STRETCH") {
            // Full-viewport cover (a modal's dim backdrop).
            d.push("inset: 0");
            this.rule(`.${outer}`, d);
            this.rule(`.${inner}`, ["position: absolute", "inset: 0", "pointer-events: auto"]);
            return `<div class="${outer}" data-region="${esc(r.name)}">\n<div class="${inner}">\n${body}</div>\n</div>\n`;
        }
        if (r.anchor.h === "STRETCH") {
            d.push("left: 0", "right: 0", `height: calc(${s} * ${px(r.h)})`);
            if (r.anchor.v === "BOTTOM") d.push(`bottom: calc(${s} * ${px(this.designH - (r.y + r.h))})`);
            else d.push(`top: calc(${s} * ${px(r.y)})`);
            this.rule(`.${outer}`, d);
            // Each child carries its own scale wrapper (see emitStretchChild).
            this.rule(`.${outer}-row`, ["display: flex", "width: 100%", "height: 100%"]);
            return `<div class="${outer}" data-region="${esc(r.name)}">\n<div class="${outer}-row">\n${body}</div>\n</div>\n`;
        }
        d.push(`width: calc(${s} * ${px(r.w)})`, `height: calc(${s} * ${px(r.h)})`);
        switch (r.anchor.h) {
            case "LEFT":
                d.push(`left: calc(${s} * ${px(r.x)})`);
                break;
            case "RIGHT":
                d.push(`right: calc(${s} * ${px(this.designW - (r.x + r.w))})`);
                break;
            default:
                d.push(`left: calc(50% + ${s} * ${px(r.x + r.w / 2 - this.designW / 2 - r.w / 2)})`);
                break;
        }
        switch (r.anchor.v) {
            case "TOP":
                d.push(`top: calc(${s} * ${px(r.y)})`);
                break;
            case "BOTTOM":
                d.push(`bottom: calc(${s} * ${px(this.designH - (r.y + r.h))})`);
                break;
            default:
                d.push(`top: calc(50% + ${s} * ${px(r.y + r.h / 2 - this.designH / 2 - r.h / 2)})`);
                break;
        }
        this.rule(`.${outer}`, d);
        this.rule(`.${inner}`, [
            "position: absolute",
            "left: 0",
            "top: 0",
            `width: ${px(r.w)}`,
            `height: ${px(r.h)}`,
            `transform: scale(${s})`,
            "transform-origin: top left",
            // Solid chrome swallows clicks so they don't fall through to the canvas.
            "pointer-events: auto",
        ]);
        return `<div class="${outer}" data-region="${esc(r.name)}">\n<div class="${inner}">\n${body}</div>\n</div>\n`;
    }

    /** A direct child of a STRETCH region: a fixed (scaled) or flexing slot. */
    private emitStretchChild(node: LayoutNode, regionH: number): string {
        const s = `var(${this.scaleVar}, 1)`;
        const c = this.cls(`${node.name}-slot`);
        const flexes = node.grow === true;
        if (!flexes && typeof node.w !== "number") {
            throw new Error(`stretch-region child "${node.name}" needs a numeric w or grow: true`);
        }
        const outerD = ["position: relative", "overflow: hidden", "height: 100%"];
        outerD.push(flexes ? "flex: 1 1 0" : `flex: 0 0 calc(${s} * ${px(node.w as number)})`);
        this.rule(`.${c}`, outerD);
        const innerD = [
            "position: absolute",
            "left: 0",
            "top: 0",
            `height: ${px(regionH)}`,
            `transform: scale(${s})`,
            "transform-origin: top left",
        ];
        // A flexing slot's inner box spans the real width after scaling.
        innerD.push(flexes ? `width: calc(100% / ${s})` : `width: ${px(node.w as number)}`);
        innerD.push("pointer-events: auto");
        this.rule(`.${c}-in`, innerD);
        const body = this.emitNode(
            { ...node, x: 0, y: 0, grow: undefined, w: flexes ? "fill" : node.w },
            false,
            "        ",
        );
        return `    <div class="${c}">\n        <div class="${c}-in">\n${body}        </div>\n    </div>\n`;
    }

    public convert(): { html: string; css: string } {
        const byRegion = new Map<string, LayoutNode[]>();
        for (const r of this.layout.regions) byRegion.set(r.name, []);
        for (const n of this.layout.nodes) {
            const bucket = byRegion.get(n.region);
            if (!bucket) throw new Error(`node "${n.name}" references unknown region "${n.region}"`);
            bucket.push(n);
        }
        const f = this.layout.frame;
        let html = `<!-- GENERATED by figma-ui from ${this.opts.source} -->\n`;
        html += `<!-- Figma ${f.id} "${esc(f.name)}" (${f.width}x${f.height}) - DO NOT EDIT BY HAND -->\n`;
        for (const r of this.layout.regions) {
            const bothStretch = r.anchor.h === "STRETCH" && r.anchor.v === "STRETCH";
            let body = "";
            for (const n of byRegion.get(r.name) ?? []) {
                body +=
                    r.anchor.h === "STRETCH" && !bothStretch
                        ? this.emitStretchChild(n, r.h)
                        : this.emitNode(n, false, "    ");
            }
            html += this.emitRegion(r, body);
        }
        const cssHeader =
            `/* GENERATED by figma-ui from ${this.opts.source} */\n` +
            `/* Figma ${f.id} "${f.name}" - DO NOT EDIT BY HAND */\n`;
        // Shared affordances: marquee track and generic button feedback.
        const shared = [
            `.${this.prefix}-ticker-track { display: flex; align-items: center; height: 100%; width: max-content; animation: ${this.prefix}-marquee var(--ticker-duration, 40s) linear infinite; will-change: transform; }`,
            `@keyframes ${this.prefix}-marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }`,
            `[data-bind$="-btn"]:not(:has(> [data-state])):hover { filter: brightness(1.06); }`,
            `[data-bind$="-btn"]:not(:has(> [data-state])):active { transform: translateY(1px); }`,
        ].join("\n");
        return { html, css: `${cssHeader}${this.css.join("\n")}\n${shared}\n` };
    }
}

function applyOverrides(node: LayoutNode, over: Record<string, NodeOverride>): LayoutNode {
    const walk = (n: LayoutNode): LayoutNode | null => {
        const o = over[n.name];
        if (o?.remove) return null;
        const merged = o ? { ...n, ...o } : n;
        if (merged.children) {
            merged.children = merged.children.map(walk).filter((c): c is LayoutNode => c !== null);
        }
        return merged;
    };
    return walk(node) ?? node;
}

/** Convert one layout. */
export function convertDom(layout: DomLayout, manifest: Manifest, opts: DomOptions): { html: string; css: string } {
    return new DomConverter(layout, manifest, opts).convert();
}

export interface PreviewOptions {
    /** `<base href>` so the preview resolves URLs the way the app page does. */
    base: string;
    /** Font stylesheet URL (relative to `base`), or omit for none. */
    fontsCss?: string;
    /** Folder holding the generated `<surface>.html/.css` (relative to `base`). */
    surfaceUrl: string;
    title: string;
    cssVarPrefix: string;
    design: { width: number; height: number };
    textFloor: { px: number; belowScale: number };
}

/** A standalone page that mounts every surface with the runtime's scale logic (for visual tests). */
export function previewHtml(surfaces: string[], o: PreviewOptions): string {
    const fonts = o.fontsCss ? `<link rel="stylesheet" href="${o.fontsCss}">\n` : "";
    return `<!DOCTYPE html>
<!-- GENERATED by figma-ui - standalone preview harness for the generated surfaces -->
<html lang="en">
<head>
<meta charset="UTF-8">
<!-- Resolve URLs the way the app page does, so <img src> in the fragments works unchanged. -->
<base href="${o.base}">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>${esc(o.title)}</title>
${fonts}${surfaces.map((s) => `<link rel="stylesheet" href="${o.surfaceUrl}/${s}.css">`).join("\n")}
<style>
    html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #9fb6c9; }
    .stage { position: absolute; inset: 0; overflow: hidden; }
</style>
</head>
<body>
<div class="stage" id="stage">
${surfaces.map((s) => `<div id="surface-${s}"></div>`).join("\n")}
</div>
<script>
    const DESIGN_W = ${o.design.width}, DESIGN_H = ${o.design.height};
    // ?surfaces=a,b limits which surfaces mount.
    const only = new URLSearchParams(location.search).get("surfaces");
    const wanted = only ? only.split(",") : null;
    function applyScale() {
        const s = Math.min(window.innerWidth / DESIGN_W, window.innerHeight / DESIGN_H);
        const root = document.documentElement;
        root.style.setProperty("--${o.cssVarPrefix}-scale", String(s));
        root.style.setProperty("--${o.cssVarPrefix}-text-floor", s < ${o.textFloor.belowScale} ? "${o.textFloor.px}px" : "0px");
    }
    window.addEventListener("resize", applyScale);
    applyScale();
    ${surfaces
        .map(
            (s) => `if (!wanted || wanted.includes("${s}")) fetch("${o.surfaceUrl}/${s}.html").then((r) => r.text()).then((t) => {
        document.getElementById("surface-${s}").innerHTML = t;
        document.getElementById("surface-${s}").dataset.loaded = "1";
    }); else document.getElementById("surface-${s}").dataset.loaded = "skipped";`,
        )
        .join("\n    ")}
</script>
</body>
</html>
`;
}
