/**
 * Writes the sample spreadsheets used to test the catalog import:
 *   docs/pharmacy/sample-catalog/estoque-exemplo-A.xlsx   (title rows above the header, EAN, tarja column, cost column, "12,90" prices)
 *   docs/pharmacy/sample-catalog/estoque-exemplo-B.csv    (semicolon CSV, SKU, no class column, "R$ 9,90" prices, accents)
 * Both mix rows that already exist in the demo catalog (updated price/stock), new rows, and traps:
 * a controlled substance labelled "Venda livre" (must stay controlled) and an unknown product.
 *   pnpm --filter @realwise/api sample:catalog
 */
import ExcelJS from "exceljs";
import { mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";

const OUT = resolve(__dirname, "../../../docs/pharmacy/sample-catalog");
mkdirSync(OUT, { recursive: true });

async function xlsxA() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Estoque");
  ws.addRow(["FARMÁCIA EXEMPLO LTDA"]);
  ws.addRow(["Relatório de posição de estoque - gerado pelo sistema de gestão"]);
  ws.addRow([]);
  ws.addRow(["Código de Barras", "Descrição", "Fabricante", "Apresentação", "Preço Venda", "Preço Custo", "Estoque", "Tarja"]);
  const rows: Array<[string, string, string, string, string, string, number, string]> = [
    // existing demo products: price/stock update
    ["7891000100011", "Dipirona Sódica 500mg", "EMS", "30 comprimidos", "13,50", "7,10", 150, "Venda Livre"],
    ["7891000100042", "Paracetamol 750mg", "EMS", "20 comprimidos", "16,40", "8,00", 180, "Venda Livre"],
    ["7891000200014", "Amoxicilina 500mg", "EMS", "21 cápsulas", "41,90", "22,00", 38, "Tarja Vermelha"],
    // new products
    ["7891000500015", "Ácido Fólico 5mg", "Medley", "30 comprimidos", "9,90", "4,50", 60, "Venda Livre"],
    ["7891000500022", "Simeticona 40mg", "EMS", "20 comprimidos", "10,50", "4,90", 85, "Venda Livre"],
    ["7891000500039", "Vitamina D 2000UI", "Vitafor", "30 cápsulas", "34,90", "17,00", 40, "Venda Livre"],
    ["7891000500046", "Dramin B6", "Takeda", "10 comprimidos", "16,90", "8,50", 0, "Venda Livre"],
    ["7891000500053", "Diazepam 10mg", "Teuto", "30 comprimidos", "18,90", "9,00", 20, "Tarja Preta"],
    ["7891000500060", "Cefalexina 500mg", "Medley", "8 cápsulas", "31,90", "15,00", 25, "Tarja Vermelha"],
    // trap: controlled substance mislabelled as free sale -> the app must still propose "controlled"
    ["7891000500077", "Clonazepam 0,5mg", "Cristália", "30 comprimidos", "12,90", "5,00", 30, "Venda Livre"],
    // trap: no tarja information and unknown product
    ["7891000500084", "Gel Reumon Massagem", "Mantecorp", "bisnaga 60g", "27,90", "13,00", 18, ""],
  ];
  for (const r of rows) ws.addRow(r);
  ws.addRow([]);
  ws.addRow(["Total de itens", rows.length]);
  await wb.xlsx.writeFile(resolve(OUT, "estoque-exemplo-A.xlsx"));
}

function csvB() {
  const lines = [
    "SKU;Produto;Princípio Ativo;Laboratório;Valor;Qtd;Categoria",
    "A100;Dipirona Gotas 500mg/ml 20ml;dipirona;Medley;R$ 9,40;70;Analgésicos",
    "A101;Ibuprofeno 600mg 10 comprimidos;ibuprofeno;EMS;R$ 14,90;55;Anti-inflamatórios",
    "A102;Losartana Potássica 50mg 30 comprimidos;losartana;EMS;R$ 15,40;100;Pressão",
    "A103;Sertralina 50mg 30 comprimidos;sertralina;EMS;R$ 29,90;24;Antidepressivos",
    "A104;Dexclorfeniramina 2mg 20 comprimidos;dexclorfeniramina;Teuto;R$ 8,90;45;Alergia",
    "A105;Hidratante Corporal 200ml;;Nivea;R$ 21,90;33;Dermocosméticos",
    "A106;Máscara Descartável 50 unidades;;Descarpack;R$ 19,90;60;Higiene",
    "A107;Colírio Lubrificante 10ml;carmelose;Allergan;R$ 24,50;0;Olhos",
    "A108;Nimesulida 100mg 12 comprimidos;nimesulida;EMS;R$ 13,90;40;Anti-inflamatórios",
  ];
  writeFileSync(resolve(OUT, "estoque-exemplo-B.csv"), lines.join("\n") + "\n", "utf8");
}

xlsxA()
  .then(() => csvB())
  .then(() => console.log(`Wrote sample sheets to ${OUT}`));
