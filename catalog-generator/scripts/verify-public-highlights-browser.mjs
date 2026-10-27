import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';
import { auditThemeContrast } from './public-theme-contrast.mjs';
const require=createRequire(import.meta.url),{WebSocket}=require('next/dist/compiled/ws');
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'public-highlights-browser-'));
const baseline=process.argv.includes('--baseline'), pending=new Map(), errors=[];
let api,next,chrome,socket,sequence=0,stage='startup';
const report={success:false,baseline,productionAccess:false,realDatabase:false,checks:[],contrasts:[],weights:{}};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function poll(work,timeout=15000){const until=Date.now()+timeout;while(Date.now()<until){if(await work())return;await pause(40);}throw Error('TIMEOUT:'+stage);}
function command(method,params={}){const id=++sequence;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP_TIMEOUT:'+method));},15000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject});socket.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const r=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error('EVALUATION_FAILED:'+stage+':'+(r.exceptionDetails.exception?.description?.split('\n')[0]??r.exceptionDetails.text));return r.result.value;}
function fixture(publicId){
  const [template,preset='null',content='full']=publicId.split('~');
  const categories=[{id:'category-a',name:'Categoría A',slug:'a',imageUrl:null,position:0},{id:'category-b',name:'Categoría B',slug:'b',imageUrl:null,position:1}];
  const products=Array.from({length:25},(_,i)=>({id:`p${i}`,name:`Producto ${i}`,slug:`producto-${i}`,description:null,brand:null,model:null,categoryId:categories[i%2].id,category:{id:categories[i%2].id,name:categories[i%2].name},price:1000,regularPrice:i===21?2000:null,discountPercent:i===21?50:null,saleEndsAt:null,images:[]}));
  const banner={id:'b0',title:'Anuncio principal',subtitle:'Información legible sobre una superficie opaca.',linkType:'PRODUCT',linkValue:'p0',position:0,imageUrl:'http://127.0.0.1:4347/image.png'};
  return {publicId,name:'Negocio de ejemplo con identidad propia',slug:'ejemplo',description:'Selección local de prueba',logoUrl:content==='logo'?'http://127.0.0.1:4347/image.png':null,whatsappPhone:null,whatsappMessage:null,phone:'+573000000000',businessHours:'Lunes a viernes\nDe 9:00 a 18:00',address:null,email:null,instagramUrl:null,facebookUrl:null,tiktokUrl:null,mapUrl:null,template,themePreset:preset==='null'?null:preset,categories,products,
    featuredProducts:content==='empty'?[]:content==='two'?products.slice(0,2):products.slice(20,25),
    banners:content==='empty'||content==='two'?[]:content==='single'?[banner]:[banner,{...banner,id:'b1',title:'Ir a categoría B',linkType:'CATEGORY',linkValue:'category-b',position:1},{...banner,id:'b2',title:'Enlace externo',linkType:'EXTERNAL',linkValue:'https://example.invalid',position:2}]};
}
async function weight(publicId='TECH'){const html=await(await fetch('http://127.0.0.1:4348/c/'+publicId)).text();const files=[...new Set([...html.matchAll(/<script\b([^>]*)src="([^"]+)"([^>]*)>/g)].filter(m=>m[2].startsWith('/_next/')&&!/nomodule/i.test(m[1]+m[3])).map(m=>m[2]))];let bytes=0,gzip=0,paletteRegistryInInitial=false;for(const file of files){const b=fs.readFileSync('.next'+file.replace('/_next',''));bytes+=b.length;gzip+=gzipSync(b).length;paletteRegistryInInitial ||= b.includes(Buffer.from('#FCD34D'));}return{bytes,gzip,chunks:files.length,paletteRegistryInInitial};}
async function navigate(id,query=''){const url=`http://127.0.0.1:4348/c/${id}${query}`;const result=await command('Page.navigate',{url});assert.ok(!result.errorText);await poll(()=>evaluate(`location.href===${JSON.stringify(url)}&&document.readyState==='complete'&&Boolean(document.querySelector('h1'))`));await pause(70);}
try{
  api=http.createServer((req,res)=>{if(req.url==='/image.png'){res.writeHead(200,{'Content-Type':'image/png'});return res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'));}const id=decodeURIComponent(req.url.split('/').pop());res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({catalog:fixture(id)}));});api.listen(4347,'127.0.0.1');await once(api,'listening');
  next=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'start','--hostname','127.0.0.1','--port','4348'],{env:{...process.env,NEXT_PUBLIC_CATALOG_API_URL:'http://127.0.0.1:4347/api'},windowsHide:true,stdio:['ignore','pipe','pipe']});next.stdout.resume();next.stderr.resume();
  await poll(async()=>{try{return(await fetch('http://127.0.0.1:4348/login')).ok;}catch{return false;}});
  report.weights.initial=await weight();
  if(!baseline){
    assert.ok(report.weights.initial.gzip-160370<=15000,'PUBLIC_JS_LIMIT_EXCEEDED');
    assert.equal(report.weights.initial.paletteRegistryInInitial,false);
    assert.deepEqual(await weight('FASHION~night-amber'),report.weights.initial);
    report.checks.push('same initial scripts with null/dark preset; palette registry excluded from initial JavaScript');
    const executable=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(file=>fs.existsSync(file));assert.ok(executable);
    chrome=spawn(executable,['--headless=new','--disable-gpu','--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run','--no-default-browser-check','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0',`--user-data-dir=${path.join(folder,'profile')}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
    const portFile=path.join(folder,'profile','DevToolsActivePort');await poll(()=>fs.existsSync(portFile));const port=Number(fs.readFileSync(portFile,'utf8').split(/\r?\n/)[0]);
    const target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(page=>page.type==='page');assert.ok(target);
    socket=new WebSocket(target.webSocketDebuggerUrl);await once(socket,'open');
    socket.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(m.error)p?.reject(Error('CDP_FAILED'));else p?.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);});
    await command('Runtime.enable');await command('Page.enable');await command('Network.enable');
    await command('Network.setBlockedURLs',{urls:['*accounts.google.com/*','*fonts.googleapis.com/*','*fonts.gstatic.com/*']});
    const templates=['TECH','FASHION','BEAUTY','GLAMOUR'],presets=['forest','ocean','terracotta','rose','violet','graphite','night-mint','night-amber'];
    if(!process.argv.includes('--interactions-only')){
    let cases=0;
    for(const template of templates)for(const preset of ['null',...presets.filter(p=>template!=='TECH'||p.startsWith('night-'))]){
      stage=`matrix:${template}:${preset}`;
      for(const width of [320,390,1024,1440]){
        await command('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<500});
        await navigate(`${template}~${preset}`);
        const state=await evaluate(`(()=>{const sections=[...document.querySelectorAll('header,[data-public-section],nav[aria-label="Filtrar por categoría"],#productos,#contacto')].map(e=>e.tagName==='HEADER'?'header':e.getAttribute('data-public-section')||e.id||'categories');return {sections,width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,panels:document.querySelectorAll('[data-banner-panel]').length,cards:document.querySelectorAll('[data-public-section="product"] [data-product-card]').length}})()`);
        assert.ok(state.scroll<=state.width+1,JSON.stringify({template,preset,width,...state}));assert.equal(state.panels,3);assert.equal(state.cards,5);
        assert.deepEqual(state.sections,['header','banner','product','categories','productos','contacto']);
        if(width===390){const contrast=await evaluate(`(${auditThemeContrast.toString()})('[data-banner-panel]',false)`);assert.deepEqual(contrast.failures,[],JSON.stringify({template,preset,contrast}));assert.ok(contrast.minimum>=4.5);report.contrasts.push({template,preset,minimum:Number(contrast.minimum.toFixed(2))});}
        cases++;
      }
    }
    report.checks.push(`${cases} template/palette/width cases; order, content, opaque panel contrast and no document overflow`);
    stage='empty-single-logo';
    for(const template of templates){
      await navigate(`${template}~null~empty`);assert.equal(await evaluate(`document.querySelectorAll('[data-catalog-highlights]').length`),0);
      await navigate(`${template}~null~two`);assert.equal(await evaluate(`document.querySelectorAll('[data-catalog-highlights]').length`),0);
      await navigate(`${template}~null~single`);assert.ok(await evaluate(`Boolean(document.querySelector('[data-banner-static]'))&&!document.querySelector('[data-public-rail="banner"]')`));
      for(const [width,height] of [[320,40],[1440,56]]){
        await command('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<500});await navigate(`${template}~null~logo`);
        const rect=await evaluate(`(()=>{const r=document.querySelector('[data-catalog-logo]').getBoundingClientRect();return {width:r.width,height:r.height}})()`);assert.equal(rect.height,height);assert.ok(rect.width<=160);
      }
    }
    report.checks.push('four templates: empty and under-three sections absent, single banner static, logo 40/56 px and bounded width');
    stage='category-and-pagination';await navigate('FASHION');await poll(()=>evaluate(`Boolean(document.querySelector('button[aria-label="Siguiente en Destacados"]'))`));
    const idsBefore=await evaluate(`[...document.querySelectorAll('[data-public-section="product"] a')].map(a=>a.getAttribute('href'))`);
    await evaluate(`document.querySelector('button[aria-label="Página siguiente"]').click()`);
    await poll(()=>evaluate(`document.querySelectorAll('#productos [data-product-card]').length===5`));
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('[data-public-section="product"] a')].map(a=>a.getAttribute('href'))`),idsBefore);
    await evaluate(`(()=>{const e=document.querySelector('input[type="search"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'Producto');e.dispatchEvent(new Event('input',{bubbles:true}));const s=document.querySelector('select[aria-label="Ordenar productos"]');s.value='name-asc';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await evaluate(`document.querySelector('a[href="/c/FASHION?category=category-b#productos"]').click()`);
    await poll(()=>evaluate(`location.search==='?category=category-b'&&document.querySelectorAll('#productos [data-product-card]').length===12`));
    assert.equal(await evaluate(`document.querySelector('input[type="search"]').value`),'Producto');assert.equal(await evaluate(`document.querySelector('select[aria-label="Ordenar productos"]').value`),'name-asc');
    await evaluate(`document.querySelector('nav[aria-label="Filtrar por categoría"] a[href="/c/FASHION#productos"]').click()`);
    await poll(()=>evaluate(`location.search===''&&document.querySelectorAll('#productos [data-product-card]').length===20`));
    await evaluate(`history.back()`);await poll(()=>evaluate(`location.search==='?category=category-b'&&document.querySelectorAll('#productos [data-product-card]').length===12`));
    await evaluate(`history.forward()`);await poll(()=>evaluate(`location.search===''&&document.querySelectorAll('#productos [data-product-card]').length===20`));
    await command('Page.navigate',{url:'http://127.0.0.1:4348/c/FASHION?category=unknown#productos'});await poll(()=>evaluate(`location.search==='?category=unknown'&&document.readyState==='complete'&&document.querySelectorAll('#productos [data-product-card]').length===20`));
    report.checks.push('category banner and filter links preserve search/order; invalid category falls back; featured source independent of page');
    }
    stage='reduced-motion-mount';
    await command('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:true});
    await command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await navigate('TECH');
    await poll(()=>evaluate(`Boolean(document.querySelector('button[aria-label="Siguiente en Anuncios destacados"]'))`));
    stage='reduced-motion-scroll';
    await evaluate(`(()=>{const e=document.querySelector('[data-public-rail="banner"]');const original=e.scrollBy.bind(e);e.scrollBy=options=>{e.dataset.behavior=options.behavior;original(options)};document.querySelector('button[aria-label="Siguiente en Anuncios destacados"]').focus()})()`);
    report.motionBefore=await evaluate(`({active:document.activeElement?.getAttribute('aria-label'),width:document.querySelector('[data-public-rail="banner"]').clientWidth,scroll:document.querySelector('[data-public-rail="banner"]').scrollWidth,nextDisabled:document.querySelector('button[aria-label="Siguiente en Anuncios destacados"]').disabled})`);
    await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'});await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
    await poll(()=>evaluate(`document.querySelector('[data-public-rail="banner"]').scrollLeft>0`));
    assert.equal(await evaluate(`document.querySelector('[data-public-rail="banner"]').dataset.behavior`),'auto');
    assert.ok(await evaluate(`parseFloat(getComputedStyle(document.activeElement).outlineWidth)>=2`));
    report.checks.push('reduced motion uses immediate scroll; keyboard activates navigation with visible focus');
    await navigate('TECH~night-mint');
    assert.ok(await evaluate(`(()=>{const a=document.querySelector('[data-public-rail="banner"] a');a.focus();const s=getComputedStyle(a),track=a.closest('ul');return parseFloat(getComputedStyle(track).paddingLeft)>=parseFloat(s.outlineWidth)+parseFloat(s.outlineOffset)})()`));
    report.checks.push('rail padding reserves the themed focus outline and offset');
    stage='without-javascript';await command('Emulation.setScriptExecutionDisabled',{value:true});
    for(const template of templates)for(const width of [320,390,1024,1440]){
      await command('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<500});
      await navigate(template);
      assert.deepEqual(await evaluate(`({panels:document.querySelectorAll('[data-banner-panel]').length,cards:document.querySelectorAll('[data-public-section="product"] [data-product-card]').length,buttons:document.querySelectorAll('button[aria-label^="Siguiente en"]').length})`),{panels:3,cards:5,buttons:0});
      await navigate(template,'?category=category-b#productos');assert.equal(await evaluate(`document.querySelectorAll('#productos [data-product-card]').length`),12);
    }
    await command('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:true});
    await navigate('TECH');await evaluate(`document.querySelector('[data-public-rail="banner"]').scrollIntoView();document.querySelector('[data-public-rail="banner"]').focus()`);
    for(let i=0;i<8;i++){await command('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});await command('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});}
    await poll(()=>evaluate(`document.querySelector('[data-public-rail="banner"]').scrollLeft>0`));
    report.checks.push('JavaScript disabled: content and server category filtering visible in four templates; native keyboard scrolling works without author JS');
    stage='native-swipe-without-javascript';
    await command('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
    const point=await evaluate(`(()=>{const e=document.querySelector('[data-public-rail="banner"]');e.scrollLeft=0;const r=e.getBoundingClientRect();return {x:r.left+r.width*.7,y:r.top+r.height/2}})()`);
    await command('Input.synthesizeScrollGesture',{...point,xDistance:-230,yDistance:0,speed:500,gestureSourceType:'touch'});
    await poll(()=>evaluate(`document.querySelector('[data-public-rail="banner"]').scrollLeft>0`));
    report.checks.push('native touch swipe scrolls the rail while JavaScript is disabled');
    assert.deepEqual(errors,[]);
  }
  report.success=true;
}catch(error){report.failedStage=stage;report.error=error instanceof Error?error.message:'CHECK_FAILED';report.transport={socketState:socket?.readyState,browserExit:chrome?.exitCode};if(socket?.readyState===WebSocket.OPEN){try{report.state=await evaluate(`({active:document.activeElement?.getAttribute('aria-label'),rails:[...document.querySelectorAll('[data-public-rail]')].map(e=>({kind:e.dataset.publicRail,left:e.scrollLeft,width:e.clientWidth,scroll:e.scrollWidth,behavior:e.dataset.behavior})),buttons:[...document.querySelectorAll('button[aria-label]')].map(e=>({label:e.getAttribute('aria-label'),disabled:e.disabled}))})`);}catch(failure){report.diagnosticError=failure.message;}}}
finally{
  if(socket?.readyState===WebSocket.OPEN)socket.close();if(chrome)chrome.kill();if(next)next.kill();if(api)await new Promise(resolve=>api.close(resolve));
  report.browserErrors=errors;console.log(JSON.stringify(report,null,2));
  assert.ok(path.resolve(folder).startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(folder).startsWith('public-highlights-browser-'));
  try{fs.rmSync(folder,{recursive:true,force:true,maxRetries:5,retryDelay:200});}catch{ /* An isolated browser may still be releasing its profile. */ }
  if(!report.success)process.exitCode=1;
}
