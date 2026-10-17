#!/usr/bin/env python3
"""
Compile the Jiankou wall centre-lines, watchtowers and landmark metadata from
OpenStreetMap traces into public/data/wall.json.

Wall geometry (c) OpenStreetMap contributors, ODbL 1.0.
Tower coordinates and feature names come from the same OSM extract.
"""
from __future__ import annotations

import json
import math
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "scripts" / "raw"
OUT = ROOT / "public" / "data" / "wall.json"

R_EARTH = 6371000.0
LAT0 = 40.462
M_PER_DEG_LAT = 111132.0
M_PER_DEG_LON = 111320.0 * math.cos(math.radians(LAT0))

# ---------------------------------------------------------------- way helpers
ways = {w["id"]: w for w in json.loads((RAW / "osm-walls.json").read_text())["elements"]}


def geom(way_id):
    return [(p["lat"], p["lon"]) for p in ways[way_id]["geometry"]]


def dist(a, b):
    dy = (a[0] - b[0]) * M_PER_DEG_LAT
    dx = (a[1] - b[1]) * M_PER_DEG_LON
    return math.hypot(dx, dy)


def dedupe(points, eps=0.4):
    out = []
    for p in points:
        if not out or dist(out[-1], p) > eps:
            out.append(p)
    return out


def project(points, p):
    """Closest point on a lon/lat polyline; returns (s, distance, point)."""
    best = (1e30, 0.0, None)
    s = 0.0
    for i in range(len(points) - 1):
        a, b = points[i], points[i + 1]
        ax = (a[1] - p[1]) * M_PER_DEG_LON
        ay = (a[0] - p[0]) * M_PER_DEG_LAT
        bx = (b[1] - p[1]) * M_PER_DEG_LON
        by = (b[0] - p[0]) * M_PER_DEG_LAT
        vx, vy = bx - ax, by - ay
        L2 = vx * vx + vy * vy
        t = 0.0 if L2 == 0 else max(0.0, min(1.0, -(ax * vx + ay * vy) / L2))
        cx, cy = ax + t * vx, ay + t * vy
        d = math.hypot(cx, cy)
        seg = dist(a, b)
        if d < best[0]:
            lat = a[0] + (b[0] - a[0]) * t
            lon = a[1] + (b[1] - a[1]) * t
            best = (d, s + seg * t, (lat, lon))
        s += seg
    return best


def path_length(points):
    return sum(dist(points[i], points[i + 1]) for i in range(len(points) - 1))


def rdp(points, tol=1.1):
    if len(points) < 3:
        return points
    a, b = points[0], points[-1]
    ax, ay = a[1] * M_PER_DEG_LON, a[0] * M_PER_DEG_LAT
    bx, by = b[1] * M_PER_DEG_LON, b[0] * M_PER_DEG_LAT
    vx, vy = bx - ax, by - ay
    L = math.hypot(vx, vy)
    best_i, best_d = 0, -1.0
    for i in range(1, len(points) - 1):
        px, py = points[i][1] * M_PER_DEG_LON, points[i][0] * M_PER_DEG_LAT
        if L < 1e-9:
            d = math.hypot(px - ax, py - ay)
        else:
            d = abs(vx * (py - ay) - vy * (px - ax)) / L
        if d > best_d:
            best_d, best_i = d, i
    if best_d > tol:
        left = rdp(points[:best_i + 1], tol)
        right = rdp(points[best_i:], tol)
        return left[:-1] + right
    return [a, b]


def join(*segments):
    out = []
    for seg in segments:
        out.extend(seg)
    return dedupe(out, 0.6)


# ---------------------------------------------------------------- build routes
a = geom(184635505)                                   # 正北楼 -> 箭口
b = geom(89623082)                                    # 箭口 -> 将军守关
c = geom(1147959550)                                  # 将军守关 T 口 -> 天梯顶
d = geom(89632288)                                    # 天梯顶 -> 北京结
e = geom(1147959548)                                  # 北京结 -> 北
f = geom(92160463)                                    # 北 -> 九眼楼

