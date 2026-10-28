// The fixture project's committed outputs are the golden files: any generator
// change that alters output shows up here as a diff to review. Regenerate them
// with UPDATE_GOLDEN=1 npm test once the change is intended.
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { assetTargets, domTargets, loadConfig, type FigmaUiConfig } from "../src/config.js";
import { generateFiles, staleFiles, writeFiles } from "../src/generate.js";

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../test/fixtures");
const FIXTURE = path.join(FIXTURES, "project");
const MULTI = path.join(FIXTURES, "multi");

test("fixture outputs match the golden files", () => {
    const warnings: string[] = [];
    const files = generateFiles(FIXTURE, loadConfig(FIXTURE), (m) => warnings.push(m));
    if (process.env.UPDATE_GOLDEN) writeFiles(FIXTURE, files);
    assert.deepEqual(staleFiles(FIXTURE, files), []);
    assert.equal(warnings.length, 1, "only the LINEAR_DODGE layer warns");
    assert.match(warnings[0], /glow.*LINEAR_DODGE/);
});

test("generation is deterministic", () => {
    const config = loadConfig(FIXTURE);
    const a = generateFiles(FIXTURE, config, () => {});
    const b = generateFiles(FIXTURE, config, () => {});
    assert.deepEqual(a, b);
});

test("the hand-authored tail of a stylesheet survives regeneration", () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "figma-ui-"));
    try {
        fs.cpSync(FIXTURE, work, { recursive: true });
        const css = path.join(work, "out/dom/hud.css");
        const tail = "/* Drag ghost (added, not Figma-authored) */\n.ghost { opacity: 0.5; }\n";
        fs.appendFileSync(css, `\n${tail}`);
        writeFiles(work, generateFiles(work, loadConfig(work), () => {}));
        assert.ok(fs.readFileSync(css, "utf8").endsWith(tail));
    } finally {
        fs.rmSync(work, { recursive: true, force: true });
    }
});

test("dom and assets take one target or a list of them", () => {
    const one = { inputDir: "a", outDir: "b", manifest: "m", assetUrlCss: "c", assetUrlHtml: "h" };
    const asset = { rawDir: "r", outDir: "o", source: "s", list: {} };
    assert.deepEqual(domTargets({ dom: one }), [one]);
    assert.deepEqual(domTargets({ dom: [one, { ...one, outDir: "d" }] }).map((t) => t.outDir), ["b", "d"]);
    assert.deepEqual(domTargets({}), []);
    assert.deepEqual(assetTargets({ assets: asset }), [asset]);
    assert.deepEqual(assetTargets({ assets: [asset, { ...asset, name: "x" }] }).length, 2);
});

test("every dom target writes its own surfaces, stylesheet URLs and preview", () => {
    const files = generateFiles(MULTI, loadConfig(MULTI), () => {});
    if (process.env.UPDATE_GOLDEN) writeFiles(MULTI, files);
    assert.deepEqual(staleFiles(MULTI, files), []);
    assert.deepEqual(files.map((f) => f.path).sort(), [
        "out/game/hud.css",
        "out/game/hud.html",
        "out/game/preview.html",
        "out/shared/notice.css",
        "out/shared/notice.html",
    ]);
    const shared = files.find((f) => f.path === "out/shared/notice.css")!.content;
    assert.match(shared, /var\(--ui-scale, 1\)/);
    assert.doesNotMatch(shared, /--hud-/);
});

test("two dom targets may not share an output folder", () => {
    const config = loadConfig(MULTI) as FigmaUiConfig;
    const [game] = domTargets(config);
    assert.throws(() => generateFiles(MULTI, { dom: [game, { ...game }] }, () => {}), /two dom targets write to out\/game/);
});
