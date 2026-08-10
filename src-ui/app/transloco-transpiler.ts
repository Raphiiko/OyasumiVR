import { Injectable } from '@angular/core';
import { TranspileParams } from '@jsverse/transloco';
import { MessageFormatTranspiler } from '@jsverse/transloco-messageformat';
import { error } from '@tauri-apps/plugin-log';

@Injectable()
export class SafeMessageFormatTranspiler extends MessageFormatTranspiler {
  override transpile(params: TranspileParams) {
    try {
      return super.transpile(params);
    } catch (e) {
      // Translations come from the community, so malformed ICU has to degrade to the raw
      // message instead of breaking the view it appears in.
      error(`[Transloco] Could not compile message for key "${params.key}": ${e}`);
      return params.value;
    }
  }
}
