// Narrow declaration for the PDFKit APIs used here. No extra @types dependency is installed.
declare module "pdfkit" {
  import { Readable } from "node:stream";
  type TextOptions = { width?: number; align?: "left" | "right" | "center"; lineGap?: number };
  export class PDFDocument extends Readable {
    constructor(options?: { size?: string; margin?: number; bufferPages?: boolean; compress?: boolean; info?: { Title?: string; Author?: string; CreationDate?: Date } });
    y: number;
    page: { width: number; height: number; margins: { top: number; bottom: number; left: number; right: number } };
    font(name: string): this;
    fontSize(size: number): this;
    fillColor(color: string): this;
    text(value: string, x?: number, y?: number, options?: TextOptions): this;
    heightOfString(value: string, options?: TextOptions): number;
    image(bytes: Buffer, x: number, y: number, options?: { fit?: [number, number] }): this;
    moveTo(x: number, y: number): this;
    lineTo(x: number, y: number): this;
    strokeColor(color: string): this;
    stroke(): this;
    addPage(): this;
    bufferedPageRange(): { start: number; count: number };
    switchToPage(page: number): this;
    end(): void;
  }
}
