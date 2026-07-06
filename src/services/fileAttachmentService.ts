// Copyright (c) 2025-2026 Maunting Studios
// Licensed under the Business Source License 1.1 - see LICENSE
/**
 * @fileoverview End-to-end encrypted file attachments.
 *
 * Uploads are encrypted in the client before any network request. Every file
 * gets a random AES-256-GCM file key, every chunk gets its own random nonce,
 * and the encrypted manifest is bound to the owning user/item/file by AAD.
 *
 * The server stores only opaque object paths, ciphertext chunks, an encrypted
 * manifest, and technical ciphertext sizes. Original names, extensions, MIME
 * types, file sizes, notes, previews, EXIF/PDF/text metadata, and checksums
 * live only inside the encrypted manifest.
 */

import { supabase } from '@/integrations/supabase/client';
import { isTauriRuntime } from '@/platform/runtime';
// Powered by DIS — Defensive Integration Shield. Every cryptographic primitive
// used for attachments — AES-256-GCM chunk AEAD, the raw AES-GCM file-key
// import, SHA-256 manifest/chunk integrity hashes, and the secure random file
// key and file id — comes from the audited `@msdis/shield` package. This service
// owns only the Singra file-manifest format and the upload/download flow; it
// contains no crypto of its own. Do NOT call WebCrypto here — add primitives to
// @msdis/shield and consume them through these imports.
import {
    decryptChunk,
    encryptChunk,
    generateFileKeyBytes,
    importFileKey,
} from '@msdis/shield/file-encryption';
import { randomUuid } from '@msdis/shield/random';
import { sha256JsonBase64, sha256StringBase64 } from '@msdis/shield/integrity';

// ============ Types ============

export interface FileAttachment {
    id: string;
    vault_item_id: string;
    file_name: string;
    file_size: number;
    mime_type: string | null;
    storage_path: string;
    encrypted: boolean;
    encrypted_metadata?: string | null;
    created_at: string;
}

export interface UploadProgress {
    fileName: string;
    progress: number;
    status: 'encrypting' | 'uploading' | 'complete' | 'error';
    error?: string;
}

interface LegacyFileMetadata {
    file_name: string;
    mime_type: string | null;
}

interface FileChunkManifest {
    index: number;
    storage_path: string;
    plaintext_size: number;
    ciphertext_size: number;
    ciphertext_sha256: string;
}

interface FileManifestV1 {
    version: 1;
    algorithm: 'AES-256-GCM';
    file_id: string;
    file_revision: number;
    previous_manifest_hash: string | null;
    manifest_root: string;
    owner_id: string;
    vault_item_id: string;
    original_name: string;
    mime_type: string | null;
    original_size: number;
    last_modified: number | null;
    uploaded_at: string;
    chunk_size: number;
    chunk_count: number;
    wrapped_file_key: string;
    chunks: FileChunkManifest[];
    preview: null;
    notes: null;
}

type VaultEncryptText = (plaintext: string, aad?: string) => Promise<string>;
type VaultDecryptText = (encrypted: string, aad?: string) => Promise<string>;
type VaultEncryptBytes = (plaintext: Uint8Array, aad?: string) => Promise<string>;
type VaultDecryptBytes = (encrypted: string, aad?: string) => Promise<Uint8Array>;

// ============ Constants ============

const MAX_FILE_SIZE = 1024 * 1024 * 1024; // 1 GB per file
const MAX_TOTAL_SIZE = 1024 * 1024 * 1024; // product-facing 1 GB file upload limit
const CHUNK_SIZE = 4 * 1024 * 1024;
const BUCKET_NAME = 'vault-attachments';
const MANIFEST_PREFIX = 'sv-file-manifest-v1:';
const LOCAL_MANIFEST_CHECKPOINT_PREFIX = 'singra:file-manifest-checkpoint:v1:';
const FALLBACK_DOWNLOAD_FILE_NAME = 'singra-vault-attachment';
const MAX_DOWNLOAD_FILE_NAME_LENGTH = 180;
const WINDOWS_RESERVED_FILE_BASENAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

