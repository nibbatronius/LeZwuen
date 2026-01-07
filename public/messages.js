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

  function apiUrl(path) {
    if (!apiBaseUrl) {
      return path;
    }
    return new URL(path, apiBaseUrl).toString();
  }

  function getAuthToken() {
    return localStorage.getItem("lezwuenAuthToken");
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

  function renderMessages(messages) {
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

    messages.forEach((message) => {
      const bubble = document.createElement("div");
      bubble.className = "message-bubble";
      if (currentUserId && message.sender_id === currentUserId) {
        bubble.classList.add("outgoing");
      }

      if (message.body) {
        const text = document.createElement("p");
        text.className = "message-text";
        text.textContent = message.body;
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
          window.location.href = `/home.html?shared=${message.share_folder_id}`;
        });

        share.append(label, button);
        bubble.appendChild(share);
      }

      messagesList.appendChild(bubble);
    });
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
      renderFriends();
      if (selectedFriend) {
        const stillThere = friends.find((friend) => friend.id === selectedFriend.id);
        if (!stillThere) {
          selectedFriend = null;
          setConversationHeader(null);
          renderMessages([]);
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

    try {
      const response = await fetch(apiUrl("/api/folders"), {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        return;
      }

      const own = Array.isArray(data.folders) ? data.folders : [];
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

    try {
      const response = await fetch(apiUrl(`/api/messages/${selectedFriend.id}`), {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setStatus(messageStatus, data.error || "Unable to load messages.", "error");
        return;
      }

      renderMessages(Array.isArray(data.messages) ? data.messages : []);
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

      setStatus(messageStatus, "Sending...");

      try {
        const response = await fetch(apiUrl("/api/messages"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            recipientId: selectedFriend.id,
            body,
            shareFolderId: shareFolderId || undefined
          })
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
  setMessagingEnabled(false);
  loadFriendRequests();
  loadFriends();
  loadShareFolders();
})();
