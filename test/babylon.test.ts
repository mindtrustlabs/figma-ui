import assert from "node:assert/strict";
import { test } from "node:test";
import { convertBabylon, toColor, type BabylonLayout, type Control } from "../src/babylon/convert.js";

const fonts = { defaultFamily: "Body", map: [{ match: "mono", family: "Roboto Mono" }] };

function find(root: Control, name: string): Control {
    const stack = [root];
    while (stack.length) {
        const c = stack.pop()!;
        if (c.name === name) return c;
        stack.push(...(c.children ?? []));
    }
    throw new Error(`no control ${name}`);
}

const base: BabylonLayout = {
    frame: { width: 1920, height: 1080 },
    regions: [
        { name: "big", x: 0, y: 0, w: 600, h: 600 },
        { name: "small", x: 100, y: 100, w: 100, h: 100 },
        { name: "corner", x: 1700, y: 900, w: 200, h: 160 },
    ],
    nodes: [
        { id: "1", name: "in-small", type: "RECTANGLE", x: 120, y: 120, w: 20, h: 20 },
        { id: "2", name: "in-big", type: "RECTANGLE", x: 400, y: 400, w: 20, h: 20 },
        { id: "3", name: "loose", type: "RECTANGLE", x: 1000, y: 500, w: 20, h: 20 },
        { id: "4", name: "label", type: "TEXT", x: 1710, y: 910, w: 50, h: 20, text: "hi", font: "Fira Mono" },
    ],
};

test("a node joins the smallest region containing its center, positioned against it", () => {
    const { root } = convertBabylon(base, fonts);
    const small = find(root, "small");
    assert.deepEqual(
        small.children!.map((c) => c.name),
        ["in-small"],
    );
    assert.equal(find(root, "in-small").left, "20px");
    assert.ok(find(root, "big").children!.some((c) => c.name === "in-big"));
});

test("nodes outside every region stay on the root at frame position", () => {
    const { root } = convertBabylon(base, fonts);
    const loose = root.children!.find((c) => c.name === "loose")!;
    assert.equal(loose.left, "1000px");
});

test("regions are pinned to the nearest edge unless constraints say otherwise", () => {
    const { root } = convertBabylon(base, fonts);
    const corner = find(root, "corner");
    assert.equal(corner.horizontalAlignment, 1);
    assert.equal(corner.verticalAlignment, 1);
    assert.equal(corner.left, "-20px");
    assert.equal(corner.top, "-20px");
    const pinned = convertBabylon(
        { ...base, regions: [{ ...base.regions![2], constraints: { h: "LEFT", v: "TOP" } }] },
        fonts,
    );
    assert.equal(find(pinned.root, "corner").horizontalAlignment, 0);
});

test("text uses the default family unless the layout honors node fonts", () => {
    assert.equal(find(convertBabylon(base, fonts).root, "label").fontFamily, "Body");
    const honored = convertBabylon({ ...base, honorNodeFonts: true }, fonts);
    assert.equal(find(honored.root, "label").fontFamily, "Roboto Mono");
});

test("rgba colors become 8-digit hex", () => {
    assert.equal(toColor("rgba(255, 0, 0, 0.5)"), "#FF000080");
    assert.equal(toColor("rgb(0, 128, 255)"), "#0080FF");
    assert.equal(toColor("#abc"), "#ABC");
});

test("the root is transparent so the scene shows through", () => {
    const { root } = convertBabylon({ ...base, frame: { ...base.frame, background: "#FFFFFF" } }, fonts);
    assert.equal(root.background, "");
});
