// API alias for existing callers; both names use the same S3 implementation.

export type { S3StorageConfig as MinioStorageConfig } from './s3'
export { S3Storage as MinioStorage } from './s3'
