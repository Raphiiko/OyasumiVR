import { Component, OnInit } from '@angular/core';
import { getVersion } from '@tauri-apps/api/app';

@Component({
  selector: 'app-about-view',
  templateUrl: './about-view.component.html',
  styleUrls: ['./about-view.component.scss'],
})
export class AboutViewComponent implements OnInit {
  version?: string;

  constructor() {}

  async ngOnInit() {
    this.version = await getVersion();
  }
}
