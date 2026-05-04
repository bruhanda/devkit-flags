/**
 * Cache the most recent `ETag` returned by the remote endpoint so the
 * next poll can send `If-None-Match` and let the CDN reply `304`.
 *
 * Tiny mutable holder, scoped per-source. Not exported from the
 * package — purely internal plumbing.
 */
export class EtagCache {
  private etag: string | undefined;
  private lastModified: string | undefined;

  /** Apply cached validators to the next outgoing request. */
  applyTo(headers: Headers): void {
    if (this.etag !== undefined) headers.set('If-None-Match', this.etag);
    if (this.lastModified !== undefined) headers.set('If-Modified-Since', this.lastModified);
  }

  /** Capture validators from a successful response. */
  captureFrom(response: Response): void {
    const etag = response.headers.get('ETag');
    const lastModified = response.headers.get('Last-Modified');
    if (etag !== null) this.etag = etag;
    if (lastModified !== null) this.lastModified = lastModified;
  }
}
