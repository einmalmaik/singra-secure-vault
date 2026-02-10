/**
 * @fileoverview File Attachment Service
 *
 * Upload, download, and manage encrypted file attachments
 * for vault items. Files are encrypted client-side before upload
 * and stored in Supabase Storage.
 *
 * Limits: 100MB per file, 1GB total per user.
 */

import { supabase } from '@/integrations/supabase/client';

// ============ Types ============

export interface FileAttachment {
    id: string;
    vault_item_id: string;
    file_name: string;
    file_size: number;
    mime_type: string | null;
    storage_path: string;
    encrypted: boolean;
    created_at: string;
}

export interface UploadProgress {
    fileName: string;
    progress: number; // 0–100
    status: 'encrypting' | 'uploading' | 'complete' | 'error';
    error?: string;
}

// ============ Constants ============

const MAX_FILE_SIZE = 100 * 1024 * 1024;   // 100 MB per file
const MAX_TOTAL_SIZE = 1024 * 1024 * 1024; // 1 GB total per user
const BUCKET_NAME = 'vault-attachments';

// ============ Helpers ============

/**
 * Format bytes to human-readable string
 */
export function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Get file icon based on MIME type
 */
export function getFileIcon(mimeType: string | null): string {
    if (!mimeType) return '📎';
    if (mimeType.startsWith('image/')) return '🖼️';
    if (mimeType.startsWith('video/')) return '🎬';
    if (mimeType.startsWith('audio/')) return '🎵';
    if (mimeType.includes('pdf')) return '📄';
    if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('tar')) return '📦';
    if (mimeType.includes('text')) return '📝';
    if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return '📊';
    if (mimeType.includes('document') || mimeType.includes('word')) return '📋';
    return '📎';
}

// ============ Service Functions ============

/**
 * Get all attachments for a vault item
 */
export async function getAttachments(vaultItemId: string): Promise<FileAttachment[]> {
    const { data, error } = await supabase
        .from('file_attachments')
        .select('*')
        .eq('vault_item_id', vaultItemId)
        .order('created_at', { ascending: false });

    if (error) throw error;
    return (data || []) as FileAttachment[];
}

/**
 * Get total storage used by user
 */
export async function getStorageUsage(userId: string): Promise<{ used: number; limit: number }> {
    const { data, error } = await supabase
        .from('file_attachments')
        .select('file_size')
        .eq('user_id', userId);

    if (error) throw error;

    const used = (data || []).reduce((sum, f) => sum + Number(f.file_size), 0);
    return { used, limit: MAX_TOTAL_SIZE };
}

/**
 * Upload an encrypted file attachment
 */
export async function uploadAttachment(
    userId: string,
    vaultItemId: string,
    file: File,
    encryptFn: (data: string) => Promise<string>,
): Promise<FileAttachment> {
    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
        throw new Error(`File too large. Maximum: ${formatFileSize(MAX_FILE_SIZE)}`);
    }

    // Check total usage
    const { used } = await getStorageUsage(userId);
    if (used + file.size > MAX_TOTAL_SIZE) {
        throw new Error(`Storage limit reached. Used: ${formatFileSize(used)} / ${formatFileSize(MAX_TOTAL_SIZE)}`);
    }

    // Read file as base64
    const arrayBuffer = await file.arrayBuffer();
    const base64 = btoa(
        new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
    );

    // Encrypt the base64 content
    const encryptedContent = await encryptFn(base64);

    // Generate unique storage path
    const fileId = crypto.randomUUID();
    const storagePath = `${userId}/${vaultItemId}/${fileId}`;

    // Upload encrypted content to Supabase Storage
    const blob = new Blob([encryptedContent], { type: 'application/octet-stream' });
    const { error: uploadError } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(storagePath, blob, {
            contentType: 'application/octet-stream',
            upsert: false,
        });

    if (uploadError) throw uploadError;

    // Save metadata in database
    const { data: attachment, error: dbError } = await supabase
        .from('file_attachments')
        .insert({
            user_id: userId,
            vault_item_id: vaultItemId,
            file_name: file.name,
            file_size: file.size,
            mime_type: file.type || null,
            storage_path: storagePath,
            encrypted: true,
        })
        .select('*')
        .single();

    if (dbError) {
        // Cleanup: remove uploaded file if DB insert fails
        await supabase.storage.from(BUCKET_NAME).remove([storagePath]);
        throw dbError;
    }

    return attachment as FileAttachment;
}

/**
 * Download and decrypt a file attachment
 */
export async function downloadAttachment(
    attachment: FileAttachment,
    decryptFn: (data: string) => Promise<string>,
): Promise<void> {
    // Download from storage
    const { data, error } = await supabase.storage
        .from(BUCKET_NAME)
        .download(attachment.storage_path);

    if (error) throw error;
    if (!data) throw new Error('Download failed');

    // Read encrypted content
    const encryptedContent = await data.text();

    // Decrypt
    const base64 = await decryptFn(encryptedContent);

    // Convert base64 back to bytes
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }

    // Trigger browser download
    const blob = new Blob([bytes], { type: attachment.mime_type || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = attachment.file_name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * Delete a file attachment
 */
export async function deleteAttachment(attachment: FileAttachment): Promise<void> {
    // Delete from storage
    const { error: storageError } = await supabase.storage
        .from(BUCKET_NAME)
        .remove([attachment.storage_path]);

    if (storageError) {
        console.error('Storage delete error (continuing with DB delete):', storageError);
    }

    // Delete from database
    const { error: dbError } = await supabase
        .from('file_attachments')
        .delete()
        .eq('id', attachment.id);

    if (dbError) throw dbError;
}
