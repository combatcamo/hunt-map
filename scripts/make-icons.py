#!/usr/bin/env python3
"""Generate app icons (needs Pillow). Simple: black field, orange topo rings + crosshair."""
import os
from PIL import Image, ImageDraw
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "icons")
os.makedirs(OUT, exist_ok=True)
def icon(size, pad_frac=0.0, bg=(0, 0, 0)):
    S = size * 4
    im = Image.new("RGB", (S, S), bg); d = ImageDraw.Draw(im)
    c = S / 2; r0 = S * (0.42 - pad_frac)
    for i, f in enumerate((1.0, 0.78, 0.56)):  # contour-like rings
        r = r0 * f
        d.ellipse([c - r, c - r * 0.86, c + r, c + r * 0.86], outline=(70, 120, 60), width=int(S * 0.018))
    w = int(S * 0.045); L = r0 * 1.05
    org = (255, 159, 26)
    d.line([c, c - L, c, c - r0 * 0.25], fill=org, width=w); d.line([c, c + r0 * 0.25, c, c + L], fill=org, width=w)
    d.line([c - L, c, c - r0 * 0.25, c], fill=org, width=w); d.line([c + r0 * 0.25, c, c + L, c], fill=org, width=w)
    rr = r0 * 0.5; d.ellipse([c - rr, c - rr, c + rr, c + rr], outline=org, width=w)
    d.ellipse([c - S * 0.03, c - S * 0.03, c + S * 0.03, c + S * 0.03], fill=org)
    return im.resize((size, size), Image.LANCZOS)
icon(192).save(os.path.join(OUT, "icon-192.png"))
icon(512).save(os.path.join(OUT, "icon-512.png"))
icon(512, pad_frac=0.1).save(os.path.join(OUT, "icon-maskable-512.png"))
icon(180).save(os.path.join(OUT, "apple-touch-icon.png"))
print("icons written to", OUT)
