# Jiankou Great Wall · 3D

[中文](README.md) · **English**

An interactive, browser-based 3D reconstruction of the Jiankou section of the Great Wall. Real SRTM terrain and OpenStreetMap wall traces are combined with procedurally built Ming masonry, watchtowers and vegetation. Orbit the ridge, read the full-route elevation profile, or walk the parapet from True North Tower to Nine-Eye Tower.

**Live demo:** <https://xing-phys.github.io/great-wall-jiankou/> · [![Deploy](https://github.com/xing-phys/great-wall-jiankou/actions/workflows/pages.yml/badge.svg)](https://github.com/xing-phys/great-wall-jiankou/actions/workflows/pages.yml)

![Jiankou Great Wall 3D](docs/hero.png)

## What is inside

- **7.6 km main wall**: from True North Tower (No. 122) through Little Potala (128), Arrow Nock, General Guarding the Pass (142), Heavenly Ladder (146), Eagle Flying Upside Down and Beijing Knot, then north to Nine-Eye Tower. Three scenic branches — West Rampart, the eastern continuation and the north-west wall beyond Nine-Eye Tower — are modelled but not walkable.
- **About 50 watchtowers** placed on the OpenStreetMap tower nodes, including numbered towers 122–154 and the northern towers. Ruined bases, roofless shells and broken walls are mixed; Beijing Knot has a small stone platform and stele.
- **Two ways to explore**: an orbit camera for the whole ridge, and a pointer-locked first-person walk constrained to the wall top.
- **Nine landmarks** with bilingual names and short notes; click a 3D label, the minimap, the elevation profile or a card to fly there. In walk mode, click a minimap dot to teleport.
- **Time-of-day slider**: positions the sun and updates the sky gradient, procedural clouds, fog, hemisphere light and shadows.
- **Navigation HUD**: route minimap, full-route elevation profile, landmark cards and a data/credits panel.
- **No external image assets**: brick, paving, terrain detail, trees, shrubs and rocks are all generated in code.

![Walking the parapet from True North Tower](docs/walk.png)

![Beijing Knot](docs/beijing-knot.png)

> The in-app interface is currently in Chinese. This README is the full English documentation.

## Nine landmarks

Approximate distances are measured along the reconstructed main line from True North Tower.

| Landmark | Chinese | Approx. km | Notes |
| --- | --- | --- | --- |
| True North Tower | 正北楼 | 0.0 | No. 122; 1,031 m; the eastern high point and the classic start of the hike. |
| Little Potala | 小布达拉 | 0.7 | No. 128; the tower and its cliff resemble the Potala Palace. |
| Arrow Nock | 箭扣 | 1.2 | The lowest point of the line, about 757 m; the wall dips into a V like the nock of an arrow. |
| General Guarding the Pass | 将军守关 | 3.2 | No. 142, at the head of an inverted-T spur; the walking route passes the junction below it. |
| Heavenly Ladder | 天梯 | 3.6 | A near-vertical stair section; No. 146 sits at the top. |
| Eagle Flying Upside Down | 鹰飞倒仰 | 4.2 | The wall climbs a steep, eagle-shaped ridge; 1,013 m. |
| Beijing Knot | 北京结 | 5.0 | The three-way junction of the inner and outer walls; 958 m. |
| Nine-Eye Tower | 九眼楼 | 7.6 | A large tower famous for its nine arrow windows; 1,141 m; the northern end. |
| West Rampart | 西大墙 | west branch | A 70–80° wall climbing the cliff west of Beijing Knot; scenery only. |

## Run

Requires Node **20.19+ / 22.12+** (Vite 7). pnpm is recommended:

```bash
pnpm install
pnpm dev
```

Open <http://127.0.0.1:5173>.

```bash
pnpm build      # type-check + production build to dist/
pnpm preview    # preview the production build
```

If the install reports that esbuild's build script was ignored, run `pnpm approve-builds --all` once. The project uses esbuild's prebuilt platform binary, so `pnpm dev` usually works without it.

## Deploy

Every push to `main` runs [`.github/workflows/pages.yml`](.github/workflows/pages.yml), builds the site and publishes it to GitHub Pages:

**<https://xing-phys.github.io/great-wall-jiankou/>**

The build uses relative asset paths, so the same `dist/` also works when hosted under any sub-path. Pages is configured with **Source: GitHub Actions**.

## URL parameters

| Parameter | Example | Effect |
| --- | --- | --- |
| `mode` | `mode=walk` | Start directly in walk mode. |
| `at` | `at=jiankou` | Focus a landmark: `zhengbeilou`, `xiaobudalagong`, `jiankou`, `jiangjun`, `tianti`, `yingfei`, `beijingjie`, `jiuyanlou`, `xidawall`. |
| `hour` | `hour=17.2` | Time of day (6.2–18.6). |
| `quality` | `quality=low` | Lower-resolution terrain grid for weaker GPUs. |
| `hint` | `hint=0` | Hide the pointer-lock hint (useful for screenshots). |
| `debug` | `debug=1` | Expose `window.__jiankou` and `window.__app` for debugging. |

