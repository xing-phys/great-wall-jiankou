import './style.css';
import * as THREE from 'three';
import { Heightfield, loadWallData } from './data';
import type { Landmark, Mode, WallData } from './types';
import { WallRoute } from './route';
import { createMaterials, type WorldMaterials } from './textures';
import { Environment } from './sky';
import { buildTerrain } from './terrain';
import { buildJunction, buildTowers, buildWallMeshes, type TowerObject } from './wall';
import { buildVegetation } from './vegetation';
import { OverviewController } from './overview';
import { WalkController, type WalkState } from './walk';
import { Labels } from './labels';
import { Minimap } from './minimap';
import { Hud } from './hud';
import { clamp } from './noise';

const DATA = `${import.meta.env.BASE_URL}data/`;
const params = new URLSearchParams(location.search);

function frame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setLoad(frac: number, text: string): void {
  const bar = document.getElementById('load-bar');
  const status = document.getElementById('load-status');
  if (bar) bar.style.width = `${clamp(frac, 0, 1) * 100}%`;
  if (status) status.textContent = text;
}

function fatal(err: unknown): void {
  console.error(err);
  const status = document.getElementById('load-status');
  if (status) {
    status.textContent = `场景加载失败：${err instanceof Error ? err.message : String(err)}`;
    status.style.color = '#c25a3a';
  }
}

const VIEW_OFFSETS: Record<string, [number, number, number]> = {
  zhengbeilou: [560, 330, 400],
  xiaobudalagong: [460, 310, 440],
  jiankou: [500, 330, 390],
  jiangjun: [450, 310, 450],
  tianti: [440, 310, 450],
  yingfei: [480, 330, 510],
  beijingjie: [560, 380, 580],
  jiuyanlou: [560, 380, 580],
  xidawall: [-200, 330, 480],
};

class App {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  env: Environment;
  materials!: WorldMaterials;
  hf!: Heightfield;
  wallData!: WallData;
  routes!: Record<string, WallRoute>;
  main!: WallRoute;
  landmarks: Landmark[] = [];
  landmarkById = new Map<string, Landmark>();
  towers: TowerObject[] = [];
  overview!: OverviewController;
  walk!: WalkController;
  labels!: Labels;
  minimap!: Minimap;
  hud!: Hud;
  mode: Mode = 'overview';
  selectedId: string | null = null;
  switching = false;
  private hour = 16.2;
  private lastNear = '';
  private tweenFov = { from: 46, to: 46, t: 0, dur: 0.001 };
  private targetFov = 46;

  constructor() {
    const canvas = document.getElementById('scene') as HTMLCanvasElement;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      logarithmicDepthBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.camera = new THREE.PerspectiveCamera(
      46,
      window.innerWidth / window.innerHeight,
      0.5,
      30000,
    );
    this.env = new Environment(this.scene, this.renderer);
    const h = Number(params.get('hour'));
    if (Number.isFinite(h) && h >= 5 && h <= 20) this.hour = h;
    this.env.setHour(this.hour);

    window.addEventListener('resize', () => this.onResize());
  }

