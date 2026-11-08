import { formatCOP } from '@sol-y-luna/shared';
import { useEffect, useState } from 'preact/hooks';
import { apiFetch } from '../../lib/auth-client';
import { imageUrl } from '../../lib/images';
import { Button, Loading, Notice, toFieldErrors } from '../admin/ui';

interface Item {
  id: string;
  name: string;
  slug: string;
  isAdult: boolean;
  price: number;
  image: { publicId: string; alt: string } | null;
  inStock: boolean;
}

export default function Wishlist() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    apiFetch<{ data: Item[] }>('/api/account/wishlist')
      .then((res) => setItems(res.data))
      .catch((e: unknown) => {
        setItems([]);
        setError(toFieldErrors(e).message);
      });
  }, []);

  if (items === null) return <Loading />;
  if (error) return <Notice tone="error">{error}</Notice>;
  if (items.length === 0)
    return (
      <div class="rounded-[2rem] border-2 border-dashed border-luna/25 p-8 text-center">
        <p>Guarda productos con el corazón de cada ficha y los encuentras aquí.</p>
        <a
          href="/productos"
          class="mt-4 inline-flex min-h-11 items-center rounded-full bg-luna px-6 font-semibold text-crema"
        >
          Ver productos
        </a>
      </div>
    );

  return (
    <ul class="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 lg:grid-cols-3">
      {items.map((p) => (
        <li key={p.id} class="flex flex-col rounded-[1.5rem] bg-white p-4 ring-1 ring-luna/10">
          <a href={`/productos/${p.slug}`} class="group block">
            <span class="grid aspect-square place-items-center overflow-hidden rounded-[1.25rem] bg-crema-200">
              <img
                src={imageUrl(p.image?.publicId ?? null, 400)}
                alt={p.image?.alt ?? p.name}
                width="400"
                height="400"
                loading="lazy"
                class={`size-3/4 object-contain ${p.isAdult ? 'blur-md' : ''}`}
              />
            </span>
            <span class="mt-3 block font-display text-lg font-bold break-words text-noche group-hover:text-luna">
              {p.name}
            </span>
          </a>
          <p class="mt-1 text-sm">
            Desde <strong class="font-display text-base">{formatCOP(p.price)}</strong>
            {!p.inStock && <span class="ml-2 text-sol-700">Agotado</span>}
          </p>
          <div class="mt-auto pt-3">
            <Button
              variant="ghost"
              onClick={async () => {
                setItems((list) => list?.filter((i) => i.id !== p.id) ?? null);
                try {
                  await apiFetch(`/api/account/wishlist/${p.id}`, { method: 'DELETE' });
                } catch (e) {
                  setError(toFieldErrors(e).message);
                }
              }}
            >
              Quitar<span class="sr-only"> {p.name} de la lista</span>
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
