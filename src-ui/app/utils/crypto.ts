import { STORAGE_MASTER_CRYPTO_KEY } from '../globals';

export async function getStorageMasterCryptoKey(): Promise<CryptoKey> {
  return await window.crypto.subtle.importKey(
    'raw',
    base64ToArrayBuffer(STORAGE_MASTER_CRYPTO_KEY),
    { name: 'AES-GCM' },
    true,
    ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey']
  );
}

export async function generateStorageCryptoKey(): Promise<CryptoKey> {
  return window.crypto.subtle.generateKey(
    {
      name: 'AES-GCM',
      length: 256,
    },
    true, //whether the key is extractable (i.e. can be used in exportKey)
    ['encrypt', 'decrypt'] //can "encrypt", "decrypt", "wrapKey", or "unwrapKey"
  );
}

export async function serializeStorageCryptoKey(key: CryptoKey): Promise<string> {
  const masterKey = await getStorageMasterCryptoKey();
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const wrappedKey = await window.crypto.subtle.wrapKey('raw', key, masterKey, {
    name: 'AES-GCM',
    iv,
    tagLength: 128,
  });
  return arrayBufferToBase64(wrappedKey) + '$' + arrayBufferToBase64(iv.buffer);
}

export async function deserializeStorageCryptoKey(wrappedKey: string): Promise<CryptoKey> {
  const masterKey = await getStorageMasterCryptoKey();
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

export async function encryptStorageData(data: string, key: CryptoKey): Promise<string> {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encryptedData = await window.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      tagLength: 128,
    },
    key,
    new TextEncoder().encode(data)
  );
  return arrayBufferToBase64(encryptedData) + '$' + arrayBufferToBase64(iv.buffer);
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

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
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
