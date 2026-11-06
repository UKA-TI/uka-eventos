import { useMutation, useQuery } from '@tanstack/react-query';
import {
  fiscalDataSchema,
  publicEventResponseSchema,
  publicRegistrationResultSchema,
  publicRegistrationSchema,
  type PublicEvent,
  type PublicRegistrationResult,
} from '@uka/shared';
import { useState, type FormEvent } from 'react';
import { emptyFiscal, type FiscalDraft } from '../fiscal-draft.js';
import { FiscalFields } from '../OrderFinanceForms.js';
import { useParams, Link } from 'react-router-dom';
import { apiRequest, errorText } from '../../api.js';
import { Field, Loading, Notice } from '../../components/ui.js';
import { Icon } from '../../components/icons.js';
import { formatEventDate, formatMoney, issuesToErrors } from '../text.js';
import { PublicLayout } from './PublicLayout.js';

function Confirmation({
  event,
  result,
}: {
  event: PublicEvent;
  result: PublicRegistrationResult;
}) {
  const pending = result.status === 'pending_payment';
  const several = result.seats > 1;
  return (
    <div className="public-confirmation">
      <div className="public-confirmation-icon">
        <Icon name={pending ? 'wallet' : 'badge'} />
      </div>
      <h1>{pending ? 'Recibimos tu registro' : '¡Registro confirmado!'}</h1>
      <p className="muted">{event.name}</p>
      <dl className="data-list public-data">
        <div>
          <dt>Referencia</dt>
          <dd>{result.reference}</dd>
        </div>
        {pending && (
          <div>
            <dt>Total a pagar</dt>
            <dd>{formatMoney(result.amountDue, result.currency)}</dd>
          </div>
        )}
      </dl>
      {pending && (
        <>
          <p>
            {several
              ? `Tus ${result.seats} lugares quedan apartados. En cuanto registremos tu pago te enviaremos por correo una liga para registrar a cada invitado.`
              : 'Tu lugar queda apartado. Te enviaremos tu pase con código QR por correo en cuanto registremos tu pago.'}
          </p>
          {result.paymentInstructions && (
            <div className="instructions">
              <strong>Cómo pagar</strong>
              <p>{result.paymentInstructions}</p>
            </div>
          )}
        </>
      )}
      {result.passUrl && (
        <a className="button primary wide link-as-button" href={result.passUrl}>
          Ver mi pase
        </a>
      )}
      {result.groupUrl && (
        <a
          className="button primary wide link-as-button"
          href={result.groupUrl}
        >
          Registrar a mis invitados
        </a>
      )}
    </div>
  );
}

