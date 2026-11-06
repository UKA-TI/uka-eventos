import { useMutation } from '@tanstack/react-query';
import { recoverPassSchema } from '@uka/shared';
import { useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { apiRequest, errorText } from '../../api.js';
import { Field, Notice } from '../../components/ui.js';
import { issuesToErrors } from '../text.js';
import { PublicLayout } from './PublicLayout.js';

export function RecoverPassPage() {
  const { slug = '' } = useParams();
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const recover = useMutation({
    mutationFn: async (body: unknown) =>
      apiRequest(`/api/public/events/${slug}/recover-pass`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = recoverPassSchema.safeParse({ email });
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    recover.mutate(parsed.data);
  };

  return (
    <PublicLayout>
      <h1>Recuperar mi pase</h1>
      {recover.isSuccess ? (
        <Notice kind="ok">
          Si ese correo tiene un pase para este evento, te lo acabamos de
          enviar. Revisa también tu correo no deseado.
        </Notice>
      ) : (
        <form onSubmit={submit} noValidate>
          <p className="muted">
            Por seguridad, solo lo enviamos al correo con el que te registraron.
          </p>
          {recover.isError && (
            <Notice>{errorText(recover.error, 'No se pudo enviar.')}</Notice>
          )}
          <Field label="Correo electrónico" error={errors.email}>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <div className="form-actions">
            <button
              className="button primary wide"
              type="submit"
              disabled={recover.isPending}
            >
              {recover.isPending ? 'Enviando…' : 'Enviarme mi pase'}
            </button>
          </div>
        </form>
      )}
    </PublicLayout>
  );
}
