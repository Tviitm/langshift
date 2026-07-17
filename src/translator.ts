import { Constants } from './constants.js';

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

    async translateSegments(segments: string[], targetLang: string, model: string): Promise<string[] | null> {
        const translatedSegments: string[] = [];
        for (const segment of segments) {
            const translated = await this.translate(segment, targetLang, model);
            if (translated === null) return null;
            translatedSegments.push(translated);
        }
        return translatedSegments;
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
        const result = await this.translateSegments([text], targetLang, model);
        return result?.[0] ?? null;
    }

    async translateSegments(segments: string[], targetLang: string, model: string): Promise<string[] | null> {
        const apiUrl = 'https://api.deepseek.com/chat/completions';
        const { deepseek_api_key: apiKey } = await chrome.storage.sync.get(Constants.DEEPSEEK_API_KEY);

        if (!apiKey) {
            console.warn('No DeepSeek API key found.');
            return null;
        }

        try {
            const preparedSegments = segments.map((segment) => {
                const leadingWhitespace = segment.match(/^\s*/)?.[0] || '';
                const trailingWhitespace = segment.match(/\s*$/)?.[0] || '';
                const coreEnd = segment.length - trailingWhitespace.length;
                return {
                    original: segment,
                    leadingWhitespace,
                    trailingWhitespace,
                    core: segment.slice(leadingWhitespace.length, Math.max(leadingWhitespace.length, coreEnd)),
                };
            });
            const results = new Array<string>(segments.length);
            const translatableIndexes = preparedSegments
                .map((segment, index) => segment.core ? index : -1)
                .filter((index) => index >= 0);

            preparedSegments.forEach((segment, index) => {
                if (!segment.core) results[index] = segment.original;
            });

            const batches: number[][] = [];
            let currentBatch: number[] = [];
            let currentLength = 0;

            for (const index of translatableIndexes) {
                const segmentLength = preparedSegments[index].core.length;
                if (currentBatch.length > 0 && (currentBatch.length >= 50 || currentLength + segmentLength > 6000)) {
                    batches.push(currentBatch);
                    currentBatch = [];
                    currentLength = 0;
                }
                currentBatch.push(index);
                currentLength += segmentLength;
            }
            if (currentBatch.length > 0) batches.push(currentBatch);

            for (const batchIndexes of batches) {
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
                                content: `Translate every string in the JSON segments array into ${targetLang}. Use neighboring segments for context, but keep the same number and order of items. Return valid JSON exactly in this form: {"translations":["translated segment 1","translated segment 2"]}. Do not return Markdown, HTML, explanations, or extra keys.`,
                            },
                            {
                                role: 'user',
                                content: JSON.stringify({
                                    segments: batchIndexes.map((index) => preparedSegments[index].core),
                                }),
                            },
                        ],
                        response_format: { type: 'json_object' },
                        stream: false,
                        thinking: { type: 'disabled' },
                        max_tokens: 8192,
                    }),
                });

                const data = await response.json();
                if (!response.ok) {
                    console.error('DeepSeek translation failed:', data);
                    return null;
                }

                const content = data.choices?.[0]?.message?.content;
                if (typeof content !== 'string' || !content.trim()) {
                    console.error('DeepSeek returned an empty JSON response.');
                    return null;
                }

                let parsed: unknown;
                try {
                    parsed = JSON.parse(content);
                } catch (error) {
                    console.error('DeepSeek returned invalid JSON:', error, content);
                    return null;
                }

                const translations = (parsed as { translations?: unknown }).translations;
                if (!Array.isArray(translations) ||
                    translations.length !== batchIndexes.length ||
                    translations.some((translation) => typeof translation !== 'string')) {
                    console.error('DeepSeek returned a translation array that does not match the requested segments:', parsed);
                    return null;
                }

                batchIndexes.forEach((index, batchIndex) => {
                    const prepared = preparedSegments[index];
                    results[index] =
                        prepared.leadingWhitespace +
                        (translations[batchIndex] as string).trim() +
                        prepared.trailingWhitespace;
                });
            }

            return results.every((result) => typeof result === 'string') ? results : null;
        } catch (error) {
            console.error('DeepSeek translation failed:', error);
            return null;
        }
    }
}
