import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('shared font loader', () => {
  const faces: FakeFontFace[] = [];
  const registered = new Set<FakeFontFace>();
  let load: (face: FakeFontFace) => Promise<FakeFontFace>;
  let loader: typeof import('./font-loader').fontLoader;

  class FakeFontFace {
    constructor(
      readonly family: string,
      readonly source: string,
      readonly descriptors: FontFaceDescriptors
    ) {
      faces.push(this);
    }
    load = vi.fn(() => load(this));
  }

  beforeEach(async () => {
    vi.resetModules();
    faces.length = 0;
    registered.clear();
    load = async (face) => face;
    vi.stubGlobal('FontFace', FakeFontFace);
    vi.stubGlobal('document', { fonts: registered });
    loader = (await import('./font-loader')).fontLoader;
  });

  afterEach(() => vi.unstubAllGlobals());

  it.each(['ja', 'ko', 'cn', 'tw'])(
    'loads 42 faces once across %s replay and revisit',
    async (locale) => {
      await loader.init(12345, locale);
      expect(faces).toHaveLength(42);
      await loader.loadFontsForNewLocale(locale);
      expect(faces).toHaveLength(42);
      await loader.loadFontsForNewLocale('en');
      await loader.loadFontsForNewLocale(locale);
      expect(faces).toHaveLength(42);
      expect(registered.size).toBe(42);
      expect(new Set(faces.map((face) => face.source)).size).toBe(42);
      faces.forEach((face) => expect(face.load).toHaveBeenCalledTimes(1));
    }
  );

  it('shares pending faces between initialization and concurrent locale requests', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => (release = resolve));
    load = async (face) => {
      await pending;
      return face;
    };
    const initial = loader.init(12345, 'ja');
    const replay = loader.loadFontsForNewLocale('ja');
    let completed = false;
    const concurrent = loader.loadFontsForNewLocale('ja').then(() => (completed = true));
    await Promise.resolve();
    expect(completed).toBe(false);
    expect(faces).toHaveLength(42);
    release();
    await Promise.all([initial, replay, concurrent]);
    faces.forEach((face) => expect(face.load).toHaveBeenCalledTimes(1));
  });

  it('removes a failed face and retries only that identity', async () => {
    const failure = new Error('font unavailable');
    load = async (face) => {
      if (face.source.includes('japanese-100')) throw failure;
      return face;
    };
    await expect(loader.init(12345, 'ja')).rejects.toBe(failure);
    expect(faces).toHaveLength(42);
    expect(registered.size).toBe(41);
    load = async (face) => face;
    await loader.loadFontsForNewLocale('ja');
    expect(faces).toHaveLength(43);
    expect(registered.size).toBe(42);
    await loader.loadFontsForNewLocale('ja');
    expect(faces).toHaveLength(43);
  });

  it('shares a pending failure and a pending retry across callers', async () => {
    await loader.init(12345);
    let reject!: (error: Error) => void;
    const pending = new Promise<never>((_, fail) => (reject = fail));
    load = (face) => (face.source.includes('japanese-100') ? pending : Promise.resolve(face));
    const first = loader.loadFontsForNewLocale('ja');
    const second = loader.loadFontsForNewLocale('ja');
    const results = Promise.allSettled([first, second]);
    const failure = new Error('font unavailable');
    reject(failure);
    expect(await results).toEqual([
      { status: 'rejected', reason: failure },
      { status: 'rejected', reason: failure },
    ]);
    expect(faces).toHaveLength(42);
    expect(registered.size).toBe(41);

    let release!: () => void;
    const retry = new Promise<void>((resolve) => (release = resolve));
    load = async (face) => {
      await retry;
      return face;
    };
    const retries = [loader.loadFontsForNewLocale('ja'), loader.loadFontsForNewLocale('ja')];
    expect(faces).toHaveLength(43);
    release();
    await Promise.all(retries);
    expect(registered.size).toBe(42);
    faces.forEach((face) => expect(face.load).toHaveBeenCalledTimes(1));
  });

  it('loads a locale activated during the initial English batch', async () => {
    const initial = loader.init(12345, 'en');
    const activated = loader.loadFontsForNewLocale('ja');
    await Promise.all([initial, activated]);
    expect(faces).toHaveLength(42);
    expect(faces.filter((face) => face.family === 'Noto Sans JP')).toHaveLength(6);
  });

  it('preserves the overlay locale selected before its core port arrives', async () => {
    await loader.loadFontsForNewLocale('ja');
    expect(faces).toHaveLength(0);
    await loader.init(12345);
    expect(faces).toHaveLength(42);
  });

  it('keeps English at 36 faces and treats a changed font URL separately', async () => {
    await loader.init(12345);
    await loader.init(12345);
    await loader.loadFontsForNewLocale('en');
    expect(faces).toHaveLength(36);
    await loader.init(12346);
    expect(faces).toHaveLength(72);
    expect(new Set(faces.map((face) => face.source)).size).toBe(72);
  });
});