# the inverted-T at tower 142: keep the through-wall, put 142 on a short spur
junction = project(b, (40.456335, 116.505212))[2]     # 143号台, T-junction
cut = project(b, junction)[1]
b_through = []
acc = 0.0
for i in range(len(b) - 1):
    b_through.append(b[i])
    acc += dist(b[i], b[i + 1])
    if acc >= cut:
        b_through.append(b[i + 1])
        break
if not b_through:
    b_through = b
b_through.append(junction)
b_through = dedupe(b_through, 0.3)
tower142 = (40.4566584, 116.5056694)
spur = dedupe([junction, tower142], 0.3)

main = join(a, b_through, c, d, e, f)
main = dedupe(rdp(main, 1.0), 0.4)

east_tail = geom(89612499)[::-1]                      # 正北楼 -> 慕田峪方向
west = geom(89632280)                                 # 北京结 -> 旺泉峪方向
nw = join(geom(89632289), geom(1270424292), geom(1270424289))

routes = {
    "main": dedupe(rdp(main, 1.0), 0.4),
    "spur": rdp(spur, 0.5),
    "west": dedupe(rdp(west, 1.1), 0.4),
    "east": dedupe(rdp(east_tail, 1.1), 0.4),
    "northwest": dedupe(rdp(nw, 1.1), 0.4),
}
lengths = {k: round(path_length(v), 1) for k, v in routes.items()}
print("route lengths:", lengths)

# ---------------------------------------------------------------- towers
named = json.loads((RAW / "osm-named.json").read_text())["elements"]
tower_nodes = []
for el in named:
    tags = el.get("tags", {})
    name = tags.get("name", "")
    if "敌台" not in name and name not in ("正北楼", "九眼楼", "东一楼"):
        continue
    lat = el.get("lat") or el.get("center", {}).get("lat")
    lon = el.get("lon") or el.get("center", {}).get("lon")
    m = re.search(r"(\d+)号敌台", name)
    num = int(m.group(1)) if m else None
    tower_nodes.append({"name": name, "lat": lat, "lon": lon, "num": num})

tower_nodes = [t for t in tower_nodes if t["lat"] is not None]


def nearest_tower(points, lat, lon):
    return project(points, (lat, lon))


# key landmarks and their tower numbers
KEY = {
    122: dict(en="True North Tower", ruin="intact", w=12.0, d=9.0, h=10.5),
    123: dict(en="South Second Tower"),
    128: dict(en="Little Potala", ruin="intact", w=9.4, d=9.2, h=9.4),
    129: dict(en="West Basket", ruin="intact", w=9.0, d=8.8, h=9.8),
    131: dict(en="", ruin="base"),
    138: dict(en="", ruin="base"),
    142: dict(en="General Guarding the Pass", ruin="roofless", w=9.2, d=8.0, h=8.4),
    143: dict(en="", ruin="base"),
    148: dict(en="Corner Tower", ruin="intact", w=9.0, d=8.2, h=8.8),
    149: dict(en="Moon Gate Tower", ruin="moon"),
    154: dict(en="", ruin="broken"),
}


def hash01(n):
    if n is None:
        n = 37
    x = math.sin(n * 127.1 + 311.7) * 43758.5453
    return x - math.floor(x)


