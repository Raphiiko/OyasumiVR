import { ChangeDetectorRef, Component, ChangeDetectionStrategy, input, model } from '@angular/core';
import { ModalService } from '../../services/modal.service';
import { NotificationSoundModalComponent } from '../notification-sound-modal/notification-sound-modal.component';
import { SoundEffectConfig } from '../../models/automations';
import { BehaviorSubject } from 'rxjs';
import { NotificationService } from '../../services/notification.service';

@Component({
  selector: 'app-notification-sound-button',
  templateUrl: './notification-sound-button.component.html',
  styleUrls: ['./notification-sound-button.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class NotificationSoundButtonComponent {
  readonly soundConfig = model.required<SoundEffectConfig>();
  readonly label = input<string>('');
  readonly description = input<string>('');
  readonly toggleable = input<boolean>(true);

  public playingSound$ = new BehaviorSubject<boolean>(false);

  constructor(
    private modalService: ModalService,
    private notificationService: NotificationService,
    private cdr: ChangeDetectorRef
  ) {}

  public openSoundModal(): void {
    const soundConfig = this.soundConfig();
    if (soundConfig) {
      this.modalService
        .addModal(NotificationSoundModalComponent, { soundConfig: { ...soundConfig } })
        .subscribe((result) => {
          if (result) {
            this.soundConfig.set(result.soundConfig);
            this.cdr.markForCheck();
          }
        });
    }
  }

  public async previewSound(): Promise<void> {
    const soundConfig = this.soundConfig();
    if (!soundConfig) return;

    // Play sound through notification service
    await this.notificationService.playSoundConfig(soundConfig);

    // Update the playing state
    this.playingSound$.next(true);

    // Reset the playing state after the sound finishes
    setTimeout(() => {
      this.playingSound$.next(false);
    }, soundConfig.sound.duration * 1000);
  }

  public toggleSound(): void {
    const soundConfig = this.soundConfig();
    if (soundConfig) {
      this.soundConfig.set({ ...soundConfig, enabled: !soundConfig.enabled });
    }
  }
}
