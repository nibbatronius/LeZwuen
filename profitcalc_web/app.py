import math

import streamlit as st


CURRENCY_OPTIONS = [
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
    "CNY",
]

PALETTE = {
    "bg_top": "#0b0f17",
    "bg_bottom": "#101827",
    "panel": "#141a24",
    "panel_border": "#273042",
    "field": "#0f1624",
    "field_border": "#2a3343",
    "text_primary": "#e2e8f0",
    "text_secondary": "#94a3b8",
    "text_muted": "#64748b",
    "accent": "#38bdf8",
    "accent_strong": "#0ea5e9",
    "positive": "#22c55e",
    "warning": "#f59e0b",
    "negative": "#f43f5e",
}


def init_state():
    if "currency" not in st.session_state:
        st.session_state.currency = "USD"
    if "cogs" not in st.session_state:
        st.session_state.cogs = ""
    if "overhead" not in st.session_state:
        st.session_state.overhead = ""
    if "products" not in st.session_state:
        st.session_state.products = [{"id": 1}]


def parse_value(value):
    if value is None:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    cleaned = raw.replace(",", "").replace("$", "")
    for code in CURRENCY_OPTIONS:
        if cleaned.startswith(code):
            cleaned = cleaned[len(code) :].strip()
            break
    try:
        return float(cleaned)
    except ValueError:
        return None


def format_currency(value, currency):
    return f"{currency} {value:,.2f}"


def format_percent(value):
    return f"{value:.1f}%"


def add_product():
    next_id = max((row["id"] for row in st.session_state.products), default=0) + 1
    st.session_state.products.append({"id": next_id})


def remove_product(product_id):
    st.session_state.products = [
        row for row in st.session_state.products if row["id"] != product_id
    ]


def reset_fields():
    st.session_state.currency = "USD"
    st.session_state.cogs = ""
    st.session_state.overhead = ""
    st.session_state.products = [{"id": 1}]
    for key in list(st.session_state.keys()):
        if key.startswith("units_") or key.startswith("price_"):
            del st.session_state[key]


