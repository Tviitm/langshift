import { Constants } from './constants';

export const AI_PROVIDERS = {
    DEEPSEEK: 'deepseek',
    OPENAI: 'openai',
    CLAUDE: 'claude',
    GEMINI: 'gemini'
} as const;

export function createTranslator(provider: string): Translator {
    switch (provider.toLowerCase()) {
        case AI_PROVIDERS.DEEPSEEK:
            return new DeepSeekTranslator();
        case AI_PROVIDERS.OPENAI:
            return new OpenAITranslator();
        case AI_PROVIDERS.CLAUDE:
            return new ClaudeTranslator();
        case AI_PROVIDERS.GEMINI:
            return new GeminiTranslator();
        default:
            throw new Error(`Unsupported AI provider: ${provider}`);
    }
}

class Translator {
    async translate(text: string, targetLang: string, model: string): Promise<string | null> {
        throw new Error('AI Translate provider not supported.');
    }
}

class OpenAITranslator extends Translator {

    async translate(text: string, targetLang: string, model: string): Promise<string | null> {
        const _apiUrl: string = 'https://api.openai.com/v1/chat/completions';

        const { openai_api_key: apiKey, openai_translate_prompt: storedPrompt } = await chrome.storage.sync.get([Constants.OPENAI_API_KEY, Constants.OPENAI_TRANSLATE_PROMPT]);
        if(!apiKey) {
            console.warn('⚠️ No OpenAI API key found.');
            return null;
        }

        const prompt = storedPrompt?.replace('${targetLang}', targetLang).replace('${text}', text) || 
            `Translate the following text to ${targetLang}: \"${text}\"`;

        try {
            const response = await fetch(_apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    model: model || 'gpt-4',
                    messages: [{ role: 'system', content: prompt }]
                }),
            });

            const data = await response.json();

            return data.choices?.[0]?.message?.content?.trim() || "⚠️ Translation failed.";
        } catch(error) {
            console.error("OpenAI Translation failed:", error);
            return null;
        }
    }
}

class ClaudeTranslator extends Translator {

    async translate(text: string, targetLang: string, model: string): Promise<string | null> {
        const _apiUrl = 'https://api.anthropic.com/v1/messages';

        const { claude_api_key: apiKey, claude_translate_prompt: storedPrompt } = await chrome.storage.sync.get([Constants.CLAUDE_API_KEY, Constants.CLAUDE_TRANSLATE_PROMPT]);
        if(!apiKey) {
            console.warn('⚠️ No Claude API key found.');
            return null;
        }

        const prompt = storedPrompt?.replace('${targetLang}', targetLang).replace('${text}', text) || 
            `Translate the following text to ${targetLang}: \"${text}\"`;

        try {
            const response = await fetch(_apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01'
                },
                body: JSON.stringify({
                    model: model || "claude-2",
                    messages: [{ role: "user", content: prompt }],
                }),
            });

            const data = await response.json();

            return data.content?.[0]?.text?.trim() || "⚠️ Translation failed.";
        } catch(error) {
            console.error("Claude Translation failed:", error);
            return null;
        }
    }
}

class GeminiTranslator extends Translator {

    async translate(text: string, targetLang: string, model: string): Promise<string | null> {
        const { gemini_api_key: apiKey, gemini_translate_prompt: storedPrompt } = await chrome.storage.sync.get([Constants.GEMINI_API_KEY, Constants.GEMINI_TRANSLATE_PROMPT]);

        if(!apiKey) {
            console.warn('⚠️ No Gemini API key found.');
            return null;
        }

        const _apiUrl = 'https://generativelanguage.googleapis.com/v1/models/' + (model || 'gemini-pro') + ":generateText?key=" + apiKey;
        const prompt = storedPrompt?.replace('${targetLang}', targetLang).replace('${text}', text) || 
            `Translate the following text to ${targetLang}: \"${text}\"`;

        try {
            const response = await fetch(_apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    prompt: { text: prompt },
                }),
            });

            const data = await response.json();

            return data.candidates?.[0]?.output?.trim() || "⚠️ Translation failed.";
        } catch(error) {
            console.error("Gemini Translation failed:", error);
            return null;
        }
    }
}

class DeepSeekTranslator extends Translator {
    async translate(text: string, targetLang: string, model: string): Promise<string | null> {
        const apiUrl = 'https://api.deepseek.com/chat/completions';
        const { deepseek_api_key: apiKey } = await chrome.storage.sync.get(Constants.DEEPSEEK_API_KEY);

        if (!apiKey) {
            console.warn('No DeepSeek API key found.');
            return null;
        }

        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    model: model || 'deepseek-v4-flash',
                    messages: [
                        {
                            role: 'system',
                            content: `Translate the user's text into ${targetLang}. Return only the translation, with no explanation.`,
                        },
                        { role: 'user', content: text },
                    ],
                    stream: false,
                    thinking: { type: 'disabled' },
                }),
            });

            const data = await response.json();
            if (!response.ok) {
                console.error('DeepSeek translation failed:', data);
                return null;
            }

            return data.choices?.[0]?.message?.content?.trim() || null;
        } catch (error) {
            console.error('DeepSeek translation failed:', error);
            return null;
        }
    }
}
