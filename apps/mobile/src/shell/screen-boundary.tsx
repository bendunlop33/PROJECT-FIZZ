import { useNavigation } from '@react-navigation/native';
import type { ComponentType } from 'react';

import { popToToday } from '../navigation/actions';
import { AppBoundary, AppErrorScreen } from './SafeStart';

/**
 * (Hang fix, 27 Oct) A full-screen modal's own error boundary. Build 457 had only the app-wide one: a render error in
 * the workout (a native full-screen modal) unmounted the navigator under the presented modal, which stayed on top,
 * blank, with no way out; the error screen was hidden behind it. Here the error shows inside the modal, with Today
 * (and the backup copy), and the run is held unsettled so the next launch is a safe start naming the error.
 */
export function withScreenBoundary<P extends object>(Screen: ComponentType<P>, name: string): ComponentType<P> {
  function Guarded(props: P) {
    const navigation = useNavigation();
    return (
      <AppBoundary
        name={name}
        onReset={() => undefined}
        fallback={(error) => (
          <AppErrorScreen
            error={error}
            onToday={() => {
              navigation.dispatch(popToToday());
            }}
          />
        )}
      >
        <Screen {...props} />
      </AppBoundary>
    );
  }
  Guarded.displayName = `Guarded(${name})`;
  return Guarded;
}
