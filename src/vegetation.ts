import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Heightfield } from './data';
import { WallRoute } from './route';
import { fbm, mulberry32, smoothstep, valueNoise } from './noise';

function paint(geo: THREE.BufferGeometry, color: THREE.Color): THREE.BufferGeometry {
  const pos = geo.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    col[i * 3] = color.r;
    col[i * 3 + 1] = color.g;
    col[i * 3 + 2] = color.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

function coniferGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.1, 0.17, 1.15, 5, 1, true);
  trunk.translate(0, 0.575, 0);
  parts.push(paint(trunk, new THREE.Color(0x4a3b2b)));
  const c1 = new THREE.ConeGeometry(1.0, 2.5, 7, 1, true);
  c1.translate(0, 2.1, 0);
  parts.push(paint(c1, new THREE.Color(0x9aa889)));
  const c2 = new THREE.ConeGeometry(0.7, 1.9, 7, 1, true);
  c2.translate(0, 3.35, 0);
  parts.push(paint(c2, new THREE.Color(0xb7c2a0)));
  const nonIndexed = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  const merged = mergeGeometries(nonIndexed, false)!;
  parts.forEach((g) => g.dispose());
  nonIndexed.forEach((g) => {
    if (!parts.includes(g)) g.dispose();
  });
  return merged;
}

function bushGeometry(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 0);
  g.scale(1, 0.7, 1);
  g.translate(0, 0.55, 0);
  paint(g, new THREE.Color(0x7e8b67));
  return g;
}

interface WallGrid {
  cell: number;
  cells: Map<string, Array<[number, number]>>;
  near(x: number, z: number, radius: number): number;
}

function wallGrid(routes: Record<string, WallRoute>): WallGrid {
  const cell = 48;
  const cells = new Map<string, Array<[number, number]>>();
  for (const route of Object.values(routes)) {
    const stride = Math.max(1, Math.floor(4 / route.step));
    for (let i = 0; i < route.samples.length; i += stride) {
      const p = route.samples[i];
      const key = `${Math.floor(p.x / cell)},${Math.floor(p.z / cell)}`;
      let arr = cells.get(key);
      if (!arr) cells.set(key, (arr = []));
      arr.push([p.x, p.z]);
    }
  }
  return {
    cell,
    cells,
    near(x, z, radius) {
      const cx = Math.floor(x / cell);
      const cz = Math.floor(z / cell);
      const r = Math.ceil(radius / cell);
      let best = Infinity;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const arr = cells.get(`${cx + dx},${cz + dz}`);
          if (!arr) continue;
          for (const [px, pz] of arr) {
            const d = (px - x) ** 2 + (pz - z) ** 2;
            if (d < best) best = d;
          }
        }
      }
      return Math.sqrt(best);
    },
  };
}

