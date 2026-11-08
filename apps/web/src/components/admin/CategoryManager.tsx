import { slugify } from '@sol-y-luna/shared';
import { Badge, Notice } from './ui';
import { EntityManager, type EntityConfig } from './EntityManager';

const config: EntityConfig = {
  title: 'Categorías',
  description: 'Organiza el catálogo. Una subcategoría se muestra dentro de su categoría padre.',
  singular: 'Categoría',
  gender: 'f',
  endpoint: '/api/admin/categories',
  columns: [
    {
      key: 'name',
      label: 'Nombre',
      render: (r) => <span class="font-semibold">{String(r['name'])}</span>,
    },
    {
      key: 'parent',
      label: 'Dentro de',
      render: (r) => (r['parent'] as { name: string } | null)?.name ?? '—',
    },
    { key: 'order', label: 'Orden', render: (r) => String(r['sortOrder']) },
    { key: 'products', label: 'Productos', render: (r) => String(r['productCount']) },
    {
      key: 'flags',
      label: 'Estado',
      render: (r) => (
        <span class="flex flex-wrap gap-1">
          <Badge tone={r['isActive'] ? 'ok' : 'neutral'}>
            {r['isActive'] ? 'Activa' : 'Oculta'}
          </Badge>
          {Boolean(r['isAdult']) && <Badge tone="danger">+18</Badge>}
        </span>
      ),
    },
  ],
  fields: [
    { kind: 'text', name: 'name', label: 'Nombre' },
    { kind: 'text', name: 'slug', label: 'Slug (URL)', hint: 'Se genera a partir del nombre.' },
    {
      kind: 'select',
      name: 'parentId',
      label: 'Categoría padre',
      options: (_values, rows) => [
        { value: '', label: 'Ninguna (categoría principal)' },
        ...rows
          .filter((r) => !r['parentId'])
          .map((r) => ({ value: r.id, label: String(r['name']) })),
      ],
    },
    { kind: 'textarea', name: 'description', label: 'Descripción', rows: 3 },
    {
      kind: 'number',
      name: 'sortOrder',
      label: 'Orden',
      hint: 'Las categorías se muestran de menor a mayor.',
    },
    { kind: 'toggle', name: 'isActive', label: 'Visible en la tienda' },
    {
      kind: 'toggle',
      name: 'isAdult',
      label: 'Solo mayores de 18 años',
      hint: 'Pide verificación de edad antes de mostrarla.',
    },
  ],
  empty: () => ({
    name: '',
    slug: '',
    parentId: '',
    description: '',
    sortOrder: '0',
    isActive: true,
    isAdult: false,
  }),
  toValues: (r) => ({
    name: String(r['name']),
    slug: String(r['slug']),
    parentId: String(r['parentId'] ?? ''),
    description: String(r['description'] ?? ''),
    sortOrder: String(r['sortOrder']),
    isActive: Boolean(r['isActive']),
    isAdult: Boolean(r['isAdult']),
  }),
  toPayload: (v) => ({
    name: v['name'],
    slug: v['slug'],
    parentId: v['parentId'] || null,
    description: v['description'],
    sortOrder: Number(v['sortOrder'] || 0),
    isActive: v['isActive'],
    isAdult: v['isAdult'],
  }),
  onChange: (name, values, editing) =>
    name === 'name' && !editing ? { ...values, slug: slugify(String(values['name'])) } : values,
  deleteWarning: (r) => (
    <p>
      Los {String(r['productCount'])} productos de "{String(r['name'])}" no se borran: quedan{' '}
      <strong>sin categoría</strong> y siguen apareciendo en "Todos los productos". Sus
      subcategorías pasan a ser principales.
    </p>
  ),
  listMeta: (meta) =>
    meta && Number(meta['uncategorizedProducts']) > 0 ? (
      <Notice tone="info">
        Hay {String(meta['uncategorizedProducts'])} productos sin categoría.{' '}
        <a class="font-semibold underline" href="/admin/productos?categoria=none">
          Verlos
        </a>
      </Notice>
    ) : null,
};

export default function CategoryManager() {
  return <EntityManager config={config} />;
}
