/**
 * @file videoCodec.ts
 * @description Which codec a dataset's camera video uses, and whether this
 *   browser can play it.
 * @feature training
 */

/**
 * Episode videos are served exactly as the dataset stores them — nothing is
 * transcoded. The Hugging Face datasets this platform imports are mostly AV1,
 * which not every browser decodes (Safari only on hardware with an AV1
 * decoder), and a `<video>` that cannot decode its source says nothing: it is
 * a blank box. The codec is written in the dataset's `meta/info.json`, so the
 * player can ask the browser before it tries (TASK-478).
 */

export interface VideoCodecInfo {
  /** What to call it in a sentence: "AV1", "H.264". */
  label: string;
  /** A representative type string to ask the browser about, when one is known. */
  mime?: string;
  /** Where it does play, as a sentence fragment after "Open this page in ". */
  browsers: string;
}

const CURRENT_BROWSERS = 'a current Chrome, Edge or Firefox';

const KNOWN: { match: RegExp; info: VideoCodecInfo }[] = [
  {
    match: /^(av1|av01|libsvtav1|libaom-av1|librav1e)$/,
    // Main profile, level 3.1, 8 bit — the string every AV1-capable browser accepts.
    info: { label: 'AV1', mime: 'video/mp4; codecs="av01.0.05M.08"', browsers: 'a current Chrome or Firefox' },
  },
  {
    match: /^(h264|avc|avc1|libx264|libopenh264)$/,
    info: { label: 'H.264', mime: 'video/mp4; codecs="avc1.42E01E"', browsers: CURRENT_BROWSERS },
  },
  {
    match: /^(hevc|h265|hvc1|hev1|libx265)$/,
    info: {
      label: 'H.265 (HEVC)',
      mime: 'video/mp4; codecs="hvc1.1.6.L93.B0"',
      browsers: 'Safari, or a current Chrome or Edge on a device with hardware HEVC decoding',
    },
  },
  {
    match: /^(vp9|vp09|libvpx-vp9)$/,
    info: { label: 'VP9', mime: 'video/mp4; codecs="vp09.00.10.08"', browsers: CURRENT_BROWSERS },
  },
];

/**
 * The codec a camera feature of `meta/info.json` declares, or undefined.
 * LeRobot writes it as `info["video.codec"]`; v2.0 called the block `video_info`.
 */
export function featureVideoCodec(feature: unknown): string | undefined {
  if (!feature || typeof feature !== 'object') return undefined;
  const f = feature as { info?: unknown; video_info?: unknown };
  for (const block of [f.info, f.video_info]) {
    const codec = (block as Record<string, unknown> | null | undefined)?.['video.codec'];
    if (typeof codec === 'string' && codec.trim()) return codec.trim();
  }
  return undefined;
}

/** Name a codec for a sentence; an unrecognised one is named as written. */
export function describeVideoCodec(codec: string): VideoCodecInfo {
  const key = codec.trim().toLowerCase();
  const known = KNOWN.find((k) => k.match.test(key));
  return known ? known.info : { label: codec.trim(), browsers: CURRENT_BROWSERS };
}

/** Asks the browser whether it plays a type string. Swappable for tests. */
export type CodecProbe = (mime: string) => boolean;

const browserProbe: CodecProbe = (mime) => {
  const video = document.createElement('video');
  if (typeof video.canPlayType === 'function' && video.canPlayType(mime) !== '') return true;
  const mediaSource = (globalThis as { MediaSource?: { isTypeSupported?: (type: string) => boolean } })
    .MediaSource;
  return typeof mediaSource?.isTypeSupported === 'function' && mediaSource.isTypeSupported(mime);
};

/**
 * Can this browser play a codec? `null` when there is no telling — the codec
 * is not declared, or not one we have a type string for — and the player then
 * simply tries. `false` only on the browser's own word.
 */
export function canPlayVideoCodec(
  codec: string | undefined,
  probe: CodecProbe = browserProbe
): boolean | null {
  if (!codec) return null;
  const { mime } = describeVideoCodec(codec);
  if (!mime) return null;
  try {
    return probe(mime);
  } catch {
    return null;
  }
}
