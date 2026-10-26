// Runs inside Chromium. Gradient endpoints and translucent ancestor surfaces are
// composited in sRGB; it checks real computed styles, not the preset definitions.
export function auditThemeContrast(selector = "main", controls = true) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  function color(value) {
    ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1);
    const c = Array.from(ctx.getImageData(0, 0, 1, 1).data); c[3] /= 255; return c;
  }
  function over(a, b) { return [0, 1, 2].map(i => a[i] * a[3] + b[i] * (1 - a[3])).concat(1); }
  function luminance(c) {
    const v = c.slice(0, 3).map(x => x / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4);
    return v[0] * .2126 + v[1] * .7152 + v[2] * .0722;
  }
  function ratio(a, b) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
  const cache = new Map();
  function backgrounds(el) {
    if (!el) return [[255, 255, 255, 1]];
    if (cache.has(el)) return cache.get(el);
    const s = getComputedStyle(el), bg = color(s.backgroundColor);
    let values = backgrounds(el.parentElement).map(parent => over(bg, parent));
    if (s.backgroundImage !== "none") {
      const endpoints = s.backgroundImage.match(/#[\da-f]{3,8}\b|rgba?\([^)]*\)|color\([^)]*\)/gi) ?? [];
      const layers = endpoints.map(color);
      if (layers.length) values = values.flatMap(base => layers.map(layer => over(layer, base)));
    }
    cache.set(el, values); return values;
  }
  const root = document.querySelector(selector);
  if (!root) return { failures: [{ missing: selector }], checked: 0, minimum: null };
  const failures = []; let checked = 0, minimum = Infinity;
  for (const el of [root, ...root.querySelectorAll("*")]) {
    const s = getComputedStyle(el), r = el.getBoundingClientRect();
    if (!r.width || !r.height || s.visibility === "hidden" || s.display === "none" || el.closest(":disabled") || (r.width <= 1 && r.height <= 1)) continue;
    const hasText = [...el.childNodes].some(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
    const placeholder = el.matches("input[placeholder],textarea[placeholder]") && !el.value;
    if (!hasText && !placeholder) continue;
    const fg = color(placeholder ? getComputedStyle(el, "::placeholder").color : s.color);
    for (let ancestor = el; ancestor; ancestor = ancestor.parentElement) fg[3] *= Number(getComputedStyle(ancestor).opacity);
    const contrast = Math.min(...backgrounds(el).map(bg => ratio(over(fg, bg), bg)));
    const large = parseFloat(s.fontSize) >= 24 || (parseFloat(s.fontSize) >= 18.6667 && Number(s.fontWeight) >= 700);
    const required = large ? 3 : 4.5;
    checked++; minimum = Math.min(minimum, contrast);
    if (contrast + .01 < required) failures.push({ tag: el.tagName, text: (placeholder ? el.getAttribute("placeholder") : el.textContent).trim().slice(0, 55), contrast, required, color: s.color, background: s.backgroundColor });
  }
  if (selector !== "main" && controls) {
    const s = getComputedStyle(root);
    if (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) >= 2) {
      const outline = color(s.outlineColor);
      const contrast = Math.min(...backgrounds(root.parentElement).map(bg => ratio(over(outline, bg), bg)));
      checked++;
      if (contrast + .01 < 3) failures.push({ control: selector, part: "focus outline", contrast, required: 3 });
    }
    const field = root.matches("select") ? root.parentElement : root;
    if (root.matches('input,textarea,select,button[aria-label^="Quitar una unidad"],button[aria-label^="Añadir una unidad"],button + a')) {
      const border = color(getComputedStyle(field).borderTopColor);
      const contrast = Math.min(...backgrounds(field).map(bg => ratio(over(border, bg), bg)));
      checked++;
      if (contrast + .01 < 3) failures.push({ control: selector, part: "field border", contrast, required: 3 });
    }
    if (root.matches("button") && root.querySelector("svg")) {
      const fg = color(s.color);
      const contrast = Math.min(...backgrounds(root).map(bg => ratio(over(fg, bg), bg)));
      checked++;
      if (contrast + .01 < 3) failures.push({ control: selector, part: "icon", contrast, required: 3 });
    }
  }
  return { failures, checked, minimum };
}
