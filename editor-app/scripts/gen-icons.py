#!/usr/bin/env python3
"""Generate candidate app icons for WriteIt (1024x1024 RGB PNG, RGBA square base)."""
import math
from PIL import Image, ImageDraw, ImageFont

SIZE = 1024
OUT = "icon-candidates"
import os
os.makedirs(OUT, exist_ok=True)

def new_canvas():
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    return img, ImageDraw.Draw(img)

def rounded_rect(d, box, radius, fill):
    d.rounded_rectangle(box, radius=radius, fill=fill)

def radial_gradient(size, top, bottom):
    """Draw vertical linear gradient background within an RGBA image (0=transparent)."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    px = img.load()
    t = 1.0
    (tr, tg, tb) = top
    (br, bg, bb) = bottom
    for y in range(size):
        f = y / (size - 1)
        r = int(tr + (br - tr) * f)
        g = int(tg + (bg - tg) * f)
        b = int(tb + (bb - tb) * f)
        for x in range(size):
            px[x, y] = (r, g, b, 255)
    return img

def paste_circle(img, d, cx, cy, r, fill):
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=fill)

def load_font(size, bold=True):
    paths = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    ]
    import os
    try:
        for p in paths:
            if os.path.exists(p):
                return ImageFont.truetype(p, size)
    except Exception:
        pass
    return ImageFont.load_default()

# ---------------------------------------------------------------
# Candidate 1: W monogram + cursor line (deep blue gradient disc)
# ---------------------------------------------------------------
def cand_w_monogram():
    img, d = new_canvas()
    # background circle with vertical gradient
    bg = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    grad = radial_gradient(SIZE, (26, 42, 86), (9, 13, 40))
    # mask
    mask = Image.new("L", (SIZE, SIZE), 0)
    md = ImageDraw.Draw(mask)
    md.ellipse([90, 90, 934, 934], fill=255)
    img = Image.composite(grad, bg, mask)
    d = ImageDraw.Draw(img)
    # soft ring highlight
    d.ellipse([90, 90, 934, 934], outline=(255, 255, 255, 40), width=6)
    # White "W" monogram
    font = load_font(640)
    text = "W"
    bbox = d.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (SIZE - tw) / 2 - bbox[0]
    y = (SIZE - th) / 2 - bbox[1] - 20
    d.text((x, y), text, font=font, fill=(255, 255, 255, 255))
    # cursor line under W
    x0, y0, x1, y1 = 560, 690, 566, 760
    rounded_rect(d, [x0, y0, x1, y1], 8, (255, 170, 60, 255))
    return img

# ---------------------------------------------------------------
# Candidate 2: Notecard + cursor (warm cream card, orange accent)
# ---------------------------------------------------------------
def cand_notecard():
    img, d = new_canvas()
    # soft background disc (light warm)
    bg = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    grad = radial_gradient(SIZE, (255, 196, 84), (255, 145, 60))
    mask = Image.new("L", (SIZE, SIZE), 0)
    md = ImageDraw.Draw(mask)
    md.ellipse([90, 90, 934, 934], fill=255)
    img = Image.composite(grad, bg, mask)
    d = ImageDraw.Draw(img)
    # cream notecard with folded corner -> draw slightly rotated manually via polygon is complex,
    # use a rounded rect card and a corner triangle
    # card body
    card_top = 200
    rounded_rect(d, [230, card_top, 794, 790], 46, (255, 250, 240, 255))
    # folded corner triangle (bottom-right)
    d.polygon([(794, 620), (794, 790), (614, 790)], fill=(255, 190, 90, 255))
    # card top fold line edge
    d.polygon([(794, 620), (614, 790), (620, 784), (788, 610)], fill=(240, 140, 60, 255))  # subtle shade
    # text lines on card
    line_gap = 74
    y = card_top + 130
    for i in range(3):
        x0 = 300
        x1 = x0 + (420 if i % 2 == 0 else 330)
        rounded_rect(d, [x0, y, x1, y + 30], 15, (216, 196, 168, 220))
        y += line_gap
    # cursor line
    rounded_rect(d, [300, y - 15, 308, y + 45], 8, (255, 92, 60, 255))
    return img

# ---------------------------------------------------------------
# Candidate 3: Pen nib (dark slate + gold nib)
# ---------------------------------------------------------------
def cand_pen():
    img, d = new_canvas()
    bg = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    grad = radial_gradient(SIZE, (40, 46, 58), (16, 20, 28))
    mask = Image.new("L", (SIZE, SIZE), 0)
    md = ImageDraw.Draw(mask)
    md.ellipse([90, 90, 934, 934], fill=255)
    img = Image.composite(grad, bg, mask)
    d = ImageDraw.Draw(img)
    # nib shape: a downward diamond with a split tip
    # body (trapezoid upper) + point
    gold = (212, 175, 55, 255)
    gold_light = (240, 210, 120, 255)
    # upper body rectangle-ish
    d.polygon([(340, 220), (684, 220), (724, 520), (300, 520)], fill=gold)
    # point downward
    d.polygon([(300, 520), (724, 520), (512, 880)], fill=(180, 140, 40, 255))
    # nib slit line (vertical)
    rounded_rect(d, [506, 400, 518, 860], 6, (140, 110, 30, 255))
    # small ink drop at tip
    paste_circle(img, d, 512, 868, 30, (88, 160, 220, 255))
    # thin horizontal band
    rounded_rect(d, [330, 270, 694, 296], 6, (240, 210, 120, 255))
    return img

# ---------------------------------------------------------------
# Candidate 4: Ink bottle (vintage glass + ink)
# ---------------------------------------------------------------
def cand_bottle():
    img, d = new_canvas()
    bg = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    grad = radial_gradient(SIZE, (52, 58, 78), (22, 26, 38))
    mask = Image.new("L", (SIZE, SIZE), 0)
    md = ImageDraw.Draw(mask)
    md.ellipse([90, 90, 934, 934], fill=255)
    img = Image.composite(grad, bg, mask)
    d = ImageDraw.Draw(img)
    # bottle neck (cork + neck)
    rounded_rect(d, [420, 200, 604, 300], 18, (160, 120, 70, 255))       # cork
    rounded_rect(d, [420, 300, 604, 420], 18, (235, 235, 235, 255))      # glass neck
    # bottle body
    rounded_rect(d, [330, 420, 694, 860], 70, (225, 228, 235, 255))
    # glass highlight
    rounded_rect(d, [360, 440, 420, 700], 30, (250, 250, 255, 160))
    # ink inside bottom
    d.polygon([(340, 700), (684, 700), (660, 850), (364, 850)], fill=(64, 80, 150, 255))
    # ink surface line
    rounded_rect(d, [338, 690, 686, 706], 4, (40, 48, 90, 255))
    # nib resting on top / small quill
    d.line([(604, 250), (760, 160)], fill=(210, 215, 225, 255), width=20)
    d.line([(760, 160), (820, 120)], fill=(230, 150, 60, 255), width=26)
    return img

# ---------------------------------------------------------------
# Candidate 5: Minimal "W" chat/write bubble
# ---------------------------------------------------------------
def cand_bubble():
    img, d = new_canvas()
    grad = radial_gradient(SIZE, (56, 178, 140), (24, 120, 92))  # teal/green
    bg = Image.new("RGBA", (SIZE, SIZE), (0,0,0,0))
    mask = Image.new("L", (SIZE, SIZE), 0)
    md = ImageDraw.Draw(mask)
    md.ellipse([90,90,934,934], fill=255)
    img = Image.composite(grad, bg, mask)
    d = ImageDraw.Draw(img)
    # white rounded square
    rounded_rect(d, [230, 230, 794, 794], 120, (255,255,255,255))
    # W text in primary color
    font = load_font(470)
    text = "W"
    bbox = d.textbbox((0,0), text, font=font)
    tw, th = bbox[2]-bbox[0], bbox[3]-bbox[1]
    x = (SIZE-tw)/2 - bbox[0]
    y = (SIZE-th)/2 - bbox[1] - 10
    d.text((x, y), text, font=font, fill=(22, 110, 84, 255))
    # cursor dot
    paste_circle(img, d, 590, 720, 34, (255, 110, 60, 255))
    return img

items = {
    "1-w-monogram": cand_w_monogram,
    "2-notecard":   cand_notecard,
    "3-pen-nib":    cand_pen,
    "4-ink-bottle": cand_bottle,
    "5-w-bubble":   cand_bubble,
}

for name, fn in items.items():
    img = fn()
    img.save(f"{OUT}/{name}.png")
    print("saved", name)
print("done")
