#!/usr/bin/env python3
"""
Generate app icon files for the Brick Kiln ERP.
Creates:
  - build-resources/icon.png  (512x512)
  - build-resources/icon.ico  (multi-size: 16, 32, 48, 64, 128, 256)
"""
import struct
import zlib
from pathlib import Path

OUT_DIR = Path('/home/z/my-project/brick-kiln-erp/build-resources')
OUT_DIR.mkdir(parents=True, exist_ok=True)

def make_png(width: int, height: int, pixels: bytes) -> bytes:
    """Encode RGBA pixels as a PNG file."""
    def chunk(name: bytes, data: bytes) -> bytes:
        c = name + data
        crc = struct.pack('>I', zlib.crc32(c) & 0xFFFFFFFF)
        return struct.pack('>I', len(data)) + c + crc

    header = b'\x89PNG\r\n\x1a\n'
    ihdr = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)  # 8-bit RGBA
    # Add filter byte (0) at start of each row
    raw = bytearray()
    for y in range(height):
        raw.append(0)  # filter type none
        raw.extend(pixels[y * width * 4 : (y + 1) * width * 4])
    idat = zlib.compress(bytes(raw), 9)
    return header + chunk(b'IHDR', ihdr) + chunk(b'IDAT', idat) + chunk(b'IEND', b'')

def make_ico(sizes: list, pixels_by_size: dict) -> bytes:
    """Build a Windows .ico file from multiple PNG entries."""
    count = len(sizes)
    header = struct.pack('<HHH', 0, 1, count)
    entries = []
    image_data = b''
    # Each directory entry is 16 bytes; header is 6 bytes.
    offset = 6 + count * 16
    for s in sizes:
        png = pixels_by_size[s]
        # ICONDIRENTRY (16 bytes): width (1), height (1), colors (1), reserved (1),
        # planes (2), bit count (2), bytes in res (4), image offset (4)
        entries.append(struct.pack('<BBBBHHII',
                                    s if s < 256 else 0,
                                    s if s < 256 else 0,
                                    0, 0,
                                    1, 32,
                                    len(png), offset))
        image_data += png
        offset += len(png)
    return header + b''.join(entries) + image_data

def draw_brick_kiln(size: int) -> bytes:
    """Draw a simple brick kiln icon: stacked red bricks + chimney + flame."""
    pixels = bytearray(size * size * 4)
    # Background: cream/beige
    bg_r, bg_g, bg_b, bg_a = 252, 245, 235, 255
    for i in range(size * size):
        pixels[i*4:i*4+4] = bytes([bg_r, bg_g, bg_b, bg_a])

    def set_pixel(x: int, y: int, r: int, g: int, b: int, a: int = 255):
        if 0 <= x < size and 0 <= y < size:
            idx = (y * size + x) * 4
            pixels[idx] = r
            pixels[idx+1] = g
            pixels[idx+2] = b
            pixels[idx+3] = a

    def fill_rect(x0: int, y0: int, x1: int, y1: int, r: int, g: int, b: int, a: int = 255):
        for y in range(y0, y1+1):
            for x in range(x0, x1+1):
                set_pixel(x, y, r, g, b, a)

    # Chimney (top, brown/dark)
    chimney_x0 = size // 2 - size // 12
    chimney_x1 = size // 2 + size // 12
    chimney_y0 = size // 10
    chimney_y1 = size // 3
    fill_rect(chimney_x0, chimney_y0, chimney_x1, chimney_y1, 120, 60, 40)
    # Chimney top (darker)
    fill_rect(chimney_x0 - 2, chimney_y0, chimney_x1 + 2, chimney_y0 + 4, 80, 40, 30)

    # Smoke (gray, semi-transparent) above chimney
    for cy in range(chimney_y0 - size // 14, chimney_y0):
        for cx in range(chimney_x0 - 2, chimney_x1 + 3):
            if (cx - chimney_x0) % 3 == 0 or (cy - chimney_y0) % 2 == 0:
                set_pixel(cx, cy, 180, 180, 180, 120)

    # Flame (orange/red, just above the bricks below chimney)
    flame_y0 = chimney_y1 - size // 20
    flame_y1 = chimney_y1 + size // 12
    flame_x0 = chimney_x0 - 2
    flame_x1 = chimney_x1 + 2
    for y in range(flame_y0, flame_y1):
        for x in range(flame_x0, flame_x1 + 1):
            # triangular-ish flame
            mid = (flame_x0 + flame_x1) // 2
            half_w = max(1, int((flame_x1 - flame_x0) * (y - flame_y0) / max(1, flame_y1 - flame_y0)))
            if abs(x - mid) <= half_w:
                if y < flame_y0 + (flame_y1 - flame_y0) // 2:
                    set_pixel(x, y, 255, 180, 30)  # outer yellow
                else:
                    set_pixel(x, y, 220, 60, 20)  # inner red

    # Bricks (rectangular stack of red/brown bricks with mortar lines)
    brick_y0 = size // 2
    brick_y1 = size - size // 8
    brick_x0 = size // 6
    brick_x1 = size - size // 6
    brick_color = (170, 50, 30)  # red-brown
    mortar_color = (220, 200, 180)
    brick_h = max(2, size // 14)
    brick_w = max(4, size // 8)
    y = brick_y0
    row = 0
    while y < brick_y1:
        offset = (brick_w // 2) if row % 2 == 1 else 0
        x = brick_x0 - offset
        while x < brick_x1:
            # Draw a single brick
            bx0 = max(brick_x0, x)
            bx1 = min(brick_x1, x + brick_w - 1)
            by1 = min(brick_y1, y + brick_h - 1)
            if bx1 > bx0:
                fill_rect(bx0, y, bx1, by1, *brick_color)
            x += brick_w + 1  # +1 for mortar gap
        # Mortar line below
        if y + brick_h < brick_y1:
            fill_rect(brick_x0, y + brick_h, brick_x1, y + brick_h, *mortar_color)
        y += brick_h + 1
        row += 1

    # Mortar vertical lines (faint)
    for x in range(brick_x0, brick_x1, brick_w + 1):
        for y in range(brick_y0, brick_y1):
            if x < brick_x1:
                set_pixel(x, y, *mortar_color)

    # Ground (slight darker beige at very bottom)
    fill_rect(0, size - 2, size - 1, size - 1, 200, 180, 150, 255)

    return bytes(pixels)

# Generate multiple sizes
sizes = [16, 32, 48, 64, 128, 256, 512]
pixels_by_size = {}
for s in sizes:
    print(f"Rendering {s}x{s}...")
    pixels_by_size[s] = make_png(s, s, draw_brick_kiln(s))

# Save PNG (use 512 for the main icon)
(OUT_DIR / 'icon.png').write_bytes(pixels_by_size[512])
print(f"Saved icon.png ({len(pixels_by_size[512])} bytes)")

# Save ICO (multi-size, using sizes 16-256 per Windows convention)
ico_sizes = [16, 32, 48, 64, 128, 256]
ico_pixels = {s: pixels_by_size[s] for s in ico_sizes}
ico_data = make_ico(ico_sizes, ico_pixels)
(OUT_DIR / 'icon.ico').write_bytes(ico_data)
print(f"Saved icon.ico ({len(ico_data)} bytes)")
print(f"Output dir: {OUT_DIR}")
