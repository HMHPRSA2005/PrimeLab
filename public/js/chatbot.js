(function () {
  const STATE_KEY = "chatbot";
  const MAX_MESSAGES = 12;

  if (document.querySelector("[data-chatbot-root]")) return;

  const root = document.createElement("section");
  root.className = "pl-chatbot";
  root.dataset.chatbotRoot = "true";
  root.innerHTML = `
    <button class="pl-chatbot__bubble" type="button" aria-label="Mở PET">
      <span>PET</span>
    </button>
    <div class="pl-chatbot__panel">
      <header class="pl-chatbot__header">
        <div>
          <strong>PET</strong>
          <small>Số nguyên tố lớn & RSA</small>
        </div>
        <button class="pl-chatbot__close" type="button" aria-label="Đóng">×</button>
      </header>
      <div class="pl-chatbot__messages" role="log" aria-live="polite"></div>
      <form class="pl-chatbot__form">
        <textarea name="message" rows="2" placeholder="Hỏi về Miller-Rabin, RSA, khóa công khai..."></textarea>
        <button type="submit">Gửi</button>
      </form>
    </div>
  `;

  document.body.appendChild(root);

  const bubble = root.querySelector(".pl-chatbot__bubble");
  const panel = root.querySelector(".pl-chatbot__panel");
  const closeButton = root.querySelector(".pl-chatbot__close");
  const messagesNode = root.querySelector(".pl-chatbot__messages");
  const form = root.querySelector(".pl-chatbot__form");
  const input = form.elements.message;
  let messages = loadMessages();

  if (messages.length === 0) {
    messages = [{
      role: "assistant",
      content: "Chào bạn, mình là PET. Mình có thể giải thích nhanh về số nguyên tố lớn, Miller-Rabin và RSA trong PrimeLab.",
    }];
  }

  renderMessages();

  bubble.addEventListener("click", () => {
    togglePanel(!root.classList.contains("pl-chatbot--open"));
  });

  closeButton.addEventListener("click", () => {
    togglePanel(false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      togglePanel(false);
    }
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const content = input.value.trim();
    if (!content) return;

    input.value = "";
    addMessage("user", content);
    const pendingId = addMessage("assistant", "Đang suy nghĩ...");
    setFormEnabled(false);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: messages.filter((message) => !message.pending) }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || `Chat API lỗi ${response.status}`);
      }

      updateMessage(pendingId, payload.reply || "Mình chưa có câu trả lời phù hợp.");
    } catch (error) {
      updateMessage(pendingId, `Không gửi được câu hỏi: ${error.message}`);
    } finally {
      setFormEnabled(true);
      input.focus();
    }
  });

  function addMessage(role, content) {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    messages.push({ id, role, content, pending: content === "Đang suy nghĩ..." });
    trimMessages();
    saveMessages();
    renderMessages();
    return id;
  }

  function togglePanel(isOpen) {
    root.classList.toggle("pl-chatbot--open", isOpen);
    bubble.setAttribute("aria-expanded", String(isOpen));
    if (isOpen) {
      input.focus();
      messagesNode.scrollTop = messagesNode.scrollHeight;
    }
  }

  function updateMessage(id, content) {
    const message = messages.find((item) => item.id === id);
    if (!message) return;
    message.content = content;
    message.pending = false;
    saveMessages();
    renderMessages();
  }

  function trimMessages() {
    if (messages.length > MAX_MESSAGES) {
      messages = messages.slice(-MAX_MESSAGES);
    }
  }

  function renderMessages() {
    messagesNode.innerHTML = messages.map((message) => `
      <article class="pl-chatbot__message pl-chatbot__message--${message.role}">
        ${renderMarkdown(message.content)}
      </article>
    `).join("");
    messagesNode.scrollTop = messagesNode.scrollHeight;
  }

  function renderMarkdown(markdown) {
    const escaped = escapeHTML(normalizeMathMarkdown(markdown));
    return escaped
      .replace(/```([\s\S]*?)```/g, "<pre><code>$1</code></pre>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\n/g, "<br>");
  }

  function normalizeMathMarkdown(value) {
    return String(value || "")
      .replace(/\$\$([\s\S]*?)\$\$/g, "$1")
      .replace(/\$([^$\n]+)\$/g, "$1")
      .replace(/\\\(([\s\S]*?)\\\)/g, "$1")
      .replace(/\\\[([\s\S]*?)\\\]/g, "$1")
      .replace(/\\pmod\s*\{?([^{}\n]+)\}?/g, "mod $1")
      .replace(/\\mod\s*\{?([^{}\n]+)\}?/g, "mod $1")
      .replace(/\\cdot/g, "*")
      .replace(/\\times/g, "*")
      .replace(/\\phi/g, "phi")
      .replace(/\\varphi/g, "phi")
      .replace(/\\equiv/g, "=")
      .replace(/\\gcd/g, "gcd")
      .replace(/\\text\{([^{}]+)\}/g, "$1")
      .replace(/[{}]/g, "");
  }

  function escapeHTML(value) {
    return String(value || "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[char]));
  }

  function setFormEnabled(isEnabled) {
    input.disabled = !isEnabled;
    form.querySelector("button").disabled = !isEnabled;
  }

  function loadMessages() {
    const savedState = window.PrimeLab?.loadState?.(STATE_KEY);
    return Array.isArray(savedState?.messages) ? savedState.messages : [];
  }

  function saveMessages() {
    const serializableMessages = messages
      .filter((message) => !message.pending)
      .map(({ role, content }) => ({ role, content }));
    window.PrimeLab?.saveState?.(STATE_KEY, { messages: serializableMessages });
  }
})();
