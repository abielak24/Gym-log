#!/usr/bin/env python3
"""Generate the app icons.

Three ruled lines and a tick, which is what a page of sets looks like from a
distance. Written as raw PNG so the repo needs no image toolchain to rebuild
them: `python3 scripts/make-icons.py`.
"""

import struct
import zlib
from pathlib import Path

BG = (0x14, 0x16, 0x1A)
INK = (0xE6, 0xE8, 0xEC)
ACCENT = (0x7F, 0xD1, 0xB9)

OUT = Path(__file__).resolve().parent.parent / "public" / "icons"


def draw(size: int) -> list[list[tuple[int, int, int]]]:
    pixels = [[BG for _ in range(size)] for _ in range(size)]

    def rect(x0: float, y0: float, x1: float, y1: float, color: tuple[int, int, int]) -> None:
        for y in range(max(0, round(y0 * size)), min(size, round(y1 * size))):
            for x in range(max(0, round(x0 * size)), min(size, round(x1 * size))):
                pixels[y][x] = color

    # A left margin rule, like the red line down a sheet of paper.
    rect(0.20, 0.16, 0.215, 0.84, ACCENT)

    # Three set lines of decreasing length, the top one accented.
    rect(0.30, 0.30, 0.78, 0.345, ACCENT)
    rect(0.30, 0.47, 0.70, 0.515, INK)
    rect(0.30, 0.64, 0.58, 0.685, INK)

    return pixels


def write_png(path: Path, pixels: list[list[tuple[int, int, int]]]) -> None:
    height = len(pixels)
    width = len(pixels[0])
    raw = b"".join(b"\x00" + bytes(v for px in row for v in px) for row in pixels)

    def chunk(tag: bytes, data: bytes) -> bytes:
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    header = struct.pack(">2I5B", width, height, 8, 2, 0, 0, 0)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    path.write_bytes(png)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for size, name in ((192, "icon-192.png"), (512, "icon-512.png"), (180, "apple-touch-icon.png")):
        write_png(OUT / name, draw(size))
        print(f"wrote {name}")


if __name__ == "__main__":
    main()
