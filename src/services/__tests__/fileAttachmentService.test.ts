// Copyright (c) 2025-2026 Maunting Studios
// Licensed under the Business Source License 1.1 — see LICENSE
/**
 * @fileoverview Phase 2 — Unit-Tests für fileAttachmentService mit DB-Mocks
 *
 * Testet die DB-abhängigen Funktionen: getAttachments, getStorageUsage,
 * uploadAttachment, downloadAttachment, deleteAttachment.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Supabase Mock
// ---------------------------------------------------------------------------
function createChainable(resolvedValue: unknown = { data: null, error: null }) {
  const chain: Record<string, (...args: unknown[]) => unknown> = {};
  const methods = ["select", "insert", "update", "delete", "eq", "in", "single", "maybeSingle", "limit", "order", "upsert"];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.then = (resolve: (v: unknown) => unknown) => resolve(resolvedValue);
  return chain;
}

const mockStorageBucket = vi.hoisted(() => {
  const mockBlob = { text: () => Promise.resolve("encrypted-content") };
  return {
    upload: vi.fn().mockResolvedValue({ data: { path: "test" }, error: null }),
    download: vi.fn().mockResolvedValue({ data: mockBlob, error: null }),
    remove: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
});

const mockSupabase = vi.hoisted(() => {
  const chains: unknown[] = [];
  let chainIndex = 0;

  return {
    from: vi.fn().mockImplementation(() => {
      const idx = chainIndex++;
      return chains[idx] || createChainable();
    }),
    rpc: vi.fn(),
    auth: { getUser: vi.fn(), getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: "test-token" } }, error: null }) },
    functions: { invoke: vi.fn() },
    storage: {
      from: vi.fn().mockReturnValue(mockStorageBucket),
    },
    _setChains: (newChains: unknown[]) => { chains.length = 0; chains.push(...newChains); chainIndex = 0; },
    _reset: () => { chains.length = 0; chainIndex = 0; },
  };
});

vi.mock("@/integrations/supabase/client", () => ({ supabase: mockSupabase }));

vi.mock("@/platform/runtime", () => ({
  isTauriRuntime: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  open: vi.fn(),
  remove: vi.fn(),
  rename: vi.fn(),
}));

vi.mock("@tauri-apps/api/path", () => ({
  downloadDir: vi.fn(),
  join: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------
import {
  getAttachments,
  getStorageUsage,
  uploadAttachment,
  downloadAttachment,
  deleteAttachment,
  sanitizeDownloadFileName,
} from "@/services/fileAttachmentService";
import type { FileAttachment } from "@/services/fileAttachmentService";
import { encryptBytes, importMasterKey } from "@/services/cryptoService";
import { isTauriRuntime } from "@/platform/runtime";
import { save } from "@tauri-apps/plugin-dialog";
import { open, remove, rename } from "@tauri-apps/plugin-fs";
import { downloadDir, join } from "@tauri-apps/api/path";

async function sha256Base64(data: string): Promise<string> {
  const bytes = new TextEncoder().encode(data);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

async function sha256JsonBase64(value: unknown): Promise<string> {
  return sha256Base64(JSON.stringify(value));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  mockSupabase._reset();
  mockStorageBucket.upload.mockResolvedValue({ data: { path: "test" }, error: null });
  const mockBlob = { text: () => Promise.resolve("encrypted-content") };
  mockStorageBucket.download.mockResolvedValue({ data: mockBlob, error: null });
  mockStorageBucket.remove.mockResolvedValue({ data: null, error: null });
  vi.mocked(isTauriRuntime).mockReturnValue(false);
  vi.mocked(save).mockResolvedValue(null);
  vi.mocked(open).mockResolvedValue({
    write: vi.fn(async (chunk: Uint8Array) => chunk.byteLength),
    close: vi.fn(async () => undefined),
  });
  vi.mocked(remove).mockResolvedValue(undefined);
  vi.mocked(rename).mockResolvedValue(undefined);
  vi.mocked(downloadDir).mockResolvedValue("C:\\Users\\Test\\Downloads");
  vi.mocked(join).mockImplementation(async (...parts: string[]) => parts.join("\\"));
});

describe("sanitizeDownloadFileName()", () => {
  it("removes path separators, control characters, and HTML-sensitive filename characters", () => {
    expect(sanitizeDownloadFileName('..\\<img src=x onerror=alert(1)>.svg\u0000')).toBe('..--img src=x onerror=alert(1)-.svg');
    expect(sanitizeDownloadFileName('folder/../../secret.html')).toBe('folder-..-..-secret.html');
    expect(sanitizeDownloadFileName('CON.txt')).toBe('_CON.txt');
    expect(sanitizeDownloadFileName('safe\u202Egnp.js')).toBe('safe-gnp.js');
    expect(sanitizeDownloadFileName('   ...   ')).toBe('singra-vault-attachment');
  });
});

describe("getAttachments()", () => {
  it("returns list of attachments", async () => {
    const attachments = [
      { id: "a1", vault_item_id: "v1", file_name: "test.pdf", file_size: 1000, mime_type: "application/pdf", storage_path: "u/v/f", encrypted: true, created_at: "2026-01-01" },
    ];
    const chain = createChainable({ data: attachments, error: null });
    mockSupabase._setChains([chain]);

    const result = await getAttachments("v1");
    expect(result).toEqual(attachments);
    expect(mockSupabase.from).toHaveBeenCalledWith("file_attachments");
    expect(chain.eq).toHaveBeenCalledWith("vault_item_id", "v1");
  });

  it("decrypts metadata when decryptFn is provided", async () => {
    const attachments = [
      {
        id: "a1", vault_item_id: "v1", file_name: "encrypted", file_size: 1000,
        mime_type: "application/octet-stream", storage_path: "u/v/f", encrypted: true,
        encrypted_metadata: "encrypted-meta", created_at: "2026-01-01",
      },
    ];
    const chain = createChainable({ data: attachments, error: null });
    mockSupabase._setChains([chain]);

    const decryptFn = vi.fn().mockResolvedValue(JSON.stringify({ file_name: "secret.pdf", mime_type: "application/pdf" }));
    const result = await getAttachments("v1", decryptFn);

    expect(result).toHaveLength(1);
    expect(result[0].file_name).toBe("secret.pdf");
    expect(result[0].mime_type).toBe("application/pdf");
    expect(decryptFn).toHaveBeenCalledWith("encrypted-meta");
  });

  it("returns empty list when no attachments", async () => {
    const chain = createChainable({ data: [], error: null });
    mockSupabase._setChains([chain]);

    const result = await getAttachments("v1");
    expect(result).toEqual([]);
  });

  it("throws on DB error", async () => {
    const chain = createChainable({ data: null, error: { message: "DB error" } });
    mockSupabase._setChains([chain]);

    await expect(getAttachments("v1")).rejects.toEqual({ message: "DB error" });
  });
});

describe("getStorageUsage()", () => {
  it("returns used and limit", async () => {
    const data = [{ file_size: 500 }, { file_size: 300 }];
    const chain = createChainable({ data, error: null });
    mockSupabase._setChains([chain]);

    const result = await getStorageUsage("user-1");
    expect(result.used).toBe(800);
    expect(result.limit).toBe(1073741824); // product-facing 1 GB file upload limit
  });

  it("returns 0 used when no files", async () => {
    const chain = createChainable({ data: [], error: null });
    mockSupabase._setChains([chain]);

    const result = await getStorageUsage("user-1");
    expect(result.used).toBe(0);
  });
});

describe("uploadAttachment()", () => {
  it("throws for file too large (>1GB)", async () => {
    const bigFile = new File(["x"], "big.bin");
    Object.defineProperty(bigFile, "size", { value: 1024 * 1024 * 1024 + 1 });

    await expect(uploadAttachment("user-1", "v1", bigFile, vi.fn())).rejects.toThrow("FILE_TOO_LARGE");
  });

  it("requires binary vault encryption", async () => {
    const file = new File(["content"], "test.txt", { type: "text/plain" });

    await expect(uploadAttachment("user-1", "v1", file, vi.fn())).rejects.toThrow("Binary vault encryption");
  });

  it("encrypts chunked content and manifest, stores only opaque DB metadata", async () => {
    const insertChain = createChainable({
      data: { id: "att1", vault_item_id: "v1", file_name: "encrypted", file_size: 7, storage_path: "user-1/v1/att1", encrypted: true },
      error: null,
    });
    mockSupabase._setChains([insertChain]);

    const encryptFn = vi.fn().mockResolvedValue("encrypted-manifest");
    const encryptBinary = vi.fn().mockResolvedValue("wrapped-file-key");

    const fileContent = new TextEncoder().encode("SINGRA_E2EE_SECRET_MARKER_2026");
    const file = new File([fileContent], "test.xml", { type: "application/xml" });

    const result = await uploadAttachment("user-1", "v1", file, encryptFn, encryptBinary);

    expect(encryptBinary).toHaveBeenCalledTimes(1);
    expect(encryptFn).toHaveBeenCalledTimes(1);
    expect(encryptFn.mock.calls[0][0]).toContain("\"original_name\":\"test.xml\"");
    expect(encryptFn.mock.calls[0][0]).toContain("\"mime_type\":\"application/xml\"");
    expect(encryptFn.mock.calls[0][0]).toContain("\"file_revision\":1");
    expect(encryptFn.mock.calls[0][0]).toContain("\"manifest_root\":");
    expect(mockStorageBucket.upload).toHaveBeenCalled();
    const [storagePath, uploadedBlob] = mockStorageBucket.upload.mock.calls[0] as [string, Blob];
    expect(storagePath).not.toContain("test.xml");
    expect(storagePath).not.toContain(".xml");
    expect(storagePath).not.toContain("application/xml");
    const readBlobText = (b: Blob): Promise<string> => new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onload = () => res(reader.result as string);
      reader.onerror = () => rej(reader.error);
      reader.readAsText(b);
    });
    expect(await readBlobText(uploadedBlob)).not.toContain("SINGRA_E2EE_SECRET_MARKER_2026");
    expect(mockSupabase.from).toHaveBeenCalledWith("file_attachments");
    expect(insertChain.insert).toHaveBeenCalledWith(expect.objectContaining({
      file_name: "encrypted",
      mime_type: "application/octet-stream",
      encrypted_metadata: "sv-file-manifest-v1:encrypted-manifest",
    }));
    expect(result.file_name).toBe("test.xml");
  });

  it("uploads files with unknown or missing extensions without type restrictions", async () => {
    const insertChain = createChainable({
      data: { id: "att1", vault_item_id: "v1", file_name: "encrypted", file_size: 7, storage_path: "user-1/v1/att1", encrypted: true },
      error: null,
    });
    mockSupabase._setChains([insertChain, insertChain]);

    const encryptFn = vi.fn().mockResolvedValue("encrypted-manifest");
    const encryptBinary = vi.fn().mockResolvedValue("wrapped-file-key");
    const unknown = new File(["opaque"], "test.unknownextension", { type: "" });
    const extensionless = new File(["opaque"], "extensionless", { type: "" });

    await uploadAttachment("user-1", "v1", unknown, encryptFn, encryptBinary);
    await uploadAttachment("user-1", "v1", extensionless, encryptFn, encryptBinary);

    const paths = mockStorageBucket.upload.mock.calls.map((call) => call[0] as string);
    expect(paths.every((path) => !path.includes("unknownextension") && !path.includes("extensionless"))).toBe(true);
    expect(encryptFn.mock.calls[0][0]).toContain("\"original_name\":\"test.unknownextension\"");
    expect(encryptFn.mock.calls[1][0]).toContain("\"original_name\":\"extensionless\"");
  });
});

describe("downloadAttachment()", () => {
  it("downloads, decrypts, and triggers browser download", async () => {
    const attachment: FileAttachment = {
      id: "a1", vault_item_id: "v1", file_name: "test.pdf", file_size: 100,
      mime_type: "application/pdf", storage_path: "u/v/f", encrypted: true, created_at: "2026-01-01",
    };

    // Mock atob/btoa for base64
    const decryptFn = vi.fn().mockResolvedValue(btoa("decrypted-content"));

    // Mock createElement and click
    const mockAnchor = { href: "", download: "", click: vi.fn() };
    vi.spyOn(document, "createElement").mockReturnValue(mockAnchor as unknown as HTMLElement);
    vi.spyOn(document.body, "appendChild").mockImplementation(() => mockAnchor as unknown as HTMLElement);
    vi.spyOn(document.body, "removeChild").mockImplementation(() => mockAnchor as unknown as HTMLElement);
    // jsdom doesn't have URL.createObjectURL — define it
    if (!URL.createObjectURL) {
      (URL as unknown as Record<string, unknown>).createObjectURL = vi.fn().mockReturnValue("blob:test");
      (URL as unknown as Record<string, unknown>).revokeObjectURL = vi.fn();
    } else {
      vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
      vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => { });
    }

    await downloadAttachment(attachment, decryptFn);

    expect(mockStorageBucket.download).toHaveBeenCalledWith("u/v/f");
    expect(decryptFn).toHaveBeenCalled();
    expect(mockAnchor.click).toHaveBeenCalled();
    expect(mockAnchor.download).toBe("test.pdf");
  });

  it("streams chunked E2EE downloads to a writable file handle", async () => {
    const fileKeyBytes = crypto.getRandomValues(new Uint8Array(32));
    const fileKey = await importMasterKey(fileKeyBytes);
    const plaintext = new TextEncoder().encode("streamed plaintext");
    const plannedChunks = [{
      index: 0,
      storage_path: "user-1/v1/file-1/0",
      plaintext_size: plaintext.byteLength,
    }];
    const manifestRoot = await sha256JsonBase64({
      file_id: "file-1",
      file_revision: 1,
      chunk_size: 4 * 1024 * 1024,
      chunk_count: 1,
      chunks: plannedChunks,
    });
    const encryptedChunk = await encryptBytes(
      plaintext,
      fileKey,
      `sv-file-chunk-v1:user-1:v1:file-1:1:${manifestRoot}:0:1`,
    );
    const manifest = {
      version: 1,
      algorithm: "AES-256-GCM",
      file_id: "file-1",
      file_revision: 1,
      previous_manifest_hash: null,
      manifest_root: manifestRoot,
      owner_id: "user-1",
      vault_item_id: "v1",
      original_name: "secret.txt",
      mime_type: "text/plain",
      original_size: plaintext.byteLength,
      last_modified: null,
      uploaded_at: "2026-04-26T00:00:00.000Z",
      chunk_size: 4 * 1024 * 1024,
      chunk_count: 1,
      wrapped_file_key: "wrapped-key",
      chunks: [{
        ...plannedChunks[0],
        ciphertext_size: encryptedChunk.length,
        ciphertext_sha256: await sha256Base64(encryptedChunk),
      }],
      preview: null,
      notes: null,
    };
    const attachment: FileAttachment = {
      id: "file-1",
      vault_item_id: "v1",
      file_name: "encrypted",
      file_size: encryptedChunk.length,
      mime_type: "application/octet-stream",
      storage_path: "user-1/v1/file-1",
      encrypted: true,
      encrypted_metadata: "sv-file-manifest-v1:encrypted-manifest",
      created_at: "2026-04-26",
    };

    const writtenChunks: Uint8Array[] = [];
    const write = vi.fn().mockImplementation(async (chunk: Uint8Array) => {
      writtenChunks.push(new Uint8Array(chunk));
    });
    const close = vi.fn().mockResolvedValue(undefined);
    const abort = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("showSaveFilePicker", vi.fn().mockResolvedValue({
      createWritable: vi.fn().mockResolvedValue({ write, close, abort }),
    }));
    if (!URL.createObjectURL) {
      (URL as unknown as Record<string, unknown>).createObjectURL = vi.fn();
    }
    const createObjectUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
    mockStorageBucket.download.mockResolvedValueOnce({
      data: { text: () => Promise.resolve(encryptedChunk) },
      error: null,
    });

    await downloadAttachment(
      attachment,
      vi.fn().mockResolvedValue(JSON.stringify(manifest)),
      vi.fn().mockResolvedValue(fileKeyBytes),
    );

    expect(write).toHaveBeenCalledTimes(1);
    expect(new TextDecoder().decode(writtenChunks[0])).toBe("streamed plaintext");
    expect(close).toHaveBeenCalledTimes(1);
    expect(createObjectUrl).not.toHaveBeenCalled();
  });

  it("uses Tauri scoped download paths with partial-file rename", async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(true);
    vi.mocked(save).mockResolvedValue("C:\\Users\\Test\\Downloads\\secret.txt");
    const write = vi.fn(async (chunk: Uint8Array) => chunk.byteLength);
    const close = vi.fn(async () => undefined);
    vi.mocked(open).mockResolvedValue({ write, close });

    const fileKeyBytes = crypto.getRandomValues(new Uint8Array(32));
    const fileKey = await importMasterKey(fileKeyBytes);
    const plaintext = new TextEncoder().encode("tauri plaintext");
    const plannedChunks = [{
      index: 0,
      storage_path: "user-1/v1/file-tauri/0",
      plaintext_size: plaintext.byteLength,
    }];
    const manifestRoot = await sha256JsonBase64({
      file_id: "file-tauri",
      file_revision: 1,
      chunk_size: 4 * 1024 * 1024,
      chunk_count: 1,
      chunks: plannedChunks,
    });
    const encryptedChunk = await encryptBytes(
      plaintext,
      fileKey,
      `sv-file-chunk-v1:user-1:v1:file-tauri:1:${manifestRoot}:0:1`,
    );
    const manifest = {
      version: 1,
      algorithm: "AES-256-GCM",
      file_id: "file-tauri",
      file_revision: 1,
      previous_manifest_hash: null,
      manifest_root: manifestRoot,
      owner_id: "user-1",
      vault_item_id: "v1",
      original_name: "secret.txt",
      mime_type: "text/plain",
      original_size: plaintext.byteLength,
      last_modified: null,
      uploaded_at: "2026-04-26T00:00:00.000Z",
      chunk_size: 4 * 1024 * 1024,
      chunk_count: 1,
      wrapped_file_key: "wrapped-key",
      chunks: [{
        ...plannedChunks[0],
        ciphertext_size: encryptedChunk.length,
        ciphertext_sha256: await sha256Base64(encryptedChunk),
      }],
      preview: null,
      notes: null,
    };
    const attachment: FileAttachment = {
      id: "file-tauri",
      vault_item_id: "v1",
      file_name: "encrypted",
      file_size: encryptedChunk.length,
      mime_type: "application/octet-stream",
      storage_path: "user-1/v1/file-tauri",
      encrypted: true,
      encrypted_metadata: "sv-file-manifest-v1:encrypted-manifest",
      created_at: "2026-04-26",
    };
    mockStorageBucket.download.mockResolvedValueOnce({
      data: { text: () => Promise.resolve(encryptedChunk) },
      error: null,
    });

    await downloadAttachment(
      attachment,
      vi.fn().mockResolvedValue(JSON.stringify(manifest)),
      vi.fn().mockResolvedValue(fileKeyBytes),
    );

    expect(downloadDir).toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      defaultPath: "C:\\Users\\Test\\Downloads\\secret.txt",
    }));
    expect(open).toHaveBeenCalledWith("C:\\Users\\Test\\Downloads\\secret.txt.singra-partial", {
      write: true,
      create: true,
      truncate: true,
    });
    expect(write).toHaveBeenCalledTimes(1);
    expect(rename).toHaveBeenCalledWith(
      "C:\\Users\\Test\\Downloads\\secret.txt.singra-partial",
      "C:\\Users\\Test\\Downloads\\secret.txt",
    );
    expect(remove).not.toHaveBeenCalled();
  });

  it("blocks older manifest revisions when a local checkpoint exists", async () => {
    window.localStorage.setItem("singra:file-manifest-checkpoint:v1:user-1:v1:file-1", JSON.stringify({
      revision: 2,
      manifestHash: "newer-manifest-hash",
      previousManifestHash: null,
    }));

    const staleManifest = {
      version: 1,
      algorithm: "AES-256-GCM",
      file_id: "file-1",
      file_revision: 1,
      previous_manifest_hash: null,
      manifest_root: "stale-root",
      owner_id: "user-1",
      vault_item_id: "v1",
      original_name: "secret.txt",
      mime_type: "text/plain",
      original_size: 1,
      last_modified: null,
      uploaded_at: "2026-04-26T00:00:00.000Z",
      chunk_size: 4 * 1024 * 1024,
      chunk_count: 1,
      wrapped_file_key: "wrapped-key",
      chunks: [],
      preview: null,
      notes: null,
    };
    const attachment: FileAttachment = {
      id: "file-1",
      vault_item_id: "v1",
      file_name: "encrypted",
      file_size: 1,
      mime_type: "application/octet-stream",
      storage_path: "user-1/v1/file-1",
      encrypted: true,
      encrypted_metadata: "sv-file-manifest-v1:encrypted-manifest",
      created_at: "2026-04-26",
    };

    await expect(downloadAttachment(
      attachment,
      vi.fn().mockResolvedValue(JSON.stringify(staleManifest)),
      vi.fn(),
    )).rejects.toThrow("rollback detected");
    expect(mockStorageBucket.download).not.toHaveBeenCalled();
  });

  it("throws when download fails", async () => {
    mockStorageBucket.download.mockResolvedValueOnce({ data: null, error: { message: "Not found" } });

    const attachment: FileAttachment = {
      id: "a1", vault_item_id: "v1", file_name: "test.pdf", file_size: 100,
      mime_type: null, storage_path: "u/v/f", encrypted: true, created_at: "2026-01-01",
    };

    await expect(downloadAttachment(attachment, vi.fn())).rejects.toEqual({ message: "Not found" });
  });
});

describe("deleteAttachment()", () => {
  it("deletes from storage and DB", async () => {
    const dbChain = createChainable({ data: null, error: null });
    mockSupabase._setChains([dbChain]);

    const attachment: FileAttachment = {
      id: "a1", vault_item_id: "v1", file_name: "test.pdf", file_size: 100,
      mime_type: null, storage_path: "u/v/f", encrypted: true, created_at: "2026-01-01",
    };

    await deleteAttachment(attachment);

    expect(mockStorageBucket.remove).toHaveBeenCalledWith(["u/v/f"]);
    expect(mockSupabase.from).toHaveBeenCalledWith("file_attachments");
    expect(dbChain.delete).toHaveBeenCalled();
    expect(dbChain.eq).toHaveBeenCalledWith("id", "a1");
  });

  it("throws on DB error", async () => {
    const dbChain = createChainable({ data: null, error: { message: "Delete failed" } });
    mockSupabase._setChains([dbChain]);

    const attachment: FileAttachment = {
      id: "a1", vault_item_id: "v1", file_name: "test.pdf", file_size: 100,
      mime_type: null, storage_path: "u/v/f", encrypted: true, created_at: "2026-01-01",
    };

    await expect(deleteAttachment(attachment)).rejects.toEqual({ message: "Delete failed" });
  });
});
