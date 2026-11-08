import { formatCOP, PLACEHOLDER_IMAGES, slugify } from '@sol-y-luna/shared';
import { useEffect, useState } from 'preact/hooks';
import { imageUrl } from '../../lib/images';
import { api, AUDIENCE_LABELS, INVIMA_LABELS, STATUS_LABELS } from './api';
import {
  Button,
  ConfirmDialog,
  Loading,
  Notice,
  PageHeader,
  Select,
  TextArea,
  TextInput,
  Toggle,
  toFieldErrors,
  type FieldErrors,
} from './ui';

interface Variant {
  id?: string;
  key: string;
  name: string;
  sku: string;
  retailPrice: string;
  compareAtPrice: string;
  wholesalePrice: string;
  wholesaleMinQty: string;
  stock: string;
  weightGrams: string;
  isActive: boolean;
  reservedStock?: number;
}
interface Image {
  id?: string;
  key: string;
  publicId: string;
  alt: string;
}
interface Form {
  name: string;
  slug: string;
  shortDescription: string;
  description: string;
  benefits: string[];
  usage: string;
  ingredients: string;
  warnings: string;
  categoryId: string;
  brandId: string;
  audience: string;
  isAdult: boolean;
  invimaStatus: string;
  invimaCode: string;
  disclaimer: string;
  status: string;
  featured: boolean;
  seoTitle: string;
  seoDescription: string;
  variants: Variant[];
  images: Image[];
}
interface Option {
  id: string;
  name: string;
  parentId?: string | null;
}
interface UploadSignature {
  cloudName: string;
  apiKey: string;
  timestamp: number;
  folder: string;
  allowedFormats: string;
  signature: string;
  uploadUrl: string;
  maxBytes: number;
  allowedMimeTypes: string[];
}

const SUPPLEMENT_DISCLAIMER =
  'Este producto es un suplemento dietario, no es un medicamento y no suple una alimentación equilibrada.';

let keySeq = 0;
const newKey = () => `k${++keySeq}`;

const emptyVariant = (): Variant => ({
  key: newKey(),
  name: '',
  sku: '',
  retailPrice: '',
  compareAtPrice: '',
  wholesalePrice: '',
  wholesaleMinQty: '6',
  stock: '0',
  weightGrams: '',
  isActive: true,
});

const emptyForm = (): Form => ({
  name: '',
  slug: '',
  shortDescription: '',
  description: '',
  benefits: [''],
  usage: '',
  ingredients: '',
  warnings: '',
  categoryId: '',
  brandId: '',
  audience: 'UNISEX',
  isAdult: false,
  invimaStatus: 'NOT_REGISTERED',
  invimaCode: '',
  disclaimer: SUPPLEMENT_DISCLAIMER,
  status: 'DRAFT',
  featured: false,
  seoTitle: '',
  seoDescription: '',
  variants: [emptyVariant()],
  images: [],
});

const toInt = (v: string) => (v.trim() === '' ? null : Number(v.replace(/[.\s$]/g, '')));
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));

function fromApi(p: Record<string, unknown>): Form {
  const variants = (p['variants'] as Record<string, unknown>[]).map((v) => ({
    id: v['id'] as string,
    key: newKey(),
    name: str(v['name']),
    sku: str(v['sku']),
    retailPrice: str(v['retailPrice']),
    compareAtPrice: str(v['compareAtPrice']),
    wholesalePrice: str(v['wholesalePrice']),
    wholesaleMinQty: str(v['wholesaleMinQty']),
    stock: str(v['stock']),
    weightGrams: str(v['weightGrams']),
    isActive: Boolean(v['isActive']),
    reservedStock: Number(v['reservedStock'] ?? 0),
  }));
  const benefits = (p['benefits'] as string[]) ?? [];
  return {
    name: str(p['name']),
    slug: str(p['slug']),
    shortDescription: str(p['shortDescription']),
    description: str(p['description']),
    benefits: benefits.length ? benefits : [''],
    usage: str(p['usage']),
    ingredients: str(p['ingredients']),
    warnings: str(p['warnings']),
    categoryId: str(p['categoryId']),
    brandId: str(p['brandId']),
    audience: str(p['audience']),
    isAdult: Boolean(p['isAdult']),
    invimaStatus: str(p['invimaStatus']),
    invimaCode: str(p['invimaCode']),
    disclaimer: str(p['disclaimer']),
    status: str(p['status']),
    featured: Boolean(p['featured']),
    seoTitle: str(p['seoTitle']),
    seoDescription: str(p['seoDescription']),
    variants,
    images: (p['images'] as Record<string, unknown>[]).map((i) => ({
      id: i['id'] as string,
      key: newKey(),
      publicId: str(i['publicId']),
      alt: str(i['alt']),
    })),
  };
}

