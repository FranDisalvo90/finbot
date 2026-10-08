import pdf from "pdf-parse";

export interface ParsedExpense {
  date: string; // YYYY-MM-DD
  description: string;
  amount: number;
  currency: "ARS" | "USD";
  installment: string | null;
  isFinancialCharge: boolean;
  sourceRef: string | null;
  rawLine: string;
}

const FINANCIAL_CHARGE_PATTERNS = [
  "GASTOS DE SERVICIO",
  "INTERESES FINANCIACION",
  "DB IVA",
  "IIBB PERCEP",
  "IVA RG",
  "DB.RG 5617",
];

// Argentine amount: 26.530,66 / 95,05 / -95,05 / 1.226.344,54
const ARG_AMOUNT = String.raw`-?\d{1,3}(?:\.\d{3})*,\d{2}`;

// Pure amount line (multi-line layout): "26.530,66"
const amountLineRegex = new RegExp(`^${ARG_AMOUNT}$`);

// Comprobante (6 digits) glued to the amount, at end of a line. pdf-parse emits this when
// the whole movement fits on one line: "PROPINA*RAPPI 0092553.660,00" → 009255 + 3.660,00.
// Also appears alone on the line after a USD expense: "2772212,97" → 277221 + 2,97.
const comboRegex = new RegExp(String.raw`(?:^|\s)(\d{6})(${ARG_AMOUNT})\s*$`);

// Amount at the end of a financial charge line: "GASTOS DE SERVICIO EMINENT 68.347,11"
// or "INTERESES FINANCIACION    $ 10.257,53"
const trailingAmountRegex = new RegExp(String.raw`\$?\s*(${ARG_AMOUNT})\s*$`);

// Expense start line: DD-MM-YY followed by optional type char and description
// Examples:
//   19-05-25*ASSISTCARD 10/12
//   05-02-26*TUENTI RECARGAS DCP
//   14-02-26FPADDLE.NET* HTTP          USD        3,12
//   15-02-26KMERPAGO*MELI
//   06-02-26 GASTOS DE SERVICIO EMINENT 61.570,25
const dateLineRegex = /^(\d{2}-\d{2}-\d{2})\s?([*FK]?)\s*(.+)$/;

// USD inline pattern: "USD  3,12" in description
const usdInlineRegex = /USD\s+([\d.,]+)/;

// Convert Argentine number format: 26.530,66 → 26530.66
function parseArgNumber(str: string): number {
  return Number(str.replace(/\./g, "").replace(",", "."));
}

// Convert DD-MM-YY to YYYY-MM-DD
function parseDate(dateStr: string): string {
  const [dd, mm, yy] = dateStr.split("-");
  const year = Number(yy) < 50 ? `20${yy}` : `19${yy}`;
  return `${year}-${mm}-${dd}`;
}

function cleanDescription(str: string): string {
  return str.replace(/\s+/g, " ").trim();
}

// Splits "...description 0092553.660,00" into { rest: "...description", sourceRef, amount }
function splitCombo(str: string): { rest: string; sourceRef: string; amount: number } | null {
  const m = str.match(comboRegex);
  if (!m || m.index === undefined) return null;
  return { rest: str.slice(0, m.index), sourceRef: m[1], amount: parseArgNumber(m[2]) };
}

export interface ParsedStatement {
  expenses: ParsedExpense[];
  dueDate: string | null; // YYYY-MM-DD — payment due date ("vencimiento") of the statement
}

export async function parseVisaGaliciaPDF(buffer: Buffer): Promise<ParsedStatement> {
  const data = await pdf(buffer);
  return { expenses: parseVisaGaliciaText(data.text), dueDate: extractVisaDueDate(data.text) };
}

const SPANISH_MONTHS: Record<string, string> = {
  ene: "01", feb: "02", mar: "03", abr: "04", may: "05", jun: "06",
  jul: "07", ago: "08", sep: "09", oct: "10", nov: "11", dic: "12",
};

// The statement header lists cierre/vencimiento dates as "DD-Mon-YY". pdf-parse glues the
// previous and next period dates together ("20-Ago-2601-Sep-2624-Sep-26"), while the current
// payment due date is the only one that comes out alone on its line ("05-Oct-26").
export function extractVisaDueDate(text: string): string | null {
  for (const raw of text.split("\n")) {
    const m = raw.trim().match(/^(\d{2})-([A-Za-z]{3})-(\d{2})$/);
    if (!m) continue;
    const month = SPANISH_MONTHS[m[2].toLowerCase()];
    if (!month) continue;
    return `20${m[3]}-${month}-${m[1]}`;
  }
  return null;
}

