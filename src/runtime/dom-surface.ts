/**
 * DomSurface: mounts one generated surface (`<surface>.html` + `.css`) in a
 * full-viewport host and binds live data to it by `data-bind` name.
 *
 *  - Adds the surface stylesheet (and an optional font stylesheet) once, deduped
 *    by id; they stay in place on dispose so sibling surfaces keep their styles.
 *  - Publishes the scale the generated CSS reads: `--<prefix>-scale` =
 *    min(vw / designW, vh / designH), and `--<prefix>-text-floor`.
 *  - Hides itself in portrait unless `hideInPortrait` is false.
 *  - Tracks every listener it adds; dispose() removes them and the host.
 *
 * Extend it per surface and bind data in onMounted(), or use it directly.
 */

export interface DomSurfaceOptions {
    /** URL of the folder holding `<surface>.html` and `<surface>.css`. */
    baseDir: string;
    /** Host z-index. Default 10. */
    zIndex?: number;
    /** Design frame the surface was generated from. Default 1920x1080. */
    design?: { width: number; height: number };
    /** Must match the generator's `cssVarPrefix`. Default "ui". */
    cssVarPrefix?: string;
    /** Readability floor. Default 11px below scale 0.6. */
    textFloor?: { px: number; belowScale: number };
    /** Font stylesheet to add once (shared by every surface). */
    fontsCss?: string;
    /** Rewrites every fetched or linked URL (cache-busting, CDN prefixes). */
    resolveUrl?: (url: string) => string;
    /** Called with the host after the fragment is injected, before onMounted (string tables). */
    onFragment?: (host: HTMLElement, surface: string) => void;
    /** Default true. */
    hideInPortrait?: boolean;
}

const FONTS_CSS_ID = "figma-ui-fonts-css";

interface TrackedListener {
    el: EventTarget;
    type: string;
    fn: EventListener;
    group?: string;
}

export class DomSurface {
    protected readonly surface: string;
    private readonly opts: Required<Omit<DomSurfaceOptions, "fontsCss" | "onFragment">> &
        Pick<DomSurfaceOptions, "fontsCss" | "onFragment">;
    private _host: HTMLDivElement | null = null;
    private _resizeHandler: (() => void) | null = null;
    private _rafId = 0;
    private _portraitMql: MediaQueryList | null = null;
    private _portraitHandler: (() => void) | null = null;
    private _listeners: TrackedListener[] = [];
    private _disposed = false;

    constructor(surface: string, opts: DomSurfaceOptions) {
        this.surface = surface;
        this.opts = {
            zIndex: 10,
            design: { width: 1920, height: 1080 },
            cssVarPrefix: "ui",
            textFloor: { px: 11, belowScale: 0.6 },
            resolveUrl: (u) => u,
            hideInPortrait: true,
            ...opts,
        };
    }

    /** Fetch and mount the fragment. Idempotent; a no-op after dispose. */
    public async mount(): Promise<void> {
        if (this._host || this._disposed) return;
        const { baseDir, fontsCss, resolveUrl } = this.opts;
        if (fontsCss) ensureCss(FONTS_CSS_ID, resolveUrl(fontsCss));
        ensureCss(`figma-ui-${this.surface}-css`, resolveUrl(`${baseDir}/${this.surface}.css`));

        const host = document.createElement("div");
        host.id = `figma-ui-${this.surface}`;
        host.style.position = "fixed";
        host.style.inset = "0";
        host.style.overflow = "hidden";
        host.style.pointerEvents = "none";
        host.style.zIndex = String(this.opts.zIndex);
        // UI chrome: no text selection or iOS long-press callout.
        host.style.userSelect = "none";
        host.style.webkitUserSelect = "none";
        (host.style as CSSStyleDeclaration & { webkitTouchCallout?: string }).webkitTouchCallout = "none";
        this._host = host;
        document.body.appendChild(host);

        this.applyScale();
        this._resizeHandler = (): void => {
            if (this._rafId) return;
            this._rafId = requestAnimationFrame(() => {
                this._rafId = 0;
                this.applyScale();
            });
        };
        window.addEventListener("resize", this._resizeHandler);
        this._portraitMql = window.matchMedia("(orientation: portrait)");
        this._portraitHandler = (): void => this.applyScale();
        this._portraitMql.addEventListener("change", this._portraitHandler);

        const res = await fetch(resolveUrl(`${baseDir}/${this.surface}.html`));
        // An error page must never be injected as the surface.
        if (!res.ok) throw new Error(`${this.surface}.html: HTTP ${res.status}`);
        const html = await res.text();
        if (this._disposed || !this._host) return;
        this._host.innerHTML = html;
        this.opts.onFragment?.(this._host, this.surface);
        this.onMounted();
    }

