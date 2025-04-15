import { Component, DestroyRef, OnInit } from '@angular/core';
import { BaseModalComponent } from '../base-modal/base-modal.component';
import { MqttService } from '../../services/mqtt/mqtt.service';
import { AppSettingsService } from '../../services/app-settings.service';

import { APP_SETTINGS_DEFAULT } from '../../models/settings';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { fadeUp, hshrink, vshrink } from '../../utils/animations';
import pMinDelay from 'p-min-delay';
import { error } from 'tauri-plugin-log-api';

@Component({
    selector: 'app-mqtt-config-modal',
    templateUrl: './mqtt-config-modal.component.html',
    styleUrls: ['./mqtt-config-modal.component.scss'],
    animations: [fadeUp(), hshrink(), vshrink()],
    standalone: false
})
export class MqttConfigModalComponent extends BaseModalComponent<void, void> implements OnInit {
  config = MqttService.mapAppSettingsToMqttConfig(structuredClone(APP_SETTINGS_DEFAULT));
  testResult: 'idle' | 'testing' | 'success' | 'error' = 'idle';
  testError = '';

  get validConfig(): boolean {
    if (!this.config.enabled) return true;
    // Do rest of validation
    if (!this.config.host?.trim()) return false;
    if (!this.config.port || this.config.port <= 0 || this.config.port >= 65535) return false;
    return true;
  }

  constructor(
    private appSettings: AppSettingsService,
    private mqtt: MqttService,
    private destroyRef: DestroyRef
  ) {
    super();
  }

  ngOnInit() {
    this.appSettings.settings.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((config) => {
      this.config = MqttService.mapAppSettingsToMqttConfig(config);
    });
  }

  save() {
    if (!this.validConfig) return;
    this.appSettings.updateSettings({
      mqttEnabled: this.config.enabled,
      mqttHost: this.config.host?.trim() ?? null,
      mqttPort: this.config.port ?? null,
      mqttUsername: this.config.username?.trim() ?? null,
      mqttPassword: this.config.password?.trim() ?? null,
      mqttSecureSocket: this.config.secureSocket,
    });
    this.close();
  }

  cancel() {
    this.close();
  }

  async testConnection() {
    if (!this.validConfig || this.testResult === 'testing') return;
    this.testResult = 'testing';
    try {
      const couldConnect = await pMinDelay(this.mqtt.testMqttConfig(this.config), 500);
      this.testResult = couldConnect ? 'success' : 'error';
      this.testError = '';
    } catch (e) {
      this.testError = `${e}`;
      this.testResult = 'error';
    }
  }

  protected readonly error = error;
}
