import { Component } from '@angular/core';
import { PulsoidService } from '../../../services/integrations/pulsoid.service';

@Component({
  selector: 'app-debug-pulsoid-testing',
  templateUrl: './debug-pulsoid-testing.component.html',
  styleUrls: ['./debug-pulsoid-testing.component.scss'],
})
export class DebugPulsoidTestingComponent {
  constructor(protected pulsoid: PulsoidService) {}
}
