import { Component, DestroyRef, EventEmitter, Input, OnInit, Output } from '@angular/core';
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
})
export class AudioVolumeEntriesComponent implements OnInit {
  @Input() automations: AudioVolumeAutomation[] = [];
  @Output() automationsChange: EventEmitter<AudioVolumeAutomation[]> = new EventEmitter();
  collapsed = true;

  protected actionOptions: SelectBoxItem<AudioVolumeAutomationType>[] = [
    {
      id: 'SET_VOLUME',
      label: 'audio-volume-automations.actionOptions.SET_VOLUME',
      htmlPrefix: this.domSanitizer.bypassSecurityTrustHtml(
        '<i class="material-icons-round" style="margin-right: 0.5em">volume_up</i>'
      ),
    },
    {
      id: 'MUTE',
      label: 'audio-volume-automations.actionOptions.MUTE',
      htmlPrefix: this.domSanitizer.bypassSecurityTrustHtml(
        '<i class="material-icons-round" style="margin-right: 0.5em">volume_off</i>'
      ),
    },
    {
      id: 'UNMUTE',
      label: 'audio-volume-automations.actionOptions.UNMUTE',
      htmlPrefix: this.domSanitizer.bypassSecurityTrustHtml(
        '<i class="material-icons-round" style="margin-right: 0.5em">volume_down</i>'
      ),
    },
  ];

  constructor(
    private domSanitizer: DomSanitizer,
    private modalService: ModalService,
    private audioDeviceService: AudioDeviceService,
    private destroyRef: DestroyRef
  ) {}

  ngOnInit() {}

  setVolume(automation: SetAudioVolumeAutomation, volume: number) {
    automation.volume = volume;
    this.automationsChange.emit(this.automations);
  }

  getActionOptionForType(type: 'MUTE' | 'UNMUTE' | 'SET_VOLUME') {
    return this.actionOptions.find((option) => option.id === type);
  }

  setAutomationType(automation: AudioVolumeAutomation, type?: string) {
    if (!type) return;
    const previousType = automation.type;
    automation.type = type as AudioVolumeAutomationType;
    switch (type) {
      case 'SET_VOLUME':
        const setVolumeAutomation = automation as SetAudioVolumeAutomation;
        setVolumeAutomation.volume = 100;
        break;
      case 'MUTE':
      case 'UNMUTE':
        if (automation.type === 'SET_VOLUME') {
          delete (automation as any).volume;
        }
        break;
    }
    this.automationsChange.emit(this.automations);
  }

  addAudioDevice() {
    console.log(this.automations.map((a) => a.audioDeviceRef.persistentId));
    this.modalService
      .addModal<AudioDevicePickerInput, AudioDevicePickerOutput>(
        AudioDevicePickerComponent,
        {
          disablePersistentIds: this.automations.map((a) => a.audioDeviceRef.persistentId),
        },
        {
          wrapperDefaultClass: 'modal-wrapper-audio-device-picker',
        }
      )
      .pipe(filter(Boolean))
      .subscribe((res) => {
        this.automations.push({
          type: 'SET_VOLUME',
          volume: Math.round(res.device.volume * 100),
          audioDeviceRef: {
            persistentId: res.device.persistentId!,
            type: res.device.deviceType,
            name: res.device.parsedName!,
          },
        });
        this.collapsed = false;
        this.automationsChange.emit(this.automations);
      });
  }

  removeAutomation(automation: AudioVolumeAutomation) {
    this.automations = this.automations.filter((a) => a !== automation);
    this.automationsChange.emit(this.automations);
    if (!this.automations.length) this.collapsed = true;
  }

  trackAutomationBy(index: number, automation: AudioVolumeAutomation) {
    return automation.audioDeviceRef.persistentId;
  }
}
