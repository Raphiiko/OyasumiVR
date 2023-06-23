import {
  animate,
  animateChild,
  group,
  query,
  style,
  transition,
  trigger,
} from '@angular/animations';

export function noop(name = 'noop') {
  return trigger(name, [transition('* => *', [])]);
}

export function triggerChildren(name = 'triggerChildren', childQuery = '@*') {
  return trigger(name, [
    transition('* => *', [group([query(childQuery, [animateChild()], { optional: true })])]),
  ]);
}

export function modalPage(name = 'modalPage', length = '.2s ease') {
  return trigger(name, [
    transition(':enter', [
      style({
        transform: 'translateX(100%)',
        opacity: 0,
      }),
      animate(
        length,
        style({
          transform: 'translateX(0)',
          opacity: 1,
        })
      ),
    ]),
    transition(':leave', [
      style({
        transform: 'translateX(0)',
        opacity: 1,
        position: 'absolute',
        width: '100%',
        top: 0,
        left: 0,
      }),
      animate(
        length,
        style({
          transform: 'translateX(-100%)',
          opacity: 0,
          width: '100%',
          position: 'absolute',
          top: 0,
          left: 0,
        })
      ),
    ]),
  ]);
}

export function fade(name = 'fade', length = '.15s ease') {
  return trigger(name, [
    transition(':enter', [style({ opacity: 0 }), animate(length)]),
    transition(':leave', [animate(length, style({ opacity: 0 }))]),
  ]);
}

export function crossFade(name = 'crossFade', length = '.15s ease') {
  return trigger(name, [
    transition(':enter', [style({ opacity: 0 }), animate(length)]),
    transition(':leave', [
      style({ position: 'absolute', top: 0, left: 0, width: '100%' }),
      animate(
        length,
        style({
          opacity: 0,
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
        })
      ),
    ]),
  ]);
}

export function fadeUp(name = 'fadeUp', length = '.15s ease') {
  return trigger(name, [
    transition(':enter', [style({ opacity: 0, transform: 'translateY(44px)' }), animate(length)]),
    transition(':leave', [animate(length, style({ opacity: 0, transform: 'translateY(44px)' }))]),
  ]);
}

export function fadeUpInv(name = 'fadeUpInv', length = '.15s ease') {
  return trigger(name, [
    transition(':enter', [style({ opacity: 0, transform: 'translateY(44px)' }), animate(length)]),
    transition(':leave', [animate(length, style({ opacity: 0, transform: 'translateY(-44px)' }))]),
  ]);
}

export function fadeLeft(name = 'fadeLeft', length = '.15s ease') {
  return trigger(name, [
    transition(':enter', [style({ opacity: 0, transform: 'translateX(-44px)' }), animate(length)]),
    transition(':leave', [animate(length, style({ opacity: 0, transform: 'translateX(-44px)' }))]),
  ]);
}

export function fadeRight(name = 'fadeRight', length = '.15s ease') {
  return trigger(name, [
    transition(':enter', [style({ opacity: 0, transform: 'translateX(44px)' }), animate(length)]),
    transition(':leave', [animate(length, style({ opacity: 0, transform: 'translateX(44px)' }))]),
  ]);
}

export function fadeDown(name = 'fadeDown', length = '.15s ease') {
  return trigger(name, [
    transition(':enter', [style({ opacity: 0, transform: 'translateY(-44px)' }), animate(length)]),
    transition(':leave', [animate(length, style({ opacity: 0, transform: 'translateY(-44px)' }))]),
  ]);
}

export function fadeDownInv(name = 'fadeDownInv', length = '.15s ease') {
  return trigger(name, [
    transition(':enter', [style({ opacity: 0, transform: 'translateY(-44px)' }), animate(length)]),
    transition(':leave', [animate(length, style({ opacity: 0, transform: 'translateY(44px)' }))]),
  ]);
}

export function zoomFadeShrink(name = 'zoomFadeShrink', length = '.5s ease') {
  return trigger(name, [
    transition(':enter', [style({ opacity: 0, transform: 'scale(0)' }), animate(length)]),
    transition(':leave', [animate(length, style({ opacity: 0, transform: 'scale(0)' }))]),
  ]);
}

export function zoomFadeGrow(name = 'zoomFadeGrow', length = '.5s ease') {
  return trigger(name, [
    transition(':enter', [style({ opacity: 0, transform: 'scale(2)' }), animate(length)]),
    transition(':leave', [animate(length, style({ opacity: 0, transform: 'scale(2)' }))]),
  ]);
}

export function vshrink(name = 'vshrink', length = '.2s ease') {
  return trigger(name, [
    transition(':enter', [
      style({
        height: 0,
        minHeight: 0,
        opacity: 0,
        marginTop: 0,
        marginBottom: 0,
        paddingTop: 0,
        paddingBottom: 0,
      }),
      animate(length),
    ]),
    transition(':leave', [
      animate(
        length,
        style({
          height: 0,
          minHeight: 0,
          opacity: 0,
          marginTop: 0,
          marginBottom: 0,
          paddingTop: 0,
          paddingBottom: 0,
        })
      ),
    ]),
  ]);
}

export function vshrinkHidden(name = 'vshrinkHidden', length = '.2s ease') {
  return trigger(name, [
    transition(':enter', [
      style({
        height: 0,
        minHeight: 0,
        opacity: 0,
        marginTop: 0,
        marginBottom: 0,
        paddingTop: 0,
        paddingBottom: 0,
        overflow: 'hidden',
      }),
      animate(length),
    ]),
    transition(':leave', [
      animate(
        length,
        style({
          height: 0,
          minHeight: 0,
          opacity: 0,
          marginTop: 0,
          marginBottom: 0,
          paddingTop: 0,
          paddingBottom: 0,
          overflow: 'hidden',
        })
      ),
    ]),
  ]);
}

export function hshrink(name = 'hshrink', length = '.2s ease') {
  return trigger(name, [
    transition(':enter', [
      style({
        transform: 'scaleX(0)',
        width: 0,
        opacity: 0,
        'margin-left': 0,
        'margin-right': 0,
        'padding-left': 0,
        'padding-right': 0,
      }),
      animate(length),
    ]),
    transition(':leave', [
      animate(
        length,
        style({
          transform: 'scaleX(0)',
          width: 0,
          opacity: 0,
          'margin-left': 0,
          'margin-right': 0,
          'padding-left': 0,
          'padding-right': 0,
        })
      ),
    ]),
  ]);
}

export function shrink(name = 'shrink', length = '.2s ease') {
  return trigger(name, [
    transition(':enter', [
      style({
        transform: 'scale(0)',
        width: 0,
        height: 0,
        opacity: 0,
        'margin-left': 0,
        'margin-right': 0,
        'margin-top': 0,
        'margin-bottom': 0,
        'padding-left': 0,
        'padding-right': 0,
        'padding-top': 0,
        'padding-bottom': 0,
      }),
      animate(length),
    ]),
    transition(':leave', [
      animate(
        length,
        style({
          transform: 'scale(0)',
          width: 0,
          height: 0,
          opacity: 0,
          'margin-left': 0,
          'margin-right': 0,
          'margin-top': 0,
          'margin-bottom': 0,
          'padding-left': 0,
          'padding-right': 0,
          'padding-top': 0,
          'padding-bottom': 0,
        })
      ),
    ]),
  ]);
}
