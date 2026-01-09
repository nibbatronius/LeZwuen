(() => {
  const form = document.querySelector("[data-expense-form]");
  if (!form) {
    return;
  }

  const nameInput = document.querySelector("[data-expense-name]");
  const amountInput = document.querySelector("[data-expense-amount]");
  const categorySelect = document.querySelector("[data-expense-category]");
  const dateInput = document.querySelector("[data-expense-date]");
  const status = document.querySelector("[data-expense-status]");
  const list = document.querySelector("[data-expense-list]");
  const totalValue = document.querySelector("[data-expense-total]");
  const countValue = document.querySelector("[data-expense-count]");
  const resetButton = document.querySelector("[data-expense-reset]");
  const currencySelect = document.querySelector("[data-expense-currency]");
  const currencyPrefixes = Array.from(
    document.querySelectorAll("[data-expense-currency-prefix]")
  );

  const profitRefresh = document.querySelector("[data-profit-refresh]");
  const profitStatus = document.querySelector("[data-profit-status]");
  const profitUpdated = document.querySelector("[data-profit-updated]");
  const investedValue = document.querySelector("[data-profit-value='invested']");
  const profitValue = document.querySelector("[data-profit-value='profit']");
  const investedBar = document.querySelector("[data-profit-bar='invested']");
  const profitBar = document.querySelector("[data-profit-bar='profit']");

  const CURRENCY_KEY = "lezwuenExpenseCurrency";
  const currencyOptions = [
    "USD",
    "EUR",
    "GBP",
    "JPY",
    "CAD",
    "AUD",
    "CHF",
    "SEK",
    "NOK",
    "DKK",
    "INR",
    "BRL",
    "MXN",
    "ZAR",
    "SGD",
    "HKD",
    "CNY"
  ];
  const currencyCodes = new Set(currencyOptions.map((code) => code.toUpperCase()));

  const apiBaseUrl =
    window.APP_CONFIG && window.APP_CONFIG.API_BASE_URL ? window.APP_CONFIG.API_BASE_URL : "";

  let expenses = [];

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
    if (!status) {
      return;
    }
    status.textContent = message;
    if (type) {
      status.setAttribute("data-type", type);
    } else {
      status.removeAttribute("data-type");
    }
  }

  function formatNumber(value, decimals) {
    return value.toLocaleString("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  function formatCurrency(value, currencyCode) {
    const code = currencyCode || (currencySelect ? currencySelect.value : "USD");
    return `${code} ${formatNumber(value, 2)}`;
  }

  function formatDate(value) {
    if (!value) {
      return "No date";
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return value;
    }
    return parsed.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric"
    });
  }

  function parseAmount(rawValue) {
    const trimmed = String(rawValue || "").trim();
    if (!trimmed) {
      return null;
    }
    let cleaned = trimmed.replace(/,/g, "").replace(/\$/g, "");
    const upper = cleaned.toUpperCase();
    for (const code of currencyCodes) {
      if (upper.startsWith(code)) {
        cleaned = cleaned.slice(code.length).trim();
        break;
      }
    }
    const parsed = Number.parseFloat(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function updateCurrencyPrefixes() {
    if (!currencySelect) {
      return;
    }
    currencyPrefixes.forEach((prefix) => {
      prefix.textContent = currencySelect.value || "USD";
    });
  }

  function renderExpenses() {
    if (!list) {
      return;
    }
    list.textContent = "";

    if (!expenses.length) {
      const empty = document.createElement("div");
      empty.className = "expense-empty";
      empty.textContent = "No expenses yet.";
      list.appendChild(empty);
    } else {
      expenses
        .slice()
        .sort((a, b) => (b.expense_date || "").localeCompare(a.expense_date || ""))
        .forEach((expense) => {
          const item = document.createElement("div");
          item.className = "expense-item";

          const header = document.createElement("div");
          header.className = "expense-item-header";

          const name = document.createElement("div");
          name.className = "expense-item-name";
          name.textContent = expense.name || "Untitled";

          const amount = document.createElement("div");
          amount.className = "expense-item-amount";
          amount.textContent = formatCurrency(
            expense.amount || 0,
            expense.currency || (currencySelect ? currencySelect.value : "USD")
          );

          header.append(name, amount);

          const footer = document.createElement("div");
          footer.className = "expense-item-footer";

          const meta = document.createElement("div");
          meta.className = "expense-item-meta";
          const category = expense.category || "Other";
          meta.textContent = `${category} - ${formatDate(expense.expense_date)}`;

          const remove = document.createElement("button");
          remove.type = "button";
          remove.className = "ghost expense-item-remove";
          remove.textContent = "Remove";
          remove.dataset.expenseId = expense.id;

          footer.append(meta, remove);

          item.append(header, footer);
          list.appendChild(item);
        });
    }

    const total = expenses.reduce((sum, expense) => sum + (expense.amount || 0), 0);
    if (totalValue) {
      totalValue.textContent = formatCurrency(total);
    }
    if (countValue) {
      countValue.textContent = `${expenses.length}`;
    }
  }

  async function fetchExpenses() {
    const token = getAuthToken();
    if (!token) {
      expenses = [];
      renderExpenses();
      setStatus("Sign in to load expenses.");
      return;
    }

    try {
      const response = await fetch(apiUrl("/api/expenses"), {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Request failed");
      }
      expenses = Array.isArray(data.expenses) ? data.expenses : [];
      renderExpenses();
      setStatus("");
    } catch (error) {
      setStatus("Unable to load expenses.", "error");
    }
  }

  async function fetchProfitSnapshot() {
    const token = getAuthToken();
    if (!token) {
      return null;
    }
    try {
      const response = await fetch(apiUrl("/api/profit-snapshot"), {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        return null;
      }
      return data.snapshot || null;
    } catch (error) {
      return null;
    }
  }

  function renderProfitSnapshot(snapshot) {
    if (!snapshot || typeof snapshot.invested !== "number" || typeof snapshot.profit !== "number") {
      if (investedValue) {
        investedValue.textContent = "--";
      }
      if (profitValue) {
        profitValue.textContent = "--";
        profitValue.removeAttribute("data-type");
      }
      if (investedBar) {
        investedBar.style.height = "0%";
      }
      if (profitBar) {
        profitBar.style.height = "0%";
        profitBar.removeAttribute("data-type");
      }
      if (profitStatus) {
        profitStatus.textContent = "Open the profit calculator to sync data.";
      }
      if (profitUpdated) {
        profitUpdated.textContent = "";
      }
      return;
    }

    const currency = snapshot.currency || (currencySelect ? currencySelect.value : "USD");
    const invested = snapshot.invested;
    const profit = snapshot.profit;

    if (investedValue) {
      investedValue.textContent = formatCurrency(invested, currency);
    }
    if (profitValue) {
      profitValue.textContent = formatCurrency(profit, currency);
      if (profit < 0) {
        profitValue.setAttribute("data-type", "negative");
      } else {
        profitValue.removeAttribute("data-type");
      }
    }

    const maxValue = Math.max(Math.abs(invested), Math.abs(profit), 1);
    const investedPercent = Math.min((Math.abs(invested) / maxValue) * 100, 100);
    const profitPercent = Math.min((Math.abs(profit) / maxValue) * 100, 100);

    if (investedBar) {
      investedBar.style.height = `${investedPercent}%`;
    }
    if (profitBar) {
      profitBar.style.height = `${profitPercent}%`;
      if (profit < 0) {
        profitBar.setAttribute("data-type", "negative");
      } else {
        profitBar.removeAttribute("data-type");
      }
    }

    if (profitStatus) {
      profitStatus.textContent = "Synced from profit calculator.";
    }
    if (profitUpdated) {
      const updated = snapshot.updated_at ? new Date(snapshot.updated_at) : null;
      profitUpdated.textContent = updated && !Number.isNaN(updated.getTime())
        ? `Last sync: ${updated.toLocaleString()}`
        : "";
    }
  }

  async function updateProfitDisplay() {
    const snapshot = await fetchProfitSnapshot();
    if (!snapshot && profitStatus) {
      const token = getAuthToken();
      profitStatus.textContent = token
        ? "Open the profit calculator to sync data."
        : "Sign in to sync profit data.";
    }
    renderProfitSnapshot(snapshot);
  }

  function setupCurrency() {
    if (!currencySelect) {
      return;
    }
    if (!currencySelect.options.length) {
      currencyOptions.forEach((code) => {
        const option = document.createElement("option");
        option.value = code;
        option.textContent = code;
        currencySelect.appendChild(option);
      });
    }
    const storedCurrency = localStorage.getItem(CURRENCY_KEY);
    const initialCurrency = storedCurrency || currencySelect.value || "USD";
    currencySelect.value = currencyOptions.includes(initialCurrency) ? initialCurrency : "USD";
    updateCurrencyPrefixes();
  }

  setupCurrency();
  renderExpenses();
  updateProfitDisplay();
  fetchExpenses();

  if (dateInput && !dateInput.value) {
    dateInput.value = new Date().toISOString().slice(0, 10);
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    setStatus("");

    const name = nameInput ? nameInput.value.trim() : "";
    const amount = parseAmount(amountInput ? amountInput.value : "");
    const category = categorySelect ? categorySelect.value : "Other";
    const dateValue = dateInput ? dateInput.value : "";

    if (!amount || amount <= 0) {
      setStatus("Enter a valid amount.", "error");
      return;
    }

    const token = getAuthToken();
    if (!token) {
      setStatus("Please sign in first.", "error");
      return;
    }

    const payload = {
      name: name || "Untitled",
      amount,
      category,
      date: dateValue || new Date().toISOString().slice(0, 10),
      currency: currencySelect ? currencySelect.value : "USD"
    };

    fetch(apiUrl("/api/expenses"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    })
      .then((response) => response.json().then((data) => ({ ok: response.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) {
          throw new Error(data && data.error ? data.error : "Request failed");
        }
        if (data && data.expense) {
          expenses.unshift(data.expense);
          renderExpenses();
        }
        if (nameInput) {
          nameInput.value = "";
        }
        if (amountInput) {
          amountInput.value = "";
        }
        if (dateInput) {
          dateInput.value = new Date().toISOString().slice(0, 10);
        }
        setStatus("Expense added.", "success");
      })
      .catch((error) => {
        setStatus(error.message || "Unable to save expense.", "error");
      });
  });

  if (list) {
    list.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      const id = target.dataset.expenseId;
      if (!id) {
        return;
      }
      const token = getAuthToken();
      if (!token) {
        setStatus("Please sign in first.", "error");
        return;
      }
      fetch(apiUrl(`/api/expenses/${id}`), {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      })
        .then((response) => response.json().then((data) => ({ ok: response.ok, data })))
        .then(({ ok, data }) => {
          if (!ok) {
            throw new Error(data && data.error ? data.error : "Request failed");
          }
          expenses = expenses.filter((expense) => String(expense.id) !== String(id));
          renderExpenses();
          setStatus("Expense removed.", "success");
        })
        .catch((error) => {
          setStatus(error.message || "Unable to delete expense.", "error");
        });
    });
  }

  if (resetButton) {
    resetButton.addEventListener("click", () => {
      const token = getAuthToken();
      if (!token) {
        setStatus("Please sign in first.", "error");
        return;
      }
      fetch(apiUrl("/api/expenses"), {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      })
        .then((response) => response.json().then((data) => ({ ok: response.ok, data })))
        .then(({ ok, data }) => {
          if (!ok) {
            throw new Error(data && data.error ? data.error : "Request failed");
          }
          expenses = [];
          renderExpenses();
          setStatus("All expenses cleared.", "success");
        })
        .catch((error) => {
          setStatus(error.message || "Unable to clear expenses.", "error");
        });
    });
  }

  if (currencySelect) {
    currencySelect.addEventListener("change", () => {
      localStorage.setItem(CURRENCY_KEY, currencySelect.value);
      updateCurrencyPrefixes();
      renderExpenses();
      updateProfitDisplay();
    });
  }

  if (profitRefresh) {
    profitRefresh.addEventListener("click", updateProfitDisplay);
  }
})();
