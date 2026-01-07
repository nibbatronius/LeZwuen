(() => {
  const apiBaseUrl =
    window.APP_CONFIG && window.APP_CONFIG.API_BASE_URL ? window.APP_CONFIG.API_BASE_URL : "";
  const grid = document.querySelector("[data-post-it-grid]");
  const composeSection = document.querySelector("[data-post-it-compose]");
  const form = document.querySelector("[data-post-it-form]");
  const input = document.querySelector("[data-post-it-input]");
  const clearButton = document.querySelector("[data-post-it-clear]");
  const composeStatus = document.querySelector("[data-post-it-status]");
  const emptyState = document.querySelector("[data-post-it-empty]");
  const folderForm = document.querySelector("[data-folder-form]");
  const folderInput = document.querySelector("[data-folder-input]");
  const folderStatus = document.querySelector("[data-folder-status]");
  const folderList = document.querySelector("[data-folder-list]");
  const sharedFolderList = document.querySelector("[data-shared-folder-list]");
  const folderTitle = document.querySelector("[data-folder-title]");
  const folderMeta = document.querySelector("[data-folder-meta]");
  const urlParams = new URLSearchParams(window.location.search);
  const sharedParam = urlParams.get("shared");
  const folderParam = urlParams.get("folder");

  let postItCount = 0;
  let folders = [];
  let sharedFolders = [];
  let selectedFolderId = null;
  let selectedFolderType = "own";

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
    if (composeSection) {
      composeSection.hidden = !enabled;
    }
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

  function clearPostIts() {
    if (!grid) {
      return;
    }

    const existing = grid.querySelectorAll("[data-post-it-item]");
    existing.forEach((item) => item.remove());
    postItCount = 0;
  }

  function updateEmptyState() {
    if (!emptyState) {
      return;
    }
    emptyState.hidden = postItCount !== 0;
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

  function createPostIt(postIt, index, canEdit) {
    const section = document.createElement("section");
    section.className = "post-it";
    if (index % 2 === 1) {
      section.classList.add("post-it-alt");
    }
    section.setAttribute("data-post-it-id", postIt.id);
    section.setAttribute("data-post-it-item", "");

    const body = document.createElement("p");
    body.className = "post-it-text";

    let currentBody = String(postIt.body || "");
    renderPostBody(currentBody, body);

    if (!canEdit) {
      section.append(body);
      return section;
    }

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

  function appendPostIt(postIt, canEdit) {
    const element = createPostIt(postIt, postItCount, canEdit);
    insertPostIt(element);
    postItCount += 1;
    updateEmptyState();
  }

  function setFolderHeader(folder, isShared) {
    if (folderTitle) {
      folderTitle.textContent = folder ? folder.name : "Notes";
    }
    if (folderMeta) {
      if (!folder) {
        folderMeta.textContent = "";
      } else if (isShared) {
        folderMeta.textContent = `Shared from ${folder.owner_display_name || ""}`.trim();
      } else {
        folderMeta.textContent = "Your folder";
      }
    }
  }

  async function loadPostIts(folderId) {
    clearPostIts();
    updateEmptyState();

    if (!folderId) {
      return;
    }

    const token = getAuthToken();
    if (!token) {
      setComposeEnabled(false);
      setStatus(composeStatus, "Sign in to manage your notes.", "error");
      updateEmptyState();
      return;
    }

    try {
      const response = await fetch(apiUrl(`/api/folders/${folderId}/post-its`), {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setStatus(composeStatus, data.error || "Unable to load notes.", "error");
        updateEmptyState();
        return;
      }

      const notes = Array.isArray(data.postIts) ? data.postIts : [];
      const canEdit = Boolean(data.canEdit);
      notes.forEach((note) => appendPostIt(note, canEdit));
      updateEmptyState();
    } catch (error) {
      setStatus(composeStatus, "Unable to load notes.", "error");
      updateEmptyState();
    }
  }

  function updateFolderSelection(folderId, type, folder) {
    selectedFolderId = folderId;
    selectedFolderType = type;

    const isShared = type === "shared";
    setComposeEnabled(!isShared);
    setFolderHeader(folder, isShared);

    if (folderList) {
      folderList.querySelectorAll(".folder-button").forEach((button) => {
        button.classList.toggle("active", button.dataset.folderId === String(folderId));
      });
    }
    if (sharedFolderList) {
      sharedFolderList.querySelectorAll(".folder-button").forEach((button) => {
        button.classList.toggle("active", button.dataset.folderId === String(folderId));
      });
    }

    setStatus(composeStatus, "", null);
    loadPostIts(folderId);
  }

  function renderFolderList(list, items, type) {
    if (!list) {
      return;
    }

    list.textContent = "";
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "folder-status";
      empty.textContent = type === "shared" ? "No shared folders yet." : "No folders yet.";
      list.appendChild(empty);
      return;
    }

    items.forEach((folder) => {
      const item = document.createElement("div");
      item.className = "folder-item";

      const button = document.createElement("button");
      button.type = "button";
      button.className = "folder-button";
      button.textContent =
        type === "shared" && folder.owner_display_name
          ? `${folder.name} - ${folder.owner_display_name}`
          : folder.name;
      button.dataset.folderId = String(folder.id);
      button.addEventListener("click", () => {
        updateFolderSelection(folder.id, type, folder);
      });

      if (String(folder.id) === String(selectedFolderId)) {
        button.classList.add("active");
      }

      item.appendChild(button);

      if (type === "own") {
        const renameButton = document.createElement("button");
        renameButton.type = "button";
        renameButton.className = "folder-action";
        renameButton.textContent = "Rename";
        renameButton.addEventListener("click", () => renameFolder(folder));

        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "folder-action";
        deleteButton.textContent = "Delete";
        deleteButton.addEventListener("click", () => deleteFolder(folder));

        item.append(renameButton, deleteButton);
      }

      list.appendChild(item);
    });
  }

  function renderFolders() {
    renderFolderList(folderList, folders, "own");
    renderFolderList(sharedFolderList, sharedFolders, "shared");
  }

  async function renameFolder(folder) {
    const nextName = window.prompt("Rename folder", folder.name);
    if (!nextName) {
      return;
    }

    const token = getAuthToken();
    if (!token) {
      setStatus(folderStatus, "Sign in to rename folders.", "error");
      return;
    }

    setStatus(folderStatus, "Saving...");

    try {
      const response = await fetch(apiUrl(`/api/folders/${folder.id}`), {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ name: nextName })
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setStatus(folderStatus, data.error || "Unable to rename folder.", "error");
        return;
      }

      folders = folders.map((item) => (item.id === folder.id ? data.folder : item));
      renderFolders();
      if (selectedFolderId === folder.id) {
        setFolderHeader(data.folder, false);
      }
      setStatus(folderStatus, "Saved.", "success");
    } catch (error) {
      setStatus(folderStatus, "Unable to rename folder.", "error");
    }
  }

  async function deleteFolder(folder) {
    if (!window.confirm("Delete this folder and all its notes?")) {
      return;
    }

    const token = getAuthToken();
    if (!token) {
      setStatus(folderStatus, "Sign in to delete folders.", "error");
      return;
    }

    setStatus(folderStatus, "Deleting...");

    try {
      const response = await fetch(apiUrl(`/api/folders/${folder.id}`), {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setStatus(folderStatus, data.error || "Unable to delete folder.", "error");
        return;
      }

      folders = folders.filter((item) => item.id !== folder.id);
      renderFolders();
      setStatus(folderStatus, "Deleted.", "success");

      if (selectedFolderId === folder.id) {
        const nextFolder = folders[0] || sharedFolders[0];
        if (nextFolder) {
          updateFolderSelection(
            nextFolder.id,
            folders.includes(nextFolder) ? "own" : "shared",
            nextFolder
          );
        } else {
          selectedFolderId = null;
          setFolderHeader(null, false);
          clearPostIts();
          updateEmptyState();
        }
      }
    } catch (error) {
      setStatus(folderStatus, "Unable to delete folder.", "error");
    }
  }

  async function loadFolders() {
    const token = getAuthToken();
    if (!token) {
      setComposeEnabled(false);
      setStatus(folderStatus, "Sign in to manage folders.", "error");
      setStatus(composeStatus, "Sign in to manage your notes.", "error");
      updateEmptyState();
      return;
    }

    try {
      const response = await fetch(apiUrl("/api/folders"), {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setStatus(folderStatus, data.error || "Unable to load folders.", "error");
        return;
      }

      folders = Array.isArray(data.folders) ? data.folders : [];
      sharedFolders = Array.isArray(data.sharedFolders) ? data.sharedFolders : [];
      renderFolders();

      let initialFolder = null;
      let initialType = "own";

      if (sharedParam) {
        initialFolder = sharedFolders.find((item) => String(item.id) === String(sharedParam));
        if (initialFolder) {
          initialType = "shared";
        }
      }

      if (!initialFolder && folderParam) {
        initialFolder = folders.find((item) => String(item.id) === String(folderParam));
      }

      if (!initialFolder && folders.length) {
        initialFolder = folders[0];
      }

      if (!initialFolder && sharedFolders.length) {
        initialFolder = sharedFolders[0];
        initialType = "shared";
      }

      if (initialFolder) {
        updateFolderSelection(initialFolder.id, initialType, initialFolder);
      } else {
        setComposeEnabled(false);
        setFolderHeader(null, false);
        updateEmptyState();
      }
    } catch (error) {
      setStatus(folderStatus, "Unable to load folders.", "error");
    }
  }

  if (folderForm) {
    folderForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const token = getAuthToken();
      if (!token) {
        setStatus(folderStatus, "Sign in to create folders.", "error");
        return;
      }

      const name = folderInput ? folderInput.value.trim() : "";
      if (!name) {
        setStatus(folderStatus, "Enter a folder name.", "error");
        return;
      }

      setStatus(folderStatus, "Creating...");

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
          setStatus(folderStatus, data.error || "Unable to create folder.", "error");
          return;
        }

        folders = [...folders, data.folder];
        renderFolders();
        if (folderInput) {
          folderInput.value = "";
        }
        setStatus(folderStatus, "Created.", "success");
        updateFolderSelection(data.folder.id, "own", data.folder);
      } catch (error) {
        setStatus(folderStatus, "Unable to create folder.", "error");
      }
    });
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

      if (!selectedFolderId || selectedFolderType !== "own") {
        setStatus(composeStatus, "Select one of your folders first.", "error");
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
          body: JSON.stringify({ body, folderId: selectedFolderId })
        });
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          setStatus(composeStatus, data.error || "Unable to save note.", "error");
          return;
        }

        if (data.postIt) {
          appendPostIt(data.postIt, true);
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

  loadFolders();
})();
