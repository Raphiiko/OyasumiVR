import { animate, group, query, style, transition } from '@angular/animations';

export function routeFade(from: string, to: string) {
  return transition(`${from} => ${to}`, [
    group([
      query(
        ':enter, :leave',
        style({
          position: 'absolute',
          width: '100%',
          top: 0,
          left: 0,
        }),
        {
          optional: true,
        }
      ),
      query(
        ':enter',
        [
          style({
            opacity: 0,
            'z-index': 1,
          }),
          animate('.125s .125s ease', style({ opacity: 1 })),
        ],
        { optional: true }
      ),
      query(
        ':leave',
        [
          style({
            'z-index': 0,
          }),
          animate('.125s ease', style({ opacity: 0 })),
        ],
        {
          optional: true,
        }
      ),
    ]),
  ]);
}
