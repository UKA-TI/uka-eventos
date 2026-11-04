import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  contactListResponseSchema,
  donationInputSchema,
  donationListResponseSchema,
  donationMethodOptions,
  donationVoidSchema,
} from '@uka/shared';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest, errorText, jsonRequest } from '../../api.js';
import { usePermissions } from '../../auth/session.js';
import { Field, Loading, Notice, PageHeading } from '../../components/ui.js';
import { formatAmount, issuesToErrors } from '../text.js';
import { useCrmOptions } from './crm.js';

const todayInput = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
};

function ContactPicker({
  value,
  onChange,
}: {
  value: { id: string; name: string } | null;
  onChange: (value: { id: string; name: string } | null) => void;
}) {
  const [term, setTerm] = useState('');
  const results = useQuery({
    queryKey: ['contact-search', term],
    enabled: term.trim().length >= 2,
    queryFn: async () =>
      contactListResponseSchema.parse(
        await apiRequest(`/api/contacts?q=${encodeURIComponent(term.trim())}`),
      ),
  });
  if (value) {
    return (
      <div className="picked">
        <strong>{value.name}</strong>
        <button
          className="link-button"
          type="button"
          onClick={() => onChange(null)}
        >
          Cambiar
        </button>
      </div>
    );
  }
  return (
    <>
      <input
        type="search"
        placeholder="Escribe un nombre o correo"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
      />
      {results.data && (
        <ul className="picker-results">
          {results.data.contacts.slice(0, 6).map((contact) => (
            <li key={contact.id}>
              <button
                className="link-button"
                type="button"
                onClick={() =>
                  onChange({
                    id: contact.id,
                    name: `${contact.firstName} ${contact.lastName}`,
                  })
                }
              >
                {contact.firstName} {contact.lastName}
              </button>
              <small>{contact.email ?? contact.company?.name}</small>
            </li>
          ))}
          {results.data.contacts.length === 0 && (
            <li>
              <small>Sin resultados.</small>
            </li>
          )}
        </ul>
      )}
    </>
  );
}

