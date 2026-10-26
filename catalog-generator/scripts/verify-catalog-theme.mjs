import assert from "node:assert/strict";
import fs from "node:fs";
import Module, { createRequire } from "node:module";
import ts from "typescript";

// Use the existing compiler, following verify-product-import.mjs; no new runner.
const require = createRequire(import.meta.url);
const previous = Module._extensions[".ts"];
Module._extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
try {
  const { resolveCatalogTheme } = require("../lib/catalog-theme.ts");
  const { isCatalogThemeCompatible } = require("../lib/catalog-theme-choice.ts");
  const templates = ["TECH", "FASHION", "BEAUTY", "GLAMOUR", "EDITORIAL", "GRID", "BOUTIQUE"];
  const presets = ["forest", "ocean", "terracotta", "rose", "violet", "graphite", "night-mint", "night-amber"];
  const luminance = hex => {
    const c = hex.slice(1).match(/../g).map(v => parseInt(v, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
    return c[0] * .2126 + c[1] * .7152 + c[2] * .0722;
  };
  const ratio = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
  let combinations = 0;
  for (const template of templates) {
    for (const invalid of [null, undefined, "", "unknown", "__proto__", "toString", {}, 1]) assert.equal(resolveCatalogTheme(template, invalid), undefined);
    for (const preset of presets) {
      const theme = resolveCatalogTheme(template, preset);
      assert.equal(isCatalogThemeCompatible(template, preset), Boolean(theme), "Selector compatibility agrees with the public resolver");
      if (["TECH", "GRID"].includes(template) && !preset.startsWith("night-")) { assert.equal(theme, undefined); continue; }
      assert.ok(theme);
      assert.ok(Object.keys(theme).every(key => key === "colorScheme" || /^--(?:catalog|product-card|cart)-/.test(key)));
      assert.deepEqual(theme, resolveCatalogTheme(template, preset), "pure deterministic resolver");
      const get = role => theme[`--catalog-${role}`];
      for (const surface of ["background", "surface", "soft"]) {
        for (const text of ["text", "text-muted", "primary", "accent", "danger"]) assert.ok(ratio(get(text), get(surface)) >= 4.5, `${preset}: ${text}/${surface}`);
        assert.ok(ratio(get("border"), get(surface)) >= 3, `${preset}: control border/${surface}`);
        assert.ok(ratio(get("focus"), get(surface)) >= 3, `${preset}: focus/${surface}`);
      }
      for (const role of ["primary", "primary-hover"]) assert.ok(ratio(get("on-primary"), get(role)) >= 4.5, `${preset}: action ${role}`);
      assert.ok(ratio(get("danger"), get("danger-surface")) >= 4.5);
      assert.ok(ratio(get("danger-label"), get("danger")) >= 4.5);
      assert.ok(ratio(get("success"), get("success-surface")) >= 4.5);
      assert.equal(theme["--product-card-button"], get("primary"));
      assert.equal(theme["--cart-accent"], get("primary"));
      combinations++;
    }
  }
  for (const [legacy, current] of [["GRID", "TECH"], ["EDITORIAL", "FASHION"], ["BOUTIQUE", "BEAUTY"]]) {
    for (const preset of presets) assert.deepEqual(resolveCatalogTheme(legacy, preset), resolveCatalogTheme(current, preset));
  }
  assert.ok(ratio("#FFFFFF", "#12813f") >= 4.5);
  assert.ok(ratio("#FFFFFF", "#0f7037") >= 4.5);
  console.log(`PASS resolver: ${combinations} compatible combinations; null/unknown/incompatible fallback; aliases; derived contrast; isolated variables`);
  console.log(`WhatsApp contrast: normal ${ratio("#FFFFFF", "#12813f").toFixed(2)}:1; hover ${ratio("#FFFFFF", "#0f7037").toFixed(2)}:1`);
} finally {
  Module._extensions[".ts"] = previous;
}
