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
    });
});

async function translateText(text: string, targetLang: string, provider: string): Promise<string | null> {
    const translator = createTranslator(provider);
    try {
        return await translator.translate(text, targetLang, ''); // Empty string for default model
    } catch (error) {
        console.error(`Translation failed with ${provider}:`, error);
        return null;
    }
}

interface CachedTranslation {
    translatedText: string;
    expiresAt: number;
}

async function getCacheKey(text: string, targetLang: string, provider: string): Promise<string> {
    const data = new TextEncoder().encode(`${provider}:${targetLang}:${text}`);
    const hash = await crypto.subtle.digest('SHA-256', data);
    const hashText = Array.from(new Uint8Array(hash)).map(byte => byte.toString(16).padStart(2, '0')).join('');
    return `${Constants.TRANSLATION_CACHE_PREFIX}${hashText}`;
}

async function getCachedTranslation(cacheKey: string): Promise<string | null> {
    const cached = (await chrome.storage.local.get(cacheKey))[cacheKey] as CachedTranslation | undefined;
    if (!cached) return null;

    if (cached.expiresAt <= Date.now()) {
        await chrome.storage.local.remove(cacheKey);
        return null;
    }

    return cached.translatedText;
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

        const [{ result: selectedText }] = await chrome.scripting.executeScript({
            target: { tabId },
            func: getSelectedText,
        });

        if (!selectedText) {
            await showPageAlert(tabId, "Please select some text before translating.");
            return;
        }

        // Get settings from storage
        const { target_lang: targetLang = "en", ai_provider = "deepseek" } =
            await chrome.storage.sync.get(["target_lang", "ai_provider"]);

        const cacheKey = await getCacheKey(selectedText, targetLang, ai_provider);
        let translatedText = await getCachedTranslation(cacheKey);

        if (!translatedText) {
            translatedText = await translateText(selectedText, targetLang, ai_provider);
            if (translatedText) {
                await chrome.storage.local.set({
                    [cacheKey]: {
                        translatedText,
                        expiresAt: Date.now() + Constants.TRANSLATION_CACHE_TTL_MS,
                    },
                });
            }
        }

        if (!translatedText) {
            await showPageAlert(tabId, "Translation failed. Please check your DeepSeek API key and settings.");
            return;
        }

        // Replace the text on the page
        await chrome.scripting.executeScript({
            target: { tabId },
            args: [translatedText],
            func: replaceSelectedText,
        });
    } catch (error) {
        console.error("Unable to translate the selected text:", error);
        await showPageAlert(tabId, "Translation cannot run on this page. Try a normal website tab.");
    } finally {
        await chrome.action.setBadgeText({ tabId, text: "" }).catch(() => undefined);
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
    }
});
  
function getSelectedText() {
    const active = document.activeElement;
    if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) {
      const input = active as HTMLInputElement | HTMLTextAreaElement;
      if (input.selectionStart !== null && input.selectionEnd !== null) {
        return input.value.substring(input.selectionStart, input.selectionEnd);
      }
    } else {
      return window.getSelection()?.toString().trim();
    }
    return "";
  }  
  
function triggerInputEvent(element: HTMLElement) {
    const event = new Event('input', { bubbles: true });
    element.dispatchEvent(event);
  }
  
function replaceSelectedText(translatedText: string) {
    const active = document.activeElement;
  
    if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) {
      const input = active as HTMLInputElement | HTMLTextAreaElement;
      if (input.selectionStart !== null && input.selectionEnd !== null) {
        const start = input.selectionStart;
        const end = input.selectionEnd;
        input.value = input.value.substring(0, start) + translatedText + input.value.substring(end);
        input.selectionStart = input.selectionEnd = start + translatedText.length;
        triggerInputEvent(input);
      }
    } else if (active && active instanceof HTMLElement && active.isContentEditable) {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        range.deleteContents();
        const textNode = document.createTextNode(translatedText);
        range.insertNode(textNode);

        range.setStartAfter(textNode);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        
        active.dispatchEvent(new Event('input', { bubbles: true }));
      }
    } else {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        range.deleteContents();
        range.insertNode(document.createTextNode(translatedText));
      }
    }
  }
  

