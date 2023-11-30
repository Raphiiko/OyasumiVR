import { Component } from '@angular/core';
import { HotkeyId } from '../../../../models/settings';

interface HotkeyAction {
  id: HotkeyId;
}

@Component({
  selector: 'app-settings-hotkey-view',
  templateUrl: './settings-hotkey-view.component.html',
  styleUrls: ['./settings-hotkey-view.component.scss'],
})
export class SettingsHotkeyViewComponent {
  actions: HotkeyAction[] = [
    { id: 'HOTKEY_TOGGLE_SLEEP_MODE' },
    { id: 'HOTKEY_ENABLE_SLEEP_MODE' },
    { id: 'HOTKEY_DISABLE_SLEEP_MODE' },
    { id: 'HOTKEY_RUN_SLEEP_PREPARATION' },
    { id: 'HOTKEY_RUN_SHUTDOWN_SEQUENCE' },
  ];
}
