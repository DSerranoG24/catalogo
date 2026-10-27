import { catalogLayouts, type CatalogLayout } from "@/lib/catalog-layout";

export default function CatalogLayoutSelector({ value, onChange, disabled }: { value: CatalogLayout; onChange: (value: CatalogLayout) => void; disabled: boolean }) {
  return (
    <fieldset disabled={disabled} className="space-y-3 border-t border-[#e2e8e1] pt-6">
      <legend className="text-sm font-semibold text-[#202b27]">Distribución de tu catálogo</legend>
      <p className="text-xs text-[#526157]">En móvil, las tres opciones conservan la navegación horizontal.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        {catalogLayouts.map(option => <label key={option.id ?? "classic"} className={`relative block cursor-pointer rounded-xl border-2 p-3 text-[#202b27] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[#17665c] ${value === option.id ? "border-[#17665c] bg-[#edf5f0]" : "border-[#cbd5cd] bg-white"}`}>
          <input type="radio" name="catalog-layout" value={option.id ?? ""} checked={value === option.id} onChange={() => onChange(option.id)} className="sr-only" />
          <span aria-hidden="true" className="mb-3 block rounded border border-[#cbd5cd] bg-[#f4f7f2] p-2">
            <span className="mb-2 block h-3 bg-[#70867a]" />
            <span className="flex gap-2">
              {option.id && <span className={`block h-14 shrink-0 bg-[#b4c9bc] ${option.id === "sidebar" ? "w-1/3" : "w-1/5"}`} />}
              <span className="block min-w-0 flex-1">{!option.id && <span className="mb-2 block h-2 bg-[#b4c9bc]" />}<span className="grid grid-cols-3 gap-1">{[0, 1, 2].map(i => <span key={i} className="block h-10 bg-[#d5dfd7]" />)}</span></span>
            </span>
          </span>
          <span className="block text-sm font-semibold">{option.name}</span>
          <span className="mt-1 block text-xs leading-5">{option.description}</span>
          <span className="mt-2 block text-xs font-semibold">{value === option.id ? "Seleccionada" : "Elegir distribución"}</span>
        </label>)}
      </div>
    </fieldset>
  );
}
