import type { Metadata } from "next";
import { connection } from "next/server";
import AccountActionForm from "@/components/auth/AccountActionForm";
export const metadata: Metadata = { title: "Restablecer contraseña | Vitrinaya", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default async function Page() { await connection(); return <AccountActionForm kind="reset" />; }
