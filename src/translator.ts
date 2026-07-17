import { Constants } from './constants.js';

export const AI_PROVIDERS = {
    DEEPSEEK: 'deepseek',
    OPENAI: 'openai',
    CLAUDE: 'claude',
    GEMINI: 'gemini'
} as const;

class DeepSeekRequestError extends Error {
    constructor(
        message: string,
        readonly retryable: boolean = false,
        readonly splittable: boolean = false,
    ) {
        super(message);
        this.name = 'DeepSeekRequestError';
    }
}

interface TranslationContext {
    before: string;
    after: string;
}

interface PreparedSegment {
    original: string;
    leadingWhitespace: string;
    trailingWhitespace: string;
    core: string;
}

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
    protected lastErrorMessage: string | null = null;

    async translate(text: string, targetLang: string, model: string): Promise<string | null> {
        throw new Error('AI Translate provider not supported.');
    }

    async translateSegments(segments: string[], targetLang: string, model: string): Promise<string[] | null> {
        const translatedSegments: string[] = [];
        for (const segment of segments) {
            const translated = await this.translate(segment, targetLang, model);
            if (translated === null) {
                this.lastErrorMessage ||= 'The translation provider did not return a result.';
                return null;
            }
            translatedSegments.push(translated);
        }
        return translatedSegments;
    }

    getLastError(): string | null {
        return this.lastErrorMessage;
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
    private readonly apiUrl = 'https://api.deepseek.com/chat/completions';
    private readonly maxBatchCharacters = 3000;
    private readonly maxBatchSegments = 64;
    private readonly maxConcurrentBatches = 6;
    private readonly contextCharacters = 240;

    async translate(text: string, targetLang: string, model: string): Promise<string | null> {
        const result = await this.translateSegments([text], targetLang, model);
        return result?.[0] ?? null;
    }

    async translateSegments(segments: string[], targetLang: string, model: string): Promise<string[] | null> {
        this.lastErrorMessage = null;
        const { deepseek_api_key: apiKey } = await chrome.storage.sync.get(Constants.DEEPSEEK_API_KEY);

        if (!apiKey) {
            console.warn('No DeepSeek API key found.');
            this.lastErrorMessage = 'No DeepSeek API key is configured. Open the extension options and save your API key.';
            return null;
        }

        try {
            const preparedSegments: PreparedSegment[] = segments.map((segment) => {
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
                if (currentBatch.length > 0 &&
                    (currentBatch.length >= this.maxBatchSegments ||
                        currentLength + segmentLength > this.maxBatchCharacters)) {
                    batches.push(currentBatch);
                    currentBatch = [];
                    currentLength = 0;
                }
                currentBatch.push(index);
                currentLength += segmentLength;
            }
            if (currentBatch.length > 0) batches.push(currentBatch);

            const translatedBatches = new Array<string[]>(batches.length);
            let nextBatch = 0;
            let workerFailure: DeepSeekRequestError | null = null;
            const workerCount = Math.min(this.maxConcurrentBatches, batches.length);
            const workers = Array.from({ length: workerCount }, async () => {
                while (!workerFailure) {
                    const batchPosition = nextBatch++;
                    if (batchPosition >= batches.length) return;
                    const batchIndexes = batches[batchPosition];

                    try {
                        translatedBatches[batchPosition] = await this.translateWithRecovery(
                            batchIndexes.map((index) => preparedSegments[index].core),
                            targetLang,
                            model || 'deepseek-v4-flash',
                            apiKey,
                            this.getBatchContext(batches, batchPosition, preparedSegments),
                        );
                    } catch (error) {
                        workerFailure = this.normalizeError(error);
                    }
                }
            });
            await Promise.all(workers);

            const finalFailure = workerFailure as DeepSeekRequestError | null;
            if (finalFailure) {
                this.lastErrorMessage = finalFailure.message;
                console.error('DeepSeek translation failed:', finalFailure);
                return null;
            }

            batches.forEach((batchIndexes, batchPosition) => {
                const translations = translatedBatches[batchPosition];
                batchIndexes.forEach((index, batchIndex) => {
                    const prepared = preparedSegments[index];
                    results[index] =
                        prepared.leadingWhitespace +
                        translations[batchIndex].trim() +
                        prepared.trailingWhitespace;
                });
            });

            return results.every((result) => typeof result === 'string') ? results : null;
        } catch (error) {
            console.error('DeepSeek translation failed:', error);
            this.lastErrorMessage = this.normalizeError(error).message;
            return null;
        }
    }

    private async translateWithRecovery(
        texts: string[],
        targetLang: string,
        model: string,
        apiKey: string,
        context: TranslationContext,
        depth: number = 0,
    ): Promise<string[]> {
        try {
            return await this.requestWithRetries(texts, targetLang, model, apiKey, context);
        } catch (error) {
            const failure = this.normalizeError(error);
            if (!failure.splittable || depth >= 8) throw failure;

            if (texts.length > 1) {
                const midpoint = Math.ceil(texts.length / 2);
                const leftTexts = texts.slice(0, midpoint);
                const rightTexts = texts.slice(midpoint);
                const leftContext: TranslationContext = {
                    before: context.before,
                    after: this.limitContext(rightTexts.join('') + context.after, 'start'),
                };
                const rightContext: TranslationContext = {
                    before: this.limitContext(context.before + leftTexts.join(''), 'end'),
                    after: context.after,
                };
                const left = await this.translateWithRecovery(leftTexts, targetLang, model, apiKey, leftContext, depth + 1);
                const right = await this.translateWithRecovery(rightTexts, targetLang, model, apiKey, rightContext, depth + 1);
                return [...left, ...right];
            }

            const split = this.splitSingleText(texts[0]);
            if (!split) throw failure;

            const left = await this.translateWithRecovery(
                [split.left],
                targetLang,
                model,
                apiKey,
                {
                    before: context.before,
                    after: this.limitContext(split.right + context.after, 'start'),
                },
                depth + 1,
            );
            const right = await this.translateWithRecovery(
                [split.right],
                targetLang,
                model,
                apiKey,
                {
                    before: this.limitContext(context.before + split.left, 'end'),
                    after: context.after,
                },
                depth + 1,
            );
            return [
                left[0].replace(/\s+$/, '') +
                split.separator +
                right[0].replace(/^\s+/, ''),
            ];
        }
    }

    private async requestWithRetries(
        texts: string[],
        targetLang: string,
        model: string,
        apiKey: string,
        context: TranslationContext,
    ): Promise<string[]> {
        let lastFailure: DeepSeekRequestError | null = null;

        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                return await this.requestBatch(texts, targetLang, model, apiKey, context, attempt);
            } catch (error) {
                lastFailure = this.normalizeError(error);
                if (!lastFailure.retryable || attempt === 2 || (lastFailure.splittable && attempt >= 1)) {
                    throw lastFailure;
                }
                await this.delay(Math.min(5000, 700 * Math.pow(2, attempt)));
            }
        }

        throw lastFailure || new DeepSeekRequestError('DeepSeek did not return a translation.');
    }

    private async requestBatch(
        texts: string[],
        targetLang: string,
        model: string,
        apiKey: string,
        context: TranslationContext,
        attempt: number,
    ): Promise<string[]> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 90000);
        let response: Response;

        try {
            response = await fetch(this.apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    model,
                    messages: [
                        {
                            role: 'system',
                            content: `You are a professional translator. Translate the ordered segments naturally and accurately into ${targetLang}, treating them as one continuous document. Preserve meaning, tone, terminology, names, numbers, URLs, code, and punctuation. Context fields are reference only; do not translate or return them. Return exactly one non-empty translation per segment, in the same order. Output valid JSON only: {"translations":["..."]}.${attempt > 0 ? ' Retry: return the complete JSON immediately.' : ''}`,
                        },
                        {
                            role: 'user',
                            content: JSON.stringify({
                                ...(context.before ? { context_before: context.before } : {}),
                                segments: texts,
                                ...(context.after ? { context_after: context.after } : {}),
                            }),
                        },
                    ],
                    response_format: { type: 'json_object' },
                    stream: false,
                    thinking: { type: 'disabled' },
                    max_tokens: 8192,
                }),
                signal: controller.signal,
            });
        } catch (error) {
            const isTimeout = error instanceof DOMException && error.name === 'AbortError';
            throw new DeepSeekRequestError(
                isTimeout
                    ? 'DeepSeek request timed out. The extension retried automatically; please try again later.'
                    : 'Unable to reach the DeepSeek API. Check your network connection and try again.',
                true,
            );
        } finally {
            clearTimeout(timeout);
        }

        let data: any = null;
        try {
            data = await response.json();
        } catch (error) {
            if (response.ok) {
                throw new DeepSeekRequestError('DeepSeek returned an unreadable response after automatic retries.', true, true);
            }
        }

        if (!response.ok) {
            throw this.createHttpError(response.status, data);
        }

        const choice = data?.choices?.[0];
        if (choice?.finish_reason === 'insufficient_system_resource') {
            throw new DeepSeekRequestError('DeepSeek temporarily lacked inference capacity. The extension retried automatically.', true);
        }
        if (choice?.finish_reason === 'content_filter') {
            throw new DeepSeekRequestError('DeepSeek did not return this translation because the content filter stopped the response.');
        }
        if (choice?.finish_reason === 'length') {
            throw new DeepSeekRequestError('DeepSeek output was truncated because it was too long. The request will be split automatically.', false, true);
        }

        const content = choice?.message?.content;
        if (typeof content !== 'string' || !content.trim()) {
            throw new DeepSeekRequestError('DeepSeek returned an empty JSON response after automatic retries.', true, true);
        }

        const parsed = this.parseJsonObject(content);
        const translations = parsed?.translations;
        if (!Array.isArray(translations) ||
            translations.length !== texts.length ||
            translations.some((translation) => typeof translation !== 'string' || !translation.trim())) {
            throw new DeepSeekRequestError('DeepSeek returned incomplete translation segments after automatic retries.', true, true);
        }

        return translations as string[];
    }

    private createHttpError(status: number, data: any): DeepSeekRequestError {
        const rawMessage = String(data?.error?.message || data?.message || '').replace(/\s+/g, ' ').trim().slice(0, 180);
        const detail = rawMessage ? ` ${rawMessage}` : '';

        if (status === 401) return new DeepSeekRequestError('DeepSeek API key is invalid (401). Update it in the extension options.');
        if (status === 402) return new DeepSeekRequestError('DeepSeek account balance is insufficient (402). Top up the account and try again.');
        if (status === 403) return new DeepSeekRequestError(`DeepSeek denied this request (403).${detail}`);
        if (status === 404) return new DeepSeekRequestError(`DeepSeek model or endpoint was not found (404).${detail}`);
        if (status === 429) return new DeepSeekRequestError('DeepSeek rate limit was reached (429). The extension retried automatically; wait briefly and try again.', true);
        if (status === 500 || status === 503 || status >= 504) {
            return new DeepSeekRequestError(`DeepSeek is temporarily unavailable (${status}). The extension retried automatically; try again later.`, true);
        }

        const tooLarge = status === 413 || ((status === 400 || status === 422) && /context|length|token|too large|maximum/i.test(rawMessage));
        if (tooLarge) {
            return new DeepSeekRequestError(`DeepSeek rejected an oversized request (${status}). The extension will split it automatically.${detail}`, false, true);
        }

        return new DeepSeekRequestError(`DeepSeek API request failed (${status}).${detail}`);
    }

    private parseJsonObject(content: string): { translations?: unknown } | null {
        try {
            return JSON.parse(content) as { translations?: unknown };
        } catch (error) {
            const start = content.indexOf('{');
            const end = content.lastIndexOf('}');
            if (start >= 0 && end > start) {
                try {
                    return JSON.parse(content.slice(start, end + 1)) as { translations?: unknown };
                } catch (nestedError) {
                    return null;
                }
            }
            return null;
        }
    }

    private splitSingleText(text: string): { left: string; separator: string; right: string } | null {
        if (text.length < 400) return null;

        const minimum = Math.floor(text.length * 0.35);
        const maximum = Math.ceil(text.length * 0.65);
        const punctuation = '。！？.!?；;\n';
        let splitAt = -1;

        for (let index = maximum; index >= minimum; index--) {
            if (punctuation.includes(text[index])) {
                splitAt = index + 1;
                break;
            }
        }

        if (splitAt < 0) {
            for (let index = maximum; index >= minimum; index--) {
                if (/\s/.test(text[index])) {
                    splitAt = index;
                    break;
                }
            }
        }

        if (splitAt < 0) splitAt = Math.floor(text.length / 2);
        if (splitAt > 0 && /[\uD800-\uDBFF]/.test(text[splitAt - 1])) splitAt++;

        let rightStart = splitAt;
        while (rightStart < text.length && /\s/.test(text[rightStart])) rightStart++;
        const left = text.slice(0, splitAt);
        const separator = text.slice(splitAt, rightStart);
        const right = text.slice(rightStart);

        return left && right ? { left, separator, right } : null;
    }

    private getBatchContext(
        batches: number[][],
        batchPosition: number,
        segments: PreparedSegment[],
    ): TranslationContext {
        const previous = batchPosition > 0
            ? batches[batchPosition - 1].map((index) => segments[index].original).join('')
            : '';
        const next = batchPosition + 1 < batches.length
            ? batches[batchPosition + 1].map((index) => segments[index].original).join('')
            : '';

        return {
            before: this.limitContext(previous, 'end'),
            after: this.limitContext(next, 'start'),
        };
    }

    private limitContext(text: string, side: 'start' | 'end'): string {
        if (text.length <= this.contextCharacters) return text;
        return side === 'start'
            ? text.slice(0, this.contextCharacters)
            : text.slice(-this.contextCharacters);
    }

    private normalizeError(error: unknown): DeepSeekRequestError {
        return error instanceof DeepSeekRequestError
            ? error
            : new DeepSeekRequestError('Unexpected DeepSeek translation error. Reload the extension and try again.');
    }

    private delay(milliseconds: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, milliseconds));
    }
}
