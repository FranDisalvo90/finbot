import { describe, it, expect } from "vitest";
import { parseVisaGaliciaText } from "../visa-galicia.js";

// Builds a statement body around the given movement lines, mimicking pdf-parse output.
function statement(lines: string[]): string {
  return ["DETALLE DEL CONSUMO  ", "FECHAREFERENCIACUOTACOMPROBANTEPESOSDÓLARES", ...lines, "TOTAL A PAGAR", "1,00"].join("\n");
}

describe("parseVisaGaliciaText", () => {
  it("parses the multi-line layout (description / comprobante / amount on separate lines)", () => {
    const res = parseVisaGaliciaText(statement(["18-04-26*MERPAGO*MERCADOLIBRE 06/06", "855221", "43.333,00", " "]));
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({
      date: "2026-04-18",
      description: "MERPAGO*MERCADOLIBRE",
      amount: 43333,
      currency: "ARS",
      installment: "06/06",
      sourceRef: "855221",
      isFinancialCharge: false,
    });
  });

  it("parses the single-line ARS layout where comprobante and amount are glued together", () => {
    const res = parseVisaGaliciaText(
      statement([
        "04-09-26KPROPINA*RAPPI 0092553.660,00 ",
        "13-09-26KMERPAGO*MELI 17094113.990,00 ",
        "04-09-26*DLO*RAPPI 00291395,05 ",
        "17-09-26*TESORERIA GENERAL DE LA P 0005435.250,00 ",
      ]),
    );
    expect(res.map((e) => [e.description, e.sourceRef, e.amount])).toEqual([
      ["PROPINA*RAPPI", "009255", 3660],
      ["MERPAGO*MELI", "170941", 13990],
      ["DLO*RAPPI", "002913", 95.05],
      ["TESORERIA GENERAL DE LA P", "000543", 5250],
    ]);
    expect(res.every((e) => e.currency === "ARS" && !e.isFinancialCharge)).toBe(true);
  });

  it("drops a charge and its reversal when they cancel each other out", () => {
    const res = parseVisaGaliciaText(
      statement([
        "04-09-26KPROPINA*RAPPI 0092553.660,00 ",
        "04-09-26*DLO*RAPPI 00291395,05 ",
        "04-09-26 DLO*RAPPI 000183-95,05 ",
        "07-09-26KRAPPI 00827313.560,00 ",
      ]),
    );
    expect(res.map((e) => [e.description, e.amount])).toEqual([
      ["PROPINA*RAPPI", 3660],
      ["RAPPI", 13560],
    ]);
  });

  it("keeps a negative amount that has no matching charge (a real refund)", () => {
    const res = parseVisaGaliciaText(statement(["04-09-26 DLO*RAPPI 000183-95,05 "]));
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ description: "DLO*RAPPI", sourceRef: "000183", amount: -95.05 });
  });

  it("parses a single-line ARS expense with installment before the comprobante", () => {
    const res = parseVisaGaliciaText(statement(["18-04-26*MERPAGO*MERCADOLIBRE 06/06 85522143.333,00 "]));
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({
      description: "MERPAGO*MERCADOLIBRE",
      installment: "06/06",
      sourceRef: "855221",
      amount: 43333,
    });
  });

  it("parses USD expenses on a single line, keeping the comprobante out of the description", () => {
    const res = parseVisaGaliciaText(
      statement([
        "20-09-26FSpotify                   USD        4,01 5815084,01",
        "16-09-26KNETFLIX.COM      jtLvlMxWPUSD       10,05 35039310,05",
        "13-09-26 PARAMOUNT+       116179918USD        3,73 7203443,73",
      ]),
    );
    expect(res.map((e) => [e.description, e.sourceRef, e.amount, e.currency])).toEqual([
      ["Spotify", "581508", 4.01, "USD"],
      ["NETFLIX.COM jtLvlMxWP", "350393", 10.05, "USD"],
      ["PARAMOUNT+ 116179918", "720344", 3.73, "USD"],
    ]);
  });

  it("still parses USD expenses whose comprobante+amount is on the next line", () => {
    const res = parseVisaGaliciaText(statement(["20-08-26FSpotify                   USD        2,97 ", "2772212,97"]));
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ description: "Spotify", sourceRef: "277221", amount: 2.97, currency: "USD" });
  });

  it("parses INTERESES FINANCIACION as a financial charge (amount prefixed with $)", () => {
    const res = parseVisaGaliciaText(
      statement([
        "07-09-26 GASTOS DE SERVICIO EMINENT 68.347,11",
        " ",
        "24-09-26 INTERESES FINANCIACION    $ 10.257,53 ",
        "24-09-26 DB IVA $ 21%                            78.604,64 16.506,97 ",
      ]),
    );
    expect(res.map((e) => [e.description, e.amount, e.isFinancialCharge])).toEqual([
      ["GASTOS DE SERVICIO EMINENT", 68347.11, true],
      ["INTERESES FINANCIACION", 10257.53, true],
      ["DB IVA $ 21% 78.604,64", 16506.97, true],
    ]);
  });

  it("ignores TARJETA subtotal lines and keeps parsing after them", () => {
    const res = parseVisaGaliciaText(
      statement([
        "18-05-26*MERPAGO*VACUNAR 05/06",
        "000694",
        "75.656,77",
        " ",
        "TARJETA 3477 Total Consumos de X 75.656,770,00",
        "07-09-26*TUENTI RECARGAS DCP ",
        "008868",
        "4.600,00",
      ]),
    );
    expect(res.map((e) => e.amount)).toEqual([75656.77, 4600]);
  });
});
