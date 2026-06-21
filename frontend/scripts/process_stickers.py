#!/usr/bin/env python3
"""
Sticker pipeline: prune -> downscale -> ASCII-rename -> regenerate manifest.

Why:
  - Source stickers live under unicode/space folder names (e.g. "pack 1/.𝐁𝐎𝐍𝐔𝐒/")
    which break URL resolution on static hosts (the fallback the user saw).
  - The referenced subset is 1018 full-res PNGs (~424MB, avg 407KB) — far too
    heavy for a static deploy or git, and the actual on-canvas display size is
    only 80px (max 260px). 407KB PNGs to paint an 80px sticker is what *causes*
    moodboard lag; downscaling makes it faster, not slower.

What it does:
  - Reads the OLD manifest (src/sticker-manifest.json) — the curated 1018-file
    subset — so we copy ONLY what the app references, not the 2GB on disk.
  - For each pack i (1-indexed), writes ASCII files to
    public/stickers/pack-<i>/<n>.png  (n = 0-based index within the pack).
  - Downscales each PNG so its longest side <= MAX_PX (384), preserving aspect
    ratio + alpha. 384px is 4.8x the 80px display and 1.5x the 260px canvas max
    — sharper than retina needs, zero visible blur. Skips upscaling.
  - Optimizes PNG (optimize=True) — near-lossless, just strips slack.
  - Writes a NEW manifest keyed by the SAME pack keys ("pack 1"...) the app's
    STICKER_LABELS map expects, pointing at the new /stickers/pack-<i>/<n>.png.

Run from frontend/:  python scripts/process_stickers.py
"""

import json
import os
import sys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
FRONTEND = os.path.dirname(HERE)
OLD_MANIFEST = os.path.join(FRONTEND, "src", "sticker-manifest.json")
PUBLIC = os.path.join(FRONTEND, "public")
OUT_ROOT = os.path.join(PUBLIC, "stickers")          # we overwrite in place
NEW_MANIFEST = os.path.join(FRONTEND, "src", "sticker-manifest.json")

MAX_PX = 384  # longest-side ceiling; 4.8x the 80px display size

def pack_index(key: str) -> int:
    # "pack 1" -> 1, "pack 23" -> 23
    return int(key.strip().split()[-1])

def main():
    with open(OLD_MANIFEST, encoding="utf-8") as f:
        manifest = json.load(f)

    # Resolve source files BEFORE we touch the output dirs (output dir == source
    # root, so we stage to a temp dir then swap).
    staged = {}  # pack key -> list of (src_abs, out_rel)
    total = 0
    missing = 0
    for key, files in manifest.items():
        idx = pack_index(key)
        out_list = []
        for n, web_path in enumerate(files):
            src_abs = os.path.join(PUBLIC, web_path.lstrip("/").replace("/", os.sep))
            if not os.path.exists(src_abs):
                missing += 1
                continue
            out_rel = f"/stickers/pack-{idx}/{n}.png"
            out_list.append((src_abs, out_rel))
            total += 1
        staged[key] = out_list

    print(f"[stickers] referenced={sum(len(v) for v in manifest.values())} "
          f"resolvable={total} missing={missing}")

    # Stage into a sibling temp dir so we never read+write the same tree.
    tmp_root = os.path.join(PUBLIC, "_stickers_tmp")
    if os.path.exists(tmp_root):
        import shutil
        shutil.rmtree(tmp_root)

    new_manifest = {}
    done = 0
    bytes_out = 0
    for key, out_list in staged.items():
        idx = pack_index(key)
        pack_dir = os.path.join(tmp_root, f"pack-{idx}")
        os.makedirs(pack_dir, exist_ok=True)
        web_paths = []
        for src_abs, out_rel in out_list:
            n = os.path.splitext(os.path.basename(out_rel))[0]
            out_abs = os.path.join(pack_dir, f"{n}.png")
            try:
                im = Image.open(src_abs)
                im = im.convert("RGBA")
                w, h = im.size
                longest = max(w, h)
                if longest > MAX_PX:
                    scale = MAX_PX / longest
                    im = im.resize((max(1, round(w * scale)), max(1, round(h * scale))),
                                   Image.LANCZOS)
                im.save(out_abs, format="PNG", optimize=True)
                bytes_out += os.path.getsize(out_abs)
                web_paths.append(out_rel)
                done += 1
                if done % 100 == 0:
                    print(f"  ...{done}/{total}")
            except Exception as exc:
                print(f"  [warn] {src_abs}: {exc}", file=sys.stderr)
        new_manifest[key] = web_paths

    # Swap: move every pack-<i> dir from tmp into stickers/, leaving the original
    # "pack N" unicode dirs untouched on disk (gitignored, not deployed).
    for key in new_manifest:
        idx = pack_index(key)
        src = os.path.join(tmp_root, f"pack-{idx}")
        dst = os.path.join(OUT_ROOT, f"pack-{idx}")
        if os.path.exists(dst):
            import shutil
            shutil.rmtree(dst)
        os.makedirs(OUT_ROOT, exist_ok=True)
        os.replace(src, dst)
    import shutil
    shutil.rmtree(tmp_root, ignore_errors=True)

    with open(NEW_MANIFEST, "w", encoding="utf-8") as f:
        json.dump(new_manifest, f, ensure_ascii=True, indent=2)

    print(f"[stickers] wrote {done} files, {round(bytes_out/1e6,1)}MB total "
          f"(avg {round(bytes_out/max(done,1)/1024,1)}KB), manifest updated")

if __name__ == "__main__":
    main()
