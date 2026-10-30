const form = document.getElementById('chat-form');
const input = document.getElementById('user-input');
const chatBox = document.getElementById('chat-box');

// Conversation history sent to the backend: [{ role: 'user' | 'model', text: string }]
let conversation = [];

form.addEventListener('submit', async function (e) {
  e.preventDefault();

  const userMessage = input.value.trim();
  if (!userMessage) return;

  appendMessage('user', userMessage);
  input.value = '';

  // Show a temporary "Thinking..." bot message
  const thinkingBubble = appendMessage('bot', 'Thinking...');
  thinkingBubble.classList.add('thinking');

  // Disable the button while waiting to prevent duplicate requests
  const button = form.querySelector('button');
  button.disabled = true;

  // Track the user message so we can roll it back if the request fails
  conversation.push({ role: 'user', text: userMessage });

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation })
    });

    if (!response.ok) {
      throw new Error(`Server responded with status ${response.status}`);
    }

    const data = await response.json();

    if (data && typeof data.result === 'string' && data.result.trim() !== '') {
      // Render the AI reply with readable formatting (headings, lists, code, line breaks)
      thinkingBubble.innerHTML = formatMessage(data.result);
      // Only keep successful exchanges in the conversation history
      conversation.push({ role: 'model', text: data.result });
    } else {
      // No result received — roll back the dangling user message
      conversation.pop();
      thinkingBubble.textContent = 'Sorry, no response received.';
    }
  } catch (error) {
    // Network failure or non-OK response — roll back the dangling user message
    conversation.pop();
    thinkingBubble.textContent = 'Failed to get response from server.';
    console.error('Chat request failed:', error);
  } finally {
    thinkingBubble.classList.remove('thinking');
    button.disabled = false;
    input.focus();
    scrollToBottom();
  }
});

function appendMessage(sender, text) {
  const msg = document.createElement('div');
  msg.classList.add('message', sender);
  msg.textContent = text; // textContent prevents XSS from injected content
  chatBox.appendChild(msg);
  scrollToBottom();
  return msg;
}

function scrollToBottom() {
  chatBox.scrollTop = chatBox.scrollHeight;
}

/* ---------------------------------------------------------------
 * Lightweight, XSS-safe formatter for AI replies.
 * Supports: line breaks, **bold**, *italic*, `inline code`,
 * ```code blocks```, # headings, - bullets and 1. numbered lists.
 * Everything is HTML-escaped BEFORE any tags are generated.
 * ------------------------------------------------------------- */

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatMessage(text) {
  // 1. Escape ALL raw text first — nothing the model returns reaches innerHTML unescaped
  let html = escapeHtml(text.trim());

  // 2. Fenced code blocks: ```lang ... ``` (content stays exactly as-is)
  html = html.replace(/```[\w-]*\n?([\s\S]*?)```/g, (match, code) => {
    return `<pre><code>${code.replace(/\n+$/, '')}</code></pre>`;
  });

  // 3. Format everything OUTSIDE the code blocks, then stitch back together
  return html
    .split(/(<pre><code>[\s\S]*?<\/code><\/pre>)/g)
    .map((part) =>
      part.startsWith('<pre><code>') ? part : formatBlocks(formatInline(part))
    )
    .join('');
}

function formatInline(text) {
  // Protect inline code spans so * or _ inside `code` are not treated as markdown
  const codeSpans = [];
  let html = text.replace(/`([^`\n]+)`/g, (match, code) => {
    codeSpans.push(code);
    return `\u0000${codeSpans.length - 1}\u0000`;
  });

  html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
  html = html.replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  html = html.replace(/(^|[^_\w])_([^_\n]+)_/g, '$1<em>$2</em>');

  // Restore the protected code spans
  return html.replace(/\u0000(\d+)\u0000/g, (match, index) => {
    return `<code>${codeSpans[Number(index)]}</code>`;
  });
}

function formatBlocks(html) {
  const lines = html.split('\n');
  const output = [];
  let paragraph = [];
  let list = null; // currently open list: 'ul' | 'ol'

  const flushParagraph = () => {
    if (paragraph.length) {
      output.push(`<p>${paragraph.join('<br>')}</p>`);
      paragraph = [];
    }
  };

  const closeList = () => {
    if (list) {
      output.push(`</${list}>`);
      list = null;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      closeList();
      continue;
    }

    // Headings: # ## ###
    const heading = line.match(/^#{1,4}\s+(.+)$/);
    if (heading) {
      flushParagraph();
      closeList();
      output.push(`<h4>${heading[1]}</h4>`);
      continue;
    }

    // Bulleted list: - item | * item | • item
    const bullet = line.match(/^[-*•]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      if (list !== 'ul') {
        closeList();
        output.push('<ul>');
        list = 'ul';
      }
      output.push(`<li>${bullet[1]}</li>`);
      continue;
    }

    // Numbered list: 1. item | 1) item
    const numbered = line.match(/^\d+[.)]\s+(.+)$/);
    if (numbered) {
      flushParagraph();
      if (list !== 'ol') {
        closeList();
        output.push('<ol>');
        list = 'ol';
      }
      output.push(`<li>${numbered[1]}</li>`);
      continue;
    }

    // Regular text line
    closeList();
    paragraph.push(line);
  }

  flushParagraph();
  closeList();
  return output.join('');
}
