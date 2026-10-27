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
  api=http.createServer((req,res)=>{if(req.url==='/image.png'){res.writeHead(200,{'Content-Type':'image/png'});return res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'));}const id=decodeURIComponent(req.url.split('/').pop());res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({catalog:fixture(id)}));});api.listen(4347,'127.0.0.1');await once(api,'listening');
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
    const templates=['TECH','FASHION','BEAUTY','GLAMOUR'],presets=['forest','ocean','terracotta','rose','violet','graphite','night-mint','night-amber'];
    let cases=0;
    if(!process.argv.includes('--interactions-only')){
    for(const template of templates)for(const preset of ['null',...presets.filter(p=>template!=='TECH'||p.startsWith('night-'))])for(const layout of ['null','sidebar','sidebar-compact'])for(const width of (process.argv.includes('--contrast-only')?[390]:[320,390,768,1024,1440])){
      stage=`matrix:${template}:${preset}:${layout}:${width}`;
      await command('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<500});
      await navigate(`${template}~${preset}~logo~${layout}`);
      const state=await evaluate(`(()=>{const b=document.querySelector('[data-catalog-cart-bar]'),a=document.querySelector('[data-catalog-cart-link]'),r=a.getBoundingClientRect(),logo=document.querySelector('[data-catalog-logo]').getBoundingClientRect(),c=document.createElement('canvas').getContext('2d');c.fillStyle=getComputedStyle(b).backgroundColor;c.fillRect(0,0,1,1);return {links:document.querySelectorAll('a[href$="/carrito"]').length,counters:document.querySelectorAll('[data-catalog-cart-count]').length,announcements:document.querySelectorAll('[data-catalog-cart-announcement]').length,sticky: getComputedStyle(b).position,categories:getComputedStyle(document.querySelector('nav[aria-label="Filtrar por categoría"]')).position,scroll:document.documentElement.scrollWidth,width:document.documentElement.clientWidth,barBottom:b.getBoundingClientRect().bottom,logoTop:logo.top,touchWidth:r.width,touchHeight:r.height,opaque:c.getImageData(0,0,1,1).data[3],total:getComputedStyle(document.querySelector('[data-catalog-cart-link] span:last-child')).display}})()`);
      assert.equal(state.links,1);assert.equal(state.counters,1);assert.equal(state.announcements,1);assert.equal(state.sticky,'sticky');assert.notEqual(state.categories,'sticky');assert.equal(state.opaque,255);assert.ok(state.touchWidth>=44&&state.touchHeight>=44);assert.ok(state.logoTop>=state.barBottom);assert.ok(state.scroll<=state.width+1);assert.equal(state.total==='none',width<768);
      for(const fraction of [0,.25,.5,.75,1]){
        const visible=await evaluate(`(()=>{window.scrollTo(0,(document.documentElement.scrollHeight-innerHeight)*${fraction});const b=document.querySelector('[data-catalog-cart-bar]').getBoundingClientRect(),a=document.querySelector('[data-catalog-cart-link]').getBoundingClientRect();return b.top>=-1&&b.top<=1&&a.top>=0&&a.bottom<=innerHeight})()`);
        assert.ok(visible,'STICKY_NOT_VISIBLE:'+stage+':'+fraction);
      }
      if(width===390){
        await evaluate('window.scrollTo(0,0)');
        for(const mode of ['normal','hover','focus']){
          if(mode==='normal')await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:0,y:500});
          if(mode==='hover'){const point=await evaluate(`(()=>{const r=document.querySelector('[data-catalog-cart-link]').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await command('Input.dispatchMouseEvent',{type:'mouseMoved',...point});}
          if(mode==='focus')await evaluate(`document.querySelector('[data-catalog-cart-link]').focus()`);
          const contrast=await evaluate(`(${auditThemeContrast.toString()})('[data-catalog-cart-link]',true)`);
          assert.deepEqual(contrast.failures,[],JSON.stringify({template,preset,layout,mode,contrast}));
          report.contrasts.push({template,preset,layout,mode,minimum:Number(contrast.minimum.toFixed(2))});
          if(mode==='focus')assert.ok(await evaluate(`parseFloat(getComputedStyle(document.activeElement).outlineWidth)>=2`));
        }
      }
      cases++;
    }
    report.checks.push(`${cases} template/palette/layout/width cases: unique cart/count/announcement, opaque surface, logo, touch target, non-sticky categories and five scroll positions`);
    }
    for(const layout of ['null','sidebar','sidebar-compact'])for(const width of [320,390,768,1024,1440]){
      stage='anchors-focus:'+layout+':'+width;
      await command('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<500});await navigate('TECH~null~logo~'+layout);
      for(const target of ['productos','contacto']){
        await evaluate(`document.querySelector('a[href="#${target}"]').click()`);
        assert.ok(await evaluate(`document.getElementById('${target}').getBoundingClientRect().top>=document.querySelector('[data-catalog-cart-bar]').getBoundingClientRect().bottom-1`));
      }
      await evaluate(`window.scrollTo(0,document.documentElement.scrollHeight);document.querySelector('input[type="search"]').focus()`);
      assert.ok(await evaluate(`document.activeElement.getBoundingClientRect().top>=document.querySelector('[data-catalog-cart-bar]').getBoundingClientRect().bottom`));
      await evaluate(`(()=>{const e=document.querySelector('input[type="search"]');e.blur();window.scrollTo(0,e.getBoundingClientRect().top+scrollY-10);e.focus()})()`);
      assert.ok(await evaluate(`document.activeElement.getBoundingClientRect().top>=document.querySelector('[data-catalog-cart-bar]').getBoundingClientRect().bottom`),'FOCUS_HIDDEN_BEHIND_BAR:'+stage);
      await evaluate(`document.querySelector('nav a[href*="category=category-b"]').click()`);
      await poll(()=>evaluate(`location.search==='?category=category-b'&&document.querySelectorAll('#productos [data-product-card]').length===12`));
    }
    stage='restore-units';
    const seed=await command('Page.addScriptToEvaluateOnNewDocument',{source:`if(location.pathname==='/c/FASHION')sessionStorage.setItem('catalogo-cart-FASHION',JSON.stringify({p0:2,p1:3}))`});
    await navigate('FASHION');
    await poll(()=>evaluate(`document.querySelector('[data-catalog-cart-count]').textContent==='5'`));
    await command('Page.removeScriptToEvaluateOnNewDocument',{identifier:seed.identifier});
    stage='add-units';
    await evaluate(`document.querySelector('#productos [data-product-card] button').click();document.querySelector('#productos [data-product-card] button').click()`);
    await poll(()=>evaluate(`document.querySelector('[data-catalog-cart-count]').textContent==='7'`));
    assert.equal(await evaluate(`document.querySelector('[data-catalog-cart-announcement]').textContent`),'Carrito: 7 unidades');
    const size=await evaluate(`({height:document.querySelector('[data-catalog-cart-bar]').offsetHeight,width:document.querySelector('[data-catalog-cart-count]').offsetWidth})`);
    stage='overflow-units';
    const overflowSeed=await command('Page.addScriptToEvaluateOnNewDocument',{source:`if(location.pathname==='/c/FASHION')sessionStorage.setItem('catalogo-cart-FASHION',JSON.stringify({p0:99,p1:2}))`});
    await navigate('FASHION');
    await poll(()=>evaluate(`document.querySelector('[data-catalog-cart-count]').textContent==='99+'`));
    await command('Page.removeScriptToEvaluateOnNewDocument',{identifier:overflowSeed.identifier});
    assert.deepEqual(await evaluate(`({height:document.querySelector('[data-catalog-cart-bar]').offsetHeight,width:document.querySelector('[data-catalog-cart-count]').offsetWidth})`),size);
    assert.ok(await evaluate(`document.querySelector('[data-catalog-cart-link]').getAttribute('aria-label').includes('101 unidades')`));
    await command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await evaluate(`document.querySelector('[data-catalog-cart-link]').focus()`);
    await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'});await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
    await poll(()=>evaluate(`location.pathname==='/c/FASHION/carrito'`));
    report.checks.push('15 anchor/focus/category cases; units not distinct products; live quantity, 99+, stable height/count width, keyboard opens existing cart with reduced motion');
    await command('Emulation.setScriptExecutionDisabled',{value:true});
    for(const template of templates)for(const layout of ['null','sidebar','sidebar-compact'])for(const width of [320,390,768,1024,1440]){
      stage='nojs:'+template+':'+layout+':'+width;
      await command('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<500});await navigate(template+'~null~logo~'+layout);
      assert.equal(await evaluate(`document.querySelector('[data-catalog-cart-count]').textContent`),'0');
      assert.ok(await evaluate(`(()=>{window.scrollTo(0,document.documentElement.scrollHeight);const r=document.querySelector('[data-catalog-cart-link]').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight})()`));
    }
    await evaluate(`document.querySelector('[data-catalog-cart-link]').click()`);
    await poll(()=>evaluate(`location.pathname.endsWith('/carrito')`));
    report.checks.push('60 no-JavaScript cases: sticky link and initial zero count; native link navigates; no promise of checkout without JavaScript');
    assert.deepEqual(errors,[]);
  }
  report.success=true;
}catch(error){console.error(stage,error.message);report.failedStage=stage;report.error=error instanceof Error?error.message:'CHECK_FAILED';report.transport={socketState:socket?.readyState,browserExit:chrome?.exitCode};if(socket?.readyState===WebSocket.OPEN){try{report.state=await evaluate(`({active:document.activeElement?.getAttribute('aria-label'),rails:[...document.querySelectorAll('[data-public-rail]')].map(e=>({kind:e.dataset.publicRail,left:e.scrollLeft,width:e.clientWidth,scroll:e.scrollWidth,behavior:e.dataset.behavior})),buttons:[...document.querySelectorAll('button[aria-label]')].map(e=>({label:e.getAttribute('aria-label'),disabled:e.disabled}))})`);}catch(failure){report.diagnosticError=failure.message;}}}
finally{
  if(socket?.readyState===WebSocket.OPEN)socket.close();if(chrome)chrome.kill();if(next)next.kill();if(api)await new Promise(resolve=>api.close(resolve));
  report.browserErrors=errors;fs.writeFileSync(path.join(os.tmpdir(),'catalog-cart-result.json'),JSON.stringify(report,null,2));const minimums={};for(const c of report.contrasts){const key=c.preset==='null'?c.template:c.preset;minimums[key]??={};minimums[key][c.mode]=Math.min(minimums[key][c.mode]??Infinity,c.minimum);}console.log(JSON.stringify({...report,contrasts:undefined,contrastMinimums:minimums},null,2));
  assert.ok(path.resolve(folder).startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(folder).startsWith('public-highlights-browser-'));
  try{fs.rmSync(folder,{recursive:true,force:true,maxRetries:5,retryDelay:200});}catch{ /* An isolated browser may still be releasing its profile. */ }
  if(!report.success)process.exitCode=1;
}
