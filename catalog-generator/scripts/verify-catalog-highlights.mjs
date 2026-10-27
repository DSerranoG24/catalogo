import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module, { createRequire } from 'node:module';
import ts from 'typescript';
const require=createRequire(import.meta.url), previous=Module._extensions['.ts'];
Module._extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename);
try{
  const {readFeaturedStatus,readBanners,readSuggestions,safeExternalUrl}=require('../lib/catalog-highlights.ts');
  const id='11111111-1111-4111-8111-111111111111';
  const empty={products:[],selectedCount:0,validCount:0,visible:false,warning:null};
  assert.equal(readFeaturedStatus(empty).validCount,0);
  const selected={...empty,products:[{id,name:'Uno',active:false}],selectedCount:1};
  assert.equal(readFeaturedStatus(selected).selectedCount,1);assert.equal(readFeaturedStatus(selected).validCount,0);
  for(const bad of [null,{}, {...empty,selectedCount:5},{...selected,validCount:1},{...selected,products:[{id,name:'Uno',active:'true'}]},{...selected,products:[selected.products[0],selected.products[0]],selectedCount:2}])assert.throws(()=>readFeaturedStatus(bad));
  const banner={id,title:'Uno',subtitle:null,linkType:'EXTERNAL',linkValue:'https://example.invalid',position:0,active:true,imageUrl:'https://example.invalid/image.png'};
  assert.equal(readBanners({banners:[banner]})[0].title,'Uno');
  for(const bad of [{...banner,position:3},{...banner,imageUrl:'javascript:alert(1)'},{...banner,active:'false'},{...banner,linkType:'UNKNOWN'}])assert.throws(()=>readBanners({banners:[bad]}));
  assert.throws(()=>readBanners({banners:[banner,banner]}));
  assert.deepEqual(readSuggestions({products:[{id,name:'Uno'}]}),[{id,name:'Uno'}]);
  assert.throws(()=>readSuggestions({products:[{id:12,name:'Uno'}]}));
  for(const bad of ['javascript:alert(1)','data:text/html,test','ftp://example.invalid','https://user:password@example.invalid'])assert.equal(safeExternalUrl(bad),false);
  assert.equal(safeExternalUrl('http://example.invalid'),true);assert.equal(safeExternalUrl('https://example.invalid'),true);
  console.log('PASS highlights contracts: global selected/active counts, malformed responses, banner limits/order, suggestions and allowed protocols');
}finally{if(previous)Module._extensions['.ts']=previous;else delete Module._extensions['.ts'];}
