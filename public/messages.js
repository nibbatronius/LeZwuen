(() => {
  const apiBaseUrl =
    window.APP_CONFIG && window.APP_CONFIG.API_BASE_URL ? window.APP_CONFIG.API_BASE_URL : "";
  const friendForm = document.querySelector("[data-friend-request-form]");
  const friendInput = document.querySelector("[data-friend-request-input]");
  const friendStatus = document.querySelector("[data-friend-request-status]");
  const requestList = document.querySelector("[data-request-list]");
  const friendList = document.querySelector("[data-friend-list]");
  const conversationTitle = document.querySelector("[data-conversation-title]");
  const conversationMeta = document.querySelector("[data-conversation-meta]");
  const messagesList = document.querySelector("[data-messages-list]");
  const messageForm = document.querySelector("[data-message-form]");
  const messageInput = document.querySelector("[data-message-input]");
  const messageStatus = document.querySelector("[data-message-status]");
  const shareSelect = document.querySelector("[data-share-folder-select]");

  let friends = [];
  let selectedFriend = null;
  let currentUserId = null;
  let cryptoReady = false;
  let privateKey = null;
  let publicKey = null;
  const friendKeys = new Map();
  let unlockInProgress = false;
  let ownShareFolders = [];

  function apiUrl(path) {
    if (!apiBaseUrl) {
      return path;
    }
    return new URL(path, apiBaseUrl).toString();
  }

  function getAuthToken() {
    return localStorage.getItem("lezwuenAuthToken");
  }

  function getStoredUserKeys() {
    const raw = localStorage.getItem("lezwuenUser");
    if (!raw) {
      return null;
    }

    try {
      const user = JSON.parse(raw);
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
    } catch (error) {
      return null;
    }
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

  function conversationInfo(userId, otherUserId) {
    const low = Math.min(userId, otherUserId);
    const high = Math.max(userId, otherUserId);
    return `msg:${low}:${high}`;
  }

  function folderKeyInfo(folderId, ownerId, recipientId) {
    return `folder:${folderId}:${ownerId}:${recipientId}`;
  }

  async function initCrypto() {
    if (!window.LeZwuenCrypto) {
      cryptoReady = false;
      return false;
    }

    window.LeZwuenCrypto.startAutoLock();
    privateKey = await window.LeZwuenCrypto.getPrivateKey();
    publicKey = await window.LeZwuenCrypto.getPublicKey();
    cryptoReady = Boolean(privateKey && publicKey);
    return cryptoReady;
  }

  async function ensureCryptoUnlocked(statusTarget) {
    await initCrypto();
    if (cryptoReady) {
      return true;
    }

    if (!window.LeZwuenCrypto || unlockInProgress) {
      return false;
    }

    let payload = getStoredUserKeys();
    if (!payload) {
      await refreshStoredUser();
      payload = getStoredUserKeys();
    }
    if (!payload) {
      return false;
    }

    unlockInProgress = true;
    const password = window.LeZwuenCrypto.requestPassword
      ? await window.LeZwuenCrypto.requestPassword(
          "Enter your password to unlock encrypted messages."
        )
      : window.prompt("Enter your password to unlock encrypted messages.");
    unlockInProgress = false;
    if (!password) {
      return false;
    }

    try {
      await window.LeZwuenCrypto.unlockUserKeys(payload, password);
      await initCrypto();
      return cryptoReady;
    } catch (error) {
      if (statusTarget) {
        setStatus(statusTarget, "Unable to unlock encryption.", "error");
      }
      return false;
    }
  }

  async function getConversationKey(otherUserId, otherPublicKey) {
    const otherKeyObj = await window.LeZwuenCrypto.importPublicKey(otherPublicKey);
    return window.LeZwuenCrypto.deriveSharedKey(
      privateKey,
      otherKeyObj,
      conversationInfo(currentUserId, otherUserId)
    );
  }

  async function ensureFolderKey(folder) {
    if (!cryptoReady || !window.LeZwuenCrypto || !currentUserId) {
      return false;
    }

    const existingKey = window.LeZwuenCrypto.getFolderKey(folder.id);
    if (existingKey) {
      return true;
    }

    const ownerPublicKey = window.LeZwuenCrypto.getStoredPublicKey();
    if (!ownerPublicKey) {
      return false;
    }

    const ownerPublicKeyObj = await window.LeZwuenCrypto.importPublicKey(ownerPublicKey);
    const sharedKey = await window.LeZwuenCrypto.deriveSharedKey(
      privateKey,
      ownerPublicKeyObj,
      folderKeyInfo(folder.id, currentUserId, currentUserId)
    );

    if (folder.encrypted_key && folder.key_iv) {
      try {
        const rawKey = await window.LeZwuenCrypto.decryptRaw(
          folder.encrypted_key,
          folder.key_iv,
          sharedKey
        );
        const rawKeyBase64 = window.LeZwuenCrypto.arrayBufferToBase64(rawKey);
        window.LeZwuenCrypto.storeFolderKey(folder.id, rawKeyBase64);
        return true;
      } catch (error) {
        return false;
      }
    }

    const rawKeyBase64 = await window.LeZwuenCrypto.generateFolderKey();
    const encrypted = await window.LeZwuenCrypto.encryptRaw(
      window.LeZwuenCrypto.base64ToArrayBuffer(rawKeyBase64),
      sharedKey
    );
    const token = getAuthToken();
    if (!token) {
      return false;
    }

    try {
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
      return true;
    } catch (error) {
      return false;
    }
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

  function setMessagingEnabled(enabled) {
    if (messageInput) {
      messageInput.disabled = !enabled;
    }
    if (shareSelect) {
      shareSelect.disabled = !enabled;
    }
    if (messageForm) {
      messageForm.querySelectorAll("button").forEach((button) => {
        button.disabled = !enabled;
      });
    }
  }

  function loadCurrentUser() {
    const stored = localStorage.getItem("lezwuenUser");
    if (!stored) {
      return;
    }

    try {
      const parsed = JSON.parse(stored);
      if (parsed && parsed.id) {
        currentUserId = parsed.id;
      }
    } catch (error) {
      currentUserId = null;
    }
  }

  function renderRequests(incoming, outgoing) {
    if (!requestList) {
      return;
    }

    requestList.textContent = "";

    if (!incoming.length && !outgoing.length) {
      const empty = document.createElement("div");
      empty.className = "panel-status";
      empty.textContent = "No pending requests.";
      requestList.appendChild(empty);
      return;
    }

    incoming.forEach((request) => {
      const item = document.createElement("div");
      item.className = "request-item";

      const name = document.createElement("div");
      name.className = "request-name";
      name.textContent = request.display_name || request.email;

      const actions = document.createElement("div");
      actions.className = "request-actions";

      const acceptButton = document.createElement("button");
      acceptButton.type = "button";
      acceptButton.className = "primary";
      acceptButton.textContent = "Accept";
      acceptButton.addEventListener("click", () => respondToRequest(request.id, true));

      const declineButton = document.createElement("button");
      declineButton.type = "button";
      declineButton.className = "ghost";
      declineButton.textContent = "Decline";
      declineButton.addEventListener("click", () => respondToRequest(request.id, false));

      actions.append(acceptButton, declineButton);
      item.append(name, actions);
      requestList.appendChild(item);
    });

    outgoing.forEach((request) => {
      const item = document.createElement("div");
      item.className = "request-item";

      const name = document.createElement("div");
      name.className = "request-name";
      name.textContent = `${request.display_name || request.email} (pending)`;

      item.appendChild(name);
      requestList.appendChild(item);
    });
  }

  function renderFriends() {
    if (!friendList) {
      return;
    }

    friendList.textContent = "";
    if (!friends.length) {
      const empty = document.createElement("div");
      empty.className = "panel-status";
      empty.textContent = "No friends yet.";
      friendList.appendChild(empty);
      return;
    }

    friends.forEach((friend) => {
      const item = document.createElement("div");
      item.className = "friend-item";
      if (selectedFriend && selectedFriend.id === friend.id) {
        item.classList.add("active");
      }

      const button = document.createElement("button");
      button.type = "button";
      button.className = "friend-button";
      button.textContent = friend.display_name || friend.email;
      button.addEventListener("click", () => selectFriend(friend));

      item.appendChild(button);
      friendList.appendChild(item);
    });
  }

  async function resolveMessageBody(message) {
    if (message.body_ciphertext && message.body_iv) {
      if (!cryptoReady || !window.LeZwuenCrypto || !currentUserId) {
        return "[Encrypted message]";
      }

      const otherUserId =
        message.sender_id === currentUserId ? message.recipient_id : message.sender_id;
      const otherPublicKey = friendKeys.get(otherUserId);
      if (!otherPublicKey) {
        return "[Encrypted message]";
      }

      try {
        const sharedKey = await getConversationKey(otherUserId, otherPublicKey);
        return await window.LeZwuenCrypto.decryptText(
          message.body_ciphertext,
          message.body_iv,
          sharedKey
        );
      } catch (error) {
        return "[Encrypted message]";
      }
    }

    return message.body || "";
  }

  async function renderMessages(messages) {
    if (!messagesList) {
      return;
    }

    messagesList.textContent = "";
    if (!messages.length) {
      const empty = document.createElement("div");
      empty.className = "panel-status";
      empty.textContent = "No messages yet.";
      messagesList.appendChild(empty);
      return;
    }

    for (const message of messages) {
      const bubble = document.createElement("div");
      bubble.className = "message-bubble";
      if (currentUserId && message.sender_id === currentUserId) {
        bubble.classList.add("outgoing");
      }

      const bodyText = await resolveMessageBody(message);
      if (bodyText) {
        const text = document.createElement("p");
        text.className = "message-text";
        text.textContent = bodyText;
        bubble.appendChild(text);
      }

      if (message.share_folder_id) {
        const share = document.createElement("div");
        share.className = "message-share";

        const label = document.createElement("span");
        label.textContent = message.share_folder_name
          ? `Shared folder: ${message.share_folder_name}`
          : "Shared folder";

        const button = document.createElement("button");
        button.type = "button";
        button.className = "message-share-button";
        button.textContent = "Open";
        button.addEventListener("click", () => {
          window.location.href = `/notes.html?shared=${message.share_folder_id}`;
        });

        share.append(label, button);
        bubble.appendChild(share);
      }

      messagesList.appendChild(bubble);
    }
  }

  function setConversationHeader(friend) {
    if (conversationTitle) {
      conversationTitle.textContent = friend ? friend.display_name || friend.email : "Select a friend";
    }
    if (conversationMeta) {
      conversationMeta.textContent = friend ? friend.email || "" : "";
    }
  }

  async function loadFriendRequests() {
    const token = getAuthToken();
    if (!token) {
      setStatus(friendStatus, "Sign in to manage friends.", "error");
      return;
    }

    try {
      const response = await fetch(apiUrl("/api/friend-requests"), {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setStatus(friendStatus, data.error || "Unable to load requests.", "error");
        return;
      }

      renderRequests(data.incoming || [], data.outgoing || []);
    } catch (error) {
      setStatus(friendStatus, "Unable to load requests.", "error");
    }
  }

  async function loadFriends() {
    const token = getAuthToken();
    if (!token) {
      setStatus(friendStatus, "Sign in to manage friends.", "error");
      return;
    }

    try {
      const response = await fetch(apiUrl("/api/friends"), {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setStatus(friendStatus, data.error || "Unable to load friends.", "error");
        return;
      }

      friends = Array.isArray(data.friends) ? data.friends : [];
      friendKeys.clear();
      friends.forEach((friend) => {
        if (friend.public_key) {
          friendKeys.set(friend.id, friend.public_key);
        }
      });
      renderFriends();
      if (selectedFriend) {
        const stillThere = friends.find((friend) => friend.id === selectedFriend.id);
        if (!stillThere) {
          selectedFriend = null;
          setConversationHeader(null);
          await renderMessages([]);
          setMessagingEnabled(false);
        }
      }
    } catch (error) {
      setStatus(friendStatus, "Unable to load friends.", "error");
    }
  }

  async function loadShareFolders() {
    const token = getAuthToken();
    if (!token || !shareSelect) {
      return;
    }

    await initCrypto();

    try {
      const response = await fetch(apiUrl("/api/folders"), {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        return;
      }

      const own = Array.isArray(data.folders) ? data.folders : [];
      ownShareFolders = own;
      if (cryptoReady) {
        await Promise.all(own.map((folder) => ensureFolderKey(folder)));
      }
      shareSelect.textContent = "";
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Share a folder";
      shareSelect.appendChild(placeholder);

      own.forEach((folder) => {
        const option = document.createElement("option");
        option.value = folder.id;
        option.textContent = folder.name;
        shareSelect.appendChild(option);
      });
    } catch (error) {
      // ignore
    }
  }

  async function selectFriend(friend) {
    selectedFriend = friend;
    renderFriends();
    setConversationHeader(friend);
    setMessagingEnabled(true);
    if (shareSelect) {
      shareSelect.value = "";
    }
    setStatus(messageStatus, "", null);
    await loadMessages();
  }

  async function loadMessages() {
    if (!selectedFriend || !messagesList) {
      return;
    }

    const token = getAuthToken();
    if (!token) {
      setStatus(messageStatus, "Sign in to send messages.", "error");
      return;
    }

    if (!cryptoReady) {
      await initCrypto();
    }

    try {
      const response = await fetch(apiUrl(`/api/messages/${selectedFriend.id}`), {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setStatus(messageStatus, data.error || "Unable to load messages.", "error");
        return;
      }

      const messages = Array.isArray(data.messages) ? data.messages : [];
      if (messages.some((message) => message.body_ciphertext) && !cryptoReady) {
        await ensureCryptoUnlocked(messageStatus);
      }
      await renderMessages(messages);
    } catch (error) {
      setStatus(messageStatus, "Unable to load messages.", "error");
    }
  }

  async function respondToRequest(requestId, accept) {
    const token = getAuthToken();
    if (!token) {
      setStatus(friendStatus, "Sign in to respond.", "error");
      return;
    }

    const endpoint = accept
      ? `/api/friend-requests/${requestId}/accept`
      : `/api/friend-requests/${requestId}/decline`;

    try {
      const response = await fetch(apiUrl(endpoint), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setStatus(friendStatus, data.error || "Unable to update request.", "error");
        return;
      }

      await loadFriendRequests();
      await loadFriends();
    } catch (error) {
      setStatus(friendStatus, "Unable to update request.", "error");
    }
  }

  if (friendForm) {
    friendForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const token = getAuthToken();
      if (!token) {
        setStatus(friendStatus, "Sign in to add friends.", "error");
        return;
      }

      const email = friendInput ? friendInput.value.trim() : "";
      if (!email) {
        setStatus(friendStatus, "Enter an email.", "error");
        return;
      }

      setStatus(friendStatus, "Sending...");

      try {
        const response = await fetch(apiUrl("/api/friend-requests"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ email })
        });
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          setStatus(friendStatus, data.error || "Unable to send request.", "error");
          return;
        }

        if (friendInput) {
          friendInput.value = "";
        }
        setStatus(friendStatus, "Request sent.", "success");
        await loadFriendRequests();
      } catch (error) {
        setStatus(friendStatus, "Unable to send request.", "error");
      }
    });
  }

  if (messageForm) {
    messageForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const token = getAuthToken();
      if (!token) {
        setStatus(messageStatus, "Sign in to send messages.", "error");
        return;
      }

      if (!selectedFriend) {
        setStatus(messageStatus, "Select a friend first.", "error");
        return;
      }

      const body = messageInput ? messageInput.value.trim() : "";
      const shareFolderId = shareSelect && shareSelect.value ? Number(shareSelect.value) : null;

      if (!body && !shareFolderId) {
        setStatus(messageStatus, "Write a message or share a folder.", "error");
        return;
      }

      if (!cryptoReady || !currentUserId) {
        const unlocked = await ensureCryptoUnlocked(messageStatus);
        if (!unlocked || !currentUserId) {
          setStatus(messageStatus, "Unlock encryption to send messages.", "error");
          return;
        }
      }

      setStatus(messageStatus, "Sending...");

      try {
        const payload = {
          recipientId: selectedFriend.id,
          shareFolderId: shareFolderId || undefined
        };
        const recipientPublicKey = friendKeys.get(selectedFriend.id);

        if (body) {
          if (!recipientPublicKey) {
            setStatus(messageStatus, "Recipient encryption key missing.", "error");
            return;
          }
          const sharedKey = await getConversationKey(selectedFriend.id, recipientPublicKey);
          const encrypted = await window.LeZwuenCrypto.encryptText(body, sharedKey);
          payload.body = "";
          payload.bodyCiphertext = encrypted.ciphertext;
          payload.bodyIv = encrypted.iv;
          payload.bodyVersion = 1;
        }

        if (shareFolderId) {
          if (!recipientPublicKey) {
            setStatus(messageStatus, "Recipient encryption key missing.", "error");
            return;
          }
          let folderKeyBase64 = window.LeZwuenCrypto.getFolderKey(shareFolderId);
          if (!folderKeyBase64) {
            const targetFolder = ownShareFolders.find(
              (folder) => String(folder.id) === String(shareFolderId)
            );
            if (targetFolder) {
              await ensureFolderKey(targetFolder);
              folderKeyBase64 = window.LeZwuenCrypto.getFolderKey(shareFolderId);
            }
          }
          if (!folderKeyBase64) {
            setStatus(messageStatus, "Open the folder once before sharing it.", "error");
            return;
          }
          const shareKey = await window.LeZwuenCrypto.deriveSharedKey(
            privateKey,
            await window.LeZwuenCrypto.importPublicKey(recipientPublicKey),
            folderKeyInfo(shareFolderId, currentUserId, selectedFriend.id)
          );
          const encryptedFolderKey = await window.LeZwuenCrypto.encryptRaw(
            window.LeZwuenCrypto.base64ToArrayBuffer(folderKeyBase64),
            shareKey
          );
          payload.shareFolderKey = encryptedFolderKey.ciphertext;
          payload.shareFolderKeyIv = encryptedFolderKey.iv;
          payload.shareFolderKeyVersion = 1;
        }

        const response = await fetch(apiUrl("/api/messages"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify(payload)
        });
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          setStatus(messageStatus, data.error || "Unable to send message.", "error");
          return;
        }

        if (messageInput) {
          messageInput.value = "";
        }
        if (shareSelect) {
          shareSelect.value = "";
        }
        setStatus(messageStatus, "Sent.", "success");
        await loadMessages();
      } catch (error) {
        setStatus(messageStatus, "Unable to send message.", "error");
      }
    });
  }

  loadCurrentUser();
  window.addEventListener("lezwuen-lock", () => {
    cryptoReady = false;
    privateKey = null;
    publicKey = null;
    setStatus(messageStatus, "Session locked. Unlock to continue.", "error");
  });
  initCrypto();
  setMessagingEnabled(false);
  loadFriendRequests();
  loadFriends();
  loadShareFolders();
})();
