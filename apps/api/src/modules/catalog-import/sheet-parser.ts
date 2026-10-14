import ExcelJS from "exceljs";

export interface ParsedSheet {
  sheetName: string;
  /** Raw cell text, row-major; empty cells are "". Rows are NOT trimmed of leading blank rows. */
  rows: string[][];
}

export class SheetParseError extends Error {
  constructor(
    message: string,
    readonly code: "UNSUPPORTED_FORMAT" | "EMPTY_SHEET" | "CORRUPT_FILE" | "TOO_LARGE",
  ) {
    super(message);
  }
}

export const MAX_ROWS = 200_000;
export const MAX_COLS = 80;

export type SheetKind = "xlsx" | "csv" | "xls";

export function sheetKindFor(filename: string, mimeType?: string): SheetKind | null {
  const name = filename.toLowerCase();
  if (name.endsWith(".xlsx")) return "xlsx";
  if (name.endsWith(".csv") || name.endsWith(".txt") || mimeType === "text/csv") return "csv";
  if (name.endsWith(".xls")) return "xls";
  return null;
}

function cellToText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as any;
    if (Array.isArray(o.richText)) return o.richText.map((r: any) => r.text ?? "").join("").trim();
    if ("result" in o) return cellToText(o.result as ExcelJS.CellValue); // formula
    if (typeof o.text === "string") return o.text.trim(); // hyperlink
    if (typeof o.error === "string") return "";
  }
  return "";
}

export async function parseXlsx(buffer: Buffer): Promise<ParsedSheet> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch {
    throw new SheetParseError("Não foi possível ler a planilha. Verifique se o arquivo .xlsx não está corrompido.", "CORRUPT_FILE");
  }
  // First sheet that has any content (spec: "first sheet").
  const sheet = workbook.worksheets.find((w) => w.actualRowCount > 0) ?? workbook.worksheets[0];
  if (!sheet) throw new SheetParseError("A planilha está vazia.", "EMPTY_SHEET");
  const rows: string[][] = [];
  const colCount = Math.min(sheet.actualColumnCount || sheet.columnCount || 0, MAX_COLS);
  const rowCount = Math.min(sheet.rowCount, MAX_ROWS);
  for (let r = 1; r <= rowCount; r++) {
    const row = sheet.getRow(r);
    const out: string[] = [];
    for (let c = 1; c <= colCount; c++) out.push(cellToText(row.getCell(c).value));
    rows.push(out);
  }
  while (rows.length && rows[rows.length - 1].every((c) => c === "")) rows.pop();
  if (rows.length === 0) throw new SheetParseError("A planilha está vazia.", "EMPTY_SHEET");
  return { sheetName: sheet.name, rows };
}

/** UTF-8 (with or without BOM); falls back to latin1 when the bytes are not valid UTF-8 (older Brazilian ERPs). */
export function decodeCsv(buffer: Buffer): string {
  let text = buffer.toString("utf8");
  if (text.includes("�")) text = buffer.toString("latin1");
  return text.replace(/^﻿/, "");
}

export function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 10).filter(Boolean);
  const candidates = [";", ",", "\t", "|"];
  let best = ",";
  let bestScore = -1;
  for (const d of candidates) {
    const counts = sample.map((line) => parseCsvLine(line, d).length);
    if (counts.length === 0) continue;
    const modal = counts.sort((a, b) => a - b)[Math.floor(counts.length / 2)];
    const consistent = counts.filter((c) => c === modal).length;
    const score = modal > 1 ? consistent * 100 + modal : 0;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

/** Splits ONE physical line (quotes may not span lines here; multi-line cells are handled by parseCsv). */
function parseCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

export function parseCsv(buffer: Buffer): ParsedSheet {
  const text = decodeCsv(buffer);
  if (!text.trim()) throw new SheetParseError("O arquivo está vazio.", "EMPTY_SHEET");
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  // Quote-aware record splitting: a newline inside quotes belongs to the cell.
  let record = "";
  let quotes = 0;
  const flush = () => {
    if (record.length) rows.push(parseCsvLine(record, delimiter).slice(0, MAX_COLS).map((c) => c.trim()));
    record = "";
    quotes = 0;
  };
  for (const line of text.split(/\r?\n/)) {
    record = record ? `${record}\n${line}` : line;
    quotes += (line.match(/"/g) ?? []).length;
    if (quotes % 2 === 0) flush();
    if (rows.length > MAX_ROWS) throw new SheetParseError("A planilha tem linhas demais.", "TOO_LARGE");
  }
  flush();
  while (rows.length && rows[rows.length - 1].every((c) => c === "")) rows.pop();
  if (rows.length === 0) throw new SheetParseError("O arquivo está vazio.", "EMPTY_SHEET");
  return { sheetName: "CSV", rows };
}

export async function parseSheet(buffer: Buffer, filename: string, mimeType?: string): Promise<ParsedSheet> {
  const kind = sheetKindFor(filename, mimeType);
  if (kind === "xlsx") return parseXlsx(buffer);
  if (kind === "csv") return parseCsv(buffer);
  if (kind === "xls") {
    throw new SheetParseError('Arquivos .xls (Excel antigo) não são suportados. Abra no Excel e use "Salvar como" .xlsx ou .csv.', "UNSUPPORTED_FORMAT");
  }
  throw new SheetParseError("Formato não suportado. Envie um arquivo .xlsx ou .csv.", "UNSUPPORTED_FORMAT");
}
