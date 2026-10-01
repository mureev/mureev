#!/usr/bin/env python3
"""Regenerates the raster favicons from the same design as favicon.svg:
a phosphor prompt chevron and a lit block cursor on the terminal's dark tile.

  content/favicon.ico        16 + 32 + 48, each drawn at its own size
                             (downscaling a master goes mushy at 16px —
                             pixels are placed per size instead)
  content/apple-touch-icon.png  180x180, full-bleed (iOS applies the mask),
                             with a touch of phosphor glow

Run from the repo root: python3 tools/make_favicon.py  (needs Pillow)
favicon.svg is the source of truth for the design; keep them in sync.
"""
from PIL import Image, ImageDraw, ImageFilter

BG = (10, 14, 11, 255)       # --bg
FG = (52, 255, 109, 255)     # --fg
HI = (224, 255, 233, 255)    # --fg-hi


def tile(s, rounded=True):
    """Draw the design at size s, coordinates snapped to whole pixels."""
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=max(2, round(s * 0.14)), fill=BG)
    else:
        d.rectangle([0, 0, s, s], fill=BG)

    w = max(2, round(s * 0.11))                      # chevron stroke
    x0, xm = round(s * 0.20), round(s * 0.44)
    y0, ym, y1 = round(s * 0.30), round(s * 0.50), round(s * 0.70)
    d.line([(x0, y0), (xm, ym), (x0, y1)], fill=FG, width=w, joint="curve")

    bx0, bx1 = round(s * 0.56), round(s * 0.80)      # the cursor, lit
    by0, by1 = round(s * 0.34), round(s * 0.67)
    d.rectangle([bx0, by0, bx1, by1], fill=HI)
    return img


# favicon.ico — three sizes, each drawn natively
i16, i32, i48 = tile(16), tile(32), tile(48)
i48.save("content/favicon.ico", sizes=[(48, 48), (32, 32), (16, 16)],
         append_images=[i32, i16])

# apple-touch-icon — full bleed + subtle glow (iOS rounds it itself)
s = 180
base = tile(s, rounded=False)
glow = base.filter(ImageFilter.GaussianBlur(4))
apple = Image.alpha_composite(glow, base).convert("RGB")
apple.save("content/apple-touch-icon.png", optimize=True)

print("favicon.ico (16/32/48) + apple-touch-icon.png (180) written")