export function buildVegetation(
  hf: Heightfield,
  routes: Record<string, WallRoute>,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'vegetation';
  const grid = wallGrid(routes);

  const geo = coniferGeometry();
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    metalness: 0,
    flatShading: true,
  });

  const rnd = mulberry32(0x1a2b3c4d);
  const cell = 27;
  const chunks = 6;
  const chunkSizeX = (hf.xMax - hf.xMin) / chunks;
  const chunkSizeZ = (hf.zMax - hf.zMin) / chunks;
  const buckets: Array<{ matrices: THREE.Matrix4[]; colors: THREE.Color[] }> = Array.from(
    { length: chunks * chunks },
    () => ({ matrices: [], colors: [] }),
  );
  const dummy = new THREE.Object3D();
  const palette = [
    new THREE.Color(0x2b3a21),
    new THREE.Color(0x354724),
    new THREE.Color(0x415229),
    new THREE.Color(0x4f5c2f),
    new THREE.Color(0x666237),
    new THREE.Color(0x7a6733),
  ];

  const cols = Math.floor((hf.xMax - hf.xMin) / cell);
  const rows = Math.floor((hf.zMax - hf.zMin) / cell);

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = hf.xMin + (i + 0.1 + rnd() * 0.8) * cell;
      const z = hf.zMin + (j + 0.1 + rnd() * 0.8) * cell;
      const h = hf.heightAt(x, z);
      if (h < 360 || h > 1250) continue;
      const slope = hf.slopeAt(x, z);
      if (slope > 0.68) continue;
      const dwall = grid.near(x, z, 380);
      if (dwall < 14) continue;
      const mask = fbm(x * 0.0042 + 5, z * 0.0042 - 2, 4);
      const boost = dwall < 420 ? 1.18 : 0.82;
      const accept = (0.2 + smoothstep(0.28, 0.82, mask) * 0.4) * boost;
      if (rnd() > accept) continue;

      const count = 1 + (rnd() < 0.55 ? 1 : 0) + (rnd() < 0.24 ? 1 : 0);
      for (let k = 0; k < count; k++) {
        const tx = x + (rnd() - 0.5) * 16;
        const tz = z + (rnd() - 0.5) * 16;
        const th = hf.heightAt(tx, tz);
        if (th < 355 || th > 1270) continue;
        const ts = hf.slopeAt(tx, tz);
        if (ts > 0.72) continue;
        if (dwall < 17 && grid.near(tx, tz, 14) < 12) continue;
        const scale = 1.15 + rnd() * 1.55 - ts * 0.35;
        dummy.position.set(tx, th - 0.2, tz);
        dummy.rotation.set(0, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.09);
        dummy.scale.setScalar(Math.max(0.65, scale));
        dummy.updateMatrix();
        const ci = Math.min(chunks - 1, Math.floor((tz - hf.zMin) / chunkSizeZ));
        const cj = Math.min(chunks - 1, Math.floor((tx - hf.xMin) / chunkSizeX));
        const bucket = buckets[ci * chunks + cj];
        bucket.matrices.push(dummy.matrix.clone());
        const c = palette[Math.floor(rnd() * palette.length)].clone();
        const v = 0.82 + rnd() * 0.36;
        c.multiplyScalar(v);
        bucket.colors.push(c);
      }
    }
  }

  let total = 0;
  for (let ci = 0; ci < chunks; ci++) {
    for (let cj = 0; cj < chunks; cj++) {
      const bucket = buckets[ci * chunks + cj];
      if (!bucket.matrices.length) continue;
      const inst = new THREE.InstancedMesh(geo, material, bucket.matrices.length);
      inst.name = `trees-${ci}-${cj}`;
      for (let k = 0; k < bucket.matrices.length; k++) {
        inst.setMatrixAt(k, bucket.matrices[k]);
        inst.setColorAt(k, bucket.colors[k]);
      }
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      inst.castShadow = false;
      inst.receiveShadow = true;
      inst.computeBoundingSphere();
      group.add(inst);
      total += bucket.matrices.length;
    }
  }
  console.info(`trees: ${total}`);

  // low scrub hugging the wall foot
  const bushGeo = bushGeometry();
  const bushMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    flatShading: true,
  });
  const bushes: THREE.Matrix4[] = [];
  const bushColors: THREE.Color[] = [];
  const brnd = mulberry32(0x9911);
  for (const route of Object.values(routes)) {
    for (let s = 3; s < route.length - 3; s += 3.4) {
      if (brnd() > 0.55) continue;
      const p = route.at(s);
      const side = brnd() < 0.5 ? -1 : 1;
      const off = side * (13 + brnd() * 18);
      const x = p.x + p.nx * off;
      const z = p.z + p.nz * off;
      if (hf.slopeAt(x, z) > 0.62) continue;
      if (hf.heightAt(x, z) < 350) continue;
      const scale = 0.5 + brnd() * 0.9;
      dummy.position.set(x, hf.heightAt(x, z) - 0.1, z);
      dummy.rotation.set(0, brnd() * Math.PI * 2, 0);
      dummy.scale.set(scale * (0.8 + brnd() * 0.5), scale, scale * (0.8 + brnd() * 0.5));
      dummy.updateMatrix();
      bushes.push(dummy.matrix.clone());
      bushColors.push(new THREE.Color(0x6c7746).multiplyScalar(0.85 + brnd() * 0.35));
    }
  }
  if (bushes.length) {
    const inst = new THREE.InstancedMesh(bushGeo, bushMat, bushes.length);
    for (let i = 0; i < bushes.length; i++) {
      inst.setMatrixAt(i, bushes[i]);
      inst.setColorAt(i, bushColors[i]);
    }
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    inst.receiveShadow = true;
    inst.computeBoundingSphere();
    group.add(inst);
  }

  void valueNoise;

  // scattered limestone boulders
  const rockGeo = new THREE.IcosahedronGeometry(1, 1);
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x847d6d, roughness: 1, flatShading: true });
  const rocks: THREE.Matrix4[] = [];
  const rockRnd = mulberry32(0x71a55);
  const rockGrid = 55;
  const rcols = Math.floor((hf.xMax - hf.xMin) / rockGrid);
  const rrows = Math.floor((hf.zMax - hf.zMin) / rockGrid);
  for (let j = 0; j < rrows; j++) {
    for (let i = 0; i < rcols; i++) {
      const x = hf.xMin + (i + rockRnd()) * rockGrid;
      const z = hf.zMin + (j + rockRnd()) * rockGrid;
      const h = hf.heightAt(x, z);
      const slope = hf.slopeAt(x, z);
      if (h < 520 || slope < 0.25) continue;
      if (rockRnd() > 0.045 + slope * 0.1) continue;
      const dwall = grid.near(x, z, 80);
      if (dwall < 22) continue;
      const s = 0.5 + rockRnd() * 1.7 + slope * 1.4;
      dummy.position.set(x, h - s * 0.32, z);
      dummy.rotation.set(rockRnd() * 0.6, rockRnd() * Math.PI * 2, rockRnd() * 0.6);
      dummy.scale.set(s * (0.8 + rockRnd() * 0.6), s * (0.5 + rockRnd() * 0.5), s * (0.8 + rockRnd() * 0.6));
      dummy.updateMatrix();
      rocks.push(dummy.matrix.clone());
    }
  }
  if (rocks.length) {
    const rockInst = new THREE.InstancedMesh(rockGeo, rockMat, rocks.length);
    for (let i = 0; i < rocks.length; i++) rockInst.setMatrixAt(i, rocks[i]);
    rockInst.instanceMatrix.needsUpdate = true;
    rockInst.castShadow = true;
    rockInst.receiveShadow = true;
    rockInst.computeBoundingSphere();
    group.add(rockInst);
  }

  return group;
}
