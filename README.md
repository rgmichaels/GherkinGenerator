# Test Authoring Helper (Gherkin)

## Usage
1. Build the extension: `npm install` then `npm run build`.
2. Open Chrome and go to `chrome://extensions`.
3. Enable **Developer mode** (top right).
4. Click **Load unpacked**.
5. Select the `dist/` folder at `/Users/robertmichaels/Documents/code/testbrowserextension/dist`.
6. Navigate to an allowed domain (example: `https://robjmichaels.com`).
7. Right-click any element on the page and choose **Generate test step… → Assert visible**.
8. The overlay shows a Cucumber editor. Edit the text, use the keyword bar, and click **Copy**.

## Jira Integration
1. Open the extension settings: `chrome://extensions` → **Details** → **Extension options**.
2. Enter your Jira base URL, email, and API token.
3. Add site → project mappings (one per line, e.g. `exquisitepets.shop=KAN`).
4. In the overlay, select a project and click **Create Jira Ticket**.

## AI Scenario Generation (Local)
1. Install server dependencies (if not done): `npm install`.
2. Build the extension: `npm run build`.
3. Set your API key: `export OPENAI_API_KEY="..."`.
4. Start the local server: `npm run ai:server`.
5. In extension options, set **AI Server URL** to `http://localhost:8787`.
6. Use **Generate with AI** in the overlay to create a full Scenario.

## AI Server (Docker)
1. Set your API key in the environment: `export OPENAI_API_KEY="..."`.
2. Optional model override: `export OPENAI_MODEL="gpt-4o-mini"`.
3. Run: `docker compose up --build`.
4. The service will appear as `openai-server` in Docker.
5. In extension options, set **AI Server URL** to `http://localhost:8787`.

## Allowed Domains
- `robjmichaels.com`
- `hardmileoutfitters.com`
- `exquisitepets.shop`
- `localhost:3000`
