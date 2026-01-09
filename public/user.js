const avatarImages = Array.from(document.querySelectorAll("[data-avatar-img]"));
const avatarInput = document.querySelector("[data-avatar-input]");
const uploadStatus = document.querySelector("[data-upload-status]");
const profileStatus = document.querySelector("[data-profile-status]");
const logoutButton = document.querySelector("[data-logout]");
const defaultAvatar = "avatar-placeholder.svg";
const apiBaseUrl = window.APP_CONFIG && window.APP_CONFIG.API_BASE_URL ? window.APP_CONFIG.API_BASE_URL : "";
const profileFields = ["display_name", "email"];
const accountTypeValue = document.querySelector("[data-profile-value='account_type']");

const profileElements = profileFields.reduce((acc, field) => {
  acc[field] = {
    value: document.querySelector(`[data-profile-value='${field}']`),
    input: document.querySelector(`[data-profile-input='${field}']`),
    edit: document.querySelector(`[data-profile-edit='${field}']`),
    save: document.querySelector(`[data-profile-save='${field}']`),
    cancel: document.querySelector(`[data-profile-cancel='${field}']`),
    editor: document.querySelector(`[data-profile-editor='${field}']`)
  };
  return acc;
}, {});

function apiUrl(path) {
  if (!apiBaseUrl) {
    return path;
  }
  return new URL(path, apiBaseUrl).toString();
}

function normalizeAvatarUrl(url) {
  if (!url) {
    return defaultAvatar;
  }

  if (/^https?:\/\//i.test(url) || url.startsWith("data:")) {
    return url;
  }

  if (url.startsWith("/")) {
    return apiUrl(url);
  }

  if (url.startsWith("uploads/")) {
    return apiUrl(`/${url}`);
  }

  return apiUrl(`/uploads/${url}`);
}

function setStatus(message, type) {
  if (!uploadStatus) {
    return;
  }

  uploadStatus.textContent = message;
  if (type) {
    uploadStatus.setAttribute("data-type", type);
  } else {
    uploadStatus.removeAttribute("data-type");
  }
}

function setProfileStatus(message, type) {
  if (!profileStatus) {
    return;
  }

  profileStatus.textContent = message;
  if (type) {
    profileStatus.setAttribute("data-type", type);
  } else {
    profileStatus.removeAttribute("data-type");
  }
}

function updateAvatar(url) {
  const nextUrl = normalizeAvatarUrl(url);
  avatarImages.forEach((img) => {
    img.src = nextUrl;
  });
}

function syncProfileFromStorage() {
  const storedUser = getStoredUser();
  if (storedUser) {
    updateProfileFields(storedUser);
    if (storedUser.profile_image_url) {
      updateAvatar(storedUser.profile_image_url);
    } else {
      updateAvatar(defaultAvatar);
    }
  } else {
    updateAvatar(defaultAvatar);
  }
}

function updateProfileFields(user) {
  if (!user) {
    return;
  }

  const displayNameValue = profileElements.display_name.value;
  const displayNameInput = profileElements.display_name.input;
  if (displayNameValue) {
    displayNameValue.textContent = user.display_name || "Not set";
  }
  if (displayNameInput) {
    displayNameInput.value = user.display_name || "";
  }

  const emailValue = profileElements.email.value;
  const emailInput = profileElements.email.input;
  if (emailValue) {
    emailValue.textContent = user.email || "Not set";
  }
  if (emailInput) {
    emailInput.value = user.email || "";
  }

  if (accountTypeValue) {
    const accountType = String(user.account_type || "guest").toLowerCase();
    accountTypeValue.textContent = accountType === "owner" ? "Owner" : "Guest";
    accountTypeValue.setAttribute("data-type", accountType);
  }
}

