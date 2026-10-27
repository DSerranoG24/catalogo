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
  const [template,preset='null',content='full',layout='null']=publicId.split('~');
  const categories=[{id:'category-a',name:'Categoría A',slug:'a',imageUrl:null,position:0},{id:'category-b',name:'Categoría B',slug:'b',imageUrl:null,position:1}];
  const products=Array.from({length:25},(_,i)=>({id:`p${i}`,name:`Producto ${i}`,slug:`producto-${i}`,description:null,brand:null,model:null,categoryId:categories[i%2].id,category:{id:categories[i%2].id,name:categories[i%2].name},price:1000,regularPrice:i===21?2000:null,discountPercent:i===21?50:null,saleEndsAt:null,images:[]}));
  const banner={id:'b0',title:'Anuncio principal',subtitle:'Información legible sobre una superficie opaca.',linkType:'PRODUCT',linkValue:'p0',position:0,imageUrl:'http://127.0.0.1:4347/image.png'};
  return {publicId,name:'Negocio de ejemplo con identidad propia',slug:'ejemplo',description:'Selección local de prueba',logoUrl:content==='logo'?'http://127.0.0.1:4347/image.png':null,whatsappPhone:null,whatsappMessage:null,phone:'+573000000000',businessHours:'Lunes a viernes\nDe 9:00 a 18:00',address:null,email:null,instagramUrl:null,facebookUrl:null,tiktokUrl:null,mapUrl:null,template,layoutPreset:layout==='null'?null:layout,themePreset:preset==='null'?null:preset,categories,products,
    featuredProducts:content==='empty'?[]:content==='two'?products.slice(0,2):products.slice(20,25),
    banners:content==='empty'||content==='two'?[]:content==='single'?[banner]:[banner,{...banner,id:'b1',title:'Ir a categoría B',linkType:'CATEGORY',linkValue:'category-b',position:1},{...banner,id:'b2',title:'Enlace externo',linkType:'EXTERNAL',linkValue:'https://example.invalid',position:2}]};
}
async function weight(publicId='TECH'){const html=await(await fetch('http://127.0.0.1:4348/c/'+publicId)).text();const files=[...new Set([...html.matchAll(/<script\b([^>]*)src="([^"]+)"([^>]*)>/g)].filter(m=>m[2].startsWith('/_next/')&&!/nomodule/i.test(m[1]+m[3])).map(m=>m[2]))];let bytes=0,gzip=0,paletteRegistryInInitial=false;for(const file of files){const b=fs.readFileSync('.next'+file.replace('/_next',''));bytes+=b.length;gzip+=gzipSync(b).length;paletteRegistryInInitial ||= b.includes(Buffer.from('#FCD34D'));}return{bytes,gzip,chunks:files.length,paletteRegistryInInitial};}
async function navigate(id,query=''){const url=`http://127.0.0.1:4348/c/${id}${query}`;const result=await command('Page.navigate',{url});assert.ok(!result.errorText);await poll(()=>evaluate(`location.href===${JSON.stringify(url)}&&document.readyState==='complete'&&Boolean(document.querySelector('h1'))`));await pause(70);}
try{
  api=http.createServer((req,res)=>{res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:4348');res.setHeader('Access-Control-Allow-Headers','Content-Type');res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}if(req.url==='/image.png'){res.writeHead(200,{'Content-Type':'image/png'});return res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'));}const id=decodeURIComponent(req.url.split('/').pop());res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({catalog:fixture(id)}));});api.listen(4347,'127.0.0.1');await once(api,'listening');
  next=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'start','--hostname','127.0.0.1','--port','4348'],{env:{...process.env,NEXT_PUBLIC_CATALOG_API_URL:'http://127.0.0.1:4347/api'},windowsHide:true,stdio:['ignore','pipe','pipe']});next.stdout.resume();next.stderr.resume();
  await poll(async()=>{try{return(await fetch('http://127.0.0.1:4348/login')).ok;}catch{return false;}});
  report.weights.initial=await weight();
  if(!baseline){
    assert.ok(report.weights.initial.gzip-162587<=15000,'PUBLIC_JS_LIMIT_EXCEEDED');
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
    const legalPaths=['/privacidad','/terminos','/contacto'];
    async function go(path){await command('Page.navigate',{url:'http://127.0.0.1:4348'+path});await poll(()=>evaluate(`document.readyState==='complete'&&Boolean(document.querySelector('h1'))`));await pause(100);}
    for(const noJS of [false,true]){
      await command('Emulation.setScriptExecutionDisabled',{value:noJS});
      for(const path of legalPaths)for(const width of [320,390,1024,1440]){
        stage=`legal:${path}:${width}:noJS=${noJS}`;
        await command('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<500});await go(path);
        const state=await evaluate(`({scroll:document.documentElement.scrollWidth,width:document.documentElement.clientWidth,h1:document.querySelectorAll('h1').length,levels:[...document.querySelectorAll('main h1,main h2,main h3')].map(e=>Number(e.tagName.slice(1))),robots:document.querySelector('meta[name=robots]').content,links:[...document.querySelectorAll('footer nav a')].map(a=>({path:a.getAttribute('href'),target:a.getAttribute('target')})),markers:document.body.textContent.includes('[PENDIENTE DE REVISIÓN JURÍDICA]')})`);
        assert.ok(state.scroll<=state.width+1,JSON.stringify(state));assert.equal(state.h1,1);assert.equal(state.robots,'index, follow');assert.equal(state.levels[0],1);assert.ok(state.levels.every((level,i)=>i===0||level<=state.levels[i-1]+1));assert.deepEqual(state.links.sort((a,b)=>a.path.localeCompare(b.path)),legalPaths.slice().sort().map(path=>({path,target:null})).sort((a,b)=>a.path.localeCompare(b.path)));
        if(path!=='/contacto')assert.equal(state.markers,true);
        const contrast=await evaluate(`(${auditThemeContrast.toString()})('main',false)`);assert.deepEqual(contrast.failures,[],JSON.stringify({path,width,noJS,contrast}));report.contrasts.push({path,width,noJS,minimum:Number(contrast.minimum.toFixed(2))});
        if(noJS&&path==='/contacto')assert.ok(await evaluate(`document.querySelector('fieldset').disabled&&Boolean(document.querySelector('a[href="mailto:vitrinaya983@gmail.com"]'))`));
      }
    }
    report.checks.push('24 legal page/width/JavaScript cases: headings, indexability, same-tab links, visible markers, contrast and no document overflow');
    stage='landing-footer';await command('Emulation.setScriptExecutionDisabled',{value:false});await go('/');
    const landing=await evaluate(`[...document.querySelectorAll('footer nav[aria-label="Contacto y páginas legales"] a')].map(a=>a.getAttribute('href'))`);assert.deepEqual(landing,['/contacto','/privacidad','/terminos']);assert.equal(await evaluate(`Boolean(document.getElementById('footer-coming-soon'))`),false);
    await navigate('FASHION');assert.deepEqual(await evaluate(`[...document.querySelectorAll('footer nav a')].map(a=>a.getAttribute('href'))`),landing);
    const checkout=fs.readFileSync('components/public/PublicShoppingCartPage.tsx','utf8');assert.ok(checkout.includes('href="/privacidad"'));assert.ok(checkout.includes('Autorizo guardar estos datos para gestionar este pedido.'));
    stage='contact-form';await go('/contacto');await poll(()=>evaluate(`!document.querySelector('fieldset').disabled`));
    const requests=[];socket.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.method==='Network.requestWillBeSent')requests.push({url:m.params.request.url,method:m.params.request.method});});
    await command('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:folder});
    await evaluate(`document.querySelector('form button').click()`);assert.equal(fs.existsSync(path.join(folder,'consulta-vitrinaya.eml')),false);
    await evaluate(`document.querySelector('[name=name]').value='   ';document.querySelector('[name=email]').value='ana@example.invalid';document.querySelector('[name=message]').value='Consulta';document.querySelector('form button').click()`);
    await poll(()=>evaluate(`Boolean(document.querySelector('[role=alert]'))`));assert.equal(fs.existsSync(path.join(folder,'consulta-vitrinaya.eml')),false);
    await evaluate(`document.querySelector('[name=name]').value='Ana';document.querySelector('[name=email]').value='invalid';document.querySelector('form button').click()`);assert.equal(fs.existsSync(path.join(folder,'consulta-vitrinaya.eml')),false);
    await evaluate(`(()=>{for(const [name,value]of Object.entries({name:'Ana Prueba',email:'ana@example.invalid',message:'Consulta de prueba con acentos: información.'})){const e=document.querySelector('[name="'+name+'"]');e.value=value;}document.querySelector('form button').click()})()`);
    await poll(()=>fs.existsSync(path.join(folder,'consulta-vitrinaya.eml')));await poll(()=>evaluate(`Boolean(document.querySelector('[role=status]'))`));
    const draft=fs.readFileSync(path.join(folder,'consulta-vitrinaya.eml'),'utf8');assert.match(draft,/^X-Unsent: 1\r\nTo: vitrinaya983@gmail.com\r\nSubject: Consulta para Vitrinaya/);assert.ok(Buffer.from(draft.split('\r\n\r\n')[1].replace(/\s/g,''),'base64').toString('utf8').includes('Consulta de prueba con acentos: información.'));
    assert.equal(await evaluate('location.search'), '');assert.ok(requests.every(r=>r.method!=='POST'&&r.method!=='PUT'&&!r.url.includes('ana%40')&&!r.url.includes('Ana%20')));
    assert.ok(await evaluate(`document.querySelector('[role=status]').textContent.includes('no ha enviado ningún mensaje')`));
    report.checks.push('landing/public footer links; order consent privacy link checked in source; native form validation, local EML UTF-8 draft and no send request or personal data in page URL');
    assert.deepEqual(errors,[]);
  }
  report.success=true;
}catch(error){console.error(stage,error.message);report.failedStage=stage;report.error=error instanceof Error?error.message:'CHECK_FAILED';report.transport={socketState:socket?.readyState,browserExit:chrome?.exitCode};if(socket?.readyState===WebSocket.OPEN){try{report.state=await evaluate(`({location:location.href,text:document.body.textContent.slice(0,300),active:document.activeElement?.getAttribute('aria-label'),rails:[...document.querySelectorAll('[data-public-rail]')].map(e=>({kind:e.dataset.publicRail,left:e.scrollLeft,width:e.clientWidth,scroll:e.scrollWidth,behavior:e.dataset.behavior})),buttons:[...document.querySelectorAll('button[aria-label]')].map(e=>({label:e.getAttribute('aria-label'),disabled:e.disabled}))})`);}catch(failure){report.diagnosticError=failure.message;}}}
finally{
  if(socket?.readyState===WebSocket.OPEN)socket.close();if(chrome)chrome.kill();if(next)next.kill();if(api)await new Promise(resolve=>api.close(resolve));
  report.browserErrors=errors;fs.writeFileSync(path.join(os.tmpdir(),'legal-pages-result.json'),JSON.stringify(report,null,2));const minimums={};for(const c of report.contrasts)minimums[c.path]=Math.min(minimums[c.path]??Infinity,c.minimum);console.log(JSON.stringify({...report,contrasts:undefined,contrastMinimums:minimums},null,2));
  assert.ok(path.resolve(folder).startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(folder).startsWith('public-highlights-browser-'));
  try{fs.rmSync(folder,{recursive:true,force:true,maxRetries:5,retryDelay:200});}catch{ /* An isolated browser may still be releasing its profile. */ }
  if(!report.success)process.exitCode=1;
}
