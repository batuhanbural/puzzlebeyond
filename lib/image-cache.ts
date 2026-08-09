export type ImageRequestConditions = {
  ifNoneMatch?: string | null;
  ifModifiedSince?: string | null;
};

function comparableEtag(value: string) {
  return value.trim().replace(/^W\//i, "");
}

export function imageEtagMatches(ifNoneMatch: string | null | undefined, etag: string | null | undefined) {
  if (!ifNoneMatch || !etag) return false;
  const current = comparableEtag(etag);
  return ifNoneMatch.split(",").some((candidate) => {
    const normalized = candidate.trim();
    return normalized === "*" || comparableEtag(normalized) === current;
  });
}

export function imageRequestNotModified(
  conditions: ImageRequestConditions | undefined,
  etag: string | null,
  lastModified: string | null,
) {
  const ifNoneMatch = conditions?.ifNoneMatch?.trim();
  if (ifNoneMatch) return imageEtagMatches(ifNoneMatch, etag);
  const ifModifiedSince = conditions?.ifModifiedSince?.trim();
  if (!ifModifiedSince || !lastModified) return false;
  const requestedAt = Date.parse(ifModifiedSince);
  const modifiedAt = Date.parse(lastModified);
  return Number.isFinite(requestedAt)
    && Number.isFinite(modifiedAt)
    && Math.floor(modifiedAt / 1000) <= Math.floor(requestedAt / 1000);
}