towers = []
seen = set()
for t in tower_nodes:
    if t["name"] in ("正北楼", "九眼楼", "东一楼"):
        continue
    lat, lon = t["lat"], t["lon"]
    num = t["num"]
    # decide which route carries this tower
    candidates = []
    for key in ("main", "spur", "west", "east"):
        d, s, _ = nearest_tower(routes[key], lat, lon)
        candidates.append((d, key, s))
    candidates.sort()
    d, route, s = candidates[0]
    if d > 55:
        continue
    if num == 154:
        continue  # the Beijing Knot itself is a junction platform, not a tower
    if route == "main" and num is not None and num < 122:
        continue
    if num is not None and num in seen:
        continue
    if num is not None:
        seen.add(num)
    key = KEY.get(num, {})
    ruin = key.get("ruin") or ("intact" if hash01(num) > 0.62 else
                               "roofless" if hash01(num + 3) > 0.45 else
                               "broken" if hash01(num + 7) > 0.25 else "base")
    width = key.get("w") or 8.6 + hash01(num) * 1.6
    depth = key.get("d") or 7.4 + hash01((num or 0) + 11) * 1.4
    height = key.get("h") or 7.2 + hash01((num or 0) + 17) * 2.6
    if ruin == "base":
        height = 2.2 + hash01((num or 0) + 21) * 1.4
    towers.append({
        "id": f"t{num}" if num else f"x{len(towers)}",
        "num": num,
        "name": t["name"],
        "en": key.get("en", ""),
        "route": route,
        "s": round(s, 1),
        "ruin": ruin,
        "size": [round(width, 2), round(depth, 2), round(height, 2)],
        "lat": lat, "lon": lon,
    })

# 九眼楼 at the far end of the main route
nine = next(t for t in tower_nodes if t["name"] == "九眼楼")
towers.append({
    "id": "t999", "num": 999, "name": "九眼楼", "en": "Nine-Eye Tower",
    "route": "main", "s": lengths["main"], "ruin": "nine",
    "size": [13.8, 12.6, 12.0], "lat": nine["lat"], "lon": nine["lon"],
})
# 正北楼 is the start of the main route
if not any(t["num"] == 122 for t in towers):
    towers.append({
        "id": "t122", "num": 122, "name": "正北楼", "en": "True North Tower",
        "route": "main", "s": 0.0, "ruin": "intact", "en": "True North Tower",
        "size": [12.0, 9.0, 10.5], "lat": 40.454511, "lon": 116.536050,
    })
# 东一楼 on the east tail
dong = next(t for t in tower_nodes if t["name"] == "东一楼")
d_east, s_east, _ = nearest_tower(routes["east"], dong["lat"], dong["lon"])
towers.append({
    "id": "t121", "num": 121, "name": "东一楼", "en": "East First Tower",
    "route": "east", "s": round(s_east, 1), "ruin": "broken",
    "size": [9.0, 8.0, 7.0], "lat": dong["lat"], "lon": dong["lon"],
})

# a few anonymous ruined towers keep the long west rampart readable
for i, frac in enumerate((0.22, 0.53, 0.79, 0.965)):
    towers.append({
        "id": f"wx{i}", "num": None, "name": "无名敌台", "en": "",
        "route": "west", "s": round(lengths["west"] * frac, 1), "ruin": "base",
        "size": [7.2, 6.6, 2.4], "lat": 0, "lon": 0,
    })

