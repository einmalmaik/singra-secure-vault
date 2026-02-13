// Copyright (c) 2025-2026 Maunting Studios
// Licensed under the Business Source License 1.1 — see LICENSE
/**
 * @fileoverview Secure Clipboard Service for Singra PW
 *
 * Provides a secure clipboard write with automatic clearing after a
 * configurable timeout (default 30 seconds).  Only clears if the
 * clipboard content has not been overwritten by the user in the
 * meantime.
 *
 * SECURITY: Prevents sensitive data (passwords, TOTP codes, secrets)
 * from lingering in the system clipboard indefinitely.
 */

const CLIPBOARD_CLEAR_DELAY_MS = 30_000; // 30 seconds

/** Internal handle so we can cancel a pending clear when a new copy happens. */
let pendingClearTimer: ReturnType<typeof setTimeout> | null = null;

/** The last value we wrote — used to avoid clobbering user-copied content. */
let lastWrittenValue: string | null = null;

/**
 * Writes text to the system clipboard and schedules automatic clearing
 * after {@link CLIPBOARD_CLEAR_DELAY_MS} milliseconds.
 *
 * If the user (or another copy call) overwrites the clipboard before the
 * timer fires, the old timer is cancelled so we never erase unrelated
 * content.
 *
 * @param text - The sensitive text to copy
 * @throws Re-throws any clipboard API error so callers can show a toast
 */
export async function writeClipboard(text: string): Promise<void> {
    // Cancel any previously scheduled clear
    if (pendingClearTimer !== null) {
        clearTimeout(pendingClearTimer);
        pendingClearTimer = null;
    }

    await navigator.clipboard.writeText(text);
    lastWrittenValue = text;

    // Schedule auto-clear
    pendingClearTimer = setTimeout(async () => {
        pendingClearTimer = null;
        try {
            // Only clear if clipboard still contains what we wrote.
            // Clipboard.readText may be denied — that is fine, just skip.
            const current = await navigator.clipboard.readText();
            if (current === lastWrittenValue) {
                await navigator.clipboard.writeText('');
            }
        } catch {
            // Permission denied or not focused — silently clear anyway to be safe
            try {
                await navigator.clipboard.writeText('');
            } catch {
                // Nothing more we can do
            }
        }
        lastWrittenValue = null;
    }, CLIPBOARD_CLEAR_DELAY_MS);
}
