import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compatibilityStates, parseDevicePage, parseDeviceMutation, parseCompatibilityPage, parseCompatibilityMutation, parseCompatibilityEvents } from "../lib/compatibilities.mjs";
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const date="2026-11-24T12:00:00.000Z";
const brand={id:id(1),name:"Oppo",version:1,retiredAt:null};
const model={id:id(2),name:"A58 4G",version:1,retiredAt:null,brandId:brand.id,brandName:brand.name,brandRetiredAt:null,manufacturerCode:null};
const row={id:id(3),version:1,status:"PENDING",model:{id:model.id,name:model.name,manufacturerCode:null,retiredAt:null,brand:{id:brand.id,name:brand.name,retiredAt:null}},evidenceType:null,evidenceReference:null,note:null,reviewReason:null,createdAt:date,updatedAt:date,verifiedAt:null};
const page={success:true,source:{kind:"INVENTORY_ITEM",id:id(4)},set:{id:id(5),version:1},compatibilities:[row],page:1,pageSize:25,hasMore:false};
assert.deepEqual(parseCompatibilityPage(page,id(4),1,"all"),page);
assert.equal(parseDevicePage({success:true,items:[brand],page:1,pageSize:25,hasMore:false},"brand",1).items[0].id,brand.id);
assert.equal(parseDeviceMutation({success:true,result:{entity:model,idempotent:false}},"model").brandId,brand.id);
for(const status of compatibilityStates) {
  const r={...row,status,...(status==="VERIFIED"?{evidenceType:"SELLER_TEST",evidenceReference:"Test",verifiedAt:date}:{})};
  assert.equal(parseCompatibilityPage({...page,compatibilities:[r]},id(4),1,status).compatibilities[0].status,status);
}
for(const bad of [null,{}, {...page,source:{kind:"INVENTORY_ITEM",id:id(9)}}, {...page,compatibilities:[row,row]}, {...page,set:null}, {...page,compatibilities:[{...row,status:"PAID"}]}, {...page,compatibilities:[{...row,status:"VERIFIED"}]}]) assert.throws(()=>parseCompatibilityPage(bad,id(4),1,"all"));
assert.throws(()=>parseCompatibilityPage(page,id(4),1,"VERIFIED"));
assert.throws(()=>parseDevicePage({success:true,items:[model],page:1,pageSize:25,hasMore:false},"model",1,id(99)));
assert.throws(()=>parseDeviceMutation({success:true,result:{entity:brand,idempotent:false}},"model"));
assert.throws(()=>parseCompatibilityMutation({success:true,result:{compatibility:row,setVersion:1,idempotent:true}},id(8)));
assert.throws(()=>parseCompatibilityMutation({success:true,result:{compatibility:row,setVersion:1,idempotent:true}},model.id,id(8)));
assert.equal(parseCompatibilityMutation({success:true,result:{compatibility:row,setVersion:1,idempotent:true}},model.id,row.id).idempotent,true);
assert.throws(()=>parseCompatibilityEvents({success:true,items:[{actorId:"bad"}],page:1,pageSize:25,hasMore:false},1));
const schema=readFileSync(new URL("../../catalog-api/prisma/schema.prisma",import.meta.url),"utf8");
assert.deepEqual(compatibilityStates,[...schema.match(/enum CompatibilityStatus \{([^}]+)\}/)[1].matchAll(/\b(PENDING|VERIFIED|REJECTED|WITHDRAWN)\b/g)].map(x=>x[1]));
console.log("PASS private compatibilities: DTO identity, states, dictionary scope, malformed replies and Prisma enum contract");
