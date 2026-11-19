#!/usr/bin/env python3
"""Draws the Ludo Pro artwork: logo.png, app-icon.png, splash-screen.png, the
menu background and the coin icon. Everything is rendered procedurally with
Pillow + numpy (3D shaded tokens, isometric dice, golden border).

Usage:  python3 scripts/make_images.py
Developer: Sanaullah Khoso
"""
import os, math, random
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
IMG = os.path.join(ROOT, 'www', 'assets', 'images')
ICO = os.path.join(ROOT, 'www', 'assets', 'icons')
ASSETS = os.path.join(ROOT, 'assets')   # input for @capacitor/assets (native icons + splash)

FONT_CANDIDATES = [
    '/usr/share/fonts/truetype/google-fonts/Poppins-Bold.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/freefont/FreeSansBold.ttf',
    'DejaVuSans-Bold.ttf',
]

GOLD = [(0, (255, 246, 176)), (0.30, (255, 210, 60)), (0.62, (240, 158, 0)), (1, (146, 86, 0))]
SILVER = [(0, (255, 255, 255)), (0.5, (214, 224, 246)), (1, (132, 148, 196))]
PAWN_COLORS = {
    'red': (226, 30, 30), 'green': (22, 168, 36),
    'yellow': (248, 188, 0), 'blue': (24, 108, 228),
}


def font(size):
    for p in FONT_CANDIDATES:
        try:
            return ImageFont.truetype(p, size)
        except OSError:
            continue
    return ImageFont.load_default()


def radial(size, cx, cy, r, c_in, c_out):
    w, h = size
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    d = np.clip(np.sqrt((x - cx) ** 2 + (y - cy) ** 2) / r, 0, 1)[..., None]
    arr = np.array(c_in, np.float32) * (1 - d) + np.array(c_out, np.float32) * d
    return Image.fromarray(arr.astype('uint8'), 'RGB')


def vgrad(w, h, stops):
    ys = np.linspace(0, 1, max(h, 1))
    out = np.zeros((max(h, 1), w, 3), np.float32)
    for c in range(3):
        out[:, :, c] = np.interp(ys, [p for p, _ in stops], [col[c] for _, col in stops])[:, None]
    return Image.fromarray(out.astype('uint8'), 'RGB')


def paste_grad(base, mask, stops):
    bbox = mask.getbbox()
    if not bbox:
        return
    x0, y0, x1, y1 = bbox
    base.paste(vgrad(x1 - x0, y1 - y0, stops), (x0, y0), mask.crop(bbox))


def rounded_mask(size, box, radius):
    m = Image.new('L', size, 0)
    ImageDraw.Draw(m).rounded_rectangle(box, radius=radius, fill=255)
    return m


def sparkle(draw, x, y, r, alpha):
    pts = [(x, y - r), (x + r * 0.22, y - r * 0.22), (x + r, y), (x + r * 0.22, y + r * 0.22),
           (x, y + r), (x - r * 0.22, y + r * 0.22), (x - r, y), (x - r * 0.22, y - r * 0.22)]
    draw.polygon(pts, fill=(255, 255, 255, alpha))


