const shareButton = document.querySelector("[data-share-location]");
const locationStatus = document.querySelector("[data-location-status]");
const roomTitle = document.querySelector("[data-room-title]");
const roomSubtitle = document.querySelector("[data-room-subtitle]");
const roomPresence = document.querySelector("[data-room-presence]");
const chatLog = document.querySelector("[data-chat-log]");
const chatForm = document.querySelector("[data-chat-form]");
const ageGate = document.querySelector("[data-age-gate]");
const ageCheckbox = document.querySelector("[data-age-checkbox]");
const ageConfirm = document.querySelector("[data-age-confirm]");
const heatMapVisual = document.querySelector("[data-heat-map-visual]");
const heatMapCount = document.querySelector("[data-heat-map-count]");

const apiBaseUrl = window.APP_CONFIG && window.APP_CONFIG.API_BASE_URL ? window.APP_CONFIG.API_BASE_URL : "";
const presenceIntervalMs = 45000;
const roomsRefreshIntervalMs = 20000;

let currentRoom = null;
let roomsCache = [];
let presenceTimer = null;
let pendingLocation = null;
const blockedIds = new Set();
let roomsRefreshTimer = null;

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
    roomTitle.textContent = "Nearby chat";
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

function ensureHeatCells() {
  if (!heatMapVisual) {
    return [];
  }

  const totalCells = 24;
  if (heatMapVisual.children.length === totalCells) {
    return Array.from(heatMapVisual.children);
  }

  heatMapVisual.textContent = "";
  const cells = [];
  for (let i = 0; i < totalCells; i += 1) {
    const cell = document.createElement("div");
    cell.className = "heat-cell";
    cell.style.setProperty("--heat", "0.15");
    heatMapVisual.append(cell);
    cells.push(cell);
  }
  return cells;
}

function updateHeatMap(rooms) {
  if (!heatMapVisual) {
    return;
  }

  const totalActive = Array.isArray(rooms)
    ? rooms.reduce((sum, room) => sum + (Number(room.activeCount) || 0), 0)
    : 0;
  if (heatMapCount) {
    heatMapCount.textContent = formatActiveCount(totalActive);
  }

  const cells = ensureHeatCells();
  const rows = 4;
  const cols = 6;
  const maxDist = Math.hypot(rows - 1, cols - 1);
  const activityFactor = Math.min(1, totalActive / 12);

  cells.forEach((cell, index) => {
    const row = Math.floor(index / cols);
    const col = index % cols;
    const dist = Math.hypot(row - (rows - 1) / 2, col - (cols - 1) / 2);
    const base = Math.max(0, 1 - dist / maxDist);
    const noise = Math.random() * 0.35;
    const intensity = Math.min(1, base * 0.55 + activityFactor * 0.75 + noise);
    cell.style.setProperty("--heat", intensity.toFixed(2));
  });
}

