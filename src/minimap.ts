import * as THREE from 'three';
import { Heightfield } from './data';
import type { Landmark } from './types';
import { WallRoute } from './route';
import { clamp, smoothstep } from './noise';

const WEST = 116.4555;
const EAST = 116.5495;
const SOUTH = 40.4445;
const NORTH = 40.4915;
const W = 280;
const H = 184;

export class Minimap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private base: HTMLCanvasElement;
  private hf: Heightfield;
  private landmarks: Landmark[];
  private routes: Record<string, WallRoute>;
  private activeId: string | null = null;
  private onClick: (id: string) => void;
  private last = 0;
  private hit: Array<{ id: string; x: number; y: number }> = [];

  constructor(
    canvas: HTMLCanvasElement,
    hf: Heightfield,
    routes: Record<string, WallRoute>,
    landmarks: Landmark[],
    onClick: (id: string) => void,
  ) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.hf = hf;
    this.landmarks = landmarks;
    this.routes = routes;
    this.onClick = onClick;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.base = document.createElement('canvas');
    this.base.width = W * dpr;
    this.base.height = H * dpr;
    this.paintBase(dpr);
    canvas.addEventListener('click', (ev) => this.handleClick(ev));
  }

  private mapX(lon: number): number {
    return ((lon - WEST) / (EAST - WEST)) * W;
  }

  private mapY(lat: number): number {
    return ((NORTH - lat) / (NORTH - SOUTH)) * H;
  }

  private worldToMap(x: number, z: number): [number, number] {
    return [this.mapX(this.hf.xToLon(x)), this.mapY(this.hf.zToLat(z))];
  }

  private paintBase(dpr: number): void {
    const c = this.base;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const iw = c.width;
    const ih = c.height;
    const img = ctx.createImageData(iw, ih);
    const d = img.data;
    for (let py = 0; py < ih; py++) {
      const lat = NORTH - ((py + 0.5) / ih) * (NORTH - SOUTH);
      for (let px = 0; px < iw; px++) {
        const lon = WEST + ((px + 0.5) / iw) * (EAST - WEST);
        const x = this.hf.lonToX(lon);
        const z = this.hf.latToZ(lat);
        const h = this.hf.heightAt(x, z);
        const hx = this.hf.heightAt(x + 28, z) - this.hf.heightAt(x - 28, z);
        const hz = this.hf.heightAt(x, z + 28) - this.hf.heightAt(x, z - 28);
        const shade = clamp(0.64 + (-hx - hz) * 0.0035, 0.2, 1.15);
        const t = smoothstep(350, 1250, h);
        const edge = smoothstep(0.32, 0.55, Math.min(px, py, iw - 1 - px, ih - 1 - py) / Math.min(iw, ih) * 2);
        const i = (py * iw + px) * 4;
        d[i] = (28 + t * 42) * shade * (0.55 + edge * 0.45);
        d[i + 1] = (34 + t * 40) * shade * (0.55 + edge * 0.45);
        d[i + 2] = (28 + t * 28) * shade * (0.55 + edge * 0.45);
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // routes
    for (const [id, route] of Object.entries(this.routes)) {
      const main = id === 'main';
      ctx.beginPath();
      for (let i = 0; i < route.samples.length; i += 3) {
        const p = route.samples[i];
        const [x, y] = this.worldToMap(p.x, p.z);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      const pLast = route.samples[route.samples.length - 1];
      const [xl, yl] = this.worldToMap(pLast.x, pLast.z);
      ctx.lineTo(xl, yl);
      ctx.strokeStyle = main ? 'rgba(228,214,188,0.88)' : 'rgba(196,184,160,0.5)';
      ctx.lineWidth = main ? 1.5 : 1;
      ctx.setLineDash(main ? [] : [2.5, 3]);
      ctx.shadowColor = main ? 'rgba(232,220,198,0.7)' : 'transparent';
      ctx.shadowBlur = main ? 5 : 0;
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.shadowBlur = 0;

    // scale bar
    const kmPx = (1000 / (this.hf.mPerDegLon * (EAST - WEST))) * W;
    ctx.strokeStyle = 'rgba(232,224,208,0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(12, H - 12);
    ctx.lineTo(12 + kmPx, H - 12);
    ctx.moveTo(12, H - 15);
    ctx.lineTo(12, H - 9);
    ctx.moveTo(12 + kmPx, H - 15);
    ctx.lineTo(12 + kmPx, H - 9);
    ctx.stroke();
    ctx.fillStyle = 'rgba(232,224,208,0.65)';
    ctx.font = '8px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('1 km', 12, H - 17);

    // north
    ctx.fillStyle = 'rgba(232,224,208,0.7)';
    ctx.font = '9px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('N', W - 16, 15);
    ctx.beginPath();
    ctx.moveTo(W - 13, 19);
    ctx.lineTo(W - 13, 29);
    ctx.lineTo(W - 16, 25);
    ctx.moveTo(W - 13, 29);
    ctx.lineTo(W - 10, 25);
    ctx.strokeStyle = 'rgba(232,224,208,0.6)';
    ctx.stroke();
  }

  setActive(id: string | null): void {
    this.activeId = id;
  }

  private handleClick(ev: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width) * W;
    const y = ((ev.clientY - rect.top) / rect.height) * H;
    let best: { id: string; d: number } | null = null;
    for (const h of this.hit) {
      const d = Math.hypot(h.x - x, h.y - y);
      if (d < 13 && (!best || d < best.d)) best = { id: h.id, d };
    }
    if (best) this.onClick(best.id);
  }

  update(
    camera: THREE.Camera,
    mode: 'overview' | 'walk',
    player: { x: number; z: number; yaw: number } | null,
    activeId: string | null,
  ): void {
    const now = performance.now();
    if (now - this.last < 70) return;
    this.last = now;
    this.activeId = activeId;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(this.base, 0, 0, W, H);

    // landmarks
    this.hit = [];
    for (const lm of this.landmarks) {
      if (lm.data.chapter >= 90) continue;
      const [x, y] = this.worldToMap(lm.position.x, lm.position.z);
      this.hit.push({ id: lm.data.id, x, y });
      const active = lm.data.id === this.activeId;
      if (active) {
        ctx.beginPath();
        ctx.arc(x, y, 5.5, 0, Math.PI * 2);
        ctx.strokeStyle = '#d46443';
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(x, y, active ? 2.4 : 1.7, 0, Math.PI * 2);
      ctx.fillStyle = active ? '#e9d9bb' : 'rgba(228,214,188,0.8)';
      ctx.fill();
      ctx.font = '8.5px "Helvetica Neue", Arial, sans-serif';
      ctx.fillStyle = active ? 'rgba(242,226,198,0.95)' : 'rgba(220,210,190,0.55)';
      if (!active) {
        const n = lm.data.chapter + 1;
        ctx.fillText(String(n).padStart(2, '0'), x + 4, y - 3);
      }
    }

    // camera / player
    let cx: number;
    let cy: number;
    let yaw: number;
    if (mode === 'walk' && player) {
      [cx, cy] = this.worldToMap(player.x, player.z);
      yaw = player.yaw;
    } else {
      const wx = camera.position.x;
      const wz = camera.position.z;
      [cx, cy] = this.worldToMap(wx, wz);
      cx = clamp(cx, 4, W - 4);
      cy = clamp(cy, 4, H - 4);
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      yaw = Math.atan2(dir.x, -dir.z);
    }

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-yaw);
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(-4.5, 4);
    ctx.lineTo(0, 2);
    ctx.lineTo(4.5, 4);
    ctx.closePath();
    ctx.fillStyle = '#d46443';
    ctx.shadowColor = 'rgba(212,100,67,0.8)';
    ctx.shadowBlur = 6;
    ctx.fill();
    ctx.restore();
    ctx.shadowBlur = 0;
  }
}
