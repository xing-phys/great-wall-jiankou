import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WallRoute } from './route';
import { Heightfield } from './data';
import type { TowerData } from './types';
import type { WorldMaterials } from './textures';
import { clamp, mulberry32, smoothstep, valueNoise } from './noise';

const TILE = 2.4;
const DECK_TILE = 3.6;

type Geo = THREE.BufferGeometry;

function planarUV(geo: Geo, tile = TILE): void {
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const ax = Math.abs(nor.getX(i));
    const ay = Math.abs(nor.getY(i));
    const az = Math.abs(nor.getZ(i));
    let u: number;
    let v: number;
    if (ay > 0.72) {
      u = x;
      v = z;
    } else if (ax > az) {
      u = z;
      v = y;
    } else {
      u = x;
      v = y;
    }
    uv[i * 2] = u / tile;
    uv[i * 2 + 1] = v / tile;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

function addColor(geo: Geo, tint: THREE.Color, bottomY = -2, topY = 8): void {
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const s = 0.62 + smoothstep(bottomY, topY, y) * 0.38;
    colors[i * 3] = tint.r * s;
    colors[i * 3 + 1] = tint.g * s;
    colors[i * 3 + 2] = tint.b * s;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

function box(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  tint: THREE.Color,
  rotY = 0,
): Geo {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rotY) g.rotateY(rotY);
  g.translate(x, y, z);
  planarUV(g);
  addColor(g, tint, y - h / 2, y + h / 2);
  return g;
}

function archPath(width: number, height: number, bottom: number, cx = 0): THREE.Path {
  const r = Math.min(width / 2, height * 0.6);
  const p = new THREE.Path();
  p.moveTo(cx - width / 2, bottom);
  p.lineTo(cx - width / 2, bottom + height - r);
  p.absarc(cx, bottom + height - r, r, Math.PI, 0, true);
  p.lineTo(cx + width / 2, bottom);
  p.closePath();
  return p;
}

function panelGeometry(
  width: number,
  height: number,
  thickness: number,
  holes: Array<{ w: number; h: number; bottom: number; cx: number }>,
): Geo {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0);
  shape.lineTo(width / 2, 0);
  shape.lineTo(width / 2, height);
  shape.lineTo(-width / 2, height);
  shape.closePath();
  for (const hole of holes) {
    if (hole.bottom + hole.h >= height - 0.18) continue;
    shape.holes.push(archPath(hole.w, hole.h, hole.bottom, hole.cx));
  }
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
    curveSegments: 12,
    steps: 1,
  });
  geo.translate(0, 0, -thickness / 2);
  return geo;
}

interface PanelSide {
  u: THREE.Vector3;
  v: THREE.Vector3;
  pos: THREE.Vector3;
  width: number;
}

function placePanel(geo: Geo, side: PanelSide): void {
  const m = new THREE.Matrix4().makeBasis(side.u, new THREE.Vector3(0, 1, 0), side.v);
  m.setPosition(side.pos);
  geo.applyMatrix4(m);
}

