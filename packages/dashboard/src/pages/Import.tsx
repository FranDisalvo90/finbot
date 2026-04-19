import { useState, useCallback, useMemo, useEffect } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, CheckCircle, Loader2, AlertTriangle, RefreshCw, Unlink, Link } from "lucide-react";
import {
  formatMoney,
  getSplitwiseStatus,
  getSplitwiseGroups,
  selectSplitwiseGroup,
  syncSplitwise,
  disconnectSplitwise,
  connectSplitwise,
  type SplitwiseStatus,
  type SplitwiseGroup,
  type SyncResult as SplitwiseSyncResult,
} from "../lib/api";

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
  duplicates: number[];
  duplicateCount: number;
}

interface ConfirmResult {
  total: number;
  categorizedByRules: number;
  categorizedByAI: number;
  pending: number;
  skippedDuplicates: number;
}

const MONTH_NAMES = [
  "Ene",
  "Feb",
  "Mar",
  "Abr",
  "May",
  "Jun",
  "Jul",
  "Ago",
  "Sep",
  "Oct",
  "Nov",
  "Dic",
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
  const [excludedIndices, setExcludedIndices] = useState<Set<number>>(new Set());

  // Splitwise state
  const [swStatus, setSwStatus] = useState<SplitwiseStatus | null>(null);
  const [swGroups, setSwGroups] = useState<SplitwiseGroup[]>([]);
  const [swSelectedGroup, setSwSelectedGroup] = useState<number | null>(null);
  const [swSyncing, setSwSyncing] = useState(false);
  const [swSyncResult, setSwSyncResult] = useState<SplitwiseSyncResult | null>(null);
  const [swError, setSwError] = useState<string | null>(null);
  const [swLoading, setSwLoading] = useState(true);
  const [swShowGroupSelect, setSwShowGroupSelect] = useState(false);

  // Load Splitwise status on mount + handle OAuth callback redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("splitwise") === "connected") {
      window.history.replaceState({}, "", "/import");
    }
    getSplitwiseStatus()
      .then(setSwStatus)
      .catch(() => setSwStatus({ connected: false, groupId: null, groupName: null, lastSyncAt: null }))
      .finally(() => setSwLoading(false));
  }, []);

  const handleSwConnect = async () => {
    try {
      await connectSplitwise();
    } catch (e: unknown) {
      setSwError(e instanceof Error ? e.message : "Error al conectar");
    }
  };

  const handleSwLoadGroups = async () => {
    setSwError(null);
    try {
      const data = await getSplitwiseGroups();
      setSwGroups(data.groups);
      setSwShowGroupSelect(true);
    } catch (e: unknown) {
      setSwError(e instanceof Error ? e.message : "Error al cargar grupos");
    }
  };

  const handleSwSelectGroup = async () => {
    if (!swSelectedGroup) return;
    const group = swGroups.find((g) => g.id === swSelectedGroup);
    if (!group) return;
    setSwError(null);
    try {
      await selectSplitwiseGroup(group.id, group.name);
      setSwStatus((prev) => prev ? { ...prev, groupId: group.id, groupName: group.name, lastSyncAt: null } : prev);
      setSwShowGroupSelect(false);
      setSwSyncResult(null);
    } catch (e: unknown) {
      setSwError(e instanceof Error ? e.message : "Error al seleccionar grupo");
    }
  };

  const handleSwSync = async () => {
    setSwSyncing(true);
    setSwError(null);
    setSwSyncResult(null);
    try {
      const result = await syncSplitwise();
      setSwSyncResult(result);
      const status = await getSplitwiseStatus();
      setSwStatus(status);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Error al sincronizar";
      if (msg.includes("splitwise_auth_expired")) {
        setSwStatus({ connected: false, groupId: null, groupName: null, lastSyncAt: null });
        setSwError("La conexion con Splitwise expiro. Reconecta tu cuenta.");
      } else {
        setSwError(msg);
      }
    } finally {
      setSwSyncing(false);
    }
  };

  const handleSwDisconnect = async () => {
    try {
      await disconnectSplitwise();
      setSwStatus({ connected: false, groupId: null, groupName: null, lastSyncAt: null });
      setSwSyncResult(null);
      setSwShowGroupSelect(false);
    } catch (e: unknown) {
      setSwError(e instanceof Error ? e.message : "Error al desconectar");
    }
  };

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
      const token = localStorage.getItem("auth_token");
      const res = await fetch("/api/import/upload", {
        method: "POST",
        body: form,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error);
      }
      const data: UploadResult = await res.json();
      setPreview(data);
      setExchangeRate(data.exchangeRate ? String(data.exchangeRate) : "");
      setExcludedIndices(new Set(data.duplicates));
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
    const indexed = preview.expenses.map((expense, i) => ({ expense, originalIndex: i }));
    if (preview.source === "visa_galicia") return indexed;
    if (!selectedMonth) return indexed;
    return indexed.filter((entry) => entry.expense.date.substring(0, 7) === selectedMonth);
  }, [preview, selectedMonth]);

  const duplicateSet = useMemo(
    () => (preview ? new Set(preview.duplicates) : new Set<number>()),
    [preview],
  );

  const includedCount = useMemo(
    () => filteredExpenses.filter((entry) => !excludedIndices.has(entry.originalIndex)).length,
    [filteredExpenses, excludedIndices],
  );

  const confirm = async () => {
    if (!preview) return;
    setConfirming(true);
    setError(null);
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch("/api/import/confirm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          previewId: preview.previewId,
          exchangeRate: exchangeRate ? Number(exchangeRate) : undefined,
          excludeIndices: [...excludedIndices],
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
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-white">Importar gastos</h2>

      {/* Splitwise Sync Section */}
      {!swLoading && swStatus && (
        <div className="bg-dark-card rounded-xl border border-dark-border p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-white font-medium">Splitwise</h3>
            {swStatus.connected && (
              <span className="text-xs text-green-400 bg-green-900/30 px-2 py-0.5 rounded">
                Conectado
              </span>
            )}
          </div>

          {!swStatus.connected ? (
            <div className="space-y-3">
              <p className="text-sm text-gray-400">
                Sincroniza tus gastos de Splitwise automaticamente.
              </p>
              <button
                onClick={handleSwConnect}
                className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
              >
                <Link size={16} />
                Conectar Splitwise
              </button>
            </div>
          ) : !swStatus.groupId || swShowGroupSelect ? (
            <div className="space-y-3">
              {!swShowGroupSelect && (
                <button
                  onClick={handleSwLoadGroups}
                  className="text-sm text-blue-400 hover:text-blue-300"
                >
                  Selecciona un grupo para sincronizar
                </button>
              )}
              {swShowGroupSelect && (
                <div className="flex items-center gap-3">
                  <select
                    value={swSelectedGroup ?? ""}
                    onChange={(e) => setSwSelectedGroup(Number(e.target.value))}
                    className="bg-dark-bg border border-dark-border rounded-lg px-3 py-1.5 text-sm text-white flex-1"
                  >
                    <option value="">Seleccionar grupo...</option>
                    {swGroups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={handleSwSelectGroup}
                    disabled={!swSelectedGroup}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50"
                  >
                    Confirmar
                  </button>
                </div>
              )}
              <button
                onClick={handleSwDisconnect}
                className="text-xs text-gray-500 hover:text-gray-400 flex items-center gap-1"
              >
                <Unlink size={12} />
                Desconectar
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm text-gray-400">
                  <span className="text-white">Grupo: {swStatus.groupName}</span>
                  <button
                    onClick={handleSwLoadGroups}
                    className="ml-2 text-xs text-blue-400 hover:text-blue-300"
                  >
                    Cambiar
                  </button>
                  {swStatus.lastSyncAt && (
                    <span className="ml-3">
                      Ultima sync:{" "}
                      {new Date(swStatus.lastSyncAt).toLocaleDateString("es-AR", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleSwSync}
                  disabled={swSyncing}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 flex items-center gap-2"
                >
                  {swSyncing ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <RefreshCw size={16} />
                  )}
                  Sincronizar
                </button>
                <button
                  onClick={handleSwDisconnect}
                  className="text-xs text-gray-500 hover:text-gray-400 flex items-center gap-1"
                >
                  <Unlink size={12} />
                  Desconectar
                </button>
              </div>
            </div>
          )}

          {swError && (
            <div className="bg-red-900/20 border border-red-800 rounded-lg p-3 text-red-400 text-sm">
              {swError}
            </div>
          )}

          {swSyncResult && (
            <div className="bg-green-900/20 border border-green-800 rounded-lg p-3 space-y-1">
              <div className="flex items-center gap-2 text-green-400 text-sm font-medium">
                <CheckCircle size={16} />
                Sincronizacion completada
              </div>
              <p className="text-sm text-gray-400">
                {swSyncResult.inserted} nuevos, {swSyncResult.updated} actualizados,{" "}
                {swSyncResult.deleted} eliminados, {swSyncResult.categorized} categorizados
                {swSyncResult.exchangeRate && (
                  <span className="ml-2">(USD blue: ${swSyncResult.exchangeRate})</span>
                )}
              </p>
            </div>
          )}
        </div>
      )}

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
            {result.skippedDuplicates > 0 && (
              <>, {result.skippedDuplicates} duplicados omitidos</>
            )}
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
                <span className="text-white font-medium">{preview.count}</span> gastos en{" "}
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
                    {includedCount} gastos en {formatMonth(selectedMonth)}
                  </span>
                </>
              )}
            </div>

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-400 whitespace-nowrap">
                  Cotización USD (blue venta):
                </span>
                <div className="relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 text-sm">
                    $
                  </span>
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
                disabled={confirming || includedCount === 0}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 flex items-center gap-2 whitespace-nowrap"
              >
                {confirming && <Loader2 size={16} className="animate-spin" />}
                Importar {includedCount} gastos
              </button>
            </div>
          </div>

          {preview.duplicateCount > 0 && (
            <div className="bg-amber-900/20 border border-amber-800 rounded-lg p-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-amber-400 text-sm">
                <AlertTriangle size={16} />
                Se encontraron {preview.duplicateCount} gastos que ya existen. Están excluidos por
                defecto.
              </div>
              <button
                onClick={() => {
                  const allExcluded = preview.duplicates.every((i) => excludedIndices.has(i));
                  if (allExcluded) {
                    setExcludedIndices((prev) => {
                      const next = new Set(prev);
                      preview.duplicates.forEach((i) => next.delete(i));
                      return next;
                    });
                  } else {
                    setExcludedIndices((prev) => {
                      const next = new Set(prev);
                      preview.duplicates.forEach((i) => next.add(i));
                      return next;
                    });
                  }
                }}
                className="text-sm text-amber-400 hover:text-amber-300 underline whitespace-nowrap"
              >
                {preview.duplicates.every((i) => excludedIndices.has(i))
                  ? "Incluir todos"
                  : "Excluir duplicados"}
              </button>
            </div>
          )}

          <div className="bg-dark-card rounded-xl border border-dark-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-dark-border text-gray-500">
                  <th className="w-10 p-3"></th>
                  <th className="text-left p-3">Fecha</th>
                  <th className="text-left p-3">Descripción</th>
                  <th className="text-left p-3">Cuota</th>
                  <th className="text-right p-3">Monto</th>
                </tr>
              </thead>
              <tbody>
                {filteredExpenses.map(({ expense: e, originalIndex }) => {
                  const isDuplicate = duplicateSet.has(originalIndex);
                  const isExcluded = excludedIndices.has(originalIndex);
                  return (
                    <tr
                      key={originalIndex}
                      className={`border-b border-dark-border ${
                        isDuplicate ? "bg-amber-900/10" : ""
                      } ${e.isFinancialCharge ? "text-gray-600" : ""} ${
                        isExcluded ? "opacity-50" : ""
                      }`}
                    >
                      <td className="p-3 text-center">
                        <input
                          type="checkbox"
                          checked={!isExcluded}
                          onChange={() => {
                            setExcludedIndices((prev) => {
                              const next = new Set(prev);
                              if (next.has(originalIndex)) {
                                next.delete(originalIndex);
                              } else {
                                next.add(originalIndex);
                              }
                              return next;
                            });
                          }}
                          className="rounded border-dark-border"
                        />
                      </td>
                      <td className="p-3 text-gray-400">{e.date}</td>
                      <td className="p-3">
                        <span className="flex items-center gap-2">
                          {e.description}
                          {isDuplicate && (
                            <span className="text-xs bg-amber-800/50 text-amber-400 px-1.5 py-0.5 rounded">
                              Duplicado
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="p-3 text-gray-400">{e.installment ?? "—"}</td>
                      <td className="p-3 text-right font-mono">
                        {formatMoney(e.amount, e.currency)}
                      </td>
                    </tr>
                  );
                })}
                {filteredExpenses.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-gray-500">
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
