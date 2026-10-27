import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module, { createRequire } from 'node:module';
import ts from 'typescript';
const require=createRequire(import.meta.url), previous=Module._extensions['.ts'];
Module._extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
let passed=0;
try {
  const {dominantLogoColor,suggestLogoPalette,logoSampleSize,redmean}=require('../lib/logo-palette-analysis.ts');
  const palettes=[['forest','#166534'],['ocean','#1D4ED8'],['terracotta','#9A3412'],['rose','#9D174D'],['violet','#6D28D9'],['graphite','#334155'],['night-mint','#5EEAD4'],['night-amber','#FCD34D']].map(([id,primary])=>({id,colors:['#ffffff','#ffffff',primary,'#ffffff']}));
  const rgba=(r,g,b,n=100,alpha=255)=>Array.from({length:n},()=>[r,g,b,alpha]).flat();
  const pixels=(...parts)=>new Uint8ClampedArray(parts.flat());
  function check(name,work){work();passed++;console.log('PASS '+name);}
  check('light background excluded, colored symbol retained',()=>assert.equal(suggestLogoPalette(pixels(rgba(255,255,255,9600),rgba(22,101,52,400)),'FASHION',palettes),'forest'));
  check('transparent pixels ignored',()=>assert.deepEqual(dominantLogoColor(pixels(rgba(255,0,0,90,0),rgba(22,101,52,10))),[22,101,52]));
  for(const [name,color] of [['white',[255,255,255]],['black',[0,0,0]],['gray',[120,120,120]]])check(name+' abstains',()=>assert.equal(suggestLogoPalette(pixels(rgba(...color)),'FASHION',palettes),null));
  check('semi-transparent colored edges excluded',()=>assert.equal(dominantLogoColor(pixels(rgba(22,101,52,100,239))),null));
  check('almost-transparent image lacks coverage',()=>assert.equal(dominantLogoColor(pixels(rgba(0,0,0,9997,0),rgba(22,101,52,3))),null));
  check('insufficient chromatic area abstains',()=>assert.equal(dominantLogoColor(pixels(rgba(255,255,255,9990),rgba(22,101,52,10))),null));
  check('multicolor uses majority, independent of first pixel',()=>{for(const parts of [[rgba(29,78,216,20),rgba(22,101,52,80)],[rgba(22,101,52,80),rgba(29,78,216,20)]])assert.equal(suggestLogoPalette(pixels(...parts),'FASHION',palettes),'forest');});
  check('similar shades in distinct bins cluster rather than selecting an isolated exact color',()=>assert.equal(suggestLogoPalette(pixels(rgba(29,78,216,40),rgba(22,101,52,30),rgba(34,114,65,30)),'FASHION',palettes),'forest'));
  check('ties deterministic across pixel order',()=>assert.deepEqual(dominantLogoColor(pixels(rgba(29,78,216,50),rgba(22,101,52,50))),dominantLogoColor(pixels(rgba(22,101,52,50),rgba(29,78,216,50)))));
  check('small logo preserved, never upscaled',()=>{assert.deepEqual(logoSampleSize(2,2),{width:2,height:2});assert.deepEqual(logoSampleSize(1,1),{width:1,height:1});assert.deepEqual(logoSampleSize(200,50),{width:100,height:25});assert.equal(suggestLogoPalette(pixels(rgba(22,101,52,4)),'BEAUTY',palettes),'forest');assert.equal(dominantLogoColor(pixels(rgba(22,101,52,1))),null);});
  check('TECH and historical GRID only compatible suggestions or abstention',()=>{for(const template of ['TECH','GRID'])for(const palette of palettes){const hex=palette.colors[2];const color=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));assert.ok([null,'night-mint','night-amber'].includes(suggestLogoPalette(pixels(rgba(...color)),template,palettes)));}assert.equal(suggestLogoPalette(pixels(rgba(94,234,212)),'TECH',palettes),'night-mint');assert.equal(suggestLogoPalette(pixels(rgba(252,211,77)),'GRID',palettes),'night-amber');});
  check('no close candidate abstains',()=>assert.equal(suggestLogoPalette(pixels(rgba(255,0,0)),'TECH',palettes),null));
  check('redmean symmetric and exact match zero',()=>{assert.equal(redmean([22,101,52],[22,101,52]),0);assert.equal(redmean([1,5,50],[80,40,20]),redmean([80,40,20],[1,5,50]));});
  console.log(JSON.stringify({passed,failed:0,calibration:'synthetic fixtures only; not validated against real brand logos'}));
} finally { if(previous)Module._extensions['.ts']=previous;else delete Module._extensions['.ts']; }
