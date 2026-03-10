import { useState, useRef, useEffect, useMemo } from "react";
import { Search, ChevronDown } from "lucide-react";

interface Category {
  id: string;
  name: string;
  emoji: string | null;
  children: { id: string; name: string }[];
}

interface Props {
  categories: Category[];
  onSelect: (categoryId: string) => void;
  value?: { id: string; name: string; emoji: string | null } | null;
}

export default function CategoryPicker({ categories, onSelect, value }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return categories;
    return categories
      .map((parent) => ({
        ...parent,
        children: parent.children.filter((c) =>
          c.name.toLowerCase().includes(q) ||
          parent.name.toLowerCase().includes(q)
        ),
      }))
      .filter((p) => p.children.length > 0);
  }, [categories, search]);

  const label = value
    ? `${value.emoji ?? ""} ${value.name}`.trim()
    : "Seleccionar categoría";

  return (
    <div ref={ref} className="relative w-56">
      <button
        onClick={() => setOpen(!open)}
        className={`w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm flex items-center justify-between ${
          value ? "text-white" : "text-gray-400"
        }`}
      >
        <span className="truncate">{label}</span>
        <ChevronDown size={14} className="shrink-0 ml-1" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-72 bg-dark-card border border-dark-border rounded-lg shadow-xl overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-dark-border">
            <Search size={14} className="text-gray-500" />
            <input
              ref={inputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar categoría..."
              className="bg-transparent text-sm text-white outline-none flex-1"
            />
          </div>
          <div className="max-h-64 overflow-y-auto">
            {filtered.length === 0 && (
              <p className="text-xs text-gray-500 p-3">Sin resultados</p>
            )}
            {filtered.map((parent) => (
              <div key={parent.id}>
                <p className="text-xs text-gray-500 font-medium px-3 pt-2 pb-1">
                  {parent.emoji} {parent.name}
                </p>
                {parent.children.map((child) => (
                  <button
                    key={child.id}
                    onClick={() => {
                      onSelect(child.id);
                      setOpen(false);
                      setSearch("");
                    }}
                    className={`w-full text-left px-3 py-1.5 pl-6 text-sm hover:bg-dark-hover hover:text-white ${
                      value?.id === child.id
                        ? "text-blue-400 font-medium"
                        : "text-gray-300"
                    }`}
                  >
                    {child.name}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
