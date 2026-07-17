import { Constants } from "./constants.js";
import { createTranslator } from "./translator.js";

chrome.alarms.create("keep_alive", { periodInMinutes: 4 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "keep_alive") {
    console.log("Keeping service worker alive");
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "ping") {
      console.log("Service worker is active");
      sendResponse({ status: "alive" });
    }
});

chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({
            id: "translate_selected_text",
            title: "Translate selected text",
            contexts: ["selection"],
        });
        chrome.contextMenus.create({
            id: "undo_last_translation",
            title: "Undo last translation",
            contexts: ["all"],
        });
    });
});

async function translateSegments(segments: string[], targetLang: string, provider: string): Promise<string[] | null> {
    const translator = createTranslator(provider);
    try {
        return await translator.translateSegments(segments, targetLang, '');
    } catch (error) {
        console.error(`Translation failed with ${provider}:`, error);
        return null;
    }
}

interface CachedTranslation {
    translatedSegments: string[];
    expiresAt: number;
}

async function getCacheKey(segments: string[], targetLang: string, provider: string): Promise<string> {
    const data = new TextEncoder().encode(`${provider}:${targetLang}:${JSON.stringify(segments)}`);
    const hash = await crypto.subtle.digest('SHA-256', data);
    const hashText = Array.from(new Uint8Array(hash)).map(byte => byte.toString(16).padStart(2, '0')).join('');
    return `${Constants.TRANSLATION_CACHE_PREFIX}${hashText}`;
}

async function getCachedTranslation(cacheKey: string): Promise<string[] | null> {
    const cached = (await chrome.storage.local.get(cacheKey))[cacheKey] as CachedTranslation | undefined;
    if (!cached) return null;

    if (cached.expiresAt <= Date.now()) {
        await chrome.storage.local.remove(cacheKey);
        return null;
    }

    return Array.isArray(cached.translatedSegments) ? cached.translatedSegments : null;
}

async function showPageAlert(tabId: number, message: string): Promise<void> {
    try {
        await chrome.scripting.executeScript({
            target: { tabId },
            args: [message],
            func: (alertMessage: string) => alert(alertMessage),
        });
    } catch (error) {
        console.error("Unable to show translation message:", error);
    }
}

async function translateSelection(tabId: number): Promise<void> {
    try {
        await chrome.action.setBadgeBackgroundColor({ tabId, color: "#2563eb" });
        await chrome.action.setBadgeText({ tabId, text: "..." });

        const [{ result: selectionPayload }] = await chrome.scripting.executeScript({
            target: { tabId },
            func: captureSelectedContent,
        });

        if (!selectionPayload || selectionPayload.segments.length === 0) {
            await showPageAlert(tabId, "Please select some text before translating.");
            return;
        }

        // Get settings from storage
        const { target_lang: targetLang = "en", ai_provider = "deepseek" } =
            await chrome.storage.sync.get(["target_lang", "ai_provider"]);

        const cacheKey = await getCacheKey(selectionPayload.segments, targetLang, ai_provider);
        let translatedSegments = await getCachedTranslation(cacheKey);

        if (!translatedSegments) {
            translatedSegments = await translateSegments(selectionPayload.segments, targetLang, ai_provider);
            if (translatedSegments) {
                try {
                    await chrome.storage.local.set({
                        [cacheKey]: {
                            translatedSegments,
                            expiresAt: Date.now() + Constants.TRANSLATION_CACHE_TTL_MS,
                        },
                    });
                } catch (error) {
                    // Very large translations can exceed local storage quota. The
                    // translation should still be applied even if it cannot be cached.
                    console.warn("Unable to cache this translation:", error);
                }
            }
        }

        if (!translatedSegments || translatedSegments.length !== selectionPayload.segments.length) {
            await showPageAlert(tabId, "Translation failed. Please check your DeepSeek API key and settings.");
            return;
        }

        const [{ result: applyResult }] = await chrome.scripting.executeScript({
            target: { tabId },
            args: [selectionPayload.token, translatedSegments],
            func: applyTranslatedSegments,
        });

        if (!applyResult?.success) {
            await showPageAlert(tabId, applyResult?.message || "The page changed before translation finished. Please select the text again.");
        }
    } catch (error) {
        console.error("Unable to translate the selected text:", error);
        await showPageAlert(tabId, "Translation cannot run on this page. Try a normal website tab.");
    } finally {
        await chrome.action.setBadgeText({ tabId, text: "" }).catch(() => undefined);
    }
}

