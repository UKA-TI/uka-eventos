import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  campaignInputSchema,
  campaignPreviewResponseSchema,
  campaignResponseSchema,
  type CampaignRecord,
} from '@uka/shared';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { apiRequest, errorText, jsonRequest } from '../../api.js';
import { usePermissions } from '../../auth/session.js';
import { Field, Loading, Notice, PageHeading } from '../../components/ui.js';
import { issuesToErrors } from '../text.js';
import { VariableHelp } from './CommunicationsPage.js';
import {
  campaignState,
  useCrmOptions,
  useSegments,
  useTemplates,
} from './crm.js';

const emptyForm = {
  name: '',
  subject: '',
  body: '',
  eventId: '',
  segmentId: '',
};

const MAIL_PER_MINUTE = 25;

function estimate(recipients: number): string {
  const minutes = Math.ceil(recipients / MAIL_PER_MINUTE);
  return minutes < 60
    ? `alrededor de ${minutes} min`
    : `alrededor de ${Math.ceil(minutes / 60)} h`;
}

function people(count: number): string {
  return `${count.toLocaleString('es-MX')} ${count === 1 ? 'persona' : 'personas'}`;
}

function CampaignStatus({ campaign }: { campaign: CampaignRecord }) {
  const { stats } = campaign;
  return (
    <div className="stats">
      <article className="stat">
        <span>Destinatarios</span>
        <strong>{campaign.audience.toLocaleString('es-MX')}</strong>
      </article>
      <article className="stat">
        <span>Enviados</span>
        <strong>{stats.sent.toLocaleString('es-MX')}</strong>
      </article>
      <article className="stat">
        <span>En cola</span>
        <strong>{stats.pending.toLocaleString('es-MX')}</strong>
      </article>
      <article className="stat">
        <span>Fallidos</span>
        <strong>{stats.failed.toLocaleString('es-MX')}</strong>
      </article>
      <article className="stat">
        <span>Omitidos</span>
        <strong>{stats.skipped.toLocaleString('es-MX')}</strong>
      </article>
    </div>
  );
}

