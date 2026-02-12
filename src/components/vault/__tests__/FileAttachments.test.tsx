/**
 * @fileoverview Tests for FileAttachments Component
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { FileAttachments } from "../FileAttachments";

// ============ Mocks ============

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "fileAttachments.title": "File Attachments",
        "fileAttachments.dropzone": "Drop files here or click to upload",
        "fileAttachments.maxSize": "Max 10MB per file",
      };
      return map[key] || key;
    },
  }),
}));

const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "user-1" },
  }),
}));

vi.mock("@/contexts/VaultContext", () => ({
  useVault: () => ({
    encryptItem: vi.fn(),
    decryptItem: vi.fn(),
    encryptData: vi.fn(),
    decryptData: vi.fn(),
  }),
}));

// Mock FeatureGate to pass through children
vi.mock("@/components/Subscription/FeatureGate", () => ({
  FeatureGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const mockGetAttachments = vi.fn().mockResolvedValue([]);
const mockGetStorageUsage = vi.fn().mockResolvedValue({ used: 512000, limit: 1073741824 });
const mockFormatFileSize = vi.fn((bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
});

vi.mock("@/services/fileAttachmentService", () => ({
  getAttachments: (...args: unknown[]) => mockGetAttachments(...args),
  uploadAttachment: vi.fn(),
  downloadAttachment: vi.fn(),
  deleteAttachment: vi.fn(),
  getStorageUsage: (...args: unknown[]) => mockGetStorageUsage(...args),
  formatFileSize: (bytes: number) => mockFormatFileSize(bytes),
  getFileIcon: vi.fn().mockReturnValue("file"),
}));

vi.mock("@/lib/utils", () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(" "),
}));

// ============ Tests ============

describe("FileAttachments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAttachments.mockResolvedValue([]);
    mockGetStorageUsage.mockResolvedValue({ used: 512000, limit: 1073741824 });
  });

  it("should render nothing when vaultItemId is null", () => {
    const { container } = render(<FileAttachments vaultItemId={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("should render file attachments section with title", async () => {
    render(<FileAttachments vaultItemId="item-1" />);

    await waitFor(() => {
      expect(screen.getByText("File Attachments")).toBeInTheDocument();
    });
  });

  it("should show storage usage", async () => {
    render(<FileAttachments vaultItemId="item-1" />);

    await waitFor(() => {
      expect(mockFormatFileSize).toHaveBeenCalled();
    });
  });

  it("should show drop zone", async () => {
    render(<FileAttachments vaultItemId="item-1" />);

    await waitFor(() => {
      // Drop zone has a hidden file input
      const fileInput = document.querySelector("input[type='file']");
      expect(fileInput).not.toBeNull();
    });
  });

  it("should display file list when attachments exist", async () => {
    mockGetAttachments.mockResolvedValue([
      { id: "f1", file_name: "document.pdf", file_size: 1024, mime_type: "application/pdf" },
      { id: "f2", file_name: "photo.jpg", file_size: 2048, mime_type: "image/jpeg" },
    ]);

    render(<FileAttachments vaultItemId="item-1" />);

    await waitFor(() => {
      expect(screen.getByText("document.pdf")).toBeInTheDocument();
      expect(screen.getByText("photo.jpg")).toBeInTheDocument();
    });
  });

  it("should call getAttachments and getStorageUsage on mount", async () => {
    mockGetAttachments.mockResolvedValue([
      { id: "f1", file_name: "report.pdf", file_size: 1024, mime_type: "application/pdf" },
    ]);

    render(<FileAttachments vaultItemId="item-1" />);

    await waitFor(() => {
      expect(mockGetAttachments).toHaveBeenCalled();
      expect(mockGetStorageUsage).toHaveBeenCalled();
    }, { timeout: 3000 });
  });
});