function buildTowerGeometry(t: TowerData, materials: WorldMaterials): Geo | null {
  const [w, d, h] = t.size;
  const ruin = t.ruin;
  const rnd = mulberry32((t.num ?? 7) * 3217 + 11);
  const tint = new THREE.Color().setRGB(
    0.86 + rnd() * 0.14,
    0.84 + rnd() * 0.14,
    0.79 + rnd() * 0.13,
  );
  const parts: Geo[] = [];
  const wallT = Math.max(0.8, Math.min(1.1, w * 0.1));

  // foundation, buried through the wall body
  parts.push(box(w + 1.2, 8, d + 1.2, 0, -4, 0, tint.clone().multiplyScalar(0.62)));

  if (ruin === 'base') {
    parts.push(box(w * 0.98, 2.2, d * 0.98, 0, 1.1, 0, tint.clone().multiplyScalar(0.86)));
    parts.push(box(w * 0.72, 0.55, d * 0.8, 0.2, 2.45, 0.1, tint.clone().multiplyScalar(0.8), 0.04));
    for (let i = 0; i < 9; i++) {
      const s = 0.25 + rnd() * 0.7;
      parts.push(box(
        0.5 + rnd() * 1.1,
        0.25 + rnd() * 0.5,
        0.4 + rnd() * 0.9,
        (rnd() - 0.5) * (w + 2.4),
        0.15,
        (rnd() - 0.5) * (d + 2.4),
        tint.clone().multiplyScalar(0.72 + rnd() * 0.12),
        rnd() * Math.PI,
      ));
    }
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].index) {
        const ni = parts[i].toNonIndexed();
        parts[i].dispose();
        parts[i] = ni;
      }
    }
    const merged = mergeGeometries(parts, false);
    parts.forEach((p) => p.dispose());
    return merged;
  }

  const broken = ruin === 'broken';
  const moon = ruin === 'moon';
  const nine = ruin === 'nine';
  const roofless = ruin === 'roofless' || ruin === 'moon' || ruin === 'nine';
  const panelHeights = [
    h * (broken ? 0.56 + rnd() * 0.18 : 1) - (ruin === 'roofless' ? rnd() * 0.8 : 0),
    h * (broken ? 0.52 + rnd() * 0.22 : 1) - (ruin === 'roofless' ? rnd() * 0.8 : 0),
    h * (broken ? 0.6 + rnd() * 0.2 : 1) - (ruin === 'roofless' ? rnd() * 0.8 : 0),
    h * (broken ? 0.54 + rnd() * 0.2 : 1) - (ruin === 'roofless' ? rnd() * 0.8 : 0),
  ];

  const endHoles = (hh: number): Array<{ w: number; h: number; bottom: number; cx: number }> => {
    const out: Array<{ w: number; h: number; bottom: number; cx: number }> = [];
    out.push({ w: 2.2, h: 3.3, bottom: 0.06, cx: 0 });
    if (hh > 6.0) {
      out.push({ w: 0.62, h: 1.05, bottom: 4.4, cx: -d * 0.32 });
      out.push({ w: 0.62, h: 1.05, bottom: 4.4, cx: d * 0.32 });
    }
    return out;
  };

  const sideHoles = (width: number, hh: number): Array<{ w: number; h: number; bottom: number; cx: number }> => {
    const out: Array<{ w: number; h: number; bottom: number; cx: number }> = [];
    if (hh < 3.2) return out;
    if (nine) {
      for (let i = 0; i < 9; i++) {
        out.push({ w: 0.58, h: 1.2, bottom: 4.6, cx: (i - 4) * (width / 10) });
      }
      return out;
    }
    const n = width > 9.5 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const cx = (i / (n - 1) - 0.5) * width * 0.58;
      out.push({ w: 0.8, h: 1.15, bottom: hh * 0.52, cx });
    }
    return out;
  };

  const sides: PanelSide[] = [
    {
      width: w,
      u: new THREE.Vector3(1, 0, 0),
      v: new THREE.Vector3(0, 0, 1),
      pos: new THREE.Vector3(0, 0, d / 2 - wallT / 2),
    },
    {
      width: w,
      u: new THREE.Vector3(-1, 0, 0),
      v: new THREE.Vector3(0, 0, -1),
      pos: new THREE.Vector3(0, 0, -d / 2 + wallT / 2),
    },
    {
      width: d,
      u: new THREE.Vector3(0, 0, 1),
      v: new THREE.Vector3(1, 0, 0),
      pos: new THREE.Vector3(w / 2 - wallT / 2, 0, 0),
    },
    {
      width: d,
      u: new THREE.Vector3(0, 0, -1),
      v: new THREE.Vector3(-1, 0, 0),
      pos: new THREE.Vector3(-w / 2 + wallT / 2, 0, 0),
    },
  ];

  for (let si = 0; si < 4; si++) {
    const side = sides[si];
    const isEnd = si >= 2;
    let hh = panelHeights[si];
    if (moon) {
      hh = isEnd ? h : 1.1;
    }
    if (hh < 0.6) continue;
    let holes: Array<{ w: number; h: number; bottom: number; cx: number }>;
    if (moon && isEnd) {
      holes = [{ w: 2.7, h: 4.1, bottom: 0.06, cx: 0 }];
    } else if (moon) {
      holes = [];
    } else if (isEnd) {
      holes = endHoles(hh);
    } else {
      holes = sideHoles(side.width, hh);
    }
    const geo = panelGeometry(side.width, hh, wallT, holes);
    placePanel(geo, side);
    planarUV(geo);
    addColor(geo, tint, 0, h);
    parts.push(geo);
  }

  if (!roofless) {
    // solid roof slab and a crenellated parapet
    parts.push(box(w, 0.36, d, 0, h + 0.18, 0, tint.clone().multiplyScalar(0.92)));
    const rh = h + 0.36;
    const pw = 0.4;
    const ph = 0.62;
    parts.push(box(w, ph, pw, 0, rh + ph / 2, d / 2 - pw / 2, tint));
    parts.push(box(w, ph, pw, 0, rh + ph / 2, -d / 2 + pw / 2, tint));
    parts.push(box(pw, ph, d - pw * 2, w / 2 - pw / 2, rh + ph / 2, 0, tint));
    parts.push(box(pw, ph, d - pw * 2, -w / 2 + pw / 2, rh + ph / 2, 0, tint));
    const merlonH = 0.5;
    const step = 2.3;
    for (let x = -w / 2 + 1.1; x < w / 2 - 0.4; x += step) {
      parts.push(box(1.15, merlonH, 0.4, x, rh + ph + merlonH / 2, d / 2 - pw / 2, tint));
      parts.push(box(1.15, merlonH, 0.4, x, rh + ph + merlonH / 2, -d / 2 + pw / 2, tint));
    }
    for (let z = -d / 2 + 1.1; z < d / 2 - 0.4; z += step) {
      parts.push(box(0.4, merlonH, 1.15, w / 2 - pw / 2, rh + ph + merlonH / 2, z, tint));
      parts.push(box(0.4, merlonH, 1.15, -w / 2 + pw / 2, rh + ph + merlonH / 2, z, tint));
    }
  } else if (nine) {
    // a few broken merlons on the crown
    for (let i = 0; i < 7; i++) {
      parts.push(box(1.1, 0.45, 0.34,
        (rnd() - 0.5) * w * 0.8,
        panelHeights[0] + 0.2,
        d / 2 - wallT / 2,
        tint,
        (rnd() - 0.5) * 0.08));
    }
  }

  // rubble around ruined bases
  if (ruin !== 'intact') {
    for (let i = 0; i < 8; i++) {
      const rr = 0.25 + rnd() * 0.55;
      parts.push(box(
        rr * 2,
        rr * 1.2,
        rr * 1.7,
        (rnd() - 0.5) * (w + 3),
        0.1,
        (rnd() - 0.5) * (d + 3),
        tint.clone().multiplyScalar(0.62 + rnd() * 0.15),
        rnd() * Math.PI,
      ));
    }
  }

  for (let i = 0; i < parts.length; i++) {
    if (parts[i].index) {
      const ni = parts[i].toNonIndexed();
      parts[i].dispose();
      parts[i] = ni;
    }
  }
  const merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  if (!merged) console.warn('tower geometry merge failed', t.id);
  return merged;
}

