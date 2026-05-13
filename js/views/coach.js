import { el, todayISO, toast } from '../utils.js';
import * as DB from '../db.js';
import { getCtx } from '../state.js';
import { answer as ruleAnswer } from '../coach/rules.js';
import { askClaude } from '../coach/claude.js';

const QUICK_PROMPTS = [
  "What should I eat now?",
  "I'm hungry — healthy snack?",
  "I cheated today, what now?",
  "Plan tomorrow's meals",
  "Why am I not losing weight?",
  "Workout for today",
  "Am I getting enough protein?"
];

export async function renderCoach(root) {
  root.innerHTML = '';
  document.getElementById('topbar-sub').textContent = 'Coach';
  const ctx = getCtx();
  const hasKey = !!ctx.profile.anthropic_api_key;

  const quickWrap = el('div', { class: 'chat-quick' });
  for (const p of QUICK_PROMPTS) {
    quickWrap.appendChild(el('button', { onClick: () => send(p) }, p));
  }
  root.appendChild(quickWrap);

  if (!hasKey) {
    root.appendChild(el('div', { class: 'install-banner' },
      'Tip: add your Anthropic API key in Settings to get full AI coaching. Otherwise I\'ll use built-in rules.'));
  }

  const messagesWrap = el('div', { class: 'chat-messages', id: 'chat-messages' });
  root.appendChild(messagesWrap);

  const inputBar = el('div', { class: 'chat-input-wrap' });
  const input = el('input', { type: 'text', placeholder: 'Ask FitCoach…', class: 'search-input' });
  const sendBtn = el('button', { class: 'btn btn-primary', onClick: () => {
    const v = input.value.trim(); if (v) send(v);
  }}, 'Send');
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const v = input.value.trim(); if (v) send(v); }
  });
  inputBar.appendChild(input);
  inputBar.appendChild(sendBtn);
  root.appendChild(inputBar);

  // load history
  const history = await DB.getChatHistory(50);
  for (const m of history) appendMsg(messagesWrap, m.role, m.content);

  if (!history.length) {
    appendMsg(messagesWrap, 'assistant',
      `Hi Sabhya — I'm your FitCoach. Ask me what to eat, how to course-correct, or to plan tomorrow's meals. Tap a quick prompt above to get started.`);
  }

  scrollToBottom();

  async function send(text) {
    input.value = '';
    appendMsg(messagesWrap, 'user', text);
    await DB.saveChatMessage({ date: todayISO(), role: 'user', content: text });
    scrollToBottom();

    const thinking = el('div', { class: 'chat-bubble assistant' }, 'Thinking…');
    messagesWrap.appendChild(thinking);
    scrollToBottom();

    let reply;
    const ctx = getCtx();
    if (ctx.profile.anthropic_api_key) {
      try {
        const hist = await DB.getChatHistory(20);
        reply = await askClaude(
          ctx.profile.anthropic_api_key,
          ctx.profile.ai_model || 'claude-sonnet-4-5',
          text,
          hist.slice(0, -1)  // exclude the just-added user msg
        );
      } catch (e) {
        console.error(e);
        reply = `API error: ${e.message}. Falling back to local rules:\n\n` + await ruleAnswer(text);
      }
    } else {
      reply = await ruleAnswer(text);
    }
    thinking.remove();
    appendMsg(messagesWrap, 'assistant', reply);
    await DB.saveChatMessage({ date: todayISO(), role: 'assistant', content: reply });
    scrollToBottom();
  }
}

function appendMsg(wrap, role, text) {
  const b = el('div', { class: `chat-bubble ${role}` }, text);
  wrap.appendChild(b);
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  });
}
