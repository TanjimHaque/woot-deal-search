#!/usr/bin/env python3
"""Generate Woot Deal Search PNG icons with no third-party dependencies.

Draws at 768x768 and box-filters down to 128/48/32/16, which gives clean
anti-aliased edges. Run from anywhere:
    python3 tools/make_icons.py
"""
import math
import os
import struct
import zlib

SIZE = 768
OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                       "woot-search-extension", "icons")
TARGET_SIZES = (128, 48, 32, 16)

BG = (18, 18, 18)
WHITE = (255, 255, 255)
YELLOW = (255, 216, 20)


def rounded_rect_alpha(x, y, w, radius):
    """Return 255 inside a rounded rect, 0 outside (hard edge; AA comes from downsampling)."""
    if x < 0 or y < 0 or x >= w or y >= w:
        return 0
    cx = min(max(x, radius), w - 1 - radius)
    cy = min(max(y, radius), w - 1 - radius)
    if (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius:
        return 255
    return 0


def dist_to_segment(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    length_sq = dx * dx + dy * dy
    if length_sq == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / length_sq))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def draw():
    w = SIZE
    radius = int(w * 0.205)
    cx, cy, ring_r, ring_t = w * 0.44, w * 0.43, w * 0.245, w * 0.092
    hx1, hy1 = w * 0.625, w * 0.615
    hx2, hy2 = w * 0.81, w * 0.80
    handle_t = w * 0.115

    pixels = bytearray(w * w * 4)
    for y in range(w):
        row = y * w * 4
        for x in range(w):
            if rounded_rect_alpha(x, y, w, radius) == 0:
                continue
            r, g, b = BG
            dx, dy = x - cx, y - cy
            dist = math.hypot(dx, dy)
            if abs(dist - ring_r) <= ring_t / 2:
                r, g, b = WHITE
            elif dist_to_segment(x, y, hx1, hy1, hx2, hy2) <= handle_t / 2:
                r, g, b = YELLOW
            i = row + x * 4
            pixels[i] = r
            pixels[i + 1] = g
            pixels[i + 2] = b
            pixels[i + 3] = 255
    return pixels


def downsample(src, src_w, dst_w):
    factor = src_w // dst_w
    dst = bytearray(dst_w * dst_w * 4)
    area = factor * factor
    for y in range(dst_w):
        for x in range(dst_w):
            sr = sg = sb = sa = 0
            for by in range(factor):
                base = ((y * factor + by) * src_w + x * factor) * 4
                for bx in range(factor):
                    i = base + bx * 4
                    a = src[i + 3]
                    sr += src[i] * a
                    sg += src[i + 1] * a
                    sb += src[i + 2] * a
                    sa += a
            o = (y * dst_w + x) * 4
            if sa:
                dst[o] = sr // sa
                dst[o + 1] = sg // sa
                dst[o + 2] = sb // sa
            dst[o + 3] = sa // area
    return dst


def write_png(path, size, rgba):
    raw = b"".join(b"\x00" + bytes(rgba[y * size * 4:(y + 1) * size * 4]) for y in range(size))
    compressed = zlib.compress(raw, 9)

    def chunk(kind, data):
        return (struct.pack(">I", len(data)) + kind + data +
                struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF))

    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    with open(path, "wb") as fh:
        fh.write(b"\x89PNG\r\n\x1a\n")
        fh.write(chunk(b"IHDR", header))
        fh.write(chunk(b"IDAT", compressed))
        fh.write(chunk(b"IEND", b""))


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    master = draw()
    for target in TARGET_SIZES:
        scaled = downsample(master, SIZE, target)
        path = os.path.join(OUT_DIR, "icon%d.png" % target)
        write_png(path, target, scaled)
        print("wrote", path)


if __name__ == "__main__":
    main()
