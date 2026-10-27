import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';

const require = createRequire(import.meta.url), root = process.cwd();
const { WebSocket } = require('next/dist/compiled/ws');
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-highlights-browser-'));
const baseline = process.argv.includes('--baseline');
const id = '11111111-1111-4111-8111-111111111111';
const catalog = { id, publicId: id, name: 'Tienda local', slug: 'local', template: 'TECH', themePreset: null, active: true, archivedAt: null, logoUrl: null };
const products = Array.from({length: 48}, (_, i) => ({id:`22222222-2222-4222-8222-${String(i).padStart(12,'0')}`,catalogId:id,name:`Producto ${String(i).padStart(2,'0')}`,slug:`producto-${i}`,price:1000,stock:1,active:true,featured:false,needsCompletion:false,categoryId:null,category:null,images:[],description:null,brand:null,model:null,sku:null,salePrice:null,saleStartsAt:null,saleEndsAt:null}));
const banners = []; const reads = []; let next, chrome, socket, api; let seq = 0, stage = 'startup';
let loseFeaturedResponse = false, failBannerUpload = false;
const pending = new Map(), scriptUrls = new Set(), errors = [];
const report = {success:false, productionAccess:false, realDatabase:false, baseline, checks:[], weights:{}};
const pause = ms => new Promise(r=>setTimeout(r,ms));
async function poll(work, timeout=15000) { const end=Date.now()+timeout; while(Date.now()<end){if(await work())return;await pause(60);}throw Error('TIMEOUT:'+stage); }
function command(method,params={}){const key=++seq;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(key);reject(Error('CDP_TIMEOUT:'+method));},15000);pending.set(key,{resolve:v=>{clearTimeout(timer);resolve(v);},reject});socket.send(JSON.stringify({id:key,method,params}));});}
async function evaluate(expression){const r=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error('EVALUATION_FAILED:'+stage);return r.result.value;}
const click = text => evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!b||b.disabled)return false;b.click();return true})()`);
const clickNamed = name => evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.getAttribute('aria-label')===${JSON.stringify(name)});if(!b||b.disabled)return false;b.click();return true})()`);
const setInput = (selector,value) => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('INPUT_MISSING');const proto=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
const countIs = count => poll(()=>evaluate(`document.querySelector('[data-featured-count]')?.textContent===${JSON.stringify(count+' de 5 destacados')}`));
function weight(){let bytes=0,gzip=0;for(const url of scriptUrls){const file=path.join(root,'.next',new URL(url).pathname.replace('/_next/',''));if(fs.existsSync(file)){const data=fs.readFileSync(file);bytes+=data.length;gzip+=gzipSync(data).length;}}return {bytes,gzip,chunks:scriptUrls.size};}
try {
  const pem=execFileSync('C:/Program Files/Git/usr/bin/openssl.exe',['req','-x509','-newkey','rsa:2048','-nodes','-keyout','-','-out','-','-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1,DNS:localhost'],{encoding:'utf8',stdio:['ignore','pipe','ignore'],windowsHide:true});
  const cert=pem.match(/-----BEGIN CERTIFICATE-----[^]*?-----END CERTIFICATE-----/)?.[0];
  const key=pem.match(/-----BEGIN (?:RSA )?PRIVATE KEY-----[^]*?-----END (?:RSA )?PRIVATE KEY-----/)?.[0];assert.ok(cert&&key);
  const ca=path.join(folder,'localhost-public-cert.pem');fs.writeFileSync(ca,cert);
  api=https.createServer({key,cert},async(req,res)=>{
    try {
      const url=new URL(req.url,'https://127.0.0.1:4339');reads.push({method:req.method,path:url.pathname,search:url.search});
      if(url.pathname==='/image.png'){res.writeHead(200,{'Content-Type':'image/png'});return res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'));}
      const reply=(body,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
      const selected=()=>products.filter(p=>p.featured);
      if(req.method==='GET'){
        if(url.pathname===`/api/catalogs/${id}`)return reply({catalog});
        if(url.pathname===`/api/categories/catalog/${id}`)return reply({categories:[]});
        if(url.pathname===`/api/catalogs/${id}/featured`)return reply({products:selected().map(({id,name,active})=>({id,name,active})),selectedCount:selected().length,validCount:selected().filter(p=>p.active).length,visible:selected().filter(p=>p.active).length>=3,warning:null});
        if(url.pathname===`/api/catalogs/${id}/banners`)return reply({banners});
        if(url.pathname.endsWith('/suggestions'))return reply({products:products.filter(p=>p.name.includes(url.searchParams.get('q')??'')).slice(0,5)});
        if(url.pathname.endsWith('/list')){const page=Number(url.searchParams.get('page')??1),pageSize=24;return reply({products:products.slice((page-1)*pageSize,page*pageSize),page,pageSize,totalProducts:48,totalFiltered:48,totalPages:2,needsCompletionCount:0});}
      }
      const chunks=[];for await(const c of req)chunks.push(c);const bytes=Buffer.concat(chunks);
      const multipart=req.headers['content-type']?.startsWith('multipart/form-data');
      const data=multipart?Object.fromEntries(await new Request('http://localhost',{method:'POST',headers:{'Content-Type':req.headers['content-type']},body:bytes}).formData()):bytes.length?JSON.parse(bytes):{};
      if(catalog.archivedAt)return reply({message:'Reactiva el catálogo antes de gestionar sus anuncios.'},409);
      if(url.pathname.startsWith('/api/products/')&&req.method==='PUT'){
        const product=products.find(p=>p.id===url.pathname.split('/').pop());if(!product)return reply({message:'Producto no encontrado'},404);
        if(data.featured&&!product.featured&&selected().length>=5)return reply({message:'Solo puedes seleccionar cinco productos destacados.'},409);
        product.featured=data.featured;if(loseFeaturedResponse){loseFeaturedResponse=false;req.socket.destroy();return;}return reply({success:true,result:{count:1}});
      }
      const bannerBase=`/api/catalogs/${id}/banners`;
      if(url.pathname===bannerBase+'/order'){if(data.ids.length!==banners.length)return reply({message:'Incluye todos los banners del catálogo una sola vez.'},400);banners.sort((a,b)=>data.ids.indexOf(a.id)-data.ids.indexOf(b.id));banners.forEach((b,i)=>b.position=i);return reply({success:true});}
      if(url.pathname.startsWith(bannerBase)){
        if(req.method==='POST'&&failBannerUpload)return reply({message:'La subida de prueba falló. Reintenta sin perder tus datos.'},400);
        const banner=banners.find(b=>b.id===url.pathname.split('/').pop());
        if(req.method==='DELETE'){banners.splice(banners.indexOf(banner),1);return reply({success:true});}
        if(req.method==='POST'&&banners.length>=3)return reply({message:'Solo puedes guardar tres banners.'},409);
        const row=banner??{id:`33333333-3333-4333-8333-${String(banners.length+1).padStart(12,'0')}`,position:banners.length,active:true,subtitle:null,imagePath:'fixture/image.png',imageUrl:'https://127.0.0.1:4339/image.png'};
        for(const field of ['title','subtitle','linkType','linkValue'])if(field in data)row[field]=data[field];
        if('active'in data)row.active=data.active===true||data.active==='true';
        if(!banner)banners.push(row);return reply({success:true,banner:row},banner?200:201);
      }
      return reply({message:'Ruta de prueba no encontrada'},404);
    } catch {res.writeHead(500);res.end('{}');}
  });api.listen(4339,'127.0.0.1');await once(api,'listening');
  next=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'start','--hostname','127.0.0.1','--port','4338'],{cwd:root,env:{...process.env,CATALOG_API_URL:'https://127.0.0.1:4339/api',NEXT_PUBLIC_CATALOG_API_URL:'https://127.0.0.1:4339/api',NODE_EXTRA_CA_CERTS:ca},windowsHide:true,stdio:['ignore','pipe','pipe']});next.stdout.resume();next.stderr.resume();
  await poll(async()=>{try{return(await fetch('http://localhost:4338/login')).ok;}catch{return false;}});
  const executable=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(f=>fs.existsSync(f));assert.ok(executable);
  chrome=spawn(executable,['--headless=new','--disable-gpu','--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run','--no-default-browser-check','--allow-insecure-localhost','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0',`--user-data-dir=${path.join(folder,'profile')}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
  const portFile=path.join(folder,'profile','DevToolsActivePort');await poll(()=>fs.existsSync(portFile));const port=Number(fs.readFileSync(portFile,'utf8').split(/\r?\n/)[0]);
  const target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(p=>p.type==='page');assert.ok(target);
  socket=new WebSocket(target.webSocketDebuggerUrl);await once(socket,'open');
  socket.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(m.error)p?.reject(Error('CDP_FAILED'));else p?.resolve(m.result);}else if(m.method==='Network.responseReceived'&&m.params.type==='Script'&&m.params.response.url.includes('/_next/'))scriptUrls.add(m.params.response.url);else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);});
  await command('Runtime.enable');await command('Page.enable');await command('Network.enable');
  await command('Network.setBlockedURLs',{urls:['*accounts.google.com/*','*fonts.googleapis.com/*','*fonts.gstatic.com/*']});
  await command('Network.setCookie',{name:'catalogo_session',value:'synthetic-local-session',url:'http://localhost:4338/',httpOnly:true,sameSite:'Lax'});
  await command('Page.addScriptToEvaluateOnNewDocument',{source:`if(location.hostname==='localhost')localStorage.setItem('catalogo-session',JSON.stringify({user:{id:'local-test-user',email:'test@example.invalid',name:null}}))`});
  stage='workspace';await command('Page.navigate',{url:`http://localhost:4338/dashboard/catalogos/${id}?page=2&q=Producto&sort=name`});
  await poll(()=>evaluate(`document.querySelectorAll('section[aria-busy] article').length===24`));await pause(150);
  report.weights.initial=weight();
  stage='settings';assert.equal(await click('Tienda y diseño'),true);await poll(()=>evaluate(`Boolean([...document.querySelectorAll('h3')].find(e=>e.textContent==='Información del negocio'))`));await pause(300);
  report.weights.settings=weight();
  if(!baseline){
    stage='featured-global-counter';assert.equal(await click('Productos'),true);await countIs(0);
    assert.ok(await evaluate(`document.querySelector('main').textContent.includes('al menos 3 productos activos')`));
    products[0].featured=true;await evaluate(`window.dispatchEvent(new Event('focus'))`);await countIs(1);
    assert.equal(await evaluate(`document.querySelectorAll('button[aria-label^="Quitar destacado:"][aria-pressed="true"]').length`),0);
    const beforeUrl=await evaluate('location.href'), listReads=reads.filter(r=>r.path.endsWith('/list')).length;
    for(let index=24;index<28;index++){assert.equal(await clickNamed(`Destacar: ${products[index].name}`),true);await countIs(index-22);}
    assert.equal(await evaluate('location.href'),beforeUrl);assert.equal(reads.filter(r=>r.path.endsWith('/list')).length,listReads);
    assert.ok(await evaluate(`document.querySelector('button[aria-label="Destacar: Producto 28"]').disabled`));
    for(let index=24;index<27;index++){assert.equal(await clickNamed(`Quitar destacado: ${products[index].name}`),true);await countIs(28-index);}
    assert.ok(await evaluate(`document.querySelector('main').textContent.includes('al menos 3 productos activos')`));
    report.checks.push('server global counter, zero warning, five limit, unmark below three; URL/page/filter/order and list request count unchanged');
    stage='featured-conflict-and-lost-response';
    products[1].featured=true;products[2].featured=true;products[3].featured=true;
    assert.equal(await clickNamed('Destacar: Producto 28'),true);await countIs(5);
    await poll(()=>evaluate(`document.querySelector('main').textContent.includes('Solo puedes seleccionar cinco')`));
    assert.equal(products[28].featured,false);
    products.forEach(p=>p.featured=false);await evaluate(`window.dispatchEvent(new Event('focus'))`);await countIs(0);
    loseFeaturedResponse=true;assert.equal(await clickNamed('Destacar: Producto 28'),true);await countIs(1);
    assert.ok(await evaluate(`Boolean(document.querySelector('button[aria-label="Quitar destacado: Producto 28"]'))`));
    report.checks.push('409 reconciles counter and lost PUT response reconciles committed state without replay');
    stage='banner-create-and-failure';assert.equal(await click('Tienda y diseño'),true);await poll(()=>evaluate(`Boolean([...document.querySelectorAll('button')].find(e=>e.textContent==='Añadir anuncio'&&!e.disabled))`));
    await evaluate(`(()=>{const e=[...document.querySelectorAll('label')].find(e=>e.textContent.trim().startsWith('Descripción del negocio')).querySelector('textarea');e.dataset.testDraft='true';Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'Borrador de negocio sin guardar');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    assert.equal(await click('Añadir anuncio'),true);await poll(()=>evaluate(`Boolean(document.querySelector('form[aria-label="Nuevo anuncio"]'))`));
    const editor='form[aria-label="Nuevo anuncio"]';
    await setInput(editor+' input[name="title"]','Anuncio Uno');await setInput(editor+' input[name="linkValue"]','https://example.invalid/oferta');
    await evaluate(`(async()=>{const c=document.createElement('canvas');c.width=3000;c.height=1500;c.getContext('2d').fillRect(0,0,c.width,c.height);const blob=await new Promise(r=>c.toBlob(r,'image/png'));const d=new DataTransfer();d.items.add(new File([blob],'banner.png',{type:'image/png'}));const input=document.querySelector('form[aria-label="Nuevo anuncio"] input[type="file"]');input.files=d.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await poll(()=>evaluate(`Boolean(document.querySelector('[data-banner-preview] img'))&&!document.querySelector('main').textContent.includes('Preparando imagen')`));
    const ratio=await evaluate(`(()=>{const r=document.querySelector('[data-banner-preview]').getBoundingClientRect();return r.width/r.height})()`);assert.ok(Math.abs(ratio-16/9)<0.02);
    await poll(()=>evaluate(`document.querySelector('[data-banner-preview] img')?.naturalWidth===2400`));
    const postsBefore=reads.filter(r=>r.method==='POST'&&r.path.endsWith('/banners')).length;
    await setInput(editor+' input[name="linkValue"]','javascript:alert(1)');await click('Guardar anuncio');await pause(100);
    assert.equal(reads.filter(r=>r.method==='POST'&&r.path.endsWith('/banners')).length,postsBefore);
    await setInput(editor+' input[name="linkValue"]','https://example.invalid/oferta');
    failBannerUpload=true;assert.equal(await click('Guardar anuncio'),true);await poll(()=>evaluate(`document.querySelector('main').textContent.includes('La subida de prueba falló')`));
    assert.equal(await evaluate(`document.querySelector('form[aria-label="Nuevo anuncio"] input[name="title"]').value`),'Anuncio Uno');
    assert.equal(await evaluate(`document.querySelector('form[aria-label="Nuevo anuncio"] input[name="linkValue"]').value`),'https://example.invalid/oferta');
    failBannerUpload=false;assert.equal(await click('Guardar anuncio'),true);await poll(()=>banners.length===1);await poll(()=>evaluate(`!document.querySelector('form[aria-label="Nuevo anuncio"]')`));
    assert.equal(reads.filter(r=>r.method==='PUT'&&r.path===`/api/catalogs/${id}`).length,0);
    assert.equal(await evaluate(`document.querySelector('textarea[data-test-draft]')?.value`),'Borrador de negocio sin guardar');
    report.weights.editor=weight();report.checks.push('banner compression, 16:9 preview, failed upload retains draft, save never submits business form');
    stage='banner-order-status-delete';
    banners.push({id:'33333333-3333-4333-8333-000000000002',title:'Anuncio Dos',subtitle:null,linkType:'EXTERNAL',linkValue:'https://example.invalid',position:1,active:false,imagePath:'fixture/image.png',imageUrl:'https://127.0.0.1:4339/image.png'});
    await click('Productos');await click('Tienda y diseño');await poll(()=>evaluate(`Boolean(document.querySelector('button[aria-label="Subir Anuncio Dos"]'))`));
    await evaluate(`document.querySelector('button[aria-label="Subir Anuncio Dos"]').focus()`);
    await command('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32});await command('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});
    await poll(()=>banners[0].title==='Anuncio Dos');
    assert.equal(await clickNamed('Desactivar Anuncio Uno'),true);await poll(()=>banners.find(b=>b.title==='Anuncio Uno')?.active===false);
    assert.equal(await clickNamed('Activar Anuncio Uno'),true);await poll(()=>banners.find(b=>b.title==='Anuncio Uno')?.active===true);
    const broken=banners.find(b=>b.title==='Anuncio Uno');broken.linkType='PRODUCT';broken.linkValue='44444444-4444-4444-8444-444444444444';
    assert.equal(await clickNamed('Desactivar Anuncio Uno'),true);await poll(()=>broken.active===false);
    assert.equal(await clickNamed('Editar Anuncio Uno'),true);await poll(()=>evaluate(`Boolean(document.querySelector('form[aria-label="Editar anuncio"]'))`));
    await setInput('input[name="productSearch"]','Producto');
    await poll(()=>evaluate(`Boolean([...document.querySelectorAll('button')].find(b=>b.textContent==='Producto 00'))`));
    await click('Producto 00');await click('Guardar anuncio');await poll(()=>evaluate(`!document.querySelector('form[aria-label="Editar anuncio"]')`));
    assert.equal(broken.linkValue,products[0].id);
    assert.ok(reads.some(r=>r.path.endsWith('/suggestions')));
    await clickNamed('Editar Anuncio Uno');await poll(()=>evaluate(`Boolean(document.querySelector('form[aria-label="Editar anuncio"]'))`));
    assert.equal(await click('Cancelar anuncio'),true);
    assert.equal(await clickNamed('Eliminar Anuncio Dos'),true);await poll(()=>evaluate(`Boolean(document.querySelector('[role="alertdialog"]'))`));
    assert.equal(await click('Eliminar anuncio'),true);await poll(()=>banners.length===1);await poll(()=>evaluate(`!document.querySelector('[role="alertdialog"]')`));
    report.checks.push('banner order includes inactive banner; edit/cancel, activate, deactivate and confirmed deletion');
    banners.push(...[2,3].map(n=>({id:`33333333-3333-4333-8333-${String(n+5).padStart(12,'0')}`,title:`Extra ${n}`,subtitle:null,linkType:'EXTERNAL',linkValue:'https://example.invalid',position:n-1,active:false,imagePath:'fixture/image.png',imageUrl:'https://127.0.0.1:4339/image.png'})));
    banners.forEach((b,i)=>b.position=i);
    await click('Productos');await click('Tienda y diseño');await poll(()=>evaluate(`document.querySelector('main').textContent.includes('3 de 3 anuncios')`));
    assert.ok(await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Añadir anuncio').disabled`));
    banners.splice(1);await click('Productos');await click('Tienda y diseño');await poll(()=>evaluate(`document.querySelector('main').textContent.includes('1 de 3 anuncios')`));
    report.checks.push('three-banner UI limit; broken product destination can be disabled without sending a new destination');
    stage='viewport-keyboard';
    for(const width of [320,390,1024,1440]){
      await command('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<500});await pause(100);
      const layout=await evaluate(`({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth})`);assert.ok(layout.scroll<=layout.width+1,JSON.stringify({width,...layout}));
      await click('Añadir anuncio');await poll(()=>evaluate(`Boolean(document.querySelector('form[aria-label="Nuevo anuncio"]'))`));
      assert.equal(await evaluate(`document.activeElement?.name`),'title');
      await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
      assert.equal(await evaluate(`document.activeElement?.name`),'subtitle');
      await click('Cancelar anuncio');await pause(50);
      assert.equal(await evaluate(`document.activeElement?.textContent`),'Añadir anuncio');
    }
    report.checks.push('320/390/1024/1440 no horizontal overflow; keyboard Tab and focus return');
    stage='archived-controls';catalog.archivedAt=new Date().toISOString();
    await command('Page.reload');await poll(()=>evaluate(`document.querySelector('main').textContent.includes('Reactiva el catálogo para gestionar sus destacados')`));
    assert.ok(await evaluate(`[...document.querySelectorAll('button[aria-label^="Destacar:"],button[aria-label^="Quitar destacado:"]')].every(b=>b.disabled)`));
    await click('Tienda y diseño');await poll(()=>evaluate(`Boolean(document.getElementById('catalog-banners-heading'))`));
    assert.ok(await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Añadir anuncio').disabled`));
    report.checks.push('archived catalog disables featured and banner management');
    assert.deepEqual(errors,[]);
  }
  report.success=true;
} catch(error){report.failedStage=stage;report.error=error instanceof Error?error.message:'CHECK_FAILED';}
finally{
  if(socket?.readyState===WebSocket.OPEN)socket.close();if(chrome)chrome.kill();if(next)next.kill();if(api)await new Promise(resolve=>api.close(resolve));
  report.browserErrors=errors;console.log(JSON.stringify(report,null,2));
  const resolved=path.resolve(folder);assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(resolved).startsWith('catalog-highlights-browser-'));
  try{fs.rmSync(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:200});}catch{report.profileCleanupPending=true;}
  if(!report.success)process.exitCode=1;
}
