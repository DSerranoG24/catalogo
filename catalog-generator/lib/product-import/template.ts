import { strToU8, zipSync } from "fflate";
import { IMPORT_COLUMNS } from "./contracts";

const main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const relationships = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const packageRelationships = "http://schemas.openxmlformats.org/package/2006/relationships";
const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character] ?? character);
const inline = (reference: string, value: string, style = 1) => `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escape(value)}</t></is></c>`;
const notes = [
  "Nombre obligatorio. SKU identifica primero; sin coincidencia se busca el nombre sin distinguir mayúsculas, conservando acentos.",
  "SKU opcional y sensible a mayúsculas. TEXTO antes de escribir: 00123. También puedes escribir '00123. Un SKU numérico se rechaza; cambiar después el formato no recupera ceros.",
  "Nombre de una categoría existente en este catálogo. No se crean categorías. Vacío conserva la asociación al actualizar.",
  "Marca opcional. Vacío conserva el valor existente.",
  "Modelo opcional, guardado como texto para evitar conversiones de Excel. Vacío conserva el valor existente.",
  "Descripción opcional, hasta 2000 caracteres. Vacío conserva la descripción existente.",
  "Precio entero no negativo, en la misma unidad que el panel, sin símbolos. Obligatorio al crear; vacío conserva al actualizar.",
  "Inventario entero no negativo. Vacío crea con 0 o conserva al actualizar. Un 0 explícito fija cero.",
  "Vacío conserva. Sí exige una oferta válida. No NO elimina una promoción existente: se elimina desde el panel.",
  "Precio de oferta entero y menor al precio. Vacío conserva el valor existente al actualizar.",
  "TEXTO ISO 8601 con zona: 2026-11-01T09:00:00-05:00. Vacío conserva la fecha existente.",
  "TEXTO ISO 8601 con zona. Debe ser posterior al inicio. Vacío conserva la fecha existente.",
];
const instructions = [
  ["Plantilla de productos", "Completa únicamente la hoja Productos. Esta hoja nunca se importa."],
  ["Límite", "Hasta 500 filas de datos (filas 2 a 501). Solo .xlsx sin macros ni contraseña. Sin imágenes ni fórmulas."],
  ["Nombre", "Obligatorio. SKU tiene prioridad; si el SKU no existe pero el nombre sí, se actualiza ese producto y se asigna el SKU."],
  ["SKU: texto", "Mantén la columna como Texto ANTES de escribir o pegar. Ejemplo válido como texto: 00123."],
  ["Apóstrofo", "Al escribir en Excel puedes anteponer un apóstrofo: '00123. Excel lo guarda como texto 00123."],
  ["Ceros perdidos", "Si Excel ya guardó 123 como número, cambiar a Texto no recupera 00123. Reintroduce el código correcto. No uses un formato visual 00000."],
  ["SKU numérico", "Se informa error de fila. Nunca se convierte automáticamente, ni se inventan ceros o se ignora el código."],
  ["Precio e inventario", "Números enteros de 0 a 2147483647, sin moneda ni separadores escritos. Usa la misma unidad de precio que el panel."],
  ["Fechas", "Introduce texto ISO 8601 con zona: 2026-11-01T09:00:00-05:00. No uses fechas regionales ni números de serie de Excel."],
  ["Celdas vacías", "Al actualizar conservan precio, inventario, SKU, descripción, marca, modelo, categoría y cada dato de oferta. Para borrar valores usa el panel."],
  ["Creación", "Nombre y precio obligatorios. Inventario vacío crea con 0; categoría y demás datos opcionales pueden quedar vacíos."],
  ["Descuento", "Sí exige precio de oferta y fechas válidas. No NO elimina una promoción existente. Para quitarla usa el panel."],
  ["No y datos de oferta", "No junto con valores de oferta es contradictorio y produce error. Vacío no borra promociones."],
  ["Categorías", "Escribe el nombre de una categoría existente de tu catálogo. Desconocida o ambigua: error de fila. No se crea automáticamente."],
  ["Duplicados", "SKU: se recortan espacios y se distinguen mayúsculas. Nombre/categoría: se ignoran mayúsculas, se conservan acentos. Varias coincidencias: error."],
  ["Visibilidad", "Actualizar un producto inactivo no lo reactiva. No se importan slug, imágenes, identificadores ni visibilidad. No se borran productos."],
  ["Vista previa", "Revisa la clasificación de nuevos, actualizaciones y errores antes de confirmar. Las filas válidas pueden importarse aunque otras fallen."],
  ["Ejemplo (NO importable)", "Nombre: Vela ámbar | SKU (texto): 00123 | Precio: 25000 | Inventario: 10. Estos ejemplos viven solo aquí."],
];

