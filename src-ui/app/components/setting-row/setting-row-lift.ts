import { DestroyRef, ElementRef, inject } from '@angular/core';

const LIFT_GAP = 12;
// matches the transition of .setting-row in styles/settings.scss
const LIFT_MS = 150;

/** The settings row raised above the page while a field's panel is open. */
interface Lift {
  owner: SettingRowLift;
  row: HTMLElement;
  placeholder: HTMLElement;
  backdrop: HTMLElement;
  timer?: ReturnType<typeof setTimeout>;
}
let activeLift: Lift | null = null;

/**
 * Raises the host's settings row above a modal backdrop and centres it with the field's panel below.
 * Construct it in an injection context; it settles the row when the host is destroyed.
 */
export class SettingRowLift {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  /** Set from a press on the field until the button comes up. */
  private pointerHeld = false;
  /** Set from raise() until lower(), while this field's panel is open. */
  private raised = false;
  private pendingGlide?: () => void;
  private readonly onRelease = () => this.release();

  constructor() {
    document.addEventListener('mouseup', this.onRelease);
    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener('mouseup', this.onRelease);
      if (activeLift?.owner === this) settle(activeLift);
    });
  }

  /** Call on a press that may open the panel, so the row waits for the release before it glides. */
  hold() {
    this.pointerHeld = true;
  }

  /** Raises the settings row into the top layer. Show the panel after this, so it stays above. */
  raise() {
    const row = this.host.closest<HTMLElement>('app-setting-row') ?? this.host;
    this.raised = true;

    // reuse the row a field in it already raised, stopped where it is until the release
    if (activeLift?.row === row) {
      clearTimeout(activeLift.timer);
      activeLift.owner = this;
      const rect = row.getBoundingClientRect();
      row.style.left = `${rect.left}px`;
      row.style.top = `${rect.top}px`;
      return;
    }
    if (activeLift) settle(activeLift);

    // hold the row's place in the page and raise it where it stands
    const rect = row.getBoundingClientRect();
    const placeholder = document.createElement('div');
    placeholder.style.height = `${rect.height}px`;
    row.before(placeholder);
    row.popover = 'manual';
    row.classList.add('setting-row-lift');
    Object.assign(row.style, {
      position: 'fixed',
      inset: 'auto',
      margin: '0',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
    });
    row.showPopover();
    const backdrop = document.createElement('div');
    backdrop.classList.add('modal-wrapper');
    document.body.appendChild(backdrop);
    activeLift = { owner: this, row, placeholder, backdrop };
  }

  /** Places the shown panel and glides the raised row to the same place on screen for every field. */
  place(panel: HTMLElement) {
    const lift = activeLift;
    if (lift?.owner !== this) return;
    const row = lift.row.getBoundingClientRect();
    const height = row.height + LIFT_GAP + panel.offsetHeight;
    const top = Math.max(LIFT_GAP, (window.innerHeight - height) / 2);
    panel.style.left = `${(window.innerWidth - panel.offsetWidth) / 2}px`;
    panel.style.top = `${top + row.height + LIFT_GAP}px`;
    const glide = () =>
      requestAnimationFrame(() => {
        if (activeLift !== lift || lift.owner !== this || !this.raised) return;
        lift.row.classList.add('lifted');
        lift.backdrop.classList.add('in');
        lift.row.style.left = `${(window.innerWidth - row.width) / 2}px`;
        lift.row.style.top = `${top}px`;
      });

    // the SteamVR keyboard opens only if the field is still under the pointer at release
    if (this.pointerHeld) this.pendingGlide = glide;
    else glide();
  }

  /** Glides the row back into the page, unless another field in it raises it first. */
  lower() {
    this.raised = false;
    this.pendingGlide = undefined;
    const lift = activeLift;
    if (lift?.owner !== this) return;
    clearTimeout(lift.timer);
    lift.timer = setTimeout(() => {
      const home = lift.placeholder.getBoundingClientRect();
      lift.row.classList.remove('lifted');
      lift.backdrop.classList.remove('in');
      lift.row.style.left = `${home.left}px`;
      lift.row.style.top = `${home.top}px`;
      lift.timer = setTimeout(() => settle(lift), LIFT_MS);
    });
  }

  private release() {
    this.pointerHeld = false;
    this.pendingGlide?.();
    this.pendingGlide = undefined;
  }
}

function settle(lift: Lift) {
  clearTimeout(lift.timer);
  if (lift.row.matches(':popover-open')) lift.row.hidePopover();
  lift.row.removeAttribute('popover');
  lift.row.classList.remove('setting-row-lift', 'lifted');
  for (const property of ['position', 'inset', 'margin', 'left', 'top', 'width']) {
    lift.row.style.removeProperty(property);
  }
  lift.placeholder.remove();
  lift.backdrop.remove();
  if (activeLift === lift) activeLift = null;
}
