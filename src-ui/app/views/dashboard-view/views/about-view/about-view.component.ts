import { Component, OnDestroy, OnInit } from '@angular/core';
import { getVersion } from '../../../../utils/app-utils';
import { BackgroundService } from '../../../../services/background.service';
import { BUILD_ID, FLAVOUR } from '../../../../../build';

@Component({
  selector: 'app-about-view',
  templateUrl: './about-view.component.html',
  styleUrls: ['./about-view.component.scss'],
})
export class AboutViewComponent implements OnInit, OnDestroy {
  protected readonly FLAVOUR = FLAVOUR;

  version?: string;

  constructor(private background: BackgroundService) {}

  async ngOnInit() {
    this.version = await getVersion();
    this.background.setBackground('/assets/img/about_bg.jpg');
  }

  async ngOnDestroy() {
    this.background.setBackground(null);
  }

  protected readonly BUILD_ID = BUILD_ID;
}
