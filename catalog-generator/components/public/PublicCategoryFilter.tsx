import { Category } from "@/lib/api";
import Image from "next/image";
import { publicCategoryHref } from "@/lib/public-category";

export default function PublicCategoryFilter({
  categories,
  selectedId,
  variant,
  onSelect,
  publicId,
}: {
  categories: Category[];
  selectedId: string;
  variant: "editorial" | "grid" | "boutique" | "tech" | "fashion" | "beauty";
  onSelect: (categoryId: string) => void;
  publicId: string;
}) {
  const selectedClass = variant === "tech"
    ? "border-[var(--catalog-primary,#56e0c0)] bg-[var(--catalog-primary,#56e0c0)] text-[var(--catalog-on-primary,#071421)]"
    : variant === "fashion"
      ? "border-[var(--catalog-primary,#322c29)] bg-[var(--catalog-primary,#322c29)] text-[var(--catalog-on-primary,#ffffff)]"
      : variant === "beauty"
        ? "border-[var(--catalog-primary,#b55271)] bg-[var(--catalog-primary,#b55271)] text-[var(--catalog-on-primary,#ffffff)]"
        : variant === "boutique"
    ? "border-[var(--catalog-primary,#bd4d36)] bg-[var(--catalog-primary,#bd4d36)] text-[var(--catalog-on-primary,#ffffff)]"
    : variant === "grid"
      ? "border-[var(--catalog-primary,#315c53)] bg-[var(--catalog-primary,#315c53)] text-[var(--catalog-on-primary,#ffffff)]"
      : "border-[var(--catalog-primary,#263b31)] bg-[var(--catalog-primary,#263b31)] text-[var(--catalog-on-primary,#ffffff)]";

  const barStyle = variant === "tech"
    ? "border-[var(--catalog-border-subtle,#26394a)] bg-[var(--catalog-surface-alpha-95,color-mix(in_oklab,#101e2d_95%,transparent))] text-[var(--catalog-text,#e5f2ff)]"
    : variant === "fashion"
      ? "border-[var(--catalog-border-subtle,#e5d9d0)] bg-[var(--catalog-surface-alpha-95,color-mix(in_oklab,#fffdfa_95%,transparent))] text-[var(--catalog-text,#322c29)]"
      : variant === "beauty"
        ? "border-[var(--catalog-border-subtle,#eed5dc)] bg-[var(--catalog-surface-alpha-95,color-mix(in_oklab,#fffaf9_95%,transparent))] text-[var(--catalog-text,#552e48)]"
        : "border-[var(--catalog-border-subtle,#d8ded6)] bg-[var(--catalog-surface-alpha-95,color-mix(in_oklab,#fbfcf9_95%,transparent))]";
  const idleClass = variant === "tech"
    ? "border-transparent bg-transparent text-[var(--catalog-text-muted,#a9bccd)] hover:border-[var(--catalog-primary-alpha-40,color-mix(in_oklab,#56e0c0_40%,transparent))] hover:bg-[var(--catalog-primary-hover,#1b2c3d)] hover:text-[var(--catalog-on-primary,#ffffff)]"
    : "border-transparent bg-transparent text-[var(--catalog-text-muted,#526157)] hover:border-[var(--catalog-border-subtle,#cbd4cb)] hover:bg-[var(--catalog-surface,#ffffff)]";

  return (
    <nav aria-label="Filtrar por categoría" className={`border-y py-2 backdrop-blur-sm ${barStyle}`}>
      <div className="mx-auto flex max-w-7xl items-center gap-2 px-3 sm:gap-4 sm:px-8">
        <div className="flex min-w-0 flex-1 snap-x gap-1 overflow-x-auto px-2 sm:gap-2">
          {[{ id: "", name: "Todos", imageUrl: null }, ...categories].map((category) => (
            <a
              key={category.id || "all"}
              href={publicCategoryHref(publicId, category.id)}
              onClick={event => {
                if (!event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); onSelect(category.id); }
              }}
              aria-current={selectedId === category.id ? "true" : undefined}
              className={`flex min-h-11 shrink-0 snap-start items-center gap-2 border px-3 text-xs font-semibold transition sm:px-4 ${selectedId === category.id ? selectedClass : idleClass}`}
            >
              {category.imageUrl && (
                <span className="relative size-8 shrink-0 overflow-hidden border border-[var(--catalog-border-subtle-alpha-10,color-mix(in_oklab,var(--color-black)_10%,transparent))] bg-[var(--catalog-surface-alpha-30,color-mix(in_oklab,var(--color-white)_30%,transparent))]">
                  <Image src={category.imageUrl} alt="" fill unoptimized sizes="32px" className="object-cover" />
                </span>
              )}
              <span>{category.name}</span>
            </a>
          ))}
        </div>

      </div>
    </nav>
  );
}
