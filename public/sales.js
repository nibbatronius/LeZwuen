(() => {
  const form = document.querySelector("[data-sales-form]");
  if (!form) {
    return;
  }

  const nameInput = document.querySelector("[data-sales-name]");
  const unitsInput = document.querySelector("[data-sales-units]");
  const unitPriceInput = document.querySelector("[data-sales-unit-price]");
  const dateInput = document.querySelector("[data-sales-date]");
  const status = document.querySelector("[data-sales-status]");
  const list = document.querySelector("[data-sales-list]");
  const resetButton = document.querySelector("[data-sales-reset]");
  const currencySelect = document.querySelector("[data-sales-currency]");
  const currencyPrefixes = Array.from(
    document.querySelectorAll("[data-sales-currency-prefix]")
  );
  const totalPreview = document.querySelector("[data-sales-total]");

  const totalValue = document.querySelector("[data-sales-total-value]");
  const countValue = document.querySelector("[data-sales-count]");
  const unitsValue = document.querySelector("[data-sales-units-total]");
  const averageValue = document.querySelector("[data-sales-average]");
  const avgPriceValue = document.querySelector("[data-sales-avg-price]");

  const CURRENCY_KEY = "lezwuenSalesCurrency";
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

  let sales = [];

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

  function formatUnits(value) {
    if (value === null || value === undefined) {
      return "--";
    }
    if (Math.abs(value - Math.round(value)) < 0.0001) {
      return `${Math.round(value)}`;
    }
    return formatNumber(value, 2);
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

  function parseValue(rawValue) {
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

    const lastSale = shared.sales && shared.sales.last_sale ? shared.sales.last_sale : null;
    if (nameInput && !nameInput.value && lastSale && lastSale.name) {
      nameInput.value = lastSale.name;
    }
    if (unitsInput && !unitsInput.value && lastSale && lastSale.units) {
      unitsInput.value = String(lastSale.units);
    }
    if (unitPriceInput && !unitPriceInput.value && lastSale && lastSale.unit_price) {
      unitPriceInput.value = String(lastSale.unit_price);
    }

    const summary = shared.sales && shared.sales.summary ? shared.sales.summary : null;
    if (unitPriceInput && !unitPriceInput.value && summary && summary.avg_unit_price) {
      unitPriceInput.value = formatNumber(summary.avg_unit_price, 2);
    }

    if (unitPriceInput && !unitPriceInput.value) {
      const sharedProfit = shared.profit && Array.isArray(shared.profit.products)
        ? shared.profit.products
        : [];
      if (sharedProfit.length) {
        let priceTotal = 0;
        let priceCount = 0;
        sharedProfit.forEach((product) => {
          const price = parseValue(product.price);
          if (price !== null) {
            priceTotal += price;
            priceCount += 1;
          }
        });
        if (priceCount > 0) {
          unitPriceInput.value = formatNumber(priceTotal / priceCount, 2);
        }
      }
    }
  }

  function updateTotalPreview() {
    const units = parseValue(unitsInput ? unitsInput.value : "");
    const unitPrice = parseValue(unitPriceInput ? unitPriceInput.value : "");
    if (!totalPreview) {
      return;
    }
    if (!units || !unitPrice) {
      totalPreview.textContent = "Estimated total: --";
      return;
    }
    const total = units * unitPrice;
    totalPreview.textContent = `Estimated total: ${formatCurrency(total)}`;
  }

  function renderSales() {
    if (!list) {
      return;
    }
    list.textContent = "";

    if (!sales.length) {
      const empty = document.createElement("div");
      empty.className = "sales-empty";
      empty.textContent = "No sales yet.";
      list.appendChild(empty);
    } else {
      sales
        .slice()
        .sort((a, b) => (b.sale_date || "").localeCompare(a.sale_date || ""))
        .forEach((sale) => {
          const item = document.createElement("div");
          item.className = "sales-item";

          const header = document.createElement("div");
          header.className = "sales-item-header";

          const name = document.createElement("div");
          name.className = "sales-item-name";
          name.textContent = sale.name || "Untitled";

          const total = document.createElement("div");
          total.className = "sales-item-amount";
          total.textContent = formatCurrency(
            sale.total || 0,
            sale.currency || (currencySelect ? currencySelect.value : "USD")
          );

          header.append(name, total);

          const footer = document.createElement("div");
          footer.className = "sales-item-footer";

          const meta = document.createElement("div");
          meta.className = "sales-item-meta";
          const units = sale.units !== null && sale.units !== undefined ? formatUnits(sale.units) : "--";
          meta.textContent = `${units} units - ${formatDate(sale.sale_date)}`;

          const remove = document.createElement("button");
          remove.type = "button";
          remove.className = "ghost sales-item-remove";
          remove.textContent = "Remove";
          remove.dataset.saleId = sale.id;

          footer.append(meta, remove);
          item.append(header, footer);
          list.appendChild(item);
        });
    }

    const totalRevenue = sales.reduce((sum, sale) => sum + (sale.total || 0), 0);
    const totalUnits = sales.reduce((sum, sale) => sum + (sale.units || 0), 0);
    const count = sales.length;
    const avgSale = count ? totalRevenue / count : null;
    const avgUnitPrice = totalUnits ? totalRevenue / totalUnits : null;

    if (totalValue) {
      totalValue.textContent = formatCurrency(totalRevenue);
    }
    if (countValue) {
      countValue.textContent = `${count}`;
    }
    if (unitsValue) {
      unitsValue.textContent = formatUnits(totalUnits);
    }
    if (averageValue) {
      averageValue.textContent = avgSale !== null ? formatCurrency(avgSale) : "--";
    }
    if (avgPriceValue) {
      avgPriceValue.textContent = avgUnitPrice !== null ? formatCurrency(avgUnitPrice) : "--";
    }

    if (sharedData) {
      const currency = currencySelect ? currencySelect.value : "USD";
      sharedData.merge({
        currency,
        sales: {
          summary: {
            total_revenue: totalRevenue,
            total_units: totalUnits,
            avg_unit_price: avgUnitPrice
          }
        }
      });
    }
  }

  async function fetchSales() {
    const token = getAuthToken();
    if (!token) {
      sales = [];
      renderSales();
      setStatus("Sign in to load sales.");
      return;
    }

    try {
      const response = await fetch(apiUrl("/api/sales"), {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Request failed");
      }
      sales = Array.isArray(data.sales) ? data.sales : [];
      renderSales();
      setStatus("");
    } catch (error) {
      setStatus("Unable to load sales.", "error");
    }
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
  renderSales();
  fetchSales();
  updateTotalPreview();

  if (dateInput && !dateInput.value) {
    dateInput.value = new Date().toISOString().slice(0, 10);
  }

  if (unitsInput) {
    unitsInput.addEventListener("input", updateTotalPreview);
  }
  if (unitPriceInput) {
    unitPriceInput.addEventListener("input", updateTotalPreview);
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    setStatus("");

    const name = nameInput ? nameInput.value.trim() : "";
    const units = parseValue(unitsInput ? unitsInput.value : "");
    const unitPrice = parseValue(unitPriceInput ? unitPriceInput.value : "");
    const dateValue = dateInput ? dateInput.value : "";

    if (!units || units <= 0) {
      setStatus("Enter units sold.", "error");
      return;
    }

    if (!unitPrice || unitPrice <= 0) {
      setStatus("Enter a unit price.", "error");
      return;
    }

    const token = getAuthToken();
    if (!token) {
      setStatus("Please sign in first.", "error");
      return;
    }

    const payload = {
      name: name || "Untitled",
      units,
      unitPrice,
      date: dateValue || new Date().toISOString().slice(0, 10),
      currency: currencySelect ? currencySelect.value : "USD"
    };

    fetch(apiUrl("/api/sales"), {
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
        if (data && data.sale) {
          sales.unshift(data.sale);
          renderSales();
        }
        if (sharedData) {
          sharedData.merge({
            currency: currencySelect ? currencySelect.value : "USD",
            sales: {
              last_sale: {
                name: name || "Untitled",
                units,
                unit_price: unitPrice,
                date: dateValue || new Date().toISOString().slice(0, 10)
              }
            }
          });
        }
        if (nameInput) {
          nameInput.value = "";
        }
        if (unitsInput) {
          unitsInput.value = "";
        }
        if (unitPriceInput) {
          unitPriceInput.value = "";
        }
        if (dateInput) {
          dateInput.value = new Date().toISOString().slice(0, 10);
        }
        updateTotalPreview();
        setStatus("Sale added.", "success");
      })
      .catch((error) => {
        setStatus(error.message || "Unable to save sale.", "error");
      });
  });

  if (list) {
    list.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      const id = target.dataset.saleId;
      if (!id) {
        return;
      }
      const token = getAuthToken();
      if (!token) {
        setStatus("Please sign in first.", "error");
        return;
      }
      fetch(apiUrl(`/api/sales/${id}`), {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      })
        .then((response) => response.json().then((data) => ({ ok: response.ok, data })))
        .then(({ ok, data }) => {
          if (!ok) {
            throw new Error(data && data.error ? data.error : "Request failed");
          }
          sales = sales.filter((sale) => String(sale.id) !== String(id));
          renderSales();
          setStatus("Sale removed.", "success");
        })
        .catch((error) => {
          setStatus(error.message || "Unable to delete sale.", "error");
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
      fetch(apiUrl("/api/sales"), {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      })
        .then((response) => response.json().then((data) => ({ ok: response.ok, data })))
        .then(({ ok, data }) => {
          if (!ok) {
            throw new Error(data && data.error ? data.error : "Request failed");
          }
          sales = [];
          renderSales();
          setStatus("All sales cleared.", "success");
        })
        .catch((error) => {
          setStatus(error.message || "Unable to clear sales.", "error");
        });
    });
  }

  if (currencySelect) {
    currencySelect.addEventListener("change", () => {
      localStorage.setItem(CURRENCY_KEY, currencySelect.value);
      updateCurrencyPrefixes();
      renderSales();
      updateTotalPreview();
      if (sharedData) {
        sharedData.setCurrency(currencySelect.value);
      }
    });
  }
})();
