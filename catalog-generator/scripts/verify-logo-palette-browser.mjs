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
const layoutSettings = true;
const layoutSaves = [];

const id = '11111111-1111-4111-8111-111111111111';
const catalog = { id, publicId: id, name: 'Tienda local', slug: 'local', template: 'FASHION', themePreset: null, active: true, archivedAt: null, logoUrl: null };
const products = Array.from({length: 48}, (_, i) => ({id:`22222222-2222-4222-8222-${String(i).padStart(12,'0')}`,catalogId:id,name:`Producto ${String(i).padStart(2,'0')}`,slug:`producto-${i}`,price:1000,stock:1,active:true,featured:false,needsCompletion:false,categoryId:null,category:null,images:[],description:null,brand:null,model:null,sku:null,salePrice:null,saleStartsAt:null,saleEndsAt:null}));
let logoBytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'),allowLogoCors=true,logoDelay=0,uploads=0; const imageReads=[];
const banners = []; const reads = []; let next, chrome, socket, api; let seq = 0, stage = 'startup';
let loseFeaturedResponse = false, failBannerUpload = false;
const pending = new Map(), scriptUrls = new Set(), errors = [];
const report = {success:false, productionAccess:false, realDatabase:false, baseline, checks:[], weights:{}};
const pause = ms => new Promise(r=>setTimeout(r,ms));
async function poll(work, timeout=15000) { const end=Date.now()+timeout; while(Date.now()<end){if(await work())return;await pause(60);}throw Error('TIMEOUT:'+stage); }
function command(method,params={}){const key=++seq;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(key);reject(Error('CDP_TIMEOUT:'+method));},15000);pending.set(key,{resolve:v=>{clearTimeout(timer);resolve(v);},reject});socket.send(JSON.stringify({id:key,method,params}));});}
async function evaluate(expression){const r=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error('EVALUATION_FAILED:'+stage);return r.result.value;}
const click = text => evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!b||b.disabled)return false;b.click();return true})()`);
function weight(){let bytes=0,gzip=0;for(const url of scriptUrls){const file=path.join(root,'.next',new URL(url).pathname.replace('/_next/',''));if(fs.existsSync(file)){const data=fs.readFileSync(file);bytes+=data.length;gzip+=gzipSync(data).length;}}return {bytes,gzip,chunks:scriptUrls.size};}
try {
  const pem=execFileSync('C:/Program Files/Git/usr/bin/openssl.exe',['req','-x509','-newkey','rsa:2048','-nodes','-keyout','-','-out','-','-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1,DNS:localhost'],{encoding:'utf8',stdio:['ignore','pipe','ignore'],windowsHide:true});
  const cert=pem.match(/-----BEGIN CERTIFICATE-----[^]*?-----END CERTIFICATE-----/)?.[0];
  const key=pem.match(/-----BEGIN (?:RSA )?PRIVATE KEY-----[^]*?-----END (?:RSA )?PRIVATE KEY-----/)?.[0];assert.ok(cert&&key);
  const ca=path.join(folder,'localhost-public-cert.pem');fs.writeFileSync(ca,cert);
  api=https.createServer({key,cert},async(req,res)=>{
    try {
      const url=new URL(req.url,'https://127.0.0.1:4339');reads.push({method:req.method,path:url.pathname,search:url.search});
      if(url.pathname==='/logo.png'){imageReads.push({cors:req.headers['sec-fetch-mode']==='cors',credentials:Boolean(req.headers.cookie||req.headers.authorization)});if(logoDelay)await pause(logoDelay);res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store',...(allowLogoCors?{'Access-Control-Allow-Origin':'http://localhost:4338'}:{})});return res.end(logoBytes);}
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
      if(url.pathname===`/api/catalogs/${id}/logo`){catalog.logoUrl=req.method==='DELETE'?null:'https://127.0.0.1:4339/logo.png?upload='+ ++uploads;return reply({logoUrl:catalog.logoUrl},req.method==='POST'?201:200);}
      if(catalog.archivedAt)return reply({message:'Reactiva el catálogo antes de gestionar sus anuncios.'},409);
      if(url.pathname.startsWith('/api/products/')&&req.method==='PUT'){
        const product=products.find(p=>p.id===url.pathname.split('/').pop());if(!product)return reply({message:'Producto no encontrado'},404);
        if(data.featured&&!product.featured&&selected().length>=5)return reply({message:'Solo puedes seleccionar cinco productos destacados.'},409);
        product.featured=data.featured;if(loseFeaturedResponse){loseFeaturedResponse=false;req.socket.destroy();return;}return reply({success:true,result:{count:1}});
      }
      if(layoutSettings&&url.pathname===`/api/catalogs/${id}`&&req.method==='PUT'){layoutSaves.push(data);Object.assign(catalog,data);return reply({success:true});}
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
  socket.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(m.error)p?.reject(Error('CDP_FAILED:'+m.error.message));else p?.resolve(m.result);}else if(m.method==='Network.responseReceived'&&m.params.type==='Script'&&m.params.response.url.includes('/_next/'))scriptUrls.add(m.params.response.url);else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);});
  await command('Runtime.enable');await command('Page.enable');await command('Network.enable');
  await command('Network.setBlockedURLs',{urls:['*accounts.google.com/*','*fonts.googleapis.com/*','*fonts.gstatic.com/*']});
  await command('Network.setCookie',{name:'catalogo_session',value:'synthetic-local-session',url:'http://localhost:4338/',httpOnly:true,sameSite:'Lax'});
  await command('Page.addScriptToEvaluateOnNewDocument',{source:`if(location.hostname==='localhost')localStorage.setItem('catalogo-session',JSON.stringify({user:{id:'local-test-user',email:'test@example.invalid',name:null}}))`});
  stage='workspace';await command('Page.navigate',{url:`http://localhost:4338/dashboard/catalogos/${id}?page=2&q=Producto&sort=name`});
  await poll(()=>evaluate(`document.querySelectorAll('section[aria-busy] article').length===24`));await pause(150);
  report.weights.initial=weight();
  stage='settings';assert.equal(await click('Tienda y diseño'),true);await poll(()=>evaluate(`Boolean([...document.querySelectorAll('h3')].find(e=>e.textContent==='Información del negocio'))`));await pause(300);
  report.weights.settings=weight();
  report.weights.modules={};for(const url of scriptUrls){const file=path.join(root,'.next',new URL(url).pathname.replace('/_next/',''));if(fs.existsSync(file)){const b=fs.readFileSync(file);if(b.includes(Buffer.from('#FCD34D')))report.weights.modules.paletteRegistry={bytes:b.length,gzip:gzipSync(b).length};}}
  const suggestion = `[data-logo-suggestion]`;
  async function openSettings(){await command('Page.navigate',{url:`http://localhost:4338/dashboard/catalogos/${id}`});await poll(()=>evaluate(`document.querySelectorAll('section[aria-busy] article').length===24`));await click('Tienda y diseño');await poll(()=>evaluate(`Boolean(document.querySelector('[data-logo-palette]'))`));}
  async function makePng(kind='green',size=10){return evaluate(`(async()=>{const c=document.createElement('canvas');c.width=c.height=${size};const x=c.getContext('2d');if(${JSON.stringify(kind)}==='white-background'){x.fillStyle='#ffffff';x.fillRect(0,0,c.width,c.height);x.fillStyle='#166534';x.fillRect(2,2,6,6);}else if(${JSON.stringify(kind)}==='transparent'){x.fillStyle='#166534';x.fillRect(2,2,6,6);}else if(${JSON.stringify(kind)}!=='empty'){x.fillStyle=({white:'#ffffff',black:'#000000',gray:'#888888',green:'#166534',mint:'#5EEAD4',multi:'#166534'})[${JSON.stringify(kind)}];x.fillRect(0,0,c.width,c.height);if(${JSON.stringify(kind)}==='multi'){x.fillStyle='#1D4ED8';x.fillRect(0,0,2,c.height)}}return c.toDataURL('image/png').split(',')[1]})()`);}
  async function upload(kind,size=10){const b64=await makePng(kind,size);await evaluate(`(async()=>{const b=await(await fetch('data:image/png;base64,${b64}')).blob();const d=new DataTransfer();d.items.add(new File([b],'logo.png',{type:'image/png'}));const e=document.querySelector('input[type=file][accept="image/jpeg,image/png,image/webp"]');e.files=d.files;e.dispatchEvent(new Event('change',{bubbles:true}));})()`);await poll(()=>evaluate(`document.body.textContent.includes('Logo actualizado.')&&!document.querySelector('[data-logo-palette] button').disabled`));await pause(200);}
  async function suggested(name='Bosque'){await poll(()=>evaluate(`document.querySelector('${suggestion}')?.textContent.includes(${JSON.stringify(name)})`));}
  stage='no-logo';assert.equal(await evaluate(`document.querySelectorAll('${suggestion}').length`),0);
  assert.ok(await evaluate(`document.querySelector('[data-logo-palette] button').disabled`));
  await command('Page.addScriptToEvaluateOnNewDocument',{source:`window.__logoDimensions=[];const draw=CanvasRenderingContext2D.prototype.drawImage;CanvasRenderingContext2D.prototype.drawImage=function(...args){if(args[0] instanceof ImageBitmap)window.__logoDimensions.push([this.canvas.width,this.canvas.height]);return draw.apply(this,args)}`});
  await evaluate(`window.__logoDimensions=[];const draw=CanvasRenderingContext2D.prototype.drawImage;CanvasRenderingContext2D.prototype.drawImage=function(...args){if(args[0] instanceof ImageBitmap)window.__logoDimensions.push([this.canvas.width,this.canvas.height]);return draw.apply(this,args)}`);
  for(const kind of ['white-background','transparent','multi','white','black','gray','empty']){
    stage='file:'+kind;const count=uploads;await upload(kind);await poll(()=>uploads===count+1);
    if(['white-background','transparent','multi'].includes(kind))await suggested();else assert.equal(await evaluate(`document.querySelectorAll('${suggestion}').length`),0);
    assert.equal(layoutSaves.length,0);
  }
  stage='small-file';await upload('green',2);await suggested();assert.deepEqual(await evaluate(`window.__logoDimensions.at(-1)`),[2,2]);
  assert.equal(imageReads.filter(r=>r.cors).length,0,'New local files do not fetch logo pixels');
  report.checks.push('local uploads: light/transparent backgrounds, multicolor majority, white/black/gray/empty abstention, native 2x2; no extra CORS request and no palette writes');
  stage='choose-other';await click('Elegir otra');assert.equal(layoutSaves.length,0);assert.equal(await evaluate(`document.activeElement.name`),'themePreset');
  await click('Recalcular paleta según el logo');await suggested();
  stage='accept-draft';await click('Usar esta paleta');await poll(()=>evaluate(`document.querySelector('input[name="themePreset"][value="forest"]').checked&&document.activeElement?.value==='forest'`));assert.equal(layoutSaves.length,0);
  await click('Restablecer colores');assert.ok(await evaluate(`document.querySelector('input[name="themePreset"][value=""]').checked`));assert.equal(layoutSaves.length,0);
  await click('Recalcular paleta según el logo');await suggested();await click('Usar esta paleta');await click('Guardar cambios');await poll(()=>layoutSaves.length===1);assert.equal(layoutSaves[0].themePreset,'forest');await poll(()=>evaluate(`!document.querySelector('form button[type=submit]').disabled`));
  await evaluate(`document.querySelector('input[name="themePreset"][value="ocean"]').click()`);await click('Restablecer colores');assert.ok(await evaluate(`document.querySelector('input[name="themePreset"][value="forest"]').checked`));assert.equal(layoutSaves.length,1);
  report.checks.push('choose other focuses selector; accept draft performs no PUT; reset restores null/forest; form confirmation saves exact draft through existing PUT');
  stage='existing-cors-logo';logoBytes=Buffer.from(await makePng(),'base64');catalog.themePreset=null;catalog.logoUrl='https://127.0.0.1:4339/logo.png?existing=1';await openSettings();await suggested();assert.ok(imageReads.some(r=>r.cors));assert.ok(imageReads.every(r=>!r.credentials));assert.equal(layoutSaves.length,1);
  stage='persisted-choice';catalog.themePreset='ocean';catalog.logoUrl='https://127.0.0.1:4339/logo.png?existing=2';const corsBefore=imageReads.filter(r=>r.cors).length;await openSettings();await pause(300);assert.equal(imageReads.filter(r=>r.cors).length,corsBefore);assert.equal(await evaluate(`document.querySelectorAll('${suggestion}').length`),0);
  await click('Recalcular paleta según el logo');await suggested();assert.ok(await evaluate(`document.querySelector('input[name="themePreset"][value="ocean"]').checked`));assert.equal(layoutSaves.length,1);
  for(const change of ['template','palette','logo']){
    stage='late-result:'+change;logoDelay=700;await click('Recalcular paleta según el logo');await pause(80);
    if(change==='template')await evaluate(`document.querySelectorAll('[role="radiogroup"][aria-label="Plantilla del catálogo"] button')[2].click()`);
    if(change==='palette')await evaluate(`document.querySelector('input[name="themePreset"][value="violet"]').click()`);
    if(change==='logo')await click('Quitar');
    await pause(900);assert.equal(await evaluate(`document.querySelectorAll('${suggestion}').length`),0);assert.equal(layoutSaves.length,1);logoDelay=0;
  }
  report.checks.push('existing logo read with CORS and no credentials; persisted palette prevents automatic analysis; late results discarded after template/palette/logo changes');
  stage='persisted-palette-new-upload';const decodedBefore=await evaluate('window.__logoDimensions.length');await upload('green');assert.equal(await evaluate('window.__logoDimensions.length'),decodedBefore);assert.equal(await evaluate(`document.querySelectorAll('${suggestion}').length`),0);assert.equal(layoutSaves.length,1);
  stage='tech-compatibility';catalog.template='TECH';catalog.themePreset=null;logoBytes=Buffer.from(await makePng('mint'),'base64');catalog.logoUrl='https://127.0.0.1:4339/logo.png?mint=1';await openSettings();await suggested('Menta noche');await click('Usar esta paleta');assert.ok(await evaluate(`document.querySelector('input[name="themePreset"][value="night-mint"]').checked`));assert.equal(layoutSaves.length,1);
  stage='cors-failure';allowLogoCors=false;catalog.logoUrl='https://127.0.0.1:4339/logo.png?blocked=1';await openSettings();await pause(600);assert.equal(await evaluate(`document.querySelectorAll('${suggestion}').length`),0);assert.equal(await evaluate(`document.querySelectorAll('[data-logo-palette] [role=alert]').length`),0);assert.equal(layoutSaves.length,1);
  report.checks.push('TECH only night-mint suggestion; CORS failure silent; all analyses leave persisted values untouched');
  stage='decode-failure';allowLogoCors=true;logoBytes=Buffer.from('invalid PNG');catalog.logoUrl='https://127.0.0.1:4339/logo.png?invalid=1';await openSettings();await pause(500);assert.equal(await evaluate(`document.querySelectorAll('${suggestion}').length`),0);assert.equal(await evaluate(`document.querySelectorAll('[data-logo-palette] [role=alert]').length`),0);
  report.weights.afterAnalysis=weight();
  report.weights.deferred=[];for(const url of scriptUrls){const file=path.join(root,'.next',new URL(url).pathname.replace('/_next/',''));if(fs.existsSync(file)){const b=fs.readFileSync(file);const label=b.includes(Buffer.from('Paleta sugerida según tu logo'))?'suggestion':b.includes(Buffer.from('clusterDistance'))?'analysis':b.includes(Buffer.from('#FCD34D'))?'paletteRegistry':null;if(label)report.weights.deferred.push({label,bytes:b.length,gzip:gzipSync(b).length});}}
  assert.deepEqual(errors,[]);
  report.success=true;
} catch(error){report.fixtureState={uploads,logoReads:imageReads.length,saves:layoutSaves.length};report.failedStage=stage;report.error=error instanceof Error?error.message:'CHECK_FAILED';}
finally{
  if(socket?.readyState===WebSocket.OPEN)socket.close();if(chrome)chrome.kill();if(next)next.kill();if(api)await new Promise(resolve=>api.close(resolve));
  report.browserErrors=errors;fs.writeFileSync(path.join(os.tmpdir(),'logo-palette-result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  const resolved=path.resolve(folder);assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(resolved).startsWith('catalog-highlights-browser-'));
  try{fs.rmSync(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:200});}catch{report.profileCleanupPending=true;}
  if(!report.success)process.exitCode=1;
}
