const avatarImages = Array.from(document.querySelectorAll("[data-avatar-img]"));
const avatarInput = document.querySelector("[data-avatar-input]");
const uploadStatus = document.querySelector("[data-upload-status]");
const defaultAvatar = "avatar-placeholder.svg";
const apiBaseUrl = window.APP_CONFIG && window.APP_CONFIG.API_BASE_URL ? window.APP_CONFIG.API_BASE_URL : "";

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

function updateAvatar(url) {
  const nextUrl = normalizeAvatarUrl(url);
  avatarImages.forEach((img) => {
    img.src = nextUrl;
  });
}

function setStoredUser(user) {
  if (!user || !user.id) {
    return;
  }

  localStorage.setItem("lezwuenUser", JSON.stringify(user));
}

function getAuthToken() {
  return localStorage.getItem("lezwuenAuthToken");
}

async function loadProfile() {
  const token = getAuthToken();
  updateAvatar(defaultAvatar);

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
      }
      setStoredUser(data.user);
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

avatarImages.forEach((img) => {
  img.addEventListener("error", () => {
    if (!img.src.includes(defaultAvatar)) {
      img.src = defaultAvatar;
    }
  });
});

loadProfile();
