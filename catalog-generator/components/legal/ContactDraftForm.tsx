"use client";

import { useState, useSyncExternalStore, type FormEvent } from "react";
import { contactDraft } from "@/lib/contact-draft";
import styles from "./legal.module.css";

const subscribe = () => () => {};
export default function ContactDraftForm() {
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(""); setError("");
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    try {
      const data = new FormData(form);
      const draft = contactDraft({ name: String(data.get("name") ?? ""), email: String(data.get("email") ?? ""), message: String(data.get("message") ?? "") });
      const url = URL.createObjectURL(new Blob([draft], { type: "message/rfc822" }));
      const link = document.createElement("a");
      link.href = url; link.download = "consulta-vitrinaya.eml"; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage("Borrador preparado como consulta-vitrinaya.eml. Ábrelo en una aplicación de correo compatible, revisa el contenido y envíalo tú. Vitrinaya no ha enviado ningún mensaje.");
    } catch (failure) {
      setError(failure instanceof Error && failure.message === "Revisa el nombre, el correo y el mensaje." ? failure.message : "No se pudo preparar el archivo. Utiliza el enlace directo al correo.");
    }
  }
  return <>
    <p>Este formulario prepara un archivo de borrador (.eml) en tu dispositivo, con asunto y cuerpo prellenados. No envía datos al servidor ni los coloca en la URL. Debes abrir el archivo en tu aplicación de correo y enviarlo tú; algunas aplicaciones pueden abrirlo como mensaje en lugar de borrador.</p>
    <form method="post" onSubmit={prepare} aria-label="Preparar consulta por correo">
      <fieldset disabled={!hydrated} className={styles.form}>
        <legend>Prepara tu consulta</legend>
        <label>Nombre<input name="name" autoComplete="name" required maxLength={100} /></label>
        <label>Correo de respuesta<input name="email" type="email" autoComplete="email" required maxLength={254} /></label>
        <label>Mensaje<textarea name="message" required rows={6} maxLength={4000} /></label>
        <button type="submit">Preparar borrador de correo</button>
      </fieldset>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
    </form>
    <noscript><p>Para usar el formulario necesitas JavaScript. Sin él, puedes escribir directamente a <a href="mailto:vitrinaya983@gmail.com">vitrinaya983@gmail.com</a>.</p></noscript>
  </>;
}
