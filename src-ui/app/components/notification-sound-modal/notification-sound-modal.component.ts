import { Component, OnInit } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { BUILT_IN_NOTIFICATION_SOUNDS, NotificationSound } from '../../models/notification-sounds';
import { SoundEffectConfig } from '../../models/automations';
import { BaseModalComponent } from '../base-modal/base-modal.component';
import { fadeUp } from '../../utils/animations';
import { NotificationService } from '../../services/notification.service';

export interface NotificationSoundModalInputModel {
  soundConfig: SoundEffectConfig;
}

export interface NotificationSoundModalOutputModel {
  soundConfig: SoundEffectConfig;
}

@Component({
  selector: 'app-notification-sound-modal',
  templateUrl: './notification-sound-modal.component.html',
  styleUrls: ['./notification-sound-modal.component.scss'],
  animations: [fadeUp()],
  standalone: false,
})
export class NotificationSoundModalComponent
  extends BaseModalComponent<NotificationSoundModalInputModel, NotificationSoundModalOutputModel>
  implements OnInit, NotificationSoundModalInputModel
{
  public soundConfig!: SoundEffectConfig;
  protected availableSounds = BUILT_IN_NOTIFICATION_SOUNDS.filter(
    (sound) => sound.userConfigurable
  );
  protected playingSounds$ = new BehaviorSubject<string[]>([]);

  constructor(private notificationService: NotificationService) {
    super();
  }

  ngOnInit(): void {
    // Create a copy of the soundConfig to avoid modifying the original
    this.soundConfig = { ...this.soundConfig };
  }

  public selectSound(sound: NotificationSound): void {
    this.soundConfig.sound = sound;
  }

  public setVolume(volume: number): void {
    this.soundConfig.volume = volume;
  }

  public async playSound(sound: NotificationSound): Promise<void> {
    console.warn(sound);
    if (this.playingSounds$.value.includes(sound.id)) {
      return;
    }

    this.playingSounds$.next([...this.playingSounds$.value, sound.id]);

    // Play sound through notification service
    await this.notificationService.playSound(sound, this.soundConfig.volume / 100);

    // Reset the playing state after the sound finishes
    setTimeout(() => {
      this.playingSounds$.next(this.playingSounds$.value.filter((id) => id !== sound.id));
    }, sound.duration * 1000);
  }

  public save(): void {
    this.result = { soundConfig: this.soundConfig };
    this.close();
  }

  public cancel(): void {
    this.close();
  }
}
