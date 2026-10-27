import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module,{createRequire} from 'node:module';
import ts from 'typescript';
const require=createRequire(import.meta.url),previous=Module._extensions['.ts'];
Module._extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
try{
  const {normalizePublicCatalog}=require('../lib/public-catalog-data.ts');
  const {validPublicCategory,publicCategoryHref}=require('../lib/public-category.ts');
  const products=Array.from({length:25},(_,i)=>({id:`p${i}`,name:`Producto ${i}`,slug:`producto-${i}`,description:null,brand:null,model:null,categoryId:'c1',category:{id:'c1',name:'Uno'},price:1000,regularPrice:null,discountPercent:null,saleEndsAt:null,images:[]}));
  const base={publicId:'demo',name:'Demo',slug:'demo',template:'TECH',themePreset:null,categories:[{id:'c1',name:'Uno',slug:'uno',imageUrl:null,position:0}],products};
  for(const key of ['description','logoUrl','whatsappPhone','whatsappMessage','phone','address','businessHours','instagramUrl','facebookUrl','tiktokUrl','email','mapUrl'])base[key]=null;
  assert.deepEqual(normalizePublicCatalog(base).banners,[]);assert.deepEqual(normalizePublicCatalog(base).featuredProducts,[]);
  for (const layoutPreset of [undefined, null, 'future', 'GRID', {}, 123]) {
    assert.equal(normalizePublicCatalog({...base, layoutPreset}).layoutPreset, null);
  }
  for (const template of ['TECH', 'FASHION', 'BEAUTY', 'GLAMOUR']) for (const layoutPreset of ['sidebar', 'sidebar-compact']) {
    assert.equal(normalizePublicCatalog({...base, template, layoutPreset}).layoutPreset, layoutPreset);
  }
  for(const value of [null,'wrong',{},[null,{},true]]){
    const normalized=normalizePublicCatalog({...base,banners:value,featuredProducts:value});assert.ok(normalized);assert.deepEqual(normalized.banners,[]);assert.deepEqual(normalized.featuredProducts,[]);
  }
  const highlights=products.slice(20,25);
  assert.equal(normalizePublicCatalog({...base,featuredProducts:[null,...highlights,{},highlights[0]]}).featuredProducts.length,5);
  assert.deepEqual(normalizePublicCatalog({...base,featuredProducts:highlights.slice(0,2)}).featuredProducts,[]);
  const canonical=normalizePublicCatalog({...base,featuredProducts:[{...highlights[0],price:9999},...highlights.slice(1)]});assert.equal(canonical.featuredProducts[0].price,1000);
  assert.ok(canonical.featuredProducts.every(p=>!products.slice(0,20).some(row=>row.id===p.id)));
  const banner={id:'b0',title:'Oferta',subtitle:null,imageUrl:'https://example.invalid/image.png',linkType:'PRODUCT',linkValue:'p0',position:0};
  const bad=[null,{...banner,id:'bad',linkValue:'foreign'}, {...banner,id:'bad',imageUrl:'javascript:alert(1)'},{...banner,id:'bad',title:42},{...banner,id:'bad',position:9}];
  const normalized=normalizePublicCatalog({...base,banners:[...bad,banner,{...banner,id:'b1',position:1,linkType:'CATEGORY',linkValue:'c1'},{...banner,id:'b2',position:2,linkType:'EXTERNAL',linkValue:'https://example.invalid'}]});
  assert.equal(normalized.banners.length,3);
  for(const linkValue of ['javascript:alert(1)','data:text/html,bad','https://user:password@example.invalid'])assert.deepEqual(normalizePublicCatalog({...base,banners:[{...banner,linkType:'EXTERNAL',linkValue}]}).banners,[]);
  assert.equal(normalizePublicCatalog({...base,banners:[banner,banner]}).banners.length,1);
  for(const category of [null,undefined,['c1'],'missing','x'.repeat(201)])assert.equal(validPublicCategory(base.categories,category),'');
  assert.equal(validPublicCategory(base.categories,'c1'),'c1');assert.equal(publicCategoryHref('demo','c1'),'/c/demo?category=c1#productos');assert.equal(publicCategoryHref('demo',''),'/c/demo#productos');
  assert.equal(normalizePublicCatalog({...base,products:null}),null);
  console.log('PASS public highlights: absent/malformed optional collections, individual rejection, canonical prices, limits, no page coupling, safe links and server category validation');
}finally{if(previous)Module._extensions['.ts']=previous;else delete Module._extensions['.ts'];}
