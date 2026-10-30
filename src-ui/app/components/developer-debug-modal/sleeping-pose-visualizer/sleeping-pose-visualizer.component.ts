import {
  AfterViewInit,
  Component,
  effect,
  ElementRef,
  OnDestroy,
  OnInit,
  signal,
  ViewChild,
} from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import type * as Three from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { SleepingPose } from 'src-ui/app/models/sleeping-pose';

type Vec3 = [number, number, number];

interface Obb {
  center: Vec3;
  halfSize: Vec3;
  axes: [Vec3, Vec3, Vec3];
}

interface DebugSnapshot {
  quaternion: [number, number, number, number];
  geometry: {
    mainAxisSender: Obb;
    crossAxisSender: Obb;
    receivers: { pose: SleepingPose; center: Vec3; radius: number; colliding: boolean }[];
  };
  rawPose: SleepingPose;
  stablePose: SleepingPose;
}

interface Viewer {
  three: typeof Three;
  renderer: Three.WebGLRenderer;
  scene: Three.Scene;
  camera: Three.PerspectiveCamera;
  controls: OrbitControls;
  content: Three.Group;
  resize: ResizeObserver;
}

const POSE_COLORS: Record<SleepingPose, string> = {
  UNKNOWN: '#888888',
  SIDE_FRONT: '#f5c542',
  SIDE_BACK: '#42c5f5',
  SIDE_LEFT: '#a142f5',
  SIDE_RIGHT: '#42f58d',
};

@Component({
  selector: 'app-sleeping-pose-visualizer',
  templateUrl: './sleeping-pose-visualizer.component.html',
  styleUrls: ['./sleeping-pose-visualizer.component.scss'],
  standalone: false,
})
export class SleepingPoseVisualizerComponent implements OnInit, AfterViewInit, OnDestroy {
  protected readonly colors = POSE_COLORS;
  protected readonly priority: SleepingPose[] = [
    'SIDE_RIGHT',
    'SIDE_LEFT',
    'SIDE_BACK',
    'SIDE_FRONT',
  ];
  protected readonly axes = ['pitch', 'yaw', 'roll'] as const;
  protected readonly snapshot = signal<DebugSnapshot | null>(null);
  protected readonly source = signal<'live' | 'preview'>('preview');
  protected readonly preview = { pitch: 0, yaw: 0, roll: 0 };
  @ViewChild('canvas', { static: true }) private canvas!: ElementRef<HTMLCanvasElement>;
  private readonly viewer = signal<Viewer | null>(null);
  private unlisten?: Promise<UnlistenFn>;
  private destroyed = false;

  constructor() {
    effect(() => {
      const viewer = this.viewer();
      const snapshot = this.snapshot();
      if (viewer && snapshot) this.draw(viewer, snapshot);
    });
  }

  ngOnInit() {
    this.unlisten = listen<DebugSnapshot>('SLEEPING_POSE_DEBUG', (event) => {
      this.source.set('live');
      this.snapshot.set(event.payload);
    });
    invoke('sleeping_pose_set_debug', { enabled: true });
    this.updatePreview();
  }

  async ngAfterViewInit() {
    // load three.js only when this debug tab opens
    const three = await import('three');
    const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
    if (this.destroyed) return;
    const canvas = this.canvas.nativeElement;
    const renderer = new three.WebGLRenderer({ canvas, antialias: true });
    const scene = new three.Scene();
    scene.background = new three.Color(0x222222);
    scene.add(new three.AxesHelper(12), new three.GridHelper(40, 20, 0x555555, 0x333333));
    const camera = new three.PerspectiveCamera(45, 1, 0.1, 500);
    camera.position.set(28, 18, 28);
    const controls = new OrbitControls(camera, canvas);
    controls.update();
    const content = new three.Group();
    scene.add(content);
    const render = () => renderer.render(scene, camera);
    controls.addEventListener('change', render);
    const resize = new ResizeObserver(() => {
      renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
      camera.aspect = canvas.clientWidth / canvas.clientHeight;
      camera.updateProjectionMatrix();
      render();
    });
    resize.observe(canvas);
    this.viewer.set({ three, renderer, scene, camera, controls, content, resize });
  }

