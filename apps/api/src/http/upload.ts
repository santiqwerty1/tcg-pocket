/**
 * Multipart uploads go through `FileInterceptor` (multer, memory storage). `@types/multer` is not installed, so the
 * file shape the handlers rely on is declared here.
 */
export interface UploadedFileShape {
  fieldname: string
  originalname: string
  mimetype: string
  size: number
  buffer: Buffer
}

export const CSV_UPLOAD_LIMIT_BYTES = 5 * 1024 * 1024
export const BACKUP_UPLOAD_LIMIT_BYTES = 50 * 1024 * 1024

export function uploadOptions(maxBytes: number) {
  return { limits: { fileSize: maxBytes, files: 1 } }
}
