import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  campaignResponseSchema,
  mergeVariables,
  templateInputSchema,
  type TemplateRecord,
} from '@uka/shared';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { apiRequest, errorText, jsonRequest } from '../../api.js';
import { usePermissions } from '../../auth/session.js';
import { Field, Loading, Notice, PageHeading } from '../../components/ui.js';
import { Icon } from '../../components/icons.js';
import { issuesToErrors } from '../text.js';
import { campaignState, useTemplates } from './crm.js';
import { ModuleNavigation } from '../../components/ModuleNavigation.js';

const communicationSections = [
  ['envios', 'Envíos'],
  ['plantillas', 'Plantillas'],
] as const;

export function VariableHelp() {
  return (
    <p className="form-note communication-variables">
      Puedes usar:{' '}
      {mergeVariables.map((variable, index) => (
        <span key={variable.key} title={variable.label}>
          {index > 0 && ', '}
          <code>{`{{${variable.key}}}`}</code>
        </span>
      ))}
      . Deja una línea en blanco para separar párrafos.
    </p>
  );
}

const emptyTemplate = { name: '', subject: '', body: '' };

function TemplatesPanel() {
  const queryClient = useQueryClient();
  const { can, csrfToken } = usePermissions();
  const templates = useTemplates();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyTemplate);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{
    kind: 'ok' | 'error';
    text: string;
  }>();

  const save = useMutation({
    mutationFn: async (input: unknown) =>
      apiRequest(
        editingId
          ? `/api/email-templates/${editingId}`
          : '/api/email-templates',
        jsonRequest(editingId ? 'PUT' : 'POST', input, csrfToken),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['email-templates'] });
      setFormOpen(false);
      setNotice({ kind: 'ok', text: 'Plantilla guardada.' });
    },
    onError: (error) =>
      setNotice({
        kind: 'error',
        text: errorText(error, 'No se pudo guardar la plantilla.'),
      }),
  });

  const remove = useMutation({
    mutationFn: async (template: TemplateRecord) =>
      apiRequest(
        `/api/email-templates/${template.id}`,
        jsonRequest('DELETE', undefined, csrfToken),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['email-templates'] });
      setNotice({ kind: 'ok', text: 'Plantilla borrada.' });
    },
    onError: (error) =>
      setNotice({
        kind: 'error',
        text: errorText(error, 'No se pudo borrar la plantilla.'),
      }),
  });

  const open = (template?: TemplateRecord) => {
    setEditingId(template?.id ?? null);
    setErrors({});
    setNotice(undefined);
    setForm(
      template
        ? {
            name: template.name,
            subject: template.subject,
            body: template.body,
          }
        : emptyTemplate,
    );
    setFormOpen(true);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setNotice(undefined);
    const parsed = templateInputSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    save.mutate(parsed.data);
  };

  if (templates.isPending) {
    return <Loading />;
  }

  return (
    <>
      {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}
      {templates.isError && <Notice>{templates.error.message}</Notice>}
      {can('communications.manage') && !formOpen && (
        <div className="filters">
          <button
            className="button primary"
            type="button"
            onClick={() => open()}
          >
            Nueva plantilla
          </button>
        </div>
      )}
      {formOpen && (
        <form className="panel crm-form" onSubmit={submit} noValidate>
          <div className="panel-heading">
            <h2>{editingId ? 'Editar plantilla' : 'Nueva plantilla'}</h2>
          </div>
          <div className="form-grid">
            <Field label="Nombre" error={errors.name}>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
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
                  rows={8}
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
              {save.isPending ? 'Guardando…' : 'Guardar plantilla'}
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
      <div className="panel communication-templates">
        <div className="panel-heading">
          <h2>Plantillas de correo</h2>
          {templates.data && (
            <span className="result-count">
              {templates.data.length}{' '}
              {templates.data.length === 1 ? 'plantilla' : 'plantillas'}
            </span>
          )}
        </div>
        {templates.data?.length === 0 ? (
          <p className="muted">Aún no hay plantillas.</p>
        ) : (
          <ul className="plain-list">
            {templates.data?.map((template) => (
              <li key={template.id}>
                <span className="communication-template-name">
                  <Icon name="mail" />
                  <span>
                    <strong>{template.name}</strong>
                    <small>{template.subject}</small>
                  </span>
                </span>
                {can('communications.manage') && (
                  <div className="row-actions">
                    <button
                      className="link-button"
                      type="button"
                      onClick={() => open(template)}
                    >
                      Editar
                    </button>
                    <button
                      className="link-button danger"
                      type="button"
                      onClick={() => {
                        if (
                          window.confirm(
                            `¿Borrar la plantilla "${template.name}"?`,
                          )
                        ) {
                          setNotice(undefined);
                          remove.mutate(template);
                        }
                      }}
                    >
                      Borrar
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

export function CommunicationsPage() {
  const { can } = usePermissions();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'envios' | 'plantillas'>('envios');
  const campaigns = useQuery({
    queryKey: ['campaigns'],
    queryFn: async () =>
      z.array(campaignResponseSchema).parse(await apiRequest('/api/campaigns')),
  });

  if (campaigns.isPending) {
    return <Loading />;
  }

  return (
    <section className="crm-page communications-page">
      <PageHeading
        title="Comunicaciones"
        description="Invitaciones y avisos a tus contactos. Cada correo incluye una liga para darse de baja."
        action={
          can('communications.manage') && (
            <button
              className="button primary"
              type="button"
              onClick={() => navigate('/comunicaciones/nueva')}
            >
              Nueva comunicación
            </button>
          )
        }
      />
      <ModuleNavigation
        label="Comunicaciones"
        current={tab}
        items={communicationSections}
        onSelect={(value) => setTab(value)}
      >
        <div className="tabs" role="tablist" aria-label="Comunicaciones">
          {communicationSections.map(([value, label]) => (
            <button
              key={value}
              className={tab === value ? 'tab active' : 'tab'}
              role="tab"
              type="button"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
            >
              <Icon name={value === 'envios' ? 'mail' : 'layers'} />
              {label}
            </button>
          ))}
        </div>
      </ModuleNavigation>
      {tab === 'plantillas' ? (
        <TemplatesPanel />
      ) : (
        <>
          {campaigns.isError && <Notice>{campaigns.error.message}</Notice>}
          <div className="panel table-panel">
            <div className="panel-heading">
              <h2>Historial de comunicaciones</h2>
              {campaigns.data && (
                <span className="result-count">
                  {campaigns.data.length}{' '}
                  {campaigns.data.length === 1
                    ? 'comunicación'
                    : 'comunicaciones'}
                </span>
              )}
            </div>
            {campaigns.data?.length === 0 ? (
              <p className="muted">Aún no hay comunicaciones.</p>
            ) : (
              <div className="table-scroll">
                <table className="crm-table communications-table">
                  <thead>
                    <tr>
                      <th>Comunicación</th>
                      <th>Para</th>
                      <th>Destinatarios</th>
                      <th>Enviados</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaigns.data?.map((campaign) => {
                      const [label, tone] = campaignState(campaign);
                      return (
                        <tr key={campaign.id}>
                          <td data-label="Comunicación">
                            <div className="crm-cell-content">
                              <Link to={`/comunicaciones/${campaign.id}`}>
                                <strong>{campaign.name}</strong>
                              </Link>
                              <small className="cell-note">
                                {campaign.subject}
                              </small>
                            </div>
                          </td>
                          <td data-label="Para">
                            {campaign.segmentName ??
                              (campaign.segmentId
                                ? 'Segmento'
                                : 'Todos los contactos')}
                          </td>
                          <td data-label="Destinatarios">
                            {campaign.audience.toLocaleString('es-MX')}
                          </td>
                          <td data-label="Enviados">
                            {campaign.stats.sent.toLocaleString('es-MX')}
                          </td>
                          <td data-label="Estado">
                            <span className={`badge ${tone}`}>{label}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
