import { Routes, Route, NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Upload,
  Tags,
  FolderTree,
} from "lucide-react";
import Dashboard from "./pages/Dashboard";
import Import from "./pages/Import";
import Categorize from "./pages/Categorize";
import Categories from "./pages/Categories";
import CategoryBreakdown from "./pages/CategoryBreakdown";

const NAV = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/import", icon: Upload, label: "Importar" },
  { to: "/categorize", icon: Tags, label: "Categorizar" },
  { to: "/categories", icon: FolderTree, label: "Categorías" },
];

export default function App() {
  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <nav className="w-56 bg-dark-card border-r border-dark-border flex flex-col p-4 gap-1">
        <h1 className="text-xl font-bold text-white mb-6 px-3">FinBot</h1>
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
      </nav>

      {/* Main content */}
      <main className="flex-1 overflow-auto p-6">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/import" element={<Import />} />
          <Route path="/categorize" element={<Categorize />} />
          <Route path="/categories" element={<Categories />} />
          <Route path="/breakdown" element={<CategoryBreakdown />} />
        </Routes>
      </main>
    </div>
  );
}
