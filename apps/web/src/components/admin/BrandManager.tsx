import { slugify } from '@sol-y-luna/shared';
import { Badge } from './ui';
import { EntityManager, type EntityConfig } from './EntityManager';

type Theme = {
  mode?: string;
  background?: string;
  accent?: string;
  accent2?: string;
  style?: string;
} | null;

const config: EntityConfig = {
  title: 'Marcas',
  description:
    'Cada marca tiene su página. Puedes darle un tema propio (por ejemplo, WILD en modo oscuro con neón).',
  singular: 'Marca',
  gender: 'f',
  endpoint: '/api/admin/brands',
  columns: [
    {
      key: 'name',
      label: 'Nombre',
      render: (r) => <span class="font-semibold">{String(r['name'])}</span>,
    },
    { key: 'products', label: 'Productos', render: (r) => String(r['productCount']) },
    {
      key: 'theme',
      label: 'Tema',
      render: (r) => {
        const theme = r['theme'] as Theme;
        if (!theme) return 'Estándar';
        return (
          <span class="inline-flex items-center gap-2">
            {[theme.background, theme.accent, theme.accent2].filter(Boolean).map((c) => (
              <span
                key={c}
                class="size-5 rounded-full ring-1 ring-noche/20"
                style={{ background: c }}
              />
            ))}
            {theme.mode === 'dark' ? 'Oscuro' : 'Claro'}
          </span>
        );
      },
    },
    {
      key: 'active',
      label: 'Estado',
      render: (r) => (
        <Badge tone={r['isActive'] ? 'ok' : 'neutral'}>{r['isActive'] ? 'Activa' : 'Oculta'}</Badge>
      ),
    },
  ],
  fields: [
    { kind: 'text', name: 'name', label: 'Nombre' },
    { kind: 'text', name: 'slug', label: 'Slug (URL)', hint: 'La página queda en /marcas/slug.' },
    { kind: 'textarea', name: 'description', label: 'Descripción', rows: 3 },
    { kind: 'number', name: 'sortOrder', label: 'Orden' },
    { kind: 'toggle', name: 'isActive', label: 'Visible en la tienda' },
    { kind: 'toggle', name: 'customTheme', label: 'Usar tema propio en su página' },
    {
      kind: 'select',
      name: 'mode',
      label: 'Modo del tema',
      options: () => [
        { value: 'light', label: 'Claro' },
        { value: 'dark', label: 'Oscuro' },
      ],
    },
    { kind: 'text', name: 'background', label: 'Color de fondo', hint: 'Formato #RRGGBB' },
    { kind: 'text', name: 'accent', label: 'Color de acento', hint: 'Formato #RRGGBB' },
    { kind: 'text', name: 'accent2', label: 'Segundo acento (opcional)', hint: 'Formato #RRGGBB' },
  ],
  empty: () => ({
    name: '',
    slug: '',
    description: '',
    sortOrder: '0',
    isActive: true,
    customTheme: false,
    mode: 'light',
    background: '',
    accent: '',
    accent2: '',
  }),
  toValues: (r) => {
    const theme = r['theme'] as Theme;
    return {
      name: String(r['name']),
      slug: String(r['slug']),
      description: String(r['description'] ?? ''),
      sortOrder: String(r['sortOrder']),
      isActive: Boolean(r['isActive']),
      customTheme: Boolean(theme),
      mode: theme?.mode ?? 'light',
      background: theme?.background ?? '',
      accent: theme?.accent ?? '',
      accent2: theme?.accent2 ?? '',
    };
  },
  toPayload: (v) => ({
    name: v['name'],
    slug: v['slug'],
    description: v['description'],
    sortOrder: Number(v['sortOrder'] || 0),
    isActive: v['isActive'],
    theme: v['customTheme']
      ? Object.fromEntries(
          Object.entries({
            mode: v['mode'],
            background: v['background'],
            accent: v['accent'],
            accent2: v['accent2'],
          }).filter(([, x]) => x),
        )
      : null,
  }),
  onChange: (name, values, editing) =>
    name === 'name' && !editing ? { ...values, slug: slugify(String(values['name'])) } : values,
  deleteWarning: (r) => (
    <p>
      Los {String(r['productCount'])} productos de "{String(r['name'])}" no se borran: quedan sin
      marca.
    </p>
  ),
};

export default function BrandManager() {
  return <EntityManager config={config} />;
}
