import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { privatePanelFixture } from "./private-panel-browser-fixture.mjs";

// /login visual redesign: real Chromium and Next proxy, simulated API. Checks that the access flow keeps
// its fields, attributes, modes, Google entry, error alert and keyboard order, plus layout and contrast.
const requests = [], checks = [];
async function api(req, res) {
  const url = new URL(req.url, "https://127.0.0.1:4339");
  let raw = ""; for await (const chunk of req) raw += chunk;
  requests.push({ method: req.method, path: url.pathname, body: raw ? JSON.parse(raw) : null });
  const reply = (body, status) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
  if (req.method === "POST" && url.pathname === "/api/auth/login") return reply({ message: "Correo o contraseña incorrectos." }, 401);
  return reply({}, 404);
}

try {
  await privatePanelFixture(api, async ({ command, evaluate, poll, fill }) => {
    const text = () => evaluate("document.body.innerText");
    const button = label => `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)})`;
    const click = async label => { await poll(() => evaluate(`Boolean(${button(label)})`)); await evaluate(`${button(label)}.click()`); };
    const attr = (selector, name) => evaluate(`document.querySelector(${JSON.stringify(selector)})?.getAttribute(${JSON.stringify(name)}) ?? null`);
    const viewport = async width => { await command("Emulation.setDeviceMetricsOverride", { width, height: width < 768 ? 900 : 1000, deviceScaleFactor: 1, mobile: width < 768 }); await new Promise(r => setTimeout(r, 300)); };
    const shot = async name => {
      const folder = process.env.LOGIN_SCREENSHOTS; if (!folder) return;
      const { data } = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
      writeFileSync(path.join(folder, `${name}.png`), Buffer.from(data, "base64"));
    };

    await command("Page.navigate", { url: "http://localhost:4338/login" });
    await poll(async () => (await text()).includes("Inicia sesión"));

    // Fields and attributes are those of the previous screen.
    assert.equal(await attr("#login-email", "type"), "email"); assert.equal(await attr("#login-email", "autocomplete"), "email"); assert.notEqual(await attr("#login-email", "required"), null);
    assert.equal(await attr("#login-password", "type"), "password"); assert.equal(await attr("#login-password", "autocomplete"), "current-password");
    assert.equal(await attr("#login-password", "minlength"), "1"); assert.notEqual(await attr("#login-password", "required"), null);
    assert.equal(await evaluate(`document.querySelector('label[for="login-email"]').textContent.trim()`), "Correo electrónico");
    assert.equal(await evaluate(`document.querySelector('label[for="login-password"]').textContent.trim()`), "Contraseña");
    assert.ok(await evaluate(`Boolean(${button("Entrar al panel")}) && ${button("Entrar al panel")}.type === 'submit'`));
    assert.equal(await attr('a[href="/recuperar-contrasena"]', "href"), "/recuperar-contrasena");
    assert.ok(await evaluate(`Boolean(document.querySelector('[data-google-signin]'))`), "Google sign-in (button or configuration notice) is present");
    assert.equal(await evaluate(`[...document.querySelectorAll('a[href="/"]')].filter(a=>a.getAttribute('aria-label')==='Vitrinaya — Ir al inicio').length`), 1, "one home link with the brand");
    assert.equal(await evaluate(`document.querySelector('[role="img"][aria-label="Vitrinaya"]') !== null`), true, "BrandLogo keeps role=img and its label");
    assert.equal(await evaluate(`[...document.querySelectorAll('main svg')].every(s=>s.getAttribute('aria-hidden')==='true')`), true, "all icons and decoration are aria-hidden");
    assert.equal(await evaluate(`document.getAnimations().length`), 0, "no animations");
    checks.push("Login mode: email/password with autocomplete, required and minLength, submit, forgot link, Google entry, labelled logo, decoration aria-hidden, no animations");

    // Show/hide password does not change the value and is a labelled toggle.
    await fill("#login-password", "secreto-1");
    await evaluate(`document.querySelector('button[aria-label="Mostrar contraseña"]').click()`);
    await poll(async () => (await attr("#login-password", "type")) === "text");
    assert.equal(await attr('button[aria-controls="login-password"]', "aria-pressed"), "true");
    await evaluate(`document.querySelector('button[aria-label="Ocultar contraseña"]').click()`);
    await poll(async () => (await attr("#login-password", "type")) === "password");
    assert.equal(await evaluate(`document.querySelector('#login-password').value`), "secreto-1");
    checks.push("Password visibility toggle with aria-label, aria-pressed and aria-controls, value preserved");

    // Failed login keeps the request body and shows the message in role=alert.
    await fill("#login-email", "persona@example.invalid");
    await click("Entrar al panel");
    await poll(() => evaluate(`document.querySelector('[role="alert"]')?.textContent.includes('Correo o contraseña incorrectos.') ?? false`));
    const login = requests.find(r => r.path === "/api/auth/login");
    assert.deepEqual(login.body, { email: "persona@example.invalid", password: "secreto-1" });
    checks.push("Failed login: same request body as before and error in role=alert");

    // Register mode: title, Nombre, new-password with minLength 8, UserPlus submit; the error clears.
    await click("Crear cuenta");
    await poll(async () => (await text()).includes("Crea tu cuenta"));
    assert.equal(await evaluate(`document.querySelector('[role="alert"]')`), null, "changing mode clears the error");
    assert.ok(await evaluate(`document.querySelector('label[for="login-name"]').textContent.includes('Nombre')`));
    assert.equal(await attr("#login-name", "autocomplete"), "name");
    assert.equal(await attr("#login-password", "autocomplete"), "new-password"); assert.equal(await attr("#login-password", "minlength"), "8");
    assert.equal(await attr("#login-password", "placeholder"), "Al menos 8 caracteres");
    assert.equal(await evaluate(`document.querySelectorAll('button[type="submit"]').length`), 1);
    assert.equal(await evaluate(`document.querySelector('button[type="submit"]').textContent.trim()`), "Crear cuenta");
    assert.equal(await evaluate(`document.querySelector('a[href="/recuperar-contrasena"]')`), null, "forgot link only in login mode, as before");
    assert.equal(await evaluate(`${button("Crear cuenta")}.getAttribute('aria-pressed')`), "true");
    checks.push("Register mode: «Crea tu cuenta», Nombre (optional, autocomplete name), new-password with minLength 8, «Crear cuenta» submit");

    // Keyboard order in login mode follows the visual order.
    await click("Iniciar sesión"); await poll(async () => (await text()).includes("Inicia sesión"));
    await evaluate(`document.querySelector('a[aria-label="Vitrinaya — Ir al inicio"]').focus()`);
    const order = ["Vitrinaya — Ir al inicio"];
    for (let i = 0; i < 7; i++) {
      for (const type of ["keyDown", "keyUp"]) await command("Input.dispatchKeyEvent", { type, key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
      order.push(await evaluate(`(()=>{const e=document.activeElement;return e.id||e.getAttribute('aria-label')||e.textContent.trim()||e.tagName})()`));
    }
    assert.deepEqual(order.slice(0, 8), ["Vitrinaya — Ir al inicio", "Iniciar sesión", "Crear cuenta", "login-email", "login-password", "Mostrar contraseña", "¿Olvidaste tu contraseña?", "Entrar al panel"]);
    checks.push(`Keyboard order: ${order.slice(0, 8).join(" → ")} → Google`);

    // Contrast of the main texts and controls, measured on computed colors.
    const contrast = await evaluate(`(()=>{
      const rgb=s=>s.match(/[\\d.]+/g).slice(0,3).map(Number);
      const lum=c=>{const [r,g,b]=c.map(v=>v/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4);return .2126*r+.7152*g+.0722*b};
      const ratio=(a,b)=>{const x=lum(rgb(a)),y=lum(rgb(b));return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
      const bg=e=>{for(let n=e;n;n=n.parentElement){const c=getComputedStyle(n).backgroundColor;if(!/rgba\\(.*, 0\\)|transparent/.test(c))return c;}return 'rgb(255,255,255)'};
      const pick=(sel)=>{const e=typeof sel==='string'?document.querySelector(sel):sel;return ratio(getComputedStyle(e).color,bg(e))};
      return {
        title: pick('h1'), subtitle: pick('h1 + p'),
        activeTab: pick(${button("Iniciar sesión")}), inactiveTab: pick(${button("Crear cuenta")}),
        submit: pick('button[type="submit"]'), forgot: pick('a[href="/recuperar-contrasena"]'),
        label: pick('label[for="login-email"]'), cookieNote: pick('main section > div > p:last-child'),
        fieldBorder: ratio(getComputedStyle(document.querySelector('#login-email')).borderTopColor,'rgb(255,255,255)'),
      };
    })()`);
    for (const [name, value] of Object.entries(contrast)) assert.ok(value >= (name === "fieldBorder" ? 3 : 4.5), `${name} contrast ${value.toFixed(2)}`);
    checks.push("Contrast: " + Object.entries(contrast).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(", "));

    // Layout: no horizontal overflow, touch targets ≥ 44 px, decoration never covers the slogan.
    for (const width of [320, 375, 390, 768, 1024, 1440]) {
      await viewport(width);
      const overflow = await evaluate(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
      assert.ok(overflow <= 0, `overflow ${overflow}px at ${width}`);
      const small = await evaluate(`[...document.querySelectorAll('main a, main button, main input')].filter(e=>e.getClientRects().length).map(e=>[e.id||e.textContent.trim()||e.getAttribute('aria-label'),e.getBoundingClientRect().height]).filter(([,h])=>h<44)`);
      assert.deepEqual(small, [], `touch targets at ${width}`);
      const bagOverlap = await evaluate(`(()=>{const b=document.querySelector('aside svg.lucide-shopping-bag');if(!b||!b.getClientRects().length)return false;const r=b.getBoundingClientRect();return [...document.querySelectorAll('aside h2, aside h2 + svg + p')].some(t=>{const range=document.createRange();range.selectNodeContents(t);return [...range.getClientRects()].some(q=>q.right>r.left+8&&q.left<r.right&&q.bottom>r.top&&q.top<r.bottom)})})()`);
      assert.equal(bagOverlap, false, `shopping bag overlaps text at ${width}`);
      const desktop = await evaluate(`getComputedStyle(document.querySelector('aside ul')).display !== 'none'`);
      assert.equal(desktop, width >= 1024, `feature list only on desktop (${width})`);
      if ([375, 1440].includes(width)) await shot(`login-${width}`);
    }
    await command("Emulation.clearDeviceMetricsOverride");
    checks.push("No overflow and touch targets ≥ 44 px at 320, 375, 390, 768, 1024 and 1440 px; bag never covers text; features only from lg");

    assert.deepEqual(requests.map(r => r.path), ["/api/auth/login"], "the page only calls the API on submit");
    console.log(JSON.stringify({ checks, productionAccess: false, simulatedApi: true }, null, 2));
  }, { browser: "chrome", sandbox: false });
} catch (error) { console.error(error); process.exitCode = 1; }
