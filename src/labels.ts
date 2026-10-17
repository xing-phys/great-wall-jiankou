import * as THREE from 'three';
import type { Landmark } from './types';

interface LabelItem {
  lm: Landmark;
  world: THREE.Vector3;
  el: HTMLButtonElement;
  w: number;
  h: number;
}

export class Labels {
  private items: LabelItem[] = [];
  private container: HTMLElement;
  private activeId: string | null = null;
  private tmp = new THREE.Vector3();
  private forward = new THREE.Vector3();

  constructor(
    container: HTMLElement,
    landmarks: Landmark[],
    onClick: (id: string) => void,
  ) {
    this.container = container;
    for (const lm of landmarks) {
      const el = document.createElement('button');
      el.className = 'lm';
      el.type = 'button';
      el.dataset.id = lm.data.id;
      const num = lm.data.chapter < 90 ? String(lm.data.chapter + 1).padStart(2, '0') : 'S';
      const alt = lm.data.elevation ? `${lm.data.elevation} m` : '';
      el.innerHTML = `
        <span class="lm-pill">
          <span class="lm-num">${num}</span>
          <span class="lm-name">${lm.data.name}</span>
          <span class="lm-alt">${alt}</span>
        </span>
        <span class="lm-stem"></span>
        <span class="lm-dot"></span>
      `;
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        onClick(lm.data.id);
      });
      container.appendChild(el);
      const world = new THREE.Vector3(lm.position.x, lm.position.y + lm.labelHeight, lm.position.z);
      this.items.push({ lm, world, el, w: 120, h: 26 });
    }
    requestAnimationFrame(() => {
      for (const item of this.items) {
        item.w = item.el.offsetWidth || 120;
        item.h = item.el.offsetHeight || 26;
      }
    });
  }

  setActive(id: string | null): void {
    this.activeId = id;
    for (const item of this.items) {
      item.el.classList.toggle('is-active', item.lm.data.id === id);
    }
  }

  update(camera: THREE.Camera, mode: 'overview' | 'walk'): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    camera.getWorldDirection(this.forward);
    const boxes: Array<{ x: number; y: number; w: number; h: number }> = [];

    for (const item of this.items) {
      if (mode === 'walk') {
        item.el.style.opacity = '0';
        item.el.style.pointerEvents = 'none';
        continue;
      }
      this.tmp.copy(item.world);
      const dx = this.tmp.x - camera.position.x;
      const dy = this.tmp.y - camera.position.y;
      const dz = this.tmp.z - camera.position.z;
      const facing = dx * this.forward.x + dy * this.forward.y + dz * this.forward.z;
      this.tmp.project(camera);
      const onScreen =
        facing > 0 &&
        this.tmp.z > -1 &&
        this.tmp.z < 1 &&
        this.tmp.x > -1.12 &&
        this.tmp.x < 1.12 &&
        this.tmp.y > -1.05 &&
        this.tmp.y < 1.05;
      if (!onScreen) {
        item.el.style.opacity = '0';
        item.el.style.pointerEvents = 'none';
        continue;
      }
      const x = (this.tmp.x * 0.5 + 0.5) * width;
      const y = (-this.tmp.y * 0.5 + 0.5) * height;
      const blocked =
        (x > width - 385 && y < 650) ||
        (x < 300 && y < 275) ||
        y > height - 185;
      if (blocked) {
        item.el.style.opacity = '0';
        item.el.style.pointerEvents = 'none';
        continue;
      }
      const box = { x: x - item.w / 2, y: y - item.h - 26, w: item.w, h: item.h };
      let overlap = false;
      for (const b of boxes) {
        if (box.x < b.x + b.w && box.x + box.w > b.x && box.y < b.y + b.h && box.y + box.h > b.y) {
          overlap = true;
          break;
        }
      }
      if (overlap && item.lm.data.id !== this.activeId) {
        item.el.style.opacity = '0';
        item.el.style.pointerEvents = 'none';
        continue;
      }
      boxes.push(box);
      item.el.style.opacity = '1';
      item.el.style.pointerEvents = 'auto';
      item.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%)`;
    }
  }
}
