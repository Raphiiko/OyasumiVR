import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { error } from '@tauri-apps/plugin-log';
import { TString } from '../models/translatable-string';
import { ToastService } from '../services/toast.service';

/** Copies text to the clipboard and shows a toast with the result. */
export async function copyWithToast(toasts: ToastService, text: string, message?: TString) {
  try {
    await writeText(text);
  } catch (e) {
    error(`[Clipboard] Could not copy to clipboard: ${e}`);
    toasts.show({ type: 'error', title: 'toasts.clipboard.failed' });
    return;
  }
  toasts.show({ type: 'success', title: 'toasts.clipboard.copied', message, duration: 3000 });
}
