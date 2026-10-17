import { Heightfield } from './data';
import type { RouteData, RouteSample } from './types';

const STEP = 2.0;

function gaussianKernel(radiusM: number, sigmaM: number, step: number): Float32Array {
  const r = Math.max(1, Math.ceil(radiusM / step));
  const k = new Float32Array(r * 2 + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const d = i * step;
    const v = Math.exp(-(d * d) / (2 * sigmaM * sigmaM));
    k[i + r] = v;
    sum += v;
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  return k;
}

function smooth1D(values: Float32Array, kernel: Float32Array): Float32Array {
  const n = values.length;
  const r = (kernel.length - 1) / 2;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) {
      const j = Math.min(n - 1, Math.max(0, i + k));
      acc += values[j] * kernel[k + r];
    }
    out[i] = acc;
  }
  return out;
}

/**
 * A smoothed, walked-on wall centre-line. Elevations are the *deck* height,
 * already lifted above the ridge and smoothed along the wall.
 */
export class WallRoute {
  readonly id: string;
  readonly walkable: boolean;
  readonly samples: RouteSample[];
  readonly length: number;
  readonly step = STEP;

  constructor(id: string, data: RouteData, hf: Heightfield, walkable: boolean, taper = false) {
    this.id = id;
    this.walkable = walkable;

    const raw = data.points.map(([lat, lon]) => [hf.lonToX(lon), hf.latToZ(lat)] as [number, number]);
    const pts: Array<[number, number]> = [];
    if (raw.length === 1) {
      pts.push(raw[0], raw[0]);
    } else {
      for (let i = 0; i < raw.length - 1; i++) {
        const a = raw[i];
        const b = raw[i + 1];
        const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const n = Math.max(1, Math.ceil(d / STEP));
        for (let j = 0; j < n; j++) {
          const t = j / n;
          pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        }
      }
      pts.push(raw[raw.length - 1]);
    }

    // gentle corner-rounding
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 1; i < pts.length - 1; i++) {
        pts[i][0] = pts[i - 1][0] * 0.22 + pts[i][0] * 0.56 + pts[i + 1][0] * 0.22;
        pts[i][1] = pts[i - 1][1] * 0.22 + pts[i][1] * 0.56 + pts[i + 1][1] * 0.22;
      }
    }

    const n = pts.length;
    const dist = new Float32Array(n);
    for (let i = 1; i < n; i++) {
      dist[i] = dist[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    }
    this.length = dist[n - 1];

    const tangents = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(n - 1, i + 1)];
      let tx = b[0] - a[0];
      let tz = b[1] - a[1];
      const l = Math.hypot(tx, tz) || 1;
      tx /= l;
      tz /= l;
      tangents[i * 2] = tx;
      tangents[i * 2 + 1] = tz;
    }

    // ridge height + a wide, low-pass deck profile
    const base = new Float32Array(n);
    const centers = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = pts[i][0];
      const z = pts[i][1];
      const tx = tangents[i * 2];
      const tz = tangents[i * 2 + 1];
      const nx = -tz;
      const nz = tx;
      centers[i] = hf.heightAt(x, z);
      let m = centers[i];
      for (const off of [-6, -3, 3, 6]) {
        m = Math.max(m, hf.heightAt(x + nx * off, z + nz * off));
      }
      base[i] = m;
    }
    const k = gaussianKernel(26, 8.5, STEP);
    let deck = smooth1D(base, k);
    for (let i = 0; i < n; i++) {
      deck[i] = Math.max(deck[i] + 2.65, centers[i] + 1.35);
    }
    deck = smooth1D(deck, gaussianKernel(7, 3.0, STEP));

    if (taper) {
      const start = Math.max(0, this.length - 85);
      for (let i = 0; i < n; i++) {
        if (dist[i] > start) {
          const t = Math.min(1, (dist[i] - start) / 85);
          const e = t * t * (3 - 2 * t);
          deck[i] = deck[i] * (1 - e) + (centers[i] + 0.85) * e;
        }
      }
    }

    this.samples = new Array(n);
    for (let i = 0; i < n; i++) {
      const tx = tangents[i * 2];
      const tz = tangents[i * 2 + 1];
      this.samples[i] = {
        s: dist[i],
        x: pts[i][0],
        y: deck[i],
        z: pts[i][1],
        tx,
        tz,
        nx: -tz,
        nz: tx,
        yaw: Math.atan2(-tz, tx),
      };
    }
  }

  private indexAt(s: number): number {
    const n = this.samples.length;
    if (s <= 0) return 0;
    if (s >= this.length) return n - 1;
    let lo = 0;
    let hi = n - 1;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (this.samples[mid].s <= s) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  at(s: number): RouteSample {
    const ss = Math.max(0, Math.min(this.length, s));
    const i = this.indexAt(ss);
    const a = this.samples[i];
    const b = this.samples[Math.min(this.samples.length - 1, i + 1)];
    const span = b.s - a.s;
    const t = span > 1e-6 ? (ss - a.s) / span : 0;
    const tx = a.tx + (b.tx - a.tx) * t;
    const tz = a.tz + (b.tz - a.tz) * t;
    const l = Math.hypot(tx, tz) || 1;
    return {
      s: ss,
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t,
      tx: tx / l,
      tz: tz / l,
      nx: -tz / l,
      nz: tx / l,
      yaw: Math.atan2(-tz, tx),
    };
  }

  slopeAt(s: number): number {
    const a = this.at(Math.max(0, s - 2.5));
    const b = this.at(Math.min(this.length, s + 2.5));
    return (b.y - a.y) / Math.max(0.001, b.s - a.s);
  }

  /** Nearest point for a world-space position. Returns arc length and signed offset. */
  nearest(x: number, z: number): { s: number; lateral: number; dist: number } {
    let best = { s: 0, lateral: 0, dist: Infinity };
    for (let i = 0; i < this.samples.length - 1; i++) {
      const a = this.samples[i];
      const b = this.samples[i + 1];
      const vx = b.x - a.x;
      const vz = b.z - a.z;
      const L2 = vx * vx + vz * vz;
      const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / L2)) : 0;
      const px = a.x + vx * t;
      const pz = a.z + vz * t;
      const d = Math.hypot(x - px, z - pz);
      if (d < best.dist) {
        const L = Math.hypot(vx, vz) || 1;
        const nx = -vz / L;
        const nz = vx / L;
        best = {
          s: a.s + (b.s - a.s) * t,
          lateral: (x - px) * nx + (z - pz) * nz,
          dist: d,
        };
      }
    }
    return best;
  }

  /** Approximate screen-rail sampling: returns [s, deckY] every N metres. */
  profile(maxPoints = 420): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    const stride = Math.max(1, Math.floor(this.samples.length / maxPoints));
    for (let i = 0; i < this.samples.length; i += stride) {
      out.push([this.samples[i].s, this.samples[i].y]);
    }
    const last = this.samples[this.samples.length - 1];
    out.push([last.s, last.y]);
    return out;
  }
}
