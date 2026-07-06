// Copyright (c) 2025-2026 Maunting Studios
// Licensed under the Business Source License 1.1 - see LICENSE
/**
 * @fileoverview Tests for premium file attachment UI behavior.
 */

// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import type React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { FileAttachments, getAttachmentErrorDescription } from "./FileAttachments";
import { uploadAttachment } from "@/services/fileAttachmentService";

const mockRefreshIntegrityBaseline = vi.fn().mockResolvedValue(undefined);
const mockToast = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      if (key === "fileAttachments.title") return "Dateianhänge";
      if (key === "fileAttachments.dropzone") return "Dateien hierher ziehen oder klicken zum Hochladen";
      if (key === "fileAttachments.maxSize") return `Max. ${params?.size} pro Datei`;
      if (key === "fileAttachments.uploaded") return `${params?.count} Datei(en) hochgeladen`;
      if (typeof params?.defaultValue === "string") return params.defaultValue;
      return key;
    },
  }),
}));

vi.mock("@/components/Subscription/FeatureGate", () => ({
  FeatureGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/ui/progress", () => ({
  Progress: ({ value, className }: { value?: number; className?: string }) => (
    <div data-testid="usage-progress" data-value={value} className={className} />
  ),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
}));

vi.mock("@/contexts/VaultContext", () => ({
  useVault: () => ({
    encryptData: vi.fn(),
    decryptData: vi.fn(),
    encryptBinary: vi.fn(),
    decryptBinary: vi.fn(),
    refreshIntegrityBaseline: mockRefreshIntegrityBaseline,
  }),
}));

vi.mock("@/services/fileAttachmentService", () => ({
  getAttachments: vi.fn().mockResolvedValue([]),
  getStorageUsage: vi.fn().mockResolvedValue({ used: 0, limit: 1024 * 1024 * 1024 }),
  uploadAttachment: vi.fn().mockResolvedValue({ id: "file-1" }),
  downloadAttachment: vi.fn(),
  deleteAttachment: vi.fn(),
  formatFileSize: (bytes: number) => bytes === 1024 * 1024 * 1024 ? "1.00 GB" : `${bytes} B`,
  getFileIcon: () => "File",
}));

describe("FileAttachments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes Supabase error objects instead of rendering [object Object]", () => {
    const t = ((key: string, params?: Record<string, string | number>) => {
      if (typeof params?.defaultValue === "string") return params.defaultValue;
      return key;
    }) as Parameters<typeof getAttachmentErrorDescription>[1];

    expect(getAttachmentErrorDescription({ message: "violates foreign key constraint file_attachments_vault_item_id_fkey" }, t))
      .toBe("Der gespeicherte Tresor-Eintrag ist noch nicht als gültiges Upload-Ziel verfügbar. Synchronisiere den Tresor und versuche es erneut.");
    expect(getAttachmentErrorDescription({ message: "new row violates row-level security policy" }, t))
      .toBe("Der Upload wurde durch die serverseitigen Zugriffsregeln blockiert.");
    expect(getAttachmentErrorDescription({ details: "File attachments require an active Premium or Families subscription" }, t))
      .toBe("Dateianhänge benötigen ein aktives Premium- oder Familien-Abo.");
    expect(getAttachmentErrorDescription({ code: "23503" }, t)).toBe("23503");
    expect(getAttachmentErrorDescription({}, t)).not.toContain("[object Object]");
  });

  it("shows the 1 GB product limit and keeps the file picker unrestricted", async () => {
    const { container } = render(<FileAttachments vaultItemId="item-1" />);

    expect(await screen.findByText("Max. 1 GB pro Datei")).toBeInTheDocument();
    const input = container.querySelector('input[type="file"]');
    expect(input).toBeInTheDocument();
    expect(input).not.toHaveAttribute("accept");
  });

  it("accepts arbitrary dragged files as opaque binary uploads and rebaselines the vault item", async () => {
    render(<FileAttachments vaultItemId="item-1" />);
    const dropzone = await screen.findByText("Dateien hierher ziehen oder klicken zum Hochladen");
    const xml = new File(["<secret>SINGRA_E2EE_SECRET_MARKER_2026</secret>"], "test.xml", {
      type: "application/xml",
    });
    const extensionless = new File(["opaque"], "extensionless", { type: "" });

    fireEvent.drop(dropzone.parentElement as HTMLElement, {
      dataTransfer: {
        files: [xml, extensionless],
      },
    });

    await waitFor(() => expect(uploadAttachment).toHaveBeenCalledTimes(2));
    expect(uploadAttachment).toHaveBeenNthCalledWith(
      1,
      "user-1",
      "item-1",
      xml,
      expect.any(Function),
      expect.any(Function),
    );
    expect(uploadAttachment).toHaveBeenNthCalledWith(
      2,
      "user-1",
      "item-1",
      extensionless,
      expect.any(Function),
      expect.any(Function),
    );
    await waitFor(() => expect(mockRefreshIntegrityBaseline).toHaveBeenCalledWith({ itemIds: ["item-1"] }));
  });

  it("shows a readable upload error when Supabase returns a plain object", async () => {
    vi.mocked(uploadAttachment).mockRejectedValueOnce({
      message: "violates foreign key constraint file_attachments_vault_item_id_fkey",
    });

    render(<FileAttachments vaultItemId="item-1" />);
    const dropzone = await screen.findByText("Dateien hierher ziehen oder klicken zum Hochladen");
    const file = new File(["secret"], "secret.pdf", { type: "application/pdf" });

    fireEvent.drop(dropzone.parentElement as HTMLElement, {
      dataTransfer: {
        files: [file],
      },
    });

    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      title: "fileAttachments.uploadError",
      description: "Der gespeicherte Tresor-Eintrag ist noch nicht als gültiges Upload-Ziel verfügbar. Synchronisiere den Tresor und versuche es erneut.",
      variant: "destructive",
    })));
  });

  it("keeps new-entry files pending until a real vault item id exists", async () => {
    let uploadPending:
      | ((vaultItemId: string) => Promise<{ successCount: number; failureCount: number }>)
      | null = null;
    const onPendingFilesChange = vi.fn();

    render(
      <FileAttachments
        vaultItemId={null}
        pendingMode
        onPendingFilesChange={onPendingFilesChange}
        onPendingUploadReady={(upload) => {
          uploadPending = upload;
        }}
      />,
    );

    const dropzone = await screen.findByText("Dateien hierher ziehen oder klicken zum Hochladen");
    const pendingFile = new File(["secret"], "secret.pdf", { type: "application/pdf" });

    fireEvent.drop(dropzone.parentElement as HTMLElement, {
      dataTransfer: {
        files: [pendingFile],
      },
    });

    expect(uploadAttachment).not.toHaveBeenCalled();
    expect(await screen.findByText("secret.pdf")).toBeInTheDocument();
    expect(onPendingFilesChange).toHaveBeenLastCalledWith(1);

    await waitFor(() => expect(uploadPending).toBeTypeOf("function"));
    let uploadResult: { successCount: number; failureCount: number } | undefined;
    await act(async () => {
      uploadResult = await uploadPending!("created-item-1");
    });
    expect(uploadResult).toEqual({
      successCount: 1,
      failureCount: 0,
    });

    expect(uploadAttachment).toHaveBeenCalledWith(
      "user-1",
      "created-item-1",
      pendingFile,
      expect.any(Function),
      expect.any(Function),
    );
    expect(onPendingFilesChange).toHaveBeenLastCalledWith(0);
  });
});
