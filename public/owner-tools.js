(() => {
  const ownerOnlyElements = Array.from(document.querySelectorAll("[data-owner-only]"));
  const gateElement = document.querySelector("[data-owner-gate]");

  if (!ownerOnlyElements.length && !gateElement) {
    return;
  }

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

  function isOwner(user) {
    return user && String(user.account_type || "").toLowerCase() === "owner";
  }

  function setOwnerVisibility(isOwnerUser) {
    ownerOnlyElements.forEach((element) => {
      element.hidden = !isOwnerUser;
    });
    if (!isOwnerUser && gateElement) {
      window.location.href = "/home.html";
    }
  }

  const token = getAuthToken();
  if (!token) {
    setOwnerVisibility(false);
    return;
  }

  const storedUser = getStoredUser();
  const storedOwner = isOwner(storedUser);
  if (storedOwner) {
    ownerOnlyElements.forEach((element) => {
      element.hidden = false;
    });
  }

  fetch(apiUrl("/api/me"), {
    headers: { Authorization: `Bearer ${token}` }
  })
    .then((response) => (response.ok ? response.json() : Promise.reject()))
    .then((data) => {
      if (data && data.user) {
        localStorage.setItem("lezwuenUser", JSON.stringify(data.user));
        setOwnerVisibility(isOwner(data.user));
      } else {
        setOwnerVisibility(false);
      }
    })
    .catch(() => {
      if (!storedUser || !storedOwner) {
        setOwnerVisibility(false);
      }
    });
})();
