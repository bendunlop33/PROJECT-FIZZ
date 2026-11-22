import type { SymbolName } from '../ui/Icon';
import { Toast } from '../ui';
import type { DeleteToastState } from './useDeleteToast';

/**
 * The delete / restore toast as every screen shows it: with its action, the
 * VoiceOver escape gesture, and a close button while VoiceOver keeps it up
 * (review S3).
 */
export function DeleteToastView({ state, icon = 'trash' }: { state: DeleteToastState; icon?: SymbolName }) {
  const t = state.toast;
  if (!t) return null;
  return (
    <Toast
      icon={icon}
      text={t.text}
      {...(t.action ? { action: t.action } : {})}
      {...(t.onAction ? { onAction: t.onAction } : {})}
      onDismiss={state.dismiss}
      showClose={state.persistent}
    />
  );
}
