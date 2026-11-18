"use client";
import dynamic from "next/dynamic";
const FreeWorkbook = dynamic(() => import("./FreeWorkbook"), { ssr: false, loading: () => <p role="status" className="p-6">Cargando editor de hoja de cálculo…</p> });
export default function FreeWorkbookLoader() { return <FreeWorkbook />; }
