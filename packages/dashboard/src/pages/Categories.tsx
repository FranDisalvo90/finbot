import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { api } from "../lib/api";

interface Category {
  id: string;
  name: string;
  emoji: string | null;
  sortOrder: number;
  children: Category[];
}

export default function Categories() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmoji, setEditEmoji] = useState("");
  const [newParent, setNewParent] = useState(false);
  const [newChild, setNewChild] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newEmoji, setNewEmoji] = useState("");

  const fetchCategories = async () => {
    const data = await api<Category[]>("/categories");
    setCategories(data);
    setLoading(false);
  };

  useEffect(() => {
    fetchCategories();
  }, []);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const save = async (id: string) => {
    await api(`/categories/${id}`, {
      method: "PUT",
      body: JSON.stringify({ name: editName, emoji: editEmoji || null }),
    });
    setEditing(null);
    fetchCategories();
  };

  const remove = async (id: string) => {
    try {
      await api(`/categories/${id}`, { method: "DELETE" });
      fetchCategories();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Error");
    }
  };

  const create = async (parentId?: string) => {
    await api("/categories", {
      method: "POST",
      body: JSON.stringify({
        name: newName,
        emoji: newEmoji || null,
        parentId: parentId ?? null,
      }),
    });
    setNewParent(false);
    setNewChild(null);
    setNewName("");
    setNewEmoji("");
    fetchCategories();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="animate-spin text-blue-500" size={32} />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-white">Categorías</h2>
        <button
          onClick={() => {
            setNewParent(true);
            setNewName("");
            setNewEmoji("");
          }}
          className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-1"
        >
          <Plus size={16} /> Nueva categoría
        </button>
      </div>

      {newParent && (
        <div className="bg-dark-card rounded-xl border border-dark-border p-4 flex items-center gap-3">
          <input
            placeholder="Emoji"
            value={newEmoji}
            onChange={(e) => setNewEmoji(e.target.value)}
            className="bg-dark-bg border border-dark-border rounded px-2 py-1 w-16 text-center"
          />
          <input
            placeholder="Nombre"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="bg-dark-bg border border-dark-border rounded px-3 py-1 flex-1"
            autoFocus
          />
          <button
            onClick={() => create()}
            disabled={!newName}
            className="bg-blue-600 text-white px-3 py-1 rounded text-sm disabled:opacity-50"
          >
            Crear
          </button>
          <button onClick={() => setNewParent(false)} className="text-gray-500 text-sm">
            Cancelar
          </button>
        </div>
      )}

      <div className="space-y-2">
        {categories.map((parent) => (
          <div
            key={parent.id}
            className="bg-dark-card rounded-xl border border-dark-border overflow-hidden"
          >
            {/* Parent row */}
            <div className="flex items-center gap-3 p-3 hover:bg-dark-hover">
              <button onClick={() => toggle(parent.id)} className="text-gray-500">
                {expanded.has(parent.id) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </button>
              {editing === parent.id ? (
                <>
                  <input
                    value={editEmoji}
                    onChange={(e) => setEditEmoji(e.target.value)}
                    className="bg-dark-bg border border-dark-border rounded px-2 py-1 w-12 text-center text-sm"
                  />
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="bg-dark-bg border border-dark-border rounded px-2 py-1 flex-1 text-sm"
                    autoFocus
                  />
                  <button onClick={() => save(parent.id)} className="text-blue-400 text-xs">
                    Guardar
                  </button>
                  <button onClick={() => setEditing(null)} className="text-gray-500 text-xs">
                    Cancelar
                  </button>
                </>
              ) : (
                <>
                  <span className="text-lg">{parent.emoji}</span>
                  <span className="font-medium text-white flex-1">{parent.name}</span>
                  <span className="text-xs text-gray-500">
                    {parent.children.length} subcategorías
                  </span>
                  <button
                    onClick={() => {
                      setEditing(parent.id);
                      setEditName(parent.name);
                      setEditEmoji(parent.emoji ?? "");
                    }}
                    className="text-gray-500 hover:text-white"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => remove(parent.id)}
                    className="text-gray-500 hover:text-red-400"
                  >
                    <Trash2 size={14} />
                  </button>
                </>
              )}
            </div>

            {/* Children */}
            {expanded.has(parent.id) && (
              <div className="border-t border-dark-border">
                {parent.children.map((child) => (
                  <div
                    key={child.id}
                    className="flex items-center gap-3 pl-10 pr-3 py-2 hover:bg-dark-hover border-b border-dark-border last:border-0"
                  >
                    {editing === child.id ? (
                      <>
                        <input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="bg-dark-bg border border-dark-border rounded px-2 py-1 flex-1 text-sm"
                          autoFocus
                        />
                        <button onClick={() => save(child.id)} className="text-blue-400 text-xs">
                          Guardar
                        </button>
                        <button onClick={() => setEditing(null)} className="text-gray-500 text-xs">
                          Cancelar
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="text-sm text-gray-300 flex-1">{child.name}</span>
                        <button
                          onClick={() => {
                            setEditing(child.id);
                            setEditName(child.name);
                            setEditEmoji("");
                          }}
                          className="text-gray-600 hover:text-white"
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          onClick={() => remove(child.id)}
                          className="text-gray-600 hover:text-red-400"
                        >
                          <Trash2 size={12} />
                        </button>
                      </>
                    )}
                  </div>
                ))}

                {/* Add child */}
                {newChild === parent.id ? (
                  <div className="flex items-center gap-3 pl-10 pr-3 py-2">
                    <input
                      placeholder="Nombre subcategoría"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      className="bg-dark-bg border border-dark-border rounded px-2 py-1 flex-1 text-sm"
                      autoFocus
                    />
                    <button
                      onClick={() => create(parent.id)}
                      disabled={!newName}
                      className="text-blue-400 text-xs disabled:opacity-50"
                    >
                      Crear
                    </button>
                    <button onClick={() => setNewChild(null)} className="text-gray-500 text-xs">
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setNewChild(parent.id);
                      setNewName("");
                    }}
                    className="flex items-center gap-1 pl-10 pr-3 py-2 text-xs text-gray-500 hover:text-white w-full"
                  >
                    <Plus size={12} /> Agregar subcategoría
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
