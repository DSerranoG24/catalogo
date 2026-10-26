import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

export function cardFixture(catalog, publicId) {
  const category = { id: "category-long", name: "Accesorios y productos de una categoría con un nombre muy largo", slug: "accesorios", imageUrl: null, position: 0 };
  const names = ["Auriculares", "Auriculares inalámbricos con estuche", "Auriculares inalámbricos con cancelación de ruido y un nombre suficientemente largo para comprobar el truncado", "Producto local", "Accesorio vertical", "Sin fotografía"];
  const products = names.map((name, i) => ({ ...catalog.products[0], id: "p" + (i + 1), slug: "producto-" + i, name,
    price: i === 2 ? 123456789 : 65000 + i * 1000, regularPrice: i === 1 ? 90000 : null, discountPercent: i === 1 ? 27 : null,
    description: i % 2 ? null : "Descripción de ejemplo que no debe provocar diferencias de altura.", brand: "Marca local", categoryId: category.id,
    category: { id: category.id, name: category.name },
    images: i === 5 ? [] : [{ id: "image-" + i, alt: name, url: i === 4 ? "/card-test-portrait.svg" : i === 3 ? "/card-test-landscape.svg" : "/images/img_60.png" }],
  }));
  return { ...catalog, publicId, template: publicId, categories: [category], products };
}

const invariantExpression = `(()=>{
  const cards=[...document.querySelectorAll('article')].filter(e=>e.querySelector('button[aria-label^="Añadir"]'));
  const grid=cards[0].parentElement;
  const style=e=>{const s=getComputedStyle(e);return {background:s.backgroundColor,color:s.color,border:s.borderColor,font:s.fontFamily,fontSize:s.fontSize}};
  const first=cards[0],button=first.querySelector('button');
  return {header:[...document.querySelectorAll('header,header *')].filter(e=>!['SCRIPT','STYLE'].includes(e.tagName)).map(e=>({tag:e.tagName,...style(e)})),
    grid:{columns:getComputedStyle(grid).gridTemplateColumns,gap:getComputedStyle(grid).gap,width:grid.getBoundingClientRect().width},
    palette:{surface:style(first).background,border:style(first).border,button:style(button).background,buttonText:style(button).color,name:style(first.querySelector('h3')).color},
    heading:document.querySelector('h1').textContent};})()`;
const cartExpression = `JSON.stringify([...document.querySelectorAll('main,main *')].map(e=>{const s=getComputedStyle(e);return [e.tagName,e.textContent,...Array.from(s).filter(p=>!p.startsWith('--')&&!p.startsWith('animation')).map(p=>[p,s.getPropertyValue(p)])]}))`;

