//! Pins the classifier to the poses OyasumiVR v25.6.12 detected with three.js 0.181.2.
//!
//! `reference.bin` holds that detector's output for the inputs below. The inputs come from
//! generators that use only IEEE-exact arithmetic, so this test rebuilds them bit for bit.

use super::geometry::{PoseGeometry, SleepingPose, POSE_PRIORITY};
use super::{classify, PoseTracker};
use crate::openvr::devices::quaternion_from_tracking_matrix;

const REFERENCE: &[u8] = include_bytes!("reference.bin");
/// The detector's pose before its first orientation.
const INITIAL_POSE: SleepingPose = SleepingPose::SideFront;
const POSE_CODES: [SleepingPose; 5] = [
    SleepingPose::Unknown,
    SleepingPose::SideFront,
    SleepingPose::SideBack,
    SleepingPose::SideLeft,
    SleepingPose::SideRight,
];
const YAWS: usize = 24;
const PITCHES: usize = 37;
const ROLLS: usize = 72;
const SPAN: f64 = (1u64 << 40) as f64;

struct Reader {
    at: usize,
}

impl Reader {
    fn bytes<const N: usize>(&mut self) -> [u8; N] {
        let bytes = REFERENCE[self.at..self.at + N].try_into().unwrap();
        self.at += N;
        bytes
    }
    fn u8(&mut self) -> u8 {
        self.bytes::<1>()[0]
    }
    fn u16(&mut self) -> u16 {
        u16::from_le_bytes(self.bytes())
    }
    fn u32(&mut self) -> u32 {
        u32::from_le_bytes(self.bytes())
    }
    fn u64(&mut self) -> u64 {
        u64::from_le_bytes(self.bytes())
    }
    fn f64(&mut self) -> f64 {
        f64::from_le_bytes(self.bytes())
    }
    fn nibbles(&mut self, count: usize) -> Vec<u8> {
        (0..count.div_ceil(2))
            .flat_map(|_| {
                let byte = self.u8();
                [byte & 0xf, byte >> 4]
            })
            .take(count)
            .collect()
    }
    fn counted_nibbles(&mut self) -> Vec<u8> {
        let count = self.u32() as usize;
        self.nibbles(count)
    }
}

struct Boundary {
    grid_index: usize,
    axis: u8,
    lo: u64,
    flags: Vec<u8>,
}

struct Sequence {
    events: Vec<u16>,
    emissions: Vec<(u64, SleepingPose)>,
}

struct Reference {
    angles: Vec<(f64, f64)>,
    dense: Vec<u8>,
    random: Vec<u8>,
    boundaries: Vec<Boundary>,
    matrices: Vec<u8>,
    matrix_hash: u64,
    sequences: Vec<Sequence>,
}

fn reference() -> Reference {
    let mut r = Reader { at: 0 };
    assert_eq!(&r.bytes::<8>(), b"OVRPOSE1");
    let angles = (0..r.u16()).map(|_| (r.f64(), r.f64())).collect();
    let dense = r.counted_nibbles();
    let random = r.counted_nibbles();
    let boundaries = (0..r.u32())
        .map(|_| Boundary {
            grid_index: r.u32() as usize,
            axis: r.u8(),
            lo: r.u64(),
            flags: r.nibbles(4),
        })
        .collect();
    let matrices = r.counted_nibbles();
    let matrix_hash = r.u64();
    let sequences = (0..r.u32())
        .map(|_| Sequence {
            events: (0..r.u32()).map(|_| r.u16()).collect(),
            emissions: (0..r.u32())
                .map(|_| (r.u32() as u64, POSE_CODES[r.u8() as usize]))
                .collect(),
        })
        .collect();
    assert_eq!(r.at, REFERENCE.len());
    Reference {
        angles,
        dense,
        random,
        boundaries,
        matrices,
        matrix_hash,
        sequences,
    }
}

// input generators; the fixture generator uses the same arithmetic in JavaScript

