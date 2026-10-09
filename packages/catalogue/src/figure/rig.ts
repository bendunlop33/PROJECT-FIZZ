/**
 * Rig `adult-v1`: one adult body, lengths as fractions of standing height H.
 *
 * Landmark heights follow the Drillis & Contini segment-length diagram as
 * reproduced in Winter, *Biomechanics and Motor Control of Human Movement*
 * (ankle 0.039 H, knee 0.285 H, hip 0.530 H, shoulder 0.818 H, chin 0.870 H,
 * upper arm 0.186 H, forearm 0.146 H, hand 0.108 H, foot 0.152 H). These were
 * not re-checked against the book in this slice (research §10 item 5): treat
 * them as the drawing proportions, not measurement data.
 *
 * Lengths are fixed. Animation interpolates joint angles (and IK targets), so
 * limbs never stretch. The only exception is the guide-level `projection`
 * factor, which shortens a limb that points partly towards the camera.
 */

export const RIG_ID = 'adult-v1';

export const ADULT_V1 = {
  id: RIG_ID,
  /** Hip joint height standing (greater trochanter). */
  hipHeight: 0.53,
  /** Trunk chain from the hip joint: pelvis → lumbar → thorax (top = C7). */
  pelvis: 0.07,
  lumbar: 0.1,
  thorax: 0.14,
  /** Shoulder joint along the thorax (0 = bottom, 1 = C7). Puts it at 0.818 H standing. */
  shoulderAt: 0.84,
  /** Shoulder joint sits slightly in front of the spine line in a side view. */
  shoulderForward: 0.012,
  neck: 0.058,
  headRadius: 0.058,
  /** Head centre beyond the neck top, along the neck. */
  headOffset: 0.036,
  /** Head centre slightly in front of the neck line (face forward). */
  headForward: 0.012,
  thigh: 0.245,
  shank: 0.246,
  upperArm: 0.186,
  forearm: 0.146,
  /** Wrist to the middle of the grip (where an implement is held). */
  grip: 0.045,
  hand: 0.07,
  /** A flat hand (palm contact): wrist above and behind the middle of the palm. */
  palm: { back: 0.035, up: 0.02 },
  /** Foot, in the foot frame (origin = ankle joint, +u = towards the toes, +v = up). */
  foot: {
    ankleHeight: 0.039,
    heel: -0.042,
    ball: 0.085,
    toe: 0.113,
  },
  /** Front view only: half widths of the joint centres. */
  front: {
    shoulderHalf: 0.115,
    hipHalf: 0.085,
  },
  /** Drawing radii (half thickness) for capsules, side view. */
  radius: {
    pelvis: 0.066,
    lumbar: 0.058,
    thoraxLow: 0.064,
    thoraxHigh: 0.068,
    neck: 0.026,
    thighHip: 0.052,
    thighKnee: 0.033,
    shankKnee: 0.031,
    shankAnkle: 0.02,
    upperArmShoulder: 0.028,
    upperArmElbow: 0.022,
    forearmElbow: 0.021,
    forearmWrist: 0.016,
    hand: 0.017,
    foot: 0.017,
  },
} as const;

export type Rig = typeof ADULT_V1;

export const SIDES = ['Near', 'Far'] as const;
export type Side = (typeof SIDES)[number];

/** Keyframe joint-angle names. Flexion positive, relative to the parent segment. */
export const JOINT_NAMES = [
  'lumbar',
  'thoracic',
  'neck',
  'shoulderNear',
  'elbowNear',
  'wristNear',
  'shoulderFar',
  'elbowFar',
  'wristFar',
  'hipNear',
  'kneeNear',
  'ankleNear',
  'hipFar',
  'kneeFar',
  'ankleFar',
] as const;
export type JointName = (typeof JOINT_NAMES)[number];

/** Effective angles a pose reports (joints after IK, plus the pelvis tilt). */
export type AngleName = JointName | 'pelvis';

export interface RomLimits {
  readonly min: number;
  readonly max: number;
}

/**
 * Range-of-motion limits on the *projected* 2D angles the rig draws. Wider
 * than anatomical where projection folds a limb (a back-squat elbow seen from
 * the side looks more bent than it is), but they still catch hyperextended
 * knees and elbows, backwards hips and broken spines.
 */
export const ROM_PROFILES = {
  'adult-default': {
    side: {
      pelvis: { min: -100, max: 100 },
      lumbar: { min: -25, max: 35 },
      thoracic: { min: -20, max: 35 },
      neck: { min: -45, max: 50 },
      shoulderNear: { min: -80, max: 200 },
      shoulderFar: { min: -80, max: 200 },
      elbowNear: { min: -5, max: 170 },
      elbowFar: { min: -5, max: 170 },
      wristNear: { min: -80, max: 80 },
      wristFar: { min: -80, max: 80 },
      hipNear: { min: -35, max: 150 },
      hipFar: { min: -35, max: 150 },
      kneeNear: { min: -5, max: 160 },
      kneeFar: { min: -5, max: 160 },
      ankleNear: { min: -55, max: 50 },
      ankleFar: { min: -55, max: 50 },
    },
    front: {
      pelvis: { min: -30, max: 30 },
      lumbar: { min: -30, max: 30 },
      thoracic: { min: -30, max: 30 },
      neck: { min: -30, max: 30 },
      shoulderNear: { min: -15, max: 190 },
      shoulderFar: { min: -15, max: 190 },
      elbowNear: { min: -5, max: 170 },
      elbowFar: { min: -5, max: 170 },
      wristNear: { min: -80, max: 80 },
      wristFar: { min: -80, max: 80 },
      hipNear: { min: -15, max: 70 },
      hipFar: { min: -15, max: 70 },
      kneeNear: { min: -30, max: 30 },
      kneeFar: { min: -30, max: 30 },
      ankleNear: { min: -45, max: 45 },
      ankleFar: { min: -45, max: 45 },
    },
  },
} as const satisfies Record<string, Record<'side' | 'front', Record<AngleName, RomLimits>>>;

export type RomProfileName = keyof typeof ROM_PROFILES;
export const ROM_PROFILE_NAMES = Object.keys(ROM_PROFILES) as [RomProfileName, ...RomProfileName[]];
