//! Classifies the sleeping pose from the headset orientation with contact boxes and spheres.
//!
//! Every step repeats the floating point operations of three.js (`Matrix4.compose`,
//! `Euler.setFromRotationMatrix`, `OBB.applyMatrix4` and `OBB.intersectsSphere`) in the same
//! order, so a pose classifies as it does with three.js, apart from the last bit of sin and cos.

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SleepingPose {
    Unknown,
    /// Prone: lying face down.
    SideFront,
    SideBack,
    SideLeft,
    SideRight,
}

/// The poses that have receivers, in the order they win when several collide.
pub const POSE_PRIORITY: [SleepingPose; 4] = [
    SleepingPose::SideRight,
    SleepingPose::SideLeft,
    SleepingPose::SideBack,
    SleepingPose::SideFront,
];

struct SenderSpec {
    size: [f64; 3],
    offset: [f64; 3],
}

const MAIN_AXIS_SENDER: SenderSpec = SenderSpec {
    size: [2.0, 2.0, 15.0],
    offset: [0.0, 0.0, 7.5],
};
const CROSS_AXIS_SENDER: SenderSpec = SenderSpec {
    size: [15.0, 4.0, 4.0],
    offset: [-7.5, 0.0, 0.0],
};

const RECEIVERS: [(SleepingPose, f64, [f64; 3]); 9] = [
    (SleepingPose::SideFront, 3.0, [0.0, 3.5, 10.0]),
    (SleepingPose::SideBack, 3.0, [0.0, -8.0, 5.5]),
    (SleepingPose::SideBack, 3.0, [0.0, -8.0, 7.0]),
    (SleepingPose::SideRight, 4.0, [0.0, 9.0, 1.0]),
    (SleepingPose::SideRight, 4.0, [0.0, 9.0, 0.0]),
    (SleepingPose::SideRight, 4.0, [0.0, 9.0, -1.0]),
    (SleepingPose::SideLeft, 4.0, [0.0, -10.0, 1.0]),
    (SleepingPose::SideLeft, 4.0, [0.0, -10.0, 0.0]),
    (SleepingPose::SideLeft, 4.0, [0.0, -10.0, -1.0]),
];

