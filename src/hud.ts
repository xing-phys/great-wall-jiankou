import type { Landmark, Mode, WallData } from './types';
import type { WallRoute } from './route';

interface HudCallbacks {
  onMode: (mode: Mode) => void;
  onLandmark: (id: string) => void;
  onWalkHere: (id: string) => void;
  onHour: (hour: number) => void;
  onCloseInfo: () => void;
}

const KIND_LABEL: Record<string, string> = {
  tower: '敌台 · TOWER',
  ridge: '山脊 · RIDGE',
  stairs: '陡阶 · STONE STEPS',
  junction: '交汇 · JUNCTION',
};

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
}

export class Hud {
  readonly wallData: WallData;
  readonly mainRoute: WallRoute;
  readonly landmarks: Landmark[];
  private cb: HudCallbacks;
  private railStops = new Map<string, HTMLButtonElement>();
  private railProfile: Array<[number, number]> = [];
  private railMinY = 0;
  private railMaxY = 0;
  private selectedId: string | null = null;
  private hour = 16.6;
  private suppressHour = false;
  private toastTimer = 0;
  private lastWalk = 0;

  constructor(
    wallData: WallData,
    mainRoute: WallRoute,
    landmarks: Landmark[],
    cb: HudCallbacks,
  ) {
    this.wallData = wallData;
    this.mainRoute = mainRoute;
    this.landmarks = landmarks;
    this.cb = cb;

    $('mode-overview').addEventListener('click', () => cb.onMode('overview'));
    $('mode-walk').addEventListener('click', () => cb.onMode('walk'));
    $('info-close').addEventListener('click', () => cb.onCloseInfo());
    $('info-walk').addEventListener('click', () => {
      if (this.selectedId) cb.onWalkHere(this.selectedId);
    });
    $('info-fly').addEventListener('click', () => {
      if (this.selectedId) cb.onLandmark(this.selectedId);
    });
    $('credits-btn').addEventListener('click', () => this.toggleCredits(true));
    $('credits-close').addEventListener('click', () => this.toggleCredits(false));
    $('credits').addEventListener('click', (ev) => {
      if (ev.target === ev.currentTarget) this.toggleCredits(false);
    });
    const sun = $<HTMLInputElement>('sun');
    sun.value = String(this.hour);
    sun.addEventListener('input', () => {
      this.hour = Number(sun.value);
      this.updateClock();
      cb.onHour(this.hour);
    });

    this.buildProfile();
    this.buildRail();
    this.buildCredits();
    this.updateClock();
  }

  private buildProfile(): void {
    const points = this.mainRoute.profile(520);
    const ys = points.map((p) => p[1]);
    const min = Math.min(...ys);
    const max = Math.max(...ys);
    const pad = 6;
    this.railMinY = min;
    this.railMaxY = max;
    const norm = (y: number) => 56 - ((y - min) / (max - min || 1)) * 48;
    this.railProfile = points.map(([s, y]) => [s, norm(y)]);

    let line = '';
    let area = '';
    for (let i = 0; i < points.length; i++) {
      const x = (points[i][0] / this.mainRoute.length) * 1000;
      const y = norm(points[i][1]);
      line += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      area += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    }
    area += 'L1000,64L0,64Z';
    const svg = $<HTMLElement>('profile');
    svg.innerHTML = `
      <defs>
        <linearGradient id="prof-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#c8a96b" stop-opacity="0.30"/>
          <stop offset="1" stop-color="#c8a96b" stop-opacity="0.015"/>
        </linearGradient>
      </defs>
      <path d="${area}" fill="url(#prof-fill)"/>
      <line x1="0" y1="${pad + 4}" x2="1000" y2="${pad + 4}" class="prof-grid"/>
      <line x1="0" y1="32" x2="1000" y2="32" class="prof-grid"/>
      <path d="${line}" fill="none" class="prof-line"/>
    `;
    $('rail-distance').textContent = `正北楼 0 — ${(this.mainRoute.length / 1000).toFixed(1)} km 九眼楼`;
  }

