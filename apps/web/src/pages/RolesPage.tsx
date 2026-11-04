import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  permissionCatalog,
  roleResponseSchema,
  type PermissionCode,
  type RoleRecord,
} from '@uka/shared';
import { useState } from 'react';
import { z } from 'zod';
import { apiRequest, errorText, jsonRequest } from '../api.js';
import { usePermissions } from '../auth/session.js';
import { Field, Loading, Notice, PageHeading } from '../components/ui.js';

interface Draft {
  id: string | null;
  name: string;
  description: string;
  permissions: PermissionCode[];
}

const newDraft: Draft = {
  id: null,
  name: '',
  description: '',
  permissions: [],
};

export function RolesPage() {
  const queryClient = useQueryClient();
  const { can, csrfToken } = usePermissions();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [notice, setNotice] = useState<{
    kind: 'ok' | 'error';
    text: string;
  }>();
  const canManage = can('roles.manage');

  const roles = useQuery({
    queryKey: ['roles'],
    queryFn: async () =>
      z.array(roleResponseSchema).parse(await apiRequest('/api/roles')),
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['roles'] });
    // Los permisos propios pudieron cambiar con esta edición.
    await queryClient.invalidateQueries({ queryKey: ['auth-session'] });
  };

  const save = useMutation({
    mutationFn: async (current: Draft) =>
      apiRequest(
        current.id ? `/api/roles/${current.id}` : '/api/roles',
        jsonRequest(
          current.id ? 'PUT' : 'POST',
          {
            name: current.name,
            description: current.description.trim() || null,
            permissions: current.permissions,
          },
          csrfToken,
        ),
      ),
    onSuccess: async () => {
      await refresh();
      setNotice({ kind: 'ok', text: 'Perfil guardado.' });
      setDraft(null);
    },
    onError: (error) =>
      setNotice({
        kind: 'error',
        text: errorText(error, 'No se pudo guardar el perfil.'),
      }),
  });

  const remove = useMutation({
    mutationFn: async (role: RoleRecord) =>
      apiRequest(
        `/api/roles/${role.id}`,
        jsonRequest('DELETE', undefined, csrfToken),
      ),
    onSuccess: async () => {
      await refresh();
      setNotice({ kind: 'ok', text: 'Perfil eliminado.' });
    },
    onError: (error) =>
      setNotice({
        kind: 'error',
        text: errorText(error, 'No se pudo borrar el perfil.'),
      }),
  });

  if (roles.isPending) {
    return <Loading />;
  }

  const list = roles.data ?? [];

  const togglePermission = (code: PermissionCode) => {
    setDraft(
      (current) =>
        current && {
          ...current,
          permissions: current.permissions.includes(code)
            ? current.permissions.filter((item) => item !== code)
            : [...current.permissions, code],
        },
    );
  };

  const confirmRemove = (role: RoleRecord) => {
    if (window.confirm(`¿Borrar el perfil "${role.name}"?`)) {
      setNotice(undefined);
      remove.mutate(role);
    }
  };

  return (
    <section>
      <PageHeading
        title="Perfiles y permisos"
        description="Cada columna es un perfil. Los cambios aplican de inmediato a todas las personas con ese perfil."
        action={
          canManage && (
            <button
              className="button primary"
              type="button"
              onClick={() => {
                setNotice(undefined);
                setDraft(newDraft);
              }}
            >
              Nuevo perfil
            </button>
          )
        }
      />
      {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}
      {roles.isError && <Notice>{roles.error.message}</Notice>}

      {draft && (
        <form
          className="panel"
          onSubmit={(event) => {
            event.preventDefault();
            setNotice(undefined);
            save.mutate(draft);
          }}
        >
          <div className="panel-heading">
            <h2>{draft.id ? `Editar ${draft.name}` : 'Nuevo perfil'}</h2>
          </div>
          <div className="form-grid">
            <Field label="Nombre del perfil">
              <input
                required
                minLength={2}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </Field>
            <Field label="Descripción">
              <input
                value={draft.description}
                onChange={(e) =>
                  setDraft({ ...draft, description: e.target.value })
                }
              />
            </Field>
          </div>
          <div className="permission-groups">
            {permissionCatalog.map((module) => (
              <fieldset key={module.key}>
                <legend>{module.label}</legend>
                {module.actions.map((action) => (
                  <label className="check-field" key={action.code}>
                    <input
                      type="checkbox"
                      checked={draft.permissions.includes(action.code)}
                      onChange={() => togglePermission(action.code)}
                    />
                    {action.label}
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
          <div className="form-actions">
            <button
              className="button primary"
              type="submit"
              disabled={save.isPending}
            >
              {save.isPending ? 'Guardando…' : 'Guardar perfil'}
            </button>
            <button
              className="button secondary"
              type="button"
              onClick={() => setDraft(null)}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      <div className="panel table-panel">
        <div className="table-scroll">
          <table className="matrix">
            <thead>
              <tr>
                <th>Permiso</th>
                {list.map((role) => (
                  <th key={role.id} className="role-column">
                    <span className="role-name">{role.name}</span>
                    <small>
                      {role.userCount}{' '}
                      {role.userCount === 1 ? 'persona' : 'personas'}
                    </small>
                    {canManage &&
                      (role.isLocked ? (
                        <small className="locked">No editable</small>
                      ) : (
                        <span className="role-actions">
                          <button
                            className="link-button"
                            type="button"
                            onClick={() => {
                              setNotice(undefined);
                              setDraft({
                                id: role.id,
                                name: role.name,
                                description: role.description ?? '',
                                permissions: role.permissions,
                              });
                            }}
                          >
                            Editar
                          </button>
                          {!role.isSystem && (
                            <button
                              className="link-button danger"
                              type="button"
                              onClick={() => confirmRemove(role)}
                            >
                              Borrar
                            </button>
                          )}
                        </span>
                      ))}
                  </th>
                ))}
              </tr>
            </thead>
            {permissionCatalog.map((module) => (
              <tbody key={module.key}>
                <tr className="module-row">
                  <th colSpan={list.length + 1} scope="colgroup">
                    {module.label}
                  </th>
                </tr>
                {module.actions.map((action) => (
                  <tr key={action.code}>
                    <td>{action.label}</td>
                    {list.map((role) => {
                      const granted = role.permissions.includes(action.code);
                      return (
                        <td key={role.id} className="matrix-cell">
                          <span
                            className={granted ? 'mark yes' : 'mark no'}
                            aria-label={granted ? 'Permitido' : 'No permitido'}
                          >
                            {granted ? '✓' : '–'}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      </div>
    </section>
  );
}
