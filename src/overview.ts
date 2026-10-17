import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { clamp } from './noise';

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

interface Flight {
  t: number;
  dur: number;
  fromPos: THREE.Vector3;
  toPos: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
}

export class OverviewController {
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private flight: Flight | null = null;

  constructor(camera: THREE.PerspectiveCamera, dom: HTMLElement) {
    this.camera = camera;
    this.controls = new OrbitControls(camera, dom);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.055;
    this.controls.rotateSpeed = 0.62;
    this.controls.zoomSpeed = 0.85;
    this.controls.panSpeed = 0.7;
    this.controls.screenSpacePanning = true;
    this.controls.zoomToCursor = true;
    this.controls.minDistance = 90;
    this.controls.maxDistance = 18000;
    this.controls.maxPolarAngle = Math.PI * 0.492;
    this.controls.minPolarAngle = 0.025;
    this.controls.autoRotate = false;
  }

  setInitial(position: THREE.Vector3, target: THREE.Vector3): void {
    this.camera.position.copy(position);
    this.controls.target.copy(target);
    this.controls.update();
  }

  flyTo(position: THREE.Vector3, target: THREE.Vector3, duration = 1.5): void {
    this.flight = {
      t: 0,
      dur: duration,
      fromPos: this.camera.position.clone(),
      toPos: position.clone(),
      fromTarget: this.controls.target.clone(),
      toTarget: target.clone(),
    };
    this.controls.enabled = false;
  }

  get isFlying(): boolean {
    return this.flight !== null;
  }

  cancelFlight(): void {
    if (this.flight) {
      this.flight = null;
      this.controls.enabled = true;
    }
  }

  get focus(): THREE.Vector3 {
    return this.controls.target;
  }

  update(dt: number): void {
    if (this.flight) {
      const f = this.flight;
      f.t += dt;
      const k = easeInOut(clamp(f.t / f.dur, 0, 1));
      this.camera.position.lerpVectors(f.fromPos, f.toPos, k);
      this.controls.target.lerpVectors(f.fromTarget, f.toTarget, k);
      this.camera.lookAt(this.controls.target);
      if (f.t >= f.dur) {
        this.flight = null;
        this.controls.enabled = true;
        this.controls.update();
      }
    } else {
      this.controls.update();
    }
  }
}