export async function verifyPublicCards({ command, evaluate, poll, pause, base, folder }) {
  const recordIndex = process.argv.indexOf("--record-card-baseline");
  const baselineIndex = process.argv.indexOf("--card-baseline");
  const recording = recordIndex !== -1;
  assert.ok(recording || baselineIndex !== -1, "Provide a recorded baseline for card invariants");
  const baseline = recording ? {} : JSON.parse(fs.readFileSync(process.argv[baselineIndex + 1], "utf8"));
  const results = [];
  for (const template of ["TECH", "FASHION", "BEAUTY", "GLAMOUR"]) {
    for (const width of [320, 390, 1024, 1440]) {
      const id = template + ":" + width;
      await command("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false });
      await command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
      await command("Page.navigate", { url: base + "/c/" + template });
      await poll(() => evaluate(`document.querySelectorAll('article').length===6`));
      await evaluate("document.fonts.ready.then(()=>true)");
      await pause(150);
      const invariants = await evaluate(invariantExpression);
      if (recording) baseline[id] = { invariants };
      else {
        assert.deepEqual(invariants, baseline[id].invariants, id + " header/grid/palette unchanged");
        const metrics = await evaluate(`(()=>{const cards=[...document.querySelectorAll('[data-product-card]')];return cards.map(c=>{const image=c.querySelector('[data-product-image]'),r=image.getBoundingClientRect(),name=c.querySelector('h3'),price=c.querySelector('[data-product-price]'),button=c.querySelector('button');return {top:Math.round(c.getBoundingClientRect().top),height:c.getBoundingClientRect().height,ratio:r.width/r.height,nameFont:parseFloat(getComputedStyle(name).fontSize),priceFont:parseFloat(getComputedStyle(price).fontSize),clamp:getComputedStyle(name).webkitLineClamp,buttonHeight:button.getBoundingClientRect().height,overflow:c.scrollWidth>c.clientWidth,imageFit:image.querySelector('img')?getComputedStyle(image.querySelector('img')).objectFit:null,secondary:c.querySelectorAll('[data-product-meta]').length,description:c.textContent.includes('Descripción de ejemplo'),details:c.textContent.includes('Ver detalles')}})})()`);
        assert.equal(metrics.length, 6);
        for (const metric of metrics) {
          assert.ok(Math.abs(metric.ratio - 1) < 0.01, id + " square image");
          assert.ok(metric.priceFont > metric.nameFont, id + " price hierarchy");
          assert.equal(metric.clamp, "2"); assert.ok(metric.buttonHeight >= 44);
          assert.equal(metric.overflow, false); assert.equal(metric.secondary, 1);
          assert.equal(metric.description, false); assert.equal(metric.details, false);
          if (metric.imageFit) assert.equal(metric.imageFit, "cover");
        }
        for (const top of new Set(metrics.map(m => m.top))) {
          const heights = metrics.filter(m => m.top === top).map(m => m.height);
          assert.ok(Math.max(...heights) - Math.min(...heights) < 1, id + " equal row heights");
        }
        assert.ok(await evaluate("document.documentElement.scrollWidth<=innerWidth"), id + " viewport fits");
        await evaluate("document.querySelector('[data-product-card] a').focus()");
        await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
        await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
        assert.ok(await evaluate(`(()=>{const e=document.activeElement;return e.tagName==='BUTTON'&&e.closest('[data-product-card]')&&parseFloat(getComputedStyle(e).outlineWidth)>=2})()`), id + " keyboard focus");
        const previousQuantity = await evaluate(`Number(document.querySelector('[data-product-card] button').textContent.trim().split(' ').at(-1))||0`);
        await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
        await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
        await poll(() => evaluate(`Number(document.querySelector('[data-product-card] button').textContent.trim().split(' ').at(-1))===${previousQuantity + 1}`));
        assert.ok(await evaluate(`[...document.querySelectorAll('[data-product-card]')].every(c=>getComputedStyle(c).transform==='none')`), id + " reduced motion");
        if (width === 390 || width === 1440) {
          await evaluate("document.getElementById('productos').scrollIntoView()");
          const screenshot = await command("Page.captureScreenshot", { format: "png" });
          fs.writeFileSync(path.join(folder, `cards-${template}-${width}.png`), Buffer.from(screenshot.data, "base64"));
        }
      }
      await evaluate(`sessionStorage.setItem('catalogo-cart-${template}',JSON.stringify({p1:2,p2:1}))`);
      await command("Page.navigate", { url: base + "/c/" + template + "/carrito" });
      try {
        await poll(() => evaluate(`document.querySelector('h1')?.textContent==='Carrito'&&document.body.textContent.includes('Auriculares')`));
      } catch {
        throw new Error("LOCAL_CART_FIXTURE: " + await evaluate("document.querySelector('main')?.textContent.slice(0,300)"));
      }
      await evaluate("document.fonts.ready.then(()=>true)"); await pause(100);
      if (recording) baseline[id].cart = await evaluate(cartExpression);
      else assert.equal(await evaluate(cartExpression), baseline[id].cart, id + " cart unchanged");
      results.push({ template, width, headerGridPalette: true, cartUnchanged: true });
    }
  }
  if (recording) fs.writeFileSync(process.argv[recordIndex + 1], JSON.stringify(baseline));
  return { recording, results, screenshots: folder };
}
