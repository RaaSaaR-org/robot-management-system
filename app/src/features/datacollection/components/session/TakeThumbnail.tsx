/**
 * @file TakeThumbnail.tsx
 * @description The middle frame of a take. The server route is behind auth,
 *              so the image is fetched through the API client (bearer token)
 *              and shown from a blob URL; a bare `<img src>` would only work
 *              with auth disabled. Fetched once per take per page load, and
 *              only when the row scrolls into view. A take without a frame
 *              (no camera, or not stopped yet) reads "No thumbnail".
 * @feature datacollection
 */

import { useEffect, useRef, useState } from 'react';
import { ImageOff } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { datacollectionApi } from '../../api/datacollectionApi';
import { takeLabel } from '../../utils/takeFormat';

export interface TakeThumbnailProps {
  sessionId: string;
  /** 0-based wire take */
  take: number;
  /** False when the server already said there is none (quick check `thumbnailUrl: null`) */
  available?: boolean;
  className?: string;
}

/** One request per take; the promise resolves to a blob URL, or null when there is none. */
const cache = new Map<string, Promise<string | null>>();

function loadThumbnail(sessionId: string, take: number): Promise<string | null> {
  const key = `${sessionId}:${take}`;
  let entry = cache.get(key);
  if (!entry) {
    entry = datacollectionApi
      .fetchThumbnail(sessionId, take)
      .then((blob) => (blob && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(blob) : null))
      .catch(() => {
        cache.delete(key); // a failed fetch may succeed later; a 404 is cached as null
        return null;
      });
    cache.set(key, entry);
  }
  return entry;
}

/** Forget a take's thumbnail (it was discarded or restarted). */
export function forgetThumbnail(sessionId: string, take: number): void {
  cache.delete(`${sessionId}:${take}`);
}

export function TakeThumbnail({ sessionId, take, available = true, className }: TakeThumbnailProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [src, setSrc] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setVisible(true);
        io.disconnect();
      }
    }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !available) return;
    let alive = true;
    void loadThumbnail(sessionId, take).then((url) => { if (alive) setSrc(url); });
    return () => { alive = false; };
  }, [visible, available, sessionId, take]);

  const none = !available || src === null;
  return (
    <div
      ref={ref}
      className={cn('relative shrink-0 overflow-hidden rounded-tag border border-line-subtle bg-inset', className)}
      data-testid={`take-thumbnail-${take}`}
      data-state={src ? 'loaded' : none ? 'none' : 'loading'}
    >
      {src ? (
        <img src={src} alt={`${takeLabel(take)} thumbnail`} loading="lazy" className="h-full w-full object-cover" />
      ) : none ? (
        <div className="flex h-full w-full items-center justify-center text-ink-muted" title="No thumbnail">
          <ImageOff className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
          <span className="sr-only">No thumbnail</span>
        </div>
      ) : null}
    </div>
  );
}
