import { useQuery } from '@tanstack/react-query';
import { Link, Route, Routes } from 'react-router-dom';
import { healthResponseSchema } from '@uka/shared';

async function checkApi() {
  const response = await fetch('/api/health');
  if (!response.ok) {
    throw new Error(`API respondió HTTP ${response.status}`);
  }

  return healthResponseSchema.parse(await response.json());
}

function Home() {
  const health = useQuery({ queryKey: ['api-health'], queryFn: checkApi });

  return (
    <main className="home">
      <p className="eyebrow">Un Kilo de Ayuda</p>
      <h1>UKA Eventos</h1>
      <p>Plataforma de registro y operación de eventos.</p>
      <p className="status" role="status">
        API:{' '}
        {health.isPending
          ? 'comprobando…'
          : health.isError
            ? health.error.message
            : 'conectada a MySQL'}
      </p>
    </main>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route
        path="*"
        element={
          <main className="home">
            <h1>No encontrado</h1>
            <Link to="/">Volver al inicio</Link>
          </main>
        }
      />
    </Routes>
  );
}
