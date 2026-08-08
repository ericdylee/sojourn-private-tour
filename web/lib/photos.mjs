import fs from 'node:fs'
import path from 'node:path'
import { ASSETS_DIR, REPO_ROOT, safeResolve, within } from './paths.mjs'

/**
 * The photo ledger, and the door through which pictures enter it.
 *
 * `assets/photos/manifest.json` is to images what `01_brief.json` is to facts:
 * nothing reaches a deliverable unless its origin is on record, and the card
 * renderer enforces that — an unregistered file fails the build. So an upload
 * that only copied bytes into the repo would produce a photo the pipeline
 * refuses to use. Registration is therefore part of the upload, not a follow-up
 * step someone remembers to do.
 *
 * Two project rules are checked here rather than left to the renderer, because a
 * message at the moment of upload is worth more than a build failure later:
 *
 *   ADR-010 — `slot: "place"` may not be AI-generated. A place slot is a promise
 *   that the customer will stand somewhere real.
 *   Attribution — anything licensed carries a credit obligation, so `rights` has
 *   to say what the licence is and who the author is before the file is usable.
 */

const PHOTOS_DIR = path.join(ASSETS_DIR, 'photos')
const MANIFEST_PATH = path.join(PHOTOS_DIR, 'manifest.json')

export const SLOTS = ['place', 'concept']

/** 24 MB. A 5328x4000 JPEG off a real camera lands around 11 MB. */
export const MAX_BYTES = 24 * 1024 * 1024

/**
 * Extension is a claim; the leading bytes are evidence.
 *
 * These files get served by the console for preview and copied into the site
 * repo for publication, so a mislabelled file is not a cosmetic problem. A .jpg
 * that is really HTML is a stored-XSS attempt wearing a photo's name.
 */
const SIGNATURES = [
  { ext: '.jpg', alt: ['.jpeg'], mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    ext: '.png',
    alt: [],
    mime: 'image/png',
    test: (b) => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    ext: '.webp',
    alt: [],
    mime: 'image/webp',
    test: (b) => b.slice(0, 4).toString('ascii') === 'RIFF' && b.slice(8, 12).toString('ascii') === 'WEBP',
  },
]

export function sniff(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 16) return null
  return SIGNATURES.find((s) => s.test(buf)) || null
}

/**
 * Pixel dimensions from the file header.
 *
 * Worth knowing at upload time: a 1080x1080 card crops into its source, so a
 * picture that looks fine in a preview can still be too small to use. Reading a
 * header is cheap and needs no image library.
 */
export function dimensions(buf) {
  try {
    if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
    }
    if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') {
      const fmt = buf.slice(12, 16).toString('ascii')
      if (fmt === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff }
      if (fmt === 'VP8L') {
        const n = buf.readUInt32LE(21)
        return { width: (n & 0x3fff) + 1, height: ((n >> 14) & 0x3fff) + 1 }
      }
      if (fmt === 'VP8X') {
        const w = buf[24] | (buf[25] << 8) | (buf[26] << 16)
        const h = buf[27] | (buf[28] << 8) | (buf[29] << 16)
        return { width: w + 1, height: h + 1 }
      }
      return null
    }
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2
      while (i < buf.length - 9) {
        if (buf[i] !== 0xff) {
          i++
          continue
        }
        const marker = buf[i + 1]
        // SOF0..SOF15, skipping the four that are not frame headers.
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) }
        }
        i += 2 + buf.readUInt16BE(i + 2)
      }
    }
  } catch {
    /* a header we cannot parse is not a reason to refuse the upload */
  }
  return null
}

/** Reject anything that is not a plain, boring filename. */
export function cleanFilename(raw) {
  if (typeof raw !== 'string') return null
  const base = path.basename(raw.trim()).toLowerCase()
  if (!base || base.startsWith('.')) return null
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(base)) return null
  if (base.includes('..')) return null
  const ext = path.extname(base)
  const known = SIGNATURES.find((s) => s.ext === ext || s.alt.includes(ext))
  if (!known) return null
  return base
}

export function readManifest() {
  try {
    const raw = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))
    if (!Array.isArray(raw.photos)) raw.photos = []
    return raw
  } catch {
    return { _readme: [], photos: [], wanted: [] }
  }
}

function writeManifest(manifest) {
  // Same-directory temp + rename: a half-written ledger is worse than no upload,
  // and the renderer reads this file on every build.
  const tmp = MANIFEST_PATH + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  fs.renameSync(tmp, MANIFEST_PATH)
}

