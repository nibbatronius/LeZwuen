(() => {
  const controls = document.querySelector("[data-window-controls]");
  if (!controls || !window.LeZwuenWindow) {
    return;
  }

  const buttons = {
    minimize: controls.querySelector("[data-window-minimize]"),
    maximize: controls.querySelector("[data-window-maximize]"),
    close: controls.querySelector("[data-window-close]")
  };

  if (buttons.minimize) {
    buttons.minimize.addEventListener("click", () => {
      window.LeZwuenWindow.minimize();
    });
  }
  if (buttons.maximize) {
    buttons.maximize.addEventListener("click", () => {
      window.LeZwuenWindow.maximize();
    });
  }
  if (buttons.close) {
    buttons.close.addEventListener("click", () => {
      window.LeZwuenWindow.close();
    });
  }
})();
