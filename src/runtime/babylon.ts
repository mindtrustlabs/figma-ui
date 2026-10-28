/**
 * Babylon GUI runtime helpers for generated panels. Imports only
 * `@babylonjs/gui`, which a Babylon project already has.
 */

import { AdvancedDynamicTexture, Container, Control, TextBlock } from "@babylonjs/gui";

/** Load a generated panel into a full-screen texture. */
export async function loadPanel(url: string, name = url): Promise<AdvancedDynamicTexture> {
    const gui = AdvancedDynamicTexture.CreateFullscreenUI(name);
    await gui.parseFromURLAsync(url);
    return gui;
}

/** Every descendant control (depth first, including `root`). */
export function* controlsOf(root: Control): Generator<Control> {
    yield root;
    if (root instanceof Container) {
        for (const child of root.children) yield* controlsOf(child);
    }
}

/** The first control named `name` under `gui`, or null. */
export function findControl<T extends Control = Control>(gui: AdvancedDynamicTexture, name: string): T | null {
    for (const c of controlsOf(gui.rootContainer)) {
        if (c.name === name) return c as T;
    }
    return null;
}

/**
 * Replace the text of every named TextBlock under `root` for which `lookup`
 * returns a string (a string table keyed by control name). Returns how many changed.
 */
export function applyNamedText(root: Control, lookup: (name: string) => string | undefined): number {
    let applied = 0;
    for (const c of controlsOf(root)) {
        if (!(c instanceof TextBlock) || !c.name) continue;
        const text = lookup(c.name);
        if (text === undefined) continue;
        c.text = text;
        applied++;
    }
    return applied;
}
