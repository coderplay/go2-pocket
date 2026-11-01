import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { RobotModel } from './robot-model';
import { VoxelMap } from './voxel-map';
import { theme } from '../theme';
import { lidarFrame } from './camera-framing';

export class Scene3D {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  robotModel: RobotModel;
  voxelMap: VoxelMap;
  private animationId: number = 0;
  private grid: THREE.GridHelper | null = null;
  private unsubTheme: () => void = () => {};
  private resizeObserver: ResizeObserver;
  private onResize = () => this.resize();
  private interacting = false;
  private updatingCamera = false;
  private onOrbitStart = () => { this.interacting = true; };
  private onOrbitEnd = () => { this.interacting = false; };
  private onOrbitChange = () => {
    if (this.interacting && !this.updatingCamera) this.viewType = 'overview';
  };

  // Fit automatically until the user orbits/zooms. Reset view restores fitting.
  private viewType: 'overview' | 'follow' = 'follow';
  /** Fires when the view mode toggles (APK shows toastMsg_4 / _5). The
   *  host App subscribes to render a toast — we don't take a DOM ref
   *  here because the scene shouldn't own UI chrome. */
  onViewChange: ((view: 'overview' | 'follow') => void) | null = null;

  // Robot spawns 0.3 m below world origin (BODY_HEIGHT_OFFSET in
  // robot-model.ts). Hard-coded here so the initial camera frames
  // correctly before the GLB finishes loading and getPosition()
  // returns a real value.
  private static readonly INITIAL_ROBOT_POS = new THREE.Vector3(0, 0, -0.3);

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.scene = new THREE.Scene();
    // Theme-aware background (APK dark = 0x282828; light = near-white)
    this.scene.background = new THREE.Color(theme().colors.background);
    this.scene.fog = null;

    this.camera = new THREE.PerspectiveCamera(70, 1, 0.1, 500);
    const frame = lidarFrame(null, Scene3D.INITIAL_ROBOT_POS, 0, canvas.parentElement?.clientWidth || 852, canvas.parentElement?.clientHeight || 393, 70);
    this.camera.position.copy(frame.position);
    this.camera.up.set(0, 0, 1);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.copy(frame.target);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.minDistance = 0.5;
    this.controls.maxDistance = 200;
    this.controls.enabled = true;
    this.controls.addEventListener('start', this.onOrbitStart);
    this.controls.addEventListener('end', this.onOrbitEnd);
    this.controls.addEventListener('change', this.onOrbitChange);
    this.controls.update();

    this.setupLights();
    this.setupGrid();
    this.loadEnvironment();

    this.robotModel = new RobotModel(this.scene);
    this.voxelMap = new VoxelMap(this.scene);


    // Re-apply background + grid on theme change
    this.unsubTheme = theme().onChange((_t, colors) => {
      this.scene.background = new THREE.Color(colors.background);
      if (this.scene.fog) this.scene.fog.color.setHex(colors.background);
      this.rebuildGrid(colors.grid);
    });

    this.resize();
    this.resizeObserver = new ResizeObserver(this.onResize);
    if (canvas.parentElement) this.resizeObserver.observe(canvas.parentElement);
    window.addEventListener('resize', this.onResize);
    this.animate();
  }

  private setupLights(): void {
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambient);

    const dir = new THREE.DirectionalLight(0xffffff, 1.2);
    dir.position.set(5, -5, 8);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.camera.near = 0.5;
    dir.shadow.camera.far = 30;
    dir.shadow.camera.left = -5;
    dir.shadow.camera.right = 5;
    dir.shadow.camera.top = 5;
    dir.shadow.camera.bottom = -5;
    this.scene.add(dir);

    const hemi = new THREE.HemisphereLight(0x8888ff, 0x444422, 0.4);
    this.scene.add(hemi);
  }

  private setupGrid(): void {
    this.rebuildGrid(theme().colors.grid);
  }

  private rebuildGrid(color: number): void {
    if (this.grid) {
      this.scene.remove(this.grid);
      (this.grid.material as THREE.Material).dispose?.();
      this.grid.geometry.dispose();
    }
    const g = new THREE.GridHelper(40, 40, color, color);
    g.rotateX(Math.PI / 2);
    this.scene.add(g);
    this.grid = g;
  }

  private loadEnvironment(): void {
    new HDRLoader().load('/models/venice_sunset_1k.hdr', (texture) => {
      texture.mapping = THREE.EquirectangularReflectionMapping;
      this.scene.environment = texture;
    });
  }

  resetView(): void {
    const frame = this.fittedFrame();
    this.controls.enableDamping = false; this.controls.update();
    this.controls.enableDamping = true;
    this.camera.position.copy(frame.position); this.controls.target.copy(frame.target);
    this.controls.update(); this.viewType = 'follow';
    this.onViewChange?.(this.viewType);
  }

  zoomBy(factor: number): void {
    this.viewType = 'overview';
    const offset = this.camera.position.clone().sub(this.controls.target);
    const distance = THREE.MathUtils.clamp(offset.length()/factor,this.controls.minDistance,this.controls.maxDistance);
    this.camera.position.copy(this.controls.target).add(offset.setLength(distance));
    this.controls.update();
  }

  private fittedFrame() {
    const yaw = new THREE.Euler().setFromQuaternion(this.robotModel.getQuaternion(), 'ZYX').z;
    const parent = this.renderer.domElement.parentElement;
    return lidarFrame(this.voxelMap.getBounds(), this.robotModel.getPosition(), yaw,
      parent?.clientWidth || 852, parent?.clientHeight || 393, this.camera.fov);
  }

  /** Per-frame anchor for follow mode: keep the camera glued to the
   *  robot at the yaw-rotated offset. Skipped while a toggle animation
   *  is in progress so the tween isn't fought. */
  private updateFollowCamera(): void {
    if (this.viewType !== 'follow') return;
    const frame = this.fittedFrame();
    this.camera.position.lerp(frame.position, 0.12);
    this.controls.target.lerp(frame.target, 0.12);
    if (this.camera.far !== frame.far) {
      this.camera.far = frame.far;
      this.camera.updateProjectionMatrix();
    }
  }

  resize(): void {
    const parent = this.renderer.domElement.parentElement;
    if (!parent) return;
    const w = Math.max(1, parent.clientWidth);
    const h = Math.max(1, parent.clientHeight);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    const frame = this.fittedFrame();
    this.camera.setViewOffset(w, h, 0, frame.offsetY, w, h);
    if (this.viewType === 'follow') {
      this.camera.position.copy(frame.position);
      this.controls.target.copy(frame.target);
      this.controls.update();
    }
    this.camera.updateProjectionMatrix();
  }

  private animate(): void {
    this.animationId = requestAnimationFrame(() => this.animate());
    this.updatingCamera = true;
    this.updateFollowCamera();
    this.controls.update();
    this.updatingCamera = false;
    this.renderer.render(this.scene, this.camera);
  }

  destroy(): void {
    cancelAnimationFrame(this.animationId);
    window.removeEventListener('resize', this.onResize);
    this.resizeObserver.disconnect();
    this.controls.removeEventListener('start', this.onOrbitStart);
    this.controls.removeEventListener('end', this.onOrbitEnd);
    this.controls.removeEventListener('change', this.onOrbitChange);
    this.controls.dispose();
    this.voxelMap.destroy();
    this.robotModel.destroy();
    this.unsubTheme();
    this.renderer.dispose();
  }
}
