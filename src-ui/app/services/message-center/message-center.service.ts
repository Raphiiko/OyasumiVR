import { Injectable } from '@angular/core';
import { BehaviorSubject, combineLatest, distinctUntilChanged, map } from 'rxjs';
import { AppSettingsService } from '../app-settings.service';
import { isEqual } from 'lodash';
import { VRChatLogMessageMonitor } from './monitors/vrchat-log-message-monitor';
import { MessageMonitor } from './monitors/message-monitor';
import { ModalService } from '../modal.service';
import { MessageCenterModalComponent } from 'src-ui/app/components/message-center-modal/message-center-modal.component';
import { SleepCalibrationMessageMonitor } from './monitors/sleep-calibration-message-monitor';
import { ManyLighthousesDetectedMessageMonitor } from './monitors/many-lighthouses-detected-message-monitor';
import { GpuAutomationMessageMonitor } from './monitors/gpu-automation-message-monitor';
import { LighthouseConsoleMonitor } from './monitors/lighthouse-console-monitor';
import { TString } from 'src-ui/app/models/translatable-string';

export interface MessageAction {
  label: string;
  action: () => any;
}

export interface MessageItem {
  id: string;
  title: TString;
  message: TString;
  actions: MessageAction[];
  hideable: boolean;
  type: 'info' | 'warning' | 'error';
}

@Injectable({
  providedIn: 'root',
})
export class MessageCenterService {
  private monitors: MessageMonitor[];
  public readonly hiddenMessageIds = this.appSettingsService.settings.pipe(
    map((settings) => [...settings.hiddenMessageIds]),
    distinctUntilChanged((a, b) => isEqual(a, b))
  );

  private readonly _messages = new BehaviorSubject<MessageItem[]>([]);
  public readonly messages = combineLatest([this._messages, this.hiddenMessageIds]).pipe(
    map(([messages, hiddenIds]) => messages.filter((message) => !hiddenIds.includes(message.id)))
  );
  public readonly hiddenMessages = combineLatest([this._messages, this.hiddenMessageIds]).pipe(
    map(([messages, hiddenIds]) => messages.filter((message) => hiddenIds.includes(message.id)))
  );

  constructor(
    private appSettingsService: AppSettingsService,
    private modalService: ModalService
  ) {
    this.monitors = [
      new VRChatLogMessageMonitor(this),
      new SleepCalibrationMessageMonitor(this),
      new ManyLighthousesDetectedMessageMonitor(this),
      new GpuAutomationMessageMonitor(this),
      new LighthouseConsoleMonitor(this),
    ];
  }

  public async init() {
    await Promise.all(this.monitors.map((monitor) => monitor.init()));
  }

  public async toggle() {
    if (this.modalService.isModalOpen('message-center')) {
      this.modalService.closeModal('message-center');
    } else {
      this.modalService
        .addModal(
          MessageCenterModalComponent,
          {},
          {
            id: 'message-center',
            wrapperDefaultClass: 'modal-wrapper-message-center',
            closeOnEscape: true,
          }
        )
        .subscribe();
    }
  }

  public addMessage(message: MessageItem) {
    let messages = this._messages.value.filter((m) => m.id !== message.id);
    messages = [...messages, message];
    this._messages.next(messages);
  }

  public removeMessage(id: string) {
    const messages = this._messages.value.filter((message) => message.id !== id);
    if (messages.length !== this._messages.value.length) {
      this._messages.next(messages);
    }
  }

  public hideMessageId(id: string) {
    const settings = this.appSettingsService.settingsSync;
    const hiddenMessageIds = [...settings.hiddenMessageIds];
    if (!hiddenMessageIds.includes(id)) {
      hiddenMessageIds.push(id);
      this.appSettingsService.updateSettings({ hiddenMessageIds });
    }
  }

  public unhideMessageId(id: string) {
    const settings = this.appSettingsService.settingsSync;
    const hiddenMessageIds = [...settings.hiddenMessageIds].filter((messageId) => messageId !== id);
    if (hiddenMessageIds.length !== settings.hiddenMessageIds.length) {
      this.appSettingsService.updateSettings({ hiddenMessageIds });
    }
  }
}

/*
VRChat logs unavailable

Although VRChat seems to be running, its log files could not be detected. 
Without these logs certain OyasumiVR features like automatically accepting invite requests will not work.
Please make sure you've got logging enabled within VRChat.

Actions:
- More Info -> Web link
- Hide

---

Sleep Detection Calibration Pending

Before using sleep detection, you should calibrate at least once to improve its accuracy.

Actions:
- Calibrate Now -> Open calibration modal
- Open Settings -> Sleep Detection Settings
- Hide

---

Administrator Privileges Required

You have automations configured that require administrative privileges to work, which are not currently granted.

Actions:
- Request Privileges
- Hide

---

Auto Accepting Invite Requests Unavailable

As in VRChat you are currently on "Busy" status, you won't be able to receive invite requests for OyasumiVR to accept.

Actions:
- Hide

---

Many base stations detected



*/
