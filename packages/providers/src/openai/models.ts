/**
 * Model catalogue for the signed-in account: GET /v1/models with the plan
 * access token. Documented shape (models-and-inference, 2026-10-09):
 * `{ models: [{ slug, display_name, visibility }] }`; keep `visibility ==
 * "list"` in server order, show `display_name`, send `slug` as `model`.
 * The standard API shape (`{ data: [{ id }] }`) is accepted too, and the
 * shape seen is reported, so the device test records what really came back.
 */

import { err, ok, parseJsonObject, readTextSafely, stringField, type FetchLike, type Result } from '../http';
import { OPENAI_MODELS_URL } from './constants';
import { failure, mapApiError, type ProviderFailure } from './errors';
import { timedFetch } from './tokens';

export interface ModelOption {
  slug: string;
  displayName: string;
}

export interface ModelList {
  models: ModelOption[];
  /** Entries returned but not meant for display (visibility other than "list"). */
  hiddenCount: number;
  shape: 'models' | 'data';
  requestId: string | null;
}

export async function listModels(
  accessToken: string,
  options: { fetch: FetchLike; timeoutMs?: number },
): Promise<Result<ModelList, ProviderFailure>> {
  const sent = await timedFetch(
    OPENAI_MODELS_URL,
    { method: 'GET', headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } },
    options,
  );
  if (!sent.ok) return sent;
  const response = sent.value;
  const text = await readTextSafely(response);
  const requestId = response.headers.get('x-request-id');
  if (!response.ok) return err(mapApiError(response.status, text, requestId));
  const parsed = parseModelList(text);
  if (parsed === null) return err(failure('protocol', 'The model list was not in a known format', { status: response.status, requestId: requestId ?? undefined }));
  return ok({ ...parsed, requestId });
}

export function parseModelList(text: string): Omit<ModelList, 'requestId'> | null {
  const json = parseJsonObject(text);
  if (json === null) return null;
  if (Array.isArray(json.models)) {
    const models: ModelOption[] = [];
    let hidden = 0;
    for (const raw of json.models as unknown[]) {
      const m = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : null;
      const slug = stringField(m, 'slug');
      if (slug === undefined || slug === '') continue;
      if (stringField(m, 'visibility') !== 'list') {
        hidden += 1;
        continue;
      }
      models.push({ slug, displayName: stringField(m, 'display_name') ?? slug });
    }
    return { models, hiddenCount: hidden, shape: 'models' };
  }
  if (Array.isArray(json.data)) {
    const models: ModelOption[] = [];
    for (const raw of json.data as unknown[]) {
      const id = stringField(typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : null, 'id');
      if (id !== undefined && id !== '') models.push({ slug: id, displayName: id });
    }
    return { models, hiddenCount: 0, shape: 'data' };
  }
  return null;
}

/** Design AC6: the tested model if listed, otherwise the first; never a silent swap later. */
export function pickModel(list: readonly ModelOption[], preferredSlug: string | null): ModelOption | null {
  if (preferredSlug !== null) {
    const found = list.find((m) => m.slug === preferredSlug);
    if (found !== undefined) return found;
  }
  return list[0] ?? null;
}
