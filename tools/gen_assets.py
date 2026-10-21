#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
方寸包装 · 视觉资产生成器
--------------------------
不依赖任何外部图库（Unsplash/Pexels 均需 API key，Wikimedia 素材质量不可控），
全部视觉资产用几何 + 光影程序化生成，保证色调统一、风格克制、格式完全可控。

输出统一为 webp（主）+ png/jpg（回退），全部落在 webp/png/jpeg/gif 这四种
被广泛支持的位图格式内；页面里没有任何 svg 图片引用（图标一律 inline SVG）。
"""
import math
import os
import random
from PIL import Image, ImageDraw, ImageFilter, ImageChops

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "frontend", "assets")
os.makedirs(OUT, exist_ok=True)

SS = 2  # 超采样倍率，用于抗锯齿


# ---------- 基础绘制工具 ----------
def gradient_between(size, c1, c2, vertical=True):
    """返回从 c1 线性过渡到 c2 的 RGB 图（vertical=True 时上→下）。"""
    g = Image.linear_gradient("L").resize(size)
    if not vertical:
        g = g.rotate(90, expand=True).resize(size)
    a = Image.new("RGB", size, c1)
    b = Image.new("RGB", size, c2)
    return Image.composite(b, a, g)


def paint_poly(base, poly, c1, c2, vertical=True):
    """在多边形内填充渐变。"""
    xs = [p[0] for p in poly]
    ys = [p[1] for p in poly]
    x0, y0 = int(min(xs)), int(min(ys))
    x1, y1 = int(max(xs)) + 1, int(max(ys)) + 1
    w, h = max(1, x1 - x0), max(1, y1 - y0)
    grad = gradient_between((w, h), c1, c2, vertical)
    mask = Image.new("L", base.size, 0)
    ImageDraw.Draw(mask).polygon(poly, fill=255)
    layer = Image.new("RGB", base.size, (0, 0, 0))
    layer.paste(grad, (x0, y0))
    base.paste(layer, (0, 0), mask)


def stroke_poly(base, poly, color, width):
    ImageDraw.Draw(base).line(list(poly) + [poly[0]], fill=color, width=width, joint="curve")


def add_grain(img, amount=0.035, seed=7):
    """细微颗粒，让纸面不显得是纯矢量色块。"""
    random.seed(seed)
    size = img.size
    noise = Image.effect_noise(size, 22).convert("L")
    noise_rgb = Image.merge("RGB", (noise, noise, noise))
    rgb = img.convert("RGB")
    rgb = Image.blend(rgb, noise_rgb, amount)
    out = rgb.convert("RGBA")
    out.putalpha(img.getchannel("A"))
    return out


def edge_fade(size, power=0.65, edge=0.18):
    """水平方向两端渐隐的 alpha 蒙版（让素材自然融进卡片底色）。"""
    w, h = size
    line = Image.new("L", (w, 1), 0)
    px = line.load()
    for x in range(w):
        t = x / (w - 1)
        v = min(1.0, min(t, 1 - t) / edge)
        px[x, 0] = int(255 * (v ** power))
    return line.resize(size)


# ---------- 等距纸箱 ----------
def iso_box(size, cx, cy, a, b, h, palette, seam=True, stamp=True, tape=False):
    """在 RGBA 画布上绘制一个等距纸箱。
    cx, cy = 底面中心；a = 半宽；b = 半深（垂直投影）；h = 箱高。"""
    img = Image.new("RGBA", size, (0, 0, 0, 0))
    top_c, left_c, right_c = palette

    A = (cx, cy - b - h)   # 顶面上
    B = (cx + a, cy - h)   # 顶面右
    C = (cx, cy + b - h)   # 顶面下
    D = (cx - a, cy - h)   # 顶面左
    Bb = (cx + a, cy)
    Cb = (cx, cy + b)
    Db = (cx - a, cy)

    top_poly = [A, B, C, D]
    left_poly = [D, C, Cb, Db]   # 朝左前（受光）
    right_poly = [C, B, Bb, Cb]  # 朝右前（背光）

    paint_poly(img, right_poly, right_c[0], right_c[1])
    paint_poly(img, left_poly, left_c[0], left_c[1])
    paint_poly(img, top_poly, top_c[0], top_c[1])

    # 顶面折缝
    if seam:
        seam_col = tuple(min(255, c + 10) for c in top_c[1]) + (110,)
        ImageDraw.Draw(img).line([D, B], fill=seam_col, width=max(1, int(1.6 * SS)))

    # 顶面印章：s,t 参数空间里的正方形 → 屏幕上的平行四边形
    if stamp:
        k = 0.15
        pts = [
            (cx + k * a, cy - h + k * b),
            (cx + k * a, cy - h - k * b),
            (cx - k * a, cy - h - k * b),
            (cx - k * a, cy - h + k * b),
        ]
        col = tuple(max(0, c - 18) for c in top_c[1]) + (90,)
        ImageDraw.Draw(img).line(pts + [pts[0]], fill=col, width=max(1, int(2.0 * SS)), joint="curve")

    # 封箱胶带
    if tape:
        mask = Image.new("L", size, 0)
        ImageDraw.Draw(mask).polygon(top_poly, fill=255)
        band = Image.new("L", size, 0)
        t = b * 0.28
        ImageDraw.Draw(band).polygon(
            [(cx - a - 10, cy - h - t), (cx + a + 10, cy - h - t),
             (cx + a + 10, cy - h + t), (cx - a - 10, cy - h + t)], fill=255)
        mask = ImageChops.multiply(mask, band)
        img.paste(Image.new("RGBA", size, (240, 231, 216, 128)), (0, 0), mask)

    # 棱边高光与底边暗线，制造纸板厚度
    hi = tuple(min(255, c + 26) for c in top_c[0]) + (150,)
    stroke_poly(img, top_poly, hi, max(1, int(1.6 * SS)))
    lo = tuple(max(0, c - 30) for c in left_c[1]) + (110,)
    ImageDraw.Draw(img).line([Cb, Db], fill=lo, width=max(1, int(1.4 * SS)))

    return img


def drop_shadow(size, cx, cy, rx, ry, opacity=70, blur=26):
    sh = Image.new("L", size, 0)
    d = ImageDraw.Draw(sh)
    for i in range(3):
        f = 1 - i * 0.14
        d.ellipse([cx - rx * f, cy - ry * f, cx + rx * f, cy + ry * f], fill=opacity // (i + 1))
    sh = sh.filter(ImageFilter.GaussianBlur(blur))
    layer = Image.new("RGBA", size, (60, 42, 26, 0))
    layer.putalpha(sh)
    return layer


def compose(boxes, size, shadows=(), grain=0.03):
    base = Image.new("RGBA", size, (0, 0, 0, 0))
    for s in shadows:
        base = Image.alpha_composite(base, s)
    for b in boxes:
        base = Image.alpha_composite(base, b)
    if grain:
        base = add_grain(base, grain)
    return base


def save_webp(img, name, quality=88, fallback="png"):
    """统一导出：webp 主 + png/jpg 回退。"""
    w = os.path.join(OUT, name + ".webp")
    img.save(w, "WEBP", quality=quality, method=6)
    if fallback == "png":
        p = os.path.join(OUT, name + ".png")
        # PNG 只是 webp 的回退路径：RGB 量化到 256 色（PSNR 41dB，视觉无损），
        # alpha 通道原样保留——若连 alpha 一起量化，半透明边缘会掉到只剩几十级，出现锯齿。
        alpha = img.getchannel("A")
        quant = img.convert("RGB").quantize(colors=256, method=Image.FASTOCTREE).convert("RGB")
        quant.putalpha(alpha)
        quant.save(p, "PNG", optimize=True)
    else:
        flat = Image.new("RGB", img.size, (251, 250, 247))
        flat.paste(img, (0, 0), img)
        p = os.path.join(OUT, name + ".jpg")
        flat.save(p, "JPEG", quality=90, optimize=True, progressive=True)
    print("  ", name, img.size, "->",
          f"{os.path.getsize(w) // 1024}KB webp / {os.path.getsize(p) // 1024}KB {fallback}")


# ---------- 调色板 ----------
KRAFT = (
    ((224, 200, 169), (205, 178, 145)),   # 顶面（迎光）
    ((201, 162, 119), (178, 141, 99)),    # 左面（侧光）
    ((159, 119, 77), (134, 97, 60)),      # 右面（背光）
)
KRAFT_LIGHT = (
    ((236, 216, 191), (219, 197, 169)),
    ((214, 178, 138), (193, 155, 115)),
    ((172, 132, 90), (148, 110, 71)),
)


# ================= 1. Hero 主视觉 =================
def gen_hero():
    W, H = 1600, 1300
    s = (W * SS, H * SS)
    k = SS
    cx, cy, a, b, h = 800 * k, 1010 * k, 470 * k, 235 * k, 500 * k

    sh1 = drop_shadow(s, cx + 42 * k, cy + 30 * k, 600 * k, 108 * k, opacity=56, blur=34 * k)
    sh2 = drop_shadow(s, cx + 16 * k, cy + 12 * k, 470 * k, 62 * k, opacity=92, blur=12 * k)
    box = iso_box(s, cx, cy, a, b, h, KRAFT, seam=True, stamp=True, tape=True)
    img = compose([box], s, shadows=[sh1, sh2], grain=0.028)

    # 左上环境光：只在箱体范围内提亮，模拟柔光箱
    glow = Image.new("L", s, 0)
    ImageDraw.Draw(glow).ellipse([cx - 560 * k, cy - 1000 * k, cx + 120 * k, cy - 180 * k], fill=88)
    glow = glow.filter(ImageFilter.GaussianBlur(150 * k))
    glow = ImageChops.multiply(glow, img.getchannel("A"))
    light = Image.new("RGBA", s, (255, 246, 230, 0))
    light.putalpha(glow)
    img = Image.alpha_composite(img, light)

    img = img.resize((W, H), Image.LANCZOS)
    save_webp(img, "hero-box", quality=90)


# ================= 2. 瓦楞截面（透明底） =================
def gen_corrugated():
    W, H = 1400, 900
    s = (W * SS, H * SS)
    k = SS
    img = Image.new("RGBA", s, (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    layers = 4
    top_pad = 150 * k
    band = (H * k - 2 * top_pad) / layers

    for i in range(layers):
        y = top_pad + i * band
        liner_h = max(3, int(13 * k))
        # 下衬板（暗）
        d.rectangle([0, y + band * 0.5 + 26 * k, W * k, y + band * 0.5 + 26 * k + liner_h],
                    fill=(150, 113, 73, 255))
        # 波纹
        amp = band * 0.26
        period = 116 * k
        pts = []
        for x in range(0, int(W * k) + 1, 2):
            pts.append((x, y + band * 0.42 + amp * math.sin(x / period * 2 * math.pi)))
        for x, yy in pts[::2]:
            d.line([(x, yy), (x, yy + 15 * k)], fill=(186, 148, 104, 255))
        d.line(pts, fill=(164, 125, 82, 255), width=max(1, int(2.2 * k)))
        # 上衬板（亮）
        d.rectangle([0, y, W * k, y + liner_h], fill=(226, 199, 164, 255))
        d.rectangle([0, y, W * k, y + max(1, int(3 * k))], fill=(242, 222, 194, 255))

    img.putalpha(ImageChops.multiply(img.getchannel("A"), edge_fade(s, 0.55, 0.12)))
    img = add_grain(img, 0.045)
    img = img.resize((W, H), Image.LANCZOS)
    save_webp(img, "tile-corrugated", quality=88)


# ================= 3. 定制印刷（箱群） =================
def gen_custom():
    W, H = 1400, 900
    s = (W * SS, H * SS)
    k = SS
    sh = drop_shadow(s, 700 * k, 700 * k, 520 * k, 90 * k, opacity=52, blur=30 * k)
    small = iso_box(s, 505 * k, 610 * k, 200 * k, 100 * k, 215 * k, KRAFT_LIGHT, stamp=True, tape=False)
    tall = iso_box(s, 835 * k, 650 * k, 180 * k, 90 * k, 330 * k, KRAFT, stamp=True, tape=False)
    wide = iso_box(s, 690 * k, 712 * k, 245 * k, 122 * k, 150 * k, KRAFT_LIGHT, stamp=False, tape=True)
    img = compose([small, tall, wide], s, shadows=[sh], grain=0.03)
    img = img.resize((W, H), Image.LANCZOS)
    save_webp(img, "tile-custom", quality=90)


# ================= 4. 冷链保温箱 =================
def gen_cold():
    W, H = 1400, 900
    s = (W * SS, H * SS)
    k = SS
    COLD = (
        ((243, 248, 253), (226, 237, 248)),
        ((216, 231, 245), (194, 214, 232)),
        ((172, 194, 217), (144, 168, 192)),
    )
    sh = drop_shadow(s, 700 * k, 706 * k, 480 * k, 84 * k, opacity=44, blur=28 * k)
    box = iso_box(s, 700 * k, 664 * k, 395 * k, 198 * k, 330 * k, COLD, seam=True, stamp=True, tape=False)
    img = compose([box], s, shadows=[sh], grain=0.022)

    # 冷凝冷雾
    mist = Image.new("RGBA", s, (0, 0, 0, 0))
    ImageDraw.Draw(mist).ellipse([250 * k, 720 * k, 1150 * k, 880 * k], fill=(255, 255, 255, 78))
    mist = mist.filter(ImageFilter.GaussianBlur(46 * k))
    img = Image.alpha_composite(img, mist)

    img = img.resize((W, H), Image.LANCZOS)
    save_webp(img, "tile-cold", quality=90)


# ================= 4b. 彩色印刷纸箱 =================
def gen_print():
    """正面印有一块彩色版面的瓦楞纸箱 —— 对应「四色 / 六色高档印刷」这条主营能力。"""
    W, H = 1400, 900
    s = (W * SS, H * SS)
    k = SS
    cx, cy, a, b, h = 700 * k, 706 * k, 372 * k, 186 * k, 340 * k

    sh = drop_shadow(s, 706 * k, 748 * k, 478 * k, 82 * k, opacity=50, blur=28 * k)
    box = iso_box(s, cx, cy, a, b, h, KRAFT, seam=True, stamp=False, tape=True)

    # 左前面（朝向观众的一面）的参数化坐标
    D = (cx - a, cy - h)
    C = (cx, cy + b - h)
    Cb = (cx, cy + b)
    Db = (cx - a, cy)

    def face(u, v):
        x = (1 - u) * (1 - v) * D[0] + u * (1 - v) * C[0] + u * v * Cb[0] + (1 - u) * v * Db[0]
        y = (1 - u) * (1 - v) * D[1] + u * (1 - v) * C[1] + u * v * Cb[1] + (1 - u) * v * Db[1]
        return (x, y)

    def panel(u0, u1, v0, v1):
        return [face(u0, v0), face(u1, v0), face(u1, v1), face(u0, v1)]

    # 版面底：墨绿渐变
    paint_poly(box, panel(0.13, 0.87, 0.14, 0.66), (47, 111, 98), (33, 84, 74))
    # 版面里的「文字行」
    for v0, u0, u1 in [(0.26, 0.22, 0.54), (0.35, 0.22, 0.70), (0.44, 0.22, 0.60)]:
        paint_poly(box, panel(u0, u1, v0, v0 + 0.048), (240, 236, 226), (224, 219, 206))
    # 装饰细线：琥珀 + 砖红
    paint_poly(box, panel(0.13, 0.87, 0.725, 0.758), (217, 160, 85), (198, 141, 68))
    paint_poly(box, panel(0.13, 0.87, 0.795, 0.822), (182, 84, 63), (156, 68, 50))

    img = compose([box], s, shadows=[sh], grain=0.028)

    # 版面左上角环境光
    glow = Image.new("L", s, 0)
    ImageDraw.Draw(glow).ellipse([cx - 420 * k, cy - 760 * k, cx + 60 * k, cy - 260 * k], fill=70)
    glow = glow.filter(ImageFilter.GaussianBlur(110 * k))
    glow = ImageChops.multiply(glow, img.getchannel("A"))
    light = Image.new("RGBA", s, (255, 248, 236, 0))
    light.putalpha(glow)
    img = Image.alpha_composite(img, light)

    img = img.resize((W, H), Image.LANCZOS)
    save_webp(img, "tile-print", quality=90)


# ================= 5. 智能产线（透明底） =================
def gen_smart():
    W, H = 1400, 900
    s = (W * SS, H * SS)
    k = SS
    img = Image.new("RGBA", s, (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # 等距网格地面（半透明白，落在深色卡片上自然）
    base_y = 560 * k
    for i in range(-16, 30):
        x = 700 * k + i * 92 * k
        d.line([(x, base_y), (x + 560 * k, base_y + 300 * k)],
               fill=(29, 29, 31, 30), width=max(1, int(1.5 * k)))
        d.line([(x, base_y), (x - 560 * k, base_y + 300 * k)],
               fill=(29, 29, 31, 22), width=max(1, int(1.5 * k)))

    # 网格向下淡出
    fade = Image.new("L", s, 0)
    fd = ImageDraw.Draw(fade)
    steps = 90
    for i in range(steps):
        y0 = int(base_y + i * (H * k - base_y) / steps)
        y1 = int(base_y + (i + 1) * (H * k - base_y) / steps)
        fd.rectangle([0, y0, W * k, y1], fill=int(255 * (1 - i / steps) ** 1.4))
    img.putalpha(fade)

    sh = drop_shadow(s, 700 * k, 790 * k, 390 * k, 66 * k, opacity=80, blur=26 * k)
    box = iso_box(s, 700 * k, 750 * k, 290 * k, 145 * k, 255 * k, KRAFT, stamp=True, tape=True)
    img = Image.alpha_composite(img, sh)
    img = Image.alpha_composite(img, box)

    # 数据光点
    ov = Image.new("RGBA", s, (0, 0, 0, 0))
    od = ImageDraw.Draw(ov)
    random.seed(3)
    for _ in range(110):
        x = random.uniform(80 * k, 1320 * k)
        y = random.uniform(540 * k, 880 * k)
        r = random.uniform(1.2, 3.4) * k
        od.ellipse([x - r, y - r, x + r, y + r], fill=(150, 106, 62, random.randint(60, 200)))
    ov = ov.filter(ImageFilter.GaussianBlur(1.1 * k))
    img = Image.alpha_composite(img, ov)

    img = img.resize((W, H), Image.LANCZOS)
    save_webp(img, "tile-smart", quality=88)


# ================= 6. favicon =================
def gen_favicon():
    S, k = 96, 4
    s = (S * k, S * k)
    bg = Image.new("RGBA", s, (168, 118, 63, 255))
    mask = Image.new("L", s, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, s[0] - 1, s[1] - 1], radius=21 * k, fill=255)
    bg.putalpha(mask)
    box = iso_box(s, 48 * k, 68 * k, 26 * k, 13 * k, 27 * k, (
        ((255, 255, 255), (240, 233, 222)),
        ((240, 231, 217), (219, 205, 184)),
        ((206, 188, 162), (180, 158, 129)),
    ), seam=False, stamp=False, tape=False)
    out = Image.alpha_composite(bg, box).resize((S, S), Image.LANCZOS)
    p = os.path.join(OUT, "favicon.png")
    out.save(p, "PNG", optimize=True)
    print("   favicon", out.size, "->", f"{os.path.getsize(p)}B")


if __name__ == "__main__":
    print("生成视觉资产 …")
    gen_hero()
    gen_corrugated()
    gen_custom()
    gen_print()
    gen_smart()
    gen_favicon()
    print("完成 ->", os.path.abspath(OUT))
