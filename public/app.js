const tabs = document.querySelectorAll(".tab");
const forms = document.querySelectorAll(".auth-form");
const apiBaseUrl = window.APP_CONFIG && window.APP_CONFIG.API_BASE_URL ? window.APP_CONFIG.API_BASE_URL : "";

function apiUrl(path) {
  if (!apiBaseUrl) {
    return path;
  }
  return new URL(path, apiBaseUrl).toString();
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
  const message = form.querySelector(".form-message");
  const button = form.querySelector("button[type='submit']");
  const originalLabel = button.textContent;

  message.textContent = "";
  message.removeAttribute("data-type");
  button.disabled = true;
  button.textContent = "Working...";

  try {
    const response = await fetch(apiUrl(endpoint), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
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
  submitAuth(event.currentTarget, "/api/signup");
});

setMode("login");
