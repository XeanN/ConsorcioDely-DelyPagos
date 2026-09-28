import { useEffect, useState } from 'react';
import { BannerDemo } from './components/BannerDemo';

interface Salud {
  estado: string;
  proveedorBancario: string;
  modoDemo: boolean;
}

export default function App() {
  const [salud, setSalud] = useState<Salud | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/salud')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setSalud)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <div className="min-h-screen">
      {salud?.modoDemo && <BannerDemo />}
      <header className="border-b border-slate-200 bg-white px-6 py-4">
        <h1 className="text-xl font-bold">Dely Pagos</h1>
        <p className="text-sm text-slate-500">Verificación y conciliación de pagos</p>
      </header>
      <main className="p-6">
        {error && <p className="text-red-700">No se pudo conectar con la API: {error}</p>}
        {salud && (
          <p className="text-slate-700">
            API en línea · proveedor bancario: <strong>{salud.proveedorBancario}</strong>
          </p>
        )}
      </main>
    </div>
  );
}
