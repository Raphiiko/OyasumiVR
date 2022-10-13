import * as THREE from 'three';
import { OBB } from 'three/examples/jsm/math/OBB';
import { SleepingPose } from '../models/sleeping-pose';
import { flatten } from 'lodash';

interface ContactSender {
  obb: OBB;
  object: THREE.Object3D;
  setColor: (color: THREE.ColorRepresentation) => void;
  active: boolean;
}

interface ContactReceiver {
  sphere: THREE.Sphere;
  object: THREE.Object3D;
  setColor: (color: THREE.ColorRepresentation) => void;
  active: boolean;
}

export class SleepingPoseDetector {
  sleepingPose: SleepingPose = 'UNKNOWN';
  mainAxisSender!: ContactSender;
  crossAxisSender!: ContactSender;
  receivers: { [pose in SleepingPose]: ContactReceiver[] } = {
    UNKNOWN: [],
    SIDE_FRONT: [],
    SIDE_BACK: [],
    SIDE_RIGHT: [],
    SIDE_LEFT: [],
  };
  receiversActive: { [pose in SleepingPose]: boolean } = {
    UNKNOWN: false,
    SIDE_FRONT: false,
    SIDE_BACK: false,
    SIDE_RIGHT: false,
    SIDE_LEFT: false,
  };

  constructor() {
    this.processOrientation(new THREE.Quaternion().toArray() as [number, number, number, number]);
  }

  processOrientation(orientation: [number, number, number, number]) {
    // Contact Senders
    const senderOrientation = new THREE.Quaternion(...orientation);
    this.mainAxisSender = this.createContactSender(
      [2, 2, 15],
      [0, 0, 7.5],
      senderOrientation,
      0x0000ff
    );
    this.crossAxisSender = this.createContactSender(
      [15, 4, 4],
      [-7.5, 0, 0],
      senderOrientation,
      0xff0000
    );
    // Contact receivers
    const receiverOrientation = this.getReceiverOrientation(senderOrientation);
    this.receivers['SIDE_FRONT'] = [
      this.createContactReceiver(3, [0, 3.5, 10], receiverOrientation, 0xffff00),
    ];
    this.receivers['SIDE_BACK'] = [
      this.createContactReceiver(3, [0, -8, 5.5], receiverOrientation, 0xffff00),
      this.createContactReceiver(3, [0, -8, 7], receiverOrientation, 0xffff00),
    ];
    this.receivers['SIDE_RIGHT'] = [
      this.createContactReceiver(4, [0, 9, 1], receiverOrientation, 0xffff00),
      this.createContactReceiver(4, [0, 9, 0], receiverOrientation, 0xffff00),
      this.createContactReceiver(4, [0, 9, -1], receiverOrientation, 0xffff00),
    ];
    this.receivers['SIDE_LEFT'] = [
      this.createContactReceiver(4, [0, -10, 1], receiverOrientation, 0xffff00),
      this.createContactReceiver(4, [0, -10, 0], receiverOrientation, 0xffff00),
      this.createContactReceiver(4, [0, -10, -1], receiverOrientation, 0xffff00),
    ];
    // Determine collisions

    (Object.entries(this.receivers) as [SleepingPose, ContactReceiver[]][]).forEach(
      ([pose, receivers]: [SleepingPose, ContactReceiver[]]) => {
        const sender = ['SIDE_FRONT', 'SIDE_BACK'].includes(pose)
          ? this.mainAxisSender
          : this.crossAxisSender;
        const active = this.collides(sender, receivers);
        if (active) receivers.forEach((r) => (r.active = true));
        this.receiversActive[pose] = active;
      }
    );
    // Determine sleeping pose
    const activePose = (
      ['SIDE_RIGHT', 'SIDE_LEFT', 'SIDE_BACK', 'SIDE_FRONT'] as SleepingPose[]
    ).find((pose) => this.receiversActive[pose]);
    this.sleepingPose = activePose || this.sleepingPose;
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
    // Highlight contacts
    [
      this.receivers['SIDE_FRONT'],
      this.receivers['SIDE_BACK'],
      this.receivers['SIDE_RIGHT'],
      this.receivers['SIDE_LEFT'],
      [this.mainAxisSender],
      [this.crossAxisSender],
    ].forEach(
      (
        contacts: {
          active: boolean;
          setColor: (color: THREE.ColorRepresentation) => void;
        }[]
      ) => {
        if (contacts.find((contact) => contact.active))
          contacts.forEach((contact) => contact.setColor(0xffffff));
      }
    );
    // Contact Senders
    scene.add(this.mainAxisSender.object.clone(true));
    scene.add(this.crossAxisSender.object.clone(true));
    // Contact receivers
    flatten(Object.values(this.receivers)).forEach((receiver) =>
      scene.add(receiver.object.clone(true))
    );
    return scene;
  }

  private getReceiverOrientation(orientation: THREE.Quaternion): THREE.Quaternion {
    const euler = new THREE.Euler().setFromQuaternion(orientation, 'YXZ');
    euler.x = 0;
    euler.z = 0;
    return new THREE.Quaternion().setFromEuler(euler);
  }

  private collides(sender: ContactSender, receivers: ContactReceiver[]): boolean {
    return !!receivers.find((receiver) => sender.obb.intersectsSphere(receiver.sphere));
  }

  private createContactReceiver(
    radius: number,
    offset: [number, number, number] = [0, 0, 0],
    rotation: THREE.Quaternion = new THREE.Quaternion(),
    color: THREE.ColorRepresentation = 0xffffff
  ): ContactReceiver {
    const mesh = new THREE.SphereGeometry(radius);
    const material = new THREE.MeshBasicMaterial({
      color,
      opacity: 0.15,
      wireframe: true,
    });
    const sphere = new THREE.Mesh(mesh, material);
    sphere.matrixAutoUpdate = false;
    sphere.position.set(...offset);
    const object = new THREE.Object3D().add(sphere);
    object.setRotationFromQuaternion(rotation);
    sphere.updateMatrix();
    sphere.updateMatrixWorld(true);
    return {
      object,
      sphere: new THREE.Sphere(sphere.getWorldPosition(new THREE.Vector3()).clone(), radius),
      active: false,
      setColor: (color: THREE.ColorRepresentation) => (material.color = new THREE.Color(color)),
    };
  }

  private createContactSender(
    size: [number, number, number],
    offset: [number, number, number] = [0, 0, 0],
    rotation: THREE.Quaternion = new THREE.Quaternion(),
    color: THREE.ColorRepresentation = 0xffffff
  ): ContactSender {
    const mesh = new THREE.BoxGeometry(...size);
    const material = new THREE.MeshBasicMaterial({
      color,
      opacity: 0.15,
      wireframe: true,
    });
    const box = new THREE.Mesh(mesh, material);
    box.matrixAutoUpdate = false;
    box.position.set(...offset);
    const object = new THREE.Object3D().add(box);
    object.setRotationFromQuaternion(rotation);
    box.updateMatrix();
    box.updateMatrixWorld(true);
    // OBB
    const obb = new OBB(new THREE.Vector3(0, 0, 0), new THREE.Vector3(...size).multiplyScalar(0.5));
    box.getWorldPosition(new THREE.Vector3()); // Trigger needed somehow
    obb.applyMatrix4(box.matrixWorld);
    return {
      object,
      obb,
      active: false,
      setColor: (color: THREE.ColorRepresentation) => (material.color = new THREE.Color(color)),
    };
  }
}
