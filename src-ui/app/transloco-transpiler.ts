import { Injectable } from '@angular/core';
import { TranspileParams } from '@jsverse/transloco';
import { MessageFormatTranspiler } from '@jsverse/transloco-messageformat';
import MessageFormat, { MessageFunction } from '@messageformat/core';
import { error } from '@tauri-apps/plugin-log';

// Must match fallbackLang in the Transloco config.
const FALLBACK_LANG = 'en';

@Injectable()
export class SafeMessageFormatTranspiler extends MessageFormatTranspiler {
  private readonly fallbackFormatter = new MessageFormat(FALLBACK_LANG);
  private readonly fallbackCache = new Map<string, MessageFunction<'string'>>();

  override transpile(params: TranspileParams) {
    try {
      return super.transpile(params);
    } catch {
      // Transloco compiles against the active language, so a message served from
      // the fallback language can use plural cases the active locale does not
      // have. Compiling it against the fallback language is what was meant.
      const fallback = this.transpileAsFallback(params);
      if (fallback !== undefined) return fallback;
      // Translations come from the community, so malformed ICU has to degrade to the raw
      // message instead of breaking the view it appears in.
      error(`[Transloco] Could not compile message for key "${params.key}"`);
      return params.value;
    }
  }

  private transpileAsFallback(params: TranspileParams): string | undefined {
    if (typeof params.value !== 'string') return undefined;
    try {
      let compiled = this.fallbackCache.get(params.value);
      if (!compiled) {
        compiled = this.fallbackFormatter.compile(params.value);
        this.fallbackCache.set(params.value, compiled);
      }
      return compiled(params.params as Record<string, unknown> | undefined);
    } catch {
      return undefined;
    }
  }
}
