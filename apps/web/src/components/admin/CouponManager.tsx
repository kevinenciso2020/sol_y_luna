import { formatCOP } from '@sol-y-luna/shared';
import { Badge } from './ui';
import { EntityManager, type EntityConfig } from './EntityManager';
import { formatDate } from './api';

const toLocalInput = (value: unknown) => {
  if (!value) return '';
  const d = new Date(String(value));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const config: EntityConfig = {
  title: 'Cupones',
  description:
    'Descuentos por porcentaje o por valor fijo. El servidor valida vigencia, mínimos y usos al pagar.',
  singular: 'Cupón',
  gender: 'm',
  endpoint: '/api/admin/coupons',
  columns: [
    {
      key: 'code',
      label: 'Código',
      render: (r) => <span class="font-mono font-bold">{String(r['code'])}</span>,
    },
    {
      key: 'value',
      label: 'Descuento',
      render: (r) =>
        r['type'] === 'PERCENT' ? `${String(r['value'])}%` : formatCOP(Number(r['value'])),
    },
    {
      key: 'min',
      label: 'Compra mínima',
      render: (r) => (Number(r['minSubtotal']) ? formatCOP(Number(r['minSubtotal'])) : '—'),
    },
    {
      key: 'uses',
      label: 'Usos',
      render: (r) =>
        `${String(r['usedCount'])}${r['maxUses'] ? ` de ${String(r['maxUses'])}` : ''}`,
    },
    {
      key: 'dates',
      label: 'Vigencia',
      desktopOnly: false,
      render: (r) =>
        r['startsAt'] || r['endsAt']
          ? `${r['startsAt'] ? formatDate(String(r['startsAt'])) : 'Ya'} – ${r['endsAt'] ? formatDate(String(r['endsAt'])) : 'sin fin'}`
          : 'Siempre',
    },
    {
      key: 'active',
      label: 'Estado',
      render: (r) => (
        <Badge tone={r['isActive'] ? 'ok' : 'neutral'}>
          {r['isActive'] ? 'Activo' : 'Inactivo'}
        </Badge>
      ),
    },
  ],
  fields: [
    {
      kind: 'text',
      name: 'code',
      label: 'Código',
      hint: 'Letras y números, sin espacios. Se guarda en mayúsculas.',
    },
    { kind: 'text', name: 'description', label: 'Descripción (opcional)' },
    {
      kind: 'select',
      name: 'type',
      label: 'Tipo',
      options: () => [
        { value: 'PERCENT', label: 'Porcentaje' },
        { value: 'FIXED', label: 'Valor fijo en pesos' },
      ],
    },
    {
      kind: 'number',
      name: 'value',
      label: 'Valor',
      hint: 'Porcentaje de 1 a 100, o pesos sin puntos.',
    },
    { kind: 'number', name: 'minSubtotal', label: 'Compra mínima en pesos' },
    { kind: 'number', name: 'maxUses', label: 'Usos máximos (opcional)' },
    { kind: 'number', name: 'maxUsesPerUser', label: 'Usos por cliente (opcional)' },
    { kind: 'date', name: 'startsAt', label: 'Desde (opcional)' },
    { kind: 'date', name: 'endsAt', label: 'Hasta (opcional)' },
    { kind: 'toggle', name: 'isActive', label: 'Activo' },
    { kind: 'toggle', name: 'appliesToWholesale', label: 'También aplica a mayoristas' },
  ],
  empty: () => ({
    code: '',
    description: '',
    type: 'PERCENT',
    value: '',
    minSubtotal: '0',
    maxUses: '',
    maxUsesPerUser: '',
    startsAt: '',
    endsAt: '',
    isActive: true,
    appliesToWholesale: false,
  }),
  toValues: (r) => ({
    code: String(r['code']),
    description: String(r['description'] ?? ''),
    type: String(r['type']),
    value: String(r['value']),
    minSubtotal: String(r['minSubtotal']),
    maxUses: r['maxUses'] ? String(r['maxUses']) : '',
    maxUsesPerUser: r['maxUsesPerUser'] ? String(r['maxUsesPerUser']) : '',
    startsAt: toLocalInput(r['startsAt']),
    endsAt: toLocalInput(r['endsAt']),
    isActive: Boolean(r['isActive']),
    appliesToWholesale: Boolean(r['appliesToWholesale']),
  }),
  toPayload: (v) => ({
    code: v['code'],
    description: v['description'],
    type: v['type'],
    value: Number(v['value'] || 0),
    minSubtotal: Number(v['minSubtotal'] || 0),
    maxUses: v['maxUses'] ? Number(v['maxUses']) : null,
    maxUsesPerUser: v['maxUsesPerUser'] ? Number(v['maxUsesPerUser']) : null,
    // datetime-local is the admin's local time (Colombia); send ISO so the server stores UTC.
    startsAt: v['startsAt'] ? new Date(String(v['startsAt'])).toISOString() : null,
    endsAt: v['endsAt'] ? new Date(String(v['endsAt'])).toISOString() : null,
    isActive: v['isActive'],
    appliesToWholesale: v['appliesToWholesale'],
  }),
  deleteWarning: (r) => (
    <p>
      El cupón {String(r['code'])} dejará de funcionar. Los pedidos que ya lo usaron conservan el
      descuento y el código.
    </p>
  ),
};

export default function CouponManager() {
  return <EntityManager config={config} />;
}
