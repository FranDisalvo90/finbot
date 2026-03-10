import { useEffect, useState } from "react";
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
} from "recharts";
import { ChevronLeft, ChevronRight, Trash2, Plus, X } from "lucide-react";
import { Link } from "react-router-dom";
import { api, formatARS, formatUSD, formatMoney, getCurrentMonth } from "../lib/api";
import CategoryPicker from "../components/CategoryPicker";

interface Category {
  id: string;
  name: string;
  emoji: string | null;
  parentId: string | null;
  children: { id: string; name: string }[];
}

const COLORS = [
  "#3B82F6",
  "#10B981",
  "#F59E0B",
  "#EF4444",
  "#8B5CF6",
  "#EC4899",
  "#06B6D4",
  "#F97316",
];

interface MonthlyReport {
  month: string;
  total: number;
  totalArs: number;
  totalUsd: number;
  count: number;
  avgDaily: number;
  avgDailyArs: number;
  avgDailyUsd: number;
  incomeTotalArs: number;
  incomeTotalUsd: number;
  savingsArs: number;
  savingsUsd: number;
  byCategory: {
    id: string;
    name: string;
    emoji: string | null;
    total: number;
    totalArs: number;
    totalUsd: number;
  }[];
}

interface TrendItem {
  month: string;
  total: number;
  totalArs: number;
  totalUsd: number;
  count: number;
}

