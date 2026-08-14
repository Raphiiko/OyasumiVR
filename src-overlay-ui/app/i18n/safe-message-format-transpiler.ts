import { Injectable } from '@angular/core';
import { TranspileParams } from '@jsverse/transloco';
import { MessageFormatTranspiler } from '@jsverse/transloco-messageformat';
import MessageFormat, { MessageFunction } from '@messageformat/core';
import { FALLBACK_LOCALE } from './locales';

@Injectable()
export class SafeMessageFormatTranspiler extends MessageFormatTranspiler {
  private readonly fallbackFormatter = new MessageFormat(FALLBACK_LOCALE);
  private readonly fallbackCache = new Map<string, MessageFunction<'string'>>();

  override transpile(params: TranspileParams) {
    try {
      return super.transpile(params);
    } catch {
      // A message served from the fallback language can use plural cases the active locale lacks.
      const fallback = this.transpileAsFallback(params);
      if (fallback !== undefined) return fallback;
      console.error(`Could not compile message for key "${params.key}"`);
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