Example: <https://xing-phys.github.io/great-wall-jiankou/?mode=walk&at=yingfei&hour=16.4>

## Controls

**Orbit**

- Drag to rotate, scroll to zoom, right-drag to pan.
- Click a 3D landmark label, a minimap dot, an elevation-profile stop or a landmark card to fly closer.
- `R` returns to the default view; `V` switches to walk mode.

**Walk**

- Click the canvas to capture the mouse. `W/S` move forward/back, `A/D` strafe, `Shift` runs.
- Move the mouse to look; `Esc` releases the pointer; `V` returns to orbit.
- The camera follows the wall top automatically and centres itself when passing through a tower door.
- The elevation profile is hidden in walk mode to keep the view clear; the top HUD shows the current section, altitude and distance to the next landmark.

## How the scene is built

1. **Terrain** — AWS Open Data Terrarium elevation tiles (Mapzen / SRTM-derived), zoom 14, resampled to 1024×813 (about 10 m per pixel). The real ridge shape is preserved. `scripts/build_terrain.py` downloads, stitches and writes `public/data/terrain.png` (Terrarium encoding) and `terrain.json`.
2. **Wall alignment** — OpenStreetMap `barrier=city_wall` / `historic=citywalls` ways are joined into one main chain from True North Tower through Arrow Nock, General Guarding the Pass, Heavenly Ladder, Eagle Flying Upside Down and Beijing Knot to Nine-Eye Tower. `scripts/build_wall.py` handles the fork, simplifies the geometry and projects the tower nodes.
3. **Wall generation** — the runtime projects longitude/latitude into local metres, resamples the centre line every 2 m, smooths the ridge, raises the deck about 2.7 m above it and builds a 4.3 m-wide brick walkway with parapets and crenellations. Stone steps appear on slopes steeper than about 15°.
4. **Watchtowers** — each OSM tower node is snapped to its route arc length. Hollow towers with arched doors and arrow windows are built by extruding wall panels; each tower gets a size, height and ruin state. The Beijing Knot has a junction platform and a stone stele.
5. **Vegetation** — conifers, shrubs and limestone boulders are scattered by elevation, slope, aspect and noise, keeping clear of the wall corridor.
6. **Lighting** — solar azimuth and elevation are approximated from the hour. The directional sun, hemisphere light, sky gradient, procedural clouds and shadows update in real time.

### A note on accuracy

This is an **interpretive reconstruction**, not a survey. The terrain is smoothed 30 m-class SRTM data, so cliffs and scree are softened. Wall height, parapets, stairs, towers and vegetation are procedural. Do not use it for navigation.

## Rebuilding the data

```bash
python3 scripts/build_terrain.py   # needs numpy + Pillow; downloads elevation tiles
python3 scripts/build_wall.py      # reads the OSM extracts in scripts/raw/
```

The OSM extracts downloaded in October 2026 (`scripts/raw/osm-walls.json` and `osm-named.json`) are committed. `scripts/raw/terrain-tiles/` is a download cache and is ignored.

## Project layout

```text
src/
  main.ts          scene assembly, mode switching, URL parameters
  terrain.ts       terrain mesh and vertex colours
  route.ts         wall centre line, deck heights, arc-length projection
  wall.ts          wall body, parapets, stairs, towers, Beijing Knot platform
  vegetation.ts    trees, shrubs, boulders
  textures.ts      procedural brick/paving/terrain textures and normal maps
  sky.ts           sky, clouds, sun and fog
  overview.ts      OrbitControls + cinematic camera flights
  walk.ts          first-person controller, wall constraint, pointer lock
  hud.ts           landmark cards, elevation profile, walk HUD, loading, credits
  minimap.ts       route minimap
  labels.ts        3D landmark labels
  data.ts          terrain decoding and local metric projection
scripts/           data-build scripts and raw OSM extracts
public/data/       baked terrain and wall data
docs/              screenshots
```

## Sources & licenses

- Wall centre lines and tower positions: [OpenStreetMap](https://www.openstreetmap.org/), © OpenStreetMap contributors, ODbL 1.0.
- Terrain: [AWS Open Data Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Mapzen / SRTM-derived), public domain.
- Landmark coordinates, elevations and feature order: [Beijing Walking — Jiankou Great Wall and Xizhazi village](http://www.beijingwalking.com/jiankou-great-wall/).
- Tower numbers and section notes: [“Walking Jiankou fourteen times” field reports](https://blog.sina.com.cn/s/blog_41370d690102x7m7.html) (General Guarding the Pass = No. 142, Little Potala = No. 128, the tower at the top of Heavenly Ladder = No. 146, and others).

## License

The code is released under the MIT License (see `LICENSE`). `public/data/wall.json` and the OSM-derived parts are subject to ODbL 1.0; the terrain data is public domain. The in-app credits panel repeats the attribution.
