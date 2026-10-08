/* eslint-disable no-restricted-globals -- the widget builds Dates from props (not a clock read);
   widget code is serialised alone and can't import the clock helpers. Comments stay outside it. */
import { HStack, Image, Text, VStack } from '@expo/ui/swift-ui';
import { font, padding } from '@expo/ui/swift-ui/modifiers';
import { createLiveActivity, type LiveActivityEnvironment, type LiveActivityFactory } from 'expo-widgets';

/**
 * Lock Screen / Dynamic Island rest countdown. The system renders the timer
 * from the two dates, so it keeps counting with the app suspended or killed.
 * No push: it is started and ended locally only (ADR 0004).
 *
 * UNVERIFIED until a device run: whether Date props render through the widget
 * runtime, and whether a SideStore-signed build may start Live Activities.
 */
export interface RestCountdownProps {
  startedAtMs: number;
  endsAtMs: number;
  /** e.g. "Next: Bench 100 kg × 8" */
  nextLabel: string;
}

const RestCountdown = (props: RestCountdownProps, environment: LiveActivityEnvironment) => {
  'widget';
  const range = { lower: new Date(props.startedAtMs), upper: new Date(props.endsAtMs) };
  const weight = environment.isLuminanceReduced ? 'regular' : 'bold';
  return {
    banner: (
      <VStack modifiers={[padding({ all: 12 })]}>
        <HStack>
          <Image systemName="timer" />
          <Text modifiers={[font({ weight: 'semibold' })]}>Rest</Text>
          <Text timerInterval={range} countsDown modifiers={[font({ weight, size: 28 })]} />
        </HStack>
        <Text>{props.nextLabel}</Text>
      </VStack>
    ),
    compactLeading: <Image systemName="timer" />,
    compactTrailing: <Text timerInterval={range} countsDown />,
    minimal: <Image systemName="timer" />,
    expandedLeading: <Image systemName="timer" />,
    expandedTrailing: <Text timerInterval={range} countsDown modifiers={[font({ weight, size: 24 })]} />,
    expandedBottom: <Text>{props.nextLabel}</Text>,
  };
};

let factory: LiveActivityFactory<RestCountdownProps> | null = null;

/** Created lazily so a build without the widget extension fails inside the probe, not at import. */
export function restCountdownActivity(): LiveActivityFactory<RestCountdownProps> {
  factory ??= createLiveActivity<RestCountdownProps>('RestCountdown', RestCountdown);
  return factory;
}
