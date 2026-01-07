const apiBaseUrl = window.APP_CONFIG && window.APP_CONFIG.API_BASE_URL ? window.APP_CONFIG.API_BASE_URL : "";
const grid = document.querySelector("[data-post-it-grid]");
const composeSection = document.querySelector("[data-post-it-compose]");
const form = document.querySelector("[data-post-it-form]");
const input = document.querySelector("[data-post-it-input]");
const clearButton = document.querySelector("[data-post-it-clear]");
const composeStatus = document.querySelector("[data-post-it-status]");
const emptyState = document.querySelector("[data-post-it-empty]");
let postItCount = 0;

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

function setComposeEnabled(enabled) {
  if (input) {
    input.disabled = !enabled;
  }
  if (form) {
    form.querySelectorAll("button").forEach((button) => {
      button.disabled = !enabled;
    });
  }
}

function createLinkElement(label, url) {
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = label;
  return link;
}

function linkifyText(text) {
  const nodes = [];
  const urlPattern = /https?:\/\/[^\s]+/g;
  let lastIndex = 0;
  let match;

  while ((match = urlPattern.exec(text))) {
    if (match.index > lastIndex) {
      nodes.push(document.createTextNode(text.slice(lastIndex, match.index)));
    }
    nodes.push(createLinkElement(match[0], match[0]));
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push(document.createTextNode(text.slice(lastIndex)));
  }

  return nodes;
}

function parseLineToNodes(line) {
  const nodes = [];
  const markdownPattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let lastIndex = 0;
  let match;

  while ((match = markdownPattern.exec(line))) {
    if (match.index > lastIndex) {
      const segment = line.slice(lastIndex, match.index);
      nodes.push(...linkifyText(segment));
    }

    nodes.push(createLinkElement(match[1], match[2]));
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < line.length) {
    const tail = line.slice(lastIndex);
    nodes.push(...linkifyText(tail));
  }

  return nodes;
}

function renderPostBody(text, container) {
  container.textContent = "";
  const lines = String(text || "").split(/\r?\n/);

  lines.forEach((line, index) => {
    if (line === "") {
      container.appendChild(document.createElement("br"));
      return;
    }

    const nodes = parseLineToNodes(line);
    nodes.forEach((node) => container.appendChild(node));

    if (index < lines.length - 1) {
      container.appendChild(document.createElement("br"));
    }
  });
}

function insertPostIt(element) {
  if (!grid) {
    return;
  }

  if (emptyState && emptyState.parentNode === grid) {
    grid.insertBefore(element, emptyState);
  } else {
    grid.appendChild(element);
  }
}

function updateEmptyState() {
  if (!emptyState) {
    return;
  }
  emptyState.hidden = postItCount !== 0;
}

