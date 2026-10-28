import assert from "node:assert/strict";
import { test } from "node:test";
import { convertDom, figmaBlendToCss } from "../src/dom/convert.js";
import type { DomLayout, LayoutNode, Manifest } from "../src/dom/layout.js";

const manifest: Manifest = {
    assets: { art: { file: "art.webp", px: [200, 100], node: { id: "1:1", w: 100, h: 50 } } },
};
const opts = { cssVarPrefix: "ui", assetUrlCss: "../a", assetUrlHtml: "./a", source: "x.dom.figma.json" };

function layout(nodes: LayoutNode[], anchor: DomLayout["regions"][0]["anchor"] = { h: "LEFT", v: "TOP" }): DomLayout {
    return {
        frame: { id: "1:0", name: "F", width: 1920, height: 1080 },
        surface: "s",
        regions: [{ name: "r", x: 100, y: 50, w: 400, h: 300, anchor }],
        nodes: nodes.map((n) => ({ ...n, region: "r" })),
    };
}

test("blend modes map to CSS only where CSS has the mode", () => {
    assert.equal(figmaBlendToCss("MULTIPLY"), "multiply");
    assert.equal(figmaBlendToCss("color-dodge"), "color-dodge");
    assert.equal(figmaBlendToCss("NORMAL"), null);
    assert.equal(figmaBlendToCss("PASS_THROUGH"), null);
    assert.equal(figmaBlendToCss("LINEAR_DODGE"), null);
});

test("nodes paint in source order and carry no z-index unless asked", () => {
    const { html, css } = convertDom(
        layout([
            { name: "back", type: "rect", x: 0, y: 0, w: 10, h: 10 },
            { name: "front", type: "rect", x: 0, y: 0, w: 10, h: 10 },
        ]),
        manifest,
        opts,
    );
    assert.ok(html.indexOf('data-name="back"') < html.indexOf('data-name="front"'));
    assert.doesNotMatch(css, /z-index/);
});

test("a raster is centered on its box at half its 2x pixel size", () => {
    const { html, css } = convertDom(
        layout([{ name: "pic", type: "image", x: 0, y: 0, w: 100, h: 50, asset: "art" }]),
        manifest,
        opts,
    );
    assert.match(html, /<img src="\.\/a\/art\.webp" width="200" height="100"/);
    assert.match(css, /\.s-pic > img \{[^}]*width: 100px;[^}]*height: 50px/);
});

test("an unknown asset fails generation", () => {
    assert.throws(
        () => convertDom(layout([{ name: "pic", type: "image", asset: "missing" }]), manifest, opts),
        /asset not in manifest: missing/,
    );
});

test("state art shows only while its interactive parent is hovered or pressed", () => {
    const { css } = convertDom(
        layout([
            {
                name: "btn",
                type: "frame",
                bind: "go-btn",
                interactive: true,
                w: 100,
                h: 50,
                children: [{ name: "hot", type: "image", state: "hover", w: 100, h: 50, asset: "art" }],
            },
        ]),
        manifest,
        opts,
    );
    assert.match(css, /\.s-hot \{[^}]*visibility: hidden/);
    assert.match(css, /:hover > \.s-hot \{\s*visibility: visible;/);
    assert.match(css, /:not\(:has\(> \[data-state\]\)\):hover/);
});

test("regions anchor to the edge they are pinned to and scale with the custom property", () => {
    const right = convertDom(layout([], { h: "RIGHT", v: "BOTTOM" }), manifest, opts).css;
    assert.match(right, /right: calc\(var\(--ui-scale, 1\) \* 1420px\)/);
    assert.match(right, /bottom: calc\(var\(--ui-scale, 1\) \* 730px\)/);
    const center = convertDom(layout([], { h: "CENTER", v: "CENTER" }), manifest, opts).css;
    assert.match(center, /left: calc\(50% \+ var\(--ui-scale, 1\) \* -860px\)/);
});

test("the CSS variable prefix is configurable", () => {
    const { css } = convertDom(
        layout([{ name: "t", type: "text", text: "hi", font: { family: "F", size: 10, color: "#000" } }]),
        manifest,
        { ...opts, cssVarPrefix: "hud" },
    );
    assert.match(css, /var\(--hud-text-floor, 0px\) \/ var\(--hud-scale, 1\)/);
    assert.doesNotMatch(css, /--ui-/);
});

test("every text run is its own span so the runtime can address it", () => {
    const { html } = convertDom(
        layout([
            {
                name: "count",
                type: "text",
                bind: "c",
                text: [{ t: "x" }, { t: "4", weight: 700 }],
                font: { family: "F", size: 10, color: "#000" },
            },
        ]),
        manifest,
        opts,
    );
    assert.match(html, /<span>x<\/span><span style="font-weight: 700">4<\/span>/);
});

test("use nodes take placement from the instance and can drop descendants", () => {
    const l = layout([{ name: "inst", type: "use", def: "d", x: 7, y: 9, over: { gone: { remove: true } } }]);
    l.defs = {
        d: {
            name: "d",
            type: "frame",
            x: 0,
            y: 0,
            children: [
                { name: "kept", type: "rect" },
                { name: "gone", type: "rect" },
            ],
        },
    };
    const { html, css } = convertDom(l, manifest, opts);
    assert.match(css, /\.s-inst \{\s*position: absolute;\s*left: 7px;\s*top: 9px/);
    assert.match(html, /data-name="kept"/);
    assert.doesNotMatch(html, /data-name="gone"/);
});
