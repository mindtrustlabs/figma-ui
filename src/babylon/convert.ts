/**
 * Babylon GUI generator: a Babylon layout (`*.figma.json`) becomes the JSON
 * that `AdvancedDynamicTexture.parseFromURLAsync` / `parseSerializedObject`
 * loads.
 *
 * The root is a transparent full-size Container. Each region becomes a
 * Container anchored to a screen edge (alignment plus pixel offset), so the
 * panel reflows across aspect ratios while the ADT's idealWidth/idealHeight
 * scale it uniformly. A region without explicit constraints is anchored by
 * where it sits in the frame (left third LEFT, right third RIGHT, else CENTER;
 * likewise vertically). Each node goes to the smallest region containing its
 * center; nodes outside every region stay on the root at their frame position.
 *
 * Deterministic: the same layout and options give byte-identical output.
 */

// Babylon GUI alignment enums (Control.HORIZONTAL_ALIGNMENT_* / VERTICAL_ALIGNMENT_*).
const H_LEFT = 0;
const H_RIGHT = 1;
const H_CENTER = 2;
const V_TOP = 0;
const V_BOTTOM = 1;
const V_CENTER = 2;
const H_ALIGN: Record<string, number> = { left: 0, right: 1, center: 2 };
const V_ALIGN: Record<string, number> = { top: 0, bottom: 1, center: 2 };

export interface BabylonNode {
    id: string;
    name: string;
    type: "RECTANGLE" | "TEXT" | "ELLIPSE" | "LINE";
    x: number;
    y: number;
    w: number;
    h: number;
    fill?: string;
    stroke?: string;
    sw?: number;
    /** Uniform radius, or Figma order [top-left, top-right, bottom-right, bottom-left]. */
    radius?: number | [number, number, number, number];
    opacity?: number;
    text?: string;
    font?: string;
    size?: number;
    weight?: number;
    style?: string;
    align?: "left" | "center" | "right";
    valign?: "top" | "center" | "bottom";
    /** Word-wrap multi-line text. */
    wrap?: boolean;
    /** Drop shadow; blur 0 is a hard flat shadow. */
    shadow?: { x?: number; y?: number; blur?: number; color: string };
    /** Per-node anchoring override (regions cover the common case). */
    constraints?: RegionConstraints;
}

type HConstraint = "LEFT" | "RIGHT" | "CENTER" | "STRETCH" | "SCALE";
type VConstraint = "TOP" | "BOTTOM" | "CENTER" | "STRETCH" | "SCALE";
export interface RegionConstraints {
    h?: HConstraint;
    v?: VConstraint;
}

export interface BabylonRegion {
    name: string;
    x: number;
    y: number;
    w: number;
    h: number;
    constraints?: RegionConstraints;
}

export interface BabylonLayout {
    frame: { id?: string; name?: string; width: number; height: number; background?: string };
    regions?: BabylonRegion[];
    nodes: BabylonNode[];
    /** TEXT nodes use their own `font` (through the font map) instead of the default family. */
    honorNodeFonts?: boolean;
}

export interface BabylonFontOptions {
    /** Family for text when the layout doesn't honor node fonts, or a node has none. */
    defaultFamily: string;
    /** First matching rule wins: a case-insensitive regex source against the Figma family. */
    map?: { match: string; family: string }[];
}

/** Serialized Babylon GUI control (a loose bag; the parser copies known props). */
export type Control = Record<string, unknown> & { name: string; className: string; children?: Control[] };

const round = (n: number): number => Math.round(n * 100) / 100;
const px = (n: number): string => `${round(n)}px`;
const clamp01 = (n: number): number => Math.min(1, Math.max(0, isNaN(n) ? 0 : n));
const clampByte = (n: number): number => Math.min(255, Math.max(0, Math.round(isNaN(n) ? 0 : n)));

/** A Figma color token as a Babylon color string: hex passes through (upper-cased), rgb()/rgba() becomes hex. */
export function toColor(c: string | undefined): string {
    if (!c) return "";
    const s = c.trim();
    if (s.startsWith("#")) return s.toUpperCase();
    const m = s.match(/rgba?\(([^)]+)\)/i);
    if (m) {
        const parts = m[1].split(",").map((p) => p.trim());
        const [r, g, b] = parts.slice(0, 3).map((v) => clampByte(parseFloat(v)));
        const a = parts.length > 3 ? Math.round(clamp01(parseFloat(parts[3])) * 255) : 255;
        const hex = (v: number): string => v.toString(16).padStart(2, "0");
        const base = `#${hex(r)}${hex(g)}${hex(b)}`.toUpperCase();
        return a === 255 ? base : `${base}${hex(a).toUpperCase()}`;
    }
    return s;
}

