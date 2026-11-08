import { useEffect, useState } from 'preact/hooks';
import { api } from './api';
import {
  Button,
  Loading,
  Notice,
  PageHeader,
  Select,
  TextArea,
  TextInput,
  toFieldErrors,
  type FieldErrors,
} from './ui';

type Settings = Record<string, string | number | null>;

const LEGAL: { key: string; label: string; hint: string }[] = [
  { key: 'legalTerms', label: 'Términos y condiciones', hint: 'Se publica en /legal/terminos' },
  {
    key: 'legalPrivacy',
    label: 'Privacidad y tratamiento de datos (Ley 1581 de 2012)',
    hint: 'Se publica en /legal/privacidad',
  },
  {
    key: 'legalWithdrawal',
    label: 'Derecho de retracto y garantías (Ley 1480 de 2011)',
    hint: 'Se publica en /legal/retracto',
  },
  { key: 'legalShipping', label: 'Política de envíos', hint: 'Se publica en /legal/envios' },
  {
    key: 'legalReturns',
    label: 'Política de devoluciones',
    hint: 'Se publica en /legal/devoluciones',
  },
];

export default function SettingsForm() {
  const [values, setValues] = useState<Settings | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<{ data: Settings }>('/api/admin/settings').then(
      (r) => setValues(r.data),
      (e) => setMessage({ tone: 'error', text: toFieldErrors(e).message }),
    );
  }, []);
  if (!values) return message ? <Notice tone="error">{message.text}</Notice> : <Loading />;

  const text = (key: string) =>
    values[key] === null || values[key] === undefined ? '' : String(values[key]);
  const set = (key: string, value: string) => setValues({ ...values, [key]: value });

  async function save(event: Event) {
    event.preventDefault();
    setSaving(true);
    setErrors({});
    setMessage(null);
    try {
      const payload = {
        storeName: text('storeName'),
        whatsappNumber: text('whatsappNumber'),
        contactEmail: text('contactEmail') || null,
        supportEmail: text('supportEmail') || null,
        instagramUrl: text('instagramUrl') || null,
        settlementFrequency: text('settlementFrequency'),
        lowStockThreshold: Number(text('lowStockThreshold') || 0),
        ...Object.fromEntries(LEGAL.map((l) => [l.key, text(l.key)])),
      };
      const res = await api.put<{ data: Settings }>('/api/admin/settings', payload);
      setValues(res.data);
      setMessage({ tone: 'ok', text: 'Configuración guardada.' });
    } catch (e) {
      const parsed = toFieldErrors(e);
      setErrors(parsed.fields);
      setMessage({ tone: 'error', text: parsed.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} noValidate class="space-y-6 pb-28">
      <PageHeader
        title="Configuración de la tienda"
        description="Datos de contacto, textos legales y parámetros del negocio."
      />
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <section class="grid gap-4 rounded-3xl bg-white p-5 ring-1 ring-luna/10 sm:grid-cols-2 sm:p-6">
        <TextInput
          id="storeName"
          label="Nombre de la tienda"
          value={text('storeName')}
          error={errors['storeName']}
          onInput={(v) => set('storeName', v)}
        />
        <TextInput
          id="whatsappNumber"
          label="WhatsApp"
          inputMode="numeric"
          value={text('whatsappNumber')}
          error={errors['whatsappNumber']}
          hint="Con indicativo, solo dígitos: 573001234567"
          onInput={(v) => set('whatsappNumber', v)}
        />
        <TextInput
          id="contactEmail"
          label="Correo de contacto"
          type="email"
          value={text('contactEmail')}
          error={errors['contactEmail']}
          onInput={(v) => set('contactEmail', v)}
        />
        <TextInput
          id="supportEmail"
          label="Correo de soporte"
          type="email"
          value={text('supportEmail')}
          error={errors['supportEmail']}
          onInput={(v) => set('supportEmail', v)}
        />
        <TextInput
          id="instagramUrl"
          label="Instagram (URL)"
          value={text('instagramUrl')}
          error={errors['instagramUrl']}
          onInput={(v) => set('instagramUrl', v)}
        />
        <TextInput
          id="lowStockThreshold"
          label="Alerta de stock bajo (unidades)"
          inputMode="numeric"
          value={text('lowStockThreshold')}
          error={errors['lowStockThreshold']}
          onInput={(v) => set('lowStockThreshold', v)}
        />
        <Select
          id="settlementFrequency"
          label="Frecuencia de liquidación"
          value={text('settlementFrequency')}
          onChange={(v) => set('settlementFrequency', v)}
          options={[
            { value: 'BIWEEKLY', label: 'Quincenal' },
            { value: 'MONTHLY', label: 'Mensual' },
          ]}
        />
      </section>
      <section class="space-y-4 rounded-3xl bg-white p-5 ring-1 ring-luna/10 sm:p-6">
        <h2 class="text-2xl">Textos legales</h2>
        <p class="text-sm text-noche/70">
          Puedes usar Markdown: # para títulos, ** para negrilla y - para listas. Revísalos con un
          asesor legal antes de publicar.
        </p>
        {LEGAL.map((l) => (
          <TextArea
            key={l.key}
            id={l.key}
            label={l.label}
            hint={l.hint}
            rows={8}
            value={text(l.key)}
            error={errors[l.key]}
            onInput={(v) => set(l.key, v)}
          />
        ))}
      </section>
      <div class="fixed inset-x-0 bottom-0 z-20 border-t border-luna/10 bg-crema/95 px-4 py-3 backdrop-blur lg:left-64">
        <div class="mx-auto flex max-w-7xl justify-end">
          <Button type="submit" busy={saving}>
            Guardar configuración
          </Button>
        </div>
      </div>
    </form>
  );
}
