import { Injectable } from '@angular/core';
import { SleepModeMqttIntegrationService } from './integrations/sleep-mode.mqtt-integration.service';
import { SleepPreparationMqttIntegrationService } from './integrations/sleep-preparation.mqtt-integration.service';
import { BaseStationMqttIntegrationService } from './integrations/base-station.mqtt-integration.service';
import { TrackerControllerMqttIntegrationService } from './integrations/tracker-controller.mqtt-integration';
import { HMDDataMqttIntegrationService } from './integrations/hmd-data.mqtt-integration';
import { SleepingPositionMqttIntegrationService } from './integrations/sleeping-position.mqtt-integration.service';
import { ProcessActiveMqttIntegrationService } from './integrations/process-active.mqtt-integration.service';
import { VRChatMqttIntegrationService } from './integrations/vrchat.mqtt-integration.service';
import { BrightnessMqttIntegrationService } from './integrations/brightness.mqtt-integration.service';
import { BigscreenBeyondMqttIntegrationService } from './integrations/bigscreen-beyond.mqtt-integration.service';
import { HeartRateMqttIntegrationService } from './integrations/heart-rate.mqtt-integration.service';
import { ShutdownSequenceMqttIntegrationService } from './integrations/shutdown-sequence.mqtt-integration.service';

@Injectable({
  providedIn: 'root',
})
export class MqttIntegrationService {
  constructor(
    private sleepModeMqttIntegrationService: SleepModeMqttIntegrationService,
    private sleepPreparationMqttIntegrationService: SleepPreparationMqttIntegrationService,
    private baseStationMqttIntegrationService: BaseStationMqttIntegrationService,
    private trackerControllerMqttIntegrationService: TrackerControllerMqttIntegrationService,
    private hmdDataMqttIntegrationService: HMDDataMqttIntegrationService,
    private sleepingPositionMqttIntegrationService: SleepingPositionMqttIntegrationService,
    private processActiveMqttIntegrationService: ProcessActiveMqttIntegrationService,
    private vrchatMqttIntegrationService: VRChatMqttIntegrationService,
    private brightnessMqttIntegrationService: BrightnessMqttIntegrationService,
    private bsbMqttIntegrationService: BigscreenBeyondMqttIntegrationService,
    private heartRateMqttIntegrationService: HeartRateMqttIntegrationService,
    private shutdownSequenceMqttIntegrationService: ShutdownSequenceMqttIntegrationService
  ) {}

  async init() {
    await Promise.all([
      this.sleepModeMqttIntegrationService.init(),
      this.sleepPreparationMqttIntegrationService.init(),
      this.baseStationMqttIntegrationService.init(),
      this.trackerControllerMqttIntegrationService.init(),
      this.hmdDataMqttIntegrationService.init(),
      this.sleepingPositionMqttIntegrationService.init(),
      this.processActiveMqttIntegrationService.init(),
      this.vrchatMqttIntegrationService.init(),
      this.brightnessMqttIntegrationService.init(),
      this.bsbMqttIntegrationService.init(),
      this.heartRateMqttIntegrationService.init(),
      this.shutdownSequenceMqttIntegrationService.init(),
    ]);
  }
}
