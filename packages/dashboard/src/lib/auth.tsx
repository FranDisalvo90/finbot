import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { GoogleOAuthProvider } from "@react-oauth/google";

interface User {
  id: string;
  email: string;
  name: string;
  picture: string | null;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (credential: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>(null!);

export function useAuth() {
  return useContext(AuthContext);
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const base64 = token.split(".")[1];
  return JSON.parse(atob(base64));
}

function isTokenValid(token: string): boolean {
  try {
    const payload = decodeJwtPayload(token);
    return typeof payload.exp === "number" && payload.exp > Date.now() / 1000;
  } catch {
    return false;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Restore session from localStorage
    const stored = localStorage.getItem("auth_token");
    if (stored && isTokenValid(stored)) {
      const payload = decodeJwtPayload(stored);
      setToken(stored);
      setUser({
        id: payload.sub as string,
        email: payload.email as string,
        name: payload.name as string,
        picture: (payload.picture as string) ?? null,
      });
    }

    // Fetch Google Client ID from API
    fetch("/api/auth/config")
      .then((res) => res.json())
      .then((data) => setClientId(data.clientId))
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  const login = useCallback(async (credential: string) => {
    const res = await fetch("/api/auth/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error ?? "Login failed");
    }
    const data = await res.json();
    localStorage.setItem("auth_token", data.token);
    setToken(data.token);
    setUser(data.user);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("auth_token");
    setToken(null);
    setUser(null);
  }, []);

  const content = (
    <AuthContext.Provider value={{ user, token, isAuthenticated: !!token, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );

  if (!clientId) return content;

  return <GoogleOAuthProvider clientId={clientId}>{content}</GoogleOAuthProvider>;
}