# --------------------------------------------------------------------- pawn
def draw_pawn(base, cx, base_y, height, rgb):
    """3D shaded pawn token; (cx, base_y) is the bottom centre."""
    k = height / 520.0
    W, H = int(420 * k), int(520 * k)
    x0, y0 = int(cx - W / 2), int(base_y - H)

    # soft ground shadow
    sh = Image.new('RGBA', base.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).ellipse((cx - 190 * k, base_y - 34 * k, cx + 190 * k, base_y + 44 * k), fill=(0, 0, 0, 150))
    base.alpha_composite(sh.filter(ImageFilter.GaussianBlur(14 * k)))

    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    X, Y = xx / k, yy / k
    out = np.zeros((H, W, 4), np.float32)
    L = np.array([-0.5, -0.62, 0.62], np.float32); L /= np.linalg.norm(L)
    col0 = np.array(rgb, np.float32)

    def shade(mask, nx, ny, nz, amb=0.30, spec_pow=30, spec_k=0.85):
        n = np.stack([nx, ny, nz], -1)
        n = n / np.maximum(np.linalg.norm(n, axis=-1, keepdims=True), 1e-6)
        dl = (n * L).sum(-1)
        diff = np.clip(dl, 0, 1)
        refl_z = 2 * dl * n[..., 2] - L[2]
        spec = np.clip(refl_z, 0, 1) ** spec_pow
        c = col0 * (amb + 0.85 * diff[..., None]) + 255 * spec[..., None] * spec_k
        c = np.clip(c, 0, 255)
        out[mask, :3] = c[mask]
        out[mask, 3] = 255

    cxr = 210.0
    # base disc: side + top
    side = (((X - cxr) / 176) ** 2 + ((Y - 486) / 40) ** 2 <= 1) | ((np.abs(X - cxr) <= 176) & (Y >= 468) & (Y <= 486))
    nx = (X - cxr) / 176
    shade(side, nx, np.zeros_like(nx), np.sqrt(np.clip(1 - nx ** 2, 0, 1)), amb=0.22)
    top = ((X - cxr) / 176) ** 2 + ((Y - 468) / 40) ** 2 <= 1
    shade(top, np.zeros_like(X), np.full_like(X, -0.75), np.full_like(X, 0.65), amb=0.35)

    # body: concave flare
    t = np.clip((Y - 215) / 255.0, 0, 1)
    hw = 54 + 116 * t ** 2.2
    body = (np.abs(X - cxr) <= hw) & (Y >= 215) & (Y <= 470)
    nxb = np.clip((X - cxr) / np.maximum(hw, 1), -1, 1)
    shade(body, nxb, np.full_like(X, -0.28), np.sqrt(np.clip(1 - nxb ** 2, 0, 1)))

    # collar ring
    ex, ey = (X - cxr) / 96, (Y - 224) / 28
    collar = ex ** 2 + ey ** 2 <= 1
    shade(collar, ex, ey * 0.8 - 0.3, np.sqrt(np.clip(1 - ex ** 2 - ey ** 2, 0, 1)) + 0.2)

    # head sphere
    sx, sy = (X - cxr) / 92, (Y - 128) / 92
    head = sx ** 2 + sy ** 2 <= 1
    shade(head, sx, sy, np.sqrt(np.clip(1 - sx ** 2 - sy ** 2, 0, 1)), amb=0.28, spec_pow=22, spec_k=0.95)

    # dark rim for definition
    img = Image.fromarray(out.astype('uint8'), 'RGBA')
    edge = img.getchannel('A').filter(ImageFilter.FIND_EDGES).filter(ImageFilter.GaussianBlur(max(1, 3 * k)))
    rim = Image.new('RGBA', img.size, (20, 10, 30, 0))
    rim.putalpha(edge.point(lambda v: min(255, v * 2)))
    img.alpha_composite(rim)
    base.alpha_composite(img, (x0, y0))


# --------------------------------------------------------------------- dice
def iso(cx, cy, h, x, y, z):
    return (cx + (x - y) * 0.866 * h, cy + (x + y) * 0.5 * h - z * h)


