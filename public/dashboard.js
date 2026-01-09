(() => {
  const investedValue = document.querySelector("[data-dashboard-value='invested']");
  const profitValue = document.querySelector("[data-dashboard-value='profit']");
  const investedBar = document.querySelector("[data-dashboard-bar='invested']");
  const profitBar = document.querySelector("[data-dashboard-bar='profit']");
  const status = document.querySelector("[data-dashboard-status]");
  const updated = document.querySelector("[data-dashboard-updated]");
  const refreshButton = document.querySelector("[data-dashboard-refresh]");
  const salesTotalValue = document.querySelector("[data-dashboard-sales-total]");
  const salesCountValue = document.querySelector("[data-dashboard-sales-count]");
  const expenseTotalValue = document.querySelector("[data-dashboard-expense-total]");

  if (!investedValue || !profitValue || !investedBar || !profitBar) {
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

  function getCurrency() {
    return (
      localStorage.getItem("lezwuenSalesCurrency") ||
      localStorage.getItem("lezwuenExpenseCurrency") ||
      "USD"
    );
  }

  function formatNumber(value, decimals) {
    return value.toLocaleString("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  function formatCurrency(value) {
    return `${getCurrency()} ${formatNumber(value, 2)}`;
  }

  async function fetchSummary(path) {
    const token = getAuthToken();
    if (!token) {
      return null;
    }
    try {
      const response = await fetch(apiUrl(path), {
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

  function setStatus(message) {
    if (!status) {
      return;
    }
    status.textContent = message;
  }

  function renderChart(invested, profit) {
    investedValue.textContent = formatCurrency(invested);
    profitValue.textContent = formatCurrency(profit);
    if (profit < 0) {
      profitValue.setAttribute("data-type", "negative");
      profitBar.setAttribute("data-type", "negative");
    } else {
      profitValue.removeAttribute("data-type");
      profitBar.removeAttribute("data-type");
    }

    const maxValue = Math.max(Math.abs(invested), Math.abs(profit), 1);
    investedBar.style.height = `${Math.min((Math.abs(invested) / maxValue) * 100, 100)}%`;
    profitBar.style.height = `${Math.min((Math.abs(profit) / maxValue) * 100, 100)}%`;
  }

  async function refreshDashboard() {
    const token = getAuthToken();
    if (!token) {
      investedValue.textContent = "--";
      profitValue.textContent = "--";
      investedBar.style.height = "0%";
      profitBar.style.height = "0%";
      profitValue.removeAttribute("data-type");
      profitBar.removeAttribute("data-type");
      if (salesTotalValue) {
        salesTotalValue.textContent = "--";
      }
      if (salesCountValue) {
        salesCountValue.textContent = "--";
      }
      if (expenseTotalValue) {
        expenseTotalValue.textContent = "--";
      }
      if (updated) {
        updated.textContent = "";
      }
      setStatus("Sign in to sync.");
      return;
    }

    const [expenseSummary, salesSummary] = await Promise.all([
      fetchSummary("/api/expenses/summary"),
      fetchSummary("/api/sales/summary")
    ]);

    const invested = expenseSummary && Number.isFinite(expenseSummary.total)
      ? expenseSummary.total
      : 0;
    const salesTotal = salesSummary && Number.isFinite(salesSummary.total)
      ? salesSummary.total
      : 0;
    const profit = salesTotal - invested;

    renderChart(invested, profit);

    if (salesTotalValue) {
      salesTotalValue.textContent = formatCurrency(salesTotal);
    }
    if (salesCountValue) {
      salesCountValue.textContent = salesSummary ? `${salesSummary.count}` : "0";
    }
    if (expenseTotalValue) {
      expenseTotalValue.textContent = formatCurrency(invested);
    }

    if (!salesSummary || salesSummary.count === 0) {
      setStatus("Log sales to see profit.");
    } else if (!expenseSummary || expenseSummary.count === 0) {
      setStatus("Add expenses to see full profit.");
    } else {
      setStatus("Synced with sales tracker.");
    }

    if (updated) {
      updated.textContent = `Last refresh: ${new Date().toLocaleString()}`;
    }
  }

  if (refreshButton) {
    refreshButton.addEventListener("click", refreshDashboard);
  }

  refreshDashboard();
})();
