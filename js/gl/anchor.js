/*
 * 3D objects follow DOM elements: each frame an anchor measures its element and says
 * where that box sits on the camera's z = 0 plane, so the layout (CSS) decides where
 * things go and the 3D just lives there.
 */
import { Vector3 } from './three.js';

export class Viewport {
  constructor(camera) {
    this.camera = camera;
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.worldHeight = 1;
    this.worldWidth = 1;
    this.unit = 1; // world units per CSS pixel at z = 0
  }

  update() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    const cam = this.camera;
    this.worldHeight = 2 * Math.tan((cam.fov * Math.PI) / 360) * cam.position.z;
    this.worldWidth = this.worldHeight * (this.width / this.height);
    this.unit = this.worldHeight / this.height;
  }

  /** Screen pixel → world point on the z = 0 plane. */
  toWorld(x, y, target = new Vector3()) {
    return target.set((x - this.width / 2) * this.unit, -(y - this.height / 2) * this.unit, 0);
  }

  /** World point → screen pixel. */
  toScreen(point) {
    const v = point.clone().project(this.camera);
    return { x: (v.x + 1) / 2 * this.width, y: (1 - v.y) / 2 * this.height, uv: [(v.x + 1) / 2, (v.y + 1) / 2] };
  }
}

export class Anchor {
  constructor(element) {
    this.element = element;
    this.center = new Vector3();
    this.width = 0;
    this.height = 0;
    this.visible = false;
    this.rect = null;
    this.progress = 0; // 0 = entering from below, 0.5 = centered, 1 = leaving at the top
  }

  update(viewport) {
    const r = this.element.getBoundingClientRect();
    this.rect = r;
    const margin = Math.max(r.height, 200) * 0.6;
    this.visible = r.width > 0 && r.bottom > -margin && r.top < viewport.height + margin;
    this.center.set(
      (r.left + r.width / 2 - viewport.width / 2) * viewport.unit,
      -(r.top + r.height / 2 - viewport.height / 2) * viewport.unit,
      0,
    );
    this.width = r.width * viewport.unit;
    this.height = r.height * viewport.unit;
    this.progress = (viewport.height - r.top) / (viewport.height + r.height);
    return this;
  }
}
