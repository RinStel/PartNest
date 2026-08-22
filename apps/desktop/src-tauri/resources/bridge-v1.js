/* partnest bridge-v1: intentionally limited to one postMessage shape. */
(function (window, document) {
  "use strict";
  const config = window.__PARTNEST_BOM_BRIDGE_V1__;
  if (!config || typeof config.token !== "string" || !Array.isArray(config.designators)) return;
  const known = new Set(config.designators);
  const scan = () => {
    const selected = [];
    document.querySelectorAll(".selected, [aria-selected='true'], [data-selected='true']").forEach((node) => {
      const value = node.getAttribute("data-designator") || node.textContent || "";
      value.split(/[,;\s]+/).forEach((designator) => {
        if (known.has(designator) && !selected.includes(designator)) selected.push(designator);
      });
    });
    if (selected.length) window.parent.postMessage({ type: "partnest:bom-selection", token: config.token, designators: selected }, "*");
  };
  let frame = 0;
  document.addEventListener("click", () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(scan);
  }, true);
}(window, document));
