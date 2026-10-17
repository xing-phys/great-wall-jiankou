import * as THREE from 'three';
import { Heightfield } from './data';
import { clamp, fbm, smoothstep, valueNoise } from './noise';

const PALETTE: Array<[number, THREE.Color]> = [
  [260, new THREE.Color(0x2f3c2b)],
  [520, new THREE.Color(0x3a4730)],
  [760, new THREE.Color(0x475236)],
  [960, new THREE.Color(0x5d5c40)],
  [1120, new THREE.Color(0x7b735c)],
  [1260, new THREE.Color(0x9a8d79)],
];
const ROCK = new THREE.Color(0x8c8475);
const LIMESTONE = new THREE.Color(0xb4aa96);
const FOREST = new THREE.Color(0x263321);
const EARTH = new THREE.Color(0x5f513c);

function paletteAt(h: number, out: THREE.Color): THREE.Color {
  if (h <= PALETTE[0][0]) return out.copy(PALETTE[0][1]);
  for (let i = 1; i < PALETTE.length; i++) {
    if (h <= PALETTE[i][0]) {
      const t = smoothstep(PALETTE[i - 1][0], PALETTE[i][0], h);
      return out.copy(PALETTE[i - 1][1]).lerp(PALETTE[i][1], t);
    }
  }
  return out.copy(PALETTE[PALETTE.length - 1][1]);
}

