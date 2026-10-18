import {
  ChangeDetectorRef,
  Component,
  DestroyRef,
  OnInit,
  ChangeDetectionStrategy,
  input,
  model,
} from '@angular/core';
import { SelectBoxItem } from '../../../../../components/select-box/select-box.component';
import { DomSanitizer } from '@angular/platform-browser';
import { ModalService } from '../../../../../services/modal.service';
import {
  AudioDevicePickerComponent,
  AudioDevicePickerInput,
  AudioDevicePickerOutput,
} from '../audio-device-picker/audio-device-picker.component';
import { vshrink } from '../../../../../utils/animations';
import { filter } from 'rxjs';
import { AudioDeviceService } from '../../../../../services/audio-device.service';
import {
  AudioVolumeAutomation,
  AudioVolumeAutomationType,
  SetAudioVolumeAutomation,
} from 'src-ui/app/models/automations';

@Component({
  selector: 'app-audio-volume-entries',
  templateUrl: './audio-volume-entries.component.html',
  styleUrls: ['./audio-volume-entries.component.scss'],
  animations: [vshrink()],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class AudioVolumeEntriesComponent implements OnInit {
  readonly automationType = input<'onSleepEnable' | 'onSleepDisable' | 'onSleepPreparation'>();
  /** Entries are edited in place, so each change sets a new array for the model to emit. */
  readonly automations = model<AudioVolumeAutomation[]>([]);
  collapsed = true;

  protected actionOptions: SelectBoxItem<AudioVolumeAutomationType>[] = [
    {
      id: 'SET_VOLUME',
      label: 'audio-volume-automations.actionOptions.SET_VOLUME',
      htmlPrefix: this.domSanitizer.bypassSecurityTrustHtml(
        '<svg class="svg-icon" style="margin-right: 0.5em"><use href="/assets/icons/volume.svg#icon"/></svg>'
      ),
    },
    {
      id: 'MUTE',
      label: 'audio-volume-automations.actionOptions.MUTE',
      htmlPrefix: this.domSanitizer.bypassSecurityTrustHtml(
        '<svg class="svg-icon" style="margin-right: 0.5em"><use href="/assets/icons/volume-off.svg#icon"/></svg>'
      ),
    },
    {
      id: 'UNMUTE',
      label: 'audio-volume-automations.actionOptions.UNMUTE',
      htmlPrefix: this.domSanitizer.bypassSecurityTrustHtml(
        '<svg class="svg-icon" style="margin-right: 0.5em"><use href="/assets/icons/volume-down.svg#icon"/></svg>'
      ),
    },
  ];

  constructor(
    private domSanitizer: DomSanitizer,
    private modalService: ModalService,
    private audioDeviceService: AudioDeviceService,
    private destroyRef: DestroyRef,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {}

  setVolume(automation: SetAudioVolumeAutomation, volume: number) {
    automation.volume = volume;
    this.automations.set([...this.automations()]);
  }

  getActionOptionForType(type: 'MUTE' | 'UNMUTE' | 'SET_VOLUME') {
    return this.actionOptions.find((option) => option.id === type);
  }

  setAutomationType(automation: AudioVolumeAutomation, type?: string) {
    if (!type) return;
    automation.type = type as AudioVolumeAutomationType;
    switch (type) {
      case 'SET_VOLUME': {
        const setVolumeAutomation = automation as SetAudioVolumeAutomation;
        setVolumeAutomation.volume = 100;
        break;
      }
      case 'MUTE':
      case 'UNMUTE':
        if (automation.type === 'SET_VOLUME') {
          delete (automation as any).volume;
        }
        break;
    }
    this.automations.set([...this.automations()]);
  }

  addAudioDevice() {
    this.modalService
      .addModal<AudioDevicePickerInput, AudioDevicePickerOutput>(
        AudioDevicePickerComponent,
        {
          disablePersistentIds: this.automations().map((a) => a.audioDeviceRef.persistentId),
        },
        {
          wrapperDefaultClass: 'modal-wrapper-audio-device-picker',
        }
      )
      .pipe(filter(Boolean))
      .subscribe((res) => {
        this.automations.set([
          ...this.automations(),
          {
            type: 'SET_VOLUME',
            volume: Math.round(res.device.volume * 100),
            applyOnStart: true,
            audioDeviceRef: {
              persistentId: res.device.persistentId!,
              type: res.device.deviceType,
              name: res.device.parsedName!,
            },
          },
        ]);
        this.collapsed = false;
        this.cdr.markForCheck();
      });
  }

  removeAutomation(automation: AudioVolumeAutomation) {
    this.automations.set(this.automations().filter((a) => a !== automation));
    if (!this.automations().length) this.collapsed = true;
  }

  trackAutomationBy(index: number, automation: AudioVolumeAutomation) {
    return automation.audioDeviceRef.persistentId;
  }

  toggleApplyOnStart(automation: AudioVolumeAutomation) {
    automation.applyOnStart = !automation.applyOnStart;
    this.automations.set([...this.automations()]);
  }
}
