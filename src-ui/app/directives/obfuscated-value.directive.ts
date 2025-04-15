import { AfterViewInit, Directive, ElementRef, Input, OnChanges } from '@angular/core';

@Directive({
    selector: '[obfuscatedValue]',
    standalone: false
})
export class ObfuscatedValueDirective implements AfterViewInit, OnChanges {
  @Input('obfuscatedValue') value?: string;
  @Input() deobfuscate?: boolean;
  @Input() obfuscatedMaxLength?: number;
  @Input() deobfuscatedMaxLength?: number;
  private afterViewInit = false;

  constructor(private elementRef: ElementRef) {}

  ngAfterViewInit() {
    this.afterViewInit = true;
    this.render();
  }

  ngOnChanges(): void {
    if (this.afterViewInit) this.render();
  }

  private render() {
    if (!this.afterViewInit) return;
    let value = this.value ?? '';
    if (!this.deobfuscate) {
      value = this.obfuscate(value);
    }
    if (this.obfuscatedMaxLength && !this.deobfuscate) {
      value = this.trimValue(value, this.obfuscatedMaxLength);
    } else if (this.deobfuscatedMaxLength && this.deobfuscate) {
      value = this.trimValue(value, this.deobfuscatedMaxLength);
    }
    this.elementRef.nativeElement.innerText = value;
  }

  private trimValue(value: string, maxLength: number) {
    if (value.length > maxLength) {
      value = value.substr(0, maxLength - 3) + '...';
    }
    return value;
  }

  private obfuscate(value?: string): string {
    if (!value) return '';
    // Check if value is email with regex
    if (value.match(/^[^@\s]+@[^@\s]+\.[^@\s]+$/)) {
      value = this.obfuscateEmail(value);
    } else if (value.length > 4) {
      value = value.substr(0, 2) + '*'.repeat(value.length - 4) + value.substr(value.length - 2);
    } else if (value.length > 2) {
      value = value.substr(0, 1) + '*'.repeat(value.length - 2) + value.substr(value.length - 1);
    } else {
      value = '*'.repeat(value.length);
    }
    return value;
  }

  private obfuscateEmail(email: string): string {
    try {
      const parts = email.split('@');
      const domainParts = parts[1].split('.');
      const domain = domainParts.length > 1 ? domainParts[0] : parts[1];
      const domainExt = domainParts.length > 1 ? domainParts[1] : '';
      const domainExtExt = domainParts.length > 2 ? domainParts[2] : '';
      return (
        parts[0].substr(0, 1) +
        '*'.repeat(parts[0].length - 2) +
        parts[0].substr(parts[0].length - 1) +
        '@' +
        domain.substr(0, 1) +
        '*'.repeat(domain.length - 2) +
        domain.substr(domain.length - 1) +
        '.' +
        domainExt.substr(0, 1) +
        '*'.repeat(domainExt.length - 2) +
        domainExt.substr(domainExt.length - 1) +
        (domainExtExt ? '.' + domainExtExt : '')
      );
    } catch (e) {
      return '***@***.***';
    }
  }
}
