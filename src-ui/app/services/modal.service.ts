import {
  ApplicationRef,
  ComponentFactoryResolver,
  ComponentRef,
  EmbeddedViewRef,
  Injectable,
  Injector,
  Type,
} from '@angular/core';
import { BaseModalComponent } from '../components/base-modal/base-modal.component';
import { delay, filter, fromEvent, map, Observable, of, switchMap, take, tap } from 'rxjs';

export interface ModalOptions {
  closeOnEscape: boolean;
  animationDuration: number;
  wrapperDefaultClass: string;
  wrapperClass: string;
  id?: string;
}

const DEFAULT_MODAL_OPTIONS = {
  closeOnEscape: true,
  animationDuration: 300,
  wrapperDefaultClass: 'modal-wrapper',
  wrapperClass: 'in',
};

interface ModalRef {
  componentRef: ComponentRef<BaseModalComponent<{ [k: string]: any } | void, any>>;
  options: ModalOptions;
}

@Injectable({
  providedIn: 'root',
})
export class ModalService {
  private modalStack: ModalRef[] = [];

  constructor(
    private componentFactoryResolver: ComponentFactoryResolver,
    private appRef: ApplicationRef,
    private injector: Injector
  ) {
    fromEvent<KeyboardEvent>(document, 'keyup')
      .pipe(filter((event) => event.key === 'Escape'))
      .subscribe(() => this.onEscapeKeyUp());
  }

  onEscapeKeyUp() {
    if (!this.modalStack.length) return;
    const topModal = this.modalStack[this.modalStack.length - 1];
    if (!topModal.options.closeOnEscape) return;
    topModal.componentRef.instance.close();
  }

  closeModal(id: string) {
    const modalRef = this.modalStack.find((m) => m.options.id === id);
    if (!modalRef) return;
    modalRef.componentRef.instance.close();
  }

  addModal<ModalInput extends { [k: string]: any } | void = any, ModalOutput = any>(
    modalComponent: Type<BaseModalComponent<ModalInput, ModalOutput>>,
    input?: ModalInput,
    customOptions: Partial<ModalOptions> = {}
  ): Observable<ModalOutput> {
    const options: ModalOptions = { ...DEFAULT_MODAL_OPTIONS, ...(customOptions ?? {}) };
    // Create component
    const componentRef = this.componentFactoryResolver
      .resolveComponentFactory(modalComponent)
      .create(this.injector);
    this.appRef.attachView(componentRef.hostView);
    const domElem = (componentRef.hostView as EmbeddedViewRef<any>).rootNodes[0] as HTMLElement;
    document.body.appendChild(domElem);
    // Update options
    Object.assign(options, componentRef.instance?.getOptionsOverride() ?? {});
    // Add to stack
    const modalRef = { componentRef, options };
    this.modalStack.push(modalRef);
    // Set modal wrapper classes
    domElem.classList.add(options.wrapperDefaultClass);
    // Set inputs
    const instance: any = componentRef.instance;
    Object.assign(instance, input ?? {});
    // Apply wrapper class after a tick
    return of(null).pipe(
      delay(1),
      tap(() => domElem.classList.add(options.wrapperClass)),
      delay(options.animationDuration),
      // Wait for close signal
      switchMap(
        () =>
          instance.close$.pipe(
            take(1),
            // Remove modal from stack
            tap(() => {
              this.modalStack = this.modalStack.filter((m) => m !== modalRef);
            }),
            // Get the result
            map(() => instance.result),
            // Remove the wrapper class (for animating out)
            tap(() => {
              domElem.classList.remove(options.wrapperClass);
            }),
            // Wait for animation to complete
            delay(options.animationDuration),
            // Remove component from DOM
            tap(() => {
              this.appRef.detachView(componentRef.hostView);
              componentRef.destroy();
            })
          ) as Observable<ModalOutput>
      )
    );
  }
}
