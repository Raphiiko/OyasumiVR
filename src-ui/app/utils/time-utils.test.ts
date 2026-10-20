import { describe, expect, it } from 'vitest';
import { parseTime } from './time-utils';

describe('parseTime', () => {
  it.each([
    ['22:30', [22, 30]],
    ['2230', [22, 30]],
    ['930', [9, 30]],
    ['9', [9, 0]],
    ['09.05', [9, 5]],
    [' 7:45 ', [7, 45]],
    ['12am', [0, 0]],
    ['12 pm', [12, 0]],
    ['9:30pm', [21, 30]],
    ['11:15 AM', [11, 15]],
    ['00:00', [0, 0]],
    ['23:59', [23, 59]],
  ])('reads %s', (text, expected) => {
    expect(parseTime(text)).toEqual(expected);
  });

  it.each(['', 'abc', '24:00', '12:60', '13pm', '0am', '1:5', '123456'])('rejects %s', (text) => {
    expect(parseTime(text)).toBeNull();
  });
});
