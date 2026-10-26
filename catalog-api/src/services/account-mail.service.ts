import { z } from "zod";
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
  const config = z.object({
    key: z.string().trim().min(1).regex(/^[^\r\n]+$/),
    email: z.string().trim().email(),
    name: z.string().trim().min(1).max(100).regex(/^[^\r\n]+$/),
  }).safeParse({ key: process.env.BREVO_API_KEY, email: process.env.BREVO_SENDER_EMAIL, name: process.env.BREVO_SENDER_NAME });
  if (mode !== "brevo" || !config.success) throw new Error("MAIL_NOT_CONFIGURED");
  const { key, email, name } = config.data;
  if (process.env.MAIL_FROM !== undefined && process.env.MAIL_FROM.trim() !== `${name} <${email}>`) throw new Error("MAIL_NOT_CONFIGURED");
  if (process.env.NODE_ENV !== "production") throw new Error("REAL_MAIL_DISABLED_IN_DEVELOPMENT");
  const url = accountActionUrl(mail.purpose, mail.token);
  const verification = mail.purpose === "VERIFY_EMAIL";
  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(8000),
      headers: { "api-key": key, accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({
        sender: { email, name },
        replyTo: { email: "vitrinaya983@gmail.com" },
        to: [{ email: mail.to }],
        subject: verification ? "Verifica tu correo en Vitrinaya" : "Recupera tu acceso a Vitrinaya",
        textContent: `${verification ? "Confirma tu correo" : "Establece una contraseña nueva"} abriendo este enlace y confirmando en la página:\n${url}\n\nCaduca en ${verification ? "24 horas" : "30 minutos"}. Si no lo solicitaste, ignora este mensaje.`,
      }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("MAIL_DELIVERY_FAILED");
    }
    if (!z.object({ messageId: z.string().min(1) }).safeParse(await response.json()).success) throw new Error("MAIL_DELIVERY_FAILED");
  } catch { throw new Error("MAIL_DELIVERY_FAILED"); }
} };