export function CampaignPage() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can, csrfToken } = usePermissions();
  const options = useCrmOptions();
  const segments = useSegments();
  const templates = useTemplates();
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showPreview, setShowPreview] = useState(false);
  const [notice, setNotice] = useState<{
    kind: 'ok' | 'error';
    text: string;
  }>();

  const campaign = useQuery({
    queryKey: ['campaign', id],
    enabled: !isNew,
    queryFn: async () =>
      campaignResponseSchema.parse(await apiRequest(`/api/campaigns/${id}`)),
    // Mientras se envía, los números avanzan solos.
    refetchInterval: (query) =>
      query.state.data?.status === 'queued' &&
      query.state.data.stats.pending > 0
        ? 10_000
        : false,
  });

  const preview = useQuery({
    queryKey: ['campaign-preview', id, campaign.dataUpdatedAt],
    enabled: showPreview && !isNew,
    queryFn: async () =>
      campaignPreviewResponseSchema.parse(
        await apiRequest(`/api/campaigns/${id}/preview`),
      ),
  });

  const loaded = campaign.data;
  // El formulario se llena al abrir y al cambiar de estado, sin pisar lo que se edita
  // mientras los números se actualizan solos.
  const loadedKey = loaded ? `${loaded.id}:${loaded.status}` : null;
  const [syncedKey, setSyncedKey] = useState<string | null>(null);
  if (loaded && loadedKey !== syncedKey) {
    setSyncedKey(loadedKey);
    setForm({
      name: loaded.name,
      subject: loaded.subject,
      body: loaded.body,
      eventId: loaded.eventId ?? '',
      segmentId: loaded.segmentId ?? '',
    });
  }

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['campaigns'] });
    await queryClient.invalidateQueries({ queryKey: ['campaign', id] });
  };

  const save = useMutation({
    mutationFn: async (input: unknown) =>
      campaignResponseSchema.parse(
        await apiRequest(
          isNew ? '/api/campaigns' : `/api/campaigns/${id}`,
          jsonRequest(isNew ? 'POST' : 'PUT', input, csrfToken),
        ),
      ),
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      if (isNew) {
        navigate(`/comunicaciones/${saved.id}`, { replace: true });
        return;
      }
      await refresh();
      setNotice({ kind: 'ok', text: 'Borrador guardado.' });
    },
    onError: (error) =>
      setNotice({
        kind: 'error',
        text: errorText(error, 'No se pudo guardar la comunicación.'),
      }),
  });

  const act = useMutation({
    mutationFn: async ({
      path,
    }: {
      path: 'test' | 'send' | 'cancel' | 'duplicate';
      success?: string;
    }) =>
      apiRequest(
        `/api/campaigns/${id}/${path}`,
        jsonRequest('POST', undefined, csrfToken),
      ),
    onSuccess: async (result, { path, success }) => {
      if (path === 'duplicate') {
        await queryClient.invalidateQueries({ queryKey: ['campaigns'] });
        navigate(`/comunicaciones/${campaignResponseSchema.parse(result).id}`);
        return;
      }
      await refresh();
      setNotice({ kind: 'ok', text: success ?? 'Listo.' });
    },
    onError: (error) =>
      setNotice({
        kind: 'error',
        text: errorText(error, 'No se pudo completar la acción.'),
      }),
  });

  const remove = useMutation({
    mutationFn: async () =>
      apiRequest(
        `/api/campaigns/${id}`,
        jsonRequest('DELETE', undefined, csrfToken),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      navigate('/comunicaciones');
    },
    onError: (error) =>
      setNotice({
        kind: 'error',
        text: errorText(error, 'No se pudo borrar la comunicación.'),
      }),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setNotice(undefined);
    const parsed = campaignInputSchema.safeParse({
      name: form.name,
      subject: form.subject,
      body: form.body,
      eventId: form.eventId || null,
      segmentId: form.segmentId || null,
    });
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    save.mutate(parsed.data);
  };

  if (!isNew && campaign.isPending) {
    return <Loading />;
  }
  if (campaign.isError) {
    return <Notice>{campaign.error.message}</Notice>;
  }

  const data = campaign.data;
  const editable =
    can('communications.manage') && (isNew || data?.status === 'draft');
  const [stateLabel, stateTone] = data
    ? campaignState(data)
    : ['Borrador', 'neutral'];

  const send = () => {
    if (!data) {
      return;
    }
    const audience = data.segmentName ?? 'todos los contactos';
    if (
      window.confirm(
        `Se enviará a ${people(data.audience)} (${audience}). Tardará ${estimate(data.audience)} y no se puede deshacer lo que ya salió. ¿Enviar?`,
      )
    ) {
      setNotice(undefined);
      act.mutate({
        path: 'send',
        success: 'La comunicación está en cola de envío.',
      });
    }
  };

  return (
    <section>
      <Link className="back-link" to="/comunicaciones">
        Comunicaciones
      </Link>
      <PageHeading
        title={data ? data.name : 'Nueva comunicación'}
        action={
          data && <span className={`badge ${stateTone}`}>{stateLabel}</span>
        }
      />
      {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}
      {data && data.status !== 'draft' && <CampaignStatus campaign={data} />}

      {editable ? (
        <form className="panel" onSubmit={submit} noValidate>
          {isNew && templates.data && templates.data.length > 0 && (
            <div className="form-section">
              <Field label="Empezar desde una plantilla">
                <select
                  defaultValue=""
                  onChange={(e) => {
                    const template = templates.data.find(
                      (item) => item.id === e.target.value,
                    );
                    if (template) {
                      setForm({
                        ...form,
                        name: form.name || template.name,
                        subject: template.subject,
                        body: template.body,
                      });
                    }
                  }}
                >
                  <option value="">Sin plantilla</option>
                  {templates.data.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          )}
          <div className="form-grid">
            <Field
              label="Nombre interno"
              error={errors.name}
              hint="Solo lo ve el equipo."
            >
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <Field label="Para" error={errors.segmentId}>
              <select
                value={form.segmentId}
                onChange={(e) =>
                  setForm({ ...form, segmentId: e.target.value })
                }
              >
                <option value="">Todos los contactos</option>
                {segments.data?.map((segment) => (
                  <option key={segment.id} value={segment.id}>
                    {segment.name} ({segment.reachable})
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Evento"
              error={errors.eventId}
              hint="Opcional. Si tiene registro abierto, se agrega el botón para registrarse."
            >
              <select
                value={form.eventId}
                onChange={(e) => setForm({ ...form, eventId: e.target.value })}
              >
                <option value="">Sin evento</option>
                {options.data?.events.map((event) => (
                  <option key={event.id} value={event.id}>
                    {event.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Asunto" error={errors.subject}>
              <input
                value={form.subject}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
              />
            </Field>
            <div className="span-all">
              <Field label="Mensaje" error={errors.body}>
                <textarea
                  rows={10}
                  value={form.body}
                  onChange={(e) => setForm({ ...form, body: e.target.value })}
                />
              </Field>
              <VariableHelp />
            </div>
          </div>
          <div className="form-actions">
            <button
              className="button primary"
              type="submit"
              disabled={save.isPending}
            >
              {save.isPending ? 'Guardando…' : 'Guardar borrador'}
            </button>
            {data && (
              <button
                className="button secondary"
                type="button"
                onClick={() => {
                  if (window.confirm('¿Borrar este borrador?')) {
                    remove.mutate();
                  }
                }}
              >
                Borrar
              </button>
            )}
          </div>
        </form>
      ) : (
        data && (
          <div className="panel">
            <dl className="data-list">
              <div>
                <dt>Asunto</dt>
                <dd>{data.subject}</dd>
              </div>
              <div>
                <dt>Para</dt>
                <dd>{data.segmentName ?? 'Todos los contactos'}</dd>
              </div>
              <div>
                <dt>Evento</dt>
                <dd>{data.eventName ?? 'Sin evento'}</dd>
              </div>
              {data.sentBy && (
                <div>
                  <dt>Envió</dt>
                  <dd>{data.sentBy}</dd>
                </div>
              )}
            </dl>
          </div>
        )
      )}

      {data && (
        <div className="panel">
          <div className="panel-heading">
            <h2>Revisar y enviar</h2>
          </div>
          {data.status === 'draft' && (
            <p className="muted">
              Guarda los cambios antes de revisar. Se enviará a{' '}
              <strong>{people(data.audience)}</strong> con correo y sin baja;
              tardará {estimate(data.audience)}. Los pases y avisos de pago
              siempre salen primero.
            </p>
          )}
          <div className="form-actions">
            <button
              className="button secondary"
              type="button"
              onClick={() => setShowPreview(!showPreview)}
            >
              {showPreview ? 'Ocultar vista previa' : 'Ver vista previa'}
            </button>
            {can('communications.manage') && (
              <button
                className="button secondary"
                type="button"
                disabled={act.isPending}
                onClick={() => {
                  setNotice(undefined);
                  act.mutate({
                    path: 'test',
                    success: 'Enviamos la prueba a tu correo.',
                  });
                }}
              >
                Enviarme una prueba
              </button>
            )}
            {data.status === 'draft' && can('communications.send') && (
              <button
                className="button primary"
                type="button"
                disabled={act.isPending || data.audience === 0}
                onClick={send}
              >
                Enviar a {people(data.audience)}
              </button>
            )}
            {data.status === 'queued' &&
              data.stats.pending > 0 &&
              can('communications.send') && (
                <button
                  className="button danger"
                  type="button"
                  disabled={act.isPending}
                  onClick={() => {
                    if (window.confirm('¿Detener lo que aún no ha salido?')) {
                      setNotice(undefined);
                      act.mutate({
                        path: 'cancel',
                        success: 'Se detuvo el envío.',
                      });
                    }
                  }}
                >
                  Detener envío
                </button>
              )}
            {data.status !== 'draft' && can('communications.manage') && (
              <button
                className="button secondary"
                type="button"
                disabled={act.isPending}
                onClick={() => act.mutate({ path: 'duplicate' })}
              >
                Duplicar
              </button>
            )}
          </div>
          {showPreview && preview.isError && (
            <Notice>{preview.error.message}</Notice>
          )}
          {showPreview && preview.data && (
            <>
              <p className="form-note">
                Asunto: <strong>{preview.data.subject}</strong>
              </p>
              <iframe
                className="email-preview"
                title="Vista previa del correo"
                sandbox=""
                srcDoc={preview.data.html}
              />
            </>
          )}
        </div>
      )}
    </section>
  );
}
