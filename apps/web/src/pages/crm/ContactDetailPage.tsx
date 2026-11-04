import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  contactDetailResponseSchema,
  contactNoteInputSchema,
} from '@uka/shared';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { apiRequest, errorText, jsonRequest } from '../../api.js';
import { usePermissions } from '../../auth/session.js';
import { Loading, Notice, PageHeading } from '../../components/ui.js';
import { formatAmount } from '../text.js';
import { ContactForm } from './ContactForm.js';
import {
  emptyContactForm,
  historyStatus,
  messageKindLabel,
  messageStatus,
  parseContactForm,
  useCrmOptions,
} from './crm.js';
import { DonationForm } from './DonationsPage.js';

const shortDate = (value: string) =>
  new Date(value).toLocaleDateString('es-MX', { dateStyle: 'medium' });

export function ContactDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can, csrfToken } = usePermissions();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(emptyContactForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [addingDonation, setAddingDonation] = useState(false);
  const [notice, setNotice] = useState<{
    kind: 'ok' | 'error';
    text: string;
  }>();
  const options = useCrmOptions();

  const contact = useQuery({
    queryKey: ['contact', id],
    queryFn: async () =>
      contactDetailResponseSchema.parse(
        await apiRequest(`/api/contacts/${id}`),
      ),
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['contact', id] });
    await queryClient.invalidateQueries({ queryKey: ['contacts'] });
  };

  const act = useMutation({
    mutationFn: async (action: {
      path: string;
      method?: 'POST' | 'PUT' | 'DELETE';
      body?: unknown;
      success: string;
    }) =>
      apiRequest(
        `/api/contacts/${id}${action.path}`,
        jsonRequest(action.method ?? 'POST', action.body, csrfToken),
      ),
    onSuccess: async (_result, action) => {
      if (action.method === 'DELETE' && action.path === '') {
        await queryClient.invalidateQueries({ queryKey: ['contacts'] });
        navigate('/contactos');
        return;
      }
      await refresh();
      setEditing(false);
      setNotice({ kind: 'ok', text: action.success });
    },
    onError: (error) =>
      setNotice({
        kind: 'error',
        text: errorText(error, 'No se pudo completar la acción.'),
      }),
  });

  if (contact.isPending) {
    return <Loading />;
  }
  if (contact.isError) {
    return <Notice>{contact.error.message}</Notice>;
  }

  const data = contact.data;
  const canManage = can('contacts.manage');
  const attended = data.history.filter((item) => item.attended).length;
  const activeDonations = data.donations.filter((item) => !item.voidedAt);

  const openEdit = () => {
    setForm({
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email ?? '',
      phone: data.phone ?? '',
      position: data.position ?? '',
      companyId: data.company?.id ?? '',
    });
    setErrors({});
    setNotice(undefined);
    setEditing(true);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setNotice(undefined);
    const parsed = parseContactForm(form);
    if (!parsed.success) {
      setErrors(parsed.errors);
      return;
    }
    setErrors({});
    act.mutate({
      path: '',
      method: 'PUT',
      body: parsed.data,
      success: 'Contacto actualizado.',
    });
  };

  const submitNote = (event: FormEvent) => {
    event.preventDefault();
    setNotice(undefined);
    const parsed = contactNoteInputSchema.safeParse({ body: note });
    if (!parsed.success) {
      setNotice({
        kind: 'error',
        text: parsed.error.issues[0]?.message ?? 'Escribe la nota.',
      });
      return;
    }
    act.mutate(
      { path: '/notes', body: parsed.data, success: 'Nota agregada.' },
      { onSuccess: () => setNote('') },
    );
  };

  return (
    <section>
      <Link className="back-link" to="/contactos">
        Contactos
      </Link>
      <PageHeading
        title={`${data.firstName} ${data.lastName}`}
        description={
          [data.position, data.company?.name].filter(Boolean).join(' · ') ||
          undefined
        }
        action={
          canManage &&
          !editing && (
            <div className="heading-actions">
              <button
                className="button secondary"
                type="button"
                onClick={openEdit}
              >
                Editar
              </button>
              {data.history.length === 0 && data.donations.length === 0 && (
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => {
                    if (window.confirm('¿Borrar este contacto?')) {
                      act.mutate({
                        path: '',
                        method: 'DELETE',
                        success: 'Contacto borrado.',
                      });
                    }
                  }}
                >
                  Borrar
                </button>
              )}
            </div>
          )
        }
      />
      {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}
      {data.optedOutAt && (
        <p className="notice warn" role="status">
          Pidió no recibir comunicaciones el {shortDate(data.optedOutAt)}. Sigue
          recibiendo sus pases y avisos de pago.
        </p>
      )}

      {editing && options.data && (
        <form className="panel" onSubmit={submit} noValidate>
          <div className="panel-heading">
            <h2>Editar contacto</h2>
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
              disabled={act.isPending}
            >
              Guardar cambios
            </button>
            <button
              className="button secondary"
              type="button"
              onClick={() => setEditing(false)}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      <div className="stats">
        <article className="stat">
          <span>Participaciones</span>
          <strong>{data.history.length}</strong>
        </article>
        <article className="stat">
          <span>Asistencias</span>
          <strong>{attended}</strong>
        </article>
        {can('donations.view', 'donations.manage') && (
          <article className="stat">
            <span>Donado</span>
            <strong>
              {formatAmount(
                activeDonations.reduce((sum, item) => sum + item.amount, 0),
              )}
            </strong>
          </article>
        )}
      </div>

      <div className="panel">
        <div className="panel-heading">
          <h2>Datos de contacto</h2>
          {canManage && (
            <button
              className="link-button"
              type="button"
              disabled={act.isPending}
              onClick={() => {
                setNotice(undefined);
                if (data.optedOutAt) {
                  if (
                    window.confirm(
                      'Vuelve a activar las comunicaciones solo si esta persona lo pidió. ¿Continuar?',
                    )
                  ) {
                    act.mutate({
                      path: '/opt-in',
                      success: 'Comunicaciones activadas.',
                    });
                  }
                } else {
                  act.mutate({
                    path: '/opt-out',
                    success: 'Se registró la baja de comunicaciones.',
                  });
                }
              }}
            >
              {data.optedOutAt
                ? 'Reactivar comunicaciones'
                : 'Registrar baja de comunicaciones'}
            </button>
          )}
        </div>
        <dl className="data-list">
          <div>
            <dt>Correo</dt>
            <dd>{data.email ?? 'Sin correo'}</dd>
          </div>
          <div>
            <dt>Teléfono</dt>
            <dd>{data.phone ?? 'Sin teléfono'}</dd>
          </div>
          <div>
            <dt>Origen</dt>
            <dd>
              {data.source === 'registration'
                ? 'Registro a un evento'
                : 'Captura manual'}
            </dd>
          </div>
        </dl>
      </div>

      <div className="panel table-panel">
        <div className="panel-heading">
          <h2>Historial en eventos</h2>
        </div>
        {data.history.length === 0 ? (
          <p className="muted">Aún no participa en ningún evento.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Evento</th>
                  <th>Boleto</th>
                  <th>Folio</th>
                  <th>Estado</th>
                  <th>Asistió</th>
                </tr>
              </thead>
              <tbody>
                {data.history.map((item) => {
                  const [label, tone] = historyStatus(item.status);
                  return (
                    <tr key={item.id}>
                      <td>
                        {can('events.view', 'events.edit') ? (
                          <Link to={`/eventos/${item.eventId}`}>
                            {item.eventName}
                          </Link>
                        ) : (
                          item.eventName
                        )}
                        <small className="cell-note">
                          Edición {item.editionYear}
                          {item.role === 'buyer' ? ' · Compró lugares' : ''}
                        </small>
                      </td>
                      <td>{item.ticketName}</td>
                      <td>{item.reference}</td>
                      <td>
                        <span className={`badge ${tone}`}>{label}</span>
                      </td>
                      <td>{item.attended ? 'Sí' : 'No'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {can('donations.view', 'donations.manage') && (
        <div className="panel">
          <div className="panel-heading">
            <h2>Donativos</h2>
            {can('donations.manage') && !addingDonation && (
              <button
                className="link-button"
                type="button"
                onClick={() => setAddingDonation(true)}
              >
                Registrar donativo
              </button>
            )}
          </div>
          {addingDonation && (
            <DonationForm
              contactId={data.id}
              contactName={`${data.firstName} ${data.lastName}`}
              onCancel={() => setAddingDonation(false)}
              onDone={async () => {
                setAddingDonation(false);
                await refresh();
                await queryClient.invalidateQueries({
                  queryKey: ['donations'],
                });
                setNotice({ kind: 'ok', text: 'Donativo registrado.' });
              }}
            />
          )}
          {data.donations.length === 0 ? (
            <p className="muted">Sin donativos registrados.</p>
          ) : (
            <ul className="plain-list">
              {data.donations.map((donation) => (
                <li key={donation.id}>
                  <span>
                    {formatAmount(donation.amount, donation.currency)}
                    <small>
                      {shortDate(donation.receivedAt)}
                      {donation.event ? ` · ${donation.event.name}` : ''}
                    </small>
                  </span>
                  {donation.voidedAt && (
                    <span className="badge bad">Anulado</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="panel">
        <div className="panel-heading">
          <h2>Notas</h2>
        </div>
        {canManage && (
          <form onSubmit={submitNote} noValidate>
            <textarea
              className="note-input"
              rows={3}
              aria-label="Nueva nota"
              placeholder="Por ejemplo: prefiere que le escribamos a su asistente."
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="form-actions">
              <button
                className="button secondary small"
                type="submit"
                disabled={act.isPending}
              >
                Agregar nota
              </button>
            </div>
          </form>
        )}
        {data.notes.length === 0 ? (
          <p className="muted">Sin notas.</p>
        ) : (
          <ul className="plain-list">
            {data.notes.map((item) => (
              <li key={item.id}>
                <span>
                  <span className="note-body">{item.body}</span>
                  <small>
                    {item.author ?? 'Usuario eliminado'} ·{' '}
                    {shortDate(item.createdAt)}
                  </small>
                </span>
                {canManage && (
                  <button
                    className="link-button danger"
                    type="button"
                    onClick={() => {
                      if (window.confirm('¿Borrar esta nota?')) {
                        act.mutate({
                          path: `/notes/${item.id}`,
                          method: 'DELETE',
                          success: 'Nota borrada.',
                        });
                      }
                    }}
                  >
                    Borrar
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="panel">
        <div className="panel-heading">
          <h2>Correos enviados</h2>
        </div>
        {data.messages.length === 0 ? (
          <p className="muted">Aún no se le ha escrito.</p>
        ) : (
          <ul className="plain-list">
            {data.messages.map((message) => {
              const [label, tone] = messageStatus(message.status);
              return (
                <li key={message.id}>
                  <span>
                    {messageKindLabel(message.kind)}
                    <small>
                      {shortDate(message.sentAt ?? message.createdAt)}
                    </small>
                  </span>
                  <span className={`badge ${tone}`}>{label}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
