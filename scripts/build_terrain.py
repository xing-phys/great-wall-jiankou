#!/usr/bin/env python3
"""
Bake a terrain heightmap for the Jiankou Great Wall from the AWS Open Data
"Terrarium" elevation tiles (Mapzen / SRTM-derived, public domain).

Output:
  public/data/terrain.png   RGB terrarium heightmap (elevation in metres)
  public/data/terrain.json  georeferencing metadata

Run:  python3 scripts/build_terrain.py
"""
from __future__ import annotations

import io
import json
import math
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image

# ---------------------------------------------------------------- geography
WEST, SOUTH, EAST, NORTH = 116.4510, 40.4240, 116.5760, 40.5000
GRID_W, GRID_H = 1024, 813
ZOOM = 14
TILE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
UA = "Jiankou3D/1.0 (personal research visualisation)"

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "public" / "data"
CACHE = ROOT / "scripts" / "raw" / "terrain-tiles"


def lonlat_to_px(lon, lat, z=ZOOM, tile_size=256):
    """Continuous pixel coordinates in the global tile grid at zoom z."""
    n = 2 ** z
    x = (np.asarray(lon) + 180.0) / 360.0 * n * tile_size
    lat_r = np.radians(np.asarray(lat))
    y = (1.0 - np.log(np.tan(lat_r) + 1.0 / np.cos(lat_r)) / np.pi) / 2.0 * n * tile_size
    return x, y


def download_tile(args):
    z, x, y = args
    path = CACHE / str(z) / str(x) / f"{y}.png"
    if path.exists() and path.stat().st_size > 0:
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(TILE_URL.format(z=z, x=x, y=y), headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = resp.read()
    path.write_bytes(data)
    return path


def decode_terrarium(path: Path) -> np.ndarray:
    img = np.asarray(Image.open(path).convert("RGB"), dtype=np.float64)
    return img[..., 0] * 256.0 + img[..., 1] + img[..., 2] / 256.0 - 32768.0


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    CACHE.mkdir(parents=True, exist_ok=True)

    z = ZOOM
    x0f, y0f = lonlat_to_px(WEST, NORTH, z)
    x1f, y1f = lonlat_to_px(EAST, SOUTH, z)

    # expand the mosaic by a tile of padding so bilinear filtering never runs off
    tx0, tx1 = int(math.floor(x0f / 256)) - 1, int(math.floor(x1f / 256)) + 1
    ty0, ty1 = int(math.floor(y0f / 256)) - 1, int(math.floor(y1f / 256)) + 1
    tiles = [(z, tx, ty) for tx in range(tx0, tx1 + 1) for ty in range(ty0, ty1 + 1)]
    print(f"terrain tiles: {len(tiles)} at z{z} ({tx0}..{tx1}, {ty0}..{ty1})")

    with ThreadPoolExecutor(max_workers=8) as pool:
        paths = list(pool.map(download_tile, tiles))

    mosaic = np.zeros(((ty1 - ty0 + 1) * 256, (tx1 - tx0 + 1) * 256), dtype=np.float32)
    for (tz, tx, ty), path in zip(tiles, paths):
        col = (tx - tx0) * 256
        row = (ty - ty0) * 256
        mosaic[row:row + 256, col:col + 256] = decode_terrarium(path)

    # sample the exact bounding box onto a regular grid
    lons = np.linspace(WEST, EAST, GRID_W, endpoint=True)
    lats = np.linspace(NORTH, SOUTH, GRID_H, endpoint=True)  # row 0 = north
    glon, glat = np.meshgrid(lons, lats)
    px, py = lonlat_to_px(glon, glat, z)
    # pixel centres are at +0.5
    u = px - tx0 * 256 - 0.5
    v = py - ty0 * 256 - 0.5

    u0 = np.clip(np.floor(u).astype(np.int32), 0, mosaic.shape[1] - 2)
    v0 = np.clip(np.floor(v).astype(np.int32), 0, mosaic.shape[0] - 2)
    fu = (u - u0).astype(np.float32)
    fv = (v - v0).astype(np.float32)
    a = mosaic[v0, u0]
    b = mosaic[v0, u0 + 1]
    c = mosaic[v0 + 1, u0]
    d = mosaic[v0 + 1, u0 + 1]
    height = (a * (1 - fu) * (1 - fv) + b * fu * (1 - fv) +
              c * (1 - fu) * fv + d * fu * fv).astype(np.float32)

    # very light smoothing removes SRTM terracing without killing ridgelines
    k = np.array([1, 4, 6, 4, 1], dtype=np.float32) / 16.0
    height = (np.apply_along_axis(lambda r: np.convolve(r, k, mode="same"), 1, height)
              .astype(np.float32))
    height = (np.apply_along_axis(lambda r: np.convolve(r, k, mode="same"), 0, height)
              .astype(np.float32))

    print(f"elevation range: {height.min():.1f} .. {height.max():.1f} m")

    # terrarium encode (lossless to ~4 mm vertically)
    shifted = height.astype(np.float64) + 32768.0
    r = np.floor(shifted / 256.0)
    g = np.floor(shifted - r * 256.0)
    b = np.clip(np.round((shifted - np.floor(shifted)) * 256.0), 0, 255)
    rgb = np.stack([r, g, b], axis=-1).astype(np.uint8)
    Image.fromarray(rgb, "RGB").save(OUT_DIR / "terrain.png", optimize=True)

    meta = {
        "bbox": [WEST, SOUTH, EAST, NORTH],
        "zoom": z,
        "size": [GRID_W, GRID_H],
        "origin": [(WEST + EAST) / 2, (SOUTH + NORTH) / 2],
        "minElevation": float(height.min()),
        "maxElevation": float(height.max()),
        "metersPerPixel": [
            (EAST - WEST) * 111320.0 * math.cos(math.radians((SOUTH + NORTH) / 2)) / (GRID_W - 1),
            (NORTH - SOUTH) * 111320.0 / (GRID_H - 1),
        ],
        "encoding": "terrarium",
        "source": "AWS Open Data Terrain Tiles / Mapzen (SRTM-derived), public domain",
    }
    (OUT_DIR / "terrain.json").write_text(json.dumps(meta, indent=2) + "\n")
    print(f"wrote {OUT_DIR / 'terrain.png'} ({(OUT_DIR / 'terrain.png').stat().st_size // 1024} KiB)")
    print(json.dumps(meta, indent=2))

    # quick hillshade preview for eyeballing the ridge
    gy, gx = np.gradient(height, 10.4)
    slope = np.hypot(gx, gy)
    shade = np.clip(0.55 + (-gx - gy) / (slope + 1e-6) * np.minimum(slope / 120.0, 0.4), 0, 1)
    preview = (shade * 255).astype(np.uint8)
    Image.fromarray(preview).save(ROOT / "scripts" / "raw" / "terrain-preview.png")


if __name__ == "__main__":
    main()