export function buildTerrain(hf: Heightfield, detail: THREE.Texture, quality = 1): THREE.Group {
  const group = new THREE.Group();
  group.name = 'terrain';
  const W = hf.width;
  const H = hf.height;
  const step = quality >= 2 ? 2 : 1;
  const cols = W - 1;
  const rows = H - 1;
  const cx = 8;
  const cz = 6;
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: detail,
    roughness: 1,
    metalness: 0,
    color: 0xffffff,
    dithering: true,
  });
  material.map!.wrapS = material.map!.wrapT = THREE.RepeatWrapping;

  const tmp = new THREE.Color();
  const xStep = hf.dx;
  const zStep = hf.dz;

  for (let zc = 0; zc < cz; zc++) {
    for (let xc = 0; xc < cx; xc++) {
      // shared, quantised chunk boundaries (no gaps or overlaps at any quality)
      const gx0 = Math.round(((xc * cols) / cx) / step) * step;
      const gx1 = xc === cx - 1 ? W - 1 : Math.round((((xc + 1) * cols) / cx) / step) * step;
      const gz0 = Math.round(((zc * rows) / cz) / step) * step;
      const gz1 = zc === cz - 1 ? H - 1 : Math.round((((zc + 1) * rows) / cz) / step) * step;
      if (gx1 <= gx0 || gz1 <= gz0) continue;
      const xs: number[] = [];
      for (let v = gx0; v < gx1; v += step) xs.push(v);
      xs.push(gx1);
      const zs: number[] = [];
      for (let v = gz0; v < gz1; v += step) zs.push(v);
      zs.push(gz1);
      const nx = xs.length;
      const nz = zs.length;
      if (nx < 2 || nz < 2) continue;

      const positions = new Float32Array(nx * nz * 3);
      const normals = new Float32Array(nx * nz * 3);
      const colors = new Float32Array(nx * nz * 3);
      const uvs = new Float32Array(nx * nz * 2);
      const indices = new Uint32Array((nx - 1) * (nz - 1) * 6);
      let vi = 0;

      for (let j = 0; j < nz; j++) {
        const gy = zs[j];
        for (let i = 0; i < nx; i++) {
          const gxi = xs[i];
          const h = hf.heights[gy * W + gxi];
          const x = hf.xMin + gxi * xStep;
          const z = hf.zMin + gy * zStep;

          const hl = hf.heights[gy * W + Math.max(0, gxi - 1)];
          const hr = hf.heights[gy * W + Math.min(W - 1, gxi + 1)];
          const hn = hf.heights[Math.max(0, gy - 1) * W + gxi];
          const hs = hf.heights[Math.min(H - 1, gy + 1) * W + gxi];
          let nX = hl - hr;
          let nY = 2 * xStep;
          let nZ = hn - hs;
          const nl = Math.hypot(nX, nY, nZ);
          nX /= nl;
          nY /= nl;
          nZ /= nl;

          const slope = 1 - nY;
          const rockMix = smoothstep(0.28, 0.66, slope);
          const altitude = smoothstep(360, 1220, h);

          paletteAt(h, tmp);
          const n1 = fbm(x * 0.0055 + 11, z * 0.0055 - 4, 4);
          const n2 = fbm(x * 0.028 - 7, z * 0.028 + 3, 3);
          const northness = Math.max(0, -nZ);
          const forest = smoothstep(0.34, 0.72, n1 * 0.72 + n2 * 0.28) *
            (0.55 + northness * 0.45) * (1 - smoothstep(0.52, 0.82, slope)) *
            smoothstep(260, 440, h) * (1 - smoothstep(1180, 1320, h));
          tmp.lerp(FOREST, forest * 0.52);
          tmp.lerp(ROCK, rockMix * 0.56 + (n2 - 0.5) * 0.1);
          if (h > 760 && slope > 0.5) {
            tmp.lerp(LIMESTONE, smoothstep(0.5, 0.85, slope) * 0.42);
          }
          tmp.lerp(EARTH, (1 - altitude) * 0.05 * (1 - forest));

          // large-scale ambient occlusion in the hollows
          const hx1 = hf.heightAt(x + 85, z);
          const hx2 = hf.heightAt(x - 85, z);
          const hz1 = hf.heightAt(x, z + 85);
          const hz2 = hf.heightAt(x, z - 85);
          const avg = (hx1 + hx2 + hz1 + hz2) * 0.25;
          const ao = clamp(0.9 + (h - avg) / 130, 0.7, 1.07);
          const grain = 0.92 + valueNoise(x * 0.14, z * 0.14) * 0.12;
          const shade = ao * grain * (0.94 + n2 * 0.12);

          positions[vi * 3] = x;
          positions[vi * 3 + 1] = h;
          positions[vi * 3 + 2] = z;
          normals[vi * 3] = nX;
          normals[vi * 3 + 1] = nY;
          normals[vi * 3 + 2] = nZ;
          colors[vi * 3] = tmp.r * shade;
          colors[vi * 3 + 1] = tmp.g * shade;
          colors[vi * 3 + 2] = tmp.b * shade;
          uvs[vi * 2] = x / 120;
          uvs[vi * 2 + 1] = z / 120;
          vi++;
        }
      }

      let ii = 0;
      for (let j = 0; j < nz - 1; j++) {
        for (let i = 0; i < nx - 1; i++) {
          const a = j * nx + i;
          const b = (j + 1) * nx + i;
          const c = j * nx + i + 1;
          const d = (j + 1) * nx + i + 1;
          indices[ii++] = a;
          indices[ii++] = b;
          indices[ii++] = c;
          indices[ii++] = b;
          indices[ii++] = d;
          indices[ii++] = c;
        }
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      geo.setIndex(new THREE.BufferAttribute(indices, 1));
      geo.computeBoundingSphere();

      const mesh = new THREE.Mesh(geo, material);
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
  }

  // skirt around the data edge so the diorama never shows its underside
  const skirtGeo = new THREE.BufferGeometry();
  const sk: number[] = [];
  const minX = hf.xMin;
  const maxX = hf.xMax;
  const minZ = hf.zMin;
  const maxZ = hf.zMax;
  const drop = 320;
  const edges: Array<[number, number, number, number]> = [
    [minX, minZ, maxX, minZ],
    [maxX, minZ, maxX, maxZ],
    [maxX, maxZ, minX, maxZ],
    [minX, maxZ, minX, minZ],
  ];
  for (const [x1, z1, x2, z2] of edges) {
    const n = 90;
    for (let i = 0; i < n; i++) {
      const t1 = i / n;
      const t2 = (i + 1) / n;
      const ax = x1 + (x2 - x1) * t1;
      const az = z1 + (z2 - z1) * t1;
      const bx = x1 + (x2 - x1) * t2;
      const bz = z1 + (z2 - z1) * t2;
      const ay = hf.heightAt(ax, az);
      const by = hf.heightAt(bx, bz);
      sk.push(ax, ay, az, bx, by, bz, bx, by - drop, bz);
      sk.push(ax, ay, az, bx, by - drop, bz, ax, ay - drop, az);
    }
  }
  skirtGeo.setAttribute('position', new THREE.Float32BufferAttribute(sk, 3));
  skirtGeo.computeVertexNormals();
  const skirtMat = new THREE.MeshBasicMaterial({
    color: 0x2b302b,
    side: THREE.DoubleSide,
    fog: true,
  });
  const skirt = new THREE.Mesh(skirtGeo, skirtMat);
  skirt.name = 'terrain-skirt';
  group.add(skirt);

  return group;
}
