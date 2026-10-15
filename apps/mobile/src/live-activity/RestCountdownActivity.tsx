/* eslint-disable no-restricted-globals -- the widget builds Dates from props (not a clock read);
   widget code is serialised alone and can't import the clock helpers. Comments stay outside it. */
import { HStack, Image, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { accessibilityElement, accessibilityLabel, activityBackgroundTint, font, foregroundStyle, frame, lineLimit, minimumScaleFactor, monospacedDigit, padding } from '@expo/ui/swift-ui/modifiers';
import { createLiveActivity, type LiveActivityEnvironment, type LiveActivityFactory } from 'expo-widgets';

import type { WorkoutActivityProps } from './controller';

/**
 * The workout's Lock Screen / Dynamic Island activity (lock-screen-and-alerts
 * §2.1): Ready, Resting, Working or Paused. The system renders the countdown
 * from the two instants, so it keeps counting with the app suspended or
 * killed; `Until 18:42` keeps `0:00` unambiguous. Local updates only, no push
 * (ADR 0004). Direction D: dark canvas, warm off-white text, a large light
 * numeral (D-Rest), monospaced digits so the countdown doesn't jitter.
 *
 * The widget function is serialised and run in the extension on its own: it
 * can't call helpers or read constants from this file, so the colours are
 * written inline (D dark: canvas #0D0C0B, text #F3EEE8, secondary #B5ADA5,
 * accent #EDE5DA; paused icon status.warning #F2B84B).
 *
 * Device-checked: the probe's countdown (build with the App Group fix). Not
 * yet device-checked: this layout (Spacer, sizes) and the update path; see
 * docs/device-tests/2026-10-12-live-activity-rest.md.
 *
 * Sizes: 56pt banner / 44pt expanded is the build's answer to Ben's "a bit
 * bigger"; the spec's `type.liveCountdown` still says 28/24pt and waits for
 * the designer (review ben-bugs S3). The large numerals shrink to fit (down to
 * 60%) rather than truncate on a long rest (`10:00`, `1:02:30`); not yet
 * checked on the phone (L9, L10).
 */
const WorkoutActivity = (props: WorkoutActivityProps, environment: LiveActivityEnvironment) => {
  'widget';
  const counting = props.endMs > 0;
  const range = { lower: new Date(props.startMs), upper: new Date(props.endMs) };
  const dim = environment.isLuminanceReduced === true;
  const numeralWeight = dim ? 'ultraLight' : 'light';
  const icon = props.state === 'paused' ? 'pause.circle.fill' : props.state === 'ready' ? 'figure.strengthtraining.traditional' : 'timer';
  const iconColour = props.state === 'paused' ? '#F2B84B' : '#EDE5DA';
  const big = counting ? (
    <Text timerInterval={range} countsDown modifiers={[font({ size: 56, weight: numeralWeight }), monospacedDigit(), foregroundStyle('#F3EEE8'), lineLimit(1), minimumScaleFactor(0.6)]} />
  ) : props.side !== '' ? (
    <Text modifiers={[font({ size: 40, weight: numeralWeight }), monospacedDigit(), foregroundStyle('#F3EEE8'), lineLimit(1)]}>{props.side}</Text>
  ) : null;
  return {
    banner: (
      <HStack alignment="center" spacing={12} modifiers={[padding({ horizontal: 18, vertical: 14 }), activityBackgroundTint('#0D0C0B')]}>
        <VStack alignment="leading" spacing={4} modifiers={[accessibilityElement('ignore'), accessibilityLabel(props.a11y)]}>
          <HStack spacing={6}>
            <Image systemName={icon} color={iconColour} />
            <Text modifiers={[font({ size: 17, weight: 'semibold' }), foregroundStyle('#F3EEE8'), lineLimit(1)]}>{props.title}</Text>
          </HStack>
          {props.line1 !== '' ? <Text modifiers={[font({ size: 15 }), monospacedDigit(), foregroundStyle('#B5ADA5'), lineLimit(2)]}>{props.line1}</Text> : null}
          {props.line2 !== '' ? <Text modifiers={[font({ size: 17, weight: 'medium' }), monospacedDigit(), foregroundStyle('#F3EEE8'), lineLimit(1)]}>{props.line2}</Text> : null}
        </VStack>
        <Spacer />
        {big}
      </HStack>
    ),
    compactLeading: <Image systemName={icon} color={iconColour} />,
    compactTrailing: counting ? (
      <Text timerInterval={range} countsDown modifiers={[font({ size: 15, weight: 'semibold' }), monospacedDigit(), frame({ width: 48 })]} />
    ) : (
      <Text modifiers={[font({ size: 15, weight: 'semibold' }), monospacedDigit()]}>{props.side}</Text>
    ),
    minimal: counting ? <Text timerInterval={range} countsDown modifiers={[font({ size: 13, weight: 'semibold' }), monospacedDigit()]} /> : <Image systemName={icon} color={iconColour} />,
    expandedLeading: (
      <HStack spacing={6} modifiers={[padding({ leading: 8 })]}>
        <Image systemName={icon} color={iconColour} />
        <Text modifiers={[font({ size: 17, weight: 'semibold' }), lineLimit(1)]}>{props.title}</Text>
      </HStack>
    ),
    expandedTrailing: counting ? (
      <Text timerInterval={range} countsDown modifiers={[font({ size: 44, weight: numeralWeight }), monospacedDigit(), lineLimit(1), minimumScaleFactor(0.6), padding({ trailing: 8 })]} />
    ) : (
      <Text modifiers={[font({ size: 34, weight: numeralWeight }), monospacedDigit(), padding({ trailing: 8 })]}>{props.side}</Text>
    ),
    expandedBottom: (
      <VStack alignment="leading" spacing={2} modifiers={[padding({ horizontal: 8 })]}>
        {props.line1 !== '' ? <Text modifiers={[font({ size: 15 }), monospacedDigit(), lineLimit(1)]}>{props.line1}</Text> : null}
        {props.line2 !== '' ? <Text modifiers={[font({ size: 17, weight: 'medium' }), monospacedDigit(), lineLimit(1)]}>{props.line2}</Text> : null}
      </VStack>
    ),
  };
};

let factory: LiveActivityFactory<WorkoutActivityProps> | null = null;

/**
 * Created lazily so a build without the widget extension fails inside the
 * caller (and is caught), not at import. The name stays `RestCountdown`: it is
 * the activity type the probe proved on Ben's phone.
 */
export function restCountdownActivity(): LiveActivityFactory<WorkoutActivityProps> {
  factory ??= createLiveActivity<WorkoutActivityProps>('RestCountdown', WorkoutActivity);
  return factory;
}
