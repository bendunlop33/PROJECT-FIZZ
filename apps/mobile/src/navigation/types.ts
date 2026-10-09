import type { NavigatorScreenParams } from '@react-navigation/native';

export type ProfileStackParams = {
  ProfileHome: undefined;
  DataBackup: undefined;
  AppStatus: undefined;
  Developer: undefined;
  CapabilityProbe: undefined;
};

export type TabParams = {
  Today: undefined;
  Progress: undefined;
  Profile: NavigatorScreenParams<ProfileStackParams> | undefined;
};

export type RootStackParams = {
  Setup: undefined;
  Tabs: NavigatorScreenParams<TabParams> | undefined;
  /** Placeholder until the next slice builds Active set / Rest / Summary. */
  Workout: undefined;
  AddGym: undefined;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParams {}
  }
}
