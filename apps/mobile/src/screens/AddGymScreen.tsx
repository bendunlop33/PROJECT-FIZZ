import { useNavigation } from '@react-navigation/native';

import { useScreenData } from '../shell/context';
import { Screen } from '../ui';
import { GymSetupFlow } from './setup/GymSetupFlow';

/** `Add gym` from Today's no-gym banner: the onboarding gym step until the gym editor exists. */
export function AddGymScreen() {
  const navigation = useNavigation();
  const [profile] = useScreenData((s) => s.yourData.profile());
  if (profile.state !== 'ready') return <Screen>{null}</Screen>;
  const close = () => {
    navigation.goBack();
  };
  return <GymSetupFlow unit={profile.value?.preferredUnit ?? 'kg'} step={null} onBack={close} onSaved={close} />;
}
