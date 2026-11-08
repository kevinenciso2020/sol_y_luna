import { createHash } from 'node:crypto';
import { MAX_UPLOAD_BYTES } from '@sol-y-luna/shared';
import { HttpError } from '../lib/http-error.js';

export const ALLOWED_IMAGE_FORMATS = ['jpg', 'jpeg', 'png', 'webp', 'avif'] as const;
export const ALLOWED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'] as const;

export interface CloudinaryConfig {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
  folder: string;
}

export interface UploadSignature {
  cloudName: string;
  apiKey: string;
  timestamp: number;
  folder: string;
  allowedFormats: string;
  signature: string;
  uploadUrl: string;
  maxBytes: number;
  allowedMimeTypes: readonly string[];
}

export interface VerifiedImage {
  publicId: string;
  format: string;
  bytes: number;
  width: number;
  height: number;
}

export interface CloudinaryService {
  enabled: boolean;
  folder: string;
  sign(subfolder: string): UploadSignature;
  verify(publicId: string): Promise<VerifiedImage>;
  /** True when a publicId belongs to our folder (or is a local placeholder). */
  isAllowedPublicId(publicId: string): boolean;
}

export const UPLOADS_DISABLED_MESSAGE =
  'La subida de imágenes está deshabilitada porque faltan las credenciales de Cloudinary. Mientras tanto puedes usar las imágenes de ejemplo.';

/**
 * Cloudinary signed uploads: the browser uploads straight to Cloudinary with a signature generated
 * here (the API secret never leaves the server); afterwards the API verifies type, size and folder.
 */
export function createCloudinaryService(
  config: CloudinaryConfig | null,
  fetchImpl: typeof fetch = fetch,
): CloudinaryService {
  const folder = config?.folder ?? 'sol-y-luna';
  const isPlaceholder = (id: string) => /^\/placeholders\/[a-z0-9-]+\.svg$/.test(id);

  return {
    enabled: config !== null,
    folder,
    isAllowedPublicId: (id) =>
      isPlaceholder(id) || (id.startsWith(`${folder}/`) && !id.includes('..')),

    sign(subfolder) {
      if (!config) throw new HttpError(503, UPLOADS_DISABLED_MESSAGE, 'UPLOADS_DISABLED');
      const timestamp = Math.floor(Date.now() / 1000);
      const targetFolder = `${config.folder}/${subfolder}`;
      const allowedFormats = ALLOWED_IMAGE_FORMATS.join(',');
      // Parameters sorted alphabetically, joined with &, followed by the API secret.
      const toSign = `allowed_formats=${allowedFormats}&folder=${targetFolder}&timestamp=${timestamp}`;
      const signature = createHash('sha1')
        .update(toSign + config.apiSecret)
        .digest('hex');
      return {
        cloudName: config.cloudName,
        apiKey: config.apiKey,
        timestamp,
        folder: targetFolder,
        allowedFormats,
        signature,
        uploadUrl: `https://api.cloudinary.com/v1_1/${config.cloudName}/image/upload`,
        maxBytes: MAX_UPLOAD_BYTES,
        allowedMimeTypes: ALLOWED_IMAGE_MIME,
      };
    },

    async verify(publicId) {
      if (!config) throw new HttpError(503, UPLOADS_DISABLED_MESSAGE, 'UPLOADS_DISABLED');
      if (!publicId.startsWith(`${config.folder}/`) || publicId.includes('..')) {
        throw new HttpError(
          400,
          'La imagen no pertenece a la carpeta de la tienda',
          'INVALID_IMAGE',
        );
      }
      const auth = `Basic ${Buffer.from(`${config.apiKey}:${config.apiSecret}`).toString('base64')}`;
      const base = `https://api.cloudinary.com/v1_1/${config.cloudName}/resources/image/upload`;
      const res = await fetchImpl(
        `${base}/${publicId.split('/').map(encodeURIComponent).join('/')}`,
        {
          headers: { Authorization: auth },
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (res.status === 404)
        throw new HttpError(400, 'No encontramos la imagen en Cloudinary', 'INVALID_IMAGE');
      if (!res.ok)
        throw new HttpError(502, 'Cloudinary no respondió. Intenta de nuevo.', 'UPSTREAM_ERROR');
      const info = (await res.json()) as {
        format: string;
        bytes: number;
        width: number;
        height: number;
      };

      const problem = !(ALLOWED_IMAGE_FORMATS as readonly string[]).includes(info.format)
        ? 'Formato no permitido. Usa JPG, PNG, WebP o AVIF.'
        : info.bytes > MAX_UPLOAD_BYTES
          ? 'La imagen pesa más de 5 MB.'
          : null;
      if (problem) {
        // Remove the rejected file so it does not linger in the account.
        await fetchImpl(`${base}?public_ids[]=${encodeURIComponent(publicId)}`, {
          method: 'DELETE',
          headers: { Authorization: auth },
          signal: AbortSignal.timeout(10_000),
        }).catch(() => undefined);
        throw new HttpError(400, problem, 'INVALID_IMAGE');
      }
      return {
        publicId,
        format: info.format,
        bytes: info.bytes,
        width: info.width,
        height: info.height,
      };
    },
  };
}
