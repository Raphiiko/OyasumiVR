export class TranslationEditUtils {
  public static unflatten(ob: Record<string, unknown>): unknown {
    // Make sure to sort the keys before unflattening
    const keys = Object.keys(ob);
    keys.sort();
    ob = keys.reduce((acc, e) => {
      acc[e] = ob[e];
      return acc;
    }, {} as Record<string, unknown>);
    // Unflatten
    const result = {};
    for (const i in ob) {
      const keys = i.split('.');
      keys.reduce((r, e, j) => {
        return (
          r[e] || (r[e] = isNaN(Number(keys[j + 1])) ? (keys.length - 1 === j ? ob[i] : {}) : [])
        );
      }, result as any);
    }
    return result;
  }

  public static flatten<T>(ob: T): Record<string, unknown> {
    // Flatten the object
    const result = {} as Record<string, unknown>;
    for (const i in ob) {
      if (typeof ob[i] === 'object' && !Array.isArray(ob[i])) {
        const temp = this.flatten(ob[i] as T);
        for (const j in temp) result[i + '.' + j] = temp[j];
      } else result[i] = ob[i];
    }
    // Sort the resulting flattened object
    const keys = Object.keys(result);
    keys.sort();
    return keys.reduce((acc, e) => {
      acc[e] = result[e];
      return acc;
    }, {} as Record<string, unknown>);
  }
}
