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
  const sharedData = window.LeZwuenSharedData;

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

  function buildExpenseNote() {
    const lines = [];
    const now = new Date();
    const summary = expenses.reduce(
      (acc, expense) => {
        const amount = expense.amount || 0;
        const category = expense.category || "Other";
        acc.total += amount;
        acc.by_category[category] = (acc.by_category[category] || 0) + amount;
        return acc;
      },
      { total: 0, by_category: {} }
    );

    lines.push("Expense Tracker Snapshot");
    lines.push(`Date: ${now.toLocaleString()}`);
    lines.push(`Currency: ${currencySelect ? currencySelect.value : "USD"}`);
    lines.push("");
    lines.push("Summary:");
    lines.push(`- Total spent: ${formatCurrency(summary.total)}`);
    lines.push(`- Entries: ${expenses.length}`);

    lines.push("");
    lines.push("By category:");
    const categories = Object.entries(summary.by_category);
    if (!categories.length) {
      lines.push("- No expenses logged yet.");
    } else {
      categories
        .sort((a, b) => b[1] - a[1])
        .forEach(([category, amount]) => {
          lines.push(`- ${category}: ${formatCurrency(amount)}`);
        });
    }

    lines.push("");
    lines.push("Recent expenses:");
    if (!expenses.length) {
      lines.push("- No expenses logged yet.");
    } else {
      expenses
        .slice()
        .sort((a, b) => (b.expense_date || "").localeCompare(a.expense_date || ""))
        .slice(0, 6)
        .forEach((expense) => {
          lines.push(
            `- ${expense.name || "Untitled"}: ${formatCurrency(expense.amount || 0)} (${expense.category || "Other"}) on ${formatDate(
              expense.expense_date
            )}`
          );
        });
    }

    return lines.join("\n");
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

  function applySharedAutofill() {
    if (!sharedData) {
      return;
    }
    const shared = sharedData.read();
    if (currencySelect && shared.currency && currencyOptions.includes(shared.currency)) {
      currencySelect.value = shared.currency;
      localStorage.setItem(CURRENCY_KEY, shared.currency);
    }

    const lastExpense = shared.expenses && shared.expenses.last_expense
      ? shared.expenses.last_expense
      : null;
    if (nameInput && !nameInput.value && lastExpense && lastExpense.name) {
      nameInput.value = lastExpense.name;
    }
    if (amountInput && !amountInput.value && lastExpense && lastExpense.amount) {
      amountInput.value = String(lastExpense.amount);
    }
    if (categorySelect && lastExpense && lastExpense.category) {
      categorySelect.value = lastExpense.category;
    }
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

    const summary = expenses.reduce(
      (acc, expense) => {
        const amount = expense.amount || 0;
        const category = expense.category || "Other";
        acc.total += amount;
        acc.by_category[category] = (acc.by_category[category] || 0) + amount;
        return acc;
      },
      { total: 0, by_category: {} }
    );
    if (totalValue) {
      totalValue.textContent = formatCurrency(summary.total);
    }
    if (countValue) {
      countValue.textContent = `${expenses.length}`;
    }

    if (sharedData) {
      sharedData.merge({
        currency: currencySelect ? currencySelect.value : "USD",
        expenses: {
          summary: {
            total: summary.total,
            count: expenses.length,
            by_category: summary.by_category
          }
        }
      });
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
      updateProfitDisplay();
      setStatus("");
    } catch (error) {
      setStatus("Unable to load expenses.", "error");
    }
  }

  async function fetchSalesSummary() {
    const token = getAuthToken();
    if (!token) {
      return null;
    }
    try {
      const response = await fetch(apiUrl("/api/sales/summary"), {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        return null;
      }
      return data.summary || null;
    } catch (error) {
      return null;
    }
  }

  function renderProfitSync(investedTotal, salesTotal) {
    const profit = salesTotal - investedTotal;
    const currency = currencySelect ? currencySelect.value : "USD";

    if (investedValue) {
      investedValue.textContent = formatCurrency(investedTotal, currency);
    }
    if (profitValue) {
      profitValue.textContent = formatCurrency(profit, currency);
      if (profit < 0) {
        profitValue.setAttribute("data-type", "negative");
      } else {
        profitValue.removeAttribute("data-type");
      }
    }

    const maxValue = Math.max(Math.abs(investedTotal), Math.abs(profit), 1);
    const investedPercent = Math.min((Math.abs(investedTotal) / maxValue) * 100, 100);
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
      profitStatus.textContent = "Synced with sales tracker.";
    }
    if (profitUpdated) {
      profitUpdated.textContent = `Last refresh: ${new Date().toLocaleString()}`;
    }
  }

  async function updateProfitDisplay() {
    const token = getAuthToken();
    if (!token) {
      if (profitStatus) {
        profitStatus.textContent = "Sign in to sync sales and expenses.";
      }
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
      if (profitUpdated) {
        profitUpdated.textContent = "";
      }
      return;
    }

    const investedTotal = expenses.reduce((sum, expense) => sum + (expense.amount || 0), 0);
    const salesSummary = await fetchSalesSummary();
    if (!salesSummary) {
      if (profitStatus) {
        profitStatus.textContent = "Log sales to see profit.";
      }
      if (profitUpdated) {
        profitUpdated.textContent = "";
      }
      renderProfitSync(investedTotal, 0);
      return;
    }

    const salesTotal = Number.isFinite(salesSummary.total) ? salesSummary.total : 0;
    renderProfitSync(investedTotal, salesTotal);
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
    const sharedCurrency = sharedData ? sharedData.read().currency : null;
    const storedCurrency = localStorage.getItem(CURRENCY_KEY);
    const initialCurrency = sharedCurrency || storedCurrency || currencySelect.value || "USD";
    currencySelect.value = currencyOptions.includes(initialCurrency) ? initialCurrency : "USD";
    updateCurrencyPrefixes();
  }

  setupCurrency();
  applySharedAutofill();
  updateCurrencyPrefixes();
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
          updateProfitDisplay();
        }
        if (sharedData) {
          sharedData.merge({
            currency: currencySelect ? currencySelect.value : "USD",
            expenses: {
              last_expense: {
                name: name || "Untitled",
                amount,
                category,
                date: dateValue || new Date().toISOString().slice(0, 10)
              }
            }
          });
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
          updateProfitDisplay();
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
          updateProfitDisplay();
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
      if (sharedData) {
        sharedData.setCurrency(currencySelect.value);
      }
    });
  }

  if (profitRefresh) {
    profitRefresh.addEventListener("click", updateProfitDisplay);
  }

  if (window.LeZwuenPostItSave) {
    window.LeZwuenPostItSave.init({
      root: document.querySelector("[data-postit-save='expense']"),
      getContent: buildExpenseNote
    });
  }
})();
