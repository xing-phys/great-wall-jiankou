import * as THREE from 'three';
import { clamp, smoothstep } from './noise';

const DEG = Math.PI / 180;

const vertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  uniform float uTime;
  varying vec3 vDir;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float fbm2(vec2 p) {
    float s = 0.0;
    float a = 0.55;
    for (int i = 0; i < 4; i++) {
      s += a * vnoise(p);
      p = p * 2.04 + vec2(17.3, 9.1);
      a *= 0.5;
    }
    return s;
  }

  void main() {
    vec3 d = normalize(vDir);
    float h = clamp(d.y, -1.0, 1.0);
    float t = pow(clamp(h, 0.0, 1.0), 0.52);
    vec3 col = mix(uHorizon, uTop, t);

    float sd = max(dot(d, uSunDir), 0.0);
    col += uSunColor * (pow(sd, 1100.0) * 3.2 + pow(sd, 22.0) * 0.17 + pow(sd, 4.0) * 0.04);

    float haze = exp(-abs(h) * 26.0);
    col = mix(col, uHorizon * 1.03, haze * 0.24);

    vec2 dh = normalize(d.xz + vec2(0.0001));
    vec2 sh = normalize(uSunDir.xz + vec2(0.0001));
    float sunSide = dot(dh, sh) * 0.5 + 0.5;
    vec3 hCool = uHorizon * vec3(0.91, 0.985, 1.04);
    vec3 hWarm = uHorizon * vec3(1.05, 0.96, 0.88);
    col = mix(col, mix(hCool, hWarm, sunSide * 0.75), haze * 0.22);

    if (h > 0.005) {
      vec2 cp = d.xz / (h + 0.16) * 0.58;
      cp += vec2(uTime * 0.004, uTime * 0.0016);
      float n = fbm2(cp * 1.25 + 4.7);
      float c = smoothstep(0.5, 0.72, n);
      c *= smoothstep(0.012, 0.14, h);
      c *= 1.0 - smoothstep(0.72, 1.0, h) * 0.4;
      vec3 cloud = mix(uHorizon * 1.06, vec3(1.0, 0.985, 0.955), 0.62);
      cloud *= 0.92 + 0.16 * n;
      cloud = mix(cloud, uSunColor * 1.08, pow(max(dot(d, uSunDir), 0.0), 5.0) * 0.45);
      col = mix(col, cloud, c * 0.68);
    }

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class Environment {
  scene: THREE.Scene;
  sky: THREE.Mesh;
  skyMat: THREE.ShaderMaterial;
  sun: THREE.DirectionalLight;
  fill: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  sunDir = new THREE.Vector3(0, 1, 0);
  hour = 16.2;
  private focus = new THREE.Vector3();
  private shadowScale = 900;
  private tmpColor = new THREE.Color();

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    this.scene = scene;

    scene.fog = new THREE.FogExp2(0x849395, 0.000043);
    scene.background = new THREE.Color(0x0a0d10);

    this.skyMat = new THREE.ShaderMaterial({
      uniforms: {
        uTop: { value: new THREE.Color(0x4a78a6) },
        uHorizon: { value: new THREE.Color(0xd6d5c8) },
        uSunColor: { value: new THREE.Color(0xffedd2) },
        uSunDir: { value: new THREE.Vector3(0.4, 0.4, 0.4) },
        uTime: { value: 0 },
      },
      vertexShader,
      fragmentShader,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), this.skyMat);
    this.sky.scale.setScalar(18000);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -100;
    scene.add(this.sky);

    this.hemi = new THREE.HemisphereLight(0xb8c8d4, 0x4d4637, 1.4);
    scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xffd7a8, 2.5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.00035;
    this.sun.shadow.normalBias = 1.1;
    this.sun.shadow.camera.near = 10;
    this.sun.shadow.camera.far = 9000;
    this.sun.shadow.camera.left = -900;
    this.sun.shadow.camera.right = 900;
    this.sun.shadow.camera.top = 900;
    this.sun.shadow.camera.bottom = -900;
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.fill = new THREE.DirectionalLight(0x8aa4c4, 0.5);
    this.fill.position.set(-2500, 1800, -3000);
    scene.add(this.fill);

    this.setHour(this.hour);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.22;
  }

  private solarPosition(hour: number): { dir: THREE.Vector3; elevation: number } {
    const t = clamp((hour - 6) / 13, 0, 1);
    const elev = Math.sin(Math.PI * t) * 56 * DEG;
    const az = (90 + 180 * t) * DEG;
    const dir = new THREE.Vector3(
      Math.sin(az) * Math.cos(elev),
      Math.sin(elev),
      -Math.cos(az) * Math.cos(elev),
    ).normalize();
    return { dir, elevation: elev / DEG };
  }

  setHour(hour: number): void {
    this.hour = hour;
    const { dir, elevation } = this.solarPosition(hour);
    this.sunDir.copy(dir);

    const low = 1 - smoothstep(9, 42, elevation);
    const day = smoothstep(2, 28, elevation);

    const top = new THREE.Color(0x245f96).lerp(new THREE.Color(0x22364c), low * 0.9);
    const horizon = new THREE.Color(0xc9d6da).lerp(new THREE.Color(0xf2a96e), low);
    const sunColor = new THREE.Color(0xfff1d6).lerp(new THREE.Color(0xffab62), low);

    const u = this.skyMat.uniforms;
    (u.uTop.value as THREE.Color).copy(top);
    (u.uHorizon.value as THREE.Color).copy(horizon);
    (u.uSunColor.value as THREE.Color).copy(sunColor);
    (u.uSunDir.value as THREE.Vector3).copy(dir);

    this.hemi.color.copy(horizon).lerp(new THREE.Color(0x93b0cb), 0.4);
    this.hemi.groundColor.set(0x403a2c);
    this.hemi.intensity = 1.22 + day * 0.3;

    this.sun.color.copy(sunColor);
    this.sun.intensity = 0.3 + day * 2.7;
    this.fill.intensity = 0.42 + day * 0.2;

    const fog = this.tmpColor.copy(horizon).lerp(new THREE.Color(0x7e8c8e), 0.48);
    (this.scene.fog as THREE.FogExp2).color.copy(fog).multiplyScalar(0.96);

    this.sun.position.copy(dir).multiplyScalar(5000);
  }

  /** Keep the light and shadow frustum around what we are looking at. */
  update(focus: THREE.Vector3, walkMode: boolean): void {
    this.focus.copy(focus);
    this.skyMat.uniforms.uTime.value = performance.now() * 0.00011;
    const scale = walkMode ? 190 : 950;
    if (scale !== this.shadowScale) {
      this.shadowScale = scale;
      const cam = this.sun.shadow.camera as THREE.OrthographicCamera;
      cam.left = -scale;
      cam.right = scale;
      cam.top = scale;
      cam.bottom = -scale;
      cam.updateProjectionMatrix();
    }
    this.sun.target.position.copy(focus);
    this.sun.position.copy(focus).addScaledVector(this.sunDir, 4500);
    this.sun.target.updateMatrixWorld();
  }

  followCamera(camera: THREE.Camera): void {
    this.sky.position.copy(camera.position);
  }
}
