import Link from "next/link";
import BrandLogo from "@/components/brand/BrandLogo";
import { enabledEntries, isActive, PANEL_GROUPS, type PanelEntry } from "@/lib/panel-navigation";

function EntryLink({ entry, pathname }: { entry: PanelEntry; pathname: string }) {
  const active = isActive(entry, pathname);
  const Icon = entry.icon;
  return (
    <Link href={entry.href} aria-current={active ? "page" : undefined}
      className={`flex min-h-11 items-center gap-3 rounded-xl px-3.5 text-[0.95rem] font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${active ? "bg-[var(--vy-blue-600)] text-white shadow-[0_10px_24px_-12px_rgba(4,80,229,0.9)]" : "text-[#E4EBFA] hover:bg-white/10 hover:text-white"}`}>
      <Icon aria-hidden="true" className="size-5 shrink-0" strokeWidth={1.9} />
      {entry.label}
    </Link>
  );
}

/** Desktop side menu (≥ lg). Entries come from lib/panel-navigation.ts. */
export default function PanelSidebar({ pathname }: { pathname: string }) {
  const entries = enabledEntries();
  const top = entries.filter(entry => entry.group === null);
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col overflow-y-auto bg-[linear-gradient(180deg,var(--vy-navy-900)_0%,var(--vy-navy-700)_100%)] px-4 pb-5 pt-7 text-white lg:flex">
      <Link href="/dashboard" aria-label="Vitrinaya, ir a Inicio" className="mx-2 mb-7 flex w-fit rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">
        <BrandLogo variant="horizontal" theme="oscuro" iconSize={40} nameRatio={0.6} gapSize={10} />
      </Link>
      <nav aria-label="Principal" className="flex-1">
        <ul className="space-y-1">{top.map(entry => <li key={entry.id}><EntryLink entry={entry} pathname={pathname} /></li>)}</ul>
        {PANEL_GROUPS.map(group => {
          const items = entries.filter(entry => entry.group === group);
          if (!items.length) return null;
          return (
            <div key={group} className="mt-5 border-t border-white/10 pt-4 first-of-type:border-t-0">
              <p id={`panel-group-${group}`} className="mb-1.5 px-3.5 text-sm font-medium text-[#B7C6EA]">{group}</p>
              <ul aria-labelledby={`panel-group-${group}`} className="space-y-1">{items.map(entry => <li key={entry.id}><EntryLink entry={entry} pathname={pathname} /></li>)}</ul>
            </div>
          );
        })}
      </nav>
      {/* Decorative, not interactive. */}
      <div className="relative mt-6 overflow-hidden rounded-2xl bg-white/10 px-4 py-4">
        <p className="flex items-center gap-2 text-sm font-semibold"><span aria-hidden="true">🚀</span>Hagamos crecer tu negocio</p>
        <p className="mt-1 text-xs text-[#C5D3F0]">Con Vitrinaya, es más fácil</p>
      </div>
    </aside>
  );
}
