const avatarImages = Array.from(document.querySelectorAll("[data-avatar-img]"));
const avatarInput = document.querySelector("[data-avatar-input]");
const uploadStatus = document.querySelector("[data-upload-status]");
const defaultAvatar = "avatar-placeholder.svg";

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
  const nextUrl = url || defaultAvatar;
  avatarImages.forEach((img) => {
    img.src = nextUrl;
  });
}

function readCookie(name) {
  const cookies = document.cookie ? document.cookie.split("; ") : [];
  const match = cookies.find((cookie) => cookie.startsWith(`${name}=`));
  if (!match) {
    return null;
  }
  return decodeURIComponent(match.split("=").slice(1).join("="));
}

function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem("lezwuenUser"));
  } catch (error) {
    return null;
  }
}

function setStoredUser(user) {
  if (!user || !user.id) {
    return;
  }

  localStorage.setItem("lezwuenUser", JSON.stringify(user));
  localStorage.setItem("lezwuenUserId", String(user.id));
}

function getUserId() {
  const storedUser = getStoredUser();
  if (storedUser && storedUser.id) {
    return storedUser.id;
  }

  const storedId = localStorage.getItem("lezwuenUserId");
  if (storedId) {
    const parsedId = Number.parseInt(storedId, 10);
    if (Number.isInteger(parsedId)) {
      return parsedId;
    }
  }

  const cookieId = readCookie("lezwuenUserId");
  if (cookieId) {
    const parsedId = Number.parseInt(cookieId, 10);
    if (Number.isInteger(parsedId)) {
      return parsedId;
    }
  }

  return null;
}

async function loadProfile() {
  const userId = getUserId();
  updateAvatar(defaultAvatar);

  if (!userId) {
    return;
  }

  try {
    const response = await fetch(`/api/users/${userId}`);
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
  const userId = getUserId();
  if (!userId) {
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
      const response = await fetch("/api/profile-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, imageData: reader.result })
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

loadProfile();