interface Expense {
  id: string;
  amount: string;
  currency: string;
  amountArs: string;
  amountUsd: string;
  description: string;
  date: string;
  type: string;
  isFinancialCharge: boolean;
  category: { id: string; name: string; emoji: string | null } | null;
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function lastDayOfMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m, 0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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

export default function Dashboard() {
  const [month, setMonth] = useState(getCurrentMonth());
  const [currency, setCurrency] = useState<"ARS" | "USD">("ARS");
  const [report, setReport] = useState<MonthlyReport | null>(null);
  const [trend, setTrend] = useState<TrendItem[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);

  // Income form state
  const [showIncomeForm, setShowIncomeForm] = useState(false);
  const [incomeDesc, setIncomeDesc] = useState("");
  const [incomeAmount, setIncomeAmount] = useState("");
  const [incomeCurrency, setIncomeCurrency] = useState<"ARS" | "USD">("ARS");
  const [incomeDate, setIncomeDate] = useState(lastDayOfMonth(getCurrentMonth()));
  const [incomeCategoryId, setIncomeCategoryId] = useState("");
  const [exchangeRate, setExchangeRate] = useState<number | null>(null);
  const [savingIncome, setSavingIncome] = useState(false);

  const fmt = currency === "ARS" ? formatARS : formatUSD;
  const pickTotal = (r: { totalArs: number; totalUsd: number }) =>
    currency === "ARS" ? r.totalArs : r.totalUsd;

  // Find INGRESOS parent category and its children
  const ingresosParent = categories.find((c) => c.name === "INGRESOS");
  const incomeSubcategories = ingresosParent?.children ?? [];

  useEffect(() => {
    api<Category[]>("/categories").then(setCategories);
  }, []);

  useEffect(() => {
    api<{ rate: number | null }>("/reports/exchange-rate").then((data) => {
      if (data.rate) setExchangeRate(data.rate);
    });
  }, []);

  const refresh = () => {
    api<MonthlyReport>(`/reports/monthly?month=${month}`).then(setReport);
    api<Expense[]>(`/expenses?month=${month}`).then(setExpenses);
  };

  useEffect(() => {
    refresh();
    setIncomeDate(lastDayOfMonth(month));
  }, [month]);

  const deleteExpense = async (expenseId: string) => {
    if (!confirm("¿Eliminar este registro?")) return;
    await api(`/expenses/${expenseId}`, { method: "DELETE" });
    refresh();
  };

  const recategorize = async (expenseId: string, categoryId: string) => {
    await api(`/import/categorize/${expenseId}`, {
      method: "PUT",
      body: JSON.stringify({ categoryId, createRule: false }),
    });
    refresh();
  };

  const saveIncome = async () => {
    if (!incomeDesc || !incomeAmount || !incomeCategoryId) return;
    setSavingIncome(true);
    try {
      await api("/expenses", {
        method: "POST",
        body: JSON.stringify({
          description: incomeDesc,
          amount: incomeAmount,
          currency: incomeCurrency,
          date: incomeDate,
          categoryId: incomeCategoryId,
          type: "income",
          exchangeRate,
        }),
      });
      setShowIncomeForm(false);
      setIncomeDesc("");
      setIncomeAmount("");
      setIncomeCurrency("ARS");
      setIncomeDate(lastDayOfMonth(month));
      setIncomeCategoryId("");
      refresh();
    } finally {
      setSavingIncome(false);
    }
  };

  useEffect(() => {
    api<TrendItem[]>("/reports/trend?months=6").then(setTrend);
  }, []);

  const prevMonth = report
    ? trend.find((t) => t.month === shiftMonth(month, -1))
    : null;
  const currentTotal = report ? pickTotal(report) : 0;
  const prevTotal = prevMonth ? pickTotal(prevMonth) : 0;
  const changePercent =
    prevMonth && report && prevTotal > 0
      ? ((currentTotal - prevTotal) / prevTotal) * 100
      : null;

  const savings = report
    ? currency === "ARS"
      ? report.savingsArs
      : report.savingsUsd
    : 0;

  return (
    <div className="space-y-6">
      {/* Month Selector + Currency Toggle + Income Button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => setMonth(shiftMonth(month, -1))}
            className="p-2 rounded-lg bg-dark-card hover:bg-dark-hover"
          >
            <ChevronLeft size={20} />
          </button>
          <h2 className="text-xl font-semibold text-white">
            {formatMonth(month)}
          </h2>
          <button
            onClick={() => setMonth(shiftMonth(month, 1))}
            className="p-2 rounded-lg bg-dark-card hover:bg-dark-hover"
          >
            <ChevronRight size={20} />
          </button>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowIncomeForm(!showIncomeForm)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-medium transition-colors"
          >
            <Plus size={16} />
            Ingreso
          </button>
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
      </div>

      {/* Income Form */}
      {showIncomeForm && (
        <div className="bg-dark-card rounded-xl p-4 border border-green-800/50 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-green-400">Nuevo ingreso</h3>
            <button onClick={() => setShowIncomeForm(false)} className="text-gray-500 hover:text-white">
              <X size={16} />
            </button>
          </div>
          <div className="grid grid-cols-5 gap-3">
            <input
              type="text"
              placeholder="Descripción"
              value={incomeDesc}
              onChange={(e) => setIncomeDesc(e.target.value)}
              className="col-span-2 bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-green-600"
            />
            <div className="flex items-center gap-1">
              <input
                type="number"
                placeholder="Monto"
                value={incomeAmount}
                onChange={(e) => setIncomeAmount(e.target.value)}
                className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-green-600"
              />
              <div className="flex bg-dark-bg rounded-lg border border-dark-border p-0.5 shrink-0">
                <button
                  onClick={() => setIncomeCurrency("ARS")}
                  className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                    incomeCurrency === "ARS" ? "bg-green-600 text-white" : "text-gray-400"
                  }`}
                >
                  ARS
                </button>
                <button
                  onClick={() => setIncomeCurrency("USD")}
                  className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                    incomeCurrency === "USD" ? "bg-green-600 text-white" : "text-gray-400"
                  }`}
                >
                  USD
                </button>
              </div>
            </div>
            <input
              type="date"
              value={incomeDate}
              onChange={(e) => setIncomeDate(e.target.value)}
              className="bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-green-600"
            />
            <div className="flex items-center gap-2">
              <select
                value={incomeCategoryId}
                onChange={(e) => setIncomeCategoryId(e.target.value)}
                className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-green-600"
              >
                <option value="">Subcategoría</option>
                {incomeSubcategories.map((sc) => (
                  <option key={sc.id} value={sc.id}>
                    {sc.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {exchangeRate && (
            <p className="text-xs text-gray-500">
              Tipo de cambio blue: ${exchangeRate.toFixed(2)}
            </p>
          )}
          <button
            onClick={saveIncome}
            disabled={savingIncome || !incomeDesc || !incomeAmount || !incomeCategoryId}
            className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
          >
            {savingIncome ? "Guardando..." : "Guardar ingreso"}
          </button>
        </div>
      )}

      {/* Summary Cards */}
      {report && (
        <div className="grid grid-cols-4 gap-4">
          <Card label="Total gastos" value={fmt(pickTotal(report))} />
          <Card label="Gastos" value={String(report.count)} />
          <Card
            label="Ahorro"
            value={fmt(savings)}
            color={savings >= 0 ? "text-green-400" : "text-red-400"}
          />
          <Card
            label="vs mes anterior"
            value={
              changePercent !== null
                ? `${changePercent >= 0 ? "+" : ""}${changePercent.toFixed(1)}%`
                : "\u2014"
            }
            color={
              changePercent !== null
                ? changePercent > 0
                  ? "text-red-400"
                  : "text-green-400"
                : undefined
            }
          />
        </div>
      )}

      {/* Charts */}
      {report && report.byCategory.length > 0 && (
        <div className="grid grid-cols-2 gap-4">
          {/* Pie Chart */}
          <div className="bg-dark-card rounded-xl p-4 border border-dark-border">
            <h3 className="text-sm font-medium text-gray-400 mb-4">
              Distribución por categoría
            </h3>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={report.byCategory}
                  dataKey={currency === "ARS" ? "totalArs" : "totalUsd"}
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={110}
                  paddingAngle={2}
                >
                  {report.byCategory.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: number) => {
                    const total = pickTotal(report);
                    const pct = total > 0 ? ((value / total) * 100).toFixed(1) : "0";
                    return `${pct}%`;
                  }}
                  contentStyle={{
                    backgroundColor: "#1A1D27",
                    border: "1px solid #2A2D37",
                    borderRadius: 8,
                    color: "#e5e7eb",
                  }}
                  labelStyle={{ color: "#e5e7eb" }}
                  itemStyle={{ color: "#e5e7eb" }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap gap-2 mt-2">
              {report.byCategory.map((cat, i) => (
                <span
                  key={cat.id}
                  className="flex items-center gap-1 text-xs text-gray-400"
                >
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: COLORS[i % COLORS.length] }}
                  />
                  {cat.emoji} {cat.name}
                </span>
              ))}
            </div>
          </div>

          {/* Bar Chart */}
          <div className="bg-dark-card rounded-xl p-4 border border-dark-border">
            <Link
              to={`/breakdown?month=${month}`}
              className="text-sm font-medium text-gray-400 mb-4 block hover:text-blue-400 transition-colors"
            >
              Gasto por categoría →
            </Link>
            <ResponsiveContainer width="100%" height={340}>
              <BarChart
                data={report.byCategory}
                layout="vertical"
                margin={{ left: 100 }}
              >
                <XAxis type="number" tickFormatter={(v) => fmt(v)} />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fill: "#9CA3AF", fontSize: 12 }}
                  width={90}
                />
                <Tooltip
                  formatter={(value: number) => fmt(value)}
                  contentStyle={{
                    backgroundColor: "#1A1D27",
                    border: "1px solid #2A2D37",
                    borderRadius: 8,
                    color: "#e5e7eb",
                  }}
                  labelStyle={{ color: "#e5e7eb" }}
                  itemStyle={{ color: "#e5e7eb" }}
                />
                <Bar dataKey={currency === "ARS" ? "totalArs" : "totalUsd"} radius={[0, 4, 4, 0]}>
                  {report.byCategory.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Expense Table */}
      <div className="bg-dark-card rounded-xl border border-dark-border overflow-hidden">
        <h3 className="text-sm font-medium text-gray-400 p-4 pb-2">
          Movimientos del mes
        </h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-dark-border text-gray-500">
              <th className="text-left p-3">Fecha</th>
              <th className="text-left p-3">Descripción</th>
              <th className="text-left p-3">Categoría</th>
              <th className="text-right p-3">Monto</th>
              <th className="w-10"></th>
            </tr>
          </thead>
          <tbody>
            {expenses.map((e) => {
              const isIncome = e.type === "income";
              const amount = Number(currency === "ARS" ? e.amountArs : e.amountUsd);
              return (
                <tr
                  key={e.id}
                  className={`border-b border-dark-border hover:bg-dark-hover ${
                    isIncome
                      ? "bg-green-900/10"
                      : !e.category
                        ? "bg-yellow-900/10"
                        : ""
                  }`}
                >
                  <td className="p-3 text-gray-400">{e.date}</td>
                  <td className="p-3">{e.description}</td>
                  <td className="p-3">
                    <CategoryPicker
                      categories={categories}
                      value={e.category}
                      onSelect={(catId) => recategorize(e.id, catId)}
                    />
                  </td>
                  <td className={`p-3 text-right font-mono ${isIncome ? "text-green-400" : "text-white"}`}>
                    {isIncome ? "+" : ""}{fmt(amount)}
                  </td>
                  <td className="p-3 text-center">
                    <button
                      onClick={() => deleteExpense(e.id)}
                      className="text-gray-500 hover:text-red-400 transition-colors"
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              );
            })}
            {expenses.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-gray-500">
                  No hay movimientos para este mes
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Trend */}
      {trend.length > 1 && (
        <div className="bg-dark-card rounded-xl p-4 border border-dark-border">
          <h3 className="text-sm font-medium text-gray-400 mb-4">
            Evolución mensual
          </h3>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={trend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2A2D37" />
              <XAxis
                dataKey="month"
                tickFormatter={formatMonth}
                tick={{ fill: "#9CA3AF", fontSize: 12 }}
              />
              <YAxis tickFormatter={(v) => fmt(v)} tick={{ fill: "#9CA3AF", fontSize: 12 }} />
              <Tooltip
                formatter={(value: number) => fmt(value)}
                labelFormatter={formatMonth}
                contentStyle={{
                  backgroundColor: "#1A1D27",
                  border: "1px solid #2A2D37",
                  borderRadius: 8,
                }}
              />
              <Line
                type="monotone"
                dataKey={currency === "ARS" ? "totalArs" : "totalUsd"}
                stroke="#3B82F6"
                strokeWidth={2}
                dot={{ fill: "#3B82F6" }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function Card({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="bg-dark-card rounded-xl p-4 border border-dark-border">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-lg font-semibold ${color ?? "text-white"}`}>
        {value}
      </p>
    </div>
  );
}
