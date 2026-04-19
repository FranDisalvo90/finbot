export function computeDualAmounts(
  amount: number,
  currency: string,
  rate: number | null,
): { amountArs: string; amountUsd: string } {
  const amountArs = rate
    ? currency === "ARS"
      ? String(amount)
      : String(+(amount * rate).toFixed(2))
    : "0";
  const amountUsd = rate
    ? currency === "USD"
      ? String(amount)
      : String(+(amount / rate).toFixed(2))
    : "0";
  return { amountArs, amountUsd };
}
