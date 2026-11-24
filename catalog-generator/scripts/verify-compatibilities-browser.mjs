import assert from "node:assert/strict";
import { privatePanelFixture } from "./private-panel-browser-fixture.mjs";
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const now="2026-11-24T12:00:00.000Z", owner=id(1), itemId=id(2), otherItemId=id(3);
const item=(key,name)=>({id:key,name,sku:name,stock:8,minimumStock:0,dataVersion:1,stockVersion:1,commercialTerms:null});
const items=[item(itemId,"Accessory A"),item(otherItemId,"Accessory B")];
const brands=[{id:id(10),name:"Oppo",version:1,retiredAt:null}],models=[{id:id(20),name:"A58 4G",version:1,brandId:id(10),brandName:"Oppo",brandRetiredAt:null,retiredAt:null,manufacturerCode:"Synthetic code"}];
const rows=[],events=[],writes=[],receipts=new Map(),unknown=[],checks=[];
let setVersion=0,loseReply=true,listMode="NORMAL",eventMode="NORMAL",holdItem=null,release;
async function api(req,res) {
  const url=new URL(req.url,"https://127.0.0.1:4339");
  const reply=(body,status=200)=>{res.writeHead(status,{"Content-Type":"application/json"});res.end(JSON.stringify(body));};
  const page=Number(url.searchParams.get("page")??"1");
  const paged=values=>({success:true,items:values,page,pageSize:25,hasMore:false});
  if(req.method==="GET") {
    if(url.pathname==="/api/me")return reply({user:{emailVerifiedAt:now,hasLocalPassword:true}});
    if(url.pathname==="/api/catalogs")return reply({catalogs:[]});
    if(url.pathname==="/api/inventory/items")return reply({success:true,result:{items,total:items.length,page:1}});
    if(url.pathname==="/api/inventory/publications"||url.pathname.endsWith("/images"))return reply({result:[]});
    if(url.pathname.endsWith("/commercial-terms"))return reply({result:items.find(i=>url.pathname.includes(i.id))});
    if(url.pathname.endsWith("/movements"))return reply({result:{movements:[],total:0,page:1}});
    if(url.pathname==="/api/device-brands")return reply(paged(brands));
    if(url.pathname==="/api/device-models")return reply(paged(models.filter(m=>m.brandId===url.searchParams.get("brandId"))));
    if(url.pathname.endsWith("/compatibility-events")) {
      if(eventMode==="ERROR")return reply({message:"Auditoría temporalmente no disponible"},503);
      return reply(paged(events));
    }
    if(url.pathname.endsWith("/compatibilities")) {
      const sourceId=url.pathname.split("/")[4];
      if(holdItem===sourceId)await new Promise(resolve=>{release=resolve;});
      if(listMode==="INVALID")return reply({success:true,result:[]});
      const status=url.searchParams.get("status");
      return reply({success:true,source:{kind:"INVENTORY_ITEM",id:sourceId},set:sourceId===itemId&&setVersion?{id:id(50),version:setVersion}:null,
        compatibilities:sourceId===itemId?rows.filter(r=>status==="all"||r.status===status):[],page,pageSize:25,hasMore:false});
    }
    unknown.push(url.pathname);return reply({},404);
  }
  let raw="";for await(const chunk of req)raw+=chunk;
  const body=JSON.parse(raw);writes.push({path:url.pathname,method:req.method,body:structuredClone(body)});
  assert.match(body.operationId,/^[0-9a-f-]{36}$/);
  assert.ok(!["ownerId","actorId","verifiedAt","verifiedById","customerId","unitPrice","stock"].some(k=>Object.hasOwn(body,k)));
  const previous=receipts.get(body.operationId);
  if(previous)return reply({success:true,result:{...previous,idempotent:true}});
  const success=(result,status=200)=>{receipts.set(body.operationId,result);return reply({success:true,result:{...result,idempotent:false}},status);};
  if(url.pathname==="/api/device-brands") {
    assert.deepEqual(Object.keys(body).sort(),["name","operationId"]);
    const b={id:id(11),name:body.name,version:1,retiredAt:null};brands.push(b);return success({entity:b},201);
  }
  if(url.pathname==="/api/device-models") {
    assert.deepEqual(Object.keys(body).sort(),["brandId","manufacturerCode","name","operationId"]);
    const b=brands.find(b=>b.id===body.brandId);assert.ok(b);
    const m={id:id(21),name:body.name,version:1,retiredAt:null,brandId:b.id,brandName:b.name,brandRetiredAt:null,manufacturerCode:body.manufacturerCode};models.push(m);return success({entity:m},201);
  }
  if(url.pathname.endsWith("/names")) {
    if(body.label==="Conflict")return reply({error:"NAME_CONFLICT",message:"Ese nombre o alias ya identifica otra entrada."},409);
    const m=models.find(m=>url.pathname.includes(m.id));assert.ok(m);assert.equal(body.expectedVersion,m.version);m.version++;
    return success({entity:m});
  }
  if(url.pathname===`/api/inventory/items/${itemId}/compatibilities`&&req.method==="POST") {
    assert.deepEqual(Object.keys(body).sort(),["expectedSetVersion","modelId","operationId"]);
    if(rows.some(r=>r.model.id===body.modelId))return reply({error:"COMPATIBILITY_ALREADY_EXISTS",message:"La compatibilidad ya existe. Revisa su estado."},409);
    assert.equal(body.expectedSetVersion,setVersion);const m=models.find(m=>m.id===body.modelId);assert.ok(m);
    const r={id:id(60),version:1,status:"PENDING",model:{id:m.id,name:m.name,manufacturerCode:m.manufacturerCode,retiredAt:null,brand:{id:m.brandId,name:m.brandName,retiredAt:null}},evidenceType:null,evidenceReference:null,note:null,reviewReason:null,verifiedAt:null,createdAt:now,updatedAt:now};rows.push(r);setVersion++;
    const result={compatibility:structuredClone(r),setVersion};receipts.set(body.operationId,result);
    if(loseReply){loseReply=false;return reply({message:"Respuesta perdida. Reintenta con los mismos datos."},503);}
    return reply({success:true,result:{...result,idempotent:false}},201);
  }
  if(url.pathname===`/api/inventory/items/${itemId}/compatibilities/${id(60)}`&&req.method==="PATCH") {
    const row=rows[0];assert.equal(body.expectedVersion,row.version);assert.equal(body.expectedSetVersion,setVersion);
    const before=structuredClone(row);Object.assign(row,{note:body.note,evidenceType:body.evidenceType,evidenceReference:body.evidenceReference});
    row.status=body.status??(before.status==="VERIFIED"&&before.evidenceReference!==row.evidenceReference?"PENDING":before.status);
    row.reviewReason=body.reviewReason??row.reviewReason;row.verifiedAt=row.status==="VERIFIED"?now:null;row.version++;setVersion++;
    events.unshift({id:id(100+events.length),actorId:owner,entityId:row.id,entityKind:"COMPATIBILITY",eventType:"STATUS_CHANGED",before,after:structuredClone(row),occurredAt:now});
    return success({compatibility:structuredClone(row),setVersion});
  }
  unknown.push(`${req.method} ${url.pathname}`);return reply({},404);
}
try {
  await privatePanelFixture(api,async({command,evaluate,poll,fill,click:globalClick})=>{
    const root=`document.querySelector('section[aria-label="Compatibilidades privadas"]')`;
    const text=()=>evaluate(`${root}?.textContent??''`),waitText=t=>poll(async()=>(await text()).includes(t));
    const click=async label=>{
      await poll(()=>evaluate(`Boolean([...${root}.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled))`));
      assert.equal(await evaluate(`(()=>{const b=[...${root}.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!b||b.disabled)return false;b.click();return true})()`),true,label);
    };
    const input=async(label,value)=>{
      const selector=await evaluate(`(()=>{const labels=[...${root}.querySelectorAll('label')];const l=labels.find(l=>l.firstChild?.textContent.trim()===${JSON.stringify(label)});if(!l)return null;const e=l.querySelector('input,textarea,select');e.setAttribute('data-fixture-field','active');return '[data-fixture-field="active"]'})()`);assert.ok(selector);
      await fill(selector,value);await evaluate(`document.querySelector('[data-fixture-field="active"]').removeAttribute('data-fixture-field')`);
    };
    const choose=async(label,value)=>evaluate(`(()=>{const l=[...${root}.querySelectorAll('label')].find(l=>l.firstChild?.textContent.trim()===${JSON.stringify(label)});const s=l.querySelector('select');s.value=${JSON.stringify(value)};s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await command("Page.navigate",{url:"http://localhost:4338/dashboard/inventario"});
    await poll(()=>evaluate(`Boolean([...document.querySelectorAll('button')].find(b=>b.textContent==='Movimientos de Accessory A'))`));
    await globalClick("Movimientos de Accessory A");await waitText("No hay compatibilidades declaradas");assert.equal(writes.length,0);
    await click("Buscar marcas");await waitText("Oppo");await choose("Marca seleccionada",id(10));await click("Buscar modelos");await waitText("A58 4G");await choose("Modelo seleccionado",id(20));assert.equal(writes.length,0);
    checks.push("Existing inventory route, item without brand/model, empty reads and explicit dictionary selection without writes");
    await click("Añadir como pendiente");await waitText("Respuesta perdida");await click("Añadir como pendiente");await waitText("Revisar A58 4G");
    const adds=writes.filter(w=>w.path.endsWith('/compatibilities'));assert.equal(adds.length,2);assert.equal(adds[0].body.operationId,adds[1].body.operationId);assert.equal(rows.length,1);
    checks.push("Explicit pending creation and lost-response retry reuses exact command/key without duplicates");
    await click("Revisar A58 4G");await input("Referencia de evidencia","Synthetic test");await click("Verificar compatibilidad");
    await waitText("Revisar A58 4G");await poll(()=>rows[0].status==="VERIFIED");await waitText("Verificada");
    await click("Revisar A58 4G");const beforeCancel=writes.length;await click("Cancelar revisión");assert.equal(writes.length,beforeCancel);
    await click("Revisar A58 4G");await input("Referencia de evidencia","Changed evidence");await click("Guardar revisión");await poll(()=>rows[0].status==="PENDING");await waitText("Revisar A58 4G");
    checks.push("Evidence verification, cancelled edit without writes and changed verified evidence becomes pending");
    await click("Revisar A58 4G");await input("Motivo de revisión","Not the correct variant");await click("Rechazar compatibilidad");await poll(()=>rows[0].status==="REJECTED");await waitText("Rechazada");
    await click("Revisar A58 4G");assert.equal(await evaluate(`[...${root}.querySelectorAll('button')].some(b=>b.textContent==='Verificar compatibilidad')`),false);
    await click("Volver a pendiente");await poll(()=>rows[0].status==="PENDING");await waitText("Revisar A58 4G");
    await click("Revisar A58 4G");await input("Motivo de revisión","Withdraw wrong selection");await click("Retirar compatibilidad");await poll(()=>rows[0].status==="WITHDRAWN");await waitText("Retirada");
    await click("Añadir como pendiente");await waitText("La compatibilidad ya existe");assert.equal(rows.length,1);
    checks.push("Rejection, explicit reopening, withdrawal and duplicate guard; no direct verification from rejected state");
    await evaluate(`[...${root}.querySelectorAll('details')].find(d=>d.querySelector('summary').textContent==='Añadir alias básico').open=true`);
    await input("Nuevo alias","Conflict");await click("Añadir alias a modelo");await waitText("Ese nombre o alias");
    await input("Nuevo alias","A58 LTE");await click("Añadir alias a modelo");await waitText("Operación confirmada");assert.equal(models[0].version,2);
    checks.push("Basic aliases require explicit write and namespace conflicts are visible");
    await evaluate(`[...${root}.querySelectorAll('details')].find(d=>d.querySelector('summary').textContent==='Registrar marca nueva').open=true`);
    await input("Nombre de nueva marca","Honor");await click("Crear marca");await waitText("Honor");
    await evaluate(`[...${root}.querySelectorAll('details')].find(d=>d.querySelector('summary').textContent==='Registrar modelo nuevo').open=true`);
    await input("Nombre y variante del nuevo modelo","X9 test variant");await click("Crear modelo");await waitText("X9 test variant");assert.equal(rows.length,1);
    checks.push("Explicit brand/model creation does not create compatibility automatically");
    listMode="INVALID";await click("Recargar compatibilidades");await waitText("No se pudo validar");
    listMode="NORMAL";await click("Recargar compatibilidades");await waitText("Revisar A58 4G");
    eventMode="ERROR";await click("Ver auditoría de compatibilidades");await waitText("Auditoría temporalmente no disponible");eventMode="NORMAL";await click("Reintentar auditoría");await waitText("Actor");
    checks.push("Malformed reads fail closed; list and private audit errors allow explicit retry");
    holdItem=itemId;await click("Recargar compatibilidades");await poll(()=>Boolean(release));
    await globalClick("Movimientos de Accessory B");await waitText("No hay compatibilidades declaradas");release();holdItem=null;
    await new Promise(resolve=>setTimeout(resolve,250));assert.ok(!(await text()).includes("Revisar A58 4G"));assert.equal(items[0].stock,8);
    checks.push("Late response from previous item is discarded; stock, prices and historical modules are untouched");
    assert.deepEqual(unknown,[]);console.log(JSON.stringify({checks,writes:writes.length,relations:rows.length,productionAccess:false,realDatabase:false},null,2));
  },{browser:"chrome",sandbox:false});
}catch(e){console.error(e);process.exitCode=1;}
