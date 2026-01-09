(() => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const PRIVATE_KEY_STORAGE = "lezwuenPrivateKey";
  const PUBLIC_KEY_STORAGE = "lezwuenPublicKey";
  const FOLDER_KEY_PREFIX = "lezwuenFolderKey:";
  const DEFAULT_ITERATIONS = 150000;
  const HKDF_SALT = encoder.encode("lezwuen-hkdf-v1");

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary);
  }

  function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  function getFolderStorageKey(folderId) {
    return `${FOLDER_KEY_PREFIX}${folderId}`;
  }

  function storeSessionKeys(publicKey, privateKey) {
    sessionStorage.setItem(PUBLIC_KEY_STORAGE, publicKey);
    sessionStorage.setItem(PRIVATE_KEY_STORAGE, privateKey);
  }

  function clearSessionKeys() {
    sessionStorage.removeItem(PUBLIC_KEY_STORAGE);
    sessionStorage.removeItem(PRIVATE_KEY_STORAGE);
  }

  function getStoredPublicKey() {
    return sessionStorage.getItem(PUBLIC_KEY_STORAGE);
  }

  function getStoredPrivateKey() {
    return sessionStorage.getItem(PRIVATE_KEY_STORAGE);
  }

  async function importPublicKey(base64) {
    return crypto.subtle.importKey(
      "raw",
      base64ToArrayBuffer(base64),
      { name: "ECDH", namedCurve: "P-256" },
      true,
      []
    );
  }

  async function importPrivateKey(base64) {
    return crypto.subtle.importKey(
      "pkcs8",
      base64ToArrayBuffer(base64),
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveBits"]
    );
  }

  async function importAesKey(base64) {
    return crypto.subtle.importKey(
      "raw",
      base64ToArrayBuffer(base64),
      { name: "AES-GCM" },
      true,
      ["encrypt", "decrypt"]
    );
  }

  async function derivePasswordKey(password, salt, iterations) {
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      encoder.encode(password),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt,
        iterations,
        hash: "SHA-256"
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function generateUserKeys(password) {
    const keyPair = await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveBits"]
    );
    const publicKey = arrayBufferToBase64(await crypto.subtle.exportKey("raw", keyPair.publicKey));
    const privateKey = arrayBufferToBase64(
      await crypto.subtle.exportKey("pkcs8", keyPair.privateKey)
    );
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const passwordKey = await derivePasswordKey(password, salt, DEFAULT_ITERATIONS);
    const encryptedPrivateKey = arrayBufferToBase64(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        passwordKey,
        base64ToArrayBuffer(privateKey)
      )
    );

    return {
      publicKey,
      privateKey,
      encryptedPrivateKey,
      keySalt: arrayBufferToBase64(salt),
      keyIv: arrayBufferToBase64(iv),
      keyIterations: DEFAULT_ITERATIONS
    };
  }

  async function unlockUserKeys(payload, password) {
    const salt = new Uint8Array(base64ToArrayBuffer(payload.keySalt));
    const iv = new Uint8Array(base64ToArrayBuffer(payload.keyIv));
    const encrypted = base64ToArrayBuffer(payload.encryptedPrivateKey);
    const iterations = Number.isInteger(payload.keyIterations)
      ? payload.keyIterations
      : DEFAULT_ITERATIONS;
    const passwordKey = await derivePasswordKey(password, salt, iterations);
    const privateKeyBuffer = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      passwordKey,
      encrypted
    );
    const privateKey = arrayBufferToBase64(privateKeyBuffer);

    storeSessionKeys(payload.publicKey, privateKey);
    return { publicKey: payload.publicKey, privateKey };
  }

  async function getPrivateKey() {
    const stored = getStoredPrivateKey();
    if (!stored) {
      return null;
    }
    return importPrivateKey(stored);
  }

  async function getPublicKey() {
    const stored = getStoredPublicKey();
    if (!stored) {
      return null;
    }
    return importPublicKey(stored);
  }

  async function deriveSharedKey(privateKey, publicKey, info) {
    const secret = await crypto.subtle.deriveBits(
      { name: "ECDH", public: publicKey },
      privateKey,
      256
    );
    const keyMaterial = await crypto.subtle.importKey("raw", secret, "HKDF", false, [
      "deriveKey"
    ]);
    return crypto.subtle.deriveKey(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: HKDF_SALT,
        info: encoder.encode(info)
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function encryptText(plaintext, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = encoder.encode(plaintext);
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
    return { ciphertext: arrayBufferToBase64(encrypted), iv: arrayBufferToBase64(iv.buffer) };
  }

  async function decryptText(ciphertext, iv, key) {
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(base64ToArrayBuffer(iv)) },
      key,
      base64ToArrayBuffer(ciphertext)
    );
    return decoder.decode(decrypted);
  }

  async function encryptRaw(dataBuffer, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, dataBuffer);
    return { ciphertext: arrayBufferToBase64(encrypted), iv: arrayBufferToBase64(iv.buffer) };
  }

  async function decryptRaw(ciphertext, iv, key) {
    return crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(base64ToArrayBuffer(iv)) },
      key,
      base64ToArrayBuffer(ciphertext)
    );
  }

  async function generateFolderKey() {
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
      "encrypt",
      "decrypt"
    ]);
    const raw = await crypto.subtle.exportKey("raw", key);
    return arrayBufferToBase64(raw);
  }

  function getFolderKey(folderId) {
    return sessionStorage.getItem(getFolderStorageKey(folderId));
  }

  function storeFolderKey(folderId, base64Key) {
    sessionStorage.setItem(getFolderStorageKey(folderId), base64Key);
  }

  function clearFolderKey(folderId) {
    sessionStorage.removeItem(getFolderStorageKey(folderId));
  }

  window.LeZwuenCrypto = {
    arrayBufferToBase64,
    base64ToArrayBuffer,
    generateUserKeys,
    unlockUserKeys,
    storeSessionKeys,
    clearSessionKeys,
    getStoredPublicKey,
    getStoredPrivateKey,
    getPrivateKey,
    getPublicKey,
    importPublicKey,
    importPrivateKey,
    importAesKey,
    deriveSharedKey,
    encryptText,
    decryptText,
    encryptRaw,
    decryptRaw,
    generateFolderKey,
    getFolderKey,
    storeFolderKey,
    clearFolderKey
  };
})();
