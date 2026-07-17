const languages: { [key: string]: string } = {
    "en": "English",
    "fr": "French",
    "es": "Spanish",
    "de": "German",
    "it": "Italian",
    "pt": "Portuguese",
    "nl": "Dutch",
    "ru": "Russian",
    "zh": "Chinese (Simplified)",
    "zh-TW": "Chinese (Traditional)",
    "ja": "Japanese",
    "ko": "Korean",
    "ar": "Arabic",
    "fa": "Persian (Farsi)",
    "hi": "Hindi",
    "tr": "Turkish",
    "el": "Greek",
    "he": "Hebrew",
    "th": "Thai",
    "pl": "Polish",
    "sv": "Swedish",
    "fi": "Finnish",
    "no": "Norwegian",
    "da": "Danish",
    "cs": "Czech",
    "hu": "Hungarian",
    "ro": "Romanian",
    "uk": "Ukrainian",
    "id": "Indonesian",
    "vi": "Vietnamese"
  };
  
  const languageSelect = document.getElementById("languageSelect") as HTMLSelectElement;
  for (const [code, name] of Object.entries(languages)) {
    const option = document.createElement("option");
    option.value = code;
    option.textContent = name;
    languageSelect.appendChild(option);
  }
  
  chrome.storage.sync.get(["deepseek_api_key", "target_lang"], (data) => {
    if (data.deepseek_api_key) {
      (document.getElementById("apiKey") as HTMLInputElement).value = data.deepseek_api_key;
    }
    if (data.target_lang) {
      languageSelect.value = data.target_lang;
    }
  });
  
  document.getElementById("save")?.addEventListener("click", () => {
    const apiKey = (document.getElementById("apiKey") as HTMLInputElement).value.trim();
    const selectedLanguage = languageSelect.value;
  
    chrome.storage.sync.set({ deepseek_api_key: apiKey, target_lang: selectedLanguage, ai_provider: "deepseek" }, () => {
      alert("Settings saved!");
    });
  });
  
  document.getElementById("clear")?.addEventListener("click", () => {
    chrome.storage.sync.remove(["deepseek_api_key", "target_lang", "ai_provider"], () => {
      alert("Settings cleared.");
    });
  });