function removeControlCharacters(value: string): string {
    return [...value].filter((char) => {
        const codePoint = char.codePointAt(0) ?? 0;
        return codePoint > 0x1f && codePoint !== 0x7f;
    }).join('');
}

interface LocalManifestCheckpoint {
    revision: number;
    manifestHash: string;
    previousManifestHash: string | null;
}

interface PlaintextFileWriter {
    write(chunk: Uint8Array): Promise<void>;
    close(): Promise<void>;
    abort(): Promise<void>;
}

// ============ Helpers ============

export function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function getFileIcon(_mimeType: string | null): string {
    return 'File';
}

function manifestAad(userId: string, vaultItemId: string, fileId: string): string {
    return `sv-file-manifest-v1:${userId}:${vaultItemId}:${fileId}`;
}

function chunkAad(
    userId: string,
    vaultItemId: string,
    fileId: string,
    fileRevision: number,
    manifestRoot: string,
    chunkIndex: number,
    chunkCount: number,
): string {
    return `sv-file-chunk-v1:${userId}:${vaultItemId}:${fileId}:${fileRevision}:${manifestRoot}:${chunkIndex}:${chunkCount}`;
}

function fileKeyAad(userId: string, vaultItemId: string, fileId: string): string {
    return `sv-file-key-v1:${userId}:${vaultItemId}:${fileId}`;
}

function checkpointKey(ownerId: string, vaultItemId: string, fileId: string): string {
    return `${LOCAL_MANIFEST_CHECKPOINT_PREFIX}${ownerId}:${vaultItemId}:${fileId}`;
}

function isManifestEnvelope(value: string | null | undefined): value is string {
    return typeof value === 'string' && value.startsWith(MANIFEST_PREFIX);
}

async function decryptManifest(
    row: FileAttachment,
    decryptText: VaultDecryptText,
): Promise<FileManifestV1 | null> {
    if (!isManifestEnvelope(row.encrypted_metadata)) {
        return null;
    }

    const encrypted = row.encrypted_metadata.slice(MANIFEST_PREFIX.length);
    const json = await decryptText(encrypted, manifestAad(row.storage_path.split('/')[0] ?? '', row.vault_item_id, row.id));
    return JSON.parse(json) as FileManifestV1;
}

function loadLocalManifestCheckpoint(manifest: FileManifestV1): LocalManifestCheckpoint | null {
    if (typeof window === 'undefined') return null;

    const raw = window.localStorage.getItem(checkpointKey(manifest.owner_id, manifest.vault_item_id, manifest.file_id));
    if (!raw) return null;

    try {
        const parsed = JSON.parse(raw) as Partial<LocalManifestCheckpoint>;
        if (typeof parsed.revision !== 'number' || typeof parsed.manifestHash !== 'string') {
            return null;
        }
        return {
            revision: parsed.revision,
            manifestHash: parsed.manifestHash,
            previousManifestHash: typeof parsed.previousManifestHash === 'string' ? parsed.previousManifestHash : null,
        };
    } catch {
        return null;
    }
}

function saveLocalManifestCheckpoint(manifest: FileManifestV1, manifestHash: string): void {
    if (typeof window === 'undefined') return;

    window.localStorage.setItem(checkpointKey(manifest.owner_id, manifest.vault_item_id, manifest.file_id), JSON.stringify({
        revision: manifest.file_revision,
        manifestHash,
        previousManifestHash: manifest.previous_manifest_hash,
    } satisfies LocalManifestCheckpoint));
}

