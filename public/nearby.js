const shareButton = document.querySelector("[data-share-location]");
const locationStatus = document.querySelector("[data-location-status]");
const roomList = document.querySelector("[data-room-list]");
const roomTitle = document.querySelector("[data-room-title]");
const roomSubtitle = document.querySelector("[data-room-subtitle]");
const roomPresence = document.querySelector("[data-room-presence]");
const chatLog = document.querySelector("[data-chat-log]");
const chatForm = document.querySelector("[data-chat-form]");
const ageGate = document.querySelector("[data-age-gate]");
const ageCheckbox = document.querySelector("[data-age-checkbox]");
const ageConfirm = document.querySelector("[data-age-confirm]");

const apiBaseUrl = window.APP_CONFIG && window.APP_CONFIG.API_BASE_URL ? window.APP_CONFIG.API_BASE_URL : "";
const presenceIntervalMs = 45000;

let currentRoom = null;
let roomsCache = [];
let presenceTimer = null;
let pendingLocation = null;

function apiUrl(path) {
  if (!apiBaseUrl) {
    return path;
  }
  return new URL(path, apiBaseUrl).toString();
}

function getAuthToken() {
  return localStorage.getItem("lezwuenAuthToken");
}

function setStatus(message, type) {
  if (!locationStatus) {
    return;
  }
  locationStatus.textContent = message;
  if (type) {
    locationStatus.setAttribute("data-type", type);
  } else {
    locationStatus.removeAttribute("data-type");
  }
}

function showAgeGate() {
  if (ageGate) {
    ageGate.hidden = false;
  }
}

function hideAgeGate() {
  if (ageGate) {
    ageGate.hidden = true;
  }
}

function setRoomHeader(room) {
  if (roomTitle) {
    roomTitle.textContent = room ? room.label : "Select a room";
  }
  if (roomSubtitle) {
    roomSubtitle.textContent = room
      ? "Only your distance band is shared, not your precise location."
      : "Distance buckets protect your exact location.";
  }
  if (roomPresence) {
    roomPresence.textContent = room ? formatActiveCount(room.activeCount) : "0 active";
  }
}

function formatActiveCount(count) {
  const safeCount = Number.isFinite(count) ? count : 0;
  return safeCount === 1 ? "1 active" : `${safeCount} active`;
}

