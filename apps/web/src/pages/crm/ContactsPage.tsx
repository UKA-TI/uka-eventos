import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  contactListResponseSchema,
  contactSummarySchema,
  participationOptions,
  segmentInputSchema,
  type CrmOptions,
  type SegmentFilters,
} from '@uka/shared';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { apiRequest, errorText, jsonRequest } from '../../api.js';
import { usePermissions } from '../../auth/session.js';
import { Field, Loading, Notice, PageHeading } from '../../components/ui.js';
import { ContactForm } from './ContactForm.js';
import { emptyContactForm, parseContactForm, useCrmOptions } from './crm.js';

function filtersFromParams(params: URLSearchParams): SegmentFilters {
  const text = (key: string) => params.get(key) || undefined;
  const participation = participationOptions.find(
    ({ key }) => key === params.get('participation'),
  )?.key;
  const year = Number(params.get('editionYear'));
  return {
    q: text('q'),
    companyId: text('companyId'),
    eventType: text('eventType'),
    seriesId: text('seriesId'),
    eventId: text('eventId'),
    editionYear: year || undefined,
    participation,
    donor: params.get('donor') === 'true' || undefined,
    reachable: params.get('reachable') === 'true' || undefined,
  };
}

function FilterBar({
  options,
  params,
  update,
}: {
  options: CrmOptions;
  params: URLSearchParams;
  update: (key: string, value: string) => void;
}) {
  const select = (
    key: string,
    label: string,
    items: { value: string; label: string }[],
  ) => (
    <label className="filter-field">
      <span>{label}</span>
      <select
        aria-label={label}
        value={params.get(key) ?? ''}
        onChange={(e) => update(key, e.target.value)}
      >
        <option value="">{label}</option>
        {items.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="filters">
      <label className="filter-field filter-search">
        <span>Buscar contacto</span>
        <input
          type="search"
          placeholder="Buscar por nombre, correo, teléfono o empresa"
          aria-label="Buscar contacto"
          value={params.get('q') ?? ''}
          onChange={(e) => update('q', e.target.value)}
        />
      </label>
      {select(
        'companyId',
        'Empresa',
        options.companies.map(({ id, name }) => ({ value: id, label: name })),
      )}
      {select(
        'eventType',
        'Tipo de evento',
        options.eventTypes.map((type) => ({ value: type, label: type })),
      )}
      {select(
        'seriesId',
        'Serie',
        options.series.map(({ id, name }) => ({ value: id, label: name })),
      )}
      {select(
        'editionYear',
        'Año',
        options.years.map((year) => ({
          value: String(year),
          label: String(year),
        })),
      )}
      {select(
        'eventId',
        'Evento',
        options.events.map(({ id, name }) => ({ value: id, label: name })),
      )}
      {select(
        'participation',
        'Participación',
        participationOptions
          .filter(({ key }) => key !== 'any')
          .map(({ key, label }) => ({ value: key, label })),
      )}
      {select('donor', 'Donantes', [{ value: 'true', label: 'Solo donantes' }])}
      {select('reachable', 'Comunicaciones', [
        { value: 'true', label: 'Aceptan comunicaciones' },
      ])}
    </div>
  );
}

export function ContactsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { can, csrfToken } = usePermissions();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyContactForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [savingSegment, setSavingSegment] = useState(false);
  const [segmentName, setSegmentName] = useState('');
  const [notice, setNotice] = useState<{
    kind: 'ok' | 'error';
    text: string;
  }>();

  const page = Number(params.get('page')) || 1;
  const filters = filtersFromParams(params);
  const hasFilters = Object.values(filters).some(Boolean);
  const options = useCrmOptions();

  const contacts = useQuery({
    queryKey: ['contacts', params.toString()],
    queryFn: async () =>
      contactListResponseSchema.parse(
        await apiRequest(`/api/contacts?${params.toString()}`),
      ),
    placeholderData: keepPreviousData,
  });

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) {
      next.set(key, value);
    } else {
      next.delete(key);
    }
    next.delete('page');
    setParams(next, { replace: true });
  };

  const setPage = (value: number) => {
    const next = new URLSearchParams(params);
    next.set('page', String(value));
    setParams(next);
  };

  const create = useMutation({
    mutationFn: async (input: unknown) =>
      contactSummarySchema.parse(
        await apiRequest(
          '/api/contacts',
          jsonRequest('POST', input, csrfToken),
        ),
      ),
    onSuccess: async (contact) => {
      await queryClient.invalidateQueries({ queryKey: ['contacts'] });
      navigate(`/contactos/${contact.id}`);
    },
    onError: (error) =>
      setNotice({
        kind: 'error',
        text: errorText(error, 'No se pudo guardar el contacto.'),
      }),
  });

  const saveSegment = useMutation({
    mutationFn: async (input: unknown) =>
      apiRequest('/api/segments', jsonRequest('POST', input, csrfToken)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['segments'] });
      setSavingSegment(false);
      setSegmentName('');
      setNotice({ kind: 'ok', text: 'Segmento guardado.' });
    },
    onError: (error) =>
      setNotice({
        kind: 'error',
        text: errorText(error, 'No se pudo guardar el segmento.'),
      }),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setNotice(undefined);
    const parsed = parseContactForm(form);
    if (!parsed.success) {
      setErrors(parsed.errors);
      return;
    }
    setErrors({});
    create.mutate(parsed.data);
  };

  const submitSegment = (event: FormEvent) => {
    event.preventDefault();
    setNotice(undefined);
    const parsed = segmentInputSchema.safeParse({
      name: segmentName,
      description: null,
      filters: JSON.parse(JSON.stringify(filters)) as unknown,
    });
    if (!parsed.success) {
      setNotice({
        kind: 'error',
        text: parsed.error.issues[0]?.message ?? 'Revisa el nombre.',
      });
      return;
    }
    saveSegment.mutate(parsed.data);
  };

  if (contacts.isPending || options.isPending) {
    return <Loading />;
  }

  const data = contacts.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <section>
      <PageHeading
        title="Contactos"
        description="Las personas que se registran se agregan solas, sin duplicarse por correo."
        action={
          can('contacts.manage') &&
          !creating && (
            <button
              className="button primary"
              type="button"
              onClick={() => {
                setForm(emptyContactForm);
                setErrors({});
                setNotice(undefined);
                setCreating(true);
              }}
            >
              Nuevo contacto
            </button>
          )
        }
      />
      {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}
      {contacts.isError && <Notice>{contacts.error.message}</Notice>}
      {options.isError && <Notice>{options.error.message}</Notice>}

      {creating && options.data && (
        <form className="panel" onSubmit={submit} noValidate>
          <div className="panel-heading">
            <h2>Nuevo contacto</h2>
          </div>
          <ContactForm
            form={form}
            setForm={setForm}
            errors={errors}
            companies={options.data.companies}
          />
          <div className="form-actions">
            <button
              className="button primary"
              type="submit"
              disabled={create.isPending}
            >
              {create.isPending ? 'Guardando…' : 'Guardar contacto'}
            </button>
            <button
              className="button secondary"
              type="button"
              onClick={() => setCreating(false)}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {options.data && (
        <FilterBar options={options.data} params={params} update={update} />
      )}

      {data && (
        <p className="table-note">
          {data.total.toLocaleString('es-MX')}{' '}
          {data.total === 1 ? 'contacto' : 'contactos'} ·{' '}
          {data.reachable.toLocaleString('es-MX')} aceptan comunicaciones
          {can('reports.export') && data.total > 0 && (
            <>
              {' · '}
              <a
                href={`/api/reports/export/contacts.csv?${(() => {
                  const query = new URLSearchParams(params);
                  query.delete('page');
                  return query.toString();
                })()}`}
              >
                Descargar lista
              </a>
            </>
          )}
          {hasFilters && (
            <>
              {' · '}
              <button
                className="link-button"
                type="button"
                onClick={() => setParams(new URLSearchParams())}
              >
                Quitar filtros
              </button>
              {can('contacts.manage') && !savingSegment && (
                <>
                  {' · '}
                  <button
                    className="link-button"
                    type="button"
                    onClick={() => setSavingSegment(true)}
                  >
                    Guardar como segmento
                  </button>
                </>
              )}
            </>
          )}
        </p>
      )}

      {savingSegment && (
        <form className="panel inline-form" onSubmit={submitSegment} noValidate>
          <Field label="Nombre del segmento">
            <input
              value={segmentName}
              onChange={(e) => setSegmentName(e.target.value)}
            />
          </Field>
          <div className="form-actions">
            <button
              className="button primary"
              type="submit"
              disabled={saveSegment.isPending}
            >
              Guardar segmento
            </button>
            <button
              className="button secondary"
              type="button"
              onClick={() => setSavingSegment(false)}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      <div className="panel table-panel">
        {data?.contacts.length === 0 ? (
          <p className="muted">
            {hasFilters
              ? 'Ningún contacto coincide con los filtros.'
              : 'Aún no hay contactos.'}
          </p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Empresa</th>
                  <th>Correo</th>
                  <th>Teléfono</th>
                  <th>Participaciones</th>
                </tr>
              </thead>
              <tbody>
                {data?.contacts.map((contact) => (
                  <tr key={contact.id}>
                    <td>
                      <Link to={`/contactos/${contact.id}`}>
                        <strong>
                          {contact.firstName} {contact.lastName}
                        </strong>
                      </Link>
                      {contact.position && (
                        <small className="cell-note">{contact.position}</small>
                      )}
                    </td>
                    <td>{contact.company?.name ?? '—'}</td>
                    <td>
                      {contact.email ?? '—'}
                      {contact.optedOutAt && (
                        <small className="cell-note">
                          <span className="badge bad">Dado de baja</span>
                        </small>
                      )}
                    </td>
                    <td>{contact.phone ?? '—'}</td>
                    <td>{contact.participations}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {pages > 1 && (
        <div className="pagination">
          <button
            className="button secondary small"
            type="button"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            Anterior
          </button>
          <span>
            Página {page} de {pages}
          </span>
          <button
            className="button secondary small"
            type="button"
            disabled={page >= pages}
            onClick={() => setPage(page + 1)}
          >
            Siguiente
          </button>
        </div>
      )}
    </section>
  );
}
