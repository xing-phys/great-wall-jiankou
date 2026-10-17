import * as THREE from 'three';
import { WallRoute } from './route';
import { clamp, smoothstep } from './noise';

interface Obstacle {
  s: number;
  halfWidth: number;
}

export interface WalkState {
  s: number;
  lateral: number;
  heading: number;
  altitude: number;
  speed: number;
}

export class WalkController {
  readonly camera: THREE.PerspectiveCamera;
  readonly route: WallRoute;
  readonly dom: HTMLElement;
  private obstacles: Obstacle[];
  active = false;
  s = 0;
  private lateral = 0;
  private yaw = 0;
  private pitch = 0;
  private keys = new Set<string>();
  private locked = false;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private bobPhase = 0;
  private bob = 0;
  private moving = 0;
  onLockChange: ((locked: boolean) => void) | null = null;
  onState: ((state: WalkState) => void) | null = null;

  constructor(camera: THREE.PerspectiveCamera, route: WallRoute, dom: HTMLElement, obstacles: Obstacle[]) {
    this.camera = camera;
    this.route = route;
    this.dom = dom;
    this.obstacles = obstacles.slice().sort((a, b) => a.s - b.s);

    window.addEventListener('keydown', (ev) => this.onKey(ev, true));
    window.addEventListener('keyup', (ev) => this.onKey(ev, false));
    window.addEventListener('blur', () => this.keys.clear());

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.dom;
      this.onLockChange?.(this.locked);
    });
    dom.addEventListener('mousedown', (ev) => {
      if (!this.active) return;
      if (this.locked) return;
      this.dragging = true;
      this.lastX = ev.clientX;
      this.lastY = ev.clientY;
    });
    window.addEventListener('mouseup', () => {
      this.dragging = false;
    });
    window.addEventListener('mousemove', (ev) => {
      if (!this.active) return;
      if (this.locked) {
        this.look(ev.movementX, ev.movementY);
      } else if (this.dragging) {
        this.look(ev.clientX - this.lastX, ev.clientY - this.lastY);
        this.lastX = ev.clientX;
        this.lastY = ev.clientY;
      }
    });
    dom.addEventListener('click', () => {
      if (!this.active || this.locked) return;
      try {
        const r = this.dom.requestPointerLock() as unknown as Promise<void> | void;
        if (r && typeof (r as Promise<void>).catch === 'function') {
          (r as Promise<void>).catch(() => {
            /* drag-to-look remains available */
          });
        }
      } catch {
        /* drag-to-look remains available */
      }
    });
    // touch drag
    dom.addEventListener('touchstart', (ev) => {
      if (!this.active || ev.touches.length !== 1) return;
      this.dragging = true;
      this.lastX = ev.touches[0].clientX;
      this.lastY = ev.touches[0].clientY;
    }, { passive: true });
    dom.addEventListener('touchmove', (ev) => {
      if (!this.active || !this.dragging || ev.touches.length !== 1) return;
      const t = ev.touches[0];
      this.look(t.clientX - this.lastX, t.clientY - this.lastY);
      this.lastX = t.clientX;
      this.lastY = t.clientY;
    }, { passive: true });
    dom.addEventListener('touchend', () => {
      this.dragging = false;
    }, { passive: true });
  }

  private look(dx: number, dy: number): void {
    this.yaw -= dx * 0.00215;
    this.pitch = clamp(this.pitch - dy * 0.002, -1.32, 1.32);
  }

  private onKey(ev: KeyboardEvent, down: boolean): void {
    if (!this.active) return;
    const k = ev.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(k)) {
      if (down) this.keys.add(k);
      else this.keys.delete(k);
      if (k.startsWith('arrow')) ev.preventDefault();
    }
  }

  enter(s: number, facing: -1 | 1 = -1): void {
    this.s = clamp(s, 0, this.route.length);
    this.lateral = 0;
    const p = this.route.at(this.s);
    const fx = p.tx * facing;
    const fz = p.tz * facing;
    this.yaw = Math.atan2(-fx, -fz);
    this.pitch = -0.13;
    this.active = true;
    this.bob = 0;
    this.updateCamera(0);
  }

  exit(): void {
    this.active = false;
    this.keys.clear();
    if (document.pointerLockElement === this.dom) {
      document.exitPointerLock();
    }
    this.onLockChange?.(false);
  }

  get position(): THREE.Vector3 {
    return this.camera.position;
  }

  get heading(): number {
    return this.yaw;
  }

  get isLocked(): boolean {
    return this.locked;
  }

  requestLock(): void {
    if (!this.active) return;
    try {
      const r = this.dom.requestPointerLock() as unknown as Promise<void> | void;
      if (r && typeof (r as Promise<void>).catch === 'function') {
        (r as Promise<void>).catch(() => undefined);
      }
    } catch {
      /* ignore */
    }
  }

  teleport(s: number, facing: -1 | 1 = -1): void {
    this.s = clamp(s, 0, this.route.length);
    this.lateral = 0;
    const p = this.route.at(this.s);
    this.yaw = Math.atan2(-(p.tx * facing), -(p.tz * facing));
    this.pitch = -0.13;
    this.updateCamera(0);
  }

  private updateCamera(dt: number): void {
    const p = this.route.at(this.s);
    const moveX = p.x + p.nx * this.lateral;
    const moveZ = p.z + p.nz * this.lateral;
    this.bobPhase += dt * 7.5 * this.moving;
    this.bob += (Math.sin(this.bobPhase) * 0.032 * this.moving - this.bob) * Math.min(1, dt * 9);
    this.camera.position.set(moveX, p.y + 1.68 + this.bob, moveZ);
    const e = new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(e);
  }

  update(dt: number): void {
    if (!this.active) return;
    dt = Math.min(dt, 0.05);
    const forward = this.keys.has('w') || this.keys.has('arrowup') ? 1 : 0;
    const back = this.keys.has('s') || this.keys.has('arrowdown') ? 1 : 0;
    const right = this.keys.has('d') || this.keys.has('arrowright') ? 1 : 0;
    const left = this.keys.has('a') || this.keys.has('arrowleft') ? 1 : 0;
    const run = this.keys.has('shift');
    const speed = run ? 8.2 : 3.1;

    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);
    const p = this.route.at(this.s);
    const along = fx * p.tx + fz * p.tz;
    const strafe = (right - left);
    const wantForward = (forward - back);
    const motion = Math.abs(wantForward) + Math.abs(strafe);
    this.moving += (Math.min(1, motion) - this.moving) * Math.min(1, dt * 6);

    if (wantForward !== 0) {
      this.s = clamp(this.s + along * wantForward * speed * dt, 0, this.route.length);
    }
    if (strafe !== 0) {
      const side = rx * p.nx + rz * p.nz;
      this.lateral += side * strafe * 2.0 * dt;
      this.lateral = clamp(this.lateral, -1.42, 1.42);
    }

    // squeeze through tower doors
    let gate = 0;
    for (const ob of this.obstacles) {
      const d = Math.abs(this.s - ob.s);
      if (d < ob.halfWidth + 4) {
        gate = Math.max(gate, 1 - smoothstep(ob.halfWidth * 0.55, ob.halfWidth + 3.5, d));
      }
    }
    if (gate > 0) this.lateral *= 1 - Math.min(1, gate) * 0.92;

    this.updateCamera(dt);
    this.onState?.({
      s: this.s,
      lateral: this.lateral,
      heading: this.yaw,
      altitude: p.y + 1.68,
      speed: Math.abs(wantForward) * speed,
    });
  }

  turnTo(yaw: number, pitch = this.pitch): void {
    this.yaw = yaw;
    this.pitch = pitch;
    this.updateCamera(0);
  }
}