/** Ready for a download button later; no DOM access, upload, or automatic download. */
export function createProductImportTemplate(): Uint8Array<ArrayBuffer> {
  const headers = IMPORT_COLUMNS.map(([name], column) => inline(`${String.fromCharCode(65 + column)}1`, name, 3)).join("");
  const columns = IMPORT_COLUMNS.map(([, field], column) => {
    const number = field === "price" || field === "stock" || field === "salePrice";
    return `<col min="${column + 1}" max="${column + 1}" width="${field === "description" ? 45 : 24}" customWidth="1" style="${number ? 2 : 1}"/>`;
  }).join("");
  // Explicit empty styled cells keep Text formatting visible to Excel and other readers,
  // rather than relying only on a column default for cells that do not yet exist.
  const emptyRows = Array.from({ length: 500 }, (_, index) => {
    const row = index + 2;
    return `<row r="${row}">${IMPORT_COLUMNS.map(([, field], column) => `<c r="${String.fromCharCode(65 + column)}${row}" s="${field === "price" || field === "stock" || field === "salePrice" ? 2 : 1}"/>`).join("")}</row>`;
  }).join("");
  const integerValidations = ["G", "H", "J"].map(column => `<dataValidation type="whole" operator="between" allowBlank="1" showErrorMessage="1" errorTitle="Entero requerido" error="Usa un entero de 0 a 2147483647" sqref="${column}2:${column}501"><formula1>0</formula1><formula2>2147483647</formula2></dataValidation>`).join("");
  const files: Record<string, string> = {
    "[Content_Types].xml": `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/comments1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml"/></Types>`,
    "_rels/.rels": `<Relationships xmlns="${packageRelationships}"><Relationship Id="rId1" Type="${relationships}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<workbook xmlns="${main}" xmlns:r="${relationships}"><bookViews><workbookView activeTab="0"/></bookViews><sheets><sheet name="Productos" sheetId="1" r:id="rId1"/><sheet name="Instrucciones" sheetId="2" r:id="rId2"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships xmlns="${packageRelationships}"><Relationship Id="rId1" Type="${relationships}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${relationships}/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="${relationships}/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": `<styleSheet xmlns="${main}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="49" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
    "xl/worksheets/sheet1.xml": `<worksheet xmlns="${main}" xmlns:r="${relationships}"><dimension ref="A1:L501"/><sheetViews><sheetView tabSelected="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${columns}</cols><sheetData><row r="1">${headers}</row>${emptyRows}</sheetData><autoFilter ref="A1:L501"/><dataValidations count="4">${integerValidations}<dataValidation type="list" allowBlank="1" showErrorMessage="1" error="Selecciona Sí, No o deja vacío" sqref="I2:I501"><formula1>"Sí,No"</formula1></dataValidation></dataValidations><legacyDrawing r:id="rId2"/></worksheet>`,
    "xl/worksheets/sheet2.xml": `<worksheet xmlns="${main}"><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="40"/><cols><col min="1" max="1" width="26" customWidth="1" style="1"/><col min="2" max="2" width="120" customWidth="1" style="1"/></cols><sheetData>${instructions.map(([title, detail], index) => `<row r="${index + 1}">${inline(`A${index + 1}`, title, 3)}${inline(`B${index + 1}`, detail)}</row>`).join("")}</sheetData></worksheet>`,
    "xl/worksheets/_rels/sheet1.xml.rels": `<Relationships xmlns="${packageRelationships}"><Relationship Id="rId1" Type="${relationships}/comments" Target="../comments1.xml"/><Relationship Id="rId2" Type="${relationships}/vmlDrawing" Target="../drawings/vmlDrawing1.vml"/></Relationships>`,
    "xl/comments1.xml": `<comments xmlns="${main}"><authors><author>Catálogo</author></authors><commentList>${notes.map((note, column) => `<comment ref="${String.fromCharCode(65 + column)}1" authorId="0"><text><t>${escape(note)}</t></text></comment>`).join("")}</commentList></comments>`,
    "xl/drawings/vmlDrawing1.vml": `<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="1"/></o:shapelayout><v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,xe"><v:stroke joinstyle="miter"/><v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype>${notes.map((_, column) => `<v:shape id="_x0000_s${1025 + column}" type="#_x0000_t202" style="position:absolute;width:250pt;height:90pt;visibility:hidden" fillcolor="#ffffe1" o:insetmode="auto"><v:fill color2="#ffffe1"/><v:shadow on="t" color="black" obscured="t"/><v:path o:connecttype="none"/><v:textbox style="mso-direction-alt:auto"><div style="text-align:left"/></v:textbox><x:ClientData ObjectType="Note"><x:MoveWithCells/><x:SizeWithCells/><x:AutoFill>False</x:AutoFill><x:Row>0</x:Row><x:Column>${column}</x:Column></x:ClientData></v:shape>`).join("")}</xml>`,
  };
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, content]) => [name, strToU8(declaration + content)])), { level: 6 });
}
