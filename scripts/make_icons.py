"""Generate FitCoach PWA icons (PNG + SVG)."""
from PIL import Image, ImageDraw, ImageFont
import os

OUT = os.path.join(os.path.dirname(__file__), "..", "icons")
os.makedirs(OUT, exist_ok=True)

BG = (11, 11, 11)           # near-black
RING = (52, 211, 153)       # accent green
TEXT = (244, 244, 245)


def draw_icon(size, maskable=False):
    img = Image.new("RGB", (size, size), BG)
    d = ImageDraw.Draw(img)

    pad = size * (0.18 if maskable else 0.08)
    r = (size - 2 * pad) / 2
    cx, cy = size / 2, size / 2
    # Outer ring (thick)
    stroke = max(4, int(size * 0.07))
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=RING, width=stroke)

    # Inner spark / "F" mark
    # Draw a checkmark-ish curve using a stylized "F"
    font_size = int(size * 0.42)
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", font_size)
    except OSError:
        font = ImageFont.load_default()
    text = "F"
    bbox = d.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    d.text((cx - tw / 2 - bbox[0], cy - th / 2 - bbox[1] - size * 0.02), text, fill=TEXT, font=font)
    return img


for size in [120, 152, 167, 180, 192, 512]:
    img = draw_icon(size, maskable=False)
    if size in (192, 512):
        img.save(os.path.join(OUT, f"icon-{size}.png"), "PNG")
    if size == 180 or size in (120, 152, 167):
        img.save(os.path.join(OUT, f"apple-touch-icon-{size}.png"), "PNG")

draw_icon(512, maskable=True).save(os.path.join(OUT, "icon-maskable-512.png"), "PNG")

# SVG fallback
svg = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192">
<rect width="192" height="192" rx="36" fill="#0b0b0b"/>
<circle cx="96" cy="96" r="70" fill="none" stroke="#34d399" stroke-width="14"/>
<text x="96" y="124" text-anchor="middle" font-family="-apple-system, sans-serif" font-weight="700" font-size="92" fill="#f4f4f5">F</text>
</svg>"""
with open(os.path.join(OUT, "icon.svg"), "w") as f:
    f.write(svg)

print("done")