# ---------------------------------------------------------------- landmarks
landmark_specs = [
    dict(id="jiuyanlou", name="九眼楼", en="Nine-Eye Tower", route="main",
         where=[nine["lat"], nine["lon"]], elev=1141, chapter=7, kind="tower",
         desc="明长城敌楼，因每面开九孔箭窗而得名。它矗立在内长城与外长城的交汇地带，海拔约 1141 米，是箭扣一线的制高点之一。"),
    dict(id="beijingjie", name="北京结", en="Beijing Knot", route="main",
         where=[40.462796, 116.494163], elev=958, chapter=6, kind="junction",
         desc="内长城与外长城在此分岔：南去鹰飞倒仰、天梯，西去旺泉峪、黄花城，北去九眼楼。三道墙体在山脊上拧成一个结，故称北京结。"),
    dict(id="xidawall", name="西大墙", en="West Rampart", route="west",
         where=None, elev=None, chapter=99, kind="ridge",
         desc="北京结以西的陡峭边墙，沿绝壁直上，局部坡度接近 70–80°。墙体与山岩几乎融为一体，是箭扣最险的段落之一。"),
    dict(id="yingfei", name="鹰飞倒仰", en="Eagle Flying Upside Down", route="main",
         where=[40.456935, 116.498302], elev=1013, chapter=5, kind="ridge",
         desc="山脊形如倒仰的鹰首，墙体攀着近垂直的岩壁上升。传说鹰飞至此也要翻身仰上，故名。北翅与南翅之间是一道马鞍形的石脊。"),
    dict(id="tianti", name="天梯", en="Heavenly Ladder", route="main",
         where=[40.455123, 116.501408], elev=912, chapter=4, kind="stairs",
         desc="一段约二十米高的陡直墙体，砖石阶几乎贴壁而上，是箭扣最著名的险段之一。顶端是 146 号敌台。"),
    dict(id="jiangjun", name="将军守关", en="General Guarding the Pass", route="spur",
         where=None, elev=None, chapter=3, kind="tower",
         desc="142 号敌台，位于墙体倒 T 形分岔的顶端，三面凌空，形如将军扼守山口。"),
    dict(id="jiankou", name="箭扣", en="Arrow Nock", route="main",
         where=[40.4555, 116.5246], elev=757, chapter=2, kind="ridge",
         desc="墙体在此跌落到全线最低处，两侧山脊张开如弓，缺口形似搭箭的扣，箭扣因此得名。"),
    dict(id="xiaobudalagong", name="小布达拉", en="Little Potala", route="main",
         where=[40.456083, 116.529621], elev=None, chapter=1, kind="tower",
         desc="128 号敌台建在陡崖之上，敌楼与山体层层叠叠，远看酷似布达拉宫，是箭扣最上镜的敌楼。"),
    dict(id="zhengbeilou", name="正北楼", en="True North Tower", route="main",
         where=[40.454511, 116.536050], elev=1031, chapter=0, kind="tower",
         desc="122 号敌台，箭扣东端的制高点，海拔约 1031 米。东望慕田峪，西眺箭扣全线，是经典徒步路线的起点。"),
]

landmarks = []
for spec in landmark_specs:
    if spec["where"] is None:
        if spec["id"] == "xidawall":
            d, s, pt = project(routes["west"], (40.4620, 116.4920))
        else:
            d, s, pt = project(routes["spur"], tower142)
    else:
        d, s, pt = project(routes[spec["route"]], (spec["where"][0], spec["where"][1]))
    pos = spec["where"] or (tower142 if spec["id"] == "jiangjun" else pt)
    landmarks.append({
        "id": spec["id"], "name": spec["name"], "en": spec["en"],
        "route": spec["route"], "s": round(s, 1),
        "lat": round(pos[0], 7), "lon": round(pos[1], 7),
        "elevation": spec["elev"], "chapter": spec["chapter"],
        "kind": spec["kind"], "desc": spec["desc"],
    })

# ---------------------------------------------------------------- write
route_out = {}
for key, pts in routes.items():
    route_out[key] = {
        "length": lengths[key],
        "points": [[round(lat, 7), round(lon, 7)] for lat, lon in pts],
    }

doc = {
    "origin": [LAT0, 116.5135],
    "routes": route_out,
    "towers": towers,
    "landmarks": landmarks,
    "attribution": [
        "Wall centre-lines and tower positions: © OpenStreetMap contributors (ODbL 1.0)",
        "Terrain: AWS Terrain Tiles / Mapzen, SRTM-derived (public domain)",
        "Feature names and historical notes: field reports and travel documentation",
    ],
    "note": "This is an interpretive reconstruction. Wall, stairs and towers are procedural and not a survey-grade model.",
}
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n")
print(f"towers: {len(towers)}, landmarks: {len(landmarks)}, size: {OUT.stat().st_size // 1024} KiB")
for lm in landmarks:
    print(f"  {lm['chapter']} {lm['name']:<6} {lm['route']:<5} s={lm['s']:7.1f}")
