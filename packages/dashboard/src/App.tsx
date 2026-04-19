import { useState, useEffect } from "react";
import { Routes, Route, NavLink, Navigate } from "react-router-dom";
import { LayoutDashboard, Upload, Tags, FolderTree, LogOut, Home } from "lucide-react";
import { useAuth } from "./lib/auth";
import { getHouseholds, switchHousehold } from "./lib/api";
import Dashboard from "./pages/Dashboard";
import Import from "./pages/Import";
import Categorize from "./pages/Categorize";
import Categories from "./pages/Categories";
import CategoryBreakdown from "./pages/CategoryBreakdown";
import Household from "./pages/Household";
import Login from "./pages/Login";

const NAV = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/import", icon: Upload, label: "Importar" },
  { to: "/categorize", icon: Tags, label: "Categorizar" },
  { to: "/categories", icon: FolderTree, label: "Categorías" },
  { to: "/household", icon: Home, label: "Hogar" },
];

export default function App() {
  const { isAuthenticated, isLoading, user, logout, updateToken } = useAuth();
  const [households, setHouseholds] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    if (isAuthenticated) {
      getHouseholds()
        .then((data) => setHouseholds(data))
        .catch(() => {});
    }
  }, [isAuthenticated]);

  const handleSwitch = async (householdId: string) => {
    try {
      const { token } = await switchHousehold(householdId);
      updateToken(token);
      window.location.reload();
    } catch {
      // ignore
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-dark-bg flex items-center justify-center">
        <p className="text-gray-400">Cargando...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <nav className="w-56 bg-dark-card border-r border-dark-border flex flex-col p-4 gap-1">
        <h1 className="text-xl font-bold text-white mb-6 px-3">FinBot</h1>
        {households.length > 1 && (
          <select
            value={user?.activeHouseholdId ?? ""}
            onChange={(e) => handleSwitch(e.target.value)}
            className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-1.5 text-sm text-white mb-4"
          >
            {households.map((h) => (
              <option key={h.id} value={h.id}>{h.name}</option>
            ))}
          </select>
        )}
        {NAV.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive
                  ? "bg-blue-600 text-white"
                  : "text-gray-400 hover:bg-dark-hover hover:text-white"
              }`
            }
          >
            <Icon size={18} />
            {label}
          </NavLink>
        ))}

        {/* User + Logout */}
        <div className="mt-auto pt-4 border-t border-dark-border">
          <div className="flex items-center gap-3 px-3 py-2">
            {user?.picture && (
              <img
                src={user.picture}
                alt=""
                className="w-7 h-7 rounded-full"
                referrerPolicy="no-referrer"
              />
            )}
            <span className="text-xs text-gray-400 truncate flex-1">{user?.name}</span>
            <button
              onClick={logout}
              className="text-gray-500 hover:text-white transition-colors"
              title="Cerrar sesión"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </nav>

      {/* Main content */}
      <main className="flex-1 overflow-auto p-6">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/import" element={<Import />} />
          <Route path="/categorize" element={<Categorize />} />
          <Route path="/categories" element={<Categories />} />
          <Route path="/breakdown" element={<CategoryBreakdown />} />
          <Route path="/household" element={<Household />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
