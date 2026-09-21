// src/options/options.js
import { buildJevRequest } from '../lib/jev.js';

const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const JEV_MODEL = 'jev-1.13.0';
const DEFAULT_SESSION_CAP = 200;

const form = document.getElementById('settings-form');
const apiKeyInput = document.getElementById('api-key');
const sessionCapInput = document.getElementById('session-cap');
const testBtn = document.getElementById('test-key-btn');
const status = document.getElementById('status');

async function load() {
  const { jevApiKey, sessionCap } = await chrome.storage.local.get(['jevApiKey', 'sessionCap']);
  apiKeyInput.value = jevApiKey || '';
  sessionCapInput.value = sessionCap || DEFAULT_SESSION_CAP;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const jevApiKey = apiKeyInput.value.trim();
  const sessionCap = Number(sessionCapInput.value) || DEFAULT_SESSION_CAP;
  await chrome.storage.local.set({ jevApiKey, sessionCap, jevKeyInvalid: false });
  status.textContent = 'Saved.';
});

testBtn.addEventListener('click', async () => {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    status.textContent = 'Enter a key first.';
    return;
  }
  status.textContent = 'Testing...';
  try {
    const body = buildJevRequest({
      state: 'ping',
      model: JEV_MODEL,
      questions: {
        ping: {
          type: 'noul',
          instructions: 'Does the state say "ping"?',
          criteria: { true: 'the state is exactly "ping"', false: 'the state is anything else' },
        },
      },
    });
    const response = await fetch(JEV_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (response.status === 401) {
      status.textContent = 'Invalid API key.';
      return;
    }
    if (!response.ok) {
      status.textContent = `Unexpected response: ${response.status}`;
      return;
    }
    status.textContent = 'Key works.';
  } catch (error) {
    status.textContent = `Request failed: ${error.message}`;
  }
});

load();
