/**
 * `guide.json` format v1 (research exercise-bank-and-visuals §5.3, ADR 0010).
 * The only guide file the app ships. Coordinates: origin on the floor under
 * the figure, y up, units = body height (H = 1). Angles in degrees, flexion
 * positive, relative to the parent segment (see `pose.ts` for each angle).
 */
import { CatalogueKeySchema } from '@fizz/schemas';
import { z } from 'zod';
import { GuideViewSchema } from '../entry-schema';
import { EASES } from './math';
import { ANGLE_NAMES, JOINT_NAMES, RIG_ID, ROM_PROFILE_NAMES } from './rig';

const num = z.number();
const coord = num.min(-3).max(3);
const angle = num.min(-360).max(360);
const propId = z.string().regex(/^[a-z][a-zA-Z0-9]{0,23}$/);
const text = (max: number) => z.string().trim().min(1).max(max);

/** IK bend side: the middle joint sits counter-clockwise (`ccw`) or clockwise of root→target, facing right. */
export const BendSchema = z.enum(['ccw', 'cw']);

/** Where a prop is. Trunk-segment anchors only (they are solved before the limbs). */
export const AnchorSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('fixed'), x: coord, y: coord }),
  /** Position comes from the keyframes' `props.<id>` values. */
  z.strictObject({ kind: z.literal('keyframed') }),
  z.strictObject({
    kind: z.literal('segment'),
    segment: z.enum(['pelvis', 'lumbar', 'thorax', 'neck']),
    /** 0 = segment start (towards the hip), 1 = end. */
    at: num.min(0).max(1.5),
    /** Offset along the segment and towards the front (negative = behind the body). */
    along: coord.optional(),
    front: coord.optional(),
  }),
  /** Hangs from a hand (dumbbells). Solved after the arms. */
  z.strictObject({ kind: z.literal('hand'), hand: z.enum(['near', 'far']) }),
]);
export type Anchor = z.infer<typeof AnchorSchema>;

const base = { id: propId };

export const PropSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...base,
    type: z.literal('barbell'),
    plates: z.enum(['none', 'small', 'medium', 'large']),
    anchor: AnchorSchema,
    /** Front view only: hands hold the bar this far either side of its centre (default 0.24 H). */
    gripHalfWidth: num.min(0.05).max(0.5).optional(),
  }),
  z.strictObject({
    ...base,
    type: z.literal('dumbbell'),
    size: z.enum(['small', 'medium', 'large']),
    anchor: AnchorSchema,
    /**
     * `end` (default): handle pointing at the camera, seen as one disc.
     * `side`: handle across the picture (a neutral grip seen from the side), both heads visible.
     */
    seen: z.enum(['end', 'side']).optional(),
  }),
  z.strictObject({
    ...base,
    type: z.literal('bench'),
    /** Pad from `x` to `x + length` (seat end at `x`). */
    x: coord,
    length: num.min(0.2).max(1.2).optional(),
    /** Top of the pad. */
    height: num.min(0.1).max(0.6).optional(),
    /** Backrest incline from the seat end, 0 = flat. */
    angleDeg: num.min(0).max(90).optional(),
  }),
  z.strictObject({
    ...base,
    type: z.literal('cable_stack'),
    /** Column centre x and pulley height. */
    x: coord,
    pulleyY: num.min(0).max(1.4),
    /** Which hand holds the handle (both hands meet in a side view). */
    hand: z.enum(['near', 'far']),
    handle: z.enum(['bar', 'rope', 'stirrup']),
    /** Cable length at which the stack rests; longer cable lifts the stack. */
    restLength: num.min(0).max(3).optional(),
    /** Run the cable to another prop's centre (a pulldown bar) instead of the hand; no handle is drawn. */
    attach: propId.optional(),
    /** Draw the column and weight stack (default true); false leaves the pulley and cable. */
    column: z.boolean().optional(),
  }),
  z.strictObject({
    ...base,
    type: z.literal('pad'),
    /** A fixed padded block or roller (thigh pad, seat back) centred on x, y; drawn in front of the body when `front`. */
    x: coord,
    y: coord,
    w: num.min(0.02).max(1.2),
    h: num.min(0.02).max(1.2),
    front: z.boolean().optional(),
  }),
  z.strictObject({
    ...base,
    type: z.literal('leg_press'),
    /** Carriage foot-plate centre at travel 0, and the rail angle from horizontal. */
    x: coord,
    y: coord,
    railDeg: num.min(10).max(80),
    /** Seat pad (back rest) as a line from `seat` along `seatDeg`, length `seatLength`. */
    seatX: coord,
    seatY: coord,
    seatDeg: num.min(0).max(90),
    plates: z.enum(['none', 'small', 'medium', 'large']),
  }),
  z.strictObject({
    ...base,
    type: z.literal('push_sled'),
    /** Front edge of the sled body, relative to the figure (the floor scrolls). */
    x: coord,
    /** Grip height on the poles. */
    gripY: num.min(0.3).max(1.2),
    plates: z.enum(['none', 'small', 'medium', 'large']),
  }),
]);
export type GuideProp = z.infer<typeof PropSchema>;