def metric_card(label, value, tag, status):
    st.markdown(
        f"""
        <div class="metric-card">
          <div class="metric-label">{label}</div>
          <div class="metric-value">{value}</div>
          <div class="metric-tag {status}">{tag}</div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def highlight_card(label, value):
    st.markdown(
        f"""
        <div class="highlight-card">
          <div class="highlight-label">{label}</div>
          <div class="highlight-value">{value}</div>
        </div>
        """,
        unsafe_allow_html=True,
    )


st.set_page_config(page_title="Profit Calculator", layout="wide")
init_state()

st.markdown(
    f"""
    <style>
      :root {{
        color-scheme: dark;
      }}
      .stApp {{
        background: linear-gradient(180deg, {PALETTE["bg_top"]} 0%, {PALETTE["bg_bottom"]} 100%);
        color: {PALETTE["text_primary"]};
      }}
      .page {{
        max-width: 1200px;
        margin: 0 auto;
        padding: 1.5rem 1.2rem 2.5rem;
      }}
      .eyebrow {{
        font-size: 0.75rem;
        letter-spacing: 0.2em;
        color: {PALETTE["text_muted"]};
      }}
      .title {{
        font-size: 2rem;
        margin: 0.4rem 0 0.2rem;
        color: {PALETTE["text_primary"]};
      }}
      .subtitle {{
        color: {PALETTE["text_secondary"]};
        margin-bottom: 1.6rem;
      }}
      .panel {{
        background: {PALETTE["panel"]};
        border: 1px solid {PALETTE["panel_border"]};
        border-radius: 18px;
        padding: 1.5rem;
      }}
      .panel-header {{
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 1rem;
      }}
      .panel-header h3 {{
        margin: 0;
      }}
      .metric-card {{
        display: grid;
        gap: 0.35rem;
        padding: 0.85rem 0;
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      }}
      .metric-card:last-child {{
        border-bottom: none;
      }}
      .metric-label {{
        color: {PALETTE["text_secondary"]};
        font-size: 0.85rem;
      }}
      .metric-value {{
        font-size: 1.6rem;
        font-weight: 600;
      }}
      .metric-tag {{
        font-size: 0.8rem;
        color: {PALETTE["text_muted"]};
      }}
      .metric-tag.positive {{
        color: {PALETTE["positive"]};
      }}
      .metric-tag.warning {{
        color: {PALETTE["warning"]};
      }}
      .metric-tag.negative {{
        color: {PALETTE["negative"]};
      }}
      .highlight-grid {{
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 1rem;
        margin-top: 1rem;
      }}
      .highlight-card {{
        background: {PALETTE["field"]};
        border: 1px solid {PALETTE["field_border"]};
        border-radius: 14px;
        padding: 0.9rem 1rem;
      }}
      .highlight-label {{
        color: {PALETTE["text_secondary"]};
        font-size: 0.8rem;
      }}
      .highlight-value {{
        margin-top: 0.3rem;
        font-size: 1.1rem;
        font-weight: 600;
      }}
      .field-note {{
        color: {PALETTE["text_muted"]};
        font-size: 0.8rem;
        margin-top: 0.6rem;
      }}
      div[data-testid="stTextInput"] > label,
      div[data-testid="stSelectbox"] > label {{
        color: {PALETTE["text_secondary"]};
      }}
      .stButton > button {{
        border-radius: 999px;
        border: 1px solid {PALETTE["panel_border"]};
        background: {PALETTE["panel"]};
        color: {PALETTE["text_secondary"]};
      }}
      .stButton > button:hover {{
        border-color: {PALETTE["accent"]};
        color: {PALETTE["text_primary"]};
      }}
      .remove-btn button {{
        border-radius: 8px;
        padding: 0.25rem 0.6rem;
        font-size: 0.75rem;
      }}
    </style>
    """,
    unsafe_allow_html=True,
)

st.markdown('<div class="page">', unsafe_allow_html=True)
st.markdown('<div class="eyebrow">PROFIT INTELLIGENCE</div>', unsafe_allow_html=True)
st.markdown('<h1 class="title">Profit Calculator</h1>', unsafe_allow_html=True)
st.markdown(
    '<div class="subtitle">Track revenue, costs, and margins with a clean executive view.</div>',
    unsafe_allow_html=True,
)

left, right = st.columns([1.1, 1], gap="large")

with left:
    st.markdown('<div class="panel">', unsafe_allow_html=True)
    header_cols = st.columns([1, 0.3])
    with header_cols[0]:
        st.markdown("<h3>Inputs</h3>", unsafe_allow_html=True)
    with header_cols[1]:
        if st.button("Reset"):
            reset_fields()
            st.rerun()

    st.selectbox("Currency", CURRENCY_OPTIONS, key="currency")
    st.text_input("Cost of goods", key="cogs", placeholder="0.00")
    st.text_input("Operating costs", key="overhead", placeholder="0.00")

    product_header = st.columns([1, 0.4])
    with product_header[0]:
        st.markdown("**Products**")
    with product_header[1]:
        if st.button("Add product"):
            add_product()
            st.rerun()

    for index, product in enumerate(st.session_state.products, start=1):
        row_cols = st.columns([1.2, 1, 1, 0.35])
        row_cols[0].markdown(f"Product {index}")
        units_key = f"units_{product['id']}"
        price_key = f"price_{product['id']}"
        row_cols[1].text_input(
            "Units",
            key=units_key,
            label_visibility="collapsed",
            placeholder="0",
        )
        row_cols[2].text_input(
            "Price per unit",
            key=price_key,
            label_visibility="collapsed",
            placeholder=f"{st.session_state.currency} 0.00",
        )
        with row_cols[3]:
            remove_disabled = len(st.session_state.products) <= 1
            if st.button(
                "Remove",
                key=f"remove_{product['id']}",
                disabled=remove_disabled,
            ):
                remove_product(product["id"])
                st.rerun()

    st.markdown(
        '<div class="field-note">Tip: Add multiple products to build total revenue automatically.</div>',
        unsafe_allow_html=True,
    )
    st.markdown("</div>", unsafe_allow_html=True)

currency = st.session_state.currency
cogs = parse_value(st.session_state.cogs)
overhead = parse_value(st.session_state.overhead)

total_revenue = 0.0
total_units = 0.0
priced_units = 0.0
has_revenue = False
has_units = False

for product in st.session_state.products:
    units_value = parse_value(st.session_state.get(f"units_{product['id']}"))
    price_value = parse_value(st.session_state.get(f"price_{product['id']}"))
    if units_value is not None:
        total_units += units_value
        has_units = True
    if units_value is not None and price_value is not None:
        total_revenue += units_value * price_value
        priced_units += units_value
        has_revenue = True

revenue = total_revenue if has_revenue else None
units_priced = priced_units if priced_units > 0 else None

unit_price = None
if revenue is not None and units_priced is not None:
    unit_price = revenue / units_priced

revenue_value = "--"
revenue_tag = "Products required"
revenue_status = "neutral"
if revenue is not None:
    revenue_value = format_currency(revenue, currency)
    revenue_tag = "Calculated from products"

profit_value = "--"
profit_tag = "Waiting for inputs"
profit_status = "neutral"
if revenue is not None and cogs is not None and overhead is not None:
    profit = revenue - cogs - overhead
    profit_value = format_currency(profit, currency)
    if profit > 0:
        profit_status = "positive"
        profit_tag = "Profitable"
    elif profit < 0:
        profit_status = "negative"
        profit_tag = "Loss"
    else:
        profit_tag = "Neutral"
else:
    if revenue is None:
        profit_tag = "Products required"
    elif cogs is None and overhead is None:
        profit_tag = "Costs required"
    elif cogs is None:
        profit_tag = "COGS required"
    elif overhead is None:
        profit_tag = "Overhead required"

margin_value = "--"
margin_tag = "Waiting for inputs"
margin_status = "neutral"
if revenue is not None and revenue != 0 and cogs is not None:
    margin = ((revenue - cogs) / revenue) * 100
    margin_value = format_percent(margin)
    if margin >= 40:
        margin_status = "positive"
        margin_tag = "Strong margin"
    elif margin >= 20:
        margin_tag = "Stable margin"
    elif margin >= 0:
        margin_status = "warning"
        margin_tag = "Tight margin"
    else:
        margin_status = "negative"
        margin_tag = "Negative margin"
else:
    if revenue is None:
        margin_tag = "Products required"
    elif cogs is None:
        margin_tag = "COGS required"
    elif revenue == 0:
        margin_tag = "Revenue required"

breakeven_value = "--"
breakeven_tag = "Price & costs required"
breakeven_status = "neutral"
if overhead is not None and cogs is not None and unit_price is not None:
    if unit_price > 0:
        total_costs = overhead + cogs
        breakeven = total_costs / unit_price
        if breakeven <= 0:
            breakeven_value = "0"
            breakeven_status = "positive"
            breakeven_tag = "Already covered"
        else:
            breakeven_value = f"{math.ceil(breakeven)}"
            breakeven_tag = "Based on total costs"
    else:
        breakeven_tag = "Price must be > 0"
        breakeven_status = "warning"
else:
    if overhead is None:
        breakeven_tag = "Overhead required"
    elif cogs is None:
        breakeven_tag = "COGS required"
    elif unit_price is None:
        breakeven_tag = "Price required"

rev_unit_value = "--"
if unit_price is not None:
    rev_unit_value = format_currency(unit_price, currency)

cost_ratio_value = "--"
if revenue is not None and revenue != 0 and cogs is not None and overhead is not None:
    ratio = ((cogs + overhead) / revenue) * 100
    cost_ratio_value = format_percent(ratio)

with right:
    st.markdown('<div class="panel">', unsafe_allow_html=True)
    st.markdown("<h3>Summary</h3>", unsafe_allow_html=True)
    metric_card("Total revenue", revenue_value, revenue_tag, revenue_status)
    metric_card("Net profit", profit_value, profit_tag, profit_status)
    metric_card("Gross margin", margin_value, margin_tag, margin_status)
    metric_card("Breakeven units", breakeven_value, breakeven_tag, breakeven_status)

    st.markdown('<div class="highlight-grid">', unsafe_allow_html=True)
    highlight_card("Avg price per unit", rev_unit_value)
    highlight_card("Cost ratio", cost_ratio_value)
    st.markdown("</div>", unsafe_allow_html=True)
    st.markdown("</div>", unsafe_allow_html=True)

st.markdown("</div>", unsafe_allow_html=True)
