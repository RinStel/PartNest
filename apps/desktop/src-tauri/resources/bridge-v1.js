/* partnest bridge-v1: report only known designators from the untrusted BOM. */
/* The host receiver must also require event.source === iframe.contentWindow. */
(function (window, document) {
  "use strict";
  const config = window.__PARTNEST_BOM_BRIDGE_V1__;
  if (!config || typeof config.token !== "string" || !Array.isArray(config.designators)) return;

  const known = new Set(config.designators.filter((value) => typeof value === "string" && value));
  if (!known.size) return;
  const targetOrigin = typeof config.targetOrigin === "string" && /^https?:\/\/[^\/\s]+$/.test(config.targetOrigin)
    ? config.targetOrigin
    : "*";
  let lastSelection = "";

  const addTokens = (value, output) => {
    if (typeof value !== "string" || !value) return;
    value.split(/[^A-Za-z0-9_+.-]+/).forEach((token) => {
      if (known.has(token) && !output.includes(token)) output.push(token);
    });
  };

  const attributes = [
    "data-designator", "data-designators", "data-refdes", "data-refdeses",
    "data-reference", "data-name", "id", "title", "aria-label", "name",
  ];

  /* Only whole class tokens count as "selected": a substring match would turn
     `deselected`, `unselected`, or `highlighted` into a selection. */
  const SELECTED_SELECTOR = [
    ".selected", ".is-selected", ".active", ".is-active",
    "[aria-selected='true']", "[data-selected='true']",
    "[data-state='selected']", "[data-active='true']", "[data-highlight='true']",
  ].join(",");

  /* The host caps one message at 512 designators; never emit a truncated set. */
  const MAX_DESIGNATORS = 512;

  const collectNode = (node, output, includeText) => {
    if (!node || node.nodeType !== 1) return;
    attributes.forEach((name) => addTokens(node.getAttribute(name), output));
    const text = node.textContent || "";
    if (includeText && text.length <= 512) addTokens(text, output);
  };

  const collectAncestors = (target, output) => {
    let node = target && target.nodeType === 1 ? target : target && target.parentElement;
    let depth = 0;
    while (node && depth < 6) {
      const marked = node.matches(SELECTED_SELECTOR);
      collectNode(node, output, marked || node.matches("tr, [role='row'], g"));
      if (marked) {
        node.querySelectorAll("[data-designator], [data-refdes], [data-reference], [data-name]").forEach((child) => collectNode(child, output, false));
      }
      node = node.parentElement;
      depth += 1;
    }
  };

  const collectMarked = (output) => {
    document.querySelectorAll(SELECTED_SELECTOR).forEach((node) => collectNode(node, output, true));
  };

  const emit = (target) => {
    const selected = [];
    collectMarked(selected);
    if (!selected.length && target) collectAncestors(target, selected);
    if (!selected.length || selected.length > MAX_DESIGNATORS) return;
    const signature = selected.join("\u0000");
    if (signature === lastSelection) return;
    lastSelection = signature;
    window.parent.postMessage({ type: "partnest:bom-selection", token: config.token, designators: selected }, targetOrigin);
  };

  let frame = 0;
  let lastTarget = null;
  /* Selection only ever follows a real user interaction. Page load and DOM
     mutations alone must not push a selection the operator never made. */
  let interacted = false;
  const schedule = (target) => {
    if (!interacted) return;
    lastTarget = target || lastTarget;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const currentTarget = lastTarget;
      lastTarget = null;
      emit(currentTarget);
    });
  };

  const onInteract = (event) => {
    interacted = true;
    schedule(event.target);
  };

  document.addEventListener("click", onInteract, true);
  document.addEventListener("change", onInteract, true);
  if (typeof MutationObserver === "function") {
    const observer = new MutationObserver(() => schedule(null));
    observer.observe(document.documentElement || document, { subtree: true, attributes: true, attributeFilter: ["class", "aria-selected", "data-selected", "data-state", "data-active", "data-designator"] });
  }
}(window, document));