/// An oriented box; `axes` holds its unit axes, `half_size` its extent along each.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Obb {
    pub center: [f64; 3],
    pub half_size: [f64; 3],
    pub axes: [[f64; 3]; 3],
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Receiver {
    pub pose: SleepingPose,
    pub center: [f64; 3],
    pub radius: f64,
    /// Whether this sphere touches the sender of its pose.
    pub colliding: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PoseGeometry {
    /// Collides with the front and back receivers.
    pub main_axis_sender: Obb,
    /// Collides with the left and right receivers.
    pub cross_axis_sender: Obb,
    pub receivers: Vec<Receiver>,
}

impl PoseGeometry {
    /// Places the senders at `quaternion` (`[x, y, z, w]`) and the receivers at its yaw only.
    pub fn new(quaternion: [f64; 4]) -> Self {
        let sender_rotation = compose(quaternion);
        let main_axis_sender = sender(&sender_rotation, &MAIN_AXIS_SENDER);
        let cross_axis_sender = sender(&sender_rotation, &CROSS_AXIS_SENDER);
        let receiver_rotation = compose(yaw_only(&sender_rotation));
        let receivers = RECEIVERS
            .iter()
            .map(|&(pose, radius, offset)| {
                let center = translation(&receiver_rotation, offset);
                let sender = match pose {
                    SleepingPose::SideFront | SleepingPose::SideBack => &main_axis_sender,
                    _ => &cross_axis_sender,
                };
                Receiver {
                    pose,
                    center,
                    radius,
                    colliding: intersects_sphere(sender, center, radius),
                }
            })
            .collect();
        Self {
            main_axis_sender,
            cross_axis_sender,
            receivers,
        }
    }

    /// Whether any receiver of `pose` collides with its sender.
    pub fn is_active(&self, pose: SleepingPose) -> bool {
        self.receivers.iter().any(|r| r.pose == pose && r.colliding)
    }

    /// The colliding pose with the highest priority, or `None` when no receiver collides.
    pub fn active_pose(&self) -> Option<SleepingPose> {
        POSE_PRIORITY.into_iter().find(|&pose| self.is_active(pose))
    }
}

/// `Matrix4.compose` with a zero position and unit scale, column major.
fn compose([x, y, z, w]: [f64; 4]) -> [f64; 16] {
    let (x2, y2, z2) = (x + x, y + y, z + z);
    let (xx, xy, xz) = (x * x2, x * y2, x * z2);
    let (yy, yz, zz) = (y * y2, y * z2, z * z2);
    let (wx, wy, wz) = (w * x2, w * y2, w * z2);
    [
        1.0 - (yy + zz),
        xy + wz,
        xz - wy,
        0.0,
        xy - wz,
        1.0 - (xx + zz),
        yz + wx,
        0.0,
        xz + wy,
        yz - wx,
        1.0 - (xx + yy),
        0.0,
        0.0,
        0.0,
        0.0,
        1.0,
    ]
}

/// The position column of `matrix` multiplied by a translation to `offset`.
fn translation(m: &[f64; 16], [ox, oy, oz]: [f64; 3]) -> [f64; 3] {
    [
        m[0] * ox + m[4] * oy + m[8] * oz + m[12],
        m[1] * ox + m[5] * oy + m[9] * oz + m[13],
        m[2] * ox + m[6] * oy + m[10] * oz + m[14],
    ]
}

/// `Euler.setFromRotationMatrix` in order YXZ, then `Quaternion.setFromEuler` with x and z zeroed.
fn yaw_only(m: &[f64; 16]) -> [f64; 4] {
    let (m11, m13, m23, m31, m33) = (m[0], m[8], m[9], m[2], m[10]);
    // libm follows fdlibm like V8, where the C runtime's atan2 differs in the last bit
    let yaw = if m23.abs() < 0.9999999 {
        libm::atan2(m13, m33)
    } else {
        libm::atan2(-m31, m11)
    };
    [0.0, libm::sin(yaw / 2.0), 0.0, libm::cos(yaw / 2.0)]
}

/// A box of `spec` rotated by `rotation`, as `OBB.applyMatrix4` builds it.
fn sender(rotation: &[f64; 16], spec: &SenderSpec) -> Obb {
    // the rotation of a unit quaternion has a positive determinant, so no axis flips
    let mut axes = [[0.0; 3]; 3];
    let mut half_size = [0.0; 3];
    for (i, axis) in axes.iter_mut().enumerate() {
        let column = [rotation[i * 4], rotation[i * 4 + 1], rotation[i * 4 + 2]];
        let scale = (column[0] * column[0] + column[1] * column[1] + column[2] * column[2]).sqrt();
        let inverse = 1.0 / scale;
        *axis = column.map(|v| v * inverse);
        half_size[i] = spec.size[i] * 0.5 * scale;
    }
    Obb {
        center: translation(rotation, spec.offset),
        half_size,
        axes,
    }
}

/// `OBB.intersectsSphere`: clamps the sphere centre into the box and compares the distance.
fn intersects_sphere(obb: &Obb, center: [f64; 3], radius: f64) -> bool {
    let v = [
        center[0] - obb.center[0],
        center[1] - obb.center[1],
        center[2] - obb.center[2],
    ];
    let mut closest = obb.center;
    for (axis, half) in obb.axes.iter().zip(obb.half_size) {
        let distance = (v[0] * axis[0] + v[1] * axis[1] + v[2] * axis[2])
            .min(half)
            .max(-half);
        for k in 0..3 {
            closest[k] += axis[k] * distance;
        }
    }
    let d = [
        closest[0] - center[0],
        closest[1] - center[1],
        closest[2] - center[2],
    ];
    d[0] * d[0] + d[1] * d[1] + d[2] * d[2] <= radius * radius
}
