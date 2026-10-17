import * as THREE from 'three';
import type { TerrainMeta, WallData } from './types';

export const DEG = Math.PI / 180;
const EARTH_LAT = 111132;

export async function loadJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`无法加载 ${url} (${res.status})`);
  return (await res.json()) as T;
}

export async function loadWallData(base = './data/'): Promise<WallData> {
  return loadJson<WallData>(`${base}wall.json`);
}

export async function loadTerrainMeta(base = './data/'): Promise<TerrainMeta> {
  return loadJson<TerrainMeta>(`${base}terrain.json`);
}

async function decodeTerrarium(url: string, width: number, height: number): Promise<Float32Array> {
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  await img.decode();
  if (img.naturalWidth !== width || img.naturalHeight !== height) {
    throw new Error(`高程图尺寸不符：${img.naturalWidth}×${img.naturalHeight}，应为 ${width}×${height}`);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('无法创建 2D 画布');
  ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, width, height).data;
  const heights = new Float32Array(width * height);
  for (let i = 0, j = 0; i < heights.length; i++, j += 4) {
    heights[i] = px[j] * 256 + px[j + 1] + px[j + 2] / 256 - 32768;
  }
  return heights;
}

/**
 * A georeferenced DEM with local ENU metric coordinates.
 * +X is east, +Z is south, +Y is elevation in metres.
 */
export class Heightfield {
  readonly meta: TerrainMeta;
  readonly width: number;
  readonly height: number;
  readonly heights: Float32Array;
  readonly lon0: number;
  readonly lat0: number;
  readonly mPerDegLon: number;
  readonly mPerDegLat = EARTH_LAT;
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
  readonly xMin: number;
  readonly xMax: number;
  readonly zMin: number;
  readonly zMax: number;
  readonly dx: number;
  readonly dz;

  constructor(meta: TerrainMeta, heights: Float32Array) {
    this.meta = meta;
    this.width = meta.size[0];
    this.height = meta.size[1];
    this.heights = heights;
    [this.west, this.south, this.east, this.north] = meta.bbox;
    [this.lon0, this.lat0] = meta.origin;
    this.mPerDegLon = 111320 * Math.cos(this.lat0 * DEG);
    this.xMin = (this.west - this.lon0) * this.mPerDegLon;
    this.xMax = (this.east - this.lon0) * this.mPerDegLon;
    this.zMin = -(this.north - this.lat0) * this.mPerDegLat;
    this.zMax = -(this.south - this.lat0) * this.mPerDegLat;
    this.dx = (this.xMax - this.xMin) / (this.width - 1);
    this.dz = (this.zMax - this.zMin) / (this.height - 1);
  }

  static async load(base = './data/'): Promise<Heightfield> {
    const meta = await loadTerrainMeta(base);
    const heights = await decodeTerrarium(
      `${base}terrain.png`,
      meta.size[0],
      meta.size[1],
    );
    return new Heightfield(meta, heights);
  }

  lonToX(lon: number): number {
    return (lon - this.lon0) * this.mPerDegLon;
  }

  latToZ(lat: number): number {
    return -(lat - this.lat0) * this.mPerDegLat;
  }

  xToLon(x: number): number {
    return this.lon0 + x / this.mPerDegLon;
  }

  zToLat(z: number): number {
    return this.lat0 - z / this.mPerDegLat;
  }

  /** Bilinear elevation query in metres. */
  heightAt(x: number, z: number): number {
    const col = (this.lon0 - this.west + x / this.mPerDegLon) / (this.east - this.west) * (this.width - 1);
    const row = (this.north - this.lat0 + z / this.mPerDegLat) / (this.north - this.south) * (this.height - 1);
    const cx = col < 0 ? 0 : col > this.width - 1 ? this.width - 1 : col;
    const ry = row < 0 ? 0 : row > this.height - 1 ? this.height - 1 : row;
    const x0 = Math.floor(cx);
    const y0 = Math.floor(ry);
    const x1 = Math.min(x0 + 1, this.width - 1);
    const y1 = Math.min(y0 + 1, this.height - 1);
    const fx = cx - x0;
    const fy = ry - y0;
    const h = this.heights;
    const a = h[y0 * this.width + x0];
    const b = h[y0 * this.width + x1];
    const c = h[y1 * this.width + x0];
    const d = h[y1 * this.width + x1];
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }

  normalAt(x: number, z: number, target = new THREE.Vector3()): THREE.Vector3 {
    const e = 8;
    const hl = this.heightAt(x - e, z);
    const hr = this.heightAt(x + e, z);
    const hn = this.heightAt(x, z - e);
    const hs = this.heightAt(x, z + e);
    return target.set(hl - hr, 2 * e, hn - hs).normalize();
  }

  slopeAt(x: number, z: number): number {
    const n = this.normalAt(x, z);
    return Math.acos(Math.min(1, n.y));
  }

  /** Max height in a small disc — used to seat the wall on the ridge. */
  maxAround(x: number, z: number, radius: number, steps = 5): number {
    let m = this.heightAt(x, z);
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      m = Math.max(m, this.heightAt(x + Math.cos(a) * radius, z + Math.sin(a) * radius));
    }
    return m;
  }
}