    /** Subclass hook: the fragment is in the DOM; bind data and clicks here. */
    protected onMounted(): void {}

    private applyScale(): void {
        if (!this._host) return;
        const { design, cssVarPrefix, textFloor, hideInPortrait } = this.opts;
        const w = window.innerWidth;
        const h = window.innerHeight;
        this._host.style.display = hideInPortrait && h > w ? "none" : "";
        const s = Math.min(w / design.width, h / design.height);
        this._host.style.setProperty(`--${cssVarPrefix}-scale`, String(s));
        this._host.style.setProperty(`--${cssVarPrefix}-text-floor`, s < textFloor.belowScale ? `${textFloor.px}px` : "0px");
    }

    public show(): void {
        if (this._host) this._host.style.visibility = "";
    }

    public hide(): void {
        if (this._host) this._host.style.visibility = "hidden";
    }

    /** The mounted host, or null before mount and after dispose. */
    public get host(): HTMLDivElement | null {
        return this._host;
    }

    public bindEl(bind: string): HTMLElement | null {
        return this._host?.querySelector<HTMLElement>(`[data-bind="${bind}"]`) ?? null;
    }

    public setText(bind: string, text: string): void {
        const el = this.bindEl(bind);
        if (el) el.textContent = text;
    }

    /** Set the text of one run of a multi-run text node (default: the last), keeping its styling. */
    public setRun(bind: string, text: string, index = -1): void {
        const el = this.bindEl(bind);
        if (!el) return;
        const runs = el.querySelectorAll("span");
        const run = runs[index < 0 ? runs.length + index : index];
        if (run) run.textContent = text;
        else el.textContent = text;
    }

    /** Set a fill's wrapper width as a fraction of its track (design px). */
    public setFillWidth(bind: string, fraction: number, trackPx: number): void {
        const el = this.bindEl(bind);
        if (el) el.style.width = `${Math.max(0, Math.min(1, fraction)) * trackPx}px`;
    }

    public onClick(bind: string, fn: () => void): void {
        const el = this.bindEl(bind);
        if (!el) return;
        this.listen(el, "click", (e) => {
            e.stopPropagation();
            fn();
        });
    }

    /** Enable or disable an interactive element (greyed out and ignores input when disabled). */
    public setEnabled(bind: string, enabled: boolean): void {
        const el = this.bindEl(bind);
        if (!el) return;
        el.style.opacity = enabled ? "" : "0.5";
        el.style.pointerEvents = enabled ? "" : "none";
        el.style.cursor = enabled ? "" : "default";
        el.style.filter = enabled ? "" : "grayscale(1) brightness(0.9)";
    }

    public setVisible(bind: string, visible: boolean): void {
        const el = this.bindEl(bind);
        if (el) el.style.display = visible ? "" : "none";
    }

    /** addEventListener that dispose() undoes; `group` lets a subclass remove a set early. */
    protected listen(el: EventTarget, type: string, fn: EventListener, group?: string): void {
        el.addEventListener(type, fn);
        this._listeners.push({ el, type, fn, group });
    }

    protected unlistenGroup(group: string): void {
        this.removeListeners((l) => l.group === group);
    }

    protected unlistenWithin(root: Node): void {
        this.removeListeners((l) => l.el instanceof Node && root.contains(l.el));
    }

    private removeListeners(match: (l: TrackedListener) => boolean): void {
        this._listeners = this._listeners.filter((l) => {
            if (!match(l)) return true;
            l.el.removeEventListener(l.type, l.fn);
            return false;
        });
    }

    public dispose(): void {
        if (this._disposed) return;
        this._disposed = true;
        this.removeListeners(() => true);
        if (this._resizeHandler) window.removeEventListener("resize", this._resizeHandler);
        this._resizeHandler = null;
        if (this._rafId) cancelAnimationFrame(this._rafId);
        this._rafId = 0;
        if (this._portraitMql && this._portraitHandler) {
            this._portraitMql.removeEventListener("change", this._portraitHandler);
        }
        this._portraitMql = null;
        this._portraitHandler = null;
        this._host?.remove();
        this._host = null;
    }
}

function ensureCss(id: string, href: string): void {
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
}