function toPayload(f: Form) {
  return {
    name: f.name,
    slug: f.slug,
    shortDescription: f.shortDescription,
    description: f.description,
    benefits: f.benefits.map((b) => b.trim()).filter(Boolean),
    usage: f.usage,
    ingredients: f.ingredients,
    warnings: f.warnings,
    categoryId: f.categoryId || null,
    brandId: f.brandId || null,
    audience: f.audience,
    isAdult: f.isAdult,
    invimaStatus: f.invimaStatus,
    invimaCode: f.invimaCode,
    disclaimer: f.disclaimer,
    status: f.status,
    featured: f.featured,
    seoTitle: f.seoTitle,
    seoDescription: f.seoDescription,
    variants: f.variants.map((v) => ({
      ...(v.id ? { id: v.id } : {}),
      name: v.name,
      sku: v.sku,
      retailPrice: toInt(v.retailPrice) ?? 0,
      compareAtPrice: toInt(v.compareAtPrice),
      wholesalePrice: toInt(v.wholesalePrice),
      wholesaleMinQty: toInt(v.wholesaleMinQty) ?? 1,
      stock: toInt(v.stock) ?? 0,
      weightGrams: toInt(v.weightGrams),
      isActive: v.isActive,
    })),
    images: f.images.map((i) => ({
      ...(i.id ? { id: i.id } : {}),
      publicId: i.publicId,
      alt: i.alt,
    })),
  };
}

function Section(props: {
  title: string;
  description?: string;
  children: preact.ComponentChildren;
}) {
  return (
    <section class="rounded-3xl bg-white p-5 ring-1 ring-luna/10 sm:p-6">
      <h2 class="text-xl sm:text-2xl">{props.title}</h2>
      {props.description && <p class="mt-1 text-sm text-noche/70">{props.description}</p>}
      <div class="mt-5 space-y-4">{props.children}</div>
    </section>
  );
}

const moneyHint = (value: string) => {
  const n = toInt(value);
  return n !== null && Number.isFinite(n) ? formatCOP(Math.trunc(n)) : undefined;
};

