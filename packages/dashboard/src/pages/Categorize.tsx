import { useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { api, formatMoney } from "../lib/api";
import CategoryPicker from "../components/CategoryPicker";

interface Category {
  id: string;
  name: string;
  emoji: string | null;
  children: { id: string; name: string }[];
}

interface Expense {
  id: string;
  amount: string;
  currency: string;
  description: string;
  date: string;
  source: string;
  category: null;
}

export default function Categorize() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [aiLoading, setAiLoading] = useState(false);
  const [createRules, setCreateRules] = useState<Record<string, boolean>>({});

  const fetchData = async () => {
    setLoading(true);
    const [exps, cats] = await Promise.all([
      api<Expense[]>("/expenses?uncategorized=true"),
      api<Category[]>("/categories"),
    ]);
    setExpenses(exps);
    setCategories(cats);
    // Default: create rule unchecked
    const rules: Record<string, boolean> = {};
    exps.forEach((e) => (rules[e.id] = false));
    setCreateRules(rules);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const categorize = async (expenseId: string, categoryId: string) => {
    await api(`/import/categorize/${expenseId}`, {
      method: "PUT",
      body: JSON.stringify({
        categoryId,
        createRule: createRules[expenseId] ?? true,
      }),
    });
    setExpenses((prev) => prev.filter((e) => e.id !== expenseId));
  };

  const runAI = async () => {
    setAiLoading(true);
    try {
      await api("/import/categorize/auto", { method: "POST" });
      await fetchData();
    } finally {
      setAiLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="animate-spin text-blue-500" size={32} />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-white">
          Categorizar gastos{" "}
          <span className="text-gray-500 text-base font-normal">
            ({expenses.length} pendientes)
          </span>
        </h2>
        <button
          onClick={runAI}
          disabled={aiLoading || expenses.length === 0}
          className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 flex items-center gap-2"
        >
          {aiLoading ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Sparkles size={16} />
          )}
          Categorizar con IA
        </button>
      </div>

      {expenses.length === 0 ? (
        <div className="bg-dark-card rounded-xl border border-dark-border p-8 text-center text-gray-500">
          No hay gastos sin categorizar
        </div>
      ) : (
        <div className="space-y-3">
          {expenses.map((e) => (
            <div
              key={e.id}
              className="bg-dark-card rounded-xl border border-dark-border p-4 flex items-center gap-4"
            >
              <div className="flex-1 min-w-0">
                <p className="text-white truncate">{e.description}</p>
                <p className="text-xs text-gray-500">
                  {e.date} &middot; {e.source}
                </p>
              </div>
              <p className="font-mono text-sm whitespace-nowrap">
                {formatMoney(Number(e.amount), e.currency)}
              </p>
              <CategoryPicker
                categories={categories}
                onSelect={(categoryId) => categorize(e.id, categoryId)}
              />
              <label className="flex items-center gap-1 text-xs text-gray-500 whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={createRules[e.id] ?? true}
                  onChange={(ev) =>
                    setCreateRules((prev) => ({
                      ...prev,
                      [e.id]: ev.target.checked,
                    }))
                  }
                  className="rounded"
                />
                Crear regla
              </label>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