  async load(): Promise<void> {
    setLoad(0.06, '正在读取地形与墙体走向…');
    await frame();
    const [hf, wallData] = await Promise.all([Heightfield.load(DATA), loadWallData(DATA)]);
    this.hf = hf;
    this.wallData = wallData;

    setLoad(0.2, '正在构建山脊…');
    await frame();
    this.materials = createMaterials(this.renderer);
    this.routes = {};
    const opts: Record<string, { walkable: boolean; taper: boolean }> = {
      main: { walkable: true, taper: false },
      spur: { walkable: false, taper: false },
      west: { walkable: false, taper: true },
      east: { walkable: false, taper: true },
      northwest: { walkable: false, taper: true },
    };
    for (const [id, data] of Object.entries(wallData.routes)) {
      const o = opts[id] ?? { walkable: false, taper: true };
      this.routes[id] = new WallRoute(id, data, hf, o.walkable, o.taper);
    }
    this.main = this.routes.main;
    console.info('route lengths', Object.fromEntries(Object.entries(this.routes).map(([k, r]) => [k, r.length.toFixed(1)])));
    this.resolvePlacements();
    this.buildLandmarks();
    const quality = params.get('quality') === 'low' ? 2 : 1;
    this.scene.add(buildTerrain(hf, this.materials.terrainDetail, quality));

    setLoad(0.45, '正在砌筑边墙…');
    await frame();
    const bj = this.landmarkById.get('beijingjie')!;
    this.scene.add(buildWallMeshes(this.routes, wallData.towers, this.materials, hf, bj.s));
    this.scene.add(buildJunction(this.main, bj.s, this.materials));

    setLoad(0.64, '正在放置敌楼…');
    await frame();
    this.towers = buildTowers(wallData.towers, this.routes, this.materials);
    for (const t of this.towers) this.scene.add(t.mesh);

    setLoad(0.8, '正在种植山林…');
    await frame();
    this.scene.add(buildVegetation(hf, this.routes));

    setLoad(0.9, '正在布置光线与视角…');
    await frame();
    this.setupControllers();
    this.setupUi();
    this.bindGlobalKeys();
    this.setupDebug();

    setLoad(0.98, '进入箭扣');
    await frame();
    const startAt = params.get('at');
    const startMode = params.get('mode');

    this.overview.setInitial(this.wideCamera(), this.defaultTarget());
    if (startMode === 'walk') {
      this.hud.hideLoading();
      document.body.classList.add('is-ready');
      await this.setMode('walk', { instant: true, at: startAt ?? undefined });
    } else if (startAt && this.landmarkById.has(startAt)) {
      this.hud.hideLoading();
      document.body.classList.add('is-ready');
      this.selectLandmark(startAt, { instant: true });
    } else {
      this.hud.hideLoading();
      document.body.classList.add('is-ready');
      await wait(380);
      this.overview.flyTo(this.defaultCamera(), this.defaultTarget(), 4.4);
    }
    this.startLoop();
  }

  private resolvePlacements(): void {
    for (const t of this.wallData.towers) {
      const route = this.routes[t.route];
      if (!route) continue;
      if (Math.abs(t.lat) > 0.01 && Math.abs(t.lon) > 0.01) {
        t.s = route.nearest(this.hf.lonToX(t.lon), this.hf.latToZ(t.lat)).s;
      } else {
        const dl = this.wallData.routes[t.route]?.length ?? route.length;
        t.s = clamp((t.s * route.length) / dl, 0, route.length);
      }
    }
  }

  private buildLandmarks(): void {
    for (const data of this.wallData.landmarks) {
      const route = this.routes[data.route];
      if (!route) continue;
      const s =
        Math.abs(data.lat) > 0.01 && Math.abs(data.lon) > 0.01
          ? route.nearest(this.hf.lonToX(data.lon), this.hf.latToZ(data.lat)).s
          : clamp(data.s * (route.length / (this.wallData.routes[data.route]?.length ?? route.length)), 0, route.length);
      const p = route.at(s);
      const mainS = data.route === 'main' ? s : this.main.nearest(p.x, p.z).s;
      const labelHeight =
        data.kind === 'tower'
          ? data.id === 'jiuyanlou'
            ? 17
            : data.id === 'zhengbeilou'
              ? 15
              : 13
          : data.kind === 'junction'
            ? 8
            : data.kind === 'stairs'
              ? 5
              : 6;
      const lm: Landmark = {
        data,
        route: data.route,
        s,
        mainS,
        position: new THREE.Vector3(p.x, p.y, p.z),
        labelHeight,
      };
      this.landmarks.push(lm);
      this.landmarkById.set(data.id, lm);
    }
  }