export function sanitizeDownloadFileName(fileName: string): string {
    const normalized = removeControlCharacters(fileName.normalize('NFKC'))
        .replace(/[<>:"/\\|?*\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, '-')
        .replace(/\s+/g, ' ')
        .trim();

    const withoutTrailingDots = normalized.replace(/[. ]+$/g, '');
    const safeName = withoutTrailingDots && withoutTrailingDots !== '.' && withoutTrailingDots !== '..'
        ? withoutTrailingDots
        : FALLBACK_DOWNLOAD_FILE_NAME;

    const nonReservedName = WINDOWS_RESERVED_FILE_BASENAME.test(safeName)
        ? `_${safeName}`
        : safeName;

    return nonReservedName.slice(0, MAX_DOWNLOAD_FILE_NAME_LENGTH);
}

async function hashManifestForCheckpoint(manifest: FileManifestV1): Promise<string> {
    return sha256JsonBase64({
        version: manifest.version,
        file_id: manifest.file_id,
        file_revision: manifest.file_revision,
        previous_manifest_hash: manifest.previous_manifest_hash,
        manifest_root: manifest.manifest_root,
        owner_id: manifest.owner_id,
        vault_item_id: manifest.vault_item_id,
        original_size: manifest.original_size,
        chunk_size: manifest.chunk_size,
        chunk_count: manifest.chunk_count,
        chunks: manifest.chunks,
    });
}

async function verifyManifestFreshness(manifest: FileManifestV1): Promise<string> {
    const manifestHash = await hashManifestForCheckpoint(manifest);
    const checkpoint = loadLocalManifestCheckpoint(manifest);
    if (!checkpoint) {
        return manifestHash;
    }

    if (manifest.file_revision < checkpoint.revision) {
        throw new Error('File manifest rollback detected: older revision than local checkpoint.');
    }

    if (manifest.file_revision === checkpoint.revision && manifestHash !== checkpoint.manifestHash) {
        throw new Error('File manifest conflict detected for the current revision.');
    }

    if (
        manifest.file_revision > checkpoint.revision
        && manifest.previous_manifest_hash
        && manifest.previous_manifest_hash !== checkpoint.manifestHash
    ) {
        throw new Error('File manifest history chain does not match the local checkpoint.');
    }

    return manifestHash;
}

async function decryptFileMetadataRow(
    row: FileAttachment,
    decryptText?: VaultDecryptText,
): Promise<FileAttachment> {
    if (!row.encrypted_metadata || !decryptText) {
        return row;
    }

    try {
        if (isManifestEnvelope(row.encrypted_metadata)) {
            const manifest = await decryptManifest(row, decryptText);
            if (!manifest) return row;
            return {
                ...row,
                file_name: manifest.original_name,
                file_size: manifest.original_size,
                mime_type: manifest.mime_type,
            };
        }

        const json = await decryptText(row.encrypted_metadata);
        const meta: LegacyFileMetadata = JSON.parse(json);
        return {
            ...row,
            file_name: meta.file_name,
            mime_type: meta.mime_type,
        };
    } catch {
        throw new Error('File metadata could not be decrypted.');
    }
}

async function removeUploadedChunks(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    await supabase.storage.from(BUCKET_NAME).remove(paths);
}

async function openPlaintextFileWriter(fileName: string, mimeType: string | null): Promise<PlaintextFileWriter | null> {
    const safeFileName = sanitizeDownloadFileName(fileName);
    if (isTauriRuntime()) {
        return openTauriPlaintextFileWriter(safeFileName, mimeType);
    }

    if ('showSaveFilePicker' in window) {
        return openBrowserStreamWriter(safeFileName, mimeType);
    }

    return null;
}

async function openBrowserStreamWriter(fileName: string, mimeType: string | null): Promise<PlaintextFileWriter | null> {
    if (!window.showSaveFilePicker) return null;

    const handle = await window.showSaveFilePicker({
        suggestedName: fileName,
        types: buildFilePickerTypes(fileName, mimeType),
    });
    const writable = await handle.createWritable();
    return {
        write: (chunk) => writable.write(chunk),
        close: () => writable.close(),
        abort: () => writable.abort(),
    };
}

async function openTauriPlaintextFileWriter(fileName: string, mimeType: string | null): Promise<PlaintextFileWriter | null> {
    const [{ save }, { open, remove, rename }, { downloadDir, join }] = await Promise.all([
        import('@tauri-apps/plugin-dialog'),
        import('@tauri-apps/plugin-fs'),
        import('@tauri-apps/api/path'),
    ]);

    const defaultPath = await join(await downloadDir(), fileName);
    const targetPath = await save({
        defaultPath,
        filters: buildDialogFilters(fileName, mimeType),
    });
    if (!targetPath) return null;

    const partialPath = `${targetPath}.singra-partial`;
    const handle = await open(partialPath, { write: true, create: true, truncate: true });
    let closed = false;

    return {
        write: async (chunk) => {
            await handle.write(chunk);
        },
        close: async () => {
            if (!closed) {
                closed = true;
                await handle.close();
            }
            await rename(partialPath, targetPath);
        },
        abort: async () => {
            if (!closed) {
                closed = true;
                await handle.close();
            }
            await remove(partialPath).catch(() => undefined);
        },
    };
}

function buildFilePickerTypes(fileName: string, mimeType: string | null): FilePickerAcceptType[] | undefined {
    const extension = getFileExtension(fileName);
    if (!extension || !mimeType) return undefined;

    return [{
        description: mimeType,
        accept: { [mimeType]: [`.${extension}`] },
    }];
}

function buildDialogFilters(fileName: string, mimeType: string | null): Array<{ name: string; extensions: string[] }> | undefined {
    const extension = getFileExtension(fileName);
    if (!extension) return undefined;

    return [{
        name: mimeType || 'Datei',
        extensions: [extension],
    }];
}

function getFileExtension(fileName: string): string | null {
    const lastDot = fileName.lastIndexOf('.');
    if (lastDot <= 0 || lastDot === fileName.length - 1) return null;
    return fileName.slice(lastDot + 1).toLowerCase();
}

// ============ Service Functions ============

export async function getAttachments(
    vaultItemId: string,
    decryptText?: VaultDecryptText,
): Promise<FileAttachment[]> {
    const { data, error } = await supabase
        .from('file_attachments')
        .select('*')
        .eq('vault_item_id', vaultItemId)
        .order('created_at', { ascending: false });

    if (error) throw error;
    const rows = (data || []) as FileAttachment[];

    if (decryptText) {
        return Promise.all(rows.map(row => decryptFileMetadataRow(row, decryptText)));
    }
    return rows;
}

export async function getStorageUsage(userId: string): Promise<{ used: number; limit: number }> {
    const { data, error } = await supabase
        .from('file_attachments')
        .select('file_size')
        .eq('user_id', userId);

    if (error) throw error;

    const used = (data || []).reduce((sum, f) => sum + Number(f.file_size), 0);
    return { used, limit: MAX_TOTAL_SIZE };
}

export async function uploadAttachment(
    userId: string,
    vaultItemId: string,
    file: File,
    encryptText: VaultEncryptText,
    encryptBinary?: VaultEncryptBytes,
): Promise<FileAttachment> {
    if (file.size > MAX_FILE_SIZE) {
        throw new Error(`FILE_TOO_LARGE:${formatFileSize(MAX_FILE_SIZE)}`);
    }

    if (!encryptBinary) {
        throw new Error('Binary vault encryption is required for secure file uploads.');
    }

    const fileId = randomUuid();
    const chunkCount = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
    const fileKeyBytes = generateFileKeyBytes();
    const fileKey = await importFileKey(fileKeyBytes);
    const uploadedPaths: string[] = [];
    const chunks: FileChunkManifest[] = [];
    let totalCiphertextSize = 0;
    const fileRevision = 1;
    const plannedChunks = Array.from({ length: chunkCount }, (_, index) => {
        const start = index * CHUNK_SIZE;
        const end = Math.min(file.size, start + CHUNK_SIZE);
        return {
            index,
            storage_path: `${userId}/${vaultItemId}/${fileId}/${index}`,
            plaintext_size: end - start,
        };
    });
    const manifestRoot = await sha256JsonBase64({
        file_id: fileId,
        file_revision: fileRevision,
        chunk_size: CHUNK_SIZE,
        chunk_count: chunkCount,
        chunks: plannedChunks,
    });

    try {
        const wrappedFileKey = await encryptBinary(fileKeyBytes, fileKeyAad(userId, vaultItemId, fileId));

        for (let index = 0; index < chunkCount; index += 1) {
            const start = index * CHUNK_SIZE;
            const end = Math.min(file.size, start + CHUNK_SIZE);
            const plannedChunk = plannedChunks[index];
            const chunkBlob = file.slice(start, end);
            let arrayBuffer: ArrayBuffer;
            if (typeof chunkBlob.arrayBuffer === 'function') {
                arrayBuffer = await chunkBlob.arrayBuffer();
            } else {
                arrayBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result as ArrayBuffer);
                    reader.onerror = () => reject(reader.error);
                    reader.readAsArrayBuffer(chunkBlob);
                });
            }
            const plaintext = new Uint8Array(arrayBuffer);
            const encryptedChunk = await encryptChunk(
                plaintext,
                fileKey,
                chunkAad(userId, vaultItemId, fileId, fileRevision, manifestRoot, index, chunkCount),
            );
            plaintext.fill(0);

            const storagePath = plannedChunk.storage_path;
            const blob = new Blob([encryptedChunk], { type: 'application/octet-stream' });
            const { error: uploadError } = await supabase.storage
                .from(BUCKET_NAME)
                .upload(storagePath, blob, {
                    contentType: 'application/octet-stream',
                    cacheControl: 'no-store',
                    upsert: false,
                });

            if (uploadError) throw uploadError;

            uploadedPaths.push(storagePath);
            totalCiphertextSize += blob.size;
            chunks.push({
                index,
                storage_path: storagePath,
                plaintext_size: plannedChunk.plaintext_size,
                ciphertext_size: blob.size,
                ciphertext_sha256: await sha256StringBase64(encryptedChunk),
            });
        }

        const manifest: FileManifestV1 = {
            version: 1,
            algorithm: 'AES-256-GCM',
            file_id: fileId,
            file_revision: fileRevision,
            previous_manifest_hash: null,
            manifest_root: manifestRoot,
            owner_id: userId,
            vault_item_id: vaultItemId,
            original_name: file.name,
            mime_type: file.type || null,
            original_size: file.size,
            last_modified: Number.isFinite(file.lastModified) ? file.lastModified : null,
            uploaded_at: new Date().toISOString(),
            chunk_size: CHUNK_SIZE,
            chunk_count: chunkCount,
            wrapped_file_key: wrappedFileKey,
            chunks,
            preview: null,
            notes: null,
        };

        const encryptedManifest = `${MANIFEST_PREFIX}${await encryptText(
            JSON.stringify(manifest),
            manifestAad(userId, vaultItemId, fileId),
        )}`;

        const { data: attachment, error: dbError } = await supabase
            .from('file_attachments')
            .insert({
                id: fileId,
                user_id: userId,
                vault_item_id: vaultItemId,
                file_name: 'encrypted',
                file_size: totalCiphertextSize,
                mime_type: 'application/octet-stream',
                storage_path: `${userId}/${vaultItemId}/${fileId}`,
                encrypted: true,
                encrypted_metadata: encryptedManifest,
            })
            .select('*')
            .single();

        if (dbError) {
            await removeUploadedChunks(uploadedPaths);
            throw dbError;
        }

        return {
            ...(attachment as FileAttachment),
            file_name: file.name,
            file_size: file.size,
            mime_type: file.type || null,
        };
    } catch (error) {
        await removeUploadedChunks(uploadedPaths);
        throw error;
    } finally {
        fileKeyBytes.fill(0);
    }
}

