const tabs = document.querySelectorAll(".tab");
const forms = document.querySelectorAll(".auth-form");
const ageGate = document.querySelector("[data-age-gate]");
const ageCheckbox = document.querySelector("[data-age-checkbox]");
const ageConfirm = document.querySelector("[data-age-confirm]");
const ageStorageKey = "lezwuenAgeConfirmed";
const apiBaseUrl = window.APP_CONFIG && window.APP_CONFIG.API_BASE_URL ? window.APP_CONFIG.API_BASE_URL : "";
let pendingSignupForm = null;

function apiUrl(path) {
  if (!apiBaseUrl) {
    return path;
  }
  return new URL(path, apiBaseUrl).toString();
}

function isAgeConfirmed() {
  return localStorage.getItem(ageStorageKey) === "true";
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

async function confirmAgeWithServer(token) {
  if (!token) {
    return;
  }

  try {
    await fetch(apiUrl("/api/age-gate"), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` }
    });
  } catch (error) {
    // Best-effort: age gate can be confirmed later if needed.
  }
}

function setMode(mode) {
  tabs.forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.tab === mode);
  });

  forms.forEach((form) => {
    form.classList.toggle("active", form.dataset.form === mode);
  });
}

async function submitAuth(form, endpoint) {
  const email = form.querySelector("input[name='email']").value.trim();
  const password = form.querySelector("input[name='password']").value;
  const displayNameInput = form.querySelector("input[name='displayName']");
  const displayName = displayNameInput ? displayNameInput.value.trim() : "";
  const message = form.querySelector(".form-message");
  const button = form.querySelector("button[type='submit']");
  const originalLabel = button.textContent;

  message.textContent = "";
  message.removeAttribute("data-type");
  button.disabled = true;
  button.textContent = "Working...";

  try {
    if (endpoint === "/api/signup") {
      if (displayName.length < 2 || displayName.length > 32) {
        message.textContent = "Display name must be 2-32 characters.";
        message.setAttribute("data-type", "error");
        return;
      }
    }

    const response = await fetch(apiUrl(endpoint), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        endpoint === "/api/signup" ? { email, password, displayName } : { email, password }
      )
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      message.textContent = data.error || "Something went wrong.";
      message.setAttribute("data-type", "error");
      return;
    }

    if (data.user) {
      localStorage.setItem("lezwuenUser", JSON.stringify(data.user));
    }

    if (data.token) {
      localStorage.setItem("lezwuenAuthToken", data.token);
    }

    if (endpoint === "/api/signup" && data.token && isAgeConfirmed()) {
      await confirmAgeWithServer(data.token);
    }

    message.textContent = "Success. Redirecting...";
    message.setAttribute("data-type", "success");
    window.location.href = data.redirect || "/skeleton.html";
  } catch (error) {
    message.textContent = "Network error. Please try again.";
    message.setAttribute("data-type", "error");
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

tabs.forEach((tab) => {
  tab.addEventListener("click", () => setMode(tab.dataset.tab));
});

document.getElementById("login-form").addEventListener("submit", (event) => {
  event.preventDefault();
  submitAuth(event.currentTarget, "/api/login");
});

document.getElementById("signup-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const message = form.querySelector(".form-message");

  if (!isAgeConfirmed()) {
    pendingSignupForm = form;
    if (message) {
      message.textContent = "Age verification is required to create an account.";
      message.setAttribute("data-type", "error");
    }
    showAgeGate();
    return;
  }

  submitAuth(form, "/api/signup");
});

if (ageConfirm) {
  ageConfirm.addEventListener("click", () => {
    if (!ageCheckbox || !ageCheckbox.checked) {
      const message = pendingSignupForm
        ? pendingSignupForm.querySelector(".form-message")
        : null;
      if (message) {
        message.textContent = "Please confirm your age to continue.";
        message.setAttribute("data-type", "error");
      }
      return;
    }

    localStorage.setItem(ageStorageKey, "true");
    hideAgeGate();

    if (pendingSignupForm) {
      submitAuth(pendingSignupForm, "/api/signup");
      pendingSignupForm = null;
    }
  });
}

setMode("login");
