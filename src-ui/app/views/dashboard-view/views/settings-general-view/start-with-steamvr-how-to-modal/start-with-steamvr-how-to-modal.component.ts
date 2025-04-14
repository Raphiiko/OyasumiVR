import { Component, OnInit } from '@angular/core';
import { BaseModalComponent } from 'src-ui/app/components/base-modal/base-modal.component';
import { fadeUp } from 'src-ui/app/utils/animations';

@Component({
    selector: 'app-start-with-steamvr-how-to-modal',
    templateUrl: './start-with-steamvr-how-to-modal.component.html',
    styleUrls: ['./start-with-steamvr-how-to-modal.component.scss'],
    animations: [fadeUp()],
    standalone: false
})
export class StartWithSteamVRHowToModalComponent
  extends BaseModalComponent<void, void>
  implements OnInit
{
  constructor() {
    super();
  }

  ngOnInit(): void {}

  close() {
    super.close();
  }
}
