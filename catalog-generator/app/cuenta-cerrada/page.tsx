import Link from "next/link";
export const metadata = { title: "Cuenta cerrada | Vitrinaya", robots: { index: false, follow: false } };
export default function ClosedAccountPage() {
  return <main className="mx-auto max-w-xl space-y-5 px-5 py-12 text-[#263b31]"><h1 className="text-2xl font-semibold">Cuenta cerrada al acceso</h1><p>La sesión se ha cerrado y los catálogos se han retirado de publicación. La limpieza de archivos queda pendiente y se reintenta de forma persistente.</p><p>Se conserva el historial de ventas con los datos de clientes revisados y anonimizados, los registros técnicos y las instantáneas comerciales del vendedor. Esto no es un borrado completo.</p><p>Esta página no consulta el estado de la limpieza. Para solicitar información, contacta con Vitrinaya.</p><Link href="/contacto" className="inline-flex min-h-11 items-center underline">Contactar con Vitrinaya</Link></main>;
}