  private buildRail(): void {
    const container = $('rail-points');
    const list = this.landmarks
      .filter((l) => l.data.chapter < 90)
      .sort((a, b) => a.data.chapter - b.data.chapter);
    for (const lm of list) {
      const x = (lm.mainS / this.mainRoute.length) * 100;
      const y = this.yAtS(lm.mainS);
      const btn = document.createElement('button');
      btn.type = 'button';
      const idx = lm.data.chapter;
      btn.className = `rail-stop ${idx % 2 === 0 ? 'row-a' : 'row-b'}${x < 6 ? ' edge-left' : ''}${x > 94 ? ' edge-right' : ''}`;
      btn.style.left = `${x}%`;
      btn.style.setProperty('--dot-y', `${y.toFixed(1)}px`);
      btn.dataset.id = lm.data.id;
      const alt = lm.data.elevation ? `${lm.data.elevation}m` : '';
      btn.innerHTML = `
        <span class="rail-dot"></span>
        <span class="rail-label"><b>${lm.data.name}</b><i>${alt}</i></span>
      `;
      btn.querySelector('.rail-label')!.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.cb.onLandmark(lm.data.id);
      });
      container.appendChild(btn);
      this.railStops.set(lm.data.id, btn);
    }
  }

  private yAtS(s: number): number {
    const p = this.railProfile;
    if (!p.length) return 32;
    if (s <= p[0][0]) return p[0][1];
    if (s >= p[p.length - 1][0]) return p[p.length - 1][1];
    let lo = 0;
    let hi = p.length - 1;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (p[mid][0] <= s) lo = mid;
      else hi = mid;
    }
    const t = (s - p[lo][0]) / Math.max(1e-6, p[hi][0] - p[lo][0]);
    return p[lo][1] + (p[hi][1] - p[lo][1]) * t;
  }

  private buildCredits(): void {
    const list = this.wallData.attribution.map((a) => `<li>${a}</li>`).join('');
    $('credits-body').innerHTML = `
      <p class="credits-lead">箭扣长城三维重建</p>
      <p>地形来自公开的 SRTM 派生高程瓦片，墙体走向与敌楼坐标来自 OpenStreetMap 徒步轨迹。砖石、敌楼、阶梯、植被和光照均为程序化生成，用于理解山脊与边墙的空间关系，不是测绘级成果。</p>
      <ul>${list}</ul>
      <p class="credits-links">
        <a href="https://www.openstreetmap.org/" target="_blank" rel="noreferrer">OpenStreetMap</a>
        <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noreferrer">AWS Terrain Tiles</a>
        <a href="http://www.beijingwalking.com/jiankou-great-wall/" target="_blank" rel="noreferrer">Beijing Walking</a>
        <a href="https://blog.sina.com.cn/s/blog_41370d690102x7m7.html" target="_blank" rel="noreferrer">箭扣行记</a>
      </p>
      <p class="credits-note">${this.wallData.note}</p>
    `;
  }

  private toggleCredits(show: boolean): void {
    $('credits').classList.toggle('is-open', show);
  }

  private updateClock(): void {
    const h = Math.floor(this.hour);
    const m = Math.round((this.hour - h) * 60);
    $('clock').textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  setHour(hour: number): void {
    this.hour = hour;
    this.suppressHour = true;
    $<HTMLInputElement>('sun').value = String(hour);
    this.updateClock();
    this.suppressHour = false;
  }

  setMode(mode: Mode): void {
    $('mode-overview').classList.toggle('is-active', mode === 'overview');
    $('mode-walk').classList.toggle('is-active', mode === 'walk');
    document.body.dataset.mode = mode;
    $('walkbar').classList.toggle('is-hidden', mode !== 'walk');
    $('crosshair').classList.toggle('is-hidden', mode !== 'walk');
    $('hint').textContent =
      mode === 'walk'
        ? 'WASD 行走 · 鼠标视角 · Shift 加速 · V 俯瞰 · Esc 释放'
        : '拖动旋转 · 滚轮缩放 · 点击地标';
    if (mode === 'overview') {
      $('lockhint').classList.add('is-hidden');
    }
    if (mode === 'walk') {
      this.hideInfo();
    }
  }

  setLockHint(visible: boolean): void {
    $('lockhint').classList.toggle('is-hidden', !visible);
  }

  setActive(id: string | null): void {
    this.selectedId = id;
    for (const [lid, el] of this.railStops) el.classList.toggle('is-active', lid === id);
  }

  showInfo(lm: Landmark, sceneAltitude: number): void {
    this.selectedId = lm.data.id;
    const d = lm.data;
    const no = d.chapter < 90 ? String(d.chapter + 1).padStart(2, '0') : 'SIDE';
    $('info-no').textContent = no;
    $('info-kind').textContent = KIND_LABEL[d.kind] ?? d.kind.toUpperCase();
    $('info-name').textContent = d.name;
    $('info-en').textContent = d.en.toUpperCase();
    const elev = d.elevation ?? Math.round(sceneAltitude);
    $('info-elev').textContent = `海拔 ${elev} m`;
    $('info-dist').textContent =
      lm.mainS < 8 ? '全线起点' : `距正北楼 ${(lm.mainS / 1000).toFixed(1)} km`;
    $('info-desc').textContent = d.desc;
    const walkable = !['west', 'east', 'northwest'].includes(d.route);
    const walkBtn = $<HTMLButtonElement>('info-walk');
    walkBtn.disabled = !walkable;
    walkBtn.textContent = walkable ? '在城墙上行走' : '支线 · 不可行走';
    $('info').classList.remove('is-hidden');
    this.setActive(d.id);
  }

  hideInfo(): void {
    $('info').classList.add('is-hidden');
    this.selectedId = null;
    this.setActive(null);
  }

  setRail(s: number, visible: boolean): void {
    const marker = $('rail-marker');
    marker.classList.toggle('is-hidden', !visible);
    if (!visible) return;
    const x = (Math.max(0, Math.min(this.mainRoute.length, s)) / this.mainRoute.length) * 100;
    marker.style.left = `${x}%`;
    marker.style.setProperty('--my', `${this.yAtS(s).toFixed(1)}px`);
  }

  updateWalk(info: {
    s: number;
    altitude: number;
    segment: string;
    nextName: string;
    nextDist: number;
  }): void {
    this.setRail(info.s, true);
    const now = performance.now();
    if (now - this.lastWalk < 90) return;
    this.lastWalk = now;
    $('walk-section').textContent = info.segment;
    $('walk-sub').textContent = `下一站 · ${info.nextName}`;
    $('walk-alt').textContent = String(Math.round(info.altitude));
    $('walk-next').textContent = info.nextDist < 1000 ? String(Math.round(info.nextDist)) : (info.nextDist / 1000).toFixed(2);
    $('walk-next-label').textContent = info.nextDist < 1000 ? 'm 下一站' : 'km 下一站';
  }

  setLoading(frac: number, text: string): void {
    $('load-bar').style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
    $('load-status').textContent = text;
  }

  hideLoading(): void {
    const el = $('loading');
    el.classList.add('is-done');
    window.setTimeout(() => el.classList.add('is-hidden'), 900);
  }

  toast(msg: string): void {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('is-visible');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => el.classList.remove('is-visible'), 2400);
  }

  setOverviewChrome(visible: boolean): void {
    $('rail').classList.toggle('is-dimmed', !visible);
  }
}
