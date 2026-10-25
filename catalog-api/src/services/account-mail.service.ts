import { Resend } from "resend";
import type { ActionPurpose } from "./account-action";

export type AccountMail = { purpose: ActionPurpose; to: string; token: string };
export interface AccountMailer { send(mail: AccountMail): Promise<void> }
export interface ActionDispatcher { enqueue(operation: ActionPurpose, work: () => Promise<void>): boolean }

export function createActionDispatcher(): ActionDispatcher {
  const queue: { operation: ActionPurpose; work: () => Promise<void> }[] = [];
  let running = 0;
  function drain() {
    while (running < 2 && queue.length) {
      const job = queue.shift();
      if (!job) return;
      running++;
      void job.work().catch(() => {
        console.warn("[account-mail]", { operation: job.operation, result: "failed" });
      }).finally(() => { running--; drain(); });
    }
  }
  return { enqueue(operation, work) {
    if (queue.length + running >= 100) return false;
    queue.push({ operation, work });
    setImmediate(drain);
    return true;
  } };
}

export function accountActionUrl(purpose: ActionPurpose, token: string, base = process.env.APP_PUBLIC_URL) {
  if (!base) throw new Error("APP_PUBLIC_URL_NOT_CONFIGURED");
  const origin = new URL(base);
  if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/" ||
    (origin.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && origin.protocol === "http:" && ["localhost", "127.0.0.1"].includes(origin.hostname)))) throw new Error("INVALID_APP_PUBLIC_URL");
  const url = new URL(purpose === "VERIFY_EMAIL" ? "/verificar-correo" : "/restablecer-contrasena", origin);
  // Fragment never reaches HTTP access logs. The client removes it before rendering the form.
  url.hash = new URLSearchParams({ token }).toString();
  return url.toString();
}

export const accountMailer: AccountMailer = { async send(mail) {
  const mode = process.env.MAIL_MODE ?? (process.env.NODE_ENV === "production" ? "" : "log");
  if (mode === "log") {
    console.info("[account-mail]", { operation: mail.purpose, result: "simulated" });
    return;
  }
  if (mode !== "resend" || !process.env.RESEND_API_KEY) throw new Error("MAIL_NOT_CONFIGURED");
  if (process.env.NODE_ENV !== "production") throw new Error("REAL_MAIL_DISABLED_IN_DEVELOPMENT");
  const url = accountActionUrl(mail.purpose, mail.token);
  const verification = mail.purpose === "VERIFY_EMAIL";
  const client = new Resend(process.env.RESEND_API_KEY);
  const result = await client.emails.send({
    from: process.env.MAIL_FROM ?? "Vitrinaya <onboarding@resend.dev>",
    replyTo: "vitrinaya983@gmail.com",
    to: mail.to,
    subject: verification ? "Verifica tu correo en Vitrinaya" : "Recupera tu acceso a Vitrinaya",
    text: `${verification ? "Confirma tu correo" : "Establece una contraseña nueva"} abriendo este enlace y confirmando en la página:\n${url}\n\nCaduca en ${verification ? "24 horas" : "30 minutos"}. Si no lo solicitaste, ignora este mensaje.`,
  }, { signal: AbortSignal.timeout(8000) });
  if (result.error) throw new Error("MAIL_DELIVERY_FAILED");
} };
