import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  seriesInputSchema,
  seriesResponseSchema,
  suggestedEventTypes,
  type SeriesRecord,
} from '@uka/shared';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { apiRequest, errorText, jsonRequest } from '../api.js';
import { usePermissions } from '../auth/session.js';
import {
  Field,
  Loading,
  Notice,
  PageHeading,
  StatusBadge,
} from '../components/ui.js';
import { issuesToErrors } from './text.js';

const emptyForm = { name: '', type: '', description: '' };

export function SeriesPage() {
  const queryClient = useQueryClient();
  const { can, csrfToken } = usePermissions();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{
    kind: 'ok' | 'error';
    text: string;
  }>();

  const series = useQuery({
    queryKey: ['series'],
    queryFn: async () =>
      z.array(seriesResponseSchema).parse(await apiRequest('/api/series')),
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['series'] });
    await queryClient.invalidateQueries({ queryKey: ['events'] });
    await queryClient.invalidateQueries({ queryKey: ['event'] });
  };

  const save = useMutation({
    mutationFn: async (input: unknown) =>
      apiRequest(
        editingId ? `/api/series/${editingId}` : '/api/series',
        jsonRequest(editingId ? 'PUT' : 'POST', input, csrfToken),
      ),
    onSuccess: async () => {
      await refresh();
      setFormOpen(false);
      setNotice({ kind: 'ok', text: 'Serie guardada.' });
    },
    onError: (error) =>
      setNotice({
        kind: 'error',
        text: errorText(error, 'No se pudo guardar la serie.'),
      }),
  });

  const remove = useMutation({
    mutationFn: async (item: SeriesRecord) =>
      apiRequest(
        `/api/series/${item.id}`,
        jsonRequest('DELETE', undefined, csrfToken),
      ),
    onSuccess: async () => {
      await refresh();
      setNotice({ kind: 'ok', text: 'Serie eliminada.' });
    },
    onError: (error) =>
      setNotice({
        kind: 'error',
        text: errorText(error, 'No se pudo borrar la serie.'),
      }),
  });

  const open = (item?: SeriesRecord) => {
    setEditingId(item?.id ?? null);
    setErrors({});
    setNotice(undefined);
    setForm(
      item
        ? {
            name: item.name,
            type: item.type,
            description: item.description ?? '',
          }
        : emptyForm,
    );
    setFormOpen(true);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setNotice(undefined);
    const parsed = seriesInputSchema.safeParse({
      name: form.name,
      type: form.type,
      description: form.description.trim() || null,
    });
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    save.mutate(parsed.data);
  };

  if (series.isPending) {
    return <Loading />;
  }

  return (
    <section>
      <PageHeading
        title="Series"
        description="Una serie reúne las ediciones del mismo evento, como la Gala de cada año."
        action={
          can('events.create') && (
            <button
              className="button primary"
              type="button"
              onClick={() => open()}
            >
              Nueva serie
            </button>
          )
        }
      />
      {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}
      {series.isError && <Notice>{series.error.message}</Notice>}

      {formOpen && (
        <form className="panel" onSubmit={submit} noValidate>
          <div className="panel-heading">
            <h2>{editingId ? 'Editar serie' : 'Nueva serie'}</h2>
          </div>
          <div className="form-grid">
            <Field
              label="Nombre"
              error={errors.name}
              hint="Sin año, por ejemplo: Gala Un Kilo de Ayuda."
            >
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <Field
              label="Tipo de evento"
              error={errors.type}
              hint="Elige uno o escribe otro."
            >
              <input
                list="tipos-serie"
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
              />
              <datalist id="tipos-serie">
                {suggestedEventTypes.map((type) => (
                  <option key={type} value={type} />
                ))}
              </datalist>
            </Field>
            <div className="span-all">
              <Field label="Descripción" error={errors.description}>
                <textarea
                  rows={2}
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                />
              </Field>
            </div>
          </div>
          <div className="form-actions">
            <button
              className="button primary"
              type="submit"
              disabled={save.isPending}
            >
              {save.isPending ? 'Guardando…' : 'Guardar serie'}
            </button>
            <button
              className="button secondary"
              type="button"
              onClick={() => setFormOpen(false)}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {series.data?.length === 0 ? (
        <div className="panel">
          <p className="muted">Aún no hay series.</p>
        </div>
      ) : (
        <div className="series-list">
          {series.data?.map((item) => (
            <article className="panel" key={item.id}>
              <div className="panel-heading">
                <div>
                  <h2>{item.name}</h2>
                  <small className="cell-note">
                    {item.type} · {item.editions.length}{' '}
                    {item.editions.length === 1 ? 'edición' : 'ediciones'}
                  </small>
                </div>
                <div className="row-actions">
                  {can('events.edit') && (
                    <button
                      className="link-button"
                      type="button"
                      onClick={() => open(item)}
                    >
                      Editar
                    </button>
                  )}
                  {can('events.delete') && item.editions.length === 0 && (
                    <button
                      className="link-button danger"
                      type="button"
                      onClick={() => {
                        if (
                          window.confirm(`¿Borrar la serie "${item.name}"?`)
                        ) {
                          setNotice(undefined);
                          remove.mutate(item);
                        }
                      }}
                    >
                      Borrar
                    </button>
                  )}
                </div>
              </div>
              {item.editions.length > 0 && (
                <ul className="plain-list">
                  {item.editions.map((edition) => (
                    <li key={edition.id}>
                      <span>
                        <Link to={`/eventos/${edition.id}`}>
                          {edition.name}
                        </Link>
                        <small>Edición {edition.editionYear}</small>
                      </span>
                      <StatusBadge status={edition.status} />
                    </li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
