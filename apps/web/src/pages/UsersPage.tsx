import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  roleResponseSchema,
  userResponseSchema,
  type UserRecord,
} from '@uka/shared';
import { useState, type FormEvent } from 'react';
import { z } from 'zod';
import { apiRequest, errorText, jsonRequest } from '../api.js';
import { usePermissions, useSession } from '../auth/session.js';
import {
  Field,
  Loading,
  Notice,
  PageHeading,
  StatusBadge,
} from '../components/ui.js';

const emptyForm = { email: '', displayName: '', roleId: '', enabled: true };

export function UsersPage() {
  const queryClient = useQueryClient();
  const session = useSession();
  const { can, csrfToken } = usePermissions();
  const [editing, setEditing] = useState<UserRecord | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [notice, setNotice] = useState<{
    kind: 'ok' | 'error';
    text: string;
  }>();
  const canManage = can('users.manage');
  const ownId = session.data?.user?.id;

  const users = useQuery({
    queryKey: ['users'],
    queryFn: async () =>
      z.array(userResponseSchema).parse(await apiRequest('/api/users')),
  });
  const roles = useQuery({
    queryKey: ['roles'],
    queryFn: async () =>
      z.array(roleResponseSchema).parse(await apiRequest('/api/roles')),
  });

  const save = useMutation({
    mutationFn: async () =>
      editing
        ? apiRequest(
            `/api/users/${editing.id}`,
            jsonRequest(
              'PUT',
              {
                displayName: form.displayName,
                roleId: form.roleId,
                enabled: form.enabled,
              },
              csrfToken,
            ),
          )
        : apiRequest(
            '/api/users',
            jsonRequest(
              'POST',
              {
                email: form.email,
                displayName: form.displayName,
                roleId: form.roleId,
              },
              csrfToken,
            ),
          ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      await queryClient.invalidateQueries({ queryKey: ['roles'] });
      setNotice({
        kind: 'ok',
        text: editing
          ? 'Usuario actualizado.'
          : `Invitación registrada. ${form.email} ya puede entrar con su cuenta de Microsoft.`,
      });
      setFormOpen(false);
    },
    onError: (error) =>
      setNotice({
        kind: 'error',
        text: errorText(error, 'No se pudo guardar el usuario.'),
      }),
  });

  const open = (user?: UserRecord) => {
    setEditing(user ?? null);
    setForm(
      user
        ? {
            email: user.email,
            displayName: user.displayName,
            roleId: user.role.id,
            enabled: user.status !== 'inactive',
          }
        : { ...emptyForm, roleId: '' },
    );
    setNotice(undefined);
    setFormOpen(true);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setNotice(undefined);
    save.mutate();
  };

  if (users.isPending) {
    return <Loading />;
  }

  const isSelf = editing?.id === ownId;

  return (
    <section>
      <PageHeading
        title="Usuarios"
        description="Solo las personas invitadas aquí pueden entrar, con su cuenta de Microsoft."
        action={
          canManage && (
            <button
              className="button primary"
              type="button"
              onClick={() => open()}
            >
              Invitar usuario
            </button>
          )
        }
      />
      {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}
      {users.isError && <Notice>{users.error.message}</Notice>}

      {formOpen && (
        <form className="panel" onSubmit={submit}>
          <div className="panel-heading">
            <h2>{editing ? 'Editar usuario' : 'Invitar usuario'}</h2>
          </div>
          <div className="form-grid">
            <Field
              label="Correo de Microsoft"
              hint={editing ? 'El correo no se puede cambiar.' : undefined}
            >
              <input
                type="email"
                required
                disabled={Boolean(editing)}
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>
            <Field label="Nombre">
              <input
                required
                value={form.displayName}
                onChange={(e) =>
                  setForm({ ...form, displayName: e.target.value })
                }
              />
            </Field>
            <Field
              label="Perfil"
              hint={isSelf ? 'No puedes cambiar tu propio perfil.' : undefined}
            >
              <select
                required
                disabled={isSelf}
                value={form.roleId}
                onChange={(e) => setForm({ ...form, roleId: e.target.value })}
              >
                <option value="">Selecciona un perfil</option>
                {roles.data?.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </select>
            </Field>
            {editing && (
              <label className="check-field">
                <input
                  type="checkbox"
                  disabled={isSelf}
                  checked={form.enabled}
                  onChange={(e) =>
                    setForm({ ...form, enabled: e.target.checked })
                  }
                />
                Acceso activo
              </label>
            )}
          </div>
          <div className="form-actions">
            <button
              className="button primary"
              type="submit"
              disabled={save.isPending}
            >
              {save.isPending ? 'Guardando…' : editing ? 'Guardar' : 'Invitar'}
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
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Correo</th>
                <th>Perfil</th>
                <th>Estado</th>
                <th>Último acceso</th>
                <th aria-label="Acciones" />
              </tr>
            </thead>
            <tbody>
              {users.data?.map((user) => (
                <tr key={user.id}>
                  <td>
                    <strong>{user.displayName}</strong>
                  </td>
                  <td>{user.email}</td>
                  <td>{user.role.name}</td>
                  <td>
                    <StatusBadge status={user.status} />
                  </td>
                  <td>
                    {user.lastLoginAt
                      ? new Date(user.lastLoginAt).toLocaleString('es-MX', {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })
                      : 'Nunca'}
                  </td>
                  <td className="row-actions">
                    {canManage && (
                      <button
                        className="link-button"
                        type="button"
                        onClick={() => open(user)}
                      >
                        Editar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
