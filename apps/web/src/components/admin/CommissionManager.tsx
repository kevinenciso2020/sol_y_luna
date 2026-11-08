import { COMMISSION_SCOPE_LABELS, formatCOP, type CommissionScope } from '@sol-y-luna/shared';
import { useEffect, useState } from 'preact/hooks';
import { api, formatDate } from './api';
import { EntityManager, type EntityConfig } from './EntityManager';
import { Badge, Loading, Notice } from './ui';

interface Option {
  id: string;
  name: string;
}

const TIER_LABELS: Record<string, string> = {
  '': 'Detal y mayorista',
  RETAIL: 'Solo detal',
  WHOLESALE: 'Solo mayorista',
};

/** "10" or "7,5" → 1000 / 750 basis points. */
const toBps = (value: string) => Math.round(Number(value.replace(',', '.')) * 100);
const toPercent = (bps: number) => (bps / 100).toLocaleString('es-CO');

const toLocalInput = (value: unknown) => {
  if (!value) return '';
  const d = new Date(String(value));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function buildConfig(categories: Option[], products: Option[]): EntityConfig {
  const notApplicable = [{ value: '', label: 'No aplica' }];
  return {
    title: 'Comisiones',
    description:
      'La comisión de la plataforma se calcula sobre el subtotal menos descuentos. Gana la regla más específica: producto, luego categoría y por último la global. Cambiar una regla no altera los pedidos ya pagados.',
    singular: 'Regla',
    gender: 'f',
    endpoint: '/api/admin/commission-rules',
    columns: [
      {
        key: 'scope',
        label: 'Aplica a',
        render: (r) => (
          <span>
            <span class="font-semibold">
              {COMMISSION_SCOPE_LABELS[r['scope'] as CommissionScope]}
            </span>
            {(r['categoryName'] || r['productName']) && (
              <span class="block text-xs text-noche/70">
                {String(r['categoryName'] ?? r['productName'])}
              </span>
            )}
          </span>
        ),
      },
      {
        key: 'rate',
        label: 'Porcentaje',
        render: (r) => (
          <span class="font-display text-lg font-bold">{toPercent(Number(r['rateBps']))}%</span>
        ),
      },
      {
        key: 'tier',
        label: 'Precio',
        render: (r) => TIER_LABELS[String(r['priceTier'] ?? '')],
      },
      {
        key: 'fixed',
        label: 'Fijo por pedido',
        render: (r) => (Number(r['fixedAmount']) ? formatCOP(Number(r['fixedAmount'])) : '—'),
      },
      {
        key: 'validity',
        label: 'Vigencia',
        desktopOnly: true,
        render: (r) =>
          `Desde ${formatDate(String(r['validFrom']))}${r['validTo'] ? ` hasta ${formatDate(String(r['validTo']))}` : ''}`,
      },
      {
        key: 'active',
        label: 'Estado',
        render: (r) => (
          <Badge tone={r['isActive'] ? 'ok' : 'neutral'}>
            {r['isActive'] ? 'Activa' : 'Inactiva'}
          </Badge>
        ),
      },
    ],
    fields: [
      {
        kind: 'select',
        name: 'scope',
        label: 'Aplica a',
        options: () => [
          { value: 'GLOBAL', label: 'Toda la tienda (global)' },
          { value: 'CATEGORY', label: 'Una categoría' },
          { value: 'PRODUCT', label: 'Un producto' },
        ],
      },
      {
        kind: 'select',
        name: 'categoryId',
        label: 'Categoría',
        options: (v) =>
          v['scope'] === 'CATEGORY'
            ? [
                { value: '', label: 'Elige la categoría' },
                ...categories.map((c) => ({ value: c.id, label: c.name })),
              ]
            : notApplicable,
      },
      {
        kind: 'select',
        name: 'productId',
        label: 'Producto',
        options: (v) =>
          v['scope'] === 'PRODUCT'
            ? [
                { value: '', label: 'Elige el producto' },
                ...products.map((p) => ({ value: p.id, label: p.name })),
              ]
            : notApplicable,
      },
      {
        kind: 'text',
        name: 'rate',
        label: 'Porcentaje',
        inputMode: 'text',
        hint: 'Ej.: 10 para 10 %. Admite dos decimales (7,5).',
      },
      {
        kind: 'select',
        name: 'priceTier',
        label: 'Tipo de precio',
        options: () => Object.entries(TIER_LABELS).map(([value, label]) => ({ value, label })),
      },
      {
        kind: 'number',
        name: 'fixedAmount',
        label: 'Valor fijo por pedido (pesos)',
        inputMode: 'numeric',
        hint: 'Solo en la regla global. Déjalo en 0 si no aplica.',
      },
      { kind: 'date', name: 'validFrom', label: 'Vigente desde (opcional)' },
      { kind: 'date', name: 'validTo', label: 'Vigente hasta (opcional)' },
      { kind: 'toggle', name: 'isActive', label: 'Regla activa' },
    ],
    empty: () => ({
      scope: 'GLOBAL',
      categoryId: '',
      productId: '',
      rate: '10',
      priceTier: '',
      fixedAmount: '0',
      validFrom: '',
      validTo: '',
      isActive: true,
    }),
    toValues: (r) => ({
      scope: String(r['scope']),
      categoryId: String(r['categoryId'] ?? ''),
      productId: String(r['productId'] ?? ''),
      rate: toPercent(Number(r['rateBps'])),
      priceTier: String(r['priceTier'] ?? ''),
      fixedAmount: String(r['fixedAmount'] ?? 0),
      validFrom: toLocalInput(r['validFrom']),
      validTo: toLocalInput(r['validTo']),
      isActive: Boolean(r['isActive']),
    }),
    toPayload: (v) => ({
      scope: v['scope'],
      categoryId: v['scope'] === 'CATEGORY' ? v['categoryId'] || null : null,
      productId: v['scope'] === 'PRODUCT' ? v['productId'] || null : null,
      rateBps: toBps(String(v['rate'])),
      priceTier: v['priceTier'] || null,
      fixedAmount: Number(String(v['fixedAmount']).replace(/\D/g, '') || 0),
      validFrom: v['validFrom'] ? new Date(String(v['validFrom'])).toISOString() : null,
      validTo: v['validTo'] ? new Date(String(v['validTo'])).toISOString() : null,
      isActive: v['isActive'],
    }),
    deleteWarning: () =>
      'Los pedidos ya pagados conservan su comisión. Si es la última regla global activa, no se puede borrar.',
  };
}

export function CommissionManager() {
  const [config, setConfig] = useState<EntityConfig | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    Promise.all([
      api.get<{ data: Option[] }>('/api/admin/categories'),
      api.get<{ data: Option[] }>('/api/admin/products?pageSize=100'),
    ])
      .then(([c, p]) => setConfig(buildConfig(c.data, p.data)))
      .catch(() => setError('No pudimos cargar las categorías y productos. Recarga la página.'));
  }, []);
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!config) return <Loading />;
  return <EntityManager config={config} />;
}

export default CommissionManager;