/// `Quaternion.setFromEuler` in order YXZ, from tabulated half-angle cosines and sines.
fn from_euler(angles: &[(f64, f64)], pitch: i32, yaw: i32, roll: i32) -> [f64; 4] {
    let angle = |deg: i32| angles[((deg + 180) / 5) as usize];
    let (c1, s1) = angle(pitch);
    let (c2, s2) = angle(yaw);
    let (c3, s3) = angle(roll);
    [
        s1 * c2 * c3 + c1 * s2 * s3,
        c1 * s2 * c3 - s1 * c2 * s3,
        c1 * c2 * s3 - s1 * s2 * c3,
        c1 * c2 * c3 + s1 * s2 * s3,
    ]
}

fn grid_index(yi: usize, pi: usize, ri: usize) -> usize {
    (yi * PITCHES + pi) * ROLLS + ri
}

fn grid_coordinates(i: usize) -> (usize, usize, usize) {
    (i / ROLLS / PITCHES, (i / ROLLS) % PITCHES, i % ROLLS)
}

fn grid_quaternion(angles: &[(f64, f64)], i: usize) -> [f64; 4] {
    let (yi, pi, ri) = grid_coordinates(i);
    from_euler(
        angles,
        -90 + 5 * pi as i32,
        15 * yi as i32,
        -180 + 5 * ri as i32,
    )
}

/// The 15° grid of the first equivalence check, inside the 5° dense grid.
fn is_coarse(i: usize) -> bool {
    let (yi, pi, ri) = grid_coordinates(i);
    yi % 3 == 0 && pi % 3 == 0 && ri % 3 == 0
}

/// SplitMix64.
struct Rng(u64);

impl Rng {
    fn uniform(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x9e3779b97f4a7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d049bb133111eb);
        z ^= z >> 31;
        (z >> 11) as f64 / (1u64 << 53) as f64
    }
}

fn random_quaternions(seed: u64, count: usize) -> Vec<[f64; 4]> {
    let mut rng = Rng(seed);
    let mut out = Vec::with_capacity(count);
    while out.len() < count {
        let u: [f64; 4] = std::array::from_fn(|_| rng.uniform() * 2.0 - 1.0);
        let s = u[0] * u[0] + u[1] * u[1] + u[2] * u[2] + u[3] * u[3];
        if !(1e-4..=1.0).contains(&s) {
            continue;
        }
        let n = s.sqrt();
        out.push(u.map(|v| v / n));
    }
    out
}

fn nlerp(a: [f64; 4], b: [f64; 4], k: u64) -> [f64; 4] {
    let t = k as f64 / SPAN;
    let omt = 1.0 - t;
    let c: [f64; 4] = std::array::from_fn(|i| a[i] * omt + b[i] * t);
    let n = (c[0] * c[0] + c[1] * c[1] + c[2] * c[2] + c[3] * c[3]).sqrt();
    c.map(|v| v / n)
}

fn tracking_matrix([x, y, z, w]: [f64; 4]) -> [[f32; 4]; 3] {
    [
        [
            1.0 - 2.0 * (y * y + z * z),
            2.0 * (x * y - z * w),
            2.0 * (x * z + y * w),
            0.0,
        ],
        [
            2.0 * (x * y + z * w),
            1.0 - 2.0 * (x * x + z * z),
            2.0 * (y * z - x * w),
            0.0,
        ],
        [
            2.0 * (x * z - y * w),
            2.0 * (y * z + x * w),
            1.0 - 2.0 * (x * x + y * y),
            0.0,
        ],
    ]
    .map(|row| row.map(|v| v as f32))
}

// comparison

fn flags(geometry: &PoseGeometry) -> u8 {
    [
        SleepingPose::SideFront,
        SleepingPose::SideBack,
        SleepingPose::SideLeft,
        SleepingPose::SideRight,
    ]
    .into_iter()
    .enumerate()
    .filter(|&(_, pose)| geometry.is_active(pose))
    .fold(0, |acc, (bit, _)| acc | 1 << bit)
}

