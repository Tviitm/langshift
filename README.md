# AI LangShift

AI LangShift is an open source Chrome extension that instantly translates user-selected text on any webpage using the DeepSeek API. With a simple keyboard shortcut, the extension retrieves the selected text, sends it for translation, and replaces it directly on the page. Identical translations are cached locally for 24 hours, so repeated translations do not make another API request or consume tokens.

## Features
- **Selected-Text Translation:** Only selected text is sent for translation and replaced in place.
- **Stable Large-Selection Layout:** Splits large selections at text boundaries, translates the segments together for context, and writes each result back to its exact original DOM text node. Fonts, colors, links, emphasis, paragraphs, lists, and CSS layout stay intact.
- **Large-Text Recovery:** Uses smaller API batches, limited parallel requests, automatic retries, and recursive splitting when DeepSeek returns an empty, truncated, oversized, or incomplete response.
- **Faster Response Pipeline:** Combines many small webpage text nodes into fewer requests, processes up to six safe batches concurrently, shares identical in-flight translations across tabs, and updates the page before writing the cache.
- **Cross-Batch Context:** Supplies a small selected-text context window around each batch to keep terminology, tone, and sentence meaning consistent without changing the page structure.
- **Actionable Errors:** Reports authentication, balance, model, rate-limit, server, network, timeout, and response-format problems separately instead of always blaming the API key.
- **Undo Translation:** Right-click anywhere on the same page and choose **Undo last translation** to restore the most recently translated selection. Undo is cancelled if the page content was edited afterward, protecting newer changes.
- **Keyboard and Menu Triggers:** Use `Ctrl+Shift+Y`, click the extension icon, or right-click selected text and choose **Translate selected text**.
- **DeepSeek Support:** Uses DeepSeek's OpenAI-compatible Chat Completions API with the `deepseek-v4-flash` model.
- **Local Translation Cache:** Repeating the same selected text and target language within 24 hours uses a local cached result instead of an API request.
- **Customizable Settings:** Configure your DeepSeek API key and preferred target language via the options page.
- **Wide Compatibility:** Works on standard webpages as well as in input fields and contenteditable elements.
- **Clear Feedback:** The extension reports missing selections, restricted pages, and translation failures instead of silently doing nothing.
- **Open Source:** Fully open source and hosted on GitHub, encouraging community contributions.

![Options Page Screenshot](src/icons/option-shot.png)

## Table of Contents
- [Installation](#installation)
- [Building & Development](#building--development)
- [Testing](#testing)
- [Usage](#usage)
- [Contributing](#contributing) 
- [License](#license)

## Installation
1. Download the latest release ZIP and extract it.
2. Open `chrome://extensions/` in Chrome or Brave and enable **Developer Mode**.
3. Click **Load unpacked** and select the extracted folder that directly contains `manifest.json`.
4. Open the extension's **Details** page, then **Extension options**, and enter your DeepSeek API key.

> Chrome cannot load the ZIP itself as an unpacked extension. Extract it first, then select the folder containing `manifest.json`.

## Building & Development
1. **Clone the Repository:**
   ```bash
   git clone https://github.com/Tviitm/langshift.git
   cd langshift
   ```
2. **Install Dependencies:**
    ```bash
    npm install
    ```
3. **Build the Extension:**
    ```bash
    npm run build
    ```
    This command compiles the TypeScript files and copies static assets (HTML, CSS, manifest, icons) into the `dist` directory.

- **TypeScript Compilation:**
The project is written in TypeScript. To compile the code, run:
    ```bash
    npx tsc
    ```

- **Automatic Build Script:**
The build process includes a script that copies all static assets to the dist folder. Run:

    ```bash
    npm run build
    ```

- **Development Workflow:**
Make changes in the `src` folder and re-run the build script to see your updates reflected in the `dist` directory.

## Testing
1. **Load the Extension Locally:**
    - Open Chrome/Brave and navigate to `chrome://extensions/`.
    - Enable **Developer Mode**.
    - Click "Load unpacked" and select the `dist` folder.
2. **Set your DeepSeek API key:**
    - From the extensions page, click **"Details"** on the AI LangShift extension.
    - Click **"Extension options"** to open the settings page where you can enter your API key and choose your target language.
3. **Verify Functionality:**
    - Open a normal `http://` or `https://` webpage. Chrome internal pages such as `chrome://extensions/` cannot be translated.
    - Select some text.
    - Press the configured shortcut (default is `Ctrl+Shift+Y`). If Chrome has not assigned it, open `chrome://extensions/shortcuts` and set it manually.
    - Alternatively, click the extension icon or right-click the selected text and choose **Translate selected text**.
    - The selected text should be replaced with its translated version.
    - To restore it, right-click the page and choose **Undo last translation**.

## Usage

- **Translate Selected Text:** Select text on a normal webpage, then press `Ctrl+Shift+Y`.
- **Alternative Triggers:** Click the extension icon or use the **Translate selected text** item in the right-click menu.
- **Undo the Last Translation:** Right-click the same page and choose **Undo last translation**. Up to 20 recent translations are kept per page until that page is reloaded or closed.
- **Manage the Shortcut:** Visit `chrome://extensions/shortcuts` to view or change the assigned key combination.
- **Configure Settings:**
Open the extension’s options page to set your DeepSeek API key and target language.

## Contributing
Contributions are welcome! If you have suggestions or improvements, please open an issue or submit a pull request on the GitHub repository.

## License
This project is licensed under the [GPLv3 License](LICENSE).
