"""
figma-ui composite: stack per-layer Figma renders into one image.

Usage: python composite.py <recipe.json> [--fit] [--radius N]   (needs Pillow)

Use it when live text, bars or buttons sit BETWEEN painted layers, so one
render of the whole component would bake them in. Export each static layer at
2x, list them back to front in a recipe, and this stacks them on a canvas the
size of the reference render (Figma's own render of the whole component).

Recipe (paths relative to the recipe file, positions in output pixels):
{
    "reference": "full.png",
    "output": "modal-bg.png",
    "layers": [
        { "file": "l01-paper.png", "at": [0, 0] },
        { "file": "l02-stain.png", "at": [120, 640], "blend": "multiply" }
    ],
    "exclude": [[x, y, w, h], ...]
}

"exclude" boxes cover the live content (text, bars, buttons) that the reference
contains but the composite must not; they are ignored when scoring.

--fit nudges each layer by up to --radius px (default 3) to minimize the mean
difference from the reference outside the excluded boxes, two passes, and
writes the fitted positions back into the recipe. Figma renders a layer
exported on its own a few px off from the same layer inside its parent, so
start from the layout positions and fit.

Always writes <output> and <output stem>-diff.png (pixels differing by more
than 24 levels, white) and prints the mean difference.
"""

import argparse
import json
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageStat


def load(path: Path) -> Image.Image:
    with Image.open(path) as im:
        return im.convert("RGBA")


def compose(size, layers, images, pos) -> Image.Image:
    out = Image.new("RGBA", size, (0, 0, 0, 0))
    for i, layer in enumerate(layers):
        canvas = Image.new("RGBA", size, (0, 0, 0, 0))
        canvas.paste(images[i], tuple(pos[i]))
        if layer.get("blend") == "multiply":
            base = out.convert("RGB")
            mult = ImageChops.multiply(base, canvas.convert("RGB"))
            blended = Image.composite(mult, base, canvas.getchannel("A"))
            blended.putalpha(out.getchannel("A"))
            out = blended
        elif layer.get("blend", "normal") == "normal":
            out = Image.alpha_composite(out, canvas)
        else:
            raise SystemExit(f"unsupported blend {layer['blend']!r} (normal, multiply)")
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("recipe")
    ap.add_argument("--fit", action="store_true")
    ap.add_argument("--radius", type=int, default=3)
    args = ap.parse_args()

    recipe_path = Path(args.recipe).resolve()
    base_dir = recipe_path.parent
    recipe = json.loads(recipe_path.read_text(encoding="utf-8"))
    layers = recipe["layers"]
    images = [load(base_dir / l["file"]) for l in layers]
    pos = [list(l["at"]) for l in layers]
    ref = load(base_dir / recipe["reference"]) if recipe.get("reference") else None
    if ref is None and args.fit:
        raise SystemExit("--fit needs a reference render")
    size = ref.size if ref else tuple(recipe["size"])

    mask = Image.new("L", size, 255)
    draw = ImageDraw.Draw(mask)
    for x, y, w, h in recipe.get("exclude", []):
        draw.rectangle([x, y, x + w, y + h], fill=0)

    def score(img: Image.Image) -> float:
        d = ImageChops.difference(img, ref).convert("L")
        return ImageStat.Stat(ImageChops.multiply(d, mask)).mean[0]

    if args.fit:
        best = score(compose(size, layers, images, pos))
        r = args.radius
        for sweep in range(2):
            for i, layer in enumerate(layers):
                bx, by = pos[i]
                for dx in range(-r, r + 1):
                    for dy in range(-r, r + 1):
                        if dx == dy == 0:
                            continue
                        trial = [p[:] for p in pos]
                        trial[i] = [bx + dx, by + dy]
                        s = score(compose(size, layers, images, trial))
                        if s < best - 1e-6:
                            best, pos = s, trial
                print(f"pass {sweep + 1} {layer['file']} at {pos[i]} score {best:.3f}", flush=True)
        for layer, p in zip(layers, pos):
            layer["at"] = p
        recipe_path.write_text(json.dumps(recipe, indent=4) + "\n", encoding="utf-8")

    out = compose(size, layers, images, pos)
    out_path = base_dir / recipe["output"]
    out.save(out_path)
    if ref is not None:
        d = ImageChops.difference(out, ref).convert("L")
        d.point(lambda v: 255 if v > 24 else 0).save(out_path.with_name(out_path.stem + "-diff.png"))
        print(f"mean difference {ImageStat.Stat(d).mean[0]:.3f}, outside excluded boxes {score(out):.3f}")
    print(f"wrote {out_path}")


if __name__ == "__main__":
    main()