function setStoredUser(user) {
  if (!user || !user.id) {
    return;
  }

  localStorage.setItem("lezwuenUser", JSON.stringify(user));
  updateProfileFields(user);
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

async function loadProfile() {
  const token = getAuthToken();
  syncProfileFromStorage();

  if (!token) {
    return;
  }

  try {
    const response = await fetch(apiUrl("/api/me"), {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await response.json().catch(() => ({}));

    if (response.ok && data.user) {
      if (data.user.profile_image_url) {
        updateAvatar(data.user.profile_image_url);
      } else {
        updateAvatar(defaultAvatar);
      }
      setStoredUser(data.user);
      updateProfileFields(data.user);
    }
  } catch (error) {
    setStatus("Unable to load profile.", "error");
  }
}

async function uploadAvatar(file) {
  const token = getAuthToken();
  if (!token) {
    setStatus("Please sign in first.", "error");
    return;
  }

  if (!file.type.startsWith("image/")) {
    setStatus("Choose an image file.", "error");
    return;
  }

  if (file.size > 1500000) {
    setStatus("Max size is 1.5MB.", "error");
    return;
  }

  setStatus("Uploading...");

  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const response = await fetch(apiUrl("/api/profile-image"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ imageData: reader.result })
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setStatus(data.error || "Upload failed.", "error");
        return;
      }

      updateAvatar(data.url);
      const storedUser = getStoredUser();
      if (storedUser) {
        storedUser.profile_image_url = data.url;
        setStoredUser(storedUser);
      }
      setStatus("Saved.", "success");
    } catch (error) {
      setStatus("Upload failed.", "error");
    }
  };

  reader.onerror = () => {
    setStatus("Upload failed.", "error");
  };

  reader.readAsDataURL(file);
}

function toggleProfileEditor(field, show) {
  const elements = profileElements[field];
  if (!elements) {
    return;
  }

  if (elements.editor) {
    elements.editor.hidden = !show;
  }
  if (elements.edit) {
    elements.edit.hidden = show;
  }
  if (show && elements.input) {
    elements.input.focus();
  }
}

function validateProfileField(field, value) {
  if (field === "display_name") {
    if (value.length < 2 || value.length > 32) {
      return "Display name must be 2-32 characters.";
    }
  }

  if (field === "email") {
    if (!value || !value.includes("@")) {
      return "Please enter a valid email.";
    }
  }

  return "";
}

async function saveProfileField(field) {
  const token = getAuthToken();
  const elements = profileElements[field];
  if (!elements || !elements.input) {
    return;
  }

  if (!token) {
    setProfileStatus("Please sign in to update your profile.", "error");
    return;
  }

  const value = elements.input.value.trim();
  const errorMessage = validateProfileField(field, value);
  if (errorMessage) {
    setProfileStatus(errorMessage, "error");
    return;
  }

  const payload = field === "display_name" ? { displayName: value } : { email: value };

  try {
    const response = await fetch(apiUrl("/api/profile"), {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      setProfileStatus(data.error || "Unable to update profile.", "error");
      return;
    }

    setProfileStatus("Updated.", "success");
    setStoredUser(data.user);
    toggleProfileEditor(field, false);
  } catch (error) {
    setProfileStatus("Unable to update profile.", "error");
  }
}

if (avatarInput) {
  avatarInput.addEventListener("change", (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) {
      return;
    }

    uploadAvatar(file);
    event.target.value = "";
  });
}

profileFields.forEach((field) => {
  const elements = profileElements[field];
  if (!elements) {
    return;
  }

  if (elements.edit) {
    elements.edit.addEventListener("click", () => {
      if (elements.value && elements.input) {
        const currentValue = elements.value.textContent;
        elements.input.value = currentValue === "Not set" ? "" : currentValue;
      }
      setProfileStatus("", null);
      toggleProfileEditor(field, true);
    });
  }

  if (elements.save) {
    elements.save.addEventListener("click", () => saveProfileField(field));
  }

  if (elements.cancel) {
    elements.cancel.addEventListener("click", () => {
      const storedUser = getStoredUser();
      if (storedUser) {
        updateProfileFields(storedUser);
      }
      setProfileStatus("", null);
      toggleProfileEditor(field, false);
    });
  }

  if (elements.input) {
    elements.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        saveProfileField(field);
      }
    });
  }
});

avatarImages.forEach((img) => {
  img.addEventListener("error", () => {
    if (!img.src.includes(defaultAvatar)) {
      img.src = defaultAvatar;
    }
  });
});

window.addEventListener("storage", (event) => {
  if (event.key === "lezwuenUser" || event.key === "lezwuenAuthToken") {
    syncProfileFromStorage();
    if (event.key === "lezwuenAuthToken" && event.newValue) {
      loadProfile();
    }
  }
});

window.addEventListener("pageshow", () => {
  if (getAuthToken()) {
    loadProfile();
  } else {
    syncProfileFromStorage();
  }
});

loadProfile();

if (logoutButton) {
  logoutButton.addEventListener("click", () => {
    if (window.LeZwuenCrypto) {
      window.LeZwuenCrypto.lockNow();
    }
    localStorage.removeItem("lezwuenAuthToken");
    localStorage.removeItem("lezwuenUser");
    window.location.href = "/index.html";
  });
}
