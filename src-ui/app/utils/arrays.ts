export function filterInPlace<T>(
  a: T[],
  condition: (value: T, index: number, array: T[]) => boolean
): T[] {
  let i = 0,
    j = 0;

  while (i < a.length) {
    const val = a[i];
    if (condition(val, i, a)) a[j++] = val;
    i++;
  }

  a.length = j;
  return a;
}