  ngOnDestroy() {
    this.destroyed = true;
    invoke('sleeping_pose_set_debug', { enabled: false });
    this.unlisten?.then((unlisten) => unlisten());
    const viewer = this.viewer();
    if (!viewer) return;
    viewer.resize.disconnect();
    viewer.controls.dispose();
    this.clear(viewer.content);
    viewer.renderer.dispose();
  }

  protected async updatePreview() {
    const snapshot = await invoke<DebugSnapshot>('sleeping_pose_debug_preview', {
      quaternion: this.quaternionFromEuler(this.preview),
    });
    this.source.set('preview');
    this.snapshot.set(snapshot);
  }

  protected setPreview(axis: 'pitch' | 'yaw' | 'roll', event: Event) {
    this.preview[axis] = Number((event.target as HTMLInputElement).value);
    this.updatePreview();
  }

  protected isActive(snapshot: DebugSnapshot, pose: SleepingPose): boolean {
    return snapshot.geometry.receivers.some((r) => r.pose === pose && r.colliding);
  }

  protected formatQuaternion(q: number[]): string {
    return q.map((v) => v.toFixed(4)).join(', ');
  }

  /** Euler angles in degrees, applied in order YXZ, to a quaternion `[x, y, z, w]`. */
  private quaternionFromEuler({ pitch, yaw, roll }: Record<'pitch' | 'yaw' | 'roll', number>) {
    const half = (deg: number) => (deg * Math.PI) / 360;
    const [c1, s1] = [Math.cos(half(pitch)), Math.sin(half(pitch))];
    const [c2, s2] = [Math.cos(half(yaw)), Math.sin(half(yaw))];
    const [c3, s3] = [Math.cos(half(roll)), Math.sin(half(roll))];
    return [
      s1 * c2 * c3 + c1 * s2 * s3,
      c1 * s2 * c3 - s1 * c2 * s3,
      c1 * c2 * s3 - s1 * s2 * c3,
      c1 * c2 * c3 + s1 * s2 * s3,
    ];
  }

  /** Replaces the scene content with the core's geometry; three.js only renders it. */
  private draw(viewer: Viewer, snapshot: DebugSnapshot) {
    const { three, content } = viewer;
    const { mainAxisSender, crossAxisSender, receivers } = snapshot.geometry;
    this.clear(content);

    // senders, drawn white while one of their receivers collides
    const senders: [Obb, string, SleepingPose[]][] = [
      [mainAxisSender, '#4060ff', ['SIDE_FRONT', 'SIDE_BACK']],
      [crossAxisSender, '#ff4040', ['SIDE_LEFT', 'SIDE_RIGHT']],
    ];
    for (const [obb, color, poses] of senders) {
      const active = poses.some((pose) => this.isActive(snapshot, pose));
      const box = new three.BoxGeometry(...obb.halfSize.map((h) => h * 2));
      const edges = new three.LineSegments(
        new three.EdgesGeometry(box),
        new three.LineBasicMaterial({ color: active ? '#ffffff' : color })
      );
      box.dispose();
      const [x, y, z] = obb.axes.map((axis) => new three.Vector3(...axis));
      edges.matrixAutoUpdate = false;
      edges.matrix.makeBasis(x, y, z).setPosition(...obb.center);
      content.add(edges);
    }

    // receivers, filled while they collide
    for (const receiver of receivers) {
      const color = POSE_COLORS[receiver.pose];
      const sphere = new three.SphereGeometry(receiver.radius, 24, 12);
      const outline = new three.LineSegments(
        new three.WireframeGeometry(sphere),
        new three.LineBasicMaterial({ color, transparent: true, opacity: 0.35 })
      );
      outline.position.set(...receiver.center);
      content.add(outline);
      if (receiver.colliding) {
        const fill = new three.Mesh(
          sphere,
          new three.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, depthWrite: false })
        );
        fill.position.set(...receiver.center);
        content.add(fill);
      } else {
        sphere.dispose();
      }
    }

    viewer.renderer.render(viewer.scene, viewer.camera);
  }

  private clear(content: Three.Group) {
    for (const child of [...content.children]) {
      const object = child as Three.Mesh;
      object.geometry?.dispose();
      (object.material as Three.Material | undefined)?.dispose();
      content.remove(object);
    }
  }
}