function updateCurrentRoomPresence() {
  if (!currentRoom || !Array.isArray(roomsCache)) {
    return;
  }

  const latestRoom = roomsCache.find((room) => room.roomKey === currentRoom.roomKey);
  if (latestRoom) {
    currentRoom = { ...currentRoom, activeCount: latestRoom.activeCount };
  }

  setRoomHeader(currentRoom);
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

async function loadBlocklist() {
  const token = getAuthToken();
  if (!token) {
    return;
  }

  try {
    const { response, data } = await apiRequest("/api/blocklist");
    if (!response.ok) {
      return;
    }

    blockedIds.clear();
    if (Array.isArray(data.blockedIds)) {
      data.blockedIds.forEach((id) => {
        const numericId = Number(id);
        if (Number.isFinite(numericId)) {
          blockedIds.add(numericId);
        }
      });
    }
  } catch (error) {
    // Blocklist is optional for rendering.
  }
}

function getCurrentUserId() {
  const user = getStoredUser();
  if (!user) {
    return null;
  }

  const id = Number(user.id);
  if (!Number.isFinite(id)) {
    return null;
  }

  return id;
}

async function blockUser(blockedUserId, displayName) {
  const numericId = Number(blockedUserId);
  if (!Number.isFinite(numericId)) {
    return;
  }

  const label = displayName || "this user";
  if (!window.confirm(`Ignore all messages from ${label}?`)) {
    return;
  }

  try {
    const { response, data } = await apiRequest("/api/block", {
      method: "POST",
      body: JSON.stringify({ blockedUserId: numericId })
    });

    if (!response.ok) {
      setStatus(data.error || "Unable to ignore this user.", "error");
      return;
    }

    blockedIds.add(numericId);
    setStatus("User ignored. Their messages are now hidden.", "success");

    if (currentRoom) {
      await loadMessages(currentRoom.roomKey);
    }
  } catch (error) {
    setStatus("Unable to ignore this user.", "error");
  }
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
      setStatus("Confirm your age to unlock nearby chat.", "error");
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
    setStatus("Location shared. Nearby chat is now available.", "success");
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
    setStatus("Location access was denied. Enable it to see nearby chat.", "error");
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

async function loadRooms(options = {}) {
  const { allowAutoSelect = true } = options;
  const token = getAuthToken();
  if (!token) {
    setStatus("Please sign in to view nearby chat.", "error");
    return;
  }

  try {
    const { response, data } = await apiRequest("/api/nearby/rooms");

    if (response.status === 403) {
      showAgeGate();
      setStatus("Confirm your age to access nearby chat.", "error");
      return;
    }

    if (response.status === 400) {
      setStatus(data.error || "Share your location to unlock nearby chat.", "info");
      return;
    }

    if (!response.ok) {
      setStatus(data.error || "Unable to load nearby chat.", "error");
      return;
    }

    roomsCache = Array.isArray(data.rooms) ? data.rooms : [];
    updateHeatMap(roomsCache);

    if (!roomsCache.length) {
      setStatus("No nearby chat available yet.", "info");
      setRoomHeader(null);
      currentRoom = null;
      if (chatLog) {
        chatLog.textContent = "Share your location to connect with nearby members.";
      }
      return;
    }

    const roomExists = currentRoom
      ? roomsCache.some((room) => room.roomKey === currentRoom.roomKey)
      : false;

    if (!roomExists && currentRoom) {
      currentRoom = null;
      setRoomHeader(null);
      if (presenceTimer) {
        clearInterval(presenceTimer);
        presenceTimer = null;
      }
    }

    updateCurrentRoomPresence();

    if (allowAutoSelect && !roomExists) {
      const closestRoom = roomsCache[0];
      await selectRoom(closestRoom);
    }

    startRoomsRefresh();
  } catch (error) {
    setStatus("Unable to load nearby chat.", "error");
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
  setRoomHeader(room);
  updateHeatMap(roomsCache);
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
  const currentUserId = getCurrentUserId();

  const visibleMessages = messages.filter((message) => {
    const id = Number(message.user_id);
    return !Number.isFinite(id) || !blockedIds.has(id);
  });

  if (!visibleMessages.length) {
    const empty = document.createElement("div");
    empty.className = "chat-empty";
    empty.textContent = "No messages yet. Start the conversation.";
    chatLog.append(empty);
    return;
  }

  visibleMessages.forEach((message) => {
    const wrapper = document.createElement("div");
    wrapper.className = "chat-message";
    const messageUserId = Number(message.user_id);
    const isCurrentUser = currentUserId && messageUserId === currentUserId;

    const meta = document.createElement("div");
    meta.className = "chat-message-meta";

    const name = document.createElement("span");
    name.className = "chat-message-name";
    name.textContent = isCurrentUser ? "You" : message.display_name || "Member";

    const time = document.createElement("span");
    time.className = "chat-message-time";
    time.textContent = formatTimestamp(message.created_at);

    meta.append(name, time);

    const body = document.createElement("p");
    body.className = "chat-message-body";
    body.textContent = message.body;

    if (currentUserId && !isCurrentUser) {
      const actions = document.createElement("div");
      actions.className = "chat-message-actions";

      const ignoreButton = document.createElement("button");
      ignoreButton.type = "button";
      ignoreButton.className = "ghost chat-ignore";
      ignoreButton.textContent = "Ignore";
      ignoreButton.addEventListener("click", () => {
        blockUser(messageUserId, message.display_name);
      });

      actions.append(ignoreButton);
      wrapper.append(meta, body, actions);
    } else {
      wrapper.append(meta, body);
    }
    chatLog.append(wrapper);
  });

  chatLog.scrollTop = chatLog.scrollHeight;
}

async function sendMessage(body) {
  if (!currentRoom) {
    setStatus("Share your location to connect before sending a message.", "error");
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

function stopRoomsRefresh() {
  if (roomsRefreshTimer) {
    clearInterval(roomsRefreshTimer);
    roomsRefreshTimer = null;
  }
}

function startRoomsRefresh() {
  if (roomsRefreshTimer) {
    return;
  }

  roomsRefreshTimer = setInterval(() => {
    if (!getAuthToken()) {
      stopRoomsRefresh();
      return;
    }

    loadRooms({ allowAutoSelect: false }).catch(() => {});
  }, roomsRefreshIntervalMs);
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
  loadBlocklist().then(loadRooms);
} else {
  updateHeatMap([]);
}
