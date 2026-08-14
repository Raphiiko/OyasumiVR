import { Injectable } from '@angular/core';
import { TranspileParams } from '@jsverse/transloco';
import { MessageFormatTranspiler } from '@jsverse/transloco-messageformat';

@Injectable()
export class SafeMessageFormatTranspiler extends MessageFormatTranspiler {
  override transpile(params: TranspileParams) {
    try {
      return super.transpile(params);
    } catch {
      // community translations can contain malformed ICU
      return params.value;
    }
  }
}
