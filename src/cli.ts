#!/usr/bin/env node
/**
 * figma-ui command line. Run from the project root (where figma-ui.config.json is).
 *
 *   figma-ui generate            regenerate every configured output
 *   figma-ui generate --check    fail when a committed output differs from its layout
 *   figma-ui assets [target]     raw 2x exports -> WebP + manifest (Python + Pillow);
 *                                with a name, only that assets target
 *   figma-ui composite <recipe.json> [--fit]
 *                                stack per-layer renders into one image; --fit nudges
 *                                each layer to best match the reference render
 */

import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_FILE, loadConfig } from "./config.js";
import { generateFiles, staleFiles, writeFiles } from "./generate.js";

const PYTHON_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../python");

function python(script: string, args: string[]): number {
    const exe = process.env.FIGMA_UI_PYTHON ?? (process.platform === "win32" ? "python" : "python3");
    const r = spawnSync(exe, ["-I", path.join(PYTHON_DIR, script), ...args], { stdio: "inherit" });
    if (r.error) throw r.error;
    return r.status ?? 1;
}

function main(argv: string[]): number {
    const [cmd, ...rest] = argv;
    const root = process.cwd();
    switch (cmd) {
        case "generate": {
            const config = loadConfig(root);
            const files = generateFiles(root, config, (m) => process.stderr.write(`figma-ui: WARN ${m}\n`));
            if (rest.includes("--check")) {
                const stale = staleFiles(root, files);
                if (stale.length > 0) {
                    process.stderr.write("figma-ui: these files differ from what their layout generates:\n");
                    for (const p of stale) process.stderr.write(`  ${p}\n`);
                    process.stderr.write("Change the layout (or the generator) and run `figma-ui generate`.\n");
                    return 1;
                }
                process.stdout.write(`figma-ui: ${files.length} generated files match their layouts.\n`);
                return 0;
            }
            writeFiles(root, files);
            process.stdout.write(`figma-ui: wrote ${files.length} files.\n`);
            return 0;
        }
        case "assets":
            loadConfig(root);
            return python("assets.py", [path.join(root, CONFIG_FILE), ...rest.slice(0, 1)]);
        case "composite":
            if (!rest[0]) throw new Error("usage: figma-ui composite <recipe.json> [--fit]");
            return python("composite.py", rest);
        default:
            process.stdout.write(
                "usage: figma-ui generate [--check] | assets [target] | composite <recipe.json> [--fit]\n" +
                    "See https://github.com/mindtrustlabs/figma-ui#readme\n",
            );
            return cmd ? 1 : 0;
    }
}

process.exitCode = main(process.argv.slice(2));