fn pose_of_flags(flags: u8) -> SleepingPose {
    let bit = |pose| match pose {
        SleepingPose::SideFront => 1,
        SleepingPose::SideBack => 2,
        SleepingPose::SideLeft => 4,
        _ => 8,
    };
    POSE_PRIORITY
        .into_iter()
        .find(|&pose| flags & bit(pose) != 0)
        .unwrap_or(INITIAL_POSE)
}

fn hex(q: [f64; 4]) -> String {
    q.map(|v| format!("{:#018x}", v.to_bits())).join(",")
}

/// Compares `q` and `-q` with the reference flags, and the pose of a fresh detector.
fn compare(mismatches: &mut Vec<String>, label: &str, q: [f64; 4], expected: u8) {
    for q in [q, q.map(|v| -v)] {
        let geometry = PoseGeometry::new(q);
        let actual = flags(&geometry);
        let pose = classify(&geometry, INITIAL_POSE);
        if actual != expected || pose != pose_of_flags(expected) {
            mismatches.push(format!(
                "{label} q=[{}] flags {actual:#06b} (reference {expected:#06b}) pose {pose:?}",
                hex(q)
            ));
        }
    }
}

fn assert_no_mismatches(mismatches: Vec<String>) {
    assert!(
        mismatches.is_empty(),
        "{} mismatches, first: {:#?}",
        mismatches.len(),
        &mismatches[..mismatches.len().min(20)]
    );
}

#[test]
fn matches_the_reference_on_the_5_degree_grid() {
    let reference = reference();
    assert_eq!(reference.dense.len(), YAWS * PITCHES * ROLLS);
    assert_eq!(
        (0..reference.dense.len()).filter(|&i| is_coarse(i)).count(),
        2_496
    );
    let mut mismatches = Vec::new();
    for (i, &expected) in reference.dense.iter().enumerate() {
        let q = grid_quaternion(&reference.angles, i);
        compare(&mut mismatches, &format!("grid {i}"), q, expected);
    }
    assert_no_mismatches(mismatches);
}

#[test]
fn matches_the_reference_on_random_orientations() {
    let reference = reference();
    let quaternions = random_quaternions(0x5eed0001, reference.random.len());
    let mut mismatches = Vec::new();
    for (i, (&q, &expected)) in quaternions.iter().zip(&reference.random).enumerate() {
        compare(&mut mismatches, &format!("random {i}"), q, expected);
    }
    assert_no_mismatches(mismatches);
}

#[test]
fn matches_the_reference_across_receiver_boundaries() {
    let reference = reference();
    let mut mismatches = Vec::new();
    let mut flips = 0;
    for boundary in &reference.boundaries {
        let (yi, pi, ri) = grid_coordinates(boundary.grid_index);
        let neighbour = match boundary.axis {
            0 => grid_index(yi, pi, (ri + 1) % ROLLS),
            1 => grid_index(yi, pi + 1, ri),
            _ => grid_index((yi + 1) % YAWS, pi, ri),
        };
        let a = grid_quaternion(&reference.angles, boundary.grid_index);
        let mut b = grid_quaternion(&reference.angles, neighbour);
        if a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0.0 {
            b = b.map(|v| -v);
        }
        let lo = boundary.lo;
        let points = [
            lo,
            lo + 1,
            lo.saturating_sub(1 << 34),
            (lo + 1 + (1 << 34)).min(1 << 40),
        ];
        assert_ne!(boundary.flags[0], boundary.flags[1]);
        flips += 1;
        for (k, &expected) in points.iter().zip(&boundary.flags) {
            let label = format!(
                "boundary {} axis {} k {k}",
                boundary.grid_index, boundary.axis
            );
            compare(&mut mismatches, &label, nlerp(a, b, *k), expected);
        }
    }
    assert!(flips > 1_000);
    assert_no_mismatches(mismatches);
}

