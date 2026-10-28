// The Python tools, run end to end on images drawn by Pillow. Skipped when
// Python with Pillow isn't available.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PY = process.env.FIGMA_UI_PYTHON ?? (process.platform === "win32" ? "python" : "python3");
const hasPillow = spawnSync(PY, ["-c", "import PIL"]).status === 0;

function py(args: string[], cwd?: string): { status: number | null; out: string } {
    const r = spawnSync(PY, args, { cwd, encoding: "utf8" });
    return { status: r.status, out: r.stdout + r.stderr };
}

function draw(dir: string, code: string): void {
    const r = py(["-c", `from PIL import Image, ImageDraw\nimport os\nos.chdir(${JSON.stringify(dir)})\n${code}`]);
    assert.equal(r.status, 0, r.out);
}

test("composite --fit recovers a layer's true position", { skip: !hasPillow }, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "figma-ui-comp-"));
    try {
        draw(
            dir,
            [
                "bg = Image.new('RGBA', (60, 40), (200, 180, 150, 255)); bg.save('bg.png')",
                "fg = Image.new('RGBA', (10, 8), (20, 40, 200, 255)); fg.save('fg.png')",
                "ref = bg.copy(); ref.alpha_composite(fg, (22, 15))",
                "ImageDraw.Draw(ref).rectangle([2, 2, 8, 8], fill=(0, 0, 0, 255)); ref.save('ref.png')",
            ].join("\n"),
        );
        const recipe = {
            reference: "ref.png",
            output: "out.png",
            layers: [
                { file: "bg.png", at: [0, 0] },
                { file: "fg.png", at: [20, 17] },
            ],
            exclude: [[1, 1, 9, 9]],
        };
        fs.writeFileSync(path.join(dir, "recipe.json"), JSON.stringify(recipe));
        const r = py(["-I", path.join(ROOT, "python/composite.py"), path.join(dir, "recipe.json"), "--fit"]);
        assert.equal(r.status, 0, r.out);
        const fitted = JSON.parse(fs.readFileSync(path.join(dir, "recipe.json"), "utf8"));
        assert.deepEqual(fitted.layers[1].at, [22, 15]);
        assert.match(r.out, /outside excluded boxes 0\.000/);
        assert.ok(fs.existsSync(path.join(dir, "out-diff.png")));
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("assets writes WebP, a shadowless mask and a manifest; rejects duplicate exports", { skip: !hasPillow }, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "figma-ui-assets-"));
    try {
        fs.mkdirSync(path.join(dir, "raw"));
        draw(
            dir,
            [
                "Image.new('RGBA', (40, 20), (255, 0, 0, 255)).save('raw/photo.png')",
                "w = Image.new('RGBA', (30, 30), (0, 0, 0, 100))",
                "ImageDraw.Draw(w).rectangle([5, 5, 24, 24], fill=(10, 10, 10, 255)); w.save('raw/window.png')",
            ].join("\n"),
        );
        const config = {
            assets: {
                rawDir: "raw",
                outDir: "out",
                source: "test",
                list: {
                    photo: { node: "1:1", w: 20, h: 10, kind: "photo" },
                    window: { node: "1:2", w: 15, h: 15, kind: "mask-source" },
                },
            },
        };
        const cfgPath = path.join(dir, "figma-ui.config.json");
        fs.writeFileSync(cfgPath, JSON.stringify(config));
        const r = py(["-I", path.join(ROOT, "python/assets.py"), cfgPath]);
        assert.equal(r.status, 0, r.out);
        const manifest = JSON.parse(fs.readFileSync(path.join(dir, "out/manifest.json"), "utf8"));
        assert.deepEqual(Object.keys(manifest.assets), ["photo", "window", "window-mask"]);
        assert.deepEqual(manifest.assets.photo.px, [40, 20]);
        assert.equal(manifest.assets.window.node.id, "1:2");
        // Shadow alpha (100 <= 128) drops out of the mask; the shape stays opaque.
        const probe = py([
            "-c",
            `from PIL import Image\nm = Image.open(${JSON.stringify(path.join(dir, "out/window-mask.webp"))}).getchannel("A")\nprint(m.getpixel((1, 1)), m.getpixel((15, 15)))`,
        ]);
        assert.equal(probe.out.trim(), "0 255");

        fs.copyFileSync(path.join(dir, "raw/photo.png"), path.join(dir, "raw/copy.png"));
        config.assets.list = { ...config.assets.list, copy: { node: "1:3", w: 20, h: 10, kind: "photo" } } as never;
        fs.writeFileSync(cfgPath, JSON.stringify(config));
        const dup = py(["-I", path.join(ROOT, "python/assets.py"), cfgPath]);
        assert.notEqual(dup.status, 0);
        assert.match(dup.out, /DUPLICATE EXPORT: copy/);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("assets builds every target of a list, or only the named one", { skip: !hasPillow }, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "figma-ui-assets-"));
    try {
        fs.mkdirSync(path.join(dir, "raw-a"));
        fs.mkdirSync(path.join(dir, "raw-b"));
        draw(
            dir,
            [
                "Image.new('RGBA', (20, 20), (255, 0, 0, 255)).save('raw-a/one.png')",
                "Image.new('RGBA', (20, 20), (0, 255, 0, 255)).save('raw-b/two.png')",
            ].join("\n"),
        );
        const target = (name: string, raw: string, out: string, asset: string) => ({
            name,
            rawDir: raw,
            outDir: out,
            source: "test",
            list: { [asset]: { node: "1:1", w: 10, h: 10, kind: "shape" } },
        });
        const cfgPath = path.join(dir, "figma-ui.config.json");
        fs.writeFileSync(
            cfgPath,
            JSON.stringify({ assets: [target("a", "raw-a", "out-a", "one"), target("b", "raw-b", "out-b", "two")] }),
        );
        const only = py(["-I", path.join(ROOT, "python/assets.py"), cfgPath, "b"]);
        assert.equal(only.status, 0, only.out);
        assert.ok(!fs.existsSync(path.join(dir, "out-a")));
        assert.ok(fs.existsSync(path.join(dir, "out-b/two.webp")));
        const all = py(["-I", path.join(ROOT, "python/assets.py"), cfgPath]);
        assert.equal(all.status, 0, all.out);
        assert.ok(fs.existsSync(path.join(dir, "out-a/manifest.json")));
        const missing = py(["-I", path.join(ROOT, "python/assets.py"), cfgPath, "nope"]);
        assert.notEqual(missing.status, 0);
        assert.match(missing.out, /no assets target named nope/);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
