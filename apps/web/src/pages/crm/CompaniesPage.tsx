import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  companyInputSchema,
  companyResponseSchema,
  type CompanyRecord,
} from '@uka/shared';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { apiRequest, errorText, jsonRequest } from '../../api.js';
import { usePermissions } from '../../auth/session.js';
import { Field, Loading, Notice, PageHeading } from '../../components/ui.js';
import { formatAmount, issuesToErrors } from '../text.js';

const emptyForm = { name: '', website: '', notes: '' };

export function CompaniesPage() {
  const queryClient = useQueryClient();
  const { can, csrfToken } = usePermissions();
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{
    kind: 'ok' | 'error';
    text: string;
  }>();

  const companies = useQuery({
    queryKey: ['companies'],
    queryFn: async () =>
      z.array(companyResponseSchema).parse(await apiRequest('/api/companies')),
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['companies'] });
    await queryClient.invalidateQueries({ queryKey: ['crm-options'] });
  };

  const save = useMutation({
    mutationFn: async (input: unknown) =>
      apiRequest(
        editingId ? `/api/companies/${editingId}` : '/api/companies',
        jsonRequest(editingId ? 'PUT' : 'POST', input, csrfToken),
      ),
    onSuccess: async () => {
      await refresh();
      setFormOpen(false);
      setNotice({ kind: 'ok', text: 'Empresa guardada.' });
    },
    onError: (error) =>
      setNotice({
        kind: 'error',
        text: errorText(error, 'No se pudo guardar la empresa.'),
      }),
  });

  const remove = useMutation({
    mutationFn: async (company: CompanyRecord) =>
      apiRequest(
        `/api/companies/${company.id}`,
        jsonRequest('DELETE', undefined, csrfToken),
      ),
    onSuccess: async () => {
      await refresh();
      setNotice({ kind: 'ok', text: 'Empresa borrada.' });
    },
    onError: (error) =>
      setNotice({
        kind: 'error',
        text: errorText(error, 'No se pudo borrar la empresa.'),
      }),
  });

  const open = (company?: CompanyRecord) => {
    setEditingId(company?.id ?? null);
    setErrors({});
    setNotice(undefined);
    setForm(
      company
        ? {
            name: company.name,
            website: company.website ?? '',
            notes: company.notes ?? '',
          }
        : emptyForm,
    );
    setFormOpen(true);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setNotice(undefined);
    const parsed = companyInputSchema.safeParse({
      name: form.name,
      website: form.website.trim() || null,
      notes: form.notes.trim() || null,
    });
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    save.mutate(parsed.data);
  };

  if (companies.isPending) {
    return <Loading />;
  }

  const term = search.trim().toLowerCase();
  const visible = companies.data?.filter((company) =>
    company.name.toLowerCase().includes(term),
  );
  const seesDonations = can('donations.view', 'donations.manage');

  return (
    <section>
      <PageHeading
        title="Empresas"
        description="Se crean solas con la organización que captura quien se registra."
        action={
          can('contacts.manage') && (
            <button
              className="button primary"
              type="button"
              onClick={() => open()}
            >
              Nueva empresa
            </button>
          )
        }
      />
      {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}
      {companies.isError && <Notice>{companies.error.message}</Notice>}

      {formOpen && (
        <form className="panel" onSubmit={submit} noValidate>
          <div className="panel-heading">
            <h2>{editingId ? 'Editar empresa' : 'Nueva empresa'}</h2>
          </div>
          <div className="form-grid">
            <Field label="Nombre" error={errors.name}>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <Field label="Sitio web" error={errors.website}>
              <input
                value={form.website}
                onChange={(e) => setForm({ ...form, website: e.target.value })}
              />
            </Field>
            <div className="span-all">
              <Field label="Notas" error={errors.notes}>
                <textarea
                  rows={2}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
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
              {save.isPending ? 'Guardando…' : 'Guardar empresa'}
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

      <div className="filters">
        <label className="filter-field filter-search">
          <span>Buscar empresa</span>
          <input
            type="search"
            placeholder="Buscar empresa"
            aria-label="Buscar empresa"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>

      <div className="panel table-panel">
        {visible?.length === 0 ? (
          <p className="muted">
            {term ? 'Ninguna empresa coincide.' : 'Aún no hay empresas.'}
          </p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Empresa</th>
                  <th>Contactos</th>
                  {seesDonations && <th>Donado</th>}
                  <th aria-label="Acciones" />
                </tr>
              </thead>
              <tbody>
                {visible?.map((company) => (
                  <tr key={company.id}>
                    <td>
                      <strong>{company.name}</strong>
                      {company.website && (
                        <small className="cell-note">{company.website}</small>
                      )}
                    </td>
                    <td>
                      <Link to={`/contactos?companyId=${company.id}`}>
                        {company.contacts}
                      </Link>
                    </td>
                    {seesDonations && <td>{formatAmount(company.donated)}</td>}
                    <td>
                      {can('contacts.manage') && (
                        <div className="row-actions">
                          <button
                            className="link-button"
                            type="button"
                            onClick={() => open(company)}
                          >
                            Editar
                          </button>
                          {company.contacts === 0 && (
                            <button
                              className="link-button danger"
                              type="button"
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `¿Borrar la empresa "${company.name}"?`,
                                  )
                                ) {
                                  setNotice(undefined);
                                  remove.mutate(company);
                                }
                              }}
                            >
                              Borrar
                            </button>
                          )}
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
    </section>
  );
}