function createPostIt(postIt, index) {
  const section = document.createElement("section");
  section.className = "post-it";
  if (index % 2 === 1) {
    section.classList.add("post-it-alt");
  }
  section.setAttribute("data-post-it-id", postIt.id);

  const header = document.createElement("div");
  header.className = "post-it-header";

  const editButton = document.createElement("button");
  editButton.type = "button";
  editButton.className = "post-it-action";
  editButton.textContent = "Edit";

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "post-it-action";
  deleteButton.textContent = "Delete";

  header.append(editButton, deleteButton);

  const body = document.createElement("p");
  body.className = "post-it-text";

  let currentBody = String(postIt.body || "");
  renderPostBody(currentBody, body);

  const editor = document.createElement("form");
  editor.className = "post-it-editor";
  editor.hidden = true;

  const textarea = document.createElement("textarea");
  textarea.className = "post-it-input";
  textarea.rows = 7;
  textarea.value = currentBody;

  const actions = document.createElement("div");
  actions.className = "post-it-actions";

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "ghost";
  cancelButton.textContent = "Cancel";

  const saveButton = document.createElement("button");
  saveButton.type = "submit";
  saveButton.className = "primary";
  saveButton.textContent = "Save";

  actions.append(cancelButton, saveButton);

  const status = document.createElement("div");
  status.className = "post-it-status";
  status.setAttribute("aria-live", "polite");

  editor.append(textarea, actions, status);

  editButton.addEventListener("click", () => {
    editor.hidden = false;
    body.hidden = true;
    header.hidden = true;
    textarea.focus();
  });

  cancelButton.addEventListener("click", () => {
    editor.hidden = true;
    body.hidden = false;
    header.hidden = false;
    textarea.value = currentBody;
    setStatus(status, "", null);
  });

  editor.addEventListener("submit", async (event) => {
    event.preventDefault();
    const token = getAuthToken();
    if (!token) {
      setStatus(status, "Sign in to edit notes.", "error");
      return;
    }

    const nextBody = textarea.value.trim();
    if (!nextBody) {
      setStatus(status, "Note cannot be empty.", "error");
      return;
    }

    if (nextBody === currentBody) {
      editor.hidden = true;
      body.hidden = false;
      header.hidden = false;
      setStatus(status, "", null);
      return;
    }

    setStatus(status, "Saving...");

    try {
      const response = await fetch(apiUrl(`/api/post-its/${postIt.id}`), {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ body: nextBody })
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setStatus(status, data.error || "Unable to save note.", "error");
        return;
      }

      currentBody = data.postIt && data.postIt.body ? data.postIt.body : nextBody;
      renderPostBody(currentBody, body);
      editor.hidden = true;
      body.hidden = false;
      header.hidden = false;
      setStatus(status, "Saved.", "success");
    } catch (error) {
      setStatus(status, "Unable to save note.", "error");
    }
  });

  deleteButton.addEventListener("click", async () => {
    const token = getAuthToken();
    if (!token) {
      setStatus(composeStatus, "Sign in to delete notes.", "error");
      return;
    }

    if (!window.confirm("Delete this note?")) {
      return;
    }

    try {
      const response = await fetch(apiUrl(`/api/post-its/${postIt.id}`), {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setStatus(composeStatus, data.error || "Unable to delete note.", "error");
        return;
      }

      section.remove();
      postItCount = Math.max(0, postItCount - 1);
      updateEmptyState();
    } catch (error) {
      setStatus(composeStatus, "Unable to delete note.", "error");
    }
  });

  section.append(header, body, editor);
  return section;
}

function appendPostIt(postIt) {
  const element = createPostIt(postIt, postItCount);
  insertPostIt(element);
  postItCount += 1;
  updateEmptyState();
}

async function loadPostIts() {
  const token = getAuthToken();
  if (!token) {
    setComposeEnabled(false);
    setStatus(composeStatus, "Sign in to manage your notes.", "error");
    updateEmptyState();
    return;
  }

  setComposeEnabled(true);

  try {
    const response = await fetch(apiUrl("/api/post-its"), {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      setStatus(composeStatus, data.error || "Unable to load notes.", "error");
      updateEmptyState();
      return;
    }

    const notes = Array.isArray(data.postIts) ? data.postIts : [];
    notes.forEach((note) => appendPostIt(note));
    updateEmptyState();
  } catch (error) {
    setStatus(composeStatus, "Unable to load notes.", "error");
    updateEmptyState();
  }
}

if (clearButton) {
  clearButton.addEventListener("click", () => {
    if (input) {
      input.value = "";
    }
    setStatus(composeStatus, "", null);
  });
}

if (form) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const token = getAuthToken();
    if (!token) {
      setStatus(composeStatus, "Sign in to add notes.", "error");
      return;
    }

    const body = input ? input.value.trim() : "";
    if (!body) {
      setStatus(composeStatus, "Write something first.", "error");
      return;
    }

    setStatus(composeStatus, "Saving...");

    try {
      const response = await fetch(apiUrl("/api/post-its"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ body })
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setStatus(composeStatus, data.error || "Unable to save note.", "error");
        return;
      }

      if (data.postIt) {
        appendPostIt(data.postIt);
      }

      if (input) {
        input.value = "";
      }
      setStatus(composeStatus, "Saved.", "success");
    } catch (error) {
      setStatus(composeStatus, "Unable to save note.", "error");
    }
  });
}

loadPostIts();