export function DonationForm({
  contactId,
  contactName,
  onCancel,
  onDone,
}: {
  contactId?: string;
  contactName?: string;
  onCancel: () => void;
  onDone: () => void | Promise<void>;
}) {
  const { can, csrfToken } = usePermissions();
  const options = useCrmOptions();
  const [contact, setContact] = useState(
    contactId && contactName ? { id: contactId, name: contactName } : null,
  );
  const [form, setForm] = useState({
    companyId: '',
    eventId: '',
    amount: '',
    method: 'transfer',
    reference: '',
    notes: '',
    receivedAt: todayInput(),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  const save = useMutation({
    mutationFn: async (input: unknown) =>
      apiRequest('/api/donations', jsonRequest('POST', input, csrfToken)),
    onSuccess: () => onDone(),
    onError: (failure) =>
      setError(errorText(failure, 'No se pudo registrar el donativo.')),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    const parsed = donationInputSchema.safeParse({
      contactId: contact?.id ?? null,
      companyId: form.companyId || null,
      eventId: form.eventId || null,
      amount: form.amount === '' ? undefined : Number(form.amount),
      method: form.method,
      reference: form.reference.trim() || null,
      notes: form.notes.trim() || null,
      // Mediodía local: la fecha elegida no cambia al convertirla a UTC.
      receivedAt: new Date(`${form.receivedAt}T12:00:00`).toISOString(),
    });
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    save.mutate(parsed.data);
  };

  return (
    <form className="inner-form" onSubmit={submit} noValidate>
      <Notice>{error}</Notice>
      <div className="form-grid">
        {!contactId && can('contacts.view', 'contacts.manage') && (
          <Field label="Contacto" hint="Déjalo vacío si es anónimo.">
            <ContactPicker value={contact} onChange={setContact} />
          </Field>
        )}
        <Field label="Empresa" error={errors.companyId}>
          <select
            value={form.companyId}
            onChange={(e) => setForm({ ...form, companyId: e.target.value })}
          >
            <option value="">Sin empresa</option>
            {options.data?.companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Evento" error={errors.eventId}>
          <select
            value={form.eventId}
            onChange={(e) => setForm({ ...form, eventId: e.target.value })}
          >
            <option value="">Sin evento</option>
            {options.data?.events.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Monto (MXN)" error={errors.amount}>
          <input
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
          />
        </Field>
        <Field label="Forma" error={errors.method}>
          <select
            value={form.method}
            onChange={(e) => setForm({ ...form, method: e.target.value })}
          >
            {donationMethodOptions.map((method) => (
              <option key={method.key} value={method.key}>
                {method.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Fecha" error={errors.receivedAt}>
          <input
            type="date"
            value={form.receivedAt}
            onChange={(e) => setForm({ ...form, receivedAt: e.target.value })}
          />
        </Field>
        <Field label="Referencia" error={errors.reference}>
          <input
            value={form.reference}
            onChange={(e) => setForm({ ...form, reference: e.target.value })}
          />
        </Field>
        <Field label="Notas" error={errors.notes}>
          <input
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </Field>
      </div>
      <div className="form-actions">
        <button
          className="button primary"
          type="submit"
          disabled={save.isPending}
        >
          {save.isPending ? 'Guardando…' : 'Registrar donativo'}
        </button>
        <button className="button secondary" type="button" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

export function DonationsPage() {
  const queryClient = useQueryClient();
  const { can, csrfToken } = usePermissions();
  const options = useCrmOptions();
  const [page, setPage] = useState(1);
  const [eventId, setEventId] = useState('');
  const [year, setYear] = useState('');
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<{
    kind: 'ok' | 'error';
    text: string;
  }>();

  const query = new URLSearchParams({ page: String(page) });
  if (eventId) {
    query.set('eventId', eventId);
  }
  if (year) {
    query.set('year', year);
  }
  const donations = useQuery({
    queryKey: ['donations', query.toString()],
    queryFn: async () =>
      donationListResponseSchema.parse(
        await apiRequest(`/api/donations?${query.toString()}`),
      ),
    placeholderData: keepPreviousData,
  });

  const voidDonation = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: unknown }) =>
      apiRequest(
        `/api/donations/${id}/void`,
        jsonRequest('POST', body, csrfToken),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['donations'] });
      setNotice({ kind: 'ok', text: 'Donativo anulado.' });
    },
    onError: (error) =>
      setNotice({
        kind: 'error',
        text: errorText(error, 'No se pudo anular el donativo.'),
      }),
  });

  if (donations.isPending) {
    return <Loading />;
  }

  const data = donations.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 6 }, (_, index) => currentYear - index);
  const methodLabel = (key: string) =>
    donationMethodOptions.find((method) => method.key === key)?.label ?? key;

  return (
    <section>
      <PageHeading
        title="Donativos"
        description="Registro manual mientras se define la plataforma de donativos en línea."
        action={
          can('donations.manage') &&
          !creating && (
            <button
              className="button primary"
              type="button"
              onClick={() => {
                setNotice(undefined);
                setCreating(true);
              }}
            >
              Registrar donativo
            </button>
          )
        }
      />
      {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}
      {donations.isError && <Notice>{donations.error.message}</Notice>}

      {creating && (
        <div className="panel">
          <DonationForm
            onCancel={() => setCreating(false)}
            onDone={async () => {
              setCreating(false);
              await queryClient.invalidateQueries({ queryKey: ['donations'] });
              setNotice({ kind: 'ok', text: 'Donativo registrado.' });
            }}
          />
        </div>
      )}

      {can('reports.export') && (
        <div className="section-actions">
          <a
            className="button secondary small"
            href={`/api/reports/export/donations.csv?${new URLSearchParams({
              ...(eventId ? { eventId } : {}),
              ...(year ? { year } : {}),
            }).toString()}`}
          >
            Descargar donativos
          </a>
        </div>
      )}

      {data && (
        <div className="stats">
          <article className="stat">
            <span>Total recibido</span>
            <strong>{formatAmount(data.totalAmount)}</strong>
          </article>
          <article className="stat">
            <span>Donativos</span>
            <strong>{data.count.toLocaleString('es-MX')}</strong>
          </article>
        </div>
      )}

      <div className="filters">
        <select
          aria-label="Filtrar por evento"
          value={eventId}
          onChange={(e) => {
            setEventId(e.target.value);
            setPage(1);
          }}
        >
          <option value="">Todos los eventos</option>
          {options.data?.events.map((event) => (
            <option key={event.id} value={event.id}>
              {event.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Filtrar por año"
          value={year}
          onChange={(e) => {
            setYear(e.target.value);
            setPage(1);
          }}
        >
          <option value="">Todos los años</option>
          {years.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </div>

      <div className="panel table-panel">
        {data?.donations.length === 0 ? (
          <p className="muted">No hay donativos registrados.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Donante</th>
                  <th>Evento</th>
                  <th>Monto</th>
                  <th>Forma</th>
                  <th aria-label="Acciones" />
                </tr>
              </thead>
              <tbody>
                {data?.donations.map((donation) => (
                  <tr key={donation.id}>
                    <td>
                      {new Date(donation.receivedAt).toLocaleDateString(
                        'es-MX',
                        { dateStyle: 'medium' },
                      )}
                    </td>
                    <td>
                      {donation.contact ? (
                        can('contacts.view', 'contacts.manage') ? (
                          <Link to={`/contactos/${donation.contact.id}`}>
                            {donation.contact.name}
                          </Link>
                        ) : (
                          donation.contact.name
                        )
                      ) : donation.company ? (
                        ''
                      ) : (
                        'Anónimo'
                      )}
                      {donation.company && (
                        <small className="cell-note">
                          {donation.company.name}
                        </small>
                      )}
                    </td>
                    <td>{donation.event?.name ?? '—'}</td>
                    <td>
                      {formatAmount(donation.amount, donation.currency)}
                      {donation.voidedAt && (
                        <small className="cell-note">
                          <span className="badge bad">Anulado</span>{' '}
                          {donation.voidReason}
                        </small>
                      )}
                    </td>
                    <td>
                      {methodLabel(donation.method)}
                      {donation.reference && (
                        <small className="cell-note">
                          {donation.reference}
                        </small>
                      )}
                    </td>
                    <td>
                      {can('donations.manage') && !donation.voidedAt && (
                        <div className="row-actions">
                          <button
                            className="link-button danger"
                            type="button"
                            onClick={() => {
                              const reason = window.prompt(
                                'Motivo de la anulación:',
                              );
                              if (reason === null) {
                                return;
                              }
                              setNotice(undefined);
                              const parsed = donationVoidSchema.safeParse({
                                reason,
                              });
                              if (!parsed.success) {
                                setNotice({
                                  kind: 'error',
                                  text:
                                    parsed.error.issues[0]?.message ??
                                    'Escribe el motivo.',
                                });
                                return;
                              }
                              voidDonation.mutate({
                                id: donation.id,
                                body: parsed.data,
                              });
                            }}
                          >
                            Anular
                          </button>
                        </div>
                      )}
                    </td>
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
