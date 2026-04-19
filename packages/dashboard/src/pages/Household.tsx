import { useState, useEffect } from "react";
import { Copy, Plus, LogOut, Users, Link } from "lucide-react";
import { useAuth } from "../lib/auth";
import {
  getHouseholds,
  getHouseholdMembers,
  updateHouseholdName,
  createInvite,
  joinHousehold,
  createHousehold,
  leaveHousehold,
  type Household as HouseholdType,
  type HouseholdMember,
} from "../lib/api";

export default function Household() {
  const { user, updateToken } = useAuth();

  const [households, setHouseholds] = useState<HouseholdType[]>([]);
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [householdName, setHouseholdName] = useState("");
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [inviteExpiry, setInviteExpiry] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [newHouseholdName, setNewHouseholdName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const activeId = user?.activeHouseholdId;
  const activeHousehold = households.find((h) => h.id === activeId);

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        const hs = await getHouseholds();
        setHouseholds(hs);
        if (activeId) {
          const m = await getHouseholdMembers(activeId);
          setMembers(m);
          const current = hs.find((h) => h.id === activeId);
          if (current) setHouseholdName(current.name);
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [activeId]);

  async function refreshData() {
    try {
      const hs = await getHouseholds();
      setHouseholds(hs);
      if (activeId) {
        const m = await getHouseholdMembers(activeId);
        setMembers(m);
        const current = hs.find((h) => h.id === activeId);
        if (current) setHouseholdName(current.name);
      }
    } catch {
      // ignore
    }
  }

  function clearMessages() {
    setError(null);
    setSuccess(null);
  }

  async function handleUpdateName() {
    if (!activeId || !householdName.trim()) return;
    clearMessages();
    try {
      await updateHouseholdName(activeId, householdName.trim());
      setSuccess("Nombre actualizado");
      await refreshData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al actualizar");
    }
  }

  async function handleGenerateInvite() {
    if (!activeId) return;
    clearMessages();
    try {
      const { code, expiresAt } = await createInvite(activeId);
      setInviteCode(code);
      setInviteExpiry(expiresAt);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al generar invitacion");
    }
  }

  async function handleCopyCode() {
    if (!inviteCode) return;
    await navigator.clipboard.writeText(inviteCode);
    setSuccess("Codigo copiado al portapapeles");
  }

  async function handleJoin() {
    if (!joinCode.trim()) return;
    clearMessages();
    try {
      const { token } = await joinHousehold(joinCode.trim());
      updateToken(token);
      setJoinCode("");
      window.location.reload();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error al unirse";
      if (msg.includes("already a member")) {
        setError("Ya sos miembro de este hogar");
      } else if (msg.includes("expired")) {
        setError("Codigo expirado");
      } else if (msg.includes("Invalid") || msg.includes("not found")) {
        setError("Codigo invalido");
      } else {
        setError(msg);
      }
    }
  }

  async function handleCreate() {
    if (!newHouseholdName.trim()) return;
    clearMessages();
    try {
      const result = await createHousehold(newHouseholdName.trim());
      updateToken(result.token);
      setNewHouseholdName("");
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al crear hogar");
    }
  }

  async function handleLeave() {
    if (!activeId) return;
    if (households.length <= 1) {
      setError("No podes abandonar tu unico hogar");
      return;
    }
    if (!confirm("Seguro que queres abandonar este hogar?")) return;
    clearMessages();
    try {
      const result = await leaveHousehold(activeId);
      if (result.token) {
        updateToken(result.token);
      }
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al abandonar hogar");
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-400">Cargando...</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-white">Configuracion del hogar</h1>

      {error && (
        <div className="bg-red-900/20 border border-red-800 rounded-lg p-3 text-red-400 text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="bg-green-900/20 border border-green-800 rounded-lg p-3 text-green-400 text-sm">
          {success}
        </div>
      )}

      {/* Household name */}
      {activeHousehold && (
        <div className="bg-dark-card rounded-xl border border-dark-border p-5 space-y-3">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Users size={20} />
            Nombre del hogar
          </h2>
          <div className="flex gap-2">
            <input
              type="text"
              value={householdName}
              onChange={(e) => setHouseholdName(e.target.value)}
              className="flex-1 bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-white"
              placeholder="Nombre del hogar"
            />
            <button
              onClick={handleUpdateName}
              disabled={householdName.trim() === activeHousehold.name}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium"
            >
              Guardar
            </button>
          </div>
        </div>
      )}

      {/* Members */}
      {activeHousehold && (
        <div className="bg-dark-card rounded-xl border border-dark-border p-5 space-y-3">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Users size={20} />
            Miembros
          </h2>
          <div className="space-y-2">
            {members.map((m) => (
              <div key={m.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-dark-bg">
                {m.picture ? (
                  <img
                    src={m.picture}
                    alt=""
                    className="w-8 h-8 rounded-full"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-xs text-gray-400">
                    {m.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{m.name}</p>
                  <p className="text-xs text-gray-400 truncate">{m.email}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Invite */}
      {activeHousehold && (
        <div className="bg-dark-card rounded-xl border border-dark-border p-5 space-y-3">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Link size={20} />
            Invitar
          </h2>
          <p className="text-xs text-gray-400">
            El codigo expira en 48 horas y es de un solo uso.
          </p>
          <button
            onClick={handleGenerateInvite}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            Generar codigo de invitacion
          </button>
          {inviteCode && (
            <div className="flex items-center gap-2 mt-2">
              <code className="flex-1 bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-green-400 font-mono select-all">
                {inviteCode}
              </code>
              <button
                onClick={handleCopyCode}
                className="text-gray-400 hover:text-white transition-colors p-2"
                title="Copiar codigo"
              >
                <Copy size={18} />
              </button>
            </div>
          )}
          {inviteExpiry && (
            <p className="text-xs text-gray-500">
              Expira: {new Date(inviteExpiry).toLocaleString("es-AR")}
            </p>
          )}
        </div>
      )}

      {/* Join */}
      <div className="bg-dark-card rounded-xl border border-dark-border p-5 space-y-3">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <Link size={20} />
          Unirse a un hogar
        </h2>
        <div className="flex gap-2">
          <input
            type="text"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            className="flex-1 bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-white"
            placeholder="Codigo de invitacion"
          />
          <button
            onClick={handleJoin}
            disabled={!joinCode.trim()}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            Unirse
          </button>
        </div>
      </div>

      {/* Create new */}
      <div className="bg-dark-card rounded-xl border border-dark-border p-5 space-y-3">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <Plus size={20} />
          Crear nuevo hogar
        </h2>
        <div className="flex gap-2">
          <input
            type="text"
            value={newHouseholdName}
            onChange={(e) => setNewHouseholdName(e.target.value)}
            className="flex-1 bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-white"
            placeholder="Nombre del hogar"
          />
          <button
            onClick={handleCreate}
            disabled={!newHouseholdName.trim()}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            Crear
          </button>
        </div>
      </div>

      {/* Leave */}
      {households.length > 1 && activeHousehold && (
        <div className="bg-dark-card rounded-xl border border-dark-border p-5 space-y-3">
          <h2 className="text-lg font-semibold text-red-400 flex items-center gap-2">
            <LogOut size={20} />
            Abandonar este hogar
          </h2>
          <p className="text-xs text-gray-400">
            Se eliminaran tus datos de este hogar. Esta accion no se puede deshacer.
          </p>
          <button
            onClick={handleLeave}
            className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            Abandonar este hogar
          </button>
        </div>
      )}
    </div>
  );
}
