(() => {
  const apiBaseUrl =
    window.APP_CONFIG && window.APP_CONFIG.API_BASE_URL ? window.APP_CONFIG.API_BASE_URL : "";

  function apiUrl(path) {
    if (!apiBaseUrl) {
      return path;
    }
    return new URL(path, apiBaseUrl).toString();
  }

  function getAuthToken() {
    return localStorage.getItem("lezwuenAuthToken");
  }

  function getStoredUser() {
    const raw = localStorage.getItem("lezwuenUser");
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw);
    } catch (error) {
      return null;
    }
  }

  function getCurrentUserId() {
    const user = getStoredUser();
    return user && user.id ? user.id : null;
  }

  async function refreshStoredUser() {
    const token = getAuthToken();
    if (!token) {
      return null;
    }
    try {
      const response = await fetch(apiUrl("/api/me"), {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.user) {
        localStorage.setItem("lezwuenUser", JSON.stringify(data.user));
        return data.user;
      }
    } catch (error) {
      return null;
    }
    return null;
  }

  function getStoredUserKeys() {
    const user = getStoredUser();
    if (
      !user ||
      !user.public_key ||
      !user.encrypted_private_key ||
      !user.key_salt ||
      !user.key_iv
    ) {
      return null;
    }
    return {
      publicKey: user.public_key,
      encryptedPrivateKey: user.encrypted_private_key,
      keySalt: user.key_salt,
      keyIv: user.key_iv,
      keyIterations: user.key_iterations
    };
  }

  function setStatus(element, message, type) {
    if (!element) {
      return;
    }
    element.textContent = message;
    if (type) {
      element.setAttribute("data-type", type);
    } else {
      element.removeAttribute("data-type");
    }
  }

  async function ensureCryptoUnlocked(statusTarget) {
    if (!window.LeZwuenCrypto) {
      return null;
    }

    window.LeZwuenCrypto.startAutoLock();
    const existingPrivateKey = await window.LeZwuenCrypto.getPrivateKey();
    const existingPublicKey = await window.LeZwuenCrypto.getPublicKey();
    if (existingPrivateKey && existingPublicKey) {
      return { privateKey: existingPrivateKey, publicKey: existingPublicKey };
    }

    let payload = getStoredUserKeys();
    if (!payload) {
      await refreshStoredUser();
      payload = getStoredUserKeys();
    }
    if (!payload) {
      setStatus(statusTarget, "Encryption keys missing.", "error");
      return null;
    }

    const password = window.LeZwuenCrypto.requestPassword
      ? await window.LeZwuenCrypto.requestPassword("Enter your password to save a post-it.")
      : window.prompt("Enter your password to save a post-it.");
    if (!password) {
      setStatus(statusTarget, "Password required to save encrypted notes.", "error");
      return null;
    }

    try {
      await window.LeZwuenCrypto.unlockUserKeys(payload, password);
      const privateKey = await window.LeZwuenCrypto.getPrivateKey();
      const publicKey = await window.LeZwuenCrypto.getPublicKey();
      if (!privateKey || !publicKey) {
        setStatus(statusTarget, "Unable to unlock encryption.", "error");
        return null;
      }
      return { privateKey, publicKey };
    } catch (error) {
      setStatus(statusTarget, "Unable to unlock encryption.", "error");
      return null;
    }
  }

  function folderKeyInfo(folderId, ownerId, recipientId) {
    return `folder:${folderId}:${ownerId}:${recipientId}`;
  }

  async function ensureFolderKey(folder, statusTarget) {
    if (!window.LeZwuenCrypto) {
      return null;
    }

    const cached = window.LeZwuenCrypto.getFolderKey(folder.id);
    if (cached) {
      return window.LeZwuenCrypto.importAesKey(cached);
    }

    const userId = getCurrentUserId();
    if (!userId) {
      setStatus(statusTarget, "Sign in to access encrypted folders.", "error");
      return null;
    }

    const keys = await ensureCryptoUnlocked(statusTarget);
    if (!keys) {
      return null;
    }

    const ownerId = folder.owner_id || userId;
    const ownerPublicKeyBase64 =
      folder.owner_public_key || window.LeZwuenCrypto.getStoredPublicKey();
    if (!ownerPublicKeyBase64) {
      setStatus(statusTarget, "Missing folder encryption key.", "error");
      return null;
    }

    try {
      const ownerPublicKey = await window.LeZwuenCrypto.importPublicKey(ownerPublicKeyBase64);
      const sharedKey = await window.LeZwuenCrypto.deriveSharedKey(
        keys.privateKey,
        ownerPublicKey,
        folderKeyInfo(folder.id, ownerId, userId)
      );

      if (folder.encrypted_key && folder.key_iv) {
        const rawKey = await window.LeZwuenCrypto.decryptRaw(
          folder.encrypted_key,
          folder.key_iv,
          sharedKey
        );
        const rawKeyBase64 = window.LeZwuenCrypto.arrayBufferToBase64(rawKey);
        window.LeZwuenCrypto.storeFolderKey(folder.id, rawKeyBase64);
        return window.LeZwuenCrypto.importAesKey(rawKeyBase64);
      }

      const rawKeyBase64 = await window.LeZwuenCrypto.generateFolderKey();
      const encrypted = await window.LeZwuenCrypto.encryptRaw(
        window.LeZwuenCrypto.base64ToArrayBuffer(rawKeyBase64),
        sharedKey
      );

      const token = getAuthToken();
      if (!token) {
        setStatus(statusTarget, "Sign in to save folder keys.", "error");
        return null;
      }

      await fetch(apiUrl(`/api/folders/${folder.id}/key`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          encryptedKey: encrypted.ciphertext,
          keyIv: encrypted.iv,
          keyVersion: 1
        })
      });

      window.LeZwuenCrypto.storeFolderKey(folder.id, rawKeyBase64);
      return window.LeZwuenCrypto.importAesKey(rawKeyBase64);
    } catch (error) {
      setStatus(statusTarget, "Unable to prepare folder encryption.", "error");
      return null;
    }
  }

  function init(options) {
    if (!options || typeof options.getContent !== "function") {
      return;
    }

    const root = options.root;
    if (!root) {
      return;
    }

    const folderSelect = root.querySelector("[data-postit-folder]");
    const newFolderInput = root.querySelector("[data-postit-new]");
    const createButton = root.querySelector("[data-postit-create]");
    const saveButton = root.querySelector("[data-postit-save-button]");
    const status = root.querySelector("[data-postit-status]");
    const refreshButton = root.querySelector("[data-postit-refresh]");
    const controls = [folderSelect, newFolderInput, createButton, saveButton, refreshButton];
    let folders = [];

    function setDisabled(disabled) {
      controls.forEach((element) => {
        if (element) {
          element.disabled = disabled;
        }
      });
    }

    function renderFolders(selectedId) {
      if (!folderSelect) {
        return;
      }
      const currentValue = selectedId || folderSelect.value;
      folderSelect.textContent = "";
      if (!folders.length) {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = "No folders yet";
        option.disabled = true;
        option.selected = true;
        folderSelect.appendChild(option);
        return;
      }
      folders.forEach((folder) => {
        const option = document.createElement("option");
        option.value = String(folder.id);
        option.textContent = folder.name || "Untitled folder";
        if (String(folder.id) === String(currentValue)) {
          option.selected = true;
        }
        folderSelect.appendChild(option);
      });
    }

    async function loadFolders() {
      const token = getAuthToken();
      if (!token) {
        folders = [];
        renderFolders();
        setDisabled(true);
        setStatus(status, "Sign in to load folders.", "error");
        return;
      }

      setDisabled(false);
      setStatus(status, "Loading folders...");

      try {
        const response = await fetch(apiUrl("/api/folders"), {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || "Unable to load folders.");
        }
        folders = Array.isArray(data.folders) ? data.folders : [];
        renderFolders();
        setStatus(status, "");
      } catch (error) {
        setStatus(status, error.message || "Unable to load folders.", "error");
      }
    }

    async function createFolder() {
      const token = getAuthToken();
      if (!token) {
        setStatus(status, "Sign in to create folders.", "error");
        return null;
      }
      if (!newFolderInput) {
        return null;
      }
      const name = newFolderInput.value.trim();
      if (!name) {
        setStatus(status, "Enter a folder name.", "error");
        return null;
      }

      setStatus(status, "Creating folder...");

      try {
        const response = await fetch(apiUrl("/api/folders"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ name })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || "Unable to create folder.");
        }
        if (data.folder) {
          folders = [...folders, data.folder];
          renderFolders(data.folder.id);
          newFolderInput.value = "";
          setStatus(status, "Folder created.", "success");
          return data.folder;
        }
      } catch (error) {
        setStatus(status, error.message || "Unable to create folder.", "error");
      }
      return null;
    }

    async function savePostIt() {
      const token = getAuthToken();
      if (!token) {
        setStatus(status, "Sign in to save post-its.", "error");
        return;
      }

      let selectedFolderId = folderSelect ? folderSelect.value : "";
      let selectedFolder = folders.find((folder) => String(folder.id) === String(selectedFolderId));

      if (newFolderInput && newFolderInput.value.trim()) {
        const created = await createFolder();
        if (!created) {
          return;
        }
        selectedFolder = created;
        selectedFolderId = String(created.id);
      }

      if (!selectedFolderId || !selectedFolder) {
        setStatus(status, "Select a folder first.", "error");
        return;
      }

      const content = options.getContent();
      if (!content) {
        setStatus(status, "Nothing to save yet.", "error");
        return;
      }

      setStatus(status, "Saving...");

      try {
        let payload = {
          body: content,
          folderId: selectedFolderId
        };

        if (window.LeZwuenCrypto && getStoredUserKeys()) {
          const folderKey = await ensureFolderKey(selectedFolder, status);
          if (!folderKey) {
            return;
          }
          const encrypted = await window.LeZwuenCrypto.encryptText(content, folderKey);
          payload = {
            body: "",
            bodyCiphertext: encrypted.ciphertext,
            bodyIv: encrypted.iv,
            bodyVersion: 1,
            folderId: selectedFolderId
          };
        }

        const response = await fetch(apiUrl("/api/post-its"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify(payload)
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || "Unable to save post-it.");
        }
        setStatus(status, "Saved to post-it.", "success");
      } catch (error) {
        setStatus(status, error.message || "Unable to save post-it.", "error");
      }
    }

    if (createButton) {
      createButton.addEventListener("click", createFolder);
    }
    if (saveButton) {
      saveButton.addEventListener("click", savePostIt);
    }
    if (refreshButton) {
      refreshButton.addEventListener("click", loadFolders);
    }

    loadFolders();
  }

  window.LeZwuenPostItSave = { init };
})();
