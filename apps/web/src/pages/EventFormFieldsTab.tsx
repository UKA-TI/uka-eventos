import { useMutation } from '@tanstack/react-query';
import {
  formFieldInputSchema,
  formFieldTypes,
  type EventDetail,
  type FormFieldRecord,
} from '@uka/shared';
import { useState, type FormEvent } from 'react';
import { apiRequest, errorText, jsonRequest } from '../api.js';
import { usePermissions } from '../auth/session.js';
import { Field, Notice } from '../components/ui.js';
import { issuesToErrors } from './text.js';

const emptyForm = {
  label: '',
  type: 'text',
  required: false,
  options: '',
  helpText: '',
  active: true,
};

const typeLabels = Object.fromEntries(
  formFieldTypes.map((type) => [type.key, type.label]),
);

export function EventFormFieldsTab({
  event,
  onChanged,
}: {
  event: EventDetail;
  onChanged: () => Promise<void>;
}) {
  const { can, csrfToken } = usePermissions();
  const canEdit = can('events.edit');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{
    kind: 'ok' | 'error';
    text: string;
  }>();

  const fail = (fallback: string) => (error: unknown) =>
    setNotice({ kind: 'error', text: errorText(error, fallback) });

  const open = (field?: FormFieldRecord) => {
    setEditingId(field?.id ?? null);
    setErrors({});
    setNotice(undefined);
    setForm(
      field
        ? {
            label: field.label,
            type: field.type,
            required: field.required,
            options: field.options.join('\n'),
            helpText: field.helpText ?? '',
            active: field.active,
          }
        : emptyForm,
    );
    setFormOpen(true);
  };

  const save = useMutation({
    mutationFn: async (input: unknown) =>
      apiRequest(
        editingId
          ? `/api/events/${event.id}/fields/${editingId}`
          : `/api/events/${event.id}/fields`,
        jsonRequest(editingId ? 'PUT' : 'POST', input, csrfToken),
      ),
    onSuccess: async () => {
      await onChanged();
      setFormOpen(false);
      setNotice({ kind: 'ok', text: 'Pregunta guardada.' });
    },
    onError: fail('No se pudo guardar la pregunta.'),
  });

  const remove = useMutation({
    mutationFn: async (field: FormFieldRecord) =>
      apiRequest(
        `/api/events/${event.id}/fields/${field.id}`,
        jsonRequest('DELETE', undefined, csrfToken),
      ),
    onSuccess: async () => {
      await onChanged();
      setNotice({ kind: 'ok', text: 'Pregunta eliminada.' });
    },
    onError: fail('No se pudo borrar la pregunta.'),
  });

  const reorder = useMutation({
    mutationFn: async (ids: string[]) =>
      apiRequest(
        `/api/events/${event.id}/fields/order`,
        jsonRequest('PUT', { ids }, csrfToken),
      ),
    onSuccess: onChanged,
    onError: fail('No se pudo cambiar el orden.'),
  });

  const move = (index: number, offset: number) => {
    const ids = event.formFields.map((field) => field.id);
    const [moved] = ids.splice(index, 1);
    if (moved) {
      ids.splice(index + offset, 0, moved);
      setNotice(undefined);
      reorder.mutate(ids);
    }
  };

  const submit = (submitEvent: FormEvent) => {
    submitEvent.preventDefault();
    setNotice(undefined);
    const parsed = formFieldInputSchema.safeParse({
      label: form.label,
      type: form.type,
      required: form.type === 'checkbox' ? false : form.required,
      options:
        form.type === 'select'
          ? form.options
              .split('\n')
              .map((option) => option.trim())
              .filter(Boolean)
          : [],
      helpText: form.helpText.trim() || null,
      active: form.active,
    });
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    save.mutate(parsed.data);
  };

  return (
    <>
      {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}

      {formOpen && (
        <form className="panel" onSubmit={submit} noValidate>
          <div className="panel-heading">
            <h2>{editingId ? 'Editar pregunta' : 'Nueva pregunta'}</h2>
          </div>
          <div className="form-grid">
            <Field label="Pregunta" error={errors.label}>
              <input
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
              />
            </Field>
            <Field label="Tipo de respuesta" error={errors.type}>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
              >
                {formFieldTypes.map((type) => (
                  <option key={type.key} value={type.key}>
                    {type.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Texto de ayuda" error={errors.helpText}>
              <input
                value={form.helpText}
                onChange={(e) => setForm({ ...form, helpText: e.target.value })}
              />
            </Field>
            {form.type === 'select' && (
              <div className="span-all">
                <Field
                  label="Opciones"
                  error={errors.options}
                  hint="Escribe una opción por línea."
                >
                  <textarea
                    rows={4}
                    value={form.options}
                    onChange={(e) =>
                      setForm({ ...form, options: e.target.value })
                    }
                  />
                </Field>
              </div>
            )}
            {form.type !== 'checkbox' && (
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={form.required}
                  onChange={(e) =>
                    setForm({ ...form, required: e.target.checked })
                  }
                />
                Respuesta obligatoria
              </label>
            )}
            <label className="check-field">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
              />
              Mostrar en el formulario
            </label>
          </div>
          <div className="form-actions">
            <button
              className="button primary"
              type="submit"
              disabled={save.isPending}
            >
              {save.isPending ? 'Guardando…' : 'Guardar pregunta'}
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

      <div className="panel table-panel">
        <div className="panel-heading table-heading">
          <h2>Formulario de registro</h2>
          {canEdit && (
            <button
              className="button primary small"
              type="button"
              onClick={() => open()}
            >
              Agregar pregunta
            </button>
          )}
        </div>
        <p className="muted table-note">
          Siempre se piden nombre, apellidos, correo y teléfono. Agrega aquí lo
          que este evento necesite además, como talla o alergias.
        </p>
        {event.formFields.length > 0 && (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Pregunta</th>
                  <th>Tipo</th>
                  <th>Obligatoria</th>
                  <th>Estado</th>
                  <th aria-label="Acciones" />
                </tr>
              </thead>
              <tbody>
                {event.formFields.map((field, index) => (
                  <tr key={field.id}>
                    <td>
                      <strong>{field.label}</strong>
                      {field.options.length > 0 && (
                        <small className="cell-note">
                          {field.options.join(', ')}
                        </small>
                      )}
                    </td>
                    <td>{typeLabels[field.type]}</td>
                    <td>{field.required ? 'Sí' : 'No'}</td>
                    <td>
                      <span
                        className={field.active ? 'badge ok' : 'badge neutral'}
                      >
                        {field.active ? 'Visible' : 'Oculta'}
                      </span>
                    </td>
                    <td className="row-actions">
                      {canEdit && (
                        <>
                          <button
                            className="link-button"
                            type="button"
                            aria-label={`Subir ${field.label}`}
                            disabled={index === 0 || reorder.isPending}
                            onClick={() => move(index, -1)}
                          >
                            ↑
                          </button>
                          <button
                            className="link-button"
                            type="button"
                            aria-label={`Bajar ${field.label}`}
                            disabled={
                              index === event.formFields.length - 1 ||
                              reorder.isPending
                            }
                            onClick={() => move(index, 1)}
                          >
                            ↓
                          </button>
                          <button
                            className="link-button"
                            type="button"
                            onClick={() => open(field)}
                          >
                            Editar
                          </button>
                          <button
                            className="link-button danger"
                            type="button"
                            onClick={() => {
                              if (
                                window.confirm(
                                  `¿Borrar la pregunta "${field.label}"?`,
                                )
                              ) {
                                setNotice(undefined);
                                remove.mutate(field);
                              }
                            }}
                          >
                            Borrar
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
