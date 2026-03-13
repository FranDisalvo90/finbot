import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, ChevronDown, ArrowLeft, Loader2 } from "lucide-react";
import { api, formatARS, formatUSD, getCurrentMonth } from "../lib/api";

interface ChildBreakdown {
  id: string;
  name: string;
  totalArs: number;
  totalUsd: number;
}

interface ParentBreakdown {
  id: string;
  name: string;
  emoji: string | null;
  totalArs: number;
  totalUsd: number;
  children: ChildBreakdown[];
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonth(month: string): string {
  const [y, m] = month.split("-");
  const names = [
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
  return `${names[Number(m) - 1]} ${y}`;
}

export default function CategoryBreakdown() {
  const [searchParams, setSearchParams] = useSearchParams();
  const month = searchParams.get("month") || getCurrentMonth();
  const [currency, setCurrency] = useState<"ARS" | "USD">("ARS");
  const [data, setData] = useState<ParentBreakdown[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const fmt = currency === "ARS" ? formatARS : formatUSD;
  const pickTotal = (r: { totalArs: number; totalUsd: number }) =>
    currency === "ARS" ? r.totalArs : r.totalUsd;

  const setMonth = (m: string) => setSearchParams({ month: m });

  useEffect(() => {
    setLoading(true);
    api<ParentBreakdown[]>(`/reports/breakdown?month=${month}`).then((d) => {
      setData(d);
      setExpanded(new Set(d.map((p) => p.id)));
      setLoading(false);
    });
  }, [month]);

  const grandTotal = data.reduce((s, p) => s + pickTotal(p), 0);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link
            to="/"
            className="p-2 rounded-lg bg-dark-card hover:bg-dark-hover text-gray-400 hover:text-white"
          >
            <ArrowLeft size={20} />
          </Link>
          <button
            onClick={() => setMonth(shiftMonth(month, -1))}
            className="p-2 rounded-lg bg-dark-card hover:bg-dark-hover"
          >
            <ChevronLeft size={20} />
          </button>
          <h2 className="text-xl font-semibold text-white">{formatMonth(month)}</h2>
          <button
            onClick={() => setMonth(shiftMonth(month, 1))}
            className="p-2 rounded-lg bg-dark-card hover:bg-dark-hover"
          >
            <ChevronRight size={20} />
          </button>
        </div>
        <div className="flex items-center bg-dark-card rounded-lg border border-dark-border p-0.5">
          <button
            onClick={() => setCurrency("ARS")}
            className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
              currency === "ARS" ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"
            }`}
          >
            ARS
          </button>
          <button
            onClick={() => setCurrency("USD")}
            className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
              currency === "USD" ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"
            }`}
          >
            USD
          </button>
        </div>
      </div>

      {/* Title + Grand Total */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-white">Desglose por categoría</h3>
        {!loading && <span className="text-lg font-semibold text-white">{fmt(grandTotal)}</span>}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="animate-spin text-blue-500" size={32} />
        </div>
      ) : data.length === 0 ? (
        <div className="text-center text-gray-500 py-12">No hay gastos para este mes</div>
      ) : (
        <div className="space-y-2">
          {data.map((parent) => {
            const parentTotal = pickTotal(parent);
            const isOpen = expanded.has(parent.id);
            return (
              <div
                key={parent.id}
                className="bg-dark-card rounded-xl border border-dark-border overflow-hidden"
              >
                {/* Parent row */}
                <button
                  onClick={() => toggle(parent.id)}
                  className="flex items-center gap-3 p-3 w-full hover:bg-dark-hover"
                >
                  <span className="text-gray-500">
                    {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </span>
                  <span className="text-lg">{parent.emoji}</span>
                  <span className="font-medium text-white flex-1 text-left">{parent.name}</span>
                  {grandTotal > 0 && (
                    <span className="text-xs text-gray-500 mr-2">
                      {((parentTotal / grandTotal) * 100).toFixed(1)}%
                    </span>
                  )}
                  <span className="font-mono text-white font-medium">{fmt(parentTotal)}</span>
                </button>

                {/* Children */}
                {isOpen && parent.children.length > 0 && (
                  <div className="border-t border-dark-border">
                    {parent.children.map((child) => {
                      const childTotal = pickTotal(child);
                      const pct = parentTotal > 0 ? (childTotal / parentTotal) * 100 : 0;
                      return (
                        <div
                          key={child.id}
                          className="flex items-center gap-3 pl-12 pr-3 py-2.5 hover:bg-dark-hover border-b border-dark-border last:border-0"
                        >
                          <span className="text-sm text-gray-300 flex-1">{child.name}</span>
                          <div className="w-24 h-1.5 bg-dark-border rounded-full overflow-hidden mr-2">
                            <div
                              className="h-full bg-blue-500 rounded-full"
                              style={{ width: `${Math.min(pct, 100)}%` }}
                            />
                          </div>
                          <span className="text-xs text-gray-500 w-12 text-right">
                            {pct.toFixed(1)}%
                          </span>
                          <span className="font-mono text-sm text-gray-200 w-28 text-right">
                            {fmt(childTotal)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