  private setupControllers(): void {
    this.overview = new OverviewController(this.camera, this.renderer.domElement);
    const obstacles = this.wallData.towers
      .filter((t) => t.route === 'main')
      .map((t) => ({ s: t.s, halfWidth: t.size[0] / 2 }));
    this.walk = new WalkController(this.camera, this.main, this.renderer.domElement, obstacles);
    this.walk.onLockChange = (locked) => {
      if (this.mode === 'walk') this.hud.setLockHint(!locked && params.get('hint') !== '0');
    };
    this.walk.onState = (state) => this.onWalkState(state);
  }

  private setupUi(): void {
    this.hud = new Hud(this.wallData, this.main, this.landmarks, {
      onMode: (m) => {
        void this.setMode(m);
      },
      onLandmark: (id) => {
        if (this.mode === 'walk') this.teleportToLandmark(id);
        else this.selectLandmark(id);
      },
      onWalkHere: (id) => {
        void this.setMode('walk', { at: id });
      },
      onHour: (h) => {
        this.hour = h;
        this.env.setHour(h);
      },
      onCloseInfo: () => this.clearSelection(),
    });
    this.hud.setHour(this.hour);
    this.labels = new Labels(document.getElementById('labels')!, this.landmarks, (id) => {
      this.selectLandmark(id);
    });
    this.minimap = new Minimap(
      document.getElementById('minimap') as HTMLCanvasElement,
      this.hf,
      this.routes,
      this.landmarks,
      (id) => {
        if (this.mode === 'walk') this.teleportToLandmark(id);
        else this.selectLandmark(id);
      },
    );
    this.hud.setMode(this.mode);
    this.hud.setRail(0, false);
    document.getElementById('lockhint')!.addEventListener('click', () => this.walk.requestLock());
    const lockhint = document.getElementById('lockhint')!;
    if (params.get('hint') === '0') lockhint.style.display = 'none';
  }