function mapFont(f: string | undefined, fonts: BabylonFontOptions): string {
    if (!f) return fonts.defaultFamily;
    for (const rule of fonts.map ?? []) {
        if (new RegExp(rule.match, "i").test(f)) return rule.family;
    }
    return f;
}

/** Props every control carries; (ox, oy) is the origin it is positioned against. */
function base(node: BabylonNode, ox: number, oy: number): Control {
    const b: Control = {
        name: node.name,
        className: "Control",
        horizontalAlignment: H_LEFT,
        verticalAlignment: V_TOP,
        left: px(node.x - ox),
        top: px(node.y - oy),
        width: px(node.w),
        height: px(node.h),
        alpha: node.opacity ?? 1,
        isVisible: true,
        // Display by default; the app opts controls into hit testing where clicked.
        isHitTestVisible: false,
        isPointerBlocker: false,
    };
    if (node.shadow) {
        b.shadowColor = toColor(node.shadow.color);
        b.shadowOffsetX = node.shadow.x ?? 0;
        b.shadowOffsetY = node.shadow.y ?? 0;
        b.shadowBlur = node.shadow.blur ?? 0;
    }
    return b;
}

/** Corner radius as Babylon Rectangle props (X=TL, Y=TR, Z=BR, W=BL). */
function cornerProps(radius: BabylonNode["radius"]): Record<string, number> {
    if (radius == null) return { cornerRadius: 0 };
    if (typeof radius === "number") {
        return {
            cornerRadius: radius,
            cornerRadiusX: radius,
            cornerRadiusY: radius,
            cornerRadiusZ: radius,
            cornerRadiusW: radius,
        };
    }
    const [tl, tr, br, bl] = radius;
    const uniform = tl === tr && tr === br && br === bl ? tl : 0;
    return { cornerRadius: uniform, cornerRadiusX: tl, cornerRadiusY: tr, cornerRadiusZ: br, cornerRadiusW: bl };
}

function convertNode(
    node: BabylonNode,
    ox: number,
    oy: number,
    honorNodeFonts: boolean,
    fonts: BabylonFontOptions,
): Control | null {
    switch (node.type) {
        case "RECTANGLE": {
            const strokeW = node.sw ?? (node.stroke ? 2 : 0);
            return {
                ...base(node, ox, oy),
                className: "Rectangle",
                background: toColor(node.fill),
                color: node.stroke ? toColor(node.stroke) : "",
                thickness: node.stroke ? strokeW : 0,
                ...cornerProps(node.radius),
            };
        }
        case "ELLIPSE": {
            const strokeW = node.sw ?? (node.stroke ? 1 : 0);
            return {
                ...base(node, ox, oy),
                className: "Ellipse",
                background: toColor(node.fill),
                color: node.stroke ? toColor(node.stroke) : "",
                thickness: node.stroke ? strokeW : 0,
            };
        }
        case "TEXT":
            return {
                ...base(node, ox, oy),
                className: "TextBlock",
                text: node.text ?? "",
                color: toColor(node.fill) || "#000000",
                fontFamily: honorNodeFonts ? mapFont(node.font, fonts) : fonts.defaultFamily,
                fontSize: `${round(node.size ?? 16)}px`,
                fontWeight: String(node.weight ?? 400),
                fontStyle: node.style && /italic/i.test(node.style) ? "italic" : "normal",
                textHorizontalAlignment: node.align ? H_ALIGN[node.align] : H_ALIGN.left,
                textVerticalAlignment: node.valign ? V_ALIGN[node.valign] : V_ALIGN.top,
                textWrapping: node.wrap ? 1 : 0,
                resizeToFit: false,
            };
        case "LINE":
            // Wireframe placeholder strokes carry no UI meaning.
            return null;
        default:
            return null;
    }
}