export async function downloadAttachment(
    attachment: FileAttachment,
    decryptText: VaultDecryptText,
    decryptBinary?: VaultDecryptBytes,
): Promise<void> {
    if (isManifestEnvelope(attachment.encrypted_metadata)) {
        if (!decryptBinary) {
            throw new Error('Binary vault decryption is required for secure file downloads.');
        }

        const manifest = await decryptManifest(attachment, decryptText);
        if (!manifest) {
            throw new Error('File manifest could not be decrypted.');
        }
        const manifestHash = await verifyManifestFreshness(manifest);

        const fileKeyBytes = await decryptBinary(
            manifest.wrapped_file_key,
            fileKeyAad(manifest.owner_id, manifest.vault_item_id, manifest.file_id),
        );
        const fileKey = await importFileKey(fileKeyBytes);
        fileKeyBytes.fill(0);

        const orderedChunks = [...manifest.chunks].sort((a, b) => a.index - b.index);
        const writer = await openPlaintextFileWriter(manifest.original_name, manifest.mime_type);

        try {
            if (writer) {
                for (const chunk of orderedChunks) {
                    const plaintext = await downloadAndDecryptChunk(manifest, fileKey, chunk);
                    try {
                        await writer.write(plaintext);
                    } finally {
                        plaintext.fill(0);
                    }
                }
                await writer.close();
            } else {
                await downloadAttachmentWithBlobFallback(manifest, fileKey, orderedChunks);
            }
        } catch (error) {
            await writer?.abort().catch(() => undefined);
            throw error;
        }

        saveLocalManifestCheckpoint(manifest, manifestHash);
        return;
    }

    const { data, error } = await supabase.storage
        .from(BUCKET_NAME)
        .download(attachment.storage_path);

    if (error) throw error;
    if (!data) throw new Error('Download failed');

    const encryptedContent = await data.text();
    const base64 = await decryptText(encryptedContent);
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i += 1) {
        bytes[i] = binaryString.charCodeAt(i);
    }

    const resolved = await decryptFileMetadataRow(attachment, decryptText);
    const blob = new Blob([bytes], { type: resolved.mime_type || 'application/octet-stream' });
    triggerBrowserDownload(blob, resolved.file_name);
    bytes.fill(0);
}