export const FootIkSchema = z.strictObject({
  /** Contact point (on the sole) in world units; omitted = carried forward. */
  x: coord.optional(),
  y: coord.optional(),
  /** Planted: the contact point moves with the floor (doesn't slide). */
  planted: z.boolean().optional(),
  /** Sole angle; positive lifts the heel. */
  soleDeg: angle.optional(),
  /** Contact point: under the ankle (flat foot) or the ball of the foot. */
  pivot: z.enum(['ankle', 'ball']).optional(),
  /** Put the sole on a prop's foot plate instead (leg press). */
  prop: propId.optional(),
  bend: BendSchema.optional(),
});
export type FootIk = z.infer<typeof FootIkSchema>;

export const HandIkSchema = z.strictObject({
  x: coord.optional(),
  y: coord.optional(),
  /** Hold a prop's grip point instead of a fixed point. */
  prop: propId.optional(),
  bend: BendSchema.optional(),
  /**
   * `grip` (default): the target is the middle of a closed hand.
   * `palm` (side view): the target is where the palm presses on a surface;
   * the hand lies flat, fingers forward (a hand braced on a bench).
   */
  contact: z.enum(['grip', 'palm']).optional(),
});
export type HandIk = z.infer<typeof HandIkSchema>;

export const IK_LIMBS = ['footNear', 'footFar', 'handNear', 'handFar'] as const;
export const LIMB_GROUPS = ['armNear', 'armFar', 'legNear', 'legFar'] as const;
export type LimbGroup = (typeof LIMB_GROUPS)[number];
export type IkLimb = (typeof IK_LIMBS)[number];

const projection = num.min(0.2).max(1);

/** Foreshortening factors per limb (1 = in the picture plane). */
export const ProjectionSchema = z.strictObject({
  armNear: projection.optional(),
  armFar: projection.optional(),
  /** Forearm (and hand) only; defaults to the arm value. A wide grip foreshortens the forearm more. */
  forearmNear: projection.optional(),
  forearmFar: projection.optional(),
  legNear: projection.optional(),
  legFar: projection.optional(),
  /** Shank (and foot) only; defaults to the leg value. A seated thigh points at the camera, the shank doesn't. */
  shankNear: projection.optional(),
  shankFar: projection.optional(),
});
export type Projection = z.infer<typeof ProjectionSchema>;
export const PROJECTION_KEYS = ['armNear', 'armFar', 'forearmNear', 'forearmFar', 'legNear', 'legFar', 'shankNear', 'shankFar'] as const;

export const KeyframeSchema = z.strictObject({
  t: num.min(0).max(1),
  label: text(40).optional(),
  caption: text(80).optional(),
  /** Copy the pose of an earlier keyframe (closes the loop exactly). */
  sameAs: z.int().min(0).optional(),
  root: z.strictObject({ x: coord.optional(), y: coord.optional(), pelvisDeg: angle.optional() }).optional(),
  joints: z.partialRecord(z.enum(JOINT_NAMES), angle).optional(),
  ik: z
    .strictObject({
      footNear: FootIkSchema.nullable().optional(),
      footFar: FootIkSchema.nullable().optional(),
      handNear: HandIkSchema.nullable().optional(),
      handFar: HandIkSchema.nullable().optional(),
    })
    .optional(),
  /** Keyframed prop positions (`anchor.kind = keyframed`): x, y, or `s` = leg-press travel. */
  props: z.record(propId, z.strictObject({ x: coord.optional(), y: coord.optional(), s: num.min(-1).max(1).optional() })).optional(),
  /**
   * Per-keyframe foreshortening (carried forward, interpolated like angles).
   * For limbs that swing towards the camera mid-movement, e.g. a bench-press
   * upper arm that points almost straight at the camera halfway down.
   */
  projection: ProjectionSchema.optional(),
  holdMs: z.int().min(0).max(5000).optional(),
  /** Easing of the segment that starts at this keyframe. */
  ease: z.enum(EASES).optional(),
});
export type Keyframe = z.infer<typeof KeyframeSchema>;

