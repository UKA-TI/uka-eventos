import { useQuery } from '@tanstack/react-query';
import {
  authConfigResponseSchema,
  authSessionResponseSchema,
  type PermissionCode,
} from '@uka/shared';
import { apiRequest } from '../api.js';

export const sessionKey = ['auth-session'];

export function useSession() {
  return useQuery({
    queryKey: sessionKey,
    queryFn: async () =>
      authSessionResponseSchema.parse(await apiRequest('/api/auth/session')),
  });
}

export function useAuthConfig() {
  return useQuery({
    queryKey: ['auth-config'],
    queryFn: async () =>
      authConfigResponseSchema.parse(await apiRequest('/api/auth/config')),
  });
}

export function usePermissions() {
  const session = useSession();
  const permissions = session.data?.user?.permissions ?? [];
  return {
    csrfToken: session.data?.csrfToken ?? '',
    can: (...codes: PermissionCode[]) =>
      codes.some((code) => permissions.includes(code)),
  };
}