  private bindGlobalKeys(): void {
    window.addEventListener('keydown', (ev) => {
      const tag = (ev.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const k = ev.key.toLowerCase();
      if (k === 'v') {
        void this.setMode(this.mode === 'overview' ? 'walk' : 'overview');
      } else if (k === 'r' && this.mode === 'overview') {
        this.clearSelection();
        this.overview.flyTo(this.defaultCamera(), this.defaultTarget(), 1.6);
      } else if (ev.key === 'Escape') {
        if (this.mode === 'overview' && this.selectedId) this.clearSelection();
        const credits = document.getElementById('credits')!;
        credits.classList.remove('is-open');
      }
    });
  }

  private heroView(): { pos: THREE.Vector3; target: THREE.Vector3 } {
    const jk = this.landmarkById.get('jiankou')!;
    // stand on the south side, west of Arrow Nock, looking east up the climb
    // towards Little Potala; the afternoon sun is behind the camera
    const p = this.main.at(Math.min(this.main.length, jk.s + 85));
    const t = this.main.at(Math.max(0, jk.s - 175));
    const target = new THREE.Vector3(t.x, t.y + 8, t.z);
    const pos = new THREE.Vector3(
      p.x - p.nx * 58,
      p.y + 46,
      p.z - p.nz * 58,
    );
    const ground = this.hf.heightAt(pos.x, pos.z);
    if (pos.y < ground + 25) pos.y = ground + 25;
    return { pos, target };
  }

  private defaultTarget(): THREE.Vector3 {
    return this.heroView().target;
  }

  private defaultCamera(): THREE.Vector3 {
    return this.heroView().pos;
  }

  private wideCamera(): THREE.Vector3 {
    const h = this.heroView();
    return h.pos.clone().add(new THREE.Vector3(-850, 720, 900));
  }

  private setupDebug(): void {
    if (params.get('debug') === '1') {
      (window as unknown as Record<string, unknown>).__jiankou = {
        scene: this.scene,
        camera: this.camera,
        renderer: this.renderer,
        routes: this.routes,
        hf: this.hf,
        landmarks: this.landmarks,
        app: this,
        THREE,
      };
    }
  }

  private selectLandmark(id: string, options: { fly?: boolean; instant?: boolean; close?: number } = {}): void {
    const lm = this.landmarkById.get(id);
    if (!lm) return;
    this.selectedId = id;
    this.hud.showInfo(lm, lm.position.y);
    this.labels.setActive(id);
    this.minimap.setActive(id);
    this.hud.setRail(lm.mainS, true);
    const fly = options.fly !== false;
    if (!fly) return;
    const factor = options.close ?? 1;
    const offset = new THREE.Vector3(...(VIEW_OFFSETS[id] ?? [650, 400, 720]));
    offset.multiplyScalar(factor);
    const target = new THREE.Vector3(lm.position.x, lm.position.y + lm.labelHeight * 0.32, lm.position.z);
    const pos = target.clone().add(offset);
    const ground = this.hf.heightAt(pos.x, pos.z);
    if (pos.y < ground + 90) pos.y = ground + 90;
    if (options.instant) {
      this.overview.cancelFlight();
      this.overview.controls.target.copy(target);
      this.camera.position.copy(pos);
      this.camera.lookAt(target);
      this.overview.controls.update();
    } else {
      this.overview.flyTo(pos, target, 1.5);
    }
  }

  private clearSelection(): void {
    this.selectedId = null;
    this.hud.hideInfo();
    this.labels.setActive(null);
    this.minimap.setActive(null);
    if (this.mode === 'overview') this.hud.setRail(0, false);
  }

  private teleportToLandmark(id: string): void {
    const lm = this.landmarkById.get(id);
    if (!lm) return;
    if (['west', 'east', 'northwest'].includes(lm.route)) {
      this.hud.toast('该地标位于支线，已回到主墙');
      this.walk.teleport(this.landmarkById.get('beijingjie')!.mainS, -1);
    } else {
      this.walk.teleport(lm.mainS, lm.mainS < 20 ? 1 : -1);
      this.hud.toast(`已到达 ${lm.data.name}`);
    }
    this.selectedId = id;
    this.labels.setActive(null);
    this.minimap.setActive(id);
  }

  async setMode(next: Mode, opts: { instant?: boolean; at?: string } = {}): Promise<void> {
    if (this.switching) return;
    if (this.mode === next) return;
    this.switching = true;
    const fade = document.getElementById('fade')!;
    const instant = opts.instant === true;
    if (!instant) {
      fade.classList.add('is-on');
      await wait(270);
    }
    if (next === 'walk') {
      const startId = opts.at ?? this.selectedId;
      const lm = startId ? this.landmarkById.get(startId) : null;
      const s0 = lm && !['west', 'east', 'northwest'].includes(lm.route)
        ? lm.mainS
        : this.landmarkById.get('zhengbeilou')!.mainS;
      const facing: -1 | 1 = s0 < 20 ? 1 : -1;
      // never start inside a tower shell
      let startS = s0;
      for (const t of this.wallData.towers) {
        if (t.route !== 'main') continue;
        const half = t.size[0] / 2 + 4;
        if (Math.abs(t.s - startS) < half) {
          startS = clamp(t.s + facing * (half + 1), 0, this.main.length);
          break;
        }
      }
      const s = startS;
      this.mode = 'walk';
      this.overview.cancelFlight();
      this.overview.controls.enabled = false;
      this.camera.fov = 68;
      this.targetFov = 68;
      this.camera.updateProjectionMatrix();
      this.walk.enter(s, facing);
      this.selectedId = null;
      this.hud.hideInfo();
      this.hud.setMode('walk');
      this.hud.setRail(s, true);
      this.hud.setLockHint(true);
      this.labels.setActive(null);
      this.minimap.setActive(null);
      document.body.classList.add('is-walking');
      this.updateWalkHudFromCurrent(true);
    } else {
      this.mode = 'overview';
      this.walk.exit();
      this.overview.cancelFlight();
      document.body.classList.remove('is-walking');
      this.hud.setMode('overview');
      this.hud.setLockHint(false);
      const pAt = this.main.at(this.walk.s);
      const target = new THREE.Vector3(pAt.x, pAt.y, pAt.z);
      const offset = new THREE.Vector3(760, 560, 760);
      const pos = target.clone().add(offset);
      const ground = this.hf.heightAt(pos.x, pos.z);
      if (pos.y < ground + 100) pos.y = ground + 100;
      this.overview.controls.target.copy(target);
      this.camera.position.copy(pos);
      this.overview.controls.enabled = true;
      this.overview.controls.update();
      this.camera.fov = 46;
      this.targetFov = 46;
      this.camera.updateProjectionMatrix();
      this.hud.setRail(0, false);
      this.hud.hideInfo();
      this.labels.setActive(null);
      this.minimap.setActive(null);
    }
    if (!instant) {
      await wait(40);
      fade.classList.remove('is-on');
      await wait(260);
    }
    this.switching = false;
  }

  private onWalkState(state: WalkState): void {
    this.updateWalkHud(state);
  }

  private updateWalkHudFromCurrent(force = false): void {
    const p = this.walk.s;
    const pAt = this.main.at(p);
    const forwardDot = -Math.sin(this.walk.heading) * pAt.tx + -Math.cos(this.walk.heading) * pAt.tz;
    const sign = forwardDot >= 0 ? 1 : -1;
    const list = this.landmarks
      .filter((l) => l.data.chapter < 90)
      .sort((a, b) => a.mainS - b.mainS);
    let next = null as Landmark | null;
    if (sign > 0) next = list.find((l) => l.mainS > p + 10) ?? null;
    else next = [...list].reverse().find((l) => l.mainS < p - 10) ?? null;
    if (!next) next = list[list.length - 1];
    let current = list[0];
    for (const l of list) if (Math.abs(l.mainS - p) < Math.abs(current.mainS - p)) current = l;
    this.hud.updateWalk({
      s: p,
      altitude: pAt.y + 1.68,
      segment: `${current.data.name} → ${next.data.name}`,
      nextName: next.data.name,
      nextDist: next ? Math.abs(next.mainS - p) : 0,
    });
    const near = list.find((l) => Math.abs(l.mainS - p) < 14);
    if (force) {
      if (near) this.lastNear = near.data.id;
    } else if (near && near.data.id !== this.lastNear) {
      this.lastNear = near.data.id;
      this.hud.toast(`抵达 ${near.data.name}`);
    }
  }

  private updateWalkHud(state: WalkState): void {
    this.updateWalkHudFromCurrent();
    void state;
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
  }

  private getFocus(): THREE.Vector3 {
    return this.mode === 'walk' ? this.camera.position : this.overview.focus;
  }

  private startLoop(): void {
    let last = performance.now();
    const loop = (now: number) => {
      requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (this.mode === 'walk') this.walk.update(dt);
      else this.overview.update(dt);

      const focus = this.getFocus();
      this.env.followCamera(this.camera);
      this.env.update(focus, this.mode === 'walk');
      this.labels.update(this.camera, this.mode);
      this.minimap.update(
        this.camera,
        this.mode,
        this.mode === 'walk'
          ? { x: this.camera.position.x, z: this.camera.position.z, yaw: this.walk.heading }
          : null,
        this.selectedId,
      );
      this.renderer.render(this.scene, this.camera);
    };
    requestAnimationFrame(loop);
  }
}

async function boot(): Promise<void> {
  try {
    const app = new App();
    await app.load();
    (window as unknown as Record<string, unknown>).__app = app;
  } catch (err) {
    fatal(err);
  }
}

void boot();
