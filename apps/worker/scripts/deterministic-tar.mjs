// A reproducible tar.gz (D-026): the same files give the same bytes, so the same sha256, on every deploy. Entries
// sorted by path, every date 0, owner 0:0 without names, modes 0755 (folders and executables) or 0644, gzip without a
// name or date. Plain ustar headers, with a PAX record for a path that does not fit (cargo's vendor folder has long
// ones). `tar` and `tar.exe` (bsdtar) read it. Only regular files and folders: a link fails loudly.
import { createWriteStream, lstatSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { constants, createGzip } from 'node:zlib'

const BLOCK = 512

function octal(value, width) {
  return `${value.toString(8).padStart(width - 1, '0')}\0`
}

function header(name, prefix, { size, mode, type }) {
  const block = Buffer.alloc(BLOCK)
  block.write(name, 0, 100, 'utf8')
  block.write(octal(mode, 8), 100, 8, 'latin1')
  block.write(octal(0, 8), 108, 8, 'latin1')
  block.write(octal(0, 8), 116, 8, 'latin1')
  block.write(octal(size, 12), 124, 12, 'latin1')
  block.write(octal(0, 12), 136, 12, 'latin1')
  block.write('        ', 148, 8, 'latin1')
  block.write(type, 156, 1, 'latin1')
  block.write('ustar\u000000', 257, 8, 'latin1')
  block.write(prefix, 345, 155, 'utf8')
  let sum = 0
  for (const byte of block) sum += byte
  block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'latin1')
  return block
}

const padding = (size) => Buffer.alloc((BLOCK - (size % BLOCK)) % BLOCK)

/** ustar's name/prefix split, or null when the path needs a PAX record. */
function split(path) {
  if (Buffer.byteLength(path) <= 100) return { name: path, prefix: '' }
  for (let i = path.indexOf('/'); i !== -1; i = path.indexOf('/', i + 1)) {
    const prefix = path.slice(0, i)
    const name = path.slice(i + 1)
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100 && name) return { name, prefix }
  }
  return null
}

function* entry(path, body, { mode, type }) {
  const size = body ? body.length : 0
  const fits = split(path)
  if (fits) {
    yield header(fits.name, fits.prefix, { size, mode, type })
  } else {
    // PAX: "<length> path=<path>\n", where the length counts itself.
    const text = ` path=${path}\n`
    const base = Buffer.byteLength(text)
    let length = base + String(base).length
    if (String(length).length !== String(base).length) length = base + String(length).length
    const record = Buffer.from(`${length}${text}`, 'utf8')
    yield header('PaxHeader', '', { size: record.length, mode: 0o644, type: 'x' })
    yield record
    yield padding(record.length)
    yield header(path.slice(-100), '', { size, mode, type })
  }
  if (body) {
    yield body
    yield padding(size)
  }
}

/** Every entry under `dir` (named `root/…` in the archive), sorted, as tar blocks. */
function* blocks(dir, root, executables) {
  const walk = function* (folder, inside) {
    yield* entry(`${inside}/`, null, { mode: 0o755, type: '5' })
    const names = readdirSync(folder).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    for (const name of names) {
      const path = join(folder, name)
      const info = lstatSync(path)
      const archived = `${inside}/${name}`
      if (info.isDirectory()) yield* walk(path, archived)
      else if (info.isFile()) {
        const executable = executables.has(name) || (process.platform !== 'win32' && (info.mode & 0o111) !== 0)
        yield* entry(archived, readFileSync(path), { mode: executable ? 0o755 : 0o644, type: '0' })
      } else throw new Error(`${archived}: solo archivos y carpetas en el paquete`)
    }
  }
  yield* walk(dir, root)
  yield Buffer.alloc(BLOCK * 2)
}

/**
 * Writes `dir` as `root/…` to `file` (tar.gz, reproducible). `executables`: file names that get 0755 even where the
 * file system has no execute bit (Windows).
 */
export async function writeTarGz(dir, root, file, executables = []) {
  const gzip = createGzip({ level: constants.Z_BEST_COMPRESSION })
  await pipeline(Readable.from(blocks(dir, root, new Set(executables))), gzip, createWriteStream(file))
}
