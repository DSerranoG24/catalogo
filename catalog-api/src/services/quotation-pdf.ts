import { PDFDocument } from "pdfkit";
import { quotationLabel, QUOTATION_VALIDITY_DAYS, QuotationSeller } from "./quotation-data";

export type QuotationDocument = {
  number: number;
  issuedAt: Date;
  seller: QuotationSeller;
  customerName: string;
  customerPhone: string;
  customerAddress: string | null;
  total: number;
  items: { productName: string; quantity: number; unitPrice: number; subtotal: number }[];
};

const money = (amount: number) => `${amount.toLocaleString("es-CO")} COP`;
const date = (value: Date) => new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", dateStyle: "medium", timeStyle: "short" }).format(value);
// The built-in print font covers Spanish/Latin text; remove control and unsupported glyphs.
const printable = (value: string) => value.normalize("NFC").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").replace(/[^\u0020-\u00ff\n\t]/gu, "?");

export async function generateQuotationPdf(data: QuotationDocument, logo?: Buffer): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 48, bufferPages: true, info: {
    Title: quotationLabel(data.number), Author: printable(data.seller.name), CreationDate: data.issuedAt,
  } });
  const chunks: Buffer[] = [];
  let size = 0;
  const completed = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 8 * 1024 * 1024) doc.destroy(new Error("QUOTATION_TOO_LARGE"));
      else chunks.push(chunk);
    });
    doc.once("error", reject);
    doc.once("end", () => resolve(Buffer.concat(chunks)));
  });
  try {
    if (logo) {
      try { doc.image(logo, 447, 48, { fit: [100, 65] }); }
      catch { /* An invalid current logo must not prevent issuance. */ }
    }
    doc.fillColor("#173f36").font("Helvetica-Bold").fontSize(20).text("COTIZACIÓN", 48, 48, { width: 380 });
    doc.fontSize(16).text(quotationLabel(data.number), 48, 76, { width: 380 });
    doc.font("Helvetica").fontSize(10).fillColor("#333333");
    let y = 120;
    const line = (text: string, bold = false) => {
      const value = printable(text);
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(10);
      const height = doc.heightOfString(value, { width: 499, lineGap: 3 });
      if (y + height > 760) { doc.addPage(); y = 48; }
      doc.text(value, 48, y, { width: 499, lineGap: 3 });
      y = doc.y + 7;
    };
    line("Solicitud sujeta a confirmación", true);
    line(`Emisión: ${date(data.issuedAt)} (hora de Colombia)`);
    const validUntil = new Date(data.issuedAt.getTime() + QUOTATION_VALIDITY_DAYS * 86400000);
    line(`Validez: ${QUOTATION_VALIDITY_DAYS} días, hasta ${date(validUntil)}.`);
    line(data.seller.name, true);
    const fields: [string, string | null][] = [
      ["NIT", data.seller.nit], ["Teléfono", data.seller.phone], ["WhatsApp", data.seller.whatsappPhone],
      ["Dirección", data.seller.address], ["Horario", data.seller.businessHours], ["Correo", data.seller.email],
      ["Instagram", data.seller.instagramUrl], ["Facebook", data.seller.facebookUrl], ["TikTok", data.seller.tiktokUrl],
    ];
    for (const [label, value] of fields) if (value) line(`${label}: ${value}`);
    y += 10;
    line("CLIENTE", true);
    line(data.customerName);
    line(`Teléfono: ${data.customerPhone}`);
    if (data.customerAddress) line(`Dirección: ${data.customerAddress}`);
    y += 10;
    const tableHeader = () => {
      line("DETALLE DE PRODUCTOS", true);
      doc.fontSize(9).font("Helvetica-Bold");
      doc.text("Producto", 48, y, { width: 220 });
      doc.text("Cant.", 278, y, { width: 35 });
      doc.text("Precio unitario", 316, y, { width: 110, align: "right" });
      doc.text("Subtotal", 432, y, { width: 115, align: "right" });
      y += 23;
    };
    if (y > 700) { doc.addPage(); y = 48; }
    tableHeader();
    for (const item of data.items) {
      doc.font("Helvetica").fontSize(9);
      const name = printable(item.productName);
      const height = Math.max(24, doc.heightOfString(name, { width: 220 }) + 12);
      if (y + height > 750) { doc.addPage(); y = 48; tableHeader(); doc.font("Helvetica").fontSize(9); }
      doc.text(name, 48, y, { width: 220 });
      doc.text(String(item.quantity), 278, y, { width: 35 });
      doc.text(money(item.unitPrice), 316, y, { width: 110, align: "right" });
      doc.text(money(item.subtotal), 432, y, { width: 115, align: "right" });
      y += height;
      doc.strokeColor("#dddddd").moveTo(48, y - 5).lineTo(547, y - 5).stroke();
    }
    y += 10;
    line(`TOTAL: ${money(data.total)}`, true);
    if (data.seller.quotationTerms) { y += 10; line("CONDICIONES", true); line(data.seller.quotationTerms); }
    line("La disponibilidad y la entrega deben confirmarse con el vendedor.");
    const pages = doc.bufferedPageRange();
    for (let page = pages.start; page < pages.start + pages.count; page++) {
      doc.switchToPage(page);
      doc.font("Helvetica").fontSize(8).fillColor("#666666").text(`${quotationLabel(data.number)} · ${page + 1}/${pages.count}`, 48, 780, { width: 499, align: "center" });
    }
    doc.end();
  } catch (error) { doc.destroy(error instanceof Error ? error : new Error("QUOTATION_GENERATION_FAILED")); }
  return completed;
}