/** Manifest entries, annotated with what is actually on disk. */
export function listPhotos() {
  const manifest = readManifest()
  return {
    photos: manifest.photos.map((entry) => {
      const abs = safeResolve(PHOTOS_DIR, entry.file || '')
      let bytes = null
      let missing = true
      if (abs && fs.existsSync(abs) && fs.statSync(abs).isFile()) {
        bytes = fs.statSync(abs).size
        missing = false
      }
      return {
        ...entry,
        bytes,
        missing,
        // The artifacts view serves repo files through /api/file?path=…
        previewPath: path.posix.join('assets', 'photos', String(entry.file || '')),
      }
    }),
    wanted: Array.isArray(manifest.wanted) ? manifest.wanted : [],
    slots: SLOTS,
  }
}

export class PhotoError extends Error {
  constructor(message, field) {
    super(message)
    this.field = field || null
  }
}

/**
 * Validate, write the file, register it. Any failure happens before the write,
 * so a rejected upload leaves nothing behind.
 */
export function savePhoto(input = {}) {
  const { slot, subject, rights, note, shotAt } = input
  const aiGenerated = input.aiGenerated === true

  const name = cleanFilename(input.filename)
  if (!name) {
    throw new PhotoError('파일 이름은 영문 소문자·숫자·(. _ -)만 쓸 수 있고 확장자는 jpg·png·webp여야 합니다', 'filename')
  }
  if (!SLOTS.includes(slot)) throw new PhotoError('슬롯은 place 또는 concept이어야 합니다', 'slot')
  if (!subject || !String(subject).trim()) {
    throw new PhotoError('사진이 무엇을 담고 있는지 적어주세요. 원장은 나중에 이 설명으로 사진을 찾습니다', 'subject')
  }
  if (!rights || !String(rights).trim()) {
    throw new PhotoError('출처·권리를 적어주세요 (예: own / licensed:wikimedia/CC BY 4.0 — 저작자)', 'rights')
  }
  // ADR-010. The renderer blocks this too, but a build failure three steps later
  // is a worse way to learn it.
  if (slot === 'place' && aiGenerated) {
    throw new PhotoError('장소 슬롯에는 AI 생성 이미지를 넣을 수 없습니다 (ADR-010). 실사진만 가능합니다', 'aiGenerated')
  }

  let buf
  try {
    const b64 = String(input.dataBase64 || '').replace(/^data:[^;]*;base64,/, '')
    buf = Buffer.from(b64, 'base64')
  } catch {
    throw new PhotoError('파일을 읽지 못했습니다', 'file')
  }
  if (!buf.length) throw new PhotoError('파일이 비어 있습니다', 'file')
  if (buf.length > MAX_BYTES) {
    throw new PhotoError(`파일이 너무 큽니다 (${(buf.length / 1048576).toFixed(1)}MB, 상한 ${MAX_BYTES / 1048576}MB)`, 'file')
  }

  const sig = sniff(buf)
  if (!sig) throw new PhotoError('이미지 파일이 아닙니다 (jpg·png·webp만 가능)', 'file')
  const ext = path.extname(name)
  if (sig.ext !== ext && !sig.alt.includes(ext)) {
    throw new PhotoError(`확장자는 ${ext}인데 내용은 ${sig.mime}입니다. 이름을 실제 형식에 맞추세요`, 'filename')
  }

  const rel = path.posix.join(slot, name)
  const abs = safeResolve(PHOTOS_DIR, rel)
  if (!abs || !within(fs.realpathSync(PHOTOS_DIR), abs)) {
    throw new PhotoError('저장 경로가 assets/photos 밖을 가리킵니다', 'filename')
  }
  if (fs.existsSync(abs)) {
    throw new PhotoError('같은 이름의 사진이 이미 있습니다. 다른 이름을 쓰세요', 'filename')
  }

  const manifest = readManifest()
  if (manifest.photos.some((p) => p.file === rel)) {
    throw new PhotoError('원장에 같은 경로가 이미 등재돼 있습니다', 'filename')
  }

  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, buf)

  const entry = {
    file: rel,
    slot,
    subject: String(subject).trim(),
    ai_generated: aiGenerated,
    rights: String(rights).trim(),
    shot_at: shotAt ? String(shotAt).trim() : null,
    note: note ? String(note).trim() : '콘솔에서 업로드.',
  }
  manifest.photos.push(entry)

  try {
    writeManifest(manifest)
  } catch (err) {
    // Registration failed, so the file must not survive: an unregistered image
    // in the tree is exactly the thing the ledger exists to prevent.
    try {
      fs.unlinkSync(abs)
    } catch {
      /* best effort */
    }
    throw new PhotoError(`원장에 등재하지 못했습니다: ${err.message}`, null)
  }

  const dim = dimensions(buf)
  return {
    entry,
    bytes: buf.length,
    ...(dim || {}),
    // A 1080 card crops into its source; anything under that cannot fill one.
    smallForCards: dim ? Math.min(dim.width, dim.height) < 1080 : false,
    displayPath: path.relative(REPO_ROOT, abs),
    previewPath: path.posix.join('assets', 'photos', rel),
  }
}