async function undoTranslation(tabId: number): Promise<void> {
    try {
        const [{ result }] = await chrome.scripting.executeScript({
            target: { tabId },
            func: undoLastTranslation,
        });

        if (!result?.success) {
            await showPageAlert(tabId, result?.message || "There is no translation to undo on this page.");
        }
    } catch (error) {
        console.error("Unable to undo the last translation:", error);
        await showPageAlert(tabId, "Undo cannot run on this page.");
    }
}

async function translateActiveTab(): Promise<void> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
        await translateSelection(tab.id);
    }
}

chrome.commands.onCommand.addListener((command) => {
    if (command === "translate_selected_text") {
        void translateActiveTab();
    }
});

chrome.action.onClicked.addListener((tab) => {
    if (tab.id) {
        void translateSelection(tab.id);
    }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "translate_selected_text" && tab?.id) {
        void translateSelection(tab.id);
    } else if (info.menuItemId === "undo_last_translation" && tab?.id) {
        void undoTranslation(tab.id);
    }
});
  
function captureSelectedContent() {
    const scope = globalThis as typeof globalThis & {
      __langshiftPageState?: {
        pending: Map<string, any>;
        history: any[];
      };
    };
    const state = scope.__langshiftPageState ??= {
      pending: new Map<string, any>(),
      history: [],
    };
    const now = Date.now();

    for (const [key, pending] of state.pending.entries()) {
      if (now - pending.createdAt > 5 * 60 * 1000) {
        state.pending.delete(key);
      }
    }

    const token = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${now}-${Math.random().toString(36).slice(2)}`;
    const active = document.activeElement;

    if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) {
      const input = active as HTMLInputElement | HTMLTextAreaElement;
      const start = input.selectionStart;
      const end = input.selectionEnd;

      if (start === null || end === null || end <= start) return null;
      const selectedText = input.value.slice(start, end);
      if (!selectedText.trim()) return null;

      const segments: string[] = [];
      const maxChunkLength = 3000;
      let cursor = 0;
      while (cursor < selectedText.length) {
        let chunkEnd = Math.min(cursor + maxChunkLength, selectedText.length);
        if (chunkEnd < selectedText.length) {
          const candidate = selectedText.slice(cursor, chunkEnd);
          const minimumBoundary = Math.floor(candidate.length * 0.6);
          const boundary = Math.max(
            candidate.lastIndexOf("\n\n"),
            candidate.lastIndexOf("\n"),
            candidate.lastIndexOf("。"),
            candidate.lastIndexOf("！"),
            candidate.lastIndexOf("？"),
            candidate.lastIndexOf(". "),
            candidate.lastIndexOf("! "),
            candidate.lastIndexOf("? "),
            candidate.lastIndexOf("; "),
          );
          if (boundary >= minimumBoundary) chunkEnd = cursor + boundary + 1;
        }
        segments.push(selectedText.slice(cursor, chunkEnd));
        cursor = chunkEnd;
      }

      state.pending.set(token, {
        kind: "input",
        element: input,
        start,
        end,
        beforeValue: input.value,
        segmentCount: segments.length,
        createdAt: now,
      });
      return { token, segments };
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;

    const range = selection.getRangeAt(0);
    const commonAncestor = range.commonAncestorContainer;
    const root = commonAncestor.nodeType === Node.TEXT_NODE
      ? commonAncestor.parentNode
      : commonAncestor;
    if (!root) return null;

    const parts: Array<{
      node: Text;
      start: number;
      end: number;
      originalText: string;
    }> = [];

    const addTextParts = (node: Text, selectionStart: number, selectionEnd: number) => {
      const maxChunkLength = 3000;
      let cursor = selectionStart;

      while (cursor < selectionEnd) {
        let chunkEnd = Math.min(cursor + maxChunkLength, selectionEnd);

        if (chunkEnd < selectionEnd) {
          const candidate = node.data.slice(cursor, chunkEnd);
          const minimumBoundary = Math.floor(candidate.length * 0.6);
          const boundary = Math.max(
            candidate.lastIndexOf("\n\n"),
            candidate.lastIndexOf("\n"),
            candidate.lastIndexOf("。"),
            candidate.lastIndexOf("！"),
            candidate.lastIndexOf("？"),
            candidate.lastIndexOf(". "),
            candidate.lastIndexOf("! "),
            candidate.lastIndexOf("? "),
            candidate.lastIndexOf("; "),
          );
          if (boundary >= minimumBoundary) {
            chunkEnd = cursor + boundary + 1;
          }
        }

        const originalText = node.data.slice(cursor, chunkEnd);
        if (originalText.trim()) {
          parts.push({ node, start: cursor, end: chunkEnd, originalText });
        }
        cursor = chunkEnd;
      }
    };

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let currentNode = walker.nextNode();

    while (currentNode) {
      const textNode = currentNode as Text;
      if (range.intersectsNode(textNode)) {
        const start = textNode === range.startContainer ? range.startOffset : 0;
        const end = textNode === range.endContainer ? range.endOffset : textNode.data.length;
        if (end > start) addTextParts(textNode, start, end);
      }
      currentNode = walker.nextNode();
    }

    if (parts.length === 0) return null;

    const parentElement = commonAncestor.nodeType === Node.ELEMENT_NODE
      ? commonAncestor as Element
      : commonAncestor.parentElement;
    state.pending.set(token, {
      kind: "dom",
      parts,
      editable: parentElement?.closest('[contenteditable="true"]') || null,
      createdAt: now,
    });

    return { token, segments: parts.map((part) => part.originalText) };
  }

function applyTranslatedSegments(token: string, translatedSegments: string[]) {
    const scope = globalThis as typeof globalThis & {
      __langshiftPageState?: {
        pending: Map<string, any>;
        history: any[];
      };
    };
    const state = scope.__langshiftPageState;
    const pending = state?.pending.get(token);

    if (!state || !pending) {
      return { success: false, message: "The saved selection expired. Please select the text again." };
    }
    state.pending.delete(token);

    if (pending.kind === "input") {
      if (translatedSegments.length !== pending.segmentCount || pending.element.value !== pending.beforeValue) {
        return { success: false, message: "The input changed before translation finished. Please try again." };
      }

      const translatedText = translatedSegments.join("");
      const afterValue =
        pending.beforeValue.slice(0, pending.start) +
        translatedText +
        pending.beforeValue.slice(pending.end);
      pending.element.value = afterValue;
      pending.element.selectionStart = pending.element.selectionEnd = pending.start + translatedText.length;
      pending.element.dispatchEvent(new Event("input", { bubbles: true }));
      state.history.push({
        kind: "input",
        element: pending.element,
        beforeValue: pending.beforeValue,
        afterValue,
        start: pending.start,
        end: pending.end,
      });
    } else {
      if (translatedSegments.length !== pending.parts.length) {
        return { success: false, message: "The translation segment count did not match the page structure." };
      }

      for (const part of pending.parts) {
        if (!part.node.isConnected || part.node.data.slice(part.start, part.end) !== part.originalText) {
          return { success: false, message: "The page changed before translation finished. Please select the text again." };
        }
      }

      const groupedParts = new Map<Text, Array<{ part: any; translatedText: string }>>();
      pending.parts.forEach((part: any, index: number) => {
        const group = groupedParts.get(part.node) || [];
        group.push({ part, translatedText: translatedSegments[index] });
        groupedParts.set(part.node, group);
      });

      const changes: Array<{ node: Text; before: string; after: string }> = [];
      for (const [node, group] of groupedParts.entries()) {
        const before = node.data;
        let after = before;
        group.sort((left, right) => right.part.start - left.part.start);
        for (const item of group) {
          after =
            after.slice(0, item.part.start) +
            item.translatedText +
            after.slice(item.part.end);
        }
        node.data = after;
        changes.push({ node, before, after });
      }

      window.getSelection()?.removeAllRanges();
      pending.editable?.dispatchEvent(new Event("input", { bubbles: true }));
      state.history.push({ kind: "dom", changes, editable: pending.editable });
    }

    if (state.history.length > 20) state.history.shift();
    return { success: true };
  }

function undoLastTranslation() {
    const scope = globalThis as typeof globalThis & {
      __langshiftPageState?: {
        pending: Map<string, any>;
        history: any[];
      };
    };
    const state = scope.__langshiftPageState;
    const historyEntry = state?.history.pop();

    if (!state || !historyEntry) {
      return { success: false, message: "There is no translation to undo on this page." };
    }

    if (historyEntry.kind === "input") {
      if (!historyEntry.element.isConnected || historyEntry.element.value !== historyEntry.afterValue) {
        state.history.push(historyEntry);
        return { success: false, message: "The input changed after translation, so undo was cancelled to protect your edits." };
      }

      historyEntry.element.value = historyEntry.beforeValue;
      historyEntry.element.focus({ preventScroll: true });
      historyEntry.element.setSelectionRange(historyEntry.start, historyEntry.end);
      historyEntry.element.dispatchEvent(new Event("input", { bubbles: true }));
      return { success: true };
    }

    const hasChanged = historyEntry.changes.some(
      (change: any) => !change.node.isConnected || change.node.data !== change.after,
    );
    if (hasChanged) {
      state.history.push(historyEntry);
      return { success: false, message: "The page changed after translation, so undo was cancelled to protect the current content." };
    }

    historyEntry.changes.forEach((change: any) => {
      change.node.data = change.before;
    });
    historyEntry.editable?.dispatchEvent(new Event("input", { bubbles: true }));
    return { success: true };
  }
  

