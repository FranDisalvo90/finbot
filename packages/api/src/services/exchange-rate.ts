export async function fetchBlueRate(): Promise<number | null> {
  try {
    const res = await fetch("https://dolarapi.com/v1/dolares/blue");
    if (!res.ok) return null;
    const data = (await res.json()) as { venta: number };
    return data.venta;
  } catch {
    return null;
  }
}
