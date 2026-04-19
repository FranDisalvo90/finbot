import { useState, useEffect } from "react";
import { Routes, Route, NavLink, Navigate } from "react-router-dom";
import { LayoutDashboard, Upload, Tags, FolderTree, LogOut, Home, ChevronDown } from "lucide-react";
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
  const [showHouseholdMenu, setShowHouseholdMenu] = useState(false);

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
        {/* Household picker */}
        <div className="relative mb-4">
          <button
            onClick={() => setShowHouseholdMenu(!showHouseholdMenu)}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-dark-hover transition-colors"
          >
            {user?.picture && (
              <img
                src={user.picture}
                alt=""
                className="w-6 h-6 rounded-full shrink-0"
                referrerPolicy="no-referrer"
              />
            )}
            <span className="text-sm text-white font-medium truncate flex-1 text-left">
              {households.find((h) => h.id === user?.activeHouseholdId)?.name ?? "FinBot"}
            </span>
            <ChevronDown size={14} className={`text-gray-500 shrink-0 transition-transform ${showHouseholdMenu ? "rotate-180" : ""}`} />
          </button>
          {showHouseholdMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowHouseholdMenu(false)} />
              <div className="absolute left-0 right-0 top-full mt-1 bg-dark-bg border border-dark-border rounded-lg py-1 z-20 shadow-lg">
                {households.map((h) => (
                  <button
                    key={h.id}
                    onClick={() => {
                      setShowHouseholdMenu(false);
                      if (h.id !== user?.activeHouseholdId) handleSwitch(h.id);
                    }}
                    className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${
                      h.id === user?.activeHouseholdId
                        ? "text-white bg-dark-hover"
                        : "text-gray-400 hover:bg-dark-hover hover:text-white"
                    }`}
                  >
                    {h.name}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
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
