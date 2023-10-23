export class TranslationEditUtils {
  public static unflatten(ob: { [s: string]: unknown }): unknown {
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

  public static flatten<T>(ob: T): { [s: string]: unknown } {
    const result = {} as { [s: string]: unknown };
    for (const i in ob) {
      if (typeof ob[i] === 'object' && !Array.isArray(ob[i])) {
        const temp = this.flatten(ob[i] as T);
        for (const j in temp) result[i + '.' + j] = temp[j];
      } else result[i] = ob[i];
    }
    return result;
  }
}
