import * as THREE from 'three';
import { mulberry32, valueNoise } from './noise';

export interface WorldMaterials {
  brick: THREE.MeshStandardMaterial;
  paving: THREE.MeshStandardMaterial;
  walkway: THREE.MeshStandardMaterial;
  stone: THREE.MeshStandardMaterial;
  terrainDetail: THREE.Texture;
}

function canvasOf(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建纹理画布');
  return [canvas, ctx];
}

function heightToNormal(height: Float32Array, size: number, strength: number): THREE.CanvasTexture {
  const [canvas, ctx] = canvasOf(size);
  const img = ctx.createImageData(size, size);
  const data = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const xl = (x - 1 + size) % size;
      const xr = (x + 1) % size;
      const yu = (y - 1 + size) % size;
      const yd = (y + 1) % size;
      const dx = height[y * size + xr] - height[y * size + xl];
      const dy = height[yd * size + x] - height[yu * size + x];
      let nx = -dx * strength;
      let ny = dy * strength;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const i = (y * size + x) * 4;
      data[i] = (nx * 0.5 + 0.5) * 255;
      data[i + 1] = (ny * 0.5 + 0.5) * 255;
      data[i + 2] = (nz * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

function makeBrick(anisotropy: number): {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
} {
  const size = 512;
  const [canvas, ctx] = canvasOf(size);
  const [hCanvas, hCtx] = canvasOf(size);
  const height = new Float32Array(size * size);
  const rnd = mulberry32(0x5eed1234);

  // mortar base
  ctx.fillStyle = '#57534a';
  ctx.fillRect(0, 0, size, size);
  hCtx.fillStyle = '#000';
  hCtx.fillRect(0, 0, size, size);
  height.fill(36);

  const rows = 8;
  const bh = size / rows;
  const bw = size / 4;
  const gap = 3;
  const palette = [
    ['#918b7c', '#a29a88', '#7e7a6e', '#979181'],
    ['#8a8477', '#9b9383', '#77736a', '#a59d8d'],
    ['#9b9586', '#b0a794', '#868173', '#8d877a'],
  ];

  for (let row = 0; row < rows; row++) {
    const offset = (row % 2) * (bw / 2);
    for (let col = -1; col < 5; col++) {
      const x = col * bw + offset + gap;
      const y = row * bh + gap;
      const w = bw - gap * 2;
      const h = bh - gap * 2;
      const pal = palette[Math.floor(rnd() * palette.length)];
      const base = pal[Math.floor(rnd() * pal.length)];
      ctx.fillStyle = base;
      ctx.globalAlpha = 0.92 + rnd() * 0.08;
      ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = 1;

      // bevel and grime
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(x, y, w, 2);
      ctx.fillStyle = 'rgba(0,0,0,0.20)';
      ctx.fillRect(x, y + h - 3, w, 3);
      ctx.fillRect(x + w - 3, y, 3, h);

      // speckling / pitting
      for (let k = 0; k < 26; k++) {
        const px = x + rnd() * w;
        const py = y + rnd() * h;
        const a = 0.05 + rnd() * 0.12;
        ctx.fillStyle = rnd() > 0.5 ? `rgba(40,38,32,${a})` : `rgba(230,224,205,${a * 0.7})`;
        ctx.fillRect(px, py, 1 + rnd() * 3, 1 + rnd() * 2);
      }

      // occasional crack
      if (rnd() < 0.18) {
        ctx.strokeStyle = 'rgba(45,42,36,0.45)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        let px = x + w * rnd();
        let py = y + h * rnd();
        ctx.moveTo(px, py);
        for (let k = 0; k < 4; k++) {
          px += (rnd() - 0.5) * 18;
          py += rnd() * 12;
          ctx.lineTo(px, py);
        }
        ctx.stroke();
      }

      // brick top height with a slight dish
      for (let yy = y; yy < y + h; yy++) {
        for (let xx = x; xx < x + w; xx++) {
          const edge = Math.min(xx - x, x + w - 1 - xx, yy - y, y + h - 1 - yy);
          const bevel = Math.min(1, edge / 4);
          const n = valueNoise(xx * 0.09, yy * 0.09) * 14 + valueNoise(xx * 0.31, yy * 0.31) * 5;
          const idx = (yy % size) * size + (xx % size);
          height[idx] = 120 + bevel * 75 + n;
        }
      }
    }
  }

  // moss in the joints, more in the lower half
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const a = 0.02 + rnd() * 0.08;
    ctx.fillStyle = `rgba(74,88,55,${a})`;
    ctx.beginPath();
    ctx.arc(x, y, 2 + rnd() * 9, 0, Math.PI * 2);
    ctx.fill();
  }
  // broad dust / wear
  for (let i = 0; i < 26; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = 30 + rnd() * 110;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${rnd() > 0.5 ? '22,24,20' : '196,188,168'},${0.03 + rnd() * 0.04})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // height canvas (for reference / optional roughness use)
  const hImg = hCtx.createImageData(size, size);
  for (let i = 0; i < height.length; i++) {
    const v = Math.max(0, Math.min(255, height[i]));
    hImg.data[i * 4] = v;
    hImg.data[i * 4 + 1] = v;
    hImg.data[i * 4 + 2] = v;
    hImg.data[i * 4 + 3] = 255;
  }
  hCtx.putImageData(hImg, 0, 0);
  void hCanvas;

  const map = new THREE.CanvasTexture(canvas);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = anisotropy;
  const normalMap = heightToNormal(height, size, 0.012);
  normalMap.anisotropy = anisotropy;
  return { map, normalMap };
}

function makePaving(anisotropy: number): {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
} {
  const size = 512;
  const [canvas, ctx] = canvasOf(size);
  const height = new Float32Array(size * size);
  const rnd = mulberry32(0x9a12b3c4);

  ctx.fillStyle = '#4c4a42';
  ctx.fillRect(0, 0, size, size);
  height.fill(30);

  const cells = 4;
  const step = size / cells;
  for (let row = 0; row < cells; row++) {
    for (let col = 0; col < cells; col++) {
      const pad = 3 + rnd() * 3;
      const x = col * step + pad;
      const y = row * step + pad;
      const w = step - pad * 2 - rnd() * 4;
      const h = step - pad * 2 - rnd() * 4;
      const v = 132 + Math.floor(rnd() * 42);
      ctx.fillStyle = `rgb(${v},${v - 3},${v - 10})`;
      ctx.fillRect(x, y, w, h);

      ctx.strokeStyle = 'rgba(235,228,210,0.10)';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
      ctx.fillStyle = 'rgba(20,20,18,0.18)';
      ctx.fillRect(x, y + h - 3, w, 3);

      for (let k = 0; k < 60; k++) {
        const px = x + rnd() * w;
        const py = y + rnd() * h;
        ctx.fillStyle = `rgba(${rnd() > 0.5 ? '30,30,28' : '220,214,198'},${0.03 + rnd() * 0.08})`;
        ctx.fillRect(px, py, 1 + rnd() * 4, 1 + rnd() * 3);
      }
      if (rnd() < 0.5) {
        ctx.strokeStyle = 'rgba(45,44,38,0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + rnd() * w, y);
        ctx.lineTo(x + rnd() * w, y + h);
        ctx.stroke();
      }

      const iy0 = Math.floor(y);
      const iy1 = Math.min(size, Math.ceil(y + h));
      const ix0 = Math.floor(x);
      const ix1 = Math.min(size, Math.ceil(x + w));
      for (let yy = iy0; yy < iy1; yy++) {
        for (let xx = ix0; xx < ix1; xx++) {
          const edge = Math.min(xx - x, x + w - 1 - xx, yy - y, y + h - 1 - yy);
          const bevel = Math.min(1, Math.max(0, edge) / 5);
          const n = valueNoise(xx * 0.05, yy * 0.05) * 20 + valueNoise(xx * 0.2, yy * 0.2) * 7;
          height[yy * size + xx] = 95 + bevel * 80 + n;
        }
      }
    }
  }

  // moss between the flags
  for (let i = 0; i < 1800; i++) {
    ctx.fillStyle = `rgba(58,76,44,${0.02 + rnd() * 0.07})`;
    ctx.beginPath();
    ctx.arc(rnd() * size, rnd() * size, 2 + rnd() * 12, 0, Math.PI * 2);
    ctx.fill();
  }

  const map = new THREE.CanvasTexture(canvas);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = anisotropy;
  const normalMap = heightToNormal(height, size, 0.01);
  normalMap.anisotropy = anisotropy;
  return { map, normalMap };
}

function makeTerrainDetail(anisotropy: number): THREE.CanvasTexture {
  const size = 256;
  const [canvas, ctx] = canvasOf(size);
  const img = ctx.createImageData(size, size);
  const data = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // tileable-ish multi-octave grain
      const n =
        valueNoise(x * 0.05, y * 0.05) * 0.45 +
        valueNoise(x * 0.13 + 31, y * 0.13 + 11) * 0.32 +
        valueNoise(x * 0.37 + 71, y * 0.37 + 5) * 0.16 +
        valueNoise(x * 0.9 + 13, y * 0.9 + 79) * 0.07;
      const v = 214 + n * 42;
      const i = (y * size + x) * 4;
      data[i] = v;
      data[i + 1] = v * 0.995;
      data[i + 2] = v * 0.97;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  return tex;
}

export function createMaterials(renderer: THREE.WebGLRenderer): WorldMaterials {
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const brickTex = makeBrick(maxAniso);
  const paveTex = makePaving(maxAniso);
  const detail = makeTerrainDetail(maxAniso);

  const brick = new THREE.MeshStandardMaterial({
    map: brickTex.map,
    normalMap: brickTex.normalMap,
    normalScale: new THREE.Vector2(0.85, 0.85),
    vertexColors: true,
    roughness: 0.96,
    metalness: 0,
    color: 0xffffff,
    side: THREE.DoubleSide,
  });
  const paving = new THREE.MeshStandardMaterial({
    map: paveTex.map,
    normalMap: paveTex.normalMap,
    normalScale: new THREE.Vector2(0.7, 0.7),
    vertexColors: true,
    roughness: 0.98,
    metalness: 0,
    color: 0xc5bdae,
    side: THREE.DoubleSide,
  });
  const walkway = new THREE.MeshStandardMaterial({
    map: brickTex.map,
    normalMap: brickTex.normalMap,
    normalScale: new THREE.Vector2(0.95, 0.95),
    vertexColors: true,
    roughness: 0.98,
    metalness: 0,
    color: 0xd2c9b8,
    side: THREE.DoubleSide,
  });
  const stone = new THREE.MeshStandardMaterial({
    map: paveTex.map,
    normalMap: paveTex.normalMap,
    normalScale: new THREE.Vector2(0.5, 0.5),
    roughness: 1,
    metalness: 0,
    color: 0xbdb5a2,
  });

  return { brick, paving, walkway, stone, terrainDetail: detail };
}
