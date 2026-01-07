const embedFrame = document.querySelector("[data-profit-embed]");
const embedPlaceholder = document.querySelector("[data-embed-placeholder]");
const embedUrl =
  window.APP_CONFIG && window.APP_CONFIG.PROFIT_CALC_URL
    ? window.APP_CONFIG.PROFIT_CALC_URL
    : "";

if (embedFrame) {
  if (embedUrl) {
    embedFrame.src = embedUrl;
    if (embedPlaceholder) {
      embedPlaceholder.hidden = true;
    }
  } else {
    embedFrame.src = "about:blank";
    if (embedPlaceholder) {
      embedPlaceholder.hidden = false;
    }
  }
}
