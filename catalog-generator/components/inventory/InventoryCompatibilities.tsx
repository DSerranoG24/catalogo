"use client";

import { useEffect, useRef, useState } from "react";
import { apiRequest, ApiError } from "@/lib/api";
import { InventoryRetryKeys } from "@/lib/inventory-retry";
import { compatibilityStates, evidenceTypes, parseDevicePage, parseDeviceMutation, parseCompatibilityPage, parseCompatibilityMutation, parseCompatibilityEvents,
  type CompatibilityPage, type DeviceBrand, type DeviceModel, type EventPage, type ItemCompatibility } from "@/lib/compatibilities.mjs";

const labels = { PENDING: "Pendiente", VERIFIED: "Verificada", REJECTED: "Rechazada", WITHDRAWN: "Retirada" };
const evidenceLabels = { SELLER_TEST: "Prueba del vendedor", MANUFACTURER_REFERENCE: "Referencia del fabricante", SUPPLIER_REFERENCE: "Referencia del proveedor", DOCUMENTED_REVIEW: "Revisión documentada" };
const errorMessage = (e: unknown) => e instanceof ApiError && e.status === 401 ? "Tu sesión expiró. Inicia sesión de nuevo." : e instanceof Error ? e.message : "No se pudo completar la operación. Puedes reintentar.";
const button = "min-h-11 rounded border px-3 py-2 focus-visible:outline-2";
const input = "block min-h-11 w-full rounded border p-2 focus-visible:outline-2";

