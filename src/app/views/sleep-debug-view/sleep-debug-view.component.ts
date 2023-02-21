import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { Object3D, PerspectiveCamera, Vector3, WebGLRenderer } from 'three';
import { filter, map, Subject, takeUntil } from 'rxjs';
import { SleepingPose } from '../../models/sleeping-pose';
import { OpenVRService } from '../../services/openvr.service';
import { SleepService } from '../../services/sleep.service';
import * as THREE from 'three';
import { flatten } from 'lodash';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

@Component({
  selector: 'app-sleep-debug-view',
  templateUrl: './sleep-debug-view.component.html',
  styleUrls: ['./sleep-debug-view.component.scss'],
})
export class SleepDebugViewComponent implements OnDestroy, AfterViewInit {
  @ViewChild('canvas')
  private canvasRef?: ElementRef;
  private renderer!: WebGLRenderer;
  private camera!: PerspectiveCamera;
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
        this.elementRef.nativeElement.clientHeight
      );
    }
  }

  async ngAfterViewInit() {
    await this.render(this.getScene());
    this.openvr.devicePoses
      .pipe(
        takeUntil(this.destroy$),
        filter((poses) => !!poses[0]),
        map((poses) => poses[0].position)
      )
      .subscribe(async (position) => {
        console.log(position);
        await this.render(this.getScene(), position);
      });
  }

  getScene(): THREE.Scene {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x222222);
    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(20, 0, 0);
    directionalLight.castShadow = true;
    scene.add(directionalLight);
    // Axes
    scene.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(0, 0, 100),
        ]),
        new THREE.LineBasicMaterial({ color: 0x0000ff })
      )
    );
    scene.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(0, 100, 0),
        ]),
        new THREE.LineBasicMaterial({ color: 0x00ff00 })
      )
    );
    scene.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(100, 0, 0),
        ]),
        new THREE.LineBasicMaterial({ color: 0xff0000 })
      )
    );
    return scene;
  }

  async render(scene: THREE.Scene, position?: [number, number, number]) {
    if (!this.renderer) {
      this.renderer = new THREE.WebGLRenderer({
        antialias: true,
        canvas: this.canvasRef!.nativeElement,
      });
      this.renderer.setSize(
        this.elementRef.nativeElement.clientWidth,
        this.elementRef.nativeElement.clientHeight
      );
      // Camera
      this.camera = new THREE.PerspectiveCamera(
        75,
        this.elementRef.nativeElement.clientWidth / this.elementRef.nativeElement.clientHeight,
        0.1,
        100
      );
      this.camera.up = new THREE.Vector3(0, 1, 0);
      const controls = new OrbitControls(this.camera, this.renderer.domElement);
      controls.enableDamping = true;
      controls.center = new Vector3(1, 1, 1);
      // this.camera.position.set(50, 0, 0);
      // this.camera.lookAt(0, 0, 0);
      this.camera.position.set(-1, 1.5, 1);
      this.camera.lookAt(0.5, 0, 0.5);
    }
    // Render the scene
    if (position) {
      const mesh = new THREE.SphereGeometry(0.1);
      const material = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        opacity: 0.15,
        wireframe: true,
      });
      const sphere = new THREE.Mesh(mesh, material);
      sphere.matrixAutoUpdate = false;
      sphere.position.set(...position);
      const object = new THREE.Object3D().add(sphere);
      sphere.updateMatrix();
      sphere.updateMatrixWorld(true);
      scene.add(sphere);
    }
    requestAnimationFrame(() => this.renderer.render(scene, this.camera));
  }

  ngOnDestroy() {
    this.destroy$.next();
  }
}
