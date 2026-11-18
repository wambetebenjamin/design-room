// Import an image from a link (direct URL, GitHub, or Google Drive).
// The download happens in the user's browser; hosts that block cross-origin
// reads (CORS) get a clear, actionable error instead of a silent failure.

const ALLOWED_MAGIC: { mime: string; test: (b: Uint8Array) => boolean }[] = [
  { mime: 'image/png', test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: 'image/webp',
    test: (b) =>
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  },
];

/**
 * Normalise a pasted link to a directly fetchable image URL.
 * - GitHub blob/raw links → raw.githubusercontent.com
 * - Google Drive share links → the file's download endpoint
 * - anything else http(s) passes through unchanged.
 */
export function normalizeImageUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('Paste an image link first.');
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error('Paste a full link starting with https://');
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('That is not a valid link.');
  }

  // Google Drive share links: /file/d/ID/... or ?id=ID
  if (url.hostname === 'drive.google.com' || url.hostname === 'docs.google.com') {
    const idMatch = /\/file\/d\/([^/]+)/.exec(url.pathname) ?? /[?&]id=([^&]+)/.exec(url.search);
    const id = idMatch?.[1];
    if (id) return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`;
    throw new Error('That Google Drive link does not contain a file ID. Use Share → Copy link.');
  }

  // GitHub blob/raw links: github.com/owner/repo/blob/ref/path…
  if (url.hostname === 'github.com' || url.hostname === 'www.github.com') {
    const m = /^\/([^/]+)\/([^/]+)\/(?:blob|raw)\/([^/]+)\/(.+)$/.exec(url.pathname);
    if (m) {
      const [, owner, repo, ref, ...rest] = m;
      return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${rest.join('/')}`;
    }
    throw new Error('That GitHub link is not an image file. Open the image and copy its raw URL.');
  }

  return url.href;
}

/** Suggest a filename from the URL path (falls back by content type). */
export function fileNameFromUrl(url: string, mime: string): string {
  try {
    const path = new URL(url).pathname;
    const last = decodeURIComponent(path.split('/').filter(Boolean).pop() ?? '');
    if (last && /\.[a-z0-9]{2,5}$/i.test(last)) return last.slice(0, 80);
  } catch {
    /* fall through */
  }
  const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png';
  return `linked-image.${ext}`;
}

/** Download an image link as a File, ready for the normal upload pipeline. */
export async function fetchImageAsFile(raw: string): Promise<File> {
  const url = normalizeImageUrl(raw);
  let res: Response;
  try {
    res = await fetch(url, { mode: 'cors', redirect: 'follow' });
  } catch {
    throw new Error(
      'That site blocked the download (cross-origin policy). Save the image and drop it here instead, or use a direct image link (for example a GitHub raw URL).',
    );
  }
  if (!res.ok) {
    throw new Error(`Could not download that image (server responded ${res.status}).`);
  }
  const blob = await res.blob();
  if (blob.size === 0) throw new Error('That link returned an empty file.');

  // Some hosts send generic content types — sniff the actual format.
  let mime = blob.type;
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(mime)) {
    const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
    const hit = ALLOWED_MAGIC.find((m) => m.test(head));
    if (!hit) {
      throw new Error('That link is not a PNG, JPEG or WebP image.');
    }
    mime = hit.mime;
  }
  if (blob.size > 15 * 1024 * 1024) {
    throw new Error('That image is larger than 15 MB — try a smaller file.');
  }
  return new File([blob], fileNameFromUrl(url, mime), { type: mime });
}
