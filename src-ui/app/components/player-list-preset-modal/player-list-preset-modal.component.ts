import { Component, DestroyRef, OnInit } from '@angular/core';
import { fadeUp, vshrink } from '../../utils/animations';
import { BaseModalComponent } from '../base-modal/base-modal.component';
import { PlayerListPreset } from '../../models/player-list-preset';
import { AppSettingsService } from '../../services/app-settings.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { v4 as uuidv4 } from 'uuid';
import { ConfirmModalComponent } from '../confirm-modal/confirm-modal.component';
import { ModalService } from '../../services/modal.service';

export interface PlayerListPresetModalInputModel {
  mode: 'load' | 'save';
  playerIds?: string[];
}

export interface PlayerListPresetModalOutputModel {
  playerIds?: string[];
}
@Component({
    selector: 'app-player-list-preset-modal',
    templateUrl: './player-list-preset-modal.component.html',
    styleUrls: ['./player-list-preset-modal.component.scss'],
    animations: [fadeUp(), vshrink()],
    standalone: false
})
export class PlayerListPresetModalComponent
  extends BaseModalComponent<PlayerListPresetModalInputModel, PlayerListPresetModalOutputModel>
  implements OnInit, PlayerListPresetModalInputModel
{
  mode: 'load' | 'save' = 'load';
  playerIds?: string[];
  lists: PlayerListPreset[] = [];
  saved = false;
  saveName = '';

  get validSaveName(): boolean {
    const name = this.sanitizedSaveName;
    return name.length > 0 && name.length <= 24 && /^[\p{Letter}\s\-.']+$/u.test(name);
  }

  get sanitizedSaveName(): string {
    return this.saveName.trim();
  }

  constructor(
    private appSettings: AppSettingsService,
    private destroyRef: DestroyRef,
    private modalService: ModalService
  ) {
    super();
  }

  public ngOnInit() {
    this.appSettings.settings.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((settings) => {
      this.lists = [...settings.playerListPresets];
    });
    if (this.mode === 'save' && !this.playerIds?.length) this.close();
  }

  protected saveNewPreset() {
    if (!this.validSaveName || this.saved) return;
    this.saved = true;
    const name = this.sanitizedSaveName;
    this.appSettings.updateSettings({
      playerListPresets: [
        ...this.lists,
        {
          id: uuidv4(),
          name,
          playerIds: this.playerIds ?? [],
        },
      ],
    });
    setTimeout(this.close.bind(this), 1000);
  }

  protected overwritePreset(preset: PlayerListPreset) {
    if (this.saved) return;
    this.modalService
      .addModal(ConfirmModalComponent, {
        title: 'comp.player-list-preset-modal.confirmOverwrite.title',
        message: {
          string: 'comp.player-list-preset-modal.confirmOverwrite.message',
          values: {
            name: preset.name,
          },
        },
        confirmButtonText: 'comp.player-list-preset-modal.overwrite',
      })
      .subscribe((data) => {
        if (data?.confirmed) {
          this.saved = true;
          this.appSettings.updateSettings({
            playerListPresets: this.lists.map((list) => {
              if (list.id === preset.id) {
                return {
                  ...list,
                  playerIds: this.playerIds ?? [],
                };
              }
              return list;
            }),
          });
          setTimeout(this.close.bind(this), 1000);
        }
      });
  }

  protected trackPresetBy(_index: number, item: PlayerListPreset) {
    return item.id;
  }

  protected deletePreset(preset: PlayerListPreset) {
    this.modalService
      .addModal(ConfirmModalComponent, {
        title: 'comp.player-list-preset-modal.confirmDelete.title',
        message: {
          string: 'comp.player-list-preset-modal.confirmDelete.message',
          values: {
            name: preset.name,
            count: preset.playerIds?.length,
          },
        },
        confirmButtonText: 'comp.player-list-preset-modal.delete',
      })
      .subscribe((data) => {
        if (data?.confirmed) {
          this.appSettings.updateSettings({
            playerListPresets: this.lists.filter((list) => list.id !== preset.id),
          });
        }
      });
  }

  protected loadPreset(preset: PlayerListPreset) {
    this.result = {
      playerIds: preset.playerIds,
    };
    this.close();
  }
}