def draw_dice(base, cx, cy, h):
    """Isometric 3D dice; h is half the projected edge length."""
    faces = {
        'top':   ([(-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)], (255, 255, 255), (0, 0, 1), (1, 0, 0), (0, 1, 0), 5),
        'left':  ([(-1, 1, 1), (1, 1, 1), (1, 1, -1), (-1, 1, -1)], (222, 229, 246), (0, 1, 0), (1, 0, 0), (0, 0, -1), 3),
        'right': ([(1, -1, 1), (1, 1, 1), (1, 1, -1), (1, -1, -1)], (180, 193, 222), (1, 0, 0), (0, 1, 0), (0, 0, -1), 2),
    }
    pips = {
        1: [(0, 0)], 2: [(-.5, -.5), (.5, .5)], 3: [(-.55, -.55), (0, 0), (.55, .55)],
        4: [(-.5, -.5), (.5, -.5), (-.5, .5), (.5, .5)],
        5: [(-.52, -.52), (.52, -.52), (0, 0), (-.52, .52), (.52, .52)],
        6: [(-.5, -.55), (.5, -.55), (-.5, 0), (.5, 0), (-.5, .55), (.5, .55)],
    }
    # shadow
    sh = Image.new('RGBA', base.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).ellipse((cx - 2.1 * h, cy + 1.55 * h, cx + 2.1 * h, cy + 2.55 * h), fill=(0, 0, 0, 140))
    base.alpha_composite(sh.filter(ImageFilter.GaussianBlur(h * 0.12)))

    layer = Image.new('RGBA', base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for name in ('left', 'right', 'top'):
        pts3, color, nrm, au, av, val = faces[name]
        pts = [iso(cx, cy, h, *p) for p in pts3]
        centre = (sum(p[0] for p in pts) / 4, sum(p[1] for p in pts) / 4)
        inset = [(centre[0] + (p[0] - centre[0]) * 0.93, centre[1] + (p[1] - centre[1]) * 0.93) for p in pts]
        w = int(h * 0.14)
        d.polygon(inset, fill=color)
        d.line(inset + [inset[0]], fill=color, width=w, joint='curve')
        for p in inset:
            d.ellipse((p[0] - w / 2, p[1] - w / 2, p[0] + w / 2, p[1] + w / 2), fill=color)
        # pips drawn as small projected circles
        centre3 = [0.0, 0.0, 0.0]
        for i in range(3):
            centre3[i] = nrm[i]
        for (u, v) in pips[val]:
            c3 = [centre3[i] + au[i] * u * 0.9 + av[i] * v * 0.9 for i in range(3)]
            ring = []
            for a in range(0, 360, 12):
                r = 0.19
                ca, sa = math.cos(math.radians(a)) * r, math.sin(math.radians(a)) * r
                p3 = [c3[i] + au[i] * ca + av[i] * sa for i in range(3)]
                ring.append(iso(cx, cy, h, *p3))
            d.polygon(ring, fill=(18, 24, 60))
            hl = [(x - h * 0.012, y - h * 0.025) for x, y in ring]
            d.polygon([(cx_ + (x - cx_) * 0.45, cy_ + (y - cy_) * 0.45) for (cx_, cy_) in
                       [(sum(q[0] for q in ring) / len(ring), sum(q[1] for q in ring) / len(ring))] for x, y in hl],
                      fill=(70, 80, 140))
    base.alpha_composite(layer)
    # edge highlights
    d2 = ImageDraw.Draw(base)
    top = [iso(cx, cy, h, *p) for p in faces['top'][0]]
    d2.line([top[0], top[1], top[2]], fill=(255, 255, 255, 230), width=max(2, int(h * 0.03)))


# -------------------------------------------------------------------- crown
def draw_crown(base, cx, cy, w, h):
    m = Image.new('L', base.size, 0)
    d = ImageDraw.Draw(m)
    x0, x1 = cx - w / 2, cx + w / 2
    yb = cy + h / 2
    ytop = cy - h / 2
    band_top = yb - h * 0.26
    pts = [(x0, band_top), (x0, ytop + h * 0.12), (x0 + w * 0.22, band_top - h * 0.18),
           (cx - w * 0.17, ytop + h * 0.02), (cx, band_top - h * 0.30), (cx + w * 0.17, ytop + h * 0.02),
           (x1 - w * 0.22, band_top - h * 0.18), (x1, ytop + h * 0.12), (x1, band_top)]
    d.polygon(pts, fill=255)
    d.rounded_rectangle((x0 - w * 0.01, band_top - 2, x1 + w * 0.01, yb), radius=h * 0.12, fill=255)
    for (px, py) in [(x0, ytop + h * 0.10), (cx - w * 0.17, ytop), (cx, ytop - h * 0.02), (cx + w * 0.17, ytop), (x1, ytop + h * 0.10)]:
        r = h * 0.09
        d.ellipse((px - r, py - r, px + r, py + r), fill=255)
    outline = m.filter(ImageFilter.MaxFilter(9))
    layer = Image.new('RGBA', base.size, (0, 0, 0, 0))
    layer.paste((92, 52, 0, 255), mask=outline)
    paste_grad(layer, m, GOLD)
    base.alpha_composite(layer)
    d2 = ImageDraw.Draw(base)
    for jx, col in [(cx - w * 0.28, (230, 40, 60)), (cx, (40, 130, 255)), (cx + w * 0.28, (40, 200, 90))]:
        r = h * 0.075
        jy = yb - h * 0.13
        d2.ellipse((jx - r, jy - r, jx + r, jy + r), fill=col + (255,), outline=(255, 255, 255, 180), width=2)


def draw_star(base, cx, cy, r, color=(255, 215, 70)):
    pts = []
    for i in range(10):
        a = -math.pi / 2 + i * math.pi / 5
        rr = r if i % 2 == 0 else r * 0.42
        pts.append((cx + math.cos(a) * rr, cy + math.sin(a) * rr))
    d = ImageDraw.Draw(base)
    d.polygon(pts, fill=color + (255,), outline=(120, 70, 0, 255))


def gold_text(base, text, cx, cy, size, stops=GOLD, outline=16, outline_rgb=(70, 36, 0), shadow=True):
    f = font(size)
    mask = Image.new('L', base.size, 0)
    ImageDraw.Draw(mask).text((cx, cy), text, font=f, anchor='mm', fill=255)
    omask = Image.new('L', base.size, 0)
    ImageDraw.Draw(omask).text((cx, cy), text, font=f, anchor='mm', fill=255, stroke_width=outline, stroke_fill=255)
    if shadow:
        sh = Image.new('RGBA', base.size, (0, 0, 0, 0))
        sh.paste((0, 0, 0, 170), mask=omask.transform(base.size, Image.AFFINE, (1, 0, 0, 0, 1, -size * 0.07)))
        base.alpha_composite(sh.filter(ImageFilter.GaussianBlur(size * 0.04)))
    layer = Image.new('RGBA', base.size, (0, 0, 0, 0))
    layer.paste(outline_rgb + (255,), mask=omask)
    paste_grad(layer, mask, stops)
    base.alpha_composite(layer)
    # glossy highlight on the upper half of the letters
    gloss = Image.new('L', base.size, 0)
    bb = mask.getbbox()
    if bb:
        ImageDraw.Draw(gloss).rectangle((bb[0], bb[1], bb[2], bb[1] + (bb[3] - bb[1]) * 0.42), fill=70)
        from PIL import ImageChops
        gloss = ImageChops.multiply(gloss, mask)
        white = Image.new('RGBA', base.size, (255, 255, 255, 0))
        white.putalpha(gloss)
        base.alpha_composite(white)


# ------------------------------------------------------------------ artwork
def background(S, full_bleed, seed=3):
    bg = radial((S, S), S * 0.5, S * 0.40, S * 0.78, (36, 74, 170), (5, 9, 32)).convert('RGBA')
    rnd = random.Random(seed)
    layer = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for _ in range(46):
        sparkle(d, rnd.uniform(0.08, 0.92) * S, rnd.uniform(0.08, 0.92) * S, rnd.uniform(0.006, 0.02) * S, rnd.randint(70, 190))
    bg.alpha_composite(layer.filter(ImageFilter.GaussianBlur(1.2)))
    # glow behind the dice
    glow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse((S * 0.28, S * 0.20, S * 0.72, S * 0.58), fill=(120, 170, 255, 120))
    bg.alpha_composite(glow.filter(ImageFilter.GaussianBlur(S * 0.07)))
    return bg


def golden_border(img, S, margin, thick, radius):
    outer = rounded_mask((S, S), (margin, margin, S - margin, S - margin), radius)
    inner = rounded_mask((S, S), (margin + thick, margin + thick, S - margin - thick, S - margin - thick), radius - thick * 0.6)
    ring = Image.fromarray(np.clip(np.array(outer, np.int16) - np.array(inner, np.int16), 0, 255).astype('uint8'), 'L')
    layer = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    paste_grad(layer, ring, [(0, (255, 244, 170)), (0.25, (255, 205, 50)), (0.55, (200, 128, 0)), (0.8, (250, 196, 40)), (1, (120, 70, 0))])
    # dark inner line and bright outer line
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle((margin, margin, S - margin, S - margin), radius=radius, outline=(255, 250, 200, 255), width=max(2, S // 400))
    d.rounded_rectangle((margin + thick, margin + thick, S - margin - thick, S - margin - thick),
                        radius=radius - thick * 0.6, outline=(70, 38, 0, 255), width=max(3, S // 300))
    img.alpha_composite(layer)


def draw_art(S=2048, full_bleed=False, with_text=True):
    img = background(S, full_bleed)
    margin = int(S * (0.035 if not full_bleed else 0.05))
    thick = int(S * 0.034)
    radius = int(S * 0.15)
    draw_crown(img, S * 0.5, S * 0.125, S * 0.19, S * 0.095)
    draw_dice(img, S * 0.5, S * 0.385, S * 0.104)
    draw_pawn(img, S * 0.215, S * 0.485, S * 0.240, PAWN_COLORS['red'])
    draw_pawn(img, S * 0.785, S * 0.485, S * 0.240, PAWN_COLORS['green'])
    draw_pawn(img, S * 0.335, S * 0.55, S * 0.210, PAWN_COLORS['blue'])
    draw_pawn(img, S * 0.665, S * 0.55, S * 0.210, PAWN_COLORS['yellow'])
    if with_text:
        gold_text(img, 'LUDO', S * 0.5, S * 0.695, int(S * 0.205), GOLD, outline=int(S * 0.009))
        gold_text(img, 'PRO', S * 0.5, S * 0.845, int(S * 0.115), SILVER, outline=int(S * 0.006), outline_rgb=(10, 20, 70))
        for dx in (-0.255, 0.255):
            draw_star(img, S * (0.5 + dx), S * 0.845, S * 0.034)
        for dx in (-0.205, 0.205):
            draw_star(img, S * (0.5 + dx), S * 0.845, S * 0.020)
    golden_border(img, S, margin, thick, radius)
    if not full_bleed:
        mask = rounded_mask((S, S), (margin, margin, S - margin, S - margin), radius)
        rgba = Image.new('RGBA', (S, S), (0, 0, 0, 0))
        rgba.paste(img, mask=mask)
        return rgba
    return img


def save(img, path, size=None, fmt=None, **kw):
    if size:
        img = img.resize((size, size) if isinstance(size, int) else size, Image.LANCZOS)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, fmt, **kw)
    print('wrote', os.path.relpath(path, ROOT), img.size)


def make_coin(S=512):
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    m = Image.new('L', (S, S), 0)
    ImageDraw.Draw(m).ellipse((16, 16, S - 16, S - 16), fill=255)
    layer = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    layer.paste((110, 62, 0, 255), mask=m)
    inner = Image.new('L', (S, S), 0)
    ImageDraw.Draw(inner).ellipse((34, 34, S - 34, S - 34), fill=255)
    paste_grad(layer, inner, GOLD)
    img.alpha_composite(layer)
    d.ellipse((74, 74, S - 74, S - 74), outline=(140, 84, 0, 255), width=10)
    d.ellipse((84, 84, S - 84, S - 84), outline=(255, 240, 160, 200), width=4)
    d.text((S / 2, S / 2 + 6), 'L', font=font(int(S * 0.5)), anchor='mm', fill=(150, 88, 0, 255))
    d.text((S / 2 - 3, S / 2 + 2), 'L', font=font(int(S * 0.5)), anchor='mm', fill=(255, 243, 170, 255))
    return img


def make_menu_background(W=1080, H=1920):
    bg = radial((W, H), W * 0.5, H * 0.30, H * 0.85, (30, 62, 150), (4, 8, 28)).convert('RGBA')
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    rnd = random.Random(21)
    # faint board-cross pattern
    cell = 90
    for gx in range(-1, W // cell + 2):
        for gy in range(-1, H // cell + 2):
            if (gx + gy) % 2 == 0:
                d.rectangle((gx * cell, gy * cell, gx * cell + cell, gy * cell + cell), fill=(255, 255, 255, 5))
    # coloured orbs in the four ludo colours
    for (x, y, r, c) in [(0.12, 0.10, 340, (225, 30, 30)), (0.90, 0.17, 300, (22, 168, 36)),
                         (0.88, 0.86, 380, (248, 188, 0)), (0.10, 0.80, 320, (24, 108, 228))]:
        orb = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(orb).ellipse((x * W - r, y * H - r, x * W + r, y * H + r), fill=c + (46,))
        layer.alpha_composite(orb.filter(ImageFilter.GaussianBlur(120)))
    for _ in range(60):
        sparkle(d, rnd.uniform(0, W), rnd.uniform(0, H), rnd.uniform(5, 15), rnd.randint(40, 150))
    bg.alpha_composite(layer)
    return bg.convert('RGB')


def make_splash(logo, W=1080, H=1920):
    bg = make_menu_background(W, H).convert('RGBA')
    size = int(W * 0.78)
    lg = logo.resize((size, size), Image.LANCZOS)
    bg.alpha_composite(lg, ((W - size) // 2, int(H * 0.15)))
    d = ImageDraw.Draw(bg)
    d.text((W / 2, H * 0.80), 'Developed by', font=font(44), anchor='mm', fill=(190, 205, 245, 255))
    d.text((W / 2, H * 0.84), 'Sanaullah Khoso', font=font(74), anchor='mm', fill=(255, 214, 70, 255))
    return bg.convert('RGB')


def make_native_splash(logo, S=2732):
    """Square splash for @capacitor/assets (cropped per device, so keep content central)."""
    bg = radial((S, S), S * 0.5, S * 0.42, S * 0.72, (36, 74, 170), (4, 8, 28)).convert('RGBA')
    rnd = random.Random(5)
    layer = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for _ in range(70):
        sparkle(d, rnd.uniform(0.05, 0.95) * S, rnd.uniform(0.05, 0.95) * S, rnd.uniform(0.004, 0.012) * S, rnd.randint(50, 170))
    bg.alpha_composite(layer.filter(ImageFilter.GaussianBlur(1.5)))
    size = int(S * 0.36)
    bg.alpha_composite(logo.resize((size, size), Image.LANCZOS), ((S - size) // 2, int(S * 0.27)))
    d = ImageDraw.Draw(bg)
    d.text((S / 2, S * 0.69), 'Developed by', font=font(int(S * 0.016)), anchor='mm', fill=(190, 205, 245, 255))
    d.text((S / 2, S * 0.72), 'Sanaullah Khoso', font=font(int(S * 0.027)), anchor='mm', fill=(255, 214, 70, 255))
    return bg.convert('RGB')


def main():
    art = draw_art(2048, full_bleed=False)
    logo = art.resize((1024, 1024), Image.LANCZOS)
    save(logo, os.path.join(IMG, 'logo.png'))

    icon = draw_art(2048, full_bleed=True).convert('RGB')
    icon1024 = icon.resize((1024, 1024), Image.LANCZOS)
    save(icon1024, os.path.join(ICO, 'app-icon.png'))
    save(icon1024, os.path.join(ICO, 'icon-512.png'), 512)
    save(icon1024, os.path.join(ICO, 'icon-192.png'), 192)

    splash = make_splash(logo)
    save(splash, os.path.join(IMG, 'splash-screen.png'))

    # native Android inputs for @capacitor/assets
    save(icon1024, os.path.join(ASSETS, 'icon-only.png'))
    fg = Image.new('RGBA', (1024, 1024), (0, 0, 0, 0))
    inner = logo.resize((int(1024 * 0.60), int(1024 * 0.60)), Image.LANCZOS)
    fg.alpha_composite(inner, ((1024 - inner.width) // 2, (1024 - inner.height) // 2))
    save(fg, os.path.join(ASSETS, 'icon-foreground.png'))
    save(Image.new('RGB', (1024, 1024), (8, 20, 62)), os.path.join(ASSETS, 'icon-background.png'))
    ns = make_native_splash(logo)
    save(ns, os.path.join(ASSETS, 'splash.png'))
    save(ns, os.path.join(ASSETS, 'splash-dark.png'))

    save(make_menu_background(), os.path.join(IMG, 'bg-main.jpg'), fmt='JPEG', quality=82)
    save(make_coin(512), os.path.join(ICO, 'coin.png'), 128)


if __name__ == '__main__':
    main()
