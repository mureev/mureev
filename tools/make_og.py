#!/usr/bin/env python3
"""Regenerates content/assets/og.png — the 1200x630 social-preview card,
drawn to match the site: same colors, same logo, same prompt.

Run from the repo root: python3 tools/make_og.py  (needs Pillow + DejaVu fonts)
Only needed when the card itself changes; the PNG is committed."""
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H = 1200, 630
BG = (10, 14, 11)
FG = (52, 255, 109)
DIM = (46, 160, 88)
HI = (224, 255, 233)

MONO = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
MONO_B = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"

logo = [
    " ██████╗███╗   ███╗",
    "██╔════╝████╗ ████║",
    "██║     ██╔████╔██║",
    "██║     ██║╚██╔╝██║",
    "╚██████╗██║ ╚═╝ ██║",
    " ╚═════╝╚═╝     ╚═╝",
]

img = Image.new("RGB", (W, H), BG)

# --- text layer (drawn twice: blurred for glow, then sharp) ---
txt = Image.new("RGB", (W, H), (0, 0, 0))
d = ImageDraw.Draw(txt)

f_logo = ImageFont.truetype(MONO_B, 26)
f_ps = ImageFont.truetype(MONO, 30)
f_name = ImageFont.truetype(MONO_B, 74)
f_sub = ImageFont.truetype(MONO, 32)

X = 84
y = 66
for ln in logo:
    d.text((X, y), ln, font=f_logo, fill=HI)
    y += 30

y += 44
ps1 = "constantine@mureev.com:~$ "
d.text((X, y), ps1, font=f_ps, fill=DIM)
d.text((X + d.textlength(ps1, font=f_ps), y), "whoami", font=f_ps, fill=HI)

y += 64
d.text((X, y), "Constantine Mureev", font=f_name, fill=HI)

y += 106
d.text((X, y), "engineering leader · fintech @ Renmoney", font=f_sub, fill=FG)
y += 46
d.text((X, y), "Yoshkar-Ola, Russia", font=f_sub, fill=FG)

y += 72
d.text((X, y), ps1, font=f_ps, fill=DIM)
cx = X + d.textlength(ps1, font=f_ps)
d.rectangle([cx, y + 2, cx + 18, y + 34], fill=FG)

glow = txt.filter(ImageFilter.GaussianBlur(5))
img = Image.blend(img, Image.composite(glow, img, glow.convert("L").point(lambda p: min(255, p * 2))), 0.55)
sharp_mask = txt.convert("L").point(lambda p: 255 if p > 24 else 0)
img.paste(txt, (0, 0), sharp_mask)

# --- scanlines ---
d2 = ImageDraw.Draw(img, "RGBA")
for sy in range(0, H, 3):
    d2.line([(0, sy), (W, sy)], fill=(0, 0, 0, 46))

# --- vignette ---
vig = Image.new("L", (W, H), 0)
dv = ImageDraw.Draw(vig)
dv.ellipse([-W * 0.35, -H * 0.55, W * 1.35, H * 1.55], fill=255)
vig = vig.filter(ImageFilter.GaussianBlur(120))
black = Image.new("RGB", (W, H), (0, 0, 0))
img = Image.composite(img, black, vig.point(lambda p: 100 + p * 155 // 255))

img.save("content/assets/og.png", optimize=True)
print("og.png:", img.size)
