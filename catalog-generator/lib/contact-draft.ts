export function contactDraft(fields: { name: string; email: string; message: string }): string {
  const name = fields.name.trim(), email = fields.email.trim(), message = fields.message.trim();
  if (!name || name.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || /[\r\n]/.test(email) || !message || message.length > 4000) throw new Error("Revisa el nombre, el correo y el mensaje.");
  const body = `Consulta para Vitrinaya\n\nNombre: ${name}\nCorreo de respuesta: ${email}\n\n${message}`;
  const encoded = btoa(Array.from(new TextEncoder().encode(body), byte => String.fromCharCode(byte)).join(""));
  return ["X-Unsent: 1", "To: vitrinaya983@gmail.com", "Subject: Consulta para Vitrinaya", "MIME-Version: 1.0", 'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64", "", ...(encoded.match(/.{1,76}/g) ?? []), ""].join("\r\n");
}
