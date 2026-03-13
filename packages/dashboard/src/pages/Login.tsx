import { GoogleLogin, type CredentialResponse } from "@react-oauth/google";
import { useAuth } from "../lib/auth";
import { useNavigate } from "react-router-dom";
import { useState } from "react";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  const handleSuccess = async (response: CredentialResponse) => {
    try {
      await login(response.credential!);
      window.focus();
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al iniciar sesión");
    }
  };

  return (
    <div className="min-h-screen bg-dark-bg flex items-center justify-center">
      <div className="bg-dark-card border border-dark-border rounded-2xl p-10 w-full max-w-sm flex flex-col items-center gap-6">
        <h1 className="text-2xl font-bold text-white">FinBot</h1>
        <p className="text-gray-400 text-sm text-center">
          Iniciá sesión para acceder a tus finanzas
        </p>

        <GoogleLogin
          onSuccess={handleSuccess}
          onError={() => setError("Error al iniciar sesión con Google")}
          theme="filled_black"
          size="large"
          shape="pill"
          width={300}
        />

        {error && <p className="text-red-400 text-sm text-center">{error}</p>}
      </div>
    </div>
  );
}
