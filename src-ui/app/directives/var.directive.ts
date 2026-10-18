import { Directive, OnInit, TemplateRef, ViewContainerRef, input } from '@angular/core';

@Directive({
  selector: '[ngVar]',
  standalone: false,
})
export class VarDirective implements OnInit {
  readonly ngVar = input<unknown>();

  constructor(
    private templateRef: TemplateRef<any>,
    private vcRef: ViewContainerRef
  ) {}

  ngOnInit() {
    const ngVar = this.ngVar;
    // the embedded view reads its context on every refresh, so getters keep it current
    this.vcRef.createEmbeddedView(this.templateRef, {
      get $implicit() {
        return ngVar();
      },
      get ngVar() {
        return ngVar();
      },
    });
  }
}