const cx = (b: { x: number; w: number }): number => b.x + b.w / 2;
const cy = (b: { y: number; h: number }): number => b.y + b.h / 2;
const area = (r: BabylonRegion): number => r.w * r.h;

function contains(r: BabylonRegion, n: BabylonNode): boolean {
    const x = cx(n);
    const y = cy(n);
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

function deriveConstraints(r: BabylonRegion, frameW: number, frameH: number): Required<RegionConstraints> {
    const c = cx(r) / frameW;
    const m = cy(r) / frameH;
    const h: HConstraint = c < 0.34 ? "LEFT" : c > 0.66 ? "RIGHT" : "CENTER";
    const v: VConstraint = m < 0.34 ? "TOP" : m > 0.66 ? "BOTTOM" : "CENTER";
    return { h, v };
}

/**
 * Alignment and pixel offset that pin a region to a screen edge. STRETCH and
 * SCALE fall back to CENTER (the region keeps its authored size).
 */
function anchorProps(r: BabylonRegion, frameW: number, frameH: number): Record<string, unknown> {
    const cons = { ...deriveConstraints(r, frameW, frameH), ...(r.constraints ?? {}) };
    const out: Record<string, unknown> = {};
    switch (cons.h) {
        case "LEFT":
            out.horizontalAlignment = H_LEFT;
            out.left = px(r.x);
            break;
        case "RIGHT":
            out.horizontalAlignment = H_RIGHT;
            out.left = px(-(frameW - (r.x + r.w)));
            break;
        default:
            out.horizontalAlignment = H_CENTER;
            out.left = px(cx(r) - frameW / 2);
            break;
    }
    switch (cons.v) {
        case "TOP":
            out.verticalAlignment = V_TOP;
            out.top = px(r.y);
            break;
        case "BOTTOM":
            out.verticalAlignment = V_BOTTOM;
            out.top = px(-(frameH - (r.y + r.h)));
            break;
        default:
            out.verticalAlignment = V_CENTER;
            out.top = px(cy(r) - frameH / 2);
            break;
    }
    return out;
}

/** Convert one layout to the serialized GUI (`{ root, width, height }`). */
export function convertBabylon(
    layout: BabylonLayout,
    fonts: BabylonFontOptions,
): { root: Control; width: number; height: number } {
    const frameW = layout.frame.width;
    const frameH = layout.frame.height;
    const regions = layout.regions ?? [];
    const honor = layout.honorNodeFonts === true;

    const byRegion = new Map<string, BabylonNode[]>();
    for (const r of regions) byRegion.set(r.name, []);
    const rootNodes: BabylonNode[] = [];
    for (const node of layout.nodes) {
        let best: BabylonRegion | null = null;
        for (const r of regions) {
            if (!contains(r, node)) continue;
            if (!best || area(r) < area(best)) best = r;
        }
        if (best) byRegion.get(best.name)!.push(node);
        else rootNodes.push(node);
    }

    const children: Control[] = [];
    for (const r of regions) {
        const members: Control[] = [];
        for (const node of byRegion.get(r.name)!) {
            const c = convertNode(node, r.x, r.y, honor, fonts);
            if (c) members.push(c);
        }
        children.push({
            name: r.name,
            className: "Container",
            ...anchorProps(r, frameW, frameH),
            width: px(r.w),
            height: px(r.h),
            alpha: 1,
            isVisible: true,
            isHitTestVisible: false,
            isPointerBlocker: false,
            clipChildren: false,
            clipContent: false,
            children: members,
        });
    }
    for (const node of rootNodes) {
        const c = convertNode(node, 0, 0, honor, fonts);
        if (c) children.push(c);
    }

    const root: Control = {
        name: "root",
        className: "Container",
        horizontalAlignment: H_CENTER,
        verticalAlignment: V_CENTER,
        width: "100%",
        height: "100%",
        // Transparent: the Figma canvas fill is the design backdrop, not part of the UI.
        background: "",
        left: "0px",
        top: "0px",
        isPointerBlocker: false,
        clipChildren: false,
        clipContent: false,
        children,
    };
    return { root, width: frameW, height: frameH };
}

/** The serialized file text: 4-space JSON plus a trailing newline. */
export function babylonJson(layout: BabylonLayout, fonts: BabylonFontOptions): string {
    return JSON.stringify(convertBabylon(layout, fonts), null, 4) + "\n";
}
