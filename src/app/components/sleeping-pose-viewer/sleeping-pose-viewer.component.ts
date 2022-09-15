import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  Input,
  OnDestroy,
  ViewChild,
} from '@angular/core';
import * as THREE from 'three';
import { Object3D, PerspectiveCamera, Vector3, WebGLRenderer } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { SleepingPoseDetector } from '../../utils/sleeping-pose-detector';
import { OscService } from '../../services/osc.service';
import { OpenVRService } from '../../services/openvr.service';
import { combineLatest, filter, map, Subject, takeUntil } from 'rxjs';
import { SleepService } from '../../services/sleep.service';
import { OVRDevicePose } from '../../models/ovr-device';
import { SleepingPose } from '../../models/sleeping-pose';

@Component({
  selector: 'app-sleeping-pose-viewer',
  templateUrl: './sleeping-pose-viewer.component.html',
  styleUrls: ['./sleeping-pose-viewer.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SleepingPoseViewerComponent implements OnDestroy, AfterViewInit {
  @ViewChild('canvas')
  private canvasRef?: ElementRef;
  private renderer!: WebGLRenderer;
  private camera!: PerspectiveCamera;
  private headsetModel!: Object3D;
  private destroy$: Subject<void> = new Subject<void>();
  protected sleepingPose: SleepingPose = 'UNKNOWN';

  constructor(
    private openvr: OpenVRService,
    private sleep: SleepService,
    private cdr: ChangeDetectorRef,
    private elementRef: ElementRef
  ) {}

  @HostListener('window:resize', ['$event'])
  onResize() {
    if (this.renderer && this.camera) {
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(
        this.elementRef.nativeElement.clientWidth,
        (9 / 16) * this.elementRef.nativeElement.clientWidth
      );
    }
  }

  ngAfterViewInit() {
    this.sleep.pose.pipe(takeUntil(this.destroy$)).subscribe((pose) => {
      this.sleepingPose = pose;
      this.cdr.detectChanges();
    });
    combineLatest([this.openvr.devices, this.openvr.devicePoses])
      .pipe(
        takeUntil(this.destroy$),
        map(([devices, poses]) => {
          const hmdDevice = devices.find((d) => d.class === 'HMD');
          if (!hmdDevice) return null;
          return poses[hmdDevice.index] || null;
        }),
        filter((hmdPose) => hmdPose !== null),
        map((hmdPose) => hmdPose as OVRDevicePose)
      )
      .subscribe((hmdPose) => {
        const hmdOrientation = new THREE.Quaternion(...hmdPose.quaternion);
        const scene = this.sleep.getPoseDetectorScene();
        this.render(scene, hmdOrientation);
      });
  }

  ngOnDestroy() {
    this.destroy$.next();
  }

  async render(scene: THREE.Scene, hmdOrientation: THREE.Quaternion) {
    if (!this.renderer) {
      this.headsetModel = await this.loadHeadsetModel();
      this.renderer = new THREE.WebGLRenderer({
        antialias: true,
        canvas: this.canvasRef!.nativeElement,
      });
      this.renderer.setSize(
        this.elementRef.nativeElement.clientWidth,
        (9 / 16) * this.elementRef.nativeElement.clientWidth
      );
      // Camera
      this.camera = new THREE.PerspectiveCamera(
        45,
        16/9,
        0.1,
        100
      );
      this.camera.up = new THREE.Vector3(0, 1, 0);
      const controls = new OrbitControls(this.camera, this.renderer.domElement);
      controls.enableDamping = true;
      controls.center = new Vector3(0, 0, 0);
      // this.camera.position.set(50, 0, 0);
      // this.camera.lookAt(0, 0, 0);
      this.camera.position.set(30, 10, 30);
      this.camera.lookAt(0, 0, 0);
    }
    // Headset
    this.headsetModel.rotation.setFromQuaternion(hmdOrientation);
    scene.add(this.headsetModel);
    // Render the scene
    requestAnimationFrame(() => this.renderer.render(scene, this.camera));
  }

  private loadHeadsetModel(): Promise<Object3D> {
    return new Promise((resolve, reject) => {
      new GLTFLoader().load(
        '/assets/3d/vive/scene.gltf',
        (gltf) => {
          const mesh = gltf.scene.children[0];
          mesh.scale.set(1, 1, 1);
          mesh.rotation.set(
            THREE.MathUtils.degToRad(90),
            THREE.MathUtils.degToRad(180),
            THREE.MathUtils.degToRad(0)
          );
          resolve(new THREE.Object3D().add(mesh));
        },
        undefined,
        reject
      );
    });
  }
}
