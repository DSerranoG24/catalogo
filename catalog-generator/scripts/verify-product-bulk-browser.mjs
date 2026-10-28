import assert from 'node:assert/strict';
import { privatePanelFixture } from './private-panel-browser-fixture.mjs';

const catalogId = '11111111-1111-4111-8111-111111111111';
const catalog = { id: catalogId, publicId: catalogId, name: 'Lotes fixture', slug: 'fixture', template: 'TECH', active: true, archivedAt: null, logoUrl: null };
const products = Array.from({ length: 120 }, (_, i) => ({ id: `22222222-2222-4222-8222-${String(i).padStart(12, '0')}`, catalogId, name: `Producto ${String(i).padStart(3, '0')}`, slug: `producto-${i}`, updatedAt: '2026-10-28T12:00:00.000Z', price: 100, stock: 1, active: true, featured: false, needsCompletion: false, categoryId: null, category: null, images: [], description: null, brand: null, model: null, sku: null, salePrice: null, saleStartsAt: null, saleEndsAt: null }));
const requests = [], plans = new Map(), checks = [];
let blockPreview = false;
let latestListQuery = '';
let stage = 'startup';
async function api(req, res) {
  const url = new URL(req.url, 'https://127.0.0.1:4339');
  const reply = (body, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (req.method === 'GET') {
    if (url.pathname === '/api/me') return reply({ user: { emailVerifiedAt: '2026-10-28T00:00:00Z', hasLocalPassword: true } });
    if (url.pathname === `/api/catalogs/${catalogId}`) return reply({ catalog });
    if (url.pathname === `/api/categories/catalog/${catalogId}`) return reply({ categories: [] });
    if (url.pathname.endsWith('/featured')) return reply({ products: [], selectedCount: 0, validCount: 0, visible: false, warning: null });
    if (url.pathname.endsWith('/list')) {
      latestListQuery = url.search;
      const size = Number(url.searchParams.get('pageSize') || 24), filtered = products.filter(product => product.name.includes(url.searchParams.get('q') || ''));
      const pages = Math.max(1, Math.ceil(filtered.length / size)), page = Math.min(Number(url.searchParams.get('page') || 1), pages);
      return reply({ products: filtered.slice((page - 1) * size, page * size), page, pageSize: size, totalProducts: products.length, totalFiltered: filtered.length, totalPages: pages, needsCompletionCount: 0 });
    }
    if (url.pathname.endsWith('/suggestions')) return reply({ products: [] });
    return reply({}, 404);
  }
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString()); requests.push({ path: url.pathname, body });
  if (url.pathname.endsWith('/bulk/preview')) {
    assert.ok(body.items.length <= 96); assert.equal(new Set(body.items.map(item => item.id)).size, body.items.length);
    if (blockPreview) return reply({ token: null, totalSelected: body.items.length, affected: 0, issues: [{ id: body.items[0].id, message: 'El producto cambió. Revisa antes de confirmar.' }], changes: [] });
    const token = `fixture-plan-${plans.size}`; plans.set(token, body);
    return reply({ token, totalSelected: body.items.length, affected: body.items.length, issues: [], changes: body.items.map(item => ({ id: item.id, name: products.find(product => product.id === item.id).name, skipped: false, before: { price: 100, salePrice: null }, after: { price: body.operation.price ?? 100 } })) });
  }
  if (url.pathname.endsWith('/bulk/confirm')) {
    const plan = plans.get(body.token); assert.ok(plan);
    return reply({ totalSelected: plan.items.length, changed: plan.items.length, skipped: 0, storageWarning: plan.operation.action === 'delete' ? 'Los archivos permanecen en Storage.' : null });
  }
  return reply({}, 404);
}
try {
  await privatePanelFixture(api, async ({ command, evaluate, poll, click, fill }) => {
    await command('Page.navigate', { url: `http://localhost:4338/dashboard/catalogos/${catalogId}` });
    await poll(() => evaluate('document.querySelectorAll("[data-product-selection]").length===24'));
    const selectedCount = async count => poll(() => evaluate(`document.querySelector('[data-bulk-selection]')?.textContent.includes('${count} productos seleccionados en total')`));
    stage = 'cross-page-selection';
    await evaluate(`document.querySelector('[data-product-selection]').click()`); await selectedCount(1);
    await evaluate(`(()=>{const e=[...document.querySelectorAll('select')].find(e=>[...e.options].some(o=>o.value==='createdAt'));e.value='price';e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await poll(() => evaluate(`new URLSearchParams(location.search).get('sort')==='price'`)); await selectedCount(1);
    await poll(() => latestListQuery.includes('sort=price'));
    await poll(() => evaluate(`Boolean([...document.querySelectorAll('button')].find(button=>button.textContent==='Siguiente'&&!button.disabled))`));
    const first = products[0].id;
    await click('Siguiente'); await poll(() => evaluate(`document.querySelector('[data-product-selection]')?.getAttribute('data-product-selection')===${JSON.stringify(products[24].id)}`));
    await evaluate(`document.querySelector('[data-product-selection]').click()`); await selectedCount(2);
    stage = 'filter-persistence'; await fill('#product-list-search', '119');
    await poll(() => evaluate(`document.querySelectorAll('[data-product-selection]').length===1`));
    await selectedCount(2); await evaluate(`document.querySelector('[data-product-selection]').click()`); await selectedCount(3);
    assert.equal(await evaluate(`document.querySelectorAll('[data-product-selection]').length`), 1);
    await fill('[data-bulk-price]', '90');
    await fill('input[placeholder="Ej. Lámpara de mesa"]', 'Borrador sin guardar');
    assert.ok(await evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent==='Revisar 3 seleccionados').disabled`));
    await selectedCount(3); await fill('input[placeholder="Ej. Lámpara de mesa"]', '');
    blockPreview = true; await click('Revisar 3 seleccionados');
    await poll(() => evaluate(`document.body.textContent.includes('Revisa antes de confirmar.')`));
    assert.equal(await evaluate(`[...document.querySelectorAll('button')].filter(button=>button.textContent.startsWith('Confirmar cambiar precio')).length`), 0);
    await selectedCount(3); blockPreview = false; await click('Revisar 3 seleccionados');
    await poll(() => evaluate(`Boolean(document.querySelector('[data-bulk-preview]'))`));
    const preview = requests.find(request => request.path.endsWith('/preview')).body;
    assert.deepEqual(preview.items.map(item => item.id), [first, products[24].id, products[119].id]);
    assert.ok(preview.items.every(item => item.updatedAt)); assert.equal(preview.operation.price, 90);
    assert.ok(await evaluate(`document.querySelector('[data-bulk-preview]').textContent.includes('3 seleccionados en total')`));
    checks.push('Selection survives pagination and filters; preview submits all 3 IDs despite only 1 visible');
    checks.push('Unsaved editor drafts and preview conflicts block confirmation without clearing selection');
    stage = 'atomic-confirm-ui'; await click('Confirmar cambiar precio para 3 seleccionados');
    await poll(() => evaluate(`!document.querySelector('[data-bulk-selection]')&&document.body.textContent.includes('Lote de 3 seleccionados: 3 modificados')`));
    assert.equal(plans.get(requests.at(-1).body.token).items.length, 3);
    checks.push('Confirmation uses the total selected and clears selection only after successful execution');
    stage = 'destructive-confirmation';
    await evaluate(`document.querySelector('[data-product-selection]').click()`); await selectedCount(1);
    await evaluate(`(()=>{const e=document.querySelector('[data-bulk-action]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,'delete');e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await click('Revisar 1 seleccionados'); await poll(() => evaluate(`Boolean(document.querySelector('[data-bulk-confirm]'))`));
    assert.ok(await evaluate(`document.querySelector('[data-bulk-preview] button').disabled`));
    await fill('[data-bulk-confirm]', 'ELIMINAR 1'); await click('Confirmar borrar para 1 seleccionados');
    await poll(() => evaluate(`document.body.textContent.includes('Los archivos permanecen en Storage.')`));
    assert.equal(requests.at(-1).body.confirmation, 'ELIMINAR 1');
    checks.push('Destructive action requires typed total; success explicitly warns that Storage files remain');
    stage = 'page-size-and-order'; await click('Limpiar filtros');
    await poll(() => evaluate(`document.querySelectorAll('[data-product-selection]').length===24`));
    await evaluate(`document.querySelector('[data-product-selection]').click()`); await selectedCount(1);
    await evaluate(`(()=>{const e=[...document.querySelectorAll('select')].find(e=>[...e.options].some(o=>o.value==='96'));e.value='48';e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await poll(() => evaluate(`document.querySelectorAll('[data-product-selection]').length===48`)); await selectedCount(1);
    await evaluate(`(()=>{const e=[...document.querySelectorAll('select')].find(e=>[...e.options].some(o=>o.value==='96'));e.value='96';e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await poll(() => evaluate(`document.querySelectorAll('[data-product-selection]').length===96`)); await selectedCount(1);
    await evaluate(`(()=>{const label=[...document.querySelectorAll('label')].find(e=>e.textContent.includes('Seleccionar página actual'));label.querySelector('input').click()})()`); await selectedCount(96);
    await click('Siguiente'); await poll(() => evaluate(`document.querySelectorAll('[data-product-selection]').length===24`)); await selectedCount(96);
    assert.ok(await evaluate(`[...document.querySelectorAll('[data-product-selection]')].every(input=>input.disabled)`));
    for (const width of [320, 390, 1024, 1440]) {
      await command('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'), 'OVERFLOW:' + width);
      await evaluate('scrollTo(0,500)');
      assert.ok(await evaluate(`(()=>{const r=document.querySelector('[data-bulk-selection]').getBoundingClientRect();return r.top>=-1&&r.top<100&&r.bottom<=innerHeight})()`));
    }
    await click('Salir de la selección'); await poll(() => evaluate(`!document.querySelector('[data-bulk-selection]')`));
    checks.push('Order and 24/48/96 page sizes preserve selection; 96 limit blocks more; sticky total and exit stay visible at four widths');
  });
  console.log(JSON.stringify({ success: true, checks, fixtureRequests: requests.length, productionAccess: false, realDatabase: false }, null, 2));
} catch (error) { console.log(JSON.stringify({ success: false, stage, error: error instanceof Error ? error.message : 'FAILED', checks }, null, 2)); process.exitCode = 1; }