async function apiRequest(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const token = getAuthToken();

  if (token && !headers.Authorization) {
    headers.Authorization = `Bearer ${token}`;
  }

  if (options.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(apiUrl(path), { ...options, headers });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function saveLocation(coords) {
  const token = getAuthToken();
  if (!token) {
    setStatus("Please sign in to share your location.", "error");
    return;
  }

  setStatus("Saving your location...", "info");

  try {
    const { response, data } = await apiRequest("/api/location", {
      method: "POST",
      body: JSON.stringify({ lat: coords.latitude, lng: coords.longitude })
    });

    if (response.status === 403) {
      pendingLocation = coords;
      showAgeGate();
      setStatus("Confirm your age to unlock nearby rooms.", "error");
      return;
    }

    if (response.status === 401) {
      setStatus("Please sign in to share your location.", "error");
      return;
    }

    if (!response.ok) {
      setStatus(data.error || "Unable to save location.", "error");
      return;
    }

    pendingLocation = null;
    setStatus("Location shared. Nearby rooms are now available.", "success");
    await loadRooms();
  } catch (error) {
    setStatus("Unable to save location.", "error");
  }
}

function handleGeolocationError(error) {
  if (!error) {
    setStatus("Unable to access location.", "error");
    return;
  }

  if (error.code === error.PERMISSION_DENIED) {
    setStatus("Location access was denied. Enable it to see nearby rooms.", "error");
    return;
  }

  if (error.code === error.POSITION_UNAVAILABLE) {
    setStatus("Location is unavailable. Try again in a moment.", "error");
    return;
  }

  if (error.code === error.TIMEOUT) {
    setStatus("Location request timed out. Please retry.", "error");
    return;
  }

  setStatus("Unable to access location.", "error");
}

function shareLocation() {
  if (!navigator.geolocation) {
    setStatus("Location services are not available in this browser.", "error");
    return;
  }

  if (!getAuthToken()) {
    setStatus("Please sign in to share your location.", "error");
    return;
  }

  if (shareButton) {
    shareButton.disabled = true;
  }

  setStatus("Requesting location access...", "info");

  navigator.geolocation.getCurrentPosition(
    (position) => {
      saveLocation(position.coords).finally(() => {
        if (shareButton) {
          shareButton.disabled = false;
        }
      });
    },
    (error) => {
      handleGeolocationError(error);
      if (shareButton) {
        shareButton.disabled = false;
      }
    },
    {
      enableHighAccuracy: false,
      timeout: 12000,
      maximumAge: 300000
    }
  );
}

async function loadRooms() {
  if (!roomList) {
    return;
  }

  const token = getAuthToken();
  if (!token) {
    setStatus("Please sign in to view nearby rooms.", "error");
    return;
  }

  try {
    const { response, data } = await apiRequest("/api/nearby/rooms");

    if (response.status === 403) {
      showAgeGate();
      setStatus("Confirm your age to access nearby rooms.", "error");
      return;
    }

    if (response.status === 400) {
      setStatus(data.error || "Share your location to unlock nearby rooms.", "info");
      return;
    }

    if (!response.ok) {
      setStatus(data.error || "Unable to load rooms.", "error");
      return;
    }

    roomsCache = Array.isArray(data.rooms) ? data.rooms : [];
    renderRooms(roomsCache);
  } catch (error) {
    setStatus("Unable to load rooms.", "error");
  }
}

function renderRooms(rooms) {
  if (!roomList) {
    return;
  }

  roomList.textContent = "";

  if (!rooms.length) {
    const empty = document.createElement("div");
    empty.className = "room-empty";
    empty.textContent = "No nearby rooms yet. Share your location to refresh.";
    roomList.append(empty);
    return;
  }

  rooms.forEach((room) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "room-item";
    button.setAttribute("data-room-key", room.roomKey);

    if (currentRoom && currentRoom.roomKey === room.roomKey) {
      button.classList.add("active");
    }

    const label = document.createElement("span");
    label.className = "room-label";
    label.textContent = room.label;

    const count = document.createElement("span");
    count.className = "room-count";
    count.textContent = formatActiveCount(room.activeCount);

    button.append(label, count);
    button.addEventListener("click", () => selectRoom(room));
    roomList.append(button);
  });

  if (!currentRoom) {
    selectRoom(rooms[0]);
  }
}

async function joinRoom(roomKey) {
  if (!roomKey) {
    return;
  }

  try {
    await apiRequest(`/api/nearby/rooms/${encodeURIComponent(roomKey)}/join`, { method: "POST" });
  } catch (error) {
    setStatus("Unable to join room.", "error");
  }
}

async function selectRoom(room) {
  if (!room) {
    return;
  }

  currentRoom = room;
  renderRooms(roomsCache);
  setRoomHeader(room);
  await joinRoom(room.roomKey);
  await loadMessages(room.roomKey);
  startPresence(room.roomKey);
}

async function loadMessages(roomKey) {
  if (!chatLog || !roomKey) {
    return;
  }

  chatLog.textContent = "Loading messages...";

  try {
    const { response, data } = await apiRequest(
      `/api/nearby/rooms/${encodeURIComponent(roomKey)}/messages`
    );

    if (!response.ok) {
      chatLog.textContent = data.error || "Unable to load messages.";
      return;
    }

    const messages = Array.isArray(data.messages) ? data.messages : [];
    renderMessages(messages);
  } catch (error) {
    chatLog.textContent = "Unable to load messages.";
  }
}

function formatTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function renderMessages(messages) {
  if (!chatLog) {
    return;
  }

  chatLog.textContent = "";

  if (!messages.length) {
    const empty = document.createElement("div");
    empty.className = "chat-empty";
    empty.textContent = "No messages yet. Start the conversation.";
    chatLog.append(empty);
    return;
  }

  messages.forEach((message) => {
    const wrapper = document.createElement("div");
    wrapper.className = "chat-message";

    const meta = document.createElement("div");
    meta.className = "chat-message-meta";

    const name = document.createElement("span");
    name.className = "chat-message-name";
    name.textContent = message.display_name || "Member";

    const time = document.createElement("span");
    time.className = "chat-message-time";
    time.textContent = formatTimestamp(message.created_at);

    meta.append(name, time);

    const body = document.createElement("p");
    body.className = "chat-message-body";
    body.textContent = message.body;

    wrapper.append(meta, body);
    chatLog.append(wrapper);
  });

  chatLog.scrollTop = chatLog.scrollHeight;
}

async function sendMessage(body) {
  if (!currentRoom) {
    setStatus("Select a room before sending a message.", "error");
    return;
  }

  const input = chatForm ? chatForm.querySelector("input[name='message']") : null;
  const button = chatForm ? chatForm.querySelector("button[type='submit']") : null;

  if (button) {
    button.disabled = true;
  }
  if (input) {
    input.disabled = true;
  }

  try {
    const { response, data } = await apiRequest(
      `/api/nearby/rooms/${encodeURIComponent(currentRoom.roomKey)}/messages`,
      {
        method: "POST",
        body: JSON.stringify({ body })
      }
    );

    if (!response.ok) {
      setStatus(data.error || "Unable to send message.", "error");
      return;
    }

    if (input) {
      input.value = "";
    }

    await loadMessages(currentRoom.roomKey);
  } catch (error) {
    setStatus("Unable to send message.", "error");
  } finally {
    if (button) {
      button.disabled = false;
    }
    if (input) {
      input.disabled = false;
    }
  }
}

function startPresence(roomKey) {
  if (!roomKey) {
    return;
  }

  if (presenceTimer) {
    clearInterval(presenceTimer);
  }

  presenceTimer = setInterval(() => {
    apiRequest("/api/nearby/presence", {
      method: "POST",
      body: JSON.stringify({ roomKey })
    }).catch(() => {});
  }, presenceIntervalMs);
}

if (shareButton) {
  shareButton.addEventListener("click", shareLocation);
}

if (chatForm) {
  chatForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = chatForm.querySelector("input[name='message']");
    const message = input ? input.value.trim() : "";
    if (!message) {
      return;
    }
    sendMessage(message);
  });
}

if (ageConfirm) {
  ageConfirm.addEventListener("click", async () => {
    if (!ageCheckbox || !ageCheckbox.checked) {
      setStatus("Please confirm your age to continue.", "error");
      return;
    }

    try {
      const { response, data } = await apiRequest("/api/age-gate", { method: "POST" });
      if (!response.ok) {
        setStatus(data.error || "Unable to confirm age.", "error");
        return;
      }

      hideAgeGate();

      if (pendingLocation) {
        const coords = pendingLocation;
        pendingLocation = null;
        await saveLocation(coords);
      } else {
        await loadRooms();
      }
    } catch (error) {
      setStatus("Unable to confirm age.", "error");
    }
  });
}

setRoomHeader(null);
if (getAuthToken()) {
  loadRooms();
}
