"""
figma-ui assets: raw Figma exports -> shipped WebP files + manifest.json.

Usage: python assets.py <path to figma-ui.config.json>   (needs Pillow)

Reads the config's "assets" section. For each listed asset it expects
<rawDir>/<name>.png, a 2x render downloaded straight from Figma, and:
  1. fails if two raw exports are byte-identical (export once, alias instead);
  2. encodes "photo" assets as lossy WebP q85 and everything else lossless;
  3. for "mask-source" assets also writes <name>-mask.webp, an alpha mask with
     the drop shadow removed: a' = (a - 128) * 255 / 127 clamped at 0, so shadow
     alpha (<= 0.5) drops to 0, the shape stays fully opaque and edge
     antialiasing keeps a ramp;
  4. writes manifest.json: per logical name the file, bytes, sha1, intrinsic
     2x pixel size, Figma node id and the node's layout size in design px.

Encodes with cwebp when it is on PATH, otherwise with Pillow's libwebp. Either
is deterministic for a fixed encoder version.
"""

import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image


def sha1(p: Path) -> str:
    return hashlib.sha1(p.read_bytes()).hexdigest()


def encode(src: Path, dst: Path, lossy: bool) -> None:
    if shutil.which("cwebp"):
        args = ["cwebp", "-quiet", "-mt"]
        args += ["-q", "85"] if lossy else ["-lossless", "-z", "9"]
        subprocess.run(args + [str(src), "-o", str(dst)], check=True)
        return
    with Image.open(src) as im:
        if lossy:
            im.save(dst, "WEBP", quality=85, method=6)
        else:
            im.save(dst, "WEBP", lossless=True, quality=100, method=6)


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit("usage: assets.py <figma-ui.config.json>")
    config_path = Path(sys.argv[1]).resolve()
    root = config_path.parent
    cfg = json.loads(config_path.read_text(encoding="utf-8")).get("assets")
    if not cfg:
        sys.exit("figma-ui.config.json has no \"assets\" section")
    raw = root / cfg["rawDir"]
    out = root / cfg["outDir"]
    assets = cfg["list"]

    missing = [n for n in assets if not (raw / f"{n}.png").exists()]
    if missing:
        sys.exit(f"missing raw exports in {cfg['rawDir']}: {missing}")

    by_hash: dict[str, str] = {}
    for name in assets:
        h = sha1(raw / f"{name}.png")
        if h in by_hash:
            sys.exit(f"DUPLICATE EXPORT: {name} is byte-identical to {by_hash[h]}; export once and alias instead")
        by_hash[h] = name

    out.mkdir(parents=True, exist_ok=True)
    manifest: dict = {"_source": cfg["source"], "aliases": cfg.get("aliases", {}), "assets": {}}
    total = 0
    for name, spec in assets.items():
        src = raw / f"{name}.png"
        with Image.open(src) as im:
            iw, ih = im.size
        dst = out / f"{name}.webp"
        encode(src, dst, lossy=spec["kind"] == "photo")
        entries = [(name, dst)]
        if spec["kind"] == "mask-source":
            with Image.open(src) as im:
                alpha = im.convert("RGBA").getchannel("A").point(lambda v: max(0, round((v - 128) * 255 / 127)))
            mask = Image.new("RGBA", (iw, ih), (255, 255, 255, 0))
            mask.putalpha(alpha)
            tmp = raw / f"{name}-mask.tmp.png"
            mask.save(tmp)
            mdst = out / f"{name}-mask.webp"
            encode(tmp, mdst, lossy=False)
            tmp.unlink()
            entries.append((f"{name}-mask", mdst))
        for ename, epath in entries:
            b = epath.stat().st_size
            total += b
            manifest["assets"][ename] = {
                "file": epath.name,
                "bytes": b,
                "sha1": sha1(epath),
                "px": [iw, ih],
                "node": {"id": spec["node"], "w": spec["w"], "h": spec["h"]},
                "kind": spec["kind"],
            }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=4) + "\n", encoding="utf-8")
    print(f"{len(manifest['assets'])} assets, {total / 1024:.0f} KB total -> {cfg['outDir']}")


if __name__ == "__main__":
    main()
