import { mergeWith } from 'lodash';

export function normalizeWithDefaults<T>(defaults: T, data: unknown): T {
  const normalized = mergeWith(structuredClone(defaults), data, (defaultValue, storedValue) =>
    Array.isArray(defaultValue) ? storedValue : undefined
  );
  assertDefaultShape(normalized, defaults, 'value');
  return normalized;
}

function assertDefaultShape(value: unknown, defaults: unknown, path: string): void {
  if (defaults === null) return;
  if (Array.isArray(defaults)) {
    if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
    return;
  }
  if (typeof defaults === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error(`${path} must be an object`);
    }
    for (const [key, childDefaults] of Object.entries(defaults)) {
      assertDefaultShape((value as Record<string, unknown>)[key], childDefaults, `${path}.${key}`);
    }
    return;
  }
  if (typeof value !== typeof defaults) {
    throw new Error(`${path} must be a ${typeof defaults}`);
  }
}
