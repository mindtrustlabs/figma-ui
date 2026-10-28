/**
 * The DOM layout format (`*.dom.figma.json`): a normalized transcription of one
 * Figma frame. Values are the designer's, in design px of the frame; positions
 * are relative to the parent node. See docs/layout-format.md for the contract.
 */

export type Anchor = { h: "LEFT" | "CENTER" | "RIGHT" | "STRETCH"; v: "TOP" | "CENTER" | "BOTTOM" | "STRETCH" };

/** A screen-anchored box of the frame. Every node belongs to one region. */
export interface Region {
    name: string;
    x: number;
    y: number;
    w: number;
    h: number;
    anchor: Anchor;
}

export interface TextRun {
    t: string;
    size?: number;
    family?: string;
    weight?: number;
    color?: string;
}

export interface FontSpec {
    family: string;
    size: number;
    weight?: number;
    case?: "upper";
    alignH?: "left" | "center" | "right";
    alignV?: "top" | "center" | "bottom";
    lineHeight?: string;
    color: string;
}

export type NodeOverride = Partial<LayoutNode> & { remove?: boolean };

export interface LayoutNode {
    /** Figma node id (provenance only). */
    id?: string;
    name: string;
    type: "frame" | "rect" | "image" | "imagefill" | "texturefill" | "text" | "use" | "spacer";
    x?: number;
    y?: number;
    w?: number | "fill";
    h?: number | "fill";
    layout?: {
        mode: "row" | "column";
        gap?: number;
        /** CSS shorthand in design px, e.g. "10px 12px". */
        padding?: string;
        justify?: string;
        align?: string;
    };
    selfAlign?: "stretch";
    /** flex-grow: 1 (flexible filler). */
    grow?: boolean;
    opacity?: number;
    /** Stable `data-bind` name the runtime finds the element by. */
    bind?: string;
    /** A raster that scales with its wrapper width (progress fills). */
    stretch?: "x";
    /** Clickable: pointer events, pointer cursor and button feedback. */
    interactive?: boolean;
    /** overflow: hidden. */
    clip?: boolean;
    /**
     * Figma blend mode, verbatim (e.g. "MULTIPLY"). Modes with a CSS equivalent
     * become `mix-blend-mode`; NORMAL/PASS_THROUGH and Figma-only modes emit
     * nothing (those stay baked in the raster).
     */
    blend?: string;
    /** `isolation: isolate`, so blended children composite only within this subtree. */
    isolate?: boolean;
    /**
     * Explicit z-index. Nodes paint in source order (back-to-front, as in
     * Figma's layer list), so this is only for chrome that overlaps a sibling
     * emitted later.
     */
    z?: number;
    /** Figma layer rotation in degrees (clockwise), about the node's center. */
    rotate?: number;
    /**
     * Interaction-state art inside an `interactive` frame: hidden until the
     * frame is hovered ("hover") or pressed ("active"). Later siblings paint on
     * top, so author default, hover, then active. A frame with state art skips
     * the generic brightness/nudge button feedback.
     */
    state?: "hover" | "active";
    fill?: string;
    stroke?: string;
    sw?: number;
    /** CSS border-radius shorthand. */
    radius?: string;
    /** CSS box-shadow, verbatim from the Figma effect. */
    shadow?: string;
    /** CSS filter (drop-shadow for group effects over raster and text). */
    filter?: string;
    /** Logical asset name in the manifest. */
    asset?: string;
    /** imagefill: the photo box (design px, relative to this node), object-fit cover. */
    img?: { x: number; y: number; w: number; h: number; radius?: string; stroke?: string; sw?: number };
    /** texturefill: tile size and offset in design px. */
    tile?: { size: number; x: number; y: number; w: number; h: number };
    /** texturefill: explicit background size and position (a crop of the base image). */
    cover?: { bgW: number; bgH: number; bgX: number; bgY: number };
    /** texturefill: plain CSS cover (Figma scaleMode FILL with no crop). */
    coverAuto?: boolean;
    /** frame: a scrolling marquee track. */
    ticker?: boolean;
    /** texturefill: mask shape (manifest asset) at its layout box relative to this node. */
    mask?: { asset: string; x: number; y: number; w: number; h: number };
    text?: string | TextRun[];
    font?: FontSpec;
    children?: LayoutNode[];
    /** use: the `defs` entry to instantiate. */
    def?: string;
    /** use: overrides keyed by descendant node name. */
    over?: Record<string, NodeOverride>;
}

export interface DomLayout {
    frame: { id: string; name: string; width: number; height: number };
    /** Output basename and CSS class prefix. */
    surface: string;
    /** Mount order across surfaces in the preview (lower mounts first, renders below). */
    order?: number;
    regions: Region[];
    defs?: Record<string, LayoutNode>;
    nodes: (LayoutNode & { region: string })[];
}

export interface ManifestAsset {
    file: string;
    /** Intrinsic pixel size of the 2x export. */
    px: [number, number];
    node: { id: string; w: number; h: number };
}

export interface Manifest {
    aliases?: Record<string, string>;
    assets: Record<string, ManifestAsset>;
}
