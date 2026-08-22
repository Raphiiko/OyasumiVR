const MASTER_KEY = 'mY2BEtChq6dmPS4byAT2Xr1NT+tet5IONT+o7Eni3Vw=';

export async function deserializeStorageCryptoKey(wrappedKey: string): Promise<CryptoKey> {
  const masterKey = await window.crypto.subtle.importKey(
    'raw',
    base64ToArrayBuffer(MASTER_KEY),
    { name: 'AES-GCM' },
    true,
    ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey']
  );
  const [wrappedKeyBuffer, ivBuffer] = wrappedKey.split('$').map((c) => base64ToArrayBuffer(c));
  const iv = new Uint8Array(ivBuffer);
  return await window.crypto.subtle.unwrapKey(
    'raw',
    wrappedKeyBuffer,
    masterKey,
    {
      name: 'AES-GCM',
      iv,
      tagLength: 128,
    },
    {
      name: 'AES-GCM',
      length: 256,
    },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function decryptStorageData(data: string, key: CryptoKey): Promise<string> {
  const [encryptedDataBuffer, ivBuffer] = data.split('$').map((c) => base64ToArrayBuffer(c));
  const iv = new Uint8Array(ivBuffer);
  const decryptedData = await window.crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv,
      tagLength: 128,
    },
    key,
    encryptedDataBuffer
  );
  return new TextDecoder().decode(decryptedData);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}
