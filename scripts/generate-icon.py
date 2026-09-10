#!/usr/bin/env python3
"""Generate a minimal but valid Windows .ico file from a simple brick emoji design.

We don't have PIL/Pillow guaranteed, so we create a 32x32 32-bit RGBA icon manually
using struct packing. The icon is a simple red brick on a white background.
"""
import struct
import os

def create_brick_icon():
    """Create a 256x256 RGBA icon: white background with red brick pattern.

    Windows installer requires icons to be at least 256x256.
    """
    W, H = 256, 256
    # Brick color (terracotta red): #B91C1C
    brick_color = (185, 28, 28, 255)
    mortar_color = (220, 220, 220, 255)  # light gray for mortar lines
    bg_color = (255, 255, 255, 255)      # white background

    # Generate pixel data with brick pattern
    pixels = []
    brick_h = 32  # brick row height (256/8 = 32)
    brick_w = 64  # brick width (256/4 = 64)
    for y in range(H):
        row = []
        # Determine which brick row this is
        brick_row = y // brick_h
        # Offset pattern (alternating rows offset by half a brick)
        offset = brick_w // 2 if brick_row % 2 == 1 else 0
        for x in range(W):
            # Check if this pixel is on a mortar line
            is_horizontal_mortar = (y % brick_h == 0) or (y % brick_h == brick_h - 1)
            adj_x = (x + offset) % brick_w
            is_vertical_mortar = (adj_x == 0) or (adj_x == brick_w - 1)

            if is_horizontal_mortar or is_vertical_mortar:
                row.append(mortar_color)
            else:
                row.append(brick_color)
        pixels.append(row)

    # Flatten to BGRA bytes (Windows ICO uses BGRA)
    pixel_bytes = bytearray()
    for row in pixels:
        for r, g, b, a in row:
            # ICO uses BGRA order
            pixel_bytes.extend([b, g, r, a])

    # XOR mask is the pixel data
    xor_mask = bytes(pixel_bytes)

    # AND mask: 1-bit per pixel, padded to 4-byte alignment per row
    # All zeros (no transparency) - 32 pixels = 32 bits = 4 bytes per row
    and_mask = bytes([0] * (H * 4))  # H rows * 4 bytes per row

    # Build BMP image data (ICONDIRENTRY expects BITMAPINFOHEADER + image data)
    # BITMAPINFOHEADER for icon (note: height = 2*H for icon - includes AND mask)
    bih = struct.pack('<IiiHHIIiiII',
        40,          # biSize (header size)
        W,           # biWidth
        H * 2,       # biHeight (doubled for icon: XOR + AND masks)
        1,           # biPlanes
        32,          # biBitCount
        0,           # biCompression
        len(xor_mask) + len(and_mask),  # biSizeImage
        0,           # biXPelsPerMeter
        0,           # biYPelsPerMeter
        0,           # biClrUsed
        0,           # biClrImportant
    )

    image_data = bih + xor_mask + and_mask
    image_size = len(image_data)

    # ICONDIR (6 bytes)
    icondir = struct.pack('<HHH', 0, 1, 1)  # reserved, type=1 (icon), count=1

    # ICONDIRENTRY (16 bytes)
    # width, height (0 = 256), color count (0 = >256), reserved,
    # planes, bitcount, size, offset
    icondirentry = struct.pack('<BBBBHHII',
        W if W < 256 else 0,   # bWidth (0 means 256)
        H if H < 256 else 0,   # bHeight (0 means 256)
        0,           # bColorCount (>256 colors)
        0,           # bReserved
        1,           # wPlanes
        32,          # wBitCount
        image_size,  # dwBytesInRes
        6,           # dwImageOffset (after ICONDIR + 1 ICONDIRENTRY = 6 + 16 = 22)
    )

    return icondir + icondirentry + image_data


def create_brick_png():
    """Create a 256x256 PNG version for the Electron window icon."""
    # PNG signature
    signature = b'\x89PNG\r\n\x1a\n'

    # IHDR chunk: width=256, height=256, bit_depth=8, color_type=6 (RGBA)
    import zlib
    width = 256
    height = 256
    ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    ihdr_crc = zlib.crc32(b'IHDR' + ihdr_data) & 0xffffffff
    ihdr = struct.pack('>I', 13) + b'IHDR' + ihdr_data + struct.pack('>I', ihdr_crc)

    # Generate same brick pattern as the ICO
    brick_color = (185, 28, 28, 255)
    mortar_color = (220, 220, 220, 255)

    brick_h = 32
    brick_w = 64
    raw_pixels = bytearray()
    for y in range(height):
        raw_pixels.append(0)  # filter type 0 (None) for each row
        brick_row = y // brick_h
        offset = brick_w // 2 if brick_row % 2 == 1 else 0
        for x in range(width):
            is_horizontal_mortar = (y % brick_h == 0) or (y % brick_h == brick_h - 1)
            adj_x = (x + offset) % brick_w
            is_vertical_mortar = (adj_x == 0) or (adj_x == brick_w - 1)
            if is_horizontal_mortar or is_vertical_mortar:
                r, g, b, a = mortar_color
            else:
                r, g, b, a = brick_color
            raw_pixels.extend([r, g, b, a])

    # IDAT chunk: compressed image data
    compressed = zlib.compress(bytes(raw_pixels))
    idat_crc = zlib.crc32(b'IDAT' + compressed) & 0xffffffff
    idat = struct.pack('>I', len(compressed)) + b'IDAT' + compressed + struct.pack('>I', idat_crc)

    # IEND chunk
    iend_crc = zlib.crc32(b'IEND') & 0xffffffff
    iend = struct.pack('>I', 0) + b'IEND' + struct.pack('>I', iend_crc)

    return signature + ihdr + idat + iend


if __name__ == '__main__':
    os.makedirs('build-resources', exist_ok=True)

    # Generate ICO
    ico_data = create_brick_icon()
    with open('build-resources/icon.ico', 'wb') as f:
        f.write(ico_data)
    print(f'Generated build-resources/icon.ico ({len(ico_data)} bytes)')

    # Generate PNG
    png_data = create_brick_png()
    with open('build-resources/icon.png', 'wb') as f:
        f.write(png_data)
    print(f'Generated build-resources/icon.png ({len(png_data)} bytes)')

    print('Done. Brick kiln icon created.')
