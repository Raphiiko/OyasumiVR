import {
  ChangeDetectionStrategy,
  Component,
  computed,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
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

interface View {
  title: string;
  /** Maps a point to the view plane, with y pointing down. */
  project: (p: Vec3) => [number, number];
}

const VIEWS: View[] = [
  { title: 'Top (x right, z down)', project: ([x, , z]) => [x, z] },
  { title: 'Front (x right, y up)', project: ([x, y]) => [x, -y] },
  { title: 'Side (z right, y up)', project: ([, y, z]) => [z, -y] },
];

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
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class SleepingPoseVisualizerComponent implements OnInit, OnDestroy {
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
  protected readonly views = computed(() => {
    const snapshot = this.snapshot();
    if (!snapshot) return [];
    return VIEWS.map((view) => this.drawView(view, snapshot));
  });
  private unlisten?: Promise<UnlistenFn>;

  ngOnInit() {
    this.unlisten = listen<DebugSnapshot>('SLEEPING_POSE_DEBUG', (event) => {
      this.source.set('live');
      this.snapshot.set(event.payload);
    });
    invoke('sleeping_pose_set_debug', { enabled: true });
    this.updatePreview();
  }

  ngOnDestroy() {
    invoke('sleeping_pose_set_debug', { enabled: false });
    this.unlisten?.then((unlisten) => unlisten());
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

  private drawView(view: View, snapshot: DebugSnapshot) {
    const { mainAxisSender, crossAxisSender, receivers } = snapshot.geometry;
    const senderActive = (poses: SleepingPose[]) => poses.some((p) => this.isActive(snapshot, p));
    return {
      title: view.title,
      boxes: [
        {
          color: '#4060ff',
          active: senderActive(['SIDE_FRONT', 'SIDE_BACK']),
          obb: mainAxisSender,
        },
        {
          color: '#ff4040',
          active: senderActive(['SIDE_LEFT', 'SIDE_RIGHT']),
          obb: crossAxisSender,
        },
      ].map((box) => ({ ...box, edges: this.boxEdges(box.obb, view) })),
      spheres: receivers.map((r) => {
        const [cx, cy] = view.project(r.center);
        return { cx, cy, r: r.radius, color: POSE_COLORS[r.pose], colliding: r.colliding };
      }),
    };
  }

  private boxEdges({ center, halfSize, axes }: Obb, view: View) {
    // corner i takes the positive side of axis k when bit k of i is set
    const corner = (i: number) =>
      center.map((c, d) =>
        axes.reduce((sum, axis, k) => sum + (i & (1 << k) ? 1 : -1) * halfSize[k] * axis[d], c)
      ) as Vec3;
    const edges: { x1: number; y1: number; x2: number; y2: number }[] = [];
    for (let i = 0; i < 8; i++) {
      for (let k = 0; k < 3; k++) {
        if (i & (1 << k)) continue;
        const [x1, y1] = view.project(corner(i));
        const [x2, y2] = view.project(corner(i | (1 << k)));
        edges.push({ x1, y1, x2, y2 });
      }
    }
    return edges;
  }
}
