import { useState, useCallback, useMemo } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, CheckCircle, Loader2 } from "lucide-react";
import { formatMoney } from "../lib/api";

interface PreviewExpense {
  date: string;
  description: string;
  amount: number;
  currency: string;
  installment: string | null;
  isFinancialCharge: boolean;
}

interface UploadResult {
  previewId: string;
  source: string;
  fileName: string;
  months: string[];
  count: number;
  expenses: PreviewExpense[];
  exchangeRate: number | null;
}

interface ConfirmResult {
  total: number;
  categorizedByRules: number;
  categorizedByAI: number;
  pending: number;
}

const MONTH_NAMES = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
];

function formatMonth(month: string): string {
  const [y, m] = month.split("-");
  return `${MONTH_NAMES[Number(m) - 1]} ${y}`;
}

export default function Import() {
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [preview, setPreview] = useState<UploadResult | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string>("");
  const [result, setResult] = useState<ConfirmResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paymentMonth, setPaymentMonth] = useState("");
  const [exchangeRate, setExchangeRate] = useState<string>("");

  const onDrop = useCallback(async (files: File[]) => {
    const file = files[0];
    if (!file) return;

    setUploading(true);
    setError(null);
    setResult(null);
    setSelectedMonth("");

    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/import/upload", {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error);
      }
      const data: UploadResult = await res.json();
      setPreview(data);
      setExchangeRate(data.exchangeRate ? String(data.exchangeRate) : "");
      if (data.months.length > 0) {
        const latest = data.months[data.months.length - 1];
        if (data.source === "visa_galicia") {
          // For credit cards: no month filter, default payment month = current month
          setSelectedMonth("");
          const now = new Date();
          setPaymentMonth(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
        } else {
          setSelectedMonth(latest);
          setPaymentMonth("");
        }
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }, []);

  const paymentMonthOptions = useMemo(() => {
    if (!preview || preview.source !== "visa_galicia") return [];
    const now = new Date();
    const options: string[] = [];
    // Current month + 3 months back
    for (let i = 3; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      options.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
    return options;
  }, [preview]);

  const filteredExpenses = useMemo(() => {
    if (!preview) return [];
    if (preview.source === "visa_galicia") return preview.expenses;
    if (!selectedMonth) return preview.expenses;
    return preview.expenses.filter(
      (e) => e.date.substring(0, 7) === selectedMonth
    );
  }, [preview, selectedMonth]);

  const confirm = async () => {
    if (!preview) return;
    setConfirming(true);
    setError(null);
    try {
      const res = await fetch("/api/import/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          previewId: preview.previewId,
          exchangeRate: exchangeRate ? Number(exchangeRate) : undefined,
          ...(preview.source === "visa_galicia"
            ? { overrideMonth: paymentMonth }
            : { month: selectedMonth || undefined }),
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error);
      }
      setResult(await res.json());
      setPreview(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Confirmation failed");
    } finally {
      setConfirming(false);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/pdf": [".pdf"],
      "text/csv": [".csv"],
    },
    maxFiles: 1,
  });

  return (
    <div className="space-y-6 max-w-4xl">
      <h2 className="text-xl font-semibold text-white">Importar gastos</h2>

      {/* Dropzone */}
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors ${
          isDragActive
            ? "border-blue-500 bg-blue-500/10"
            : "border-dark-border hover:border-gray-500"
        }`}
      >
        <input {...getInputProps()} />
        {uploading ? (
          <Loader2 className="mx-auto animate-spin text-blue-500" size={40} />
        ) : (
          <>
            <Upload className="mx-auto text-gray-500 mb-3" size={40} />
            <p className="text-gray-400">
              Arrastrá un archivo PDF (VISA Galicia) o CSV (Splitwise)
            </p>
          </>
        )}
      </div>

      {error && (
        <div className="bg-red-900/20 border border-red-800 rounded-lg p-3 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="bg-green-900/20 border border-green-800 rounded-xl p-4 space-y-1">
          <div className="flex items-center gap-2 text-green-400 font-medium">
            <CheckCircle size={18} />
            Importación completada
          </div>
          <p className="text-sm text-gray-400">
            {result.total} gastos importados, {result.categorizedByRules + result.categorizedByAI}{" "}
            categorizados, {result.pending} pendientes
          </p>
        </div>
      )}

      {/* Preview */}
      {preview && (
        <div className="space-y-4">
          {/* Header: info + month selector + confirm */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <p className="text-sm text-gray-400">
                <span className="text-white font-medium">{preview.count}</span>{" "}
                gastos en{" "}
                <span className="text-white">{preview.fileName}</span> (
                {preview.source === "visa_galicia" ? "VISA Galicia" : "Splitwise"})
              </p>

              {preview.source === "visa_galicia" ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-400">Imputar a:</span>
                  <select
                    value={paymentMonth}
                    onChange={(e) => setPaymentMonth(e.target.value)}
                    className="bg-dark-bg border border-dark-border rounded-lg px-3 py-1.5 text-sm text-white"
                  >
                    {paymentMonthOptions.map((m) => (
                      <option key={m} value={m}>
                        {formatMonth(m)}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <>
                  {preview.months.length > 1 && (
                    <select
                      value={selectedMonth}
                      onChange={(e) => setSelectedMonth(e.target.value)}
                      className="bg-dark-bg border border-dark-border rounded-lg px-3 py-1.5 text-sm text-white"
                    >
                      {preview.months.map((m) => (
                        <option key={m} value={m}>
                          {formatMonth(m)}
                        </option>
                      ))}
                    </select>
                  )}
                  <span className="text-sm text-gray-500">
                    {filteredExpenses.length} gastos en {formatMonth(selectedMonth)}
                  </span>
                </>
              )}
            </div>

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-400 whitespace-nowrap">Cotización USD (blue venta):</span>
                <div className="relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                  <input
                    type="number"
                    value={exchangeRate}
                    onChange={(e) => setExchangeRate(e.target.value)}
                    placeholder="—"
                    className="bg-dark-bg border border-dark-border rounded-lg pl-6 pr-3 py-1.5 text-sm text-white w-28 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </div>
              </div>
              <button
                onClick={confirm}
                disabled={confirming || filteredExpenses.length === 0}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 flex items-center gap-2 whitespace-nowrap"
              >
                {confirming && <Loader2 size={16} className="animate-spin" />}
                {preview.source === "visa_galicia" && paymentMonth
                  ? `Importar ${formatMonth(paymentMonth)}`
                  : `Importar ${formatMonth(selectedMonth)}`}
              </button>
            </div>
          </div>

          <div className="bg-dark-card rounded-xl border border-dark-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-dark-border text-gray-500">
                  <th className="text-left p-3">Fecha</th>
                  <th className="text-left p-3">Descripción</th>
                  <th className="text-left p-3">Cuota</th>
                  <th className="text-right p-3">Monto</th>
                </tr>
              </thead>
              <tbody>
                {filteredExpenses.map((e, i) => (
                  <tr
                    key={i}
                    className={`border-b border-dark-border ${
                      e.isFinancialCharge ? "text-gray-600" : ""
                    }`}
                  >
                    <td className="p-3 text-gray-400">{e.date}</td>
                    <td className="p-3">{e.description}</td>
                    <td className="p-3 text-gray-400">
                      {e.installment ?? "—"}
                    </td>
                    <td className="p-3 text-right font-mono">
                      {formatMoney(e.amount, e.currency)}
                    </td>
                  </tr>
                ))}
                {filteredExpenses.length === 0 && (
                  <tr>
                    <td colSpan={4} className="p-6 text-center text-gray-500">
                      No hay gastos para este mes
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