export const GuideSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    exerciseKey: CatalogueKeySchema,
    /** Templates (research §5.2) are a later slice; only `null` is accepted. */
    extends: z.null().optional(),
    rig: z.literal(RIG_ID),
    view: GuideViewSchema,
    facing: z.enum(['right', 'left']),
    units: z.literal('bodyHeight'),
    durationMs: z.int().min(500).max(20_000),
    loop: z.enum(['cycle', 'pingpong']),
    ground: z.strictObject({ y: num.min(-0.5).max(0.5), scrollPerCycle: num.min(0).max(3) }),
    /** Shortens limbs that point partly towards the camera (1 = in the picture plane). Keyframes may override it. */
    projection: ProjectionSchema.optional(),
    /** Fixed square camera; omitted = fitted to every frame. */
    camera: z.strictObject({ cx: coord, cy: coord, size: num.min(0.3).max(4) }).optional(),
    props: z.array(PropSchema).max(8),
    keyframes: z.array(KeyframeSchema).min(2).max(16),
    overlays: z
      .array(z.strictObject({ type: z.literal('path'), of: propId, showIn: z.array(z.enum(['static', 'animated'])).min(1) }))
      .max(4)
      .optional(),
    checks: z.strictObject({
      /** Max horizontal travel of `barProp` (default: the first barbell), in H. */
      barDriftMax: num.min(0).max(1).optional(),
      barProp: propId.optional(),
      planted: z.array(z.enum(['footNear', 'footFar'])).max(2),
      /**
       * Limbs that pass *beside* a bench, seat or pad (outside its width, out
       * of the picture plane), e.g. a bench-press elbow dropping past the pad.
       * They skip the prop-penetration test only; the floor test still applies.
       */
      besideProps: z.array(z.enum(LIMB_GROUPS)).max(4).optional(),
      /**
       * Angles the rig can't range-check for this movement, with the reason
       * (shown in the check output). E.g. a laces-down rear foot on a bench:
       * the rig's ankle angle is measured on the sole line, which lies near
       * in line with the shin although the real plantarflexion is ~50°.
       */
      romSkip: z.strictObject({ angles: z.array(z.enum(ANGLE_NAMES)).min(1).max(4), reason: text(160) }).optional(),
      romProfile: z.enum(ROM_PROFILE_NAMES),
    }),
    a11y: z.strictObject({ summary: text(400) }),
    review: z.strictObject({ status: z.enum(['draft', 'checked', 'approved']), renderedWith: text(60) }),
  })
  .superRefine((g, ctx) => {
    const ids = g.props.map((p) => p.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'Prop ids must be unique', path: ['props'] });
    const known = new Set(ids);
    g.keyframes.forEach((k, i) => {
      if (k.sameAs !== undefined && k.sameAs >= i) {
        ctx.addIssue({ code: 'custom', message: 'sameAs must point to an earlier keyframe', path: ['keyframes', i, 'sameAs'] });
      }
      for (const id of Object.keys(k.props ?? {})) {
        if (!known.has(id)) ctx.addIssue({ code: 'custom', message: `Unknown prop ${id}`, path: ['keyframes', i, 'props'] });
      }
      for (const limb of IK_LIMBS) {
        const target = k.ik?.[limb];
        if (target?.prop !== undefined && !known.has(target.prop)) {
          ctx.addIssue({ code: 'custom', message: `Unknown prop ${target.prop}`, path: ['keyframes', i, 'ik', limb] });
        }
      }
    });
    for (const o of g.overlays ?? []) {
      if (!known.has(o.of)) ctx.addIssue({ code: 'custom', message: `Unknown prop ${o.of}`, path: ['overlays'] });
    }
    if (g.checks.barProp !== undefined && !known.has(g.checks.barProp)) {
      ctx.addIssue({ code: 'custom', message: `Unknown prop ${g.checks.barProp}`, path: ['checks', 'barProp'] });
    }
  });
export type Guide = z.infer<typeof GuideSchema>;

/** `meta.json`, written by `guide:check` next to `guide.json` (not shipped). */
export const GuideMetaSchema = z.strictObject({
  schemaVersion: z.literal(1),
  exerciseKey: CatalogueKeySchema,
  format: z.literal('fizz-figure-guide@1'),
  rig: z.literal(RIG_ID),
  view: GuideViewSchema,
  durationMs: z.int(),
  keyframes: z.int(),
  renderFps: z.int(),
  frames: z.int(),
  guideBytes: z.int(),
  attribution: text(200),
  reviewStatus: z.enum(['draft', 'checked', 'approved']),
  check: z.strictObject({
    status: z.enum(['pass', 'fail']),
    failed: z.array(z.string()),
  }),
});
export type GuideMeta = z.infer<typeof GuideMetaSchema>;