function triggerBrowserDownload(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = sanitizeDownloadFileName(fileName);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

async function downloadAttachmentWithBlobFallback(
    manifest: FileManifestV1,
    fileKey: CryptoKey,
    orderedChunks: FileChunkManifest[],
): Promise<void> {
    const plaintextParts: Uint8Array[] = [];
    try {
        for (const chunk of orderedChunks) {
            plaintextParts.push(await downloadAndDecryptChunk(manifest, fileKey, chunk));
        }
        const blob = new Blob(plaintextParts, { type: manifest.mime_type || 'application/octet-stream' });
        triggerBrowserDownload(blob, manifest.original_name);
    } finally {
        plaintextParts.forEach(part => part.fill(0));
    }
}

async function downloadAndDecryptChunk(
    manifest: FileManifestV1,
    fileKey: CryptoKey,
    chunk: FileChunkManifest,
): Promise<Uint8Array> {
    const { data, error } = await supabase.storage
        .from(BUCKET_NAME)
        .download(chunk.storage_path);

    if (error) throw error;
    if (!data) throw new Error('Download failed');

    const encryptedChunk = await data.text();
    const digest = await sha256StringBase64(encryptedChunk);
    if (digest !== chunk.ciphertext_sha256) {
        throw new Error('Encrypted file chunk failed integrity verification.');
    }

    return decryptChunk(
        encryptedChunk,
        fileKey,
        chunkAad(
            manifest.owner_id,
            manifest.vault_item_id,
            manifest.file_id,
            manifest.file_revision,
            manifest.manifest_root,
            chunk.index,
            manifest.chunk_count,
        ),
    );
}

export async function deleteAttachment(
    attachment: FileAttachment,
    decryptText?: VaultDecryptText,
): Promise<void> {
    const paths = isManifestEnvelope(attachment.encrypted_metadata) && decryptText
        ? await getEncryptedChunkPaths(attachment, decryptText)
        : [attachment.storage_path];

    const { error: storageError } = await supabase.storage
        .from(BUCKET_NAME)
        .remove(paths);

    if (storageError) {
        console.error('Storage delete error (continuing with DB delete):', storageError);
    }

    const { error: dbError } = await supabase
        .from('file_attachments')
        .delete()
        .eq('id', attachment.id);

    if (dbError) throw dbError;
}

async function getEncryptedChunkPaths(
    attachment: FileAttachment,
    decryptText: VaultDecryptText,
): Promise<string[]> {
    if (!isManifestEnvelope(attachment.encrypted_metadata)) {
        return [attachment.storage_path];
    }

    const manifest = await decryptManifest(attachment, decryptText);
    return manifest?.chunks.map(chunk => chunk.storage_path) ?? [attachment.storage_path];
}