export function parseVisaGaliciaText(text: string): ParsedExpense[] {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const expenses: ParsedExpense[] = [];

  // Find the start of expense section
  let startIdx = lines.findIndex(
    (l) => l.includes("FECHAREFERENCIACUOTACOMPROBANTE") || l.includes("DETALLE DEL CONSUMO"),
  );
  if (startIdx === -1) {
    console.log("[visa-parser] Could not find expense section");
    return [];
  }
  // Skip header line(s)
  startIdx++;
  if (lines[startIdx]?.includes("FECHAREFERENCIACUOTA")) startIdx++;

  let i = startIdx;
  while (i < lines.length) {
    const line = lines[i];

    // Stop at final total
    if (line.startsWith("TOTAL A PAGAR")) break;
    // Skip TARJETA summary lines but continue parsing (charges come after)
    if (line.startsWith("TARJETA")) {
      i++;
      continue;
    }

    const dateMatch = line.match(dateLineRegex);
    if (!dateMatch) {
      i++;
      continue;
    }

    const [, dateStr, , rest] = dateMatch;
    const date = parseDate(dateStr);

    // Check if it's a financial charge (single line with amount at end)
    const isFinancialCharge = FINANCIAL_CHARGE_PATTERNS.some((p) => rest.toUpperCase().includes(p));

    // Check for inline USD amount
    const usdMatch = rest.match(usdInlineRegex);

    if (isFinancialCharge) {
      // "GASTOS DE SERVICIO EMINENT 61.570,25" / "INTERESES FINANCIACION    $ 10.257,53"
      const chargeAmountMatch = rest.match(trailingAmountRegex);
      if (chargeAmountMatch) {
        const description = cleanDescription(rest.slice(0, chargeAmountMatch.index));
        expenses.push({
          date,
          description,
          amount: parseArgNumber(chargeAmountMatch[1]),
          currency: "ARS",
          installment: null,
          isFinancialCharge: true,
          sourceRef: null,
          rawLine: line,
        });
      }
      i++;
      continue;
    }

    if (usdMatch) {
      // USD expense with inline amount: "PADDLE.NET* HTTP  USD 3,12"
      // The comprobante+amount combo ("3700093,12") is either glued at the end of the same
      // line or on the next line.
      const usdAmount = parseArgNumber(usdMatch[1]);
      let descriptionRaw = rest.replace(usdInlineRegex, "");
      let sourceRef: string | null = null;

      const inlineCombo = splitCombo(descriptionRaw);
      if (inlineCombo) {
        sourceRef = inlineCombo.sourceRef;
        descriptionRaw = inlineCombo.rest;
      } else if (i + 1 < lines.length) {
        const nextCombo = splitCombo(lines[i + 1]);
        if (nextCombo && nextCombo.rest === "") {
          sourceRef = nextCombo.sourceRef;
          i++; // skip this line
        }
      }

      expenses.push({
        date,
        description: cleanDescription(descriptionRaw),
        amount: usdAmount,
        currency: "USD",
        installment: null,
        isFinancialCharge: false,
        sourceRef,
        rawLine: line,
      });
      i++;
      continue;
    }

    // Regular ARS expense — description may include installment
    // "ASSISTCARD 10/12" or "TUENTI RECARGAS DCP"
    let descriptionRaw = rest;
    let sourceRef: string | null = null;
    let amount: number | null = null;

    // Single-line layout: comprobante+amount glued at the end of the same line
    const inlineCombo = splitCombo(descriptionRaw);
    if (inlineCombo) {
      sourceRef = inlineCombo.sourceRef;
      amount = inlineCombo.amount;
      descriptionRaw = inlineCombo.rest;
    } else {
      // Multi-line layout: next line(s) are comprobante, then amount
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        const nextLine = lines[j];

        // Pure comprobante: 6 digits
        if (/^\d{6}$/.test(nextLine)) {
          sourceRef = nextLine;
          continue;
        }

        // Pure amount: "26.530,66"
        if (amountLineRegex.test(nextLine)) {
          amount = parseArgNumber(nextLine);
          i = j; // advance past consumed lines
          break;
        }

        // If we hit another date line or stop marker, break
        if (
          dateLineRegex.test(nextLine) ||
          nextLine.startsWith("TARJETA") ||
          nextLine.startsWith("TOTAL")
        ) {
          break;
        }
      }
    }

    const installmentMatch = descriptionRaw.match(/(\d+\/\d+)\s*$/);
    const installment = installmentMatch ? installmentMatch[1] : null;
    const description = installment
      ? descriptionRaw.slice(0, installmentMatch!.index)
      : descriptionRaw;

    if (amount !== null) {
      expenses.push({
        date,
        description: cleanDescription(description.replace(/^[*FK]\s*/, "")),
        amount,
        currency: "ARS",
        installment,
        isFinancialCharge: false,
        sourceRef,
        rawLine: line,
      });
    }

    i++;
  }

  const result = removeCancelledPairs(expenses);
  console.log(`[visa-parser] parsed ${result.length} expenses`);
  return result;
}

// A charge and its reversal (same description, currency and absolute amount, opposite sign)
// cancel each other out, so neither is worth importing. Unmatched negatives are real refunds.
function removeCancelledPairs(expenses: ParsedExpense[]): ParsedExpense[] {
  const dropped = new Set<number>();
  expenses.forEach((reversal, ri) => {
    if (reversal.amount >= 0 || dropped.has(ri)) return;
    const ci = expenses.findIndex(
      (charge, idx) =>
        !dropped.has(idx) &&
        charge.amount > 0 &&
        charge.currency === reversal.currency &&
        charge.description === reversal.description &&
        Math.abs(charge.amount + reversal.amount) < 0.005,
    );
    if (ci === -1) return;
    dropped.add(ri);
    dropped.add(ci);
  });
  return expenses.filter((_, idx) => !dropped.has(idx));
}
