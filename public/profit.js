(() => {
  const currencySelect = document.querySelector("[data-currency]");
  if (!currencySelect) {
    return;
  }

  const cogsInput = document.querySelector("[data-input='cogs']");
  const overheadInput = document.querySelector("[data-input='overhead']");
  const addProductButton = document.querySelector("[data-add-product]");
  const productsBody = document.querySelector("[data-products]");
  const goalProductsBody = document.querySelector("[data-goal-products]");
  const dashboardToggle = document.querySelector("[data-dashboard-toggle]");
  const summaryDashboard = document.querySelector("[data-dashboard='summary']");
  const goalDashboard = document.querySelector("[data-dashboard='goal']");
  const saveButton = document.querySelector("[data-save]");
  const loadButton = document.querySelector("[data-load]");
  const loadInput = document.querySelector("[data-load-input]");
  const resetButton = document.querySelector("[data-reset]");
  const setGoalButton = document.querySelector("[data-set-goal]");
  const goalMeterFill = document.querySelector("[data-goal-meter]");
  const marginBadge = document.querySelector("[data-margin-badge]");

  const outputValues = {
    revenue: document.querySelector("[data-output='revenue']"),
    profit: document.querySelector("[data-output='profit']"),
    margin: document.querySelector("[data-output='margin']"),
    breakeven: document.querySelector("[data-output='breakeven']"),
    rev_unit: document.querySelector("[data-output='rev_unit']"),
    cost_ratio: document.querySelector("[data-output='cost_ratio']")
  };

  const outputTags = {
    revenue: document.querySelector("[data-output-tag='revenue']"),
    profit: document.querySelector("[data-output-tag='profit']"),
    margin: document.querySelector("[data-output-tag='margin']"),
    breakeven: document.querySelector("[data-output-tag='breakeven']")
  };

  const goalValues = {
    goal_revenue: document.querySelector("[data-goal='goal_revenue']"),
    goal_profit: document.querySelector("[data-goal='goal_profit']"),
    goal_margin: document.querySelector("[data-goal='goal_margin']"),
    goal_breakeven: document.querySelector("[data-goal='goal_breakeven']"),
    sold_revenue: document.querySelector("[data-goal='sold_revenue']"),
    sold_units: document.querySelector("[data-goal='sold_units']"),
    remaining_units: document.querySelector("[data-goal='remaining_units']"),
    goal_percent: document.querySelector("[data-goal='goal_percent']")
  };

  const goalTags = {
    sold_revenue_tag: document.querySelector("[data-goal-tag='sold_revenue_tag']"),
    sold_units_tag: document.querySelector("[data-goal-tag='sold_units_tag']"),
    remaining_units_tag: document.querySelector("[data-goal-tag='remaining_units_tag']")
  };

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

  let productRows = [];
  let activeDashboard = "summary";
  let goalData = {
    revenue: null,
    profit: null,
    margin: null,
    breakeven: null
  };
  let currentMetrics = {
    revenue: null,
    profit: null,
    margin: null,
    breakeven: null,
    unit_price: null,
    cost_ratio: null
  };

  function formatNumber(value, decimals) {
    return value.toLocaleString("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  function formatCurrency(value) {
    return `${currencySelect.value} ${formatNumber(value, 2)}`;
  }

  function formatPercent(value) {
    return `${value.toFixed(1)}%`;
  }

  function formatUnits(value) {
    if (value === null) {
      return "--";
    }
    if (Math.abs(value - Math.round(value)) < 0.0001) {
      return `${Math.round(value)}`;
    }
    return formatNumber(value, 2);
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

  function safeString(value) {
    if (value === null || value === undefined) {
      return "";
    }
    return String(value);
  }

  function setOutputValue(key, value) {
    const element = outputValues[key];
    if (element) {
      element.textContent = value;
    }
  }

  function setOutputTag(key, status, text) {
    const element = outputTags[key];
    if (!element) {
      return;
    }
    element.textContent = text;
    if (status) {
      element.setAttribute("data-type", status);
    } else {
      element.removeAttribute("data-type");
    }
  }

  function updateCurrencyPrefixes() {
    const code = currencySelect.value || "USD";
    document.querySelectorAll("[data-currency-prefix]").forEach((node) => {
      node.textContent = code;
    });
  }

  function createCompactInput(placeholder) {
    const input = document.createElement("input");
    input.type = "text";
    input.inputMode = "decimal";
    input.placeholder = placeholder || "";
    input.className = "profit-compact-input";
    return input;
  }

  function createMoneyField(placeholder) {
    const wrapper = document.createElement("div");
    wrapper.className = "profit-money-field compact";

    const prefix = document.createElement("span");
    prefix.className = "profit-currency-prefix";
    prefix.setAttribute("data-currency-prefix", "");
    prefix.textContent = currencySelect.value || "USD";

    const input = document.createElement("input");
    input.type = "text";
    input.inputMode = "decimal";
    input.placeholder = placeholder || "0.00";

    wrapper.append(prefix, input);
    return { wrapper, input };
  }

  function refreshProductLabels() {
    const disableRemove = productRows.length <= 1;
    productRows.forEach((row, index) => {
      row.label.textContent = `Product ${index + 1}`;
      row.goalLabel.textContent = `Product ${index + 1}`;
      row.removeButton.disabled = disableRemove;
    });
  }

  function addProductRow(options = {}) {
    const row = document.createElement("div");
    row.className = "profit-table-row";

    const label = document.createElement("span");
    label.className = "profit-row-label";
    label.textContent = `Product ${productRows.length + 1}`;

    const unitsInput = createCompactInput("Units");
    const priceField = createMoneyField("0.00");

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "ghost profit-remove";
    removeButton.textContent = "Remove";

    row.append(label, unitsInput, priceField.wrapper, removeButton);
    productsBody.appendChild(row);

    const goalRow = document.createElement("div");
    goalRow.className = "profit-table-row";

    const goalLabel = document.createElement("span");
    goalLabel.className = "profit-row-label";
    goalLabel.textContent = label.textContent;

    const plannedValue = document.createElement("span");
    plannedValue.className = "profit-row-value";
    plannedValue.textContent = "--";

    const soldUnitsInput = createCompactInput("Sold units");
    const soldTotalField = createMoneyField("0.00");

    const remainingValue = document.createElement("span");
    remainingValue.className = "profit-row-value";
    remainingValue.textContent = "--";

    goalRow.append(
      goalLabel,
      plannedValue,
      soldUnitsInput,
      soldTotalField.wrapper,
      remainingValue
    );
    goalProductsBody.appendChild(goalRow);

    const rowData = {
      row,
      label,
      unitsInput,
      priceInput: priceField.input,
      removeButton,
      goalRow,
      goalLabel,
      plannedValue,
      soldUnitsInput,
      soldTotalInput: soldTotalField.input,
      remainingValue
    };

    productRows.push(rowData);
    refreshProductLabels();
    updateCurrencyPrefixes();

    unitsInput.addEventListener("input", () => {
      updateMetrics();
      updateGoalProgress();
    });
    priceField.input.addEventListener("input", () => {
      updateMetrics();
      updateGoalProgress();
    });
    soldUnitsInput.addEventListener("input", updateGoalProgress);
    soldTotalField.input.addEventListener("input", updateGoalProgress);
    removeButton.addEventListener("click", () => removeProductRow(rowData));

    if (!options.silent) {
      updateMetrics();
      updateGoalProgress();
    }
  }

  function removeProductRow(rowData) {
    if (productRows.length <= 1) {
      return;
    }
    productRows = productRows.filter((row) => row !== rowData);
    rowData.row.remove();
    rowData.goalRow.remove();
    refreshProductLabels();
    updateMetrics();
    updateGoalProgress();
  }

  function setDashboard(view) {
    activeDashboard = view;
    if (summaryDashboard) {
      summaryDashboard.hidden = view !== "summary";
    }
    if (goalDashboard) {
      goalDashboard.hidden = view !== "goal";
    }
    if (dashboardToggle) {
      dashboardToggle.textContent = view === "summary" ? "View Goals" : "View Summary";
    }
  }

  function applyGoalData() {
    if (goalValues.goal_revenue) {
      goalValues.goal_revenue.textContent =
        goalData.revenue !== null ? formatCurrency(goalData.revenue) : "--";
    }
    if (goalValues.goal_profit) {
      goalValues.goal_profit.textContent =
        goalData.profit !== null ? formatCurrency(goalData.profit) : "--";
    }
    if (goalValues.goal_margin) {
      goalValues.goal_margin.textContent =
        goalData.margin !== null ? formatPercent(goalData.margin) : "--";
    }
    if (goalValues.goal_breakeven) {
      goalValues.goal_breakeven.textContent =
        goalData.breakeven !== null ? `${Math.ceil(goalData.breakeven)}` : "--";
    }
  }

  function setGoalFromCurrent() {
    goalData = {
      revenue: currentMetrics.revenue,
      profit: currentMetrics.profit,
      margin: currentMetrics.margin,
      breakeven: currentMetrics.breakeven
    };
    applyGoalData();
    updateGoalProgress();
  }

  function updateMetrics() {
    const cogs = parseValue(cogsInput.value);
    const overhead = parseValue(overheadInput.value);
    let totalRevenue = 0;
    let totalUnits = 0;
    let pricedUnits = 0;
    let hasRevenue = false;
    let hasUnits = false;

    productRows.forEach((row) => {
      const units = parseValue(row.unitsInput.value);
      const price = parseValue(row.priceInput.value);
      if (units !== null) {
        totalUnits += units;
        hasUnits = true;
      }
      if (units !== null && price !== null) {
        totalRevenue += units * price;
        pricedUnits += units;
        hasRevenue = true;
      }
    });

    const revenue = hasRevenue ? totalRevenue : null;
    const unitsPriced = pricedUnits > 0 ? pricedUnits : null;
    let unitPrice = null;

    if (revenue !== null && unitsPriced !== null) {
      unitPrice = revenue / unitsPriced;
    }

    let profitValue = null;
    let marginValue = null;
    let breakevenValue = null;
    let ratioValue = null;

    if (revenue !== null) {
      setOutputValue("revenue", formatCurrency(revenue));
      setOutputTag("revenue", "neutral", "Calculated from products");
    } else {
      setOutputValue("revenue", "--");
      setOutputTag("revenue", "neutral", "Products required");
    }

    if (revenue !== null && cogs !== null && overhead !== null) {
      const profit = revenue - cogs - overhead;
      profitValue = profit;
      setOutputValue("profit", formatCurrency(profit));
      if (profit > 0) {
        setOutputTag("profit", "positive", "Profitable");
      } else if (profit < 0) {
        setOutputTag("profit", "negative", "Loss");
      } else {
        setOutputTag("profit", "neutral", "Neutral");
      }
    } else {
      setOutputValue("profit", "--");
      if (revenue === null) {
        setOutputTag("profit", "neutral", "Products required");
      } else if (cogs === null && overhead === null) {
        setOutputTag("profit", "neutral", "Costs required");
      } else if (cogs === null) {
        setOutputTag("profit", "neutral", "COGS required");
      } else if (overhead === null) {
        setOutputTag("profit", "neutral", "Overhead required");
      } else {
        setOutputTag("profit", "neutral", "Waiting for inputs");
      }
    }

    if (revenue !== null && revenue !== 0 && cogs !== null) {
      const margin = ((revenue - cogs) / revenue) * 100;
      marginValue = margin;
      setOutputValue("margin", formatPercent(margin));
      if (marginBadge) {
        marginBadge.textContent = `Margin ${formatPercent(margin)}`;
      }
      if (margin >= 40) {
        setOutputTag("margin", "positive", "Strong margin");
      } else if (margin >= 20) {
        setOutputTag("margin", "neutral", "Stable margin");
      } else if (margin >= 0) {
        setOutputTag("margin", "warning", "Tight margin");
      } else {
        setOutputTag("margin", "negative", "Negative margin");
      }
    } else {
      setOutputValue("margin", "--");
      if (marginBadge) {
        marginBadge.textContent = "Margin";
      }
      if (revenue === null) {
        setOutputTag("margin", "neutral", "Products required");
      } else if (cogs === null) {
        setOutputTag("margin", "neutral", "COGS required");
      } else if (revenue === 0) {
        setOutputTag("margin", "neutral", "Revenue required");
      } else {
        setOutputTag("margin", "neutral", "Waiting for inputs");
      }
    }

    if (unitPrice !== null) {
      setOutputValue("rev_unit", formatCurrency(unitPrice));
    } else {
      setOutputValue("rev_unit", "--");
    }

    if (overhead !== null && cogs !== null && unitPrice !== null) {
      if (unitPrice > 0) {
        const totalCosts = overhead + cogs;
        const breakeven = totalCosts / unitPrice;
        breakevenValue = breakeven;
        if (breakeven <= 0) {
          setOutputValue("breakeven", "0");
          setOutputTag("breakeven", "positive", "Already covered");
        } else {
          setOutputValue("breakeven", `${Math.ceil(breakeven)}`);
          setOutputTag("breakeven", "neutral", "Based on total costs");
        }
      } else {
        setOutputValue("breakeven", "--");
        setOutputTag("breakeven", "warning", "Price must be > 0");
      }
    } else {
      setOutputValue("breakeven", "--");
      if (overhead === null) {
        setOutputTag("breakeven", "neutral", "Overhead required");
      } else if (cogs === null) {
        setOutputTag("breakeven", "neutral", "COGS required");
      } else if (unitPrice === null) {
        setOutputTag("breakeven", "neutral", "Price required");
      } else {
        setOutputTag("breakeven", "neutral", "Price & costs required");
      }
    }

    if (revenue !== null && revenue !== 0 && cogs !== null && overhead !== null) {
      ratioValue = ((cogs + overhead) / revenue) * 100;
      setOutputValue("cost_ratio", formatPercent(ratioValue));
    } else {
      setOutputValue("cost_ratio", "--");
    }

    currentMetrics = {
      revenue,
      profit: profitValue,
      margin: marginValue,
      breakeven: breakevenValue,
      unit_price: unitPrice,
      cost_ratio: ratioValue
    };

    updateGoalProgress();
  }

  function updateGoalProgress() {
    if (!goalProductsBody) {
      return;
    }

    let plannedUnits = 0;
    let soldUnits = 0;
    let soldRevenueTotal = 0;
    let hasPlanned = false;
    let hasSold = false;
    let hasSalesTotal = false;

    productRows.forEach((row) => {
      const planned = parseValue(row.unitsInput.value);
      const sold = parseValue(row.soldUnitsInput.value);
      const soldTotal = parseValue(row.soldTotalInput.value);

      if (planned !== null) {
        plannedUnits += planned;
        hasPlanned = true;
      }
      if (sold !== null) {
        soldUnits += sold;
        hasSold = true;
      }
      if (soldTotal !== null) {
        soldRevenueTotal += soldTotal;
        hasSalesTotal = true;
      }

      row.plannedValue.textContent = planned !== null ? formatUnits(planned) : "--";
      if (planned === null || sold === null) {
        row.remainingValue.textContent = "--";
      } else {
        row.remainingValue.textContent = formatUnits(Math.max(planned - sold, 0));
      }
    });

    const soldRevenueValue = hasSalesTotal ? soldRevenueTotal : null;
    if (goalValues.sold_revenue) {
      goalValues.sold_revenue.textContent =
        soldRevenueValue !== null ? formatCurrency(soldRevenueValue) : "--";
    }
    if (goalValues.sold_units) {
      goalValues.sold_units.textContent = hasSold ? formatUnits(soldUnits) : "--";
    }
    if (goalValues.remaining_units) {
      goalValues.remaining_units.textContent = hasPlanned
        ? formatUnits(Math.max(plannedUnits - soldUnits, 0))
        : "--";
    }

    const goalRevenue = goalData.revenue;
    if (goalTags.sold_revenue_tag) {
      if (goalRevenue && soldRevenueValue !== null) {
        const progress = Math.max((soldRevenueValue / goalRevenue) * 100, 0);
        goalTags.sold_revenue_tag.textContent = `${Math.min(progress, 999).toFixed(
          0
        )}% of revenue goal`;
      } else if (goalRevenue && !hasSalesTotal) {
        goalTags.sold_revenue_tag.textContent = "Enter sold total";
      } else if (goalRevenue) {
        goalTags.sold_revenue_tag.textContent = "0% of revenue goal";
      } else {
        goalTags.sold_revenue_tag.textContent = "Set a goal to track progress";
      }
    }

    if (goalTags.sold_units_tag) {
      goalTags.sold_units_tag.textContent = hasSold ? "Sales logged" : "Waiting for sales";
    }
    if (goalTags.remaining_units_tag) {
      goalTags.remaining_units_tag.textContent = hasPlanned ? "Remaining vs plan" : "Enter planned units";
    }

    if (goalRevenue && soldRevenueValue !== null) {
      const meterPercent = Math.min(Math.max((soldRevenueValue / goalRevenue) * 100, 0), 100);
      if (goalValues.goal_percent) {
        goalValues.goal_percent.textContent = `${meterPercent.toFixed(0)}%`;
      }
      if (goalMeterFill) {
        goalMeterFill.style.width = `${meterPercent}%`;
      }
    } else {
      if (goalValues.goal_percent) {
        goalValues.goal_percent.textContent = "--";
      }
      if (goalMeterFill) {
        goalMeterFill.style.width = "0%";
      }
    }
  }

  function collectSnapshot() {
    return {
      currency: currencySelect.value,
      inputs: {
        cogs: cogsInput.value,
        overhead: overheadInput.value
      },
      products: productRows.map((row) => ({
        units: row.unitsInput.value,
        price: row.priceInput.value
      })),
      sales: productRows.map((row) => ({
        sold: row.soldUnitsInput.value,
        sold_price: row.soldTotalInput.value
      })),
      goals: { ...goalData },
      outputs: {
        revenue: outputValues.revenue ? outputValues.revenue.textContent : "",
        profit: outputValues.profit ? outputValues.profit.textContent : "",
        margin: outputValues.margin ? outputValues.margin.textContent : "",
        breakeven: outputValues.breakeven ? outputValues.breakeven.textContent : "",
        rev_unit: outputValues.rev_unit ? outputValues.rev_unit.textContent : "",
        cost_ratio: outputValues.cost_ratio ? outputValues.cost_ratio.textContent : ""
      }
    };
  }

  function saveSnapshot() {
    const snapshot = collectSnapshot();
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `profit-snapshot-${stamp}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function coerceGoalValue(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  function setProductRows(products) {
    productRows.forEach((row) => {
      row.row.remove();
      row.goalRow.remove();
    });
    productRows = [];

    const count = Math.max(products.length, 1);
    for (let index = 0; index < count; index += 1) {
      addProductRow({ silent: true });
    }
    refreshProductLabels();
    updateCurrencyPrefixes();
  }

  function loadSnapshot(data) {
    if (!data || typeof data !== "object") {
      return;
    }

    if (currencyOptions.includes(data.currency)) {
      currencySelect.value = data.currency;
    }

    const inputs = data.inputs && typeof data.inputs === "object" ? data.inputs : {};
    cogsInput.value = safeString(inputs.cogs);
    overheadInput.value = safeString(inputs.overhead);

    const products = Array.isArray(data.products) ? data.products : [];
    setProductRows(products);

    productRows.forEach((row, index) => {
      const product = products[index] || {};
      row.unitsInput.value = safeString(product.units);
      row.priceInput.value = safeString(product.price);
    });

    const sales = Array.isArray(data.sales) ? data.sales : [];
    productRows.forEach((row, index) => {
      const sale = sales[index] || {};
      row.soldUnitsInput.value = safeString(sale.sold);
      row.soldTotalInput.value = safeString(sale.sold_price);
    });

    const goals = data.goals && typeof data.goals === "object" ? data.goals : {};
    goalData = {
      revenue: coerceGoalValue(goals.revenue),
      profit: coerceGoalValue(goals.profit),
      margin: coerceGoalValue(goals.margin),
      breakeven: coerceGoalValue(goals.breakeven)
    };

    applyGoalData();
    updateCurrencyPrefixes();
    updateMetrics();
  }

  function resetFields() {
    cogsInput.value = "";
    overheadInput.value = "";
    productRows.forEach((row) => {
      row.unitsInput.value = "";
      row.priceInput.value = "";
      row.soldUnitsInput.value = "";
      row.soldTotalInput.value = "";
    });
    updateMetrics();
  }

  function setupCurrencyOptions() {
    if (currencySelect.options.length === 0) {
      currencyOptions.forEach((code) => {
        const option = document.createElement("option");
        option.value = code;
        option.textContent = code;
        currencySelect.appendChild(option);
      });
    }
    if (!currencyOptions.includes(currencySelect.value)) {
      currencySelect.value = "USD";
    }
  }

  setupCurrencyOptions();
  addProductRow({ silent: true });
  refreshProductLabels();
  updateCurrencyPrefixes();
  applyGoalData();
  updateMetrics();
  setDashboard(activeDashboard);

  if (currencySelect) {
    currencySelect.addEventListener("change", () => {
      updateCurrencyPrefixes();
      applyGoalData();
      updateMetrics();
    });
  }

  if (cogsInput) {
    cogsInput.addEventListener("input", updateMetrics);
  }
  if (overheadInput) {
    overheadInput.addEventListener("input", updateMetrics);
  }
  if (addProductButton) {
    addProductButton.addEventListener("click", () => addProductRow());
  }
  if (dashboardToggle) {
    dashboardToggle.addEventListener("click", () => {
      setDashboard(activeDashboard === "summary" ? "goal" : "summary");
    });
  }
  if (saveButton) {
    saveButton.addEventListener("click", saveSnapshot);
  }
  if (loadButton && loadInput) {
    loadButton.addEventListener("click", () => loadInput.click());
    loadInput.addEventListener("change", (event) => {
      const file = event.target.files && event.target.files[0];
      if (!file) {
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          loadSnapshot(data);
        } catch (error) {
          window.alert("Invalid JSON file.");
        }
      };
      reader.readAsText(file);
      event.target.value = "";
    });
  }
  if (resetButton) {
    resetButton.addEventListener("click", resetFields);
  }
  if (setGoalButton) {
    setGoalButton.addEventListener("click", setGoalFromCurrent);
  }
})();
