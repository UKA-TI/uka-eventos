import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { PageHeading } from '../components/ui.js';
import { EventGeneralForm } from './EventGeneralForm.js';

export function NewEventPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return (
    <section>
      <PageHeading
        title="Nuevo evento"
        description="Se crea como borrador. Después configuras sus boletos y lo activas."
      />
      <EventGeneralForm
        onCancel={() => navigate('/eventos')}
        onSaved={async (saved) => {
          await queryClient.invalidateQueries({ queryKey: ['events'] });
          await queryClient.invalidateQueries({ queryKey: ['series'] });
          navigate(`/eventos/${saved.id}`);
        }}
      />
    </section>
  );
}