export interface TowerObject {
  data: TowerData;
  mesh: THREE.Mesh;
  position: THREE.Vector3;
  s: number;
}

export function buildTowers(
  towers: TowerData[],
  routes: Record<string, WallRoute>,
  materials: WorldMaterials,
): TowerObject[] {
  const out: TowerObject[] = [];
  for (const t of towers) {
    const route = routes[t.route];
    if (!route) continue;
    const s = clamp(t.s, 0, route.length);
    const p = route.at(s);
    const geo = buildTowerGeometry(t, materials);
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, materials.brick);
    mesh.position.set(p.x, p.y - 0.05, p.z);
    mesh.rotation.y = p.yaw;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `tower-${t.num ?? t.id}`;
    out.push({ data: t, mesh, position: new THREE.Vector3(p.x, p.y, p.z), s });
  }
  return out;
}

interface WallObjects {
  group: THREE.Group;
  mat: THREE.Matrix4;
}

export function buildWallMeshes(
  routes: Record<string, WallRoute>,
  towers: TowerData[],
  materials: WorldMaterials,
  hf: Heightfield,
  junctionS: number,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'walls';

  const brickInst = materials.brick.clone();
  brickInst.vertexColors = false;
  const pavingInst = materials.walkway.clone();
  pavingInst.vertexColors = false;

  for (const id of Object.keys(routes)) {
    const route = routes[id];
    if (route.samples.length < 2) continue;
    group.add(buildWallBody(route, materials, hf));
    group.add(buildDeck(route, materials));
  }

  // parapets and merlons across all routes
  const parapetMats: THREE.Matrix4[] = [];
  const parapetColors: THREE.Color[] = [];
  const merlonMats: THREE.Matrix4[] = [];
  const merlonColors: THREE.Color[] = [];
  const stepMats: THREE.Matrix4[] = [];
  const stepColors: THREE.Color[] = [];
  const dummy = new THREE.Object3D();

  // do not run parapets or stairs through the towers and the junction platform
  const skip: Record<string, Array<[number, number]>> = {};
  for (const rid of Object.keys(routes)) skip[rid] = [];
  for (const t of towers) {
    if (!skip[t.route]) continue;
    skip[t.route].push([t.s - t.size[0] / 2 - 1.3, t.s + t.size[0] / 2 + 1.3]);
  }
  if (skip.main) skip.main.push([junctionS - 4.6, junctionS + 4.6]);
  if (skip.west) skip.west.push([0, 5]);
  const isSkipped = (rid: string, s: number) => {
    for (const [a, b] of skip[rid]) if (s > a && s < b) return true;
    return false;
  };

  const parapetHash = (s: number, side: number) => valueNoise(s * 0.035 + side * 7.3, 2.1);

  for (const [rid, route] of Object.entries(routes)) {
    const scenic = rid === 'west' || rid === 'east' || rid === 'northwest';
    // parapets
    for (let s = 3; s < route.length - 3; s += 1.65) {
      if (isSkipped(rid, s)) continue;
      const p = route.at(s);
      for (const side of [-1, 1]) {
        const off = 1.92 * side;
        const x = p.x + p.nx * off;
        const z = p.z + p.nz * off;
        const ruin = valueNoise(s * 0.028 + side * 3.1, rid === 'spur' ? 9 : 4.2);
        if (ruin < 0.15 || (scenic && ruin < 0.22)) continue;
        if (parapetHash(s, side) < 0.1) continue;
        const h = 0.5 + valueNoise(s * 0.2 + side, 8.8) * 0.09;
        dummy.position.set(x, p.y + h / 2, z);
        dummy.rotation.set(0, p.yaw, 0);
        dummy.scale.set(1.58, h, 0.44);
        dummy.updateMatrix();
        parapetMats.push(dummy.matrix.clone());
        const c = 0.82 + valueNoise(s * 0.5, side * 5) * 0.18;
        parapetColors.push(new THREE.Color(c, c * 0.98, c * 0.92));
      }
    }
    // merlons
    for (let s = 4; s < route.length - 4; s += 2.55) {
      if (isSkipped(rid, s)) continue;
      const p = route.at(s);
      for (const side of [-1, 1]) {
        const off = 1.92 * side;
        if (parapetHash(s, side) < 0.1) continue;
        if (valueNoise(s * 0.11 + side * 11.2, 21.7) < 0.55) continue;
        const x = p.x + p.nx * off;
        const z = p.z + p.nz * off;
        const h = 0.38 + valueNoise(s * 0.3, side * 2) * 0.22;
        dummy.position.set(x, p.y + 0.56 + h / 2, z);
        dummy.rotation.set(0, p.yaw, 0);
        dummy.scale.set(1.12, h, 0.44);
        dummy.updateMatrix();
        merlonMats.push(dummy.matrix.clone());
        const c = 0.8 + valueNoise(s * 0.4, side) * 0.2;
        merlonColors.push(new THREE.Color(c, c * 0.98, c * 0.92));
      }
    }
    // stairs on the walkable walls
    if (rid === 'main' || rid === 'spur') {
      for (let s = 5; s < route.length - 5; s += 0.62) {
        if (isSkipped(rid, s)) continue;
        const slope = route.slopeAt(s);
        if (Math.abs(slope) < 0.27) continue;
        const p = route.at(s);
        dummy.position.set(p.x, p.y - 0.7, p.z);
        dummy.rotation.set(0, p.yaw, 0);
        dummy.scale.set(3.18, 1.7, 0.78);
        dummy.updateMatrix();
        stepMats.push(dummy.matrix.clone());
        const c = 0.78 + Math.abs(valueNoise(s * 0.7, 3.3)) * 0.18;
        stepColors.push(new THREE.Color(c, c * 0.98, c * 0.92));
      }
    }
  }

  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const addInstanced = (
    mats: THREE.Matrix4[],
    cols: THREE.Color[],
    material: THREE.Material,
    name: string,
  ) => {
    if (!mats.length) return;
    const mesh = new THREE.InstancedMesh(unitBox, material, mats.length);
    mesh.name = name;
    for (let i = 0; i < mats.length; i++) {
      mesh.setMatrixAt(i, mats[i]);
      mesh.setColorAt(i, cols[i]);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    group.add(mesh);
  };
  addInstanced(parapetMats, parapetColors, brickInst, 'parapets');
  addInstanced(merlonMats, merlonColors, brickInst, 'merlons');
  addInstanced(stepMats, stepColors, pavingInst, 'stairs');

  return group;
}

function buildWallBody(route: WallRoute, materials: WorldMaterials, hf: Heightfield): THREE.Mesh {
  const n = route.samples.length;
  const pos = new Float32Array(n * 4 * 3);
  const nor = new Float32Array(n * 4 * 3);
  const uv = new Float32Array(n * 4 * 2);
  const col = new Float32Array(n * 4 * 3);
  const index: number[] = [];
  const halfTop = 2.16;
  const halfBase = 2.95;

  for (let i = 0; i < n; i++) {
    const p = route.samples[i];
    const footL = hf.heightAt(p.x + p.nx * 3.4, p.z + p.nz * 3.4);
    const footR = hf.heightAt(p.x - p.nx * 3.4, p.z - p.nz * 3.4);
    const baseYL = Math.max(p.y - 28, Math.min(footL, p.y - 2.2) - 2.6);
    const baseYR = Math.max(p.y - 28, Math.min(footR, p.y - 2.2) - 2.6);
    const tint = 0.84 + valueNoise(p.s * 0.11, 4.2) * 0.16;
    // the surviving wall face stops just below the modern walking deck;
    // otherwise its rim can occlude the deck at grazing angles
    const topY = p.y - 0.42;

    const idx = i * 4;
    // base L, top L, top R, base R
    pos.set([p.x + p.nx * halfBase, baseYL, p.z + p.nz * halfBase], (idx + 0) * 3);
    pos.set([p.x + p.nx * halfTop, topY, p.z + p.nz * halfTop], (idx + 1) * 3);
    pos.set([p.x - p.nx * halfTop, topY, p.z - p.nz * halfTop], (idx + 2) * 3);
    pos.set([p.x - p.nx * halfBase, baseYR, p.z - p.nz * halfBase], (idx + 3) * 3);

    nor.set([p.nx, 0.12, p.nz], (idx + 0) * 3);
    nor.set([p.nx, 0.12, p.nz], (idx + 1) * 3);
    nor.set([-p.nx, 0.12, -p.nz], (idx + 2) * 3);
    nor.set([-p.nx, 0.12, -p.nz], (idx + 3) * 3);

    uv.set([p.s / TILE, baseYL / TILE], (idx + 0) * 2);
    uv.set([p.s / TILE, topY / TILE], (idx + 1) * 2);
    uv.set([p.s / TILE, topY / TILE], (idx + 2) * 2);
    uv.set([p.s / TILE, baseYR / TILE], (idx + 3) * 2);

    col.set([tint * 0.56, tint * 0.55, tint * 0.51], (idx + 0) * 3);
    col.set([tint, tint * 0.995, tint * 0.92], (idx + 1) * 3);
    col.set([tint, tint * 0.995, tint * 0.92], (idx + 2) * 3);
    col.set([tint * 0.56, tint * 0.55, tint * 0.51], (idx + 3) * 3);
  }

  for (let i = 0; i < n - 1; i++) {
    const a = i * 4;
    const b = (i + 1) * 4;
    index.push(a + 0, b + 0, b + 1, a + 0, b + 1, a + 1);
    index.push(a + 3, a + 2, b + 2, a + 3, b + 2, b + 3);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(index);
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, materials.brick);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = `wall-body-${route.id}`;
  return mesh;
}

function buildDeck(route: WallRoute, materials: WorldMaterials): THREE.Mesh {
  const n = route.samples.length;
  const pos = new Float32Array(n * 2 * 3);
  const nor = new Float32Array(n * 2 * 3);
  const uv = new Float32Array(n * 2 * 2);
  const col = new Float32Array(n * 2 * 3);
  const index: number[] = [];
  const half = 2.17;
  for (let i = 0; i < n; i++) {
    const p = route.samples[i];
    const idx = i * 2;
    pos.set([p.x + p.nx * half, p.y + 0.02, p.z + p.nz * half], (idx + 0) * 3);
    pos.set([p.x - p.nx * half, p.y + 0.02, p.z - p.nz * half], (idx + 1) * 3);
    nor.set([0, 1, 0], (idx + 0) * 3);
    nor.set([0, 1, 0], (idx + 1) * 3);
    uv.set([p.s / TILE, 0], (idx + 0) * 2);
    uv.set([p.s / TILE, 1.8], (idx + 1) * 2);
    const shade = 0.72 + valueNoise(p.s * 0.35, 9.2) * 0.18;
    col.set([shade, shade * 0.98, shade * 0.93], (idx + 0) * 3);
    col.set([shade * 0.93, shade * 0.92, shade * 0.87], (idx + 1) * 3);
  }
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2;
    const b = (i + 1) * 2;
    // front faces must point up (otherwise DoubleSide flips the normal down
    // and the deck only receives the dark ground hemisphere)
    index.push(a, b + 1, a + 1, a, b, b + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(index);
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, materials.walkway);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.name = `wall-deck-${route.id}`;
  return mesh;
}

export function buildJunction(
  route: WallRoute,
  s: number,
  materials: WorldMaterials,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'beijing-knot';
  const p = route.at(s);
  const platform = new THREE.Mesh(
    new THREE.CylinderGeometry(3.55, 3.8, 0.42, 8),
    materials.stone,
  );
  platform.position.set(p.x, p.y + 0.18, p.z);
  platform.castShadow = true;
  platform.receiveShadow = true;
  group.add(platform);

  const stoneMat = materials.stone.clone();
  stoneMat.color = new THREE.Color(0x8e8778);
  const stele = new THREE.Mesh(new THREE.BoxGeometry(0.62, 1.75, 0.3), stoneMat);
  stele.position.set(p.x + p.nx * 2.45, p.y + 1.25, p.z + p.nz * 2.45);
  stele.rotation.y = p.yaw;
  stele.castShadow = true;
  group.add(stele);
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.24, 0.68), stoneMat);
  base.position.set(stele.position.x, p.y + 0.52, stele.position.z);
  base.rotation.y = p.yaw;
  base.castShadow = true;
  group.add(base);

  // a couple of fallen blocks
  const rubbleMat = materials.brick.clone();
  rubbleMat.vertexColors = false;
  rubbleMat.color = new THREE.Color(0x8d8475);
  const rnd = mulberry32(42);
  for (let i = 0; i < 5; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.45 + rnd() * 0.6, 0.3, 0.35 + rnd() * 0.5), rubbleMat);
    b.position.set(
      p.x + (rnd() - 0.5) * 5,
      p.y + 0.3,
      p.z + (rnd() - 0.5) * 5,
    );
    b.rotation.y = rnd() * Math.PI;
    b.castShadow = true;
    group.add(b);
  }

  return group;
}

