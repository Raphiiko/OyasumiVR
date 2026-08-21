//
// Writes the storage format that migrations/legacy/storage-crypto.ts reads, so tests can build
// stores as older versions of OyasumiVR left them.
//

const MASTER_KEY = 'mY2BEtChq6dmPS4byAT2Xr1NT+tet5IONT+o7Eni3Vw=';

function toBase64(buffer: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

async function masterKey(): Promise<CryptoKey> {
  return await crypto.subtle.importKey('raw', fromBase64(MASTER_KEY), { name: 'AES-GCM' }, true, [
    'wrapKey',
    'unwrapKey',
  ]);
}

export async function createLegacyKey(): Promise<{ key: CryptoKey; serialized: string }> {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrapped = await crypto.subtle.wrapKey('raw', key, await masterKey(), {
    name: 'AES-GCM',
    iv,
    tagLength: 128,
  });
  return { key, serialized: `${toBase64(wrapped)}$${toBase64(iv.buffer as ArrayBuffer)}` };
}

export async function legacyEncrypt(key: CryptoKey, data: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    key,
    new TextEncoder().encode(data)
  );
  return `${toBase64(encrypted)}$${toBase64(iv.buffer as ArrayBuffer)}`;
}

export async function legacyCredentials(
  key: CryptoKey,
  username: string,
  password: string
): Promise<string> {
  return await legacyEncrypt(key, `${btoa(username)}:${btoa(password)}`);
}

/** Valid base64 in the right shape, holding bytes no key can authenticate. */
export function corruptLegacyValue(): string {
  return `${btoa('not really encrypted at all')}$${btoa('123456789012')}`;
}
