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
  "DB IVA",
  "IIBB PERCEP",
  "IVA RG",
  "DB.RG 5617",
];

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

export async function parseVisaGaliciaPDF(
  buffer: Buffer
): Promise<ParsedExpense[]> {
  const data = await pdf(buffer);
  const lines = data.text.split("\n").map((l) => l.trim()).filter(Boolean);
  const expenses: ParsedExpense[] = [];

  // Find the start of expense section
  let startIdx = lines.findIndex((l) =>
    l.includes("FECHAREFERENCIACUOTACOMPROBANTE") || l.includes("DETALLE DEL CONSUMO")
  );
  if (startIdx === -1) {
    console.log("[visa-parser] Could not find expense section");
    return [];
  }
  // Skip header line(s)
  startIdx++;
  if (lines[startIdx]?.includes("FECHAREFERENCIACUOTA")) startIdx++;

  // Regex for expense start line: DD-MM-YY followed by optional type char and description
  // Examples:
  //   19-05-25*ASSISTCARD 10/12
  //   05-02-26*TUENTI RECARGAS DCP
  //   14-02-26FPADDLE.NET* HTTP          USD        3,12
  //   15-02-26KMERPAGO*MELI
  //   06-02-26 GASTOS DE SERVICIO EMINENT 61.570,25
  const dateLineRegex = /^(\d{2}-\d{2}-\d{2})\s?([*FK]?)\s*(.+)$/;

  // Amount pattern
  const amountRegex = /^([\d.]+,\d{2})$/;

  // USD inline pattern: "USD  3,12" in description
  const usdInlineRegex = /USD\s+([\d.,]+)/;

  let i = startIdx;
  while (i < lines.length) {
    const line = lines[i];

    // Stop at final total
    if (line.startsWith("TOTAL A PAGAR")) break;
    // Skip TARJETA summary lines but continue parsing (charges come after)
    if (line.startsWith("TARJETA")) { i++; continue; }

    const dateMatch = line.match(dateLineRegex);
    if (!dateMatch) {
      i++;
      continue;
    }

    const [, dateStr, , rest] = dateMatch;
    const date = parseDate(dateStr);

    // Check if it's a financial charge (single line with amount at end)
    const isFinancialCharge = FINANCIAL_CHARGE_PATTERNS.some((p) =>
      rest.toUpperCase().includes(p)
    );

    // Check for inline USD amount
    const usdMatch = rest.match(usdInlineRegex);

    if (isFinancialCharge) {
      // Financial charges: "GASTOS DE SERVICIO EMINENT 61.570,25"
      const chargeAmountMatch = rest.match(/([\d.]+,\d{2})\s*$/);
      if (chargeAmountMatch) {
        const description = rest.replace(chargeAmountMatch[0], "").trim();
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
      // Next line is comprobante+amount combined like "3700093,12"
      const description = rest.replace(usdInlineRegex, "").replace(/\s+/g, " ").trim();
      const usdAmount = parseArgNumber(usdMatch[1]);

      // Try to extract comprobante from next line
      let sourceRef: string | null = null;
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1];
        // Pattern: "3700093,12" — comprobante digits followed by amount
        const comboMatch = nextLine.match(/^(\d{6})([\d.,]+)$/);
        if (comboMatch) {
          sourceRef = comboMatch[1];
          i++; // skip this line
        }
      }

      expenses.push({
        date,
        description,
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
    const installmentMatch = rest.match(/(\d+\/\d+)\s*$/);
    const installment = installmentMatch ? installmentMatch[1] : null;
    const description = installment
      ? rest.replace(installmentMatch![0], "").trim()
      : rest.trim();

    // Next line(s): comprobante, then amount
    let sourceRef: string | null = null;
    let amount: number | null = null;

    // Look ahead for comprobante and amount
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      const nextLine = lines[j];

      // Pure comprobante: 6 digits
      if (/^\d{6}$/.test(nextLine)) {
        sourceRef = nextLine;
        continue;
      }

      // Pure amount: "26.530,66"
      if (amountRegex.test(nextLine)) {
        amount = parseArgNumber(nextLine);
        i = j; // advance past consumed lines
        break;
      }

      // If we hit another date line or stop marker, break
      if (dateLineRegex.test(nextLine) || nextLine.startsWith("TARJETA") || nextLine.startsWith("TOTAL")) {
        break;
      }
    }

    if (amount !== null) {
      expenses.push({
        date,
        description: description.replace(/^[*FK]\s*/, ""),
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

  console.log(`[visa-parser] parsed ${expenses.length} expenses`);
  return expenses;
}
