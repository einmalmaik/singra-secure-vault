// Copyright (c) 2025-2026 Maunting Studios
// Licensed under the Business Source License 1.1 — see LICENSE
/**
 * @fileoverview File Attachments Component
 *
 * Drag & drop file upload with encrypted storage.
 * Shows list of attached files with download/delete actions.
 * Premium feature — wrapped in FeatureGate by parent.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Upload,
    Download,
    Trash2,
    Loader2,
    FolderOpen,
    HardDrive,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useVault } from '@/contexts/VaultContext';
import { FeatureGate } from '@/components/Subscription/FeatureGate';
import {
    getAttachments,
    uploadAttachment,
    downloadAttachment,
    deleteAttachment,
    getStorageUsage,
    formatFileSize,
    getFileIcon,
    type FileAttachment,
} from '@/services/fileAttachmentService';
import { cn } from '@/lib/utils';

type Translate = ReturnType<typeof useTranslation>['t'];

interface FileAttachmentsProps {
    vaultItemId: string | null;
    pendingMode?: boolean;
    onPendingFilesChange?: (count: number) => void;
    onPendingUploadReady?: (uploadPending: ((vaultItemId: string) => Promise<{ successCount: number; failureCount: number }>) | null) => void;
}

function readErrorText(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    if (!error || typeof error !== 'object') return '';

    const candidate = error as {
        message?: unknown;
        error_description?: unknown;
        details?: unknown;
        hint?: unknown;
        code?: unknown;
    };
    for (const value of [
        candidate.message,
        candidate.error_description,
        candidate.details,
        candidate.hint,
        candidate.code,
    ]) {
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
    }

    return '';
}

export function getAttachmentErrorDescription(error: unknown, t: Translate): string {
    const message = readErrorText(error);

    if (message.startsWith('FILE_TOO_LARGE:')) {
        return t('fileAttachments.fileTooLarge', { size: message.split(':')[1] });
    }

    if (message.startsWith('STORAGE_LIMIT_REACHED:')) {
        const parts = message.split(':');
        return t('fileAttachments.storageLimitReached', { used: parts[1], limit: parts[2] });
    }

    if (message.includes('Binary vault encryption')) {
        return t('fileAttachments.binaryEncryptionRequired', {
            defaultValue: 'Die Datei konnte nicht sicher verschlüsselt werden. Sperre und entsperre den Tresor erneut und versuche es noch einmal.',
        });
    }

    if (
        message.includes('File attachments require an active Premium or Families subscription')
        || message.includes('active Premium or Families subscription')
    ) {
        return t('fileAttachments.requiresPremium', {
            defaultValue: 'Dateianhänge benötigen ein aktives Premium- oder Familien-Abo.',
        });
    }

    if (
        message.includes('Attachment vault item must belong to authenticated user')
        || message.includes('file_attachments_vault_item_id_fkey')
        || message.includes('violates foreign key constraint')
    ) {
        return t('fileAttachments.itemUnavailable', {
            defaultValue: 'Der gespeicherte Tresor-Eintrag ist noch nicht als gültiges Upload-Ziel verfügbar. Synchronisiere den Tresor und versuche es erneut.',
        });
    }

    if (message.toLowerCase().includes('row-level security')) {
        return t('fileAttachments.permissionDenied', {
            defaultValue: 'Der Upload wurde durch die serverseitigen Zugriffsregeln blockiert.',
        });
    }

    return message || t('fileAttachments.operationFailed', {
        defaultValue: 'Der Dateivorgang konnte nicht abgeschlossen werden.',
    });
}

export function FileAttachments({
    vaultItemId,
    pendingMode = false,
    onPendingFilesChange,
    onPendingUploadReady,
}: FileAttachmentsProps) {
    const { t } = useTranslation();
    const { toast } = useToast();
    const { user } = useAuth();
    const { encryptData, decryptData, encryptBinary, decryptBinary, refreshIntegrityBaseline } = useVault();

    const [files, setFiles] = useState<FileAttachment[]>([]);
    const [loading, setLoading] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [downloadingId, setDownloadingId] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [isDragOver, setIsDragOver] = useState(false);
    const [usage, setUsage] = useState({ used: 0, limit: 1073741824 });
    const [pendingFiles, setPendingFiles] = useState<File[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Load attachments
    const loadFiles = useCallback(async () => {
        if (!vaultItemId || !user) return;
        setLoading(true);
        try {
            const [attachments, storageUsage] = await Promise.all([
                getAttachments(vaultItemId, decryptData),
                getStorageUsage(user.id),
            ]);
            setFiles(attachments);
            setUsage(storageUsage);
        } catch (err) {
            console.error('Failed to load attachments:', err);
        } finally {
            setLoading(false);
        }
    }, [vaultItemId, user, decryptData]);

    useEffect(() => {
        loadFiles();
    }, [loadFiles]);

    const updatePendingFiles = useCallback((nextFiles: File[]) => {
        setPendingFiles(nextFiles);
        onPendingFilesChange?.(nextFiles.length);
    }, [onPendingFilesChange]);

    const uploadFiles = useCallback(async (
        filesToUpload: File[],
        targetVaultItemId: string,
        options?: { refreshBaseline?: boolean },
    ): Promise<{ successCount: number; failureCount: number }> => {
        if (!user) return { successCount: 0, failureCount: filesToUpload.length };

        setUploading(true);
        let successCount = 0;
        let failureCount = 0;

        try {
            for (const file of filesToUpload) {
                try {
                    await uploadAttachment(
                        user.id,
                        targetVaultItemId,
                        file,
                        encryptData,
                        encryptBinary,
                    );
                    successCount++;
                } catch (err) {
                    toast({
                        title: t('fileAttachments.uploadError'),
                        description: getAttachmentErrorDescription(err, t),
                        variant: 'destructive',
                    });
                    failureCount++;
                }
            }

            if (successCount > 0) {
                toast({ title: t('fileAttachments.uploaded', { count: successCount }) });
                if (targetVaultItemId === vaultItemId) {
                    await loadFiles();
                }
                if (options?.refreshBaseline !== false) {
                    await refreshIntegrityBaseline({ itemIds: [targetVaultItemId] }).catch((err) => {
                        console.warn('Failed to refresh integrity baseline after file upload:', err);
                    });
                }
            }
            return { successCount, failureCount };
        } finally {
            setUploading(false);
        }
    }, [encryptBinary, encryptData, loadFiles, refreshIntegrityBaseline, t, toast, user, vaultItemId]);

    useEffect(() => {
        if (!pendingMode || vaultItemId) {
            onPendingUploadReady?.(null);
            return;
        }

        onPendingUploadReady?.(async (createdVaultItemId: string) => {
            const filesToUpload = [...pendingFiles];
            updatePendingFiles([]);
            if (filesToUpload.length === 0) {
                return { successCount: 0, failureCount: 0 };
            }
            return uploadFiles(filesToUpload, createdVaultItemId, { refreshBaseline: false });
        });

        return () => onPendingUploadReady?.(null);
    }, [onPendingUploadReady, pendingFiles, pendingMode, updatePendingFiles, uploadFiles, vaultItemId]);

    const handleUpload = async (filesToUpload: File[]) => {
        if (pendingMode && !vaultItemId) {
            updatePendingFiles([...pendingFiles, ...filesToUpload]);
            return;
        }
        if (!vaultItemId) return;
        await uploadFiles(filesToUpload, vaultItemId);
    };

    const handleDownload = async (attachment: FileAttachment) => {
        setDownloadingId(attachment.id);
        try {
            await downloadAttachment(
                attachment,
                decryptData,
                decryptBinary,
            );
        } catch (err) {
            toast({
                title: t('fileAttachments.downloadError'),
                description: getAttachmentErrorDescription(err, t),
                variant: 'destructive',
            });
        } finally {
            setDownloadingId(null);
        }
    };

    const handleDelete = async (attachment: FileAttachment) => {
        setDeletingId(attachment.id);
        try {
            await deleteAttachment(attachment, decryptData);
            toast({ title: t('fileAttachments.deleted') });
            await loadFiles();
            await refreshIntegrityBaseline({ itemIds: [vaultItemId] }).catch((err) => {
                console.warn('Failed to refresh integrity baseline after file delete:', err);
            });
        } catch (err) {
            toast({
                title: t('fileAttachments.deleteError'),
                description: getAttachmentErrorDescription(err, t),
                variant: 'destructive',
            });
        } finally {
            setDeletingId(null);
        }
    };

    // Drag and drop handlers
    const onDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setIsDragOver(true);
    };
    const onDragEnter = (e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setIsDragOver(true);
    };
    const onDragLeave = () => setIsDragOver(false);
    const onDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(false);
        const droppedFiles = Array.from(e.dataTransfer.files);
        if (droppedFiles.length > 0) handleUpload(droppedFiles);
    };
    const onFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFiles = Array.from(e.target.files || []);
        if (selectedFiles.length > 0) handleUpload(selectedFiles);
        e.target.value = '';
    };

    if (!vaultItemId && !pendingMode) return null;

    const usagePercent = Math.round((usage.used / usage.limit) * 100);

    return (
        <FeatureGate feature="file_attachments" featureLabel={t('fileAttachments.title')}>
            <div className="space-y-4 pt-4 border-t">
                <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold flex items-center gap-2">
                        <FolderOpen className="w-4 h-4" />
                        {t('fileAttachments.title')}
                    </h3>
                    {vaultItemId ? (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <HardDrive className="w-3 h-3" />
                            {formatFileSize(usage.used)} / {formatFileSize(usage.limit)}
                        </div>
                    ) : null}
                </div>

                {/* Storage usage bar */}
                {vaultItemId ? <Progress value={usagePercent} className="h-1.5" /> : null}

                {/* Drop zone */}
                <div
                    onDragOver={onDragOver}
                    onDragEnter={onDragEnter}
                    onDragLeave={onDragLeave}
                    onDrop={onDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={cn(
                        'border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-all',
                        'hover:border-primary/50 hover:bg-primary/5',
                        isDragOver && 'border-primary bg-primary/10 scale-[1.02]',
                        uploading && 'pointer-events-none opacity-50',
                    )}
                >
                    <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        className="hidden"
                        onChange={onFileSelect}
                    />
                    {uploading ? (
                        <Loader2 className="w-8 h-8 mx-auto animate-spin text-primary" />
                    ) : (
                        <>
                            <Upload className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                            <p className="text-sm text-muted-foreground">
                                {t('fileAttachments.dropzone')}
                            </p>
                            <p className="text-xs text-muted-foreground/70 mt-1">
                                {t('fileAttachments.maxSize', { size: '1 GB' })}
                            </p>
                        </>
                    )}
                </div>

                {/* File list */}
                {pendingMode && !vaultItemId && pendingFiles.length > 0 ? (
                    <div className="space-y-2">
                        {pendingFiles.map((file, index) => (
                            <div
                                key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
                                className="flex items-center gap-3 p-3 rounded-lg bg-muted/30"
                            >
                                <span className="text-lg">{getFileIcon(file.type || null)}</span>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium truncate">{file.name}</p>
                                    <p className="text-xs text-muted-foreground">
                                        {formatFileSize(file.size)}
                                    </p>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-destructive hover:text-destructive"
                                    onClick={() => {
                                        updatePendingFiles(pendingFiles.filter((_, fileIndex) => fileIndex !== index));
                                    }}
                                >
                                    <Trash2 className="w-4 h-4" />
                                </Button>
                            </div>
                        ))}
                    </div>
                ) : loading ? (
                    <div className="flex justify-center py-4">
                        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                    </div>
                ) : files.length > 0 ? (
                    <div className="space-y-2">
                        {files.map((file) => (
                            <div
                                key={file.id}
                                className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
                            >
                                <span className="text-lg">{getFileIcon(file.mime_type)}</span>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium truncate">{file.file_name}</p>
                                    <p className="text-xs text-muted-foreground">
                                        {formatFileSize(file.file_size)}
                                    </p>
                                </div>
                                <div className="flex items-center gap-1">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8"
                                        onClick={() => handleDownload(file)}
                                        disabled={downloadingId === file.id}
                                    >
                                        {downloadingId === file.id ? (
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                        ) : (
                                            <Download className="w-4 h-4" />
                                        )}
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-destructive hover:text-destructive"
                                        onClick={() => handleDelete(file)}
                                        disabled={deletingId === file.id}
                                    >
                                        {deletingId === file.id ? (
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                        ) : (
                                            <Trash2 className="w-4 h-4" />
                                        )}
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : null}
            </div>
        </FeatureGate>
    );
}
