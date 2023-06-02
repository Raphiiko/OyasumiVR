import { Component } from '@angular/core';
import {
  ShutdownAutomationsService,
  ShutdownSequenceStage,
  ShutdownSequenceStageOrder,
} from 'src/app/services/shutdown-automations.service';
import { fade, vshrink } from 'src/app/utils/animations';
import { clamp } from 'src/app/utils/number-utils';

@Component({
  selector: 'app-shutdown-sequence-overlay',
  templateUrl: './shutdown-sequence-overlay.component.html',
  styleUrls: ['./shutdown-sequence-overlay.component.scss'],
  animations: [fade(), vshrink('vshrinkSlow', '.6s ease')],
})
export class ShutdownSequenceOverlayComponent {
  stages: ShutdownSequenceStage[] = [];
  currentStage: ShutdownSequenceStage = 'IDLE';
  canCancel = true;

  constructor(private shutdownAutomationsService: ShutdownAutomationsService) {
    shutdownAutomationsService.stage.subscribe((stage) => {
      this.stages = this.shutdownAutomationsService.getApplicableStages();
      this.currentStage = stage;
      if (this.currentStage === 'IDLE') this.canCancel = true;
    });
  }

  cancel() {
    this.shutdownAutomationsService.cancelSequence('MANUAL');
    this.canCancel = false;
  }

  getStageStyle(stage: ShutdownSequenceStage): any {
    const currentIndex = this.stages.indexOf(this.currentStage);
    const stageIndex = this.stages.indexOf(stage);
    const stageOffset = stageIndex - currentIndex;
    let opacity = 1;
    let blur = 0;
    switch (Math.abs(stageOffset)) {
      case 0:
        break;
      case 1:
        opacity = 0.3;
        blur = 1;
        break;
      case 2:
        opacity = 0.1;
        blur = 2;
        break;
      default:
        opacity = 0;
        break;
    }
    return {
      opacity,
      filter: 'blur(' + blur + 'px)',
      transform: 'translate(-50%, calc(-50% + ' + stageOffset * 1.75 + 'em))',
    };
  }
}
