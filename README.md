# Test Authoring Helper (Gherkin)

## Usage
1. Build the extension: `npm install` then `npm run build`.
2. Open Chrome and go to `chrome://extensions`.
3. Enable **Developer mode** (top right).
4. Click **Load unpacked**.
5. Select the `dist/` folder at `/Users/robertmichaels/Documents/code/testbrowserextension/dist`.
6. Navigate to an allowed domain (example: `https://robjmichaels.com`).
7. Right-click any element on the page and choose **Generate test step… → Assert visible**.
8. Paste from clipboard into your test file; it contains:
   - Gherkin line
   - YAML-ish mapping entry
   - Generic Cucumber step-def stub
   - Warnings

## Allowed Domains
- `robjmichaels.com`
- `hardmileoutfitters.com`
- `exquisitepets.shop`
- `localhost:3000`