export function PublicRegisterPage() {
  const { slug = '' } = useParams();
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    organization: '',
    ticketTypeId: '',
    quantity: '1',
  });
  const [answers, setAnswers] = useState<Record<string, string | boolean>>({});
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [website, setWebsite] = useState('');
  const [wantsInvoice, setWantsInvoice] = useState(false);
  const [fiscal, setFiscal] = useState<FiscalDraft>(emptyFiscal);
  const [fiscalErrors, setFiscalErrors] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const event = useQuery({
    queryKey: ['public-event', slug],
    queryFn: async () =>
      publicEventResponseSchema.parse(
        await apiRequest(`/api/public/events/${slug}`),
      ),
  });

  const register = useMutation({
    mutationFn: async (body: unknown) =>
      publicRegistrationResultSchema.parse(
        await apiRequest(`/api/public/events/${slug}/register`, {
          method: 'POST',
          body: JSON.stringify(body),
        }),
      ),
  });

  if (event.isPending) {
    return <Loading />;
  }
  if (event.isError) {
    return (
      <PublicLayout>
        <h1>Registro no disponible</h1>
        <p className="muted">{event.error.message}</p>
      </PublicLayout>
    );
  }

  const data = event.data;
  const available = data.tickets.filter((ticket) => !ticket.soldOut);

  if (register.data) {
    return (
      <PublicLayout privacyUrl={data.privacyUrl}>
        <Confirmation event={data} result={register.data} />
      </PublicLayout>
    );
  }

  const selected =
    form.ticketTypeId || (available.length === 1 ? available[0]!.id : '');
  const chosen = data.tickets.find((ticket) => ticket.id === selected);
  const quantity = Math.max(1, Math.floor(Number(form.quantity)) || 1);
  const seats = (chosen?.seatsIncluded ?? 1) * quantity;

  const submit = (submitEvent: FormEvent) => {
    submitEvent.preventDefault();
    const problems: Record<string, string> = {};
    for (const field of data.fields) {
      if (field.required && !answers[field.id]) {
        problems[`field-${field.id}`] = 'Responde esta pregunta.';
      }
    }
    const parsed = publicRegistrationSchema.safeParse({
      ...form,
      ticketTypeId: selected,
      quantity: Number(form.quantity),
      organization: form.organization.trim() || null,
      fiscal: wantsInvoice ? fiscal : null,
      answers,
      privacyAccepted,
      marketingConsent,
      website,
    });
    if (!parsed.success) {
      Object.assign(problems, issuesToErrors(parsed.error.issues));
    }
    const fiscalCheck = wantsInvoice
      ? fiscalDataSchema.safeParse(fiscal)
      : null;
    setFiscalErrors(
      fiscalCheck && !fiscalCheck.success
        ? issuesToErrors(fiscalCheck.error.issues)
        : {},
    );
    setErrors(problems);
    if (parsed.success && Object.keys(problems).length === 0) {
      register.mutate(parsed.data);
    }
  };

  return (
    <PublicLayout privacyUrl={data.privacyUrl}>
      <div className="public-event-heading">
        <p className="public-eyebrow">Registro al evento</p>
        <h1>{data.name}</h1>
        <p className="public-event-meta">
          <Icon name="calendar" />
          <span>
            {formatEventDate(data.startsAt, data.timeZone, true)}
            {data.venue ? ` · ${data.venue}` : ''}
            {data.programStartsAt &&
              ` · Programa ${new Date(data.programStartsAt).toLocaleTimeString('es-MX', { timeZone: data.timeZone, timeStyle: 'short' })}`}
          </span>
        </p>
        {data.mapUrl && (
          <p className="event-links">
            <a href={data.mapUrl} target="_blank" rel="noreferrer">
              <Icon name="map" />
              Cómo llegar
            </a>
          </p>
        )}
        {data.description && (
          <p className="event-description">{data.description}</p>
        )}
      </div>
      <p className="form-note public-recover-link">
        ¿Ya te registraste?{' '}
        <Link to={`/recuperar/${slug}`}>Recuperar mi pase</Link>
      </p>

      {data.tickets.length > 0 && available.length === 0 ? (
        <Notice>Los boletos de este evento están agotados.</Notice>
      ) : data.tickets.length === 0 ? (
        <Notice>Por ahora no hay boletos a la venta.</Notice>
      ) : (
        <form className="public-register-form" onSubmit={submit} noValidate>
          {data.tickets.some((ticket) => ticket.price > 0) && (
            <p className="form-note">
              ¿Ya pagaste tu boleto por otro medio? No lo compres de nuevo:
              escríbenos a{' '}
              <a href="mailto:eventos@unkilodeayuda.org.mx">
                eventos@unkilodeayuda.org.mx
              </a>{' '}
              y te enviaremos tu invitación para registrarte.
            </p>
          )}
          <h2 className="form-section">
            <Icon name="badge" />
            Elige tu boleto
          </h2>
          {errors.ticketTypeId && (
            <small className="field-error">{errors.ticketTypeId}</small>
          )}
          <div className="ticket-options">
            {data.tickets.map((ticket) => (
              <label
                key={ticket.id}
                className={
                  ticket.soldOut
                    ? 'ticket-option disabled'
                    : selected === ticket.id
                      ? 'ticket-option active'
                      : 'ticket-option'
                }
              >
                <input
                  type="radio"
                  name="ticket"
                  disabled={ticket.soldOut}
                  checked={selected === ticket.id}
                  onChange={() => setForm({ ...form, ticketTypeId: ticket.id })}
                />
                <span>
                  <strong>{ticket.name}</strong>
                  {ticket.description && <small>{ticket.description}</small>}
                  {ticket.seatsIncluded > 1 && (
                    <small>Incluye {ticket.seatsIncluded} lugares.</small>
                  )}
                </span>
                <b>
                  {ticket.soldOut
                    ? 'Agotado'
                    : formatMoney(ticket.price, data.currency)}
                </b>
              </label>
            ))}
          </div>

          {chosen && (
            <div className="quantity-row">
              <label className="field quantity-field">
                <span>¿Cuántos boletos?</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max={data.maxQuantity}
                  value={form.quantity}
                  onChange={(e) =>
                    setForm({ ...form, quantity: e.target.value })
                  }
                />
                {errors.quantity && (
                  <small className="field-error">{errors.quantity}</small>
                )}
              </label>
              <p className="quantity-summary">
                {seats > 1 ? (
                  <>
                    <strong>{seats} lugares</strong>
                    {chosen.price > 0 && (
                      <>
                        {' '}
                        · Total{' '}
                        {formatMoney(chosen.price * quantity, data.currency)}
                      </>
                    )}
                    <small>
                      {chosen.price > 0
                        ? 'Cuando registremos tu pago te enviaremos una liga para registrar a cada invitado. Cada quien recibe su propio pase.'
                        : 'Recibirás una liga para registrar a cada invitado. Cada quien recibe su propio pase.'}
                    </small>
                  </>
                ) : (
                  <small>Un lugar, a tu nombre.</small>
                )}
              </p>
            </div>
          )}

          <h2 className="form-section">
            <Icon name="contacts" />
            Tus datos
          </h2>
          <div className="form-grid">
            <Field label="Nombre" error={errors.firstName}>
              <input
                autoComplete="given-name"
                value={form.firstName}
                onChange={(e) =>
                  setForm({ ...form, firstName: e.target.value })
                }
              />
            </Field>
            <Field label="Apellidos" error={errors.lastName}>
              <input
                autoComplete="family-name"
                value={form.lastName}
                onChange={(e) => setForm({ ...form, lastName: e.target.value })}
              />
            </Field>
            <Field label="Correo" error={errors.email}>
              <input
                type="email"
                autoComplete="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>
            <Field label="Teléfono" error={errors.phone}>
              <input
                type="tel"
                autoComplete="tel"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </Field>
            <Field label="Empresa u organización (opcional)">
              <input
                autoComplete="organization"
                value={form.organization}
                onChange={(e) =>
                  setForm({ ...form, organization: e.target.value })
                }
              />
            </Field>
            {data.fields.map((field) =>
              field.type === 'checkbox' ? (
                <label className="check-field" key={field.id}>
                  <input
                    type="checkbox"
                    checked={answers[field.id] === true}
                    onChange={(e) =>
                      setAnswers({ ...answers, [field.id]: e.target.checked })
                    }
                  />
                  {field.label}
                </label>
              ) : (
                <Field
                  key={field.id}
                  label={
                    field.required ? field.label : `${field.label} (opcional)`
                  }
                  hint={field.helpText ?? undefined}
                  error={errors[`field-${field.id}`]}
                >
                  {field.type === 'select' ? (
                    <select
                      value={String(answers[field.id] ?? '')}
                      onChange={(e) =>
                        setAnswers({ ...answers, [field.id]: e.target.value })
                      }
                    >
                      <option value="">Selecciona una opción</option>
                      {field.options.map((option) => (
                        <option key={option}>{option}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={field.type}
                      value={String(answers[field.id] ?? '')}
                      onChange={(e) =>
                        setAnswers({ ...answers, [field.id]: e.target.value })
                      }
                    />
                  )}
                </Field>
              ),
            )}
          </div>

          <div className="honeypot" aria-hidden="true">
            <label>
              Sitio web
              <input
                tabIndex={-1}
                autoComplete="off"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
              />
            </label>
          </div>

          {data.tickets.find((ticket) => ticket.id === selected)?.price ? (
            <>
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={wantsInvoice}
                  onChange={(e) => setWantsInvoice(e.target.checked)}
                />
                <span>Requiero factura</span>
              </label>
              {wantsInvoice && (
                <FiscalFields
                  value={fiscal}
                  errors={fiscalErrors}
                  onChange={setFiscal}
                />
              )}
              {data.cancellationPolicy && (
                <details className="policy-note">
                  <summary>Política de cancelación</summary>
                  <p>{data.cancellationPolicy}</p>
                </details>
              )}
            </>
          ) : null}

          <label className="check-field privacy-check">
            <input
              type="checkbox"
              checked={privacyAccepted}
              onChange={(e) => setPrivacyAccepted(e.target.checked)}
            />
            <span>
              He leído y acepto el{' '}
              <a href={data.privacyUrl} target="_blank" rel="noreferrer">
                aviso de privacidad
              </a>
              .
            </span>
          </label>
          {errors.privacyAccepted && (
            <small className="field-error">{errors.privacyAccepted}</small>
          )}
          <label className="check-field privacy-check">
            <input
              type="checkbox"
              checked={marketingConsent}
              onChange={(e) => setMarketingConsent(e.target.checked)}
            />
            <span>
              Quiero recibir información sobre eventos y campañas de Un Kilo de
              Ayuda (opcional). Puedo darme de baja en cualquier momento.
            </span>
          </label>

          {register.isError && (
            <Notice>
              {errorText(register.error, 'No se pudo completar tu registro.')}
            </Notice>
          )}
          <div className="form-actions">
            <button
              className="button primary wide"
              type="submit"
              disabled={register.isPending}
            >
              {register.isPending ? 'Enviando…' : 'Registrarme'}
            </button>
          </div>
        </form>
      )}
    </PublicLayout>
  );
}