export default function InventoryCompatibilities({ itemId }: { itemId: string }) {
  const [page, setPage] = useState(1), [filter, setFilter] = useState("all"), [revision, setRevision] = useState(0);
  const [list, setList] = useState<{ key: string; value: CompatibilityPage | null; error: string } | null>(null);
  const listKey = `${itemId}:${page}:${filter}:${revision}`;
  const current = list?.key === listKey ? list : null;
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const pending = useRef(false), mounted = useRef(true), retry = useRef(new InventoryRetryKeys());
  const [brands, setBrands] = useState<DeviceBrand[]>([]), [brandPage, setBrandPage] = useState(1), [moreBrands, setMoreBrands] = useState(false);
  const [brandQuery, setBrandQuery] = useState(""), [brandId, setBrandId] = useState(""), [brandName, setBrandName] = useState("");
  const [models, setModels] = useState<DeviceModel[]>([]), [modelPage, setModelPage] = useState(1), [moreModels, setMoreModels] = useState(false);
  const [modelQuery, setModelQuery] = useState(""), [modelId, setModelId] = useState(""), [modelName, setModelName] = useState(""), [code, setCode] = useState("");
  const [searching, setSearching] = useState(false), [searched, setSearched] = useState(false), [modelSearched, setModelSearched] = useState(false);
  const searchVersion = useRef(0);
  const brand = brands.find(b => b.id === brandId), model = models.find(m => m.id === modelId);
  const [alias, setAlias] = useState("");
  const [selected, setSelected] = useState<ItemCompatibility | null>(null);
  const [evidenceType, setEvidenceType] = useState("DOCUMENTED_REVIEW"), [reference, setReference] = useState(""), [note, setNote] = useState(""), [reason, setReason] = useState("");
  const [events, setEvents] = useState<EventPage | null>(null), [eventPage, setEventPage] = useState(1), [eventLoading, setEventLoading] = useState(false), [eventError, setEventError] = useState("");
  const eventVersion = useRef(0);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    apiRequest<unknown>(`/inventory/items/${itemId}/compatibilities?${new URLSearchParams({ page: String(page), status: filter })}`, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setList({ key: listKey, value: parseCompatibilityPage(value,itemId,page,filter), error: "" }); })
      .catch(e => { if (!controller.signal.aborted) setList({ key: listKey, value: null, error: errorMessage(e) }); });
    return () => controller.abort();
  }, [itemId, page, filter, listKey]);

  function clearModels() { setModels([]); setModelId(""); setModelSearched(false); setMoreModels(false); }
  async function searchDevices(kind: "brand" | "model", targetPage = 1) {
    if (kind === "model" && !brand) return;
    const version = ++searchVersion.current;
    setSearching(true); setError("");
    try {
      if (kind === "brand") {
        setBrandId(""); clearModels();
        const result = parseDevicePage(await apiRequest<unknown>(`/device-brands?${new URLSearchParams({ q: brandQuery, page: String(targetPage), status: "active" })}`), "brand", targetPage);
        if (mounted.current && version === searchVersion.current) { setBrands(result.items); setBrandPage(targetPage); setMoreBrands(result.hasMore); setSearched(true); }
      } else if (brand) {
        setModelId("");
        const result = parseDevicePage(await apiRequest<unknown>(`/device-models?${new URLSearchParams({ q: modelQuery, brandId: brand.id, page: String(targetPage), status: "active" })}`), "model", targetPage,brand.id);
        if (mounted.current && version === searchVersion.current) { setModels(result.items); setModelPage(targetPage); setMoreModels(result.hasMore); setModelSearched(true); }
      }
    } catch(e) { if (mounted.current && version === searchVersion.current) setError(errorMessage(e)); }
    finally { if (mounted.current && version === searchVersion.current) setSearching(false); }
  }
  async function write(path: string, method: "POST" | "PATCH", fields: Record<string,unknown>, accept: (reply: unknown) => void) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(""); setMessage("");
    const fingerprint = JSON.stringify({ path, method, fields });
    try {
      const reply = await apiRequest<unknown>(path, { method, body: JSON.stringify({ operationId: retry.current.keyFor(fingerprint), ...fields }) });
      if (!mounted.current) return;
      accept(reply); retry.current.complete(fingerprint); setMessage("Operación confirmada. Revisa el estado actualizado.");
    } catch(e) { if (mounted.current) setError(errorMessage(e)); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  function select(row: ItemCompatibility) {
    setSelected(row); setEvidenceType(row.evidenceType ?? "DOCUMENTED_REVIEW"); setReference(row.evidenceReference ?? ""); setNote(row.note ?? ""); setReason(""); setError("");
  }
  function saved() { setSelected(null); setRevision(v => v + 1); eventVersion.current++; setEvents(null); setEventLoading(false); }
  function update(status?: string) {
    if (!selected || !current?.value?.set) return;
    const fields: Record<string,unknown> = { expectedSetVersion: current.value.set.version, expectedVersion: selected.version,
      note: note || null, evidenceType, evidenceReference: reference || null, ...(reason ? { reviewReason: reason } : {}), ...(status ? { status } : {}) };
    void write(`/inventory/items/${itemId}/compatibilities/${selected.id}`, "PATCH", fields, reply => {
      parseCompatibilityMutation(reply,selected.model.id,selected.id); saved();
    });
  }
  async function loadEvents(targetPage = 1) {
    const version = ++eventVersion.current; setEventLoading(true); setEventError(""); setEvents(null);
    try {
      const value = parseCompatibilityEvents(await apiRequest<unknown>(`/inventory/items/${itemId}/compatibility-events?page=${targetPage}`),targetPage);
      if (mounted.current && version === eventVersion.current) { setEvents(value); setEventPage(targetPage); }
    } catch(e) { if (mounted.current && version === eventVersion.current) setEventError(errorMessage(e)); }
    finally { if (mounted.current && version === eventVersion.current) setEventLoading(false); }
  }
  return <section aria-label="Compatibilidades privadas" className="space-y-4 rounded border p-4">
    <h3 className="text-lg font-semibold">Compatibilidades</h3>
    <p>Solo para tu gestión privada. Verificada significa revisada por ti; no es una certificación del fabricante.</p>
    <p className="text-sm">Busca y selecciona un modelo concreto. No se presume compatibilidad por nombres parecidos. Si una respuesta es incierta, reintenta la misma acción sin cambiar los datos; tras recargar, consulta primero la lista y el historial.</p>
    <p role="status">{message}</p>{error && <p role="alert">{error}</p>}
    {!current && <p role="status">Cargando compatibilidades…</p>}
    {current?.error && <p role="alert">{current.error}</p>}
    <button className={button} disabled={busy} onClick={() => { setSelected(null); setRevision(v=>v+1); }}>Recargar compatibilidades</button>
    <label className="block">Estado de compatibilidad<select className={input} disabled={busy} value={filter} onChange={e=>{setFilter(e.target.value);setPage(1);setSelected(null);}}><option value="all">Todos</option>{compatibilityStates.map(s=><option key={s} value={s}>{labels[s]}</option>)}</select></label>
    {current?.value && <>
      {!current.value.compatibilities.length && <p>No hay compatibilidades declaradas en esta página. No significa compatibilidad universal.</p>}
      <ul className="space-y-2">{current.value.compatibilities.map(row=><li key={row.id} className="rounded border p-3">
        <p>{row.model.brand.name} · {row.model.name} {row.model.manufacturerCode && `· ${row.model.manufacturerCode}`} · {labels[row.status]}</p>
        <p className="text-sm">{row.evidenceReference ?? row.note ?? "Sin evidencia registrada"}</p>
        {(row.model.retiredAt || row.model.brand.retiredAt) && <p>Destino retirado; no disponible para nuevas verificaciones.</p>}
        <button className={button} disabled={busy} onClick={()=>select(row)}>Revisar {row.model.name}</button>
      </li>)}</ul>
      <div className="flex gap-2"><button className={button} disabled={busy || page===1} onClick={()=>{setPage(v=>v-1);setSelected(null);}}>Compatibilidades anteriores</button><button className={button} disabled={busy || !current.value.hasMore} onClick={()=>{setPage(v=>v+1);setSelected(null);}}>Más compatibilidades</button></div>
    </>}
    {selected && <section aria-label="Revisar compatibilidad" className="space-y-2 rounded border p-3">
      <h4>{selected.model.brand.name} · {selected.model.name} · {labels[selected.status]}</h4>
      <fieldset disabled={busy || !current?.value} className="space-y-2">
        <label className="block">Tipo de evidencia<select className={input} value={evidenceType} onChange={e=>setEvidenceType(e.target.value)}>{evidenceTypes.map(t=><option key={t} value={t}>{evidenceLabels[t]}</option>)}</select></label>
        <label className="block">Referencia de evidencia<textarea className={input} maxLength={500} value={reference} onChange={e=>setReference(e.target.value)} /></label>
        <label className="block">Notas de compatibilidad<textarea className={input} maxLength={1000} value={note} onChange={e=>setNote(e.target.value)} /></label>
        <label className="block">Motivo de revisión<input className={input} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} /></label>
        <div className="flex flex-wrap gap-2">
          <button className={button} onClick={()=>update()}>Guardar revisión</button>
          {selected.status==="PENDING" && <button className={button} disabled={!reference.trim() && !note.trim()} onClick={()=>update("VERIFIED")}>Verificar compatibilidad</button>}
          {["PENDING","VERIFIED"].includes(selected.status) && <><button className={button} disabled={reason.trim().length<3} onClick={()=>update("REJECTED")}>Rechazar compatibilidad</button><button className={button} disabled={reason.trim().length<3} onClick={()=>update("WITHDRAWN")}>Retirar compatibilidad</button></>}
          {selected.status!=="PENDING" && <button className={button} onClick={()=>update("PENDING")}>Volver a pendiente</button>}
          <button className={button} onClick={()=>setSelected(null)}>Cancelar revisión</button>
        </div>
      </fieldset>
    </section>}
    <fieldset disabled={busy || searching} className="space-y-3 rounded border p-3">
      <legend>Añadir compatibilidad pendiente</legend>
      <form onSubmit={e=>{e.preventDefault();void searchDevices("brand");}} className="space-y-2">
        <label className="block">Buscar marca o alias<input className={input} maxLength={100} value={brandQuery} onChange={e=>{setBrandQuery(e.target.value);searchVersion.current++;setSearching(false);setBrands([]);setBrandId("");setSearched(false);clearModels();}} /></label><button className={button}>Buscar marcas</button>
      </form>
      {searched && !brands.length && <p>No se encontraron marcas en esta página.</p>}
      <label className="block">Marca seleccionada<select className={input} value={brandId} onChange={e=>{setBrandId(e.target.value);searchVersion.current++;clearModels();setAlias("");}}><option value="">Selecciona una marca</option>{brands.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      <div className="flex gap-2">{brandPage>1 && <button className={button} onClick={()=>void searchDevices("brand",brandPage-1)}>Marcas anteriores</button>}{moreBrands && <button className={button} onClick={()=>void searchDevices("brand",brandPage+1)}>Más marcas</button>}</div>
      <details><summary>Registrar marca nueva</summary><form className="space-y-2" onSubmit={e=>{e.preventDefault();void write("/device-brands","POST",{name:brandName},reply=>{const b=parseDeviceMutation(reply,"brand");setBrands(v=>[b,...v.filter(x=>x.id!==b.id)]);setBrandId(b.id);clearModels();setBrandName("");});}}><label>Nombre de nueva marca<input className={input} required maxLength={100} value={brandName} onChange={e=>setBrandName(e.target.value)} /></label><button className={button}>Crear marca</button></form></details>
      {brand && <>
        <form className="space-y-2" onSubmit={e=>{e.preventDefault();void searchDevices("model");}}><label>Buscar modelo o alias<input className={input} maxLength={160} value={modelQuery} onChange={e=>{setModelQuery(e.target.value);searchVersion.current++;setSearching(false);clearModels();}} /></label><button className={button}>Buscar modelos</button></form>
        {modelSearched && !models.length && <p>No se encontraron modelos en esta página.</p>}
        <label className="block">Modelo seleccionado<select className={input} value={modelId} onChange={e=>{setModelId(e.target.value);setAlias("");}}><option value="">Selecciona un modelo concreto</option>{models.map(m=><option key={m.id} value={m.id}>{m.name} {m.manufacturerCode ?? ""}</option>)}</select></label>
        <div className="flex gap-2">{modelPage>1 && <button className={button} onClick={()=>void searchDevices("model",modelPage-1)}>Modelos anteriores</button>}{moreModels && <button className={button} onClick={()=>void searchDevices("model",modelPage+1)}>Más modelos</button>}</div>
        <details><summary>Registrar modelo nuevo</summary><form className="space-y-2" onSubmit={e=>{e.preventDefault();void write("/device-models","POST",{brandId:brand.id,name:modelName,manufacturerCode:code || null},reply=>{const m=parseDeviceMutation(reply,"model");if(m.brandId!==brand.id)throw Error("La respuesta no corresponde a la marca seleccionada.");setModels(v=>[m,...v.filter(x=>x.id!==m.id)]);setModelId(m.id);setModelName("");setCode("");});}}><label>Nombre y variante del nuevo modelo<input className={input} required maxLength={160} value={modelName} onChange={e=>setModelName(e.target.value)} /></label><label>Código del fabricante (opcional)<input className={input} maxLength={100} value={code} onChange={e=>setCode(e.target.value)} /></label><button className={button}>Crear modelo</button></form></details>
        <details><summary>Añadir alias básico</summary><p>Solo otro nombre de la misma identidad; no equivalencia con otro dispositivo.</p><label>Nuevo alias<input className={input} maxLength={model?160:100} value={alias} onChange={e=>setAlias(e.target.value)} /></label><button className={button} disabled={!alias.trim()} onClick={()=>{
          const kind=model?"model":"brand", entity=model??brand;
          void write(`/device-${kind==="model"?"models":"brands"}/${entity.id}/names`,"POST",{expectedVersion:entity.version,label:alias},reply=>{
            if(kind==="model"){const m=parseDeviceMutation(reply,"model");if(m.id!==entity.id)throw Error("Modelo distinto en la respuesta.");setModels(v=>v.map(x=>x.id===m.id?m:x));}
            else {const b=parseDeviceMutation(reply,"brand");if(b.id!==entity.id)throw Error("Marca distinta en la respuesta.");setBrands(v=>v.map(x=>x.id===b.id?b:x));}setAlias("");
          });
        }}>Añadir alias a {model?"modelo":"marca"}</button></details>
      </>}
      <button className={button} disabled={!model || !current?.value} onClick={()=>{if(!model||!current?.value)return;void write(`/inventory/items/${itemId}/compatibilities`,"POST",{expectedSetVersion:current.value.set?.version??0,modelId:model.id},reply=>{parseCompatibilityMutation(reply,model.id);saved();});}}>Añadir como pendiente</button>
    </fieldset>
    {searching && <p role="status">Buscando diccionario…</p>}
    <button className={button} disabled={eventLoading || busy} onClick={()=>void loadEvents()}>Ver auditoría de compatibilidades</button>
    {eventLoading && <p role="status">Cargando auditoría…</p>}{eventError && <p role="alert">{eventError} <button onClick={()=>void loadEvents(eventPage)}>Reintentar auditoría</button></p>}
    {events && <section aria-label="Auditoría de compatibilidades">
      {!events.items.length && <p>No hay cambios registrados.</p>}
      <ul>{events.items.map(event=><li key={event.id} className="border-b py-2"><p>{new Date(event.occurredAt).toLocaleString("es-CO",{timeZone:"America/Bogota"})} · {event.eventType} · Actor {event.actorId}</p><p>Estado anterior: {String(event.before?.status??"No registrado")} · Estado nuevo: {String(event.after.status??"No aplica")}</p><p>Motivo: {String(event.after.reviewReason??"No registrado")}</p><p>Evidencia anterior: {String(event.before?.evidenceReference??"No registrada")} · Evidencia nueva: {String(event.after.evidenceReference??"No registrada")}</p></li>)}</ul>
      <button className={button} disabled={eventLoading||eventPage===1} onClick={()=>void loadEvents(eventPage-1)}>Auditoría anterior</button><button className={button} disabled={eventLoading||!events.hasMore} onClick={()=>void loadEvents(eventPage+1)}>Más auditoría</button>
    </section>}
  </section>;
}
