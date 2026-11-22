import { useNavigation } from '@react-navigation/native';

import { useScreenData } from '../shell/context';
import { Screen } from '../ui';
import { GymSetupFlow } from './setup/GymSetupFlow';

/** `Add gym` from Today's no-gym banner: the onboarding gym step until the gym editor exists. */
export function AddGymScreen() {
  const navigation = useNavigation();
  const [profile] = useScreenData((s) => s.yourData.profile());
  const [gyms] = useScreenData((s) => s.yourData.gyms());
  if (profile.state !== 'ready' || gyms.state !== 'ready') return <Screen>{null}</Screen>;
  const close = () => {
    navigation.goBack();
  };
  return <GymSetupFlow unit={profile.value?.preferredUnit ?? 'kg'} step={null} firstGym={gyms.value.length === 0} onBack={close} onSaved={close} />;
}
