import { Component, Input, Output, EventEmitter } from '@angular/core';
import { ModalService } from '../../services/modal.service';
import { NotificationSoundModalComponent } from '../notification-sound-modal/notification-sound-modal.component';
import { SoundEffectConfig } from '../../models/automations';
import { BehaviorSubject } from 'rxjs';
import { NotificationService } from '../../services/notification.service';

@Component({
  selector: 'app-notification-sound-button',
  templateUrl: './notification-sound-button.component.html',
  styleUrls: ['./notification-sound-button.component.scss'],
  standalone: false,
})
export class NotificationSoundButtonComponent {
  @Input() soundConfig?: SoundEffectConfig;
  @Input() label: string = '';
  @Input() description: string = '';
  @Input() toggleable: boolean = true;
  @Output() soundConfigChange = new EventEmitter<SoundEffectConfig>();

  public playingSound$ = new BehaviorSubject<boolean>(false);

  constructor(
    private modalService: ModalService,
    private notificationService: NotificationService
  ) {}

  public openSoundModal(): void {
    if (this.soundConfig) {
      this.modalService
        .addModal(NotificationSoundModalComponent, { soundConfig: { ...this.soundConfig } })
        .subscribe((result) => {
          if (result) {
            this.soundConfig = result.soundConfig;
            this.soundConfigChange.emit(this.soundConfig);
          }
        });
    }
  }

  public async previewSound(): Promise<void> {
    if (!this.soundConfig) return;

    // Play sound through notification service
    await this.notificationService.playSoundConfig(this.soundConfig);

    // Update the playing state
    this.playingSound$.next(true);

    // Reset the playing state after the sound finishes
    setTimeout(() => {
      this.playingSound$.next(false);
    }, this.soundConfig.sound.duration * 1000);
  }

  public toggleSound(): void {
    if (this.soundConfig) {
      this.soundConfig.enabled = !this.soundConfig.enabled;
      this.soundConfigChange.emit(this.soundConfig);
    }
  }
}