#[test]
fn matches_the_reference_through_the_tracking_matrix_conversion() {
    let reference = reference();
    let mut inputs: Vec<[f64; 4]> = (0..reference.dense.len())
        .filter(|&i| is_coarse(i))
        .map(|i| grid_quaternion(&reference.angles, i))
        .collect();
    inputs.extend(random_quaternions(0x5eed0001, 20_000));
    assert_eq!(inputs.len(), reference.matrices.len());
    let mut hash: u64 = 0xcbf29ce484222325;
    let mut mismatches = Vec::new();
    for (i, (&q, &expected)) in inputs.iter().zip(&reference.matrices).enumerate() {
        let converted = quaternion_from_tracking_matrix(&tracking_matrix(q));
        for byte in converted.iter().flat_map(|v| v.to_le_bytes()) {
            hash = (hash ^ byte as u64).wrapping_mul(0x100000001b3);
        }
        compare(&mut mismatches, &format!("matrix {i}"), converted, expected);
    }
    assert_eq!(hash, reference.matrix_hash, "converted quaternions differ");
    assert_no_mismatches(mismatches);
}

#[test]
fn replays_pose_sequences_like_the_sleep_service() {
    const TICK_MS: u64 = 32;
    let reference = reference();
    let mut max_delay = 0;
    for (s, sequence) in reference.sequences.iter().enumerate() {
        let mut tracker = PoseTracker::new(0);
        let mut emissions = Vec::new();
        let mut tick = 0;
        let mut run_until = |tracker: &mut PoseTracker, t: u64, emissions: &mut Vec<_>| {
            while tick < t {
                emissions.extend(tracker.advance(tick).map(|pose| (tick, pose)));
                tick += TICK_MS;
            }
            emissions.extend(tracker.advance(t).map(|pose| (t, pose)));
        };
        let mut slot = 0;
        let mut last = 0;
        for &code in &sequence.events {
            if (0xfff1..=0xfff4).contains(&code) {
                last = 125 + 250 * (slot - 1) + 60;
                run_until(&mut tracker, last, &mut emissions);
                let pose = POSE_CODES[(code & 0xf) as usize];
                emissions.extend(tracker.set_stable(pose).map(|pose| (last, pose)));
                continue;
            }
            last = 125 + 250 * slot;
            slot += 1;
            run_until(&mut tracker, last, &mut emissions);
            if code != 0xfffe {
                let q = grid_quaternion(&reference.angles, code as usize);
                tracker.sample(last, &PoseGeometry::new(q));
            }
        }
        run_until(&mut tracker, last + 2000, &mut emissions);

        let poses = |list: &[(u64, SleepingPose)]| list.iter().map(|e| e.1).collect::<Vec<_>>();
        assert_eq!(
            poses(&emissions),
            poses(&sequence.emissions),
            "sequence {s}"
        );
        for (&(actual, _), &(expected, _)) in emissions.iter().zip(&sequence.emissions) {
            assert!(
                (expected..=expected + 250).contains(&actual),
                "sequence {s}: emitted at {actual} ms, reference {expected} ms"
            );
            max_delay = max_delay.max(actual - expected);
        }
    }
    assert!(max_delay < TICK_MS, "max delay {max_delay} ms");
}

fn headset(pitch_degrees: f64, roll_degrees: f64) -> [f64; 4] {
    let (s1, c1) = (pitch_degrees.to_radians() / 2.0).sin_cos();
    let (s3, c3) = (roll_degrees.to_radians() / 2.0).sin_cos();
    [s1 * c3, -s1 * s3, c1 * s3, c1 * c3]
}

#[test]
fn classifies_basic_headset_orientations() {
    for (pitch, roll, expected) in [
        (0.0, 0.0, SleepingPose::SideFront),
        (75.0, 0.0, SleepingPose::SideBack),
        (0.0, 90.0, SleepingPose::SideLeft),
        (0.0, -90.0, SleepingPose::SideRight),
    ] {
        let geometry = PoseGeometry::new(headset(pitch, roll));
        assert_eq!(classify(&geometry, SleepingPose::Unknown), expected);
    }
}

#[test]
fn keeps_the_previous_pose_without_a_collision() {
    // face down collides with no receiver
    let geometry = PoseGeometry::new(headset(-90.0, 180.0));
    assert_eq!(geometry.active_pose(), None);
    assert_eq!(
        classify(&geometry, SleepingPose::SideLeft),
        SleepingPose::SideLeft
    );
}
