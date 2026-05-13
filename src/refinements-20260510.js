(() => {
  if (typeof state === "undefined" || typeof renderControls !== "function") return;

  state.riskWindowMode = state.riskWindowMode || "twoHour";

  document.querySelectorAll(".action-grid button").forEach((button) => {
    if (button.textContent.includes("85%")) button.remove();
  });

  renderControls();
})();
