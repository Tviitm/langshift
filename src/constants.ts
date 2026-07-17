export class Constants {
    static readonly DEEPSEEK_API_KEY: string = 'deepseek_api_key';
    static readonly OPENAI_API_KEY: string = 'openai_api_key';
    static readonly CLAUDE_API_KEY: string = 'claude_api_key';
    static readonly GEMINI_API_KEY: string = 'gemini_api_key';
    static readonly OPENAI_TRANSLATE_PROMPT: string = 'openai_translate_prompt';
    static readonly CLAUDE_TRANSLATE_PROMPT: string = 'claude_translate_prompt';
    static readonly GEMINI_TRANSLATE_PROMPT: string = 'gemini_translate_prompt';
    static readonly AI_PROVIDER: string = 'ai_provider';
    static readonly TRANSLATION_CACHE_PREFIX: string = 'translation_cache_';
    static readonly TRANSLATION_CACHE_TTL_MS: number = 24 * 60 * 60 * 1000;
}
