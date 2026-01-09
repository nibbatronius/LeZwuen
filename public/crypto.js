(() => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const FOLDER_KEY_PREFIX = "lezwuenFolderKey:";
  const DEFAULT_ITERATIONS = 150000;
  const HKDF_SALT = encoder.encode("lezwuen-hkdf-v1");
  const DEFAULT_IDLE_TIMEOUT = 10 * 60 * 1000;

  let cachedPublicKey = null;
  let cachedPrivateKey = null;
  const folderKeys = new Map();
  let lastActivity = Date.now();
  let idleTimeoutMs = DEFAULT_IDLE_TIMEOUT;
  let idleTimer = null;
  let activityListenersAttached = false;
  let passwordModal = null;
  let passwordResolve = null;
  let passwordReject = null;
  let lastFocusedElement = null;

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
    cachedPublicKey = publicKey;
    cachedPrivateKey = privateKey;
    noteActivity();
  }

  function clearSessionKeys() {
    lockNow();
  }

  function getStoredPublicKey() {
    return cachedPublicKey;
  }

  function getStoredPrivateKey() {
    return cachedPrivateKey;
  }

  function noteActivity() {
    lastActivity = Date.now();
  }

  function lockNow() {
    cachedPublicKey = null;
    cachedPrivateKey = null;
    folderKeys.clear();
    noteActivity();
    window.dispatchEvent(new CustomEvent("lezwuen-lock"));
  }

  function startAutoLock(timeoutMs = DEFAULT_IDLE_TIMEOUT) {
    idleTimeoutMs = timeoutMs;
    if (!activityListenersAttached) {
      const activityEvents = ["mousemove", "keydown", "mousedown", "touchstart", "scroll"];
      activityEvents.forEach((event) => {
        window.addEventListener(event, noteActivity, { passive: true });
      });
      window.addEventListener("pagehide", lockNow);
      activityListenersAttached = true;
    }

    if (!idleTimer) {
      idleTimer = window.setInterval(() => {
        if (cachedPrivateKey && Date.now() - lastActivity > idleTimeoutMs) {
          lockNow();
        }
      }, 30000);
    }
  }

  function buildPasswordModal() {
    if (passwordModal) {
      return passwordModal;
    }

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.hidden = true;
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");

    const modal = document.createElement("div");
    modal.className = "modal-card";

    const title = document.createElement("div");
    title.className = "modal-title";
    title.textContent = "Unlock encryption";

    const text = document.createElement("div");
    text.className = "modal-text";

    const form = document.createElement("form");
    form.className = "modal-form";

    const input = document.createElement("input");
    input.className = "modal-input";
    input.type = "password";
    input.autocomplete = "current-password";
    input.placeholder = "Password";
    input.required = true;

    const actions = document.createElement("div");
    actions.className = "modal-actions";

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "ghost";
    cancelButton.textContent = "Cancel";

    const confirmButton = document.createElement("button");
    confirmButton.type = "submit";
    confirmButton.className = "primary";
    confirmButton.textContent = "Unlock";

    actions.append(cancelButton, confirmButton);
    form.append(input, actions);
    modal.append(title, text, form);
    overlay.append(modal);
    document.body.appendChild(overlay);

    function closeModal(value) {
      overlay.hidden = true;
      const resolver = passwordResolve;
      passwordResolve = null;
      passwordReject = null;
      if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
        lastFocusedElement.focus();
      }
      lastFocusedElement = null;
      if (resolver) {
        resolver(value);
      }
    }

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        closeModal(null);
      }
    });

    cancelButton.addEventListener("click", () => {
      closeModal(null);
    });

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const value = input.value;
      input.value = "";
      closeModal(value || null);
    });

    overlay.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeModal(null);
      }
    });

    passwordModal = { overlay, text, input };
    return passwordModal;
  }

  function requestPassword(promptText) {
    if (passwordResolve) {
      return Promise.resolve(null);
    }

    const modal = buildPasswordModal();
    modal.text.textContent = promptText || "Enter your password.";
    modal.input.value = "";
    modal.overlay.hidden = false;
    lastFocusedElement = document.activeElement;
    modal.input.focus();

    return new Promise((resolve, reject) => {
      passwordResolve = resolve;
      passwordReject = reject;
    });
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
    return folderKeys.get(getFolderStorageKey(folderId)) || null;
  }

  function storeFolderKey(folderId, base64Key) {
    folderKeys.set(getFolderStorageKey(folderId), base64Key);
    noteActivity();
  }

  function clearFolderKey(folderId) {
    folderKeys.delete(getFolderStorageKey(folderId));
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
    noteActivity,
    lockNow,
    startAutoLock,
    requestPassword,
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
