"""Build platform icon assets from the generated source PNG.

Reads the wide source rendering, crops to a centered square, and emits:
  build/icon.png   1024x1024  (Linux + electron-builder source-of-truth)
  build/icon.ico   multi-res  (Windows)
  build/icon.icns  multi-res  (macOS)
"""

from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "icon.png"
BUILD = ROOT / "build"
BUILD.mkdir(exist_ok=True)


def center_square_crop(img: Image.Image) -> Image.Image:
    w, h = img.size
    side = min(w, h)
    left = (w - side) // 2
    top = (h - side) // 2
    return img.crop((left, top, left + side, top + side))


def main() -> None:
    img = Image.open(SRC).convert("RGBA")
    square = center_square_crop(img)
    target = square.resize((1024, 1024), Image.LANCZOS)
    target.save(BUILD / "icon.png", format="PNG", optimize=True)

    ico_sizes = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)]
    target.save(BUILD / "icon.ico", format="ICO", sizes=ico_sizes)

    icns_sizes = [(16, 16), (32, 32), (64, 64), (128, 128), (256, 256), (512, 512), (1024, 1024)]
    try:
        target.save(BUILD / "icon.icns", format="ICNS", sizes=icns_sizes)
    except (ValueError, OSError) as exc:
        # PIL on Windows can sometimes refuse certain ICNS configs; that's fine —
        # electron-builder will fall back to converting icon.png on macOS builds.
        print(f"icns skipped: {exc}")

    for p in BUILD.iterdir():
        if p.is_file():
            print(f"  {p.name:14}  {p.stat().st_size:>8} bytes")


if __name__ == "__main__":
    main()
