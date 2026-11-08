import { apiFetch } from '../../lib/auth-client';

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, body: unknown) =>
    apiFetch<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    apiFetch<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    apiFetch<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  del: (path: string) => apiFetch<void>(path, { method: 'DELETE' }),
};

export const qs = (params: Record<string, string | number | undefined | null>) => {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v !== undefined && v !== null && v !== '') search.set(k, String(v));
  const text = search.toString();
  return text ? `?${text}` : '';
};

export const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Borrador',
  ACTIVE: 'Publicado',
  ARCHIVED: 'Archivado',
};
export const INVIMA_LABELS: Record<string, string> = {
  REGISTERED: 'Con registro',
  IN_PROCESS: 'En trámite',
  NOT_REQUIRED: 'No requiere',
  NOT_REGISTERED: 'Sin registro',
};
export const AUDIENCE_LABELS: Record<string, string> = {
  HIM: 'Para él',
  HER: 'Para ella',
  UNISEX: 'Unisex',
};
export const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Administrador',
  OPERATOR: 'Operador',
  CUSTOMER: 'Cliente',
};

export const formatDate = (value: string | Date) =>
  new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Bogota',
  }).format(new Date(value));