export default function ProductForm({ productId }: { productId?: string }) {
  const [form, setForm] = useState<Form | null>(productId ? null : emptyForm());
  const [slugTouched, setSlugTouched] = useState(Boolean(productId));
  const [categories, setCategories] = useState<Option[]>([]);
  const [brands, setBrands] = useState<Option[]>([]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<{ tone: 'ok' | 'error' | 'info'; text: string } | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const [uploadsEnabled, setUploadsEnabled] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    api.get<{ data: Option[] }>('/api/admin/categories').then(
      (r) => setCategories(r.data),
      () => undefined,
    );
    api.get<{ data: Option[] }>('/api/admin/brands').then(
      (r) => setBrands(r.data),
      () => undefined,
    );
    api.get<{ enabled: boolean }>('/api/uploads/status').then(
      (r) => setUploadsEnabled(r.enabled),
      () => undefined,
    );
    if (productId) {
      api
        .get<{ data: Record<string, unknown> }>(`/api/admin/products/${productId}`)
        .then((r) => setForm(fromApi(r.data)))
        .catch((e) => setMessage({ tone: 'error', text: toFieldErrors(e).message }));
    }
  }, [productId]);

  if (!form) return message ? <Notice tone="error">{message.text}</Notice> : <Loading />;

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((f) => (f ? { ...f, [key]: value } : f));
  const setVariant = (index: number, patch: Partial<Variant>) =>
    setForm((f) =>
      f ? { ...f, variants: f.variants.map((v, i) => (i === index ? { ...v, ...patch } : v)) } : f,
    );
  const moveImage = (from: number, to: number) =>
    setForm((f) => {
      if (!f || to < 0 || to >= f.images.length) return f;
      const images = [...f.images];
      const [item] = images.splice(from, 1);
      images.splice(to, 0, item!);
      return { ...f, images };
    });
  const err = (key: string) => errors[key];

  async function save(event: Event) {
    event.preventDefault();
    if (!form) return;
    setSaving(true);
    setErrors({});
    setMessage(null);
    try {
      const payload = toPayload(form);
      const res = productId
        ? await api.put<{ data: Record<string, unknown> }>(
            `/api/admin/products/${productId}`,
            payload,
          )
        : await api.post<{ data: Record<string, unknown> }>('/api/admin/products', payload);
      if (!productId) {
        window.location.assign(`/admin/productos/${String(res.data['id'])}?creado=1`);
        return;
      }
      setForm(fromApi(res.data));
      setMessage({ tone: 'ok', text: 'Cambios guardados.' });
    } catch (e) {
      const parsed = toFieldErrors(e);
      setErrors(parsed.fields);
      setMessage({ tone: 'error', text: parsed.message });
      // Bring the first invalid field into view.
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
      );
    } finally {
      setSaving(false);
    }
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setMessage(null);
    try {
      for (const file of Array.from(files)) {
        const sig = (
          await api.post<{ data: UploadSignature }>('/api/uploads/signature', { kind: 'products' })
        ).data;
        if (!sig.allowedMimeTypes.includes(file.type))
          throw new Error(`"${file.name}": usa JPG, PNG, WebP o AVIF.`);
        if (file.size > sig.maxBytes) throw new Error(`"${file.name}" pesa más de 5 MB.`);
        const body = new FormData();
        body.set('file', file);
        body.set('api_key', sig.apiKey);
        body.set('timestamp', String(sig.timestamp));
        body.set('folder', sig.folder);
        body.set('allowed_formats', sig.allowedFormats);
        body.set('signature', sig.signature);
        const res = await fetch(sig.uploadUrl, { method: 'POST', body });
        if (!res.ok) throw new Error(`Cloudinary no aceptó "${file.name}".`);
        const uploaded = (await res.json()) as { public_id: string };
        await api.post('/api/uploads/verify', { publicId: uploaded.public_id });
        setForm((f) =>
          f
            ? {
                ...f,
                images: [
                  ...f.images,
                  {
                    key: newKey(),
                    publicId: uploaded.public_id,
                    alt: f.name || 'Foto del producto',
                  },
                ],
              }
            : f,
        );
      }
    } catch (e) {
      setMessage({
        tone: 'error',
        text: e instanceof Error && !('status' in e) ? e.message : toFieldErrors(e).message,
      });
    } finally {
      setUploading(false);
    }
  }

  const categoryOptions = [
    { value: '', label: 'Sin categoría' },
    ...categories.map((c) => ({
      value: c.id,
      label: c.parentId ? `— ${c.name}` : c.name,
    })),
  ];

  return (
    <form onSubmit={save} noValidate class="space-y-6 pb-28">
      <PageHeader
        title={productId ? form.name || 'Editar producto' : 'Nuevo producto'}
        description="Los precios van en pesos, sin decimales."
        actions={
          <a
            href="/admin/productos"
            class="inline-flex min-h-11 items-center rounded-full px-4 font-semibold text-luna hover:bg-luna-50"
          >
            ← Volver a productos
          </a>
        }
      />
      {typeof window !== 'undefined' &&
        new URLSearchParams(window.location.search).get('creado') &&
        !message && <Notice tone="ok">Producto creado.</Notice>}
      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      <div class="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <div class="space-y-6">
          <Section title="Información">
            <TextInput
              id="name"
              label="Nombre"
              value={form.name}
              error={err('name')}
              onInput={(v) =>
                setForm((f) => (f ? { ...f, name: v, slug: slugTouched ? f.slug : slugify(v) } : f))
              }
            />
            <TextInput
              id="slug"
              label="Slug (URL)"
              value={form.slug}
              error={err('slug')}
              hint={`/productos/${form.slug || 'nombre-del-producto'}`}
              onInput={(v) => {
                setSlugTouched(true);
                set('slug', v);
              }}
            />
            <TextArea
              id="shortDescription"
              label="Descripción corta"
              rows={2}
              value={form.shortDescription}
              error={err('shortDescription')}
              onInput={(v) => set('shortDescription', v)}
            />
            <TextArea
              id="description"
              label="Descripción larga"
              rows={6}
              value={form.description}
              error={err('description')}
              onInput={(v) => set('description', v)}
            />
          </Section>

          <Section
            title="Beneficios"
            description="Cada beneficio aparece como una viñeta en la ficha."
          >
            <ol class="space-y-3">
              {form.benefits.map((b, i) => (
                <li key={i} class="flex items-end gap-2">
                  <TextInput
                    id={`benefit-${i}`}
                    label={`Beneficio ${i + 1}`}
                    value={b}
                    class="flex-1"
                    error={err(`benefits.${i}`)}
                    onInput={(v) =>
                      set(
                        'benefits',
                        form.benefits.map((x, j) => (j === i ? v : x)),
                      )
                    }
                  />
                  <Button
                    variant="ghost"
                    aria-label={`Subir beneficio ${i + 1}`}
                    disabled={i === 0}
                    onClick={() => {
                      const list = [...form.benefits];
                      [list[i - 1], list[i]] = [list[i]!, list[i - 1]!];
                      set('benefits', list);
                    }}
                  >
                    ↑
                  </Button>
                  <Button
                    variant="ghost"
                    aria-label={`Quitar beneficio ${i + 1}`}
                    onClick={() =>
                      set(
                        'benefits',
                        form.benefits.filter((_, j) => j !== i),
                      )
                    }
                  >
                    ✕
                  </Button>
                </li>
              ))}
            </ol>
            {form.benefits.length < 12 && (
              <Button variant="secondary" onClick={() => set('benefits', [...form.benefits, ''])}>
                Agregar beneficio
              </Button>
            )}
          </Section>

          <Section
            title="Presentaciones"
            description="Todo producto necesita al menos una presentación. El stock reservado corresponde a pedidos pendientes de pago."
          >
            {err('variants') && <Notice tone="error">{err('variants')}</Notice>}
            {form.variants.map((v, i) => (
              <fieldset key={v.key} class="rounded-2xl border-2 border-luna/15 p-4">
                <legend class="px-2 font-display text-lg text-luna">
                  {v.name || `Presentación ${i + 1}`}
                </legend>
                <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <TextInput
                    id={`v-${i}-name`}
                    label="Nombre"
                    placeholder="60 cápsulas"
                    value={v.name}
                    error={err(`variants.${i}.name`)}
                    onInput={(x) => setVariant(i, { name: x })}
                  />
                  <TextInput
                    id={`v-${i}-sku`}
                    label="SKU"
                    value={v.sku}
                    error={err(`variants.${i}.sku`)}
                    onInput={(x) => setVariant(i, { sku: x.toUpperCase() })}
                  />
                  <TextInput
                    id={`v-${i}-retail`}
                    label="Precio detal"
                    inputMode="numeric"
                    value={v.retailPrice}
                    error={err(`variants.${i}.retailPrice`)}
                    hint={moneyHint(v.retailPrice)}
                    onInput={(x) => setVariant(i, { retailPrice: x })}
                  />
                  <TextInput
                    id={`v-${i}-compare`}
                    label="Precio antes (opcional)"
                    inputMode="numeric"
                    value={v.compareAtPrice}
                    error={err(`variants.${i}.compareAtPrice`)}
                    hint={moneyHint(v.compareAtPrice)}
                    onInput={(x) => setVariant(i, { compareAtPrice: x })}
                  />
                  <TextInput
                    id={`v-${i}-wholesale`}
                    label="Precio mayorista (opcional)"
                    inputMode="numeric"
                    value={v.wholesalePrice}
                    error={err(`variants.${i}.wholesalePrice`)}
                    hint={moneyHint(v.wholesalePrice)}
                    onInput={(x) => setVariant(i, { wholesalePrice: x })}
                  />
                  <TextInput
                    id={`v-${i}-minqty`}
                    label="Mínimo mayorista (unidades)"
                    inputMode="numeric"
                    value={v.wholesaleMinQty}
                    error={err(`variants.${i}.wholesaleMinQty`)}
                    onInput={(x) => setVariant(i, { wholesaleMinQty: x })}
                  />
                  <TextInput
                    id={`v-${i}-stock`}
                    label="Stock"
                    inputMode="numeric"
                    value={v.stock}
                    error={err(`variants.${i}.stock`)}
                    hint={v.reservedStock ? `${v.reservedStock} reservadas` : undefined}
                    onInput={(x) => setVariant(i, { stock: x })}
                  />
                  <TextInput
                    id={`v-${i}-weight`}
                    label="Peso en gramos (opcional)"
                    inputMode="numeric"
                    value={v.weightGrams}
                    error={err(`variants.${i}.weightGrams`)}
                    onInput={(x) => setVariant(i, { weightGrams: x })}
                  />
                  <div class="flex items-end">
                    <Toggle
                      id={`v-${i}-active`}
                      label="Activa"
                      checked={v.isActive}
                      onChange={(x) => setVariant(i, { isActive: x })}
                    />
                  </div>
                </div>
                {form.variants.length > 1 && (
                  <div class="mt-3 flex justify-end">
                    <Button
                      variant="ghost"
                      class="text-sol-700"
                      onClick={() =>
                        set(
                          'variants',
                          form.variants.filter((_, j) => j !== i),
                        )
                      }
                    >
                      Quitar presentación
                    </Button>
                  </div>
                )}
              </fieldset>
            ))}
            <Button
              variant="secondary"
              onClick={() => set('variants', [...form.variants, emptyVariant()])}
            >
              Agregar presentación
            </Button>
          </Section>

          <Section title="Uso, ingredientes y advertencias">
            <TextArea
              id="usage"
              label="Modo de uso"
              value={form.usage}
              error={err('usage')}
              onInput={(v) => set('usage', v)}
            />
            <TextArea
              id="ingredients"
              label="Ingredientes"
              value={form.ingredients}
              error={err('ingredients')}
              onInput={(v) => set('ingredients', v)}
            />
            <TextArea
              id="warnings"
              label="Advertencias"
              value={form.warnings}
              error={err('warnings')}
              onInput={(v) => set('warnings', v)}
            />
            <TextArea
              id="disclaimer"
              label="Aviso legal"
              rows={2}
              value={form.disclaimer}
              error={err('disclaimer')}
              onInput={(v) => set('disclaimer', v)}
            />
          </Section>
        </div>

        <div class="space-y-6">
          <Section title="Publicación">
            <Select
              id="status"
              label="Estado"
              value={form.status}
              onChange={(v) => set('status', v)}
              options={Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))}
            />
            <Toggle
              id="featured"
              label="Destacado en el inicio"
              checked={form.featured}
              onChange={(v) => set('featured', v)}
            />
          </Section>

          <Section title="Clasificación">
            <Select
              id="categoryId"
              label="Categoría"
              value={form.categoryId}
              error={err('categoryId')}
              onChange={(v) => set('categoryId', v)}
              options={categoryOptions}
            />
            <Select
              id="brandId"
              label="Marca"
              value={form.brandId}
              error={err('brandId')}
              onChange={(v) => set('brandId', v)}
              options={[
                { value: '', label: 'Sin marca' },
                ...brands.map((b) => ({ value: b.id, label: b.name })),
              ]}
            />
            <Select
              id="audience"
              label="Audiencia"
              value={form.audience}
              onChange={(v) => set('audience', v)}
              options={Object.entries(AUDIENCE_LABELS).map(([value, label]) => ({ value, label }))}
            />
            <Toggle
              id="isAdult"
              label="Producto para mayores de 18 años"
              hint="Pide verificación de edad y difumina la imagen en los listados."
              checked={form.isAdult}
              onChange={(v) => set('isAdult', v)}
            />
          </Section>

          <Section title="Registro INVIMA">
            <Select
              id="invimaStatus"
              label="Estado del registro"
              value={form.invimaStatus}
              onChange={(v) => set('invimaStatus', v)}
              options={Object.entries(INVIMA_LABELS).map(([value, label]) => ({ value, label }))}
            />
            {(form.invimaStatus === 'REGISTERED' || form.invimaStatus === 'IN_PROCESS') && (
              <TextInput
                id="invimaCode"
                label={
                  form.invimaStatus === 'REGISTERED'
                    ? 'Número de registro'
                    : 'Número de radicado (opcional)'
                }
                value={form.invimaCode}
                error={err('invimaCode')}
                onInput={(v) => set('invimaCode', v)}
              />
            )}
          </Section>

          <Section
            title="Imágenes"
            description="La primera es la principal. Arrastra para ordenar o usa las flechas."
          >
            {form.images.length === 0 && (
              <p class="text-sm text-noche/70">
                Sin imágenes: la tienda mostrará una imagen de ejemplo.
              </p>
            )}
            <ul class="grid grid-cols-2 gap-3">
              {form.images.map((img, i) => (
                <li
                  key={img.key}
                  draggable
                  onDragStart={() => setDragKey(img.key)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    const from = form.images.findIndex((x) => x.key === dragKey);
                    if (from >= 0) moveImage(from, i);
                    setDragKey(null);
                  }}
                  class={`rounded-2xl border-2 p-2 ${dragKey === img.key ? 'border-sol' : 'border-luna/15'} bg-crema-50`}
                >
                  <img
                    src={imageUrl(img.publicId, 300)}
                    alt=""
                    class="aspect-square w-full rounded-xl object-cover"
                    loading="lazy"
                  />
                  <TextInput
                    id={`img-${i}-alt`}
                    label="Texto alternativo"
                    value={img.alt}
                    error={err(`images.${i}.alt`)}
                    onInput={(v) =>
                      set(
                        'images',
                        form.images.map((x, j) => (j === i ? { ...x, alt: v } : x)),
                      )
                    }
                  />
                  <div class="mt-1 flex justify-between">
                    <Button
                      variant="ghost"
                      aria-label="Mover a la izquierda"
                      disabled={i === 0}
                      onClick={() => moveImage(i, i - 1)}
                    >
                      ←
                    </Button>
                    <Button
                      variant="ghost"
                      aria-label="Quitar imagen"
                      class="text-sol-700"
                      onClick={() =>
                        set(
                          'images',
                          form.images.filter((_, j) => j !== i),
                        )
                      }
                    >
                      ✕
                    </Button>
                    <Button
                      variant="ghost"
                      aria-label="Mover a la derecha"
                      disabled={i === form.images.length - 1}
                      onClick={() => moveImage(i, i + 1)}
                    >
                      →
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            {uploadsEnabled ? (
              <label class="flex min-h-11 cursor-pointer items-center justify-center rounded-full border-2 border-dashed border-luna px-4 py-3 text-sm font-semibold text-luna hover:bg-luna-50">
                {uploading ? 'Subiendo…' : 'Subir fotos (JPG, PNG, WebP o AVIF, hasta 5 MB)'}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/avif"
                  multiple
                  class="sr-only"
                  disabled={uploading}
                  onChange={(e) => upload((e.target as HTMLInputElement).files)}
                />
              </label>
            ) : (
              <Notice tone="info">
                La subida de fotos está deshabilitada hasta configurar Cloudinary. Puedes usar una
                imagen de ejemplo:
              </Notice>
            )}
            <div class="flex flex-wrap gap-2">
              {PLACEHOLDER_IMAGES.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() =>
                    set('images', [
                      ...form.images,
                      {
                        key: newKey(),
                        publicId: `/placeholders/${name}.svg`,
                        alt: form.name || 'Imagen de ejemplo',
                      },
                    ])
                  }
                  class="flex min-h-11 items-center gap-2 rounded-full border-2 border-luna/20 px-3 text-sm hover:border-luna"
                >
                  <img src={`/placeholders/${name}.svg`} alt="" class="size-7 rounded-full" />
                  {name}
                </button>
              ))}
            </div>
          </Section>

          <Section
            title="SEO"
            description="Si los dejas vacíos se usan el nombre y la descripción corta."
          >
            <TextInput
              id="seoTitle"
              label="Título"
              value={form.seoTitle}
              error={err('seoTitle')}
              hint={`${form.seoTitle.length}/70`}
              onInput={(v) => set('seoTitle', v)}
            />
            <TextArea
              id="seoDescription"
              label="Descripción"
              rows={3}
              value={form.seoDescription}
              error={err('seoDescription')}
              hint={`${form.seoDescription.length}/170`}
              onInput={(v) => set('seoDescription', v)}
            />
          </Section>

          {productId && (
            <Section title="Zona de peligro">
              <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                Borrar producto
              </Button>
            </Section>
          )}
        </div>
      </div>

      <div class="fixed inset-x-0 bottom-0 z-20 border-t border-luna/10 bg-crema/95 px-4 py-3 backdrop-blur lg:left-64">
        <div class="mx-auto flex max-w-7xl items-center justify-end gap-3">
          <a
            href="/admin/productos"
            class="inline-flex min-h-11 items-center rounded-full px-4 font-semibold text-luna hover:bg-luna-50"
          >
            Cancelar
          </a>
          <Button type="submit" busy={saving}>
            {productId ? 'Guardar cambios' : 'Crear producto'}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        danger
        title="Borrar producto"
        confirmLabel="Borrar producto"
        body={
          <p>
            El producto dejará de verse en la tienda y en el panel. Los pedidos que ya lo incluyen
            no cambian.
          </p>
        }
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          try {
            await api.del(`/api/admin/products/${productId}`);
            window.location.assign('/admin/productos');
          } catch (e) {
            setMessage({ tone: 'error', text: toFieldErrors(e).message });
            setConfirmDelete(false);
          }
        }}
      />
    </form>
  );
}
