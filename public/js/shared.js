(function () {
  const SESSION_KEY = "primelab_session_v3";
  const STATE_PREFIX = "primelab_state_";

  clearLegacyPersistentState();

  async function apiPost(url, data) {
    const headers = { "Content-Type": "application/json" };
    const session = getSession();
    if (session && session.token) {
      headers["Authorization"] = `Bearer ${session.token}`;
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(data),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      // If token expired or invalid, force logout
      if (response.status === 401 && window.location.pathname !== '/login' && window.location.pathname !== '/register') {
         clearSession();
         window.location.href = "/login";
         throw new Error("Phiên đăng nhập hết hạn, vui lòng đăng nhập lại.");
      }
      throw new Error(payload.error || `Request failed with status ${response.status}`);
    }

    return payload;
  }

  // Common fetch GET method to include token
  async function apiGet(url) {
    const headers = {};
    const session = getSession();
    if (session && session.token) {
      headers["Authorization"] = `Bearer ${session.token}`;
    }

    const response = await fetch(url, { method: "GET", headers });
    const contentType = response.headers.get("Content-Type") || "";
    const payload = contentType.includes("application/json")
      ? await response.json().catch(() => ({}))
      : {};

    if (!response.ok || payload.ok === false) {
       if (response.status === 401) {
         clearSession();
         window.location.href = "/login";
       }
       throw new Error(payload.error || `Request failed with status ${response.status}`);
    }
    return payload;
  }
  
  // Common fetch DELETE method to include token
  async function apiDelete(url) {
    const headers = {};
    const session = getSession();
    if (session && session.token) {
      headers["Authorization"] = `Bearer ${session.token}`;
    }

    const response = await fetch(url, { method: "DELETE", headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
       if (response.status === 401) {
         clearSession();
         window.location.href = "/login";
       }
       throw new Error(payload.error || `Request failed with status ${response.status}`);
    }
    return payload;
  }

  function showError(element, message) {
    if (!element) return;
    element.textContent = message || "";
    element.hidden = !message;
  }

  function showLoading(button, isLoading, loadingText = "Đang xử lý...") {
    if (!button) return;
    if (isLoading) {
      button.dataset.originalText = button.textContent;
      button.textContent = loadingText;
      button.disabled = true;
    } else {
      button.textContent = button.dataset.originalText || button.textContent;
      button.disabled = false;
    }
  }

  async function copyToClipboard(text) {
    const value = String(text ?? "");
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return;
    }

    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }

  function formatJson(data) {
    return JSON.stringify(data, null, 2);
  }

  function formatObjectAsKeyValue(data) {
    if (typeof data !== "object" || data === null) {
      return String(data ?? "");
    }
    return Object.entries(data)
      .map(([key, value]) => {
        const displayValue = typeof value === "object" ? JSON.stringify(value) : value;
        return `${key} = ${displayValue}`;
      })
      .join("\n");
  }

  function setSession(email, fullName, token) {
    clearSession();
    const loginSessionId = createLoginSessionId();
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ email, fullName, token, loginSessionId }));
  }

  function getSession() {
    try {
      return JSON.parse(sessionStorage.getItem(SESSION_KEY));
    } catch {
      return null;
    }
  }

  function clearSession() {
    clearCurrentSessionState();
    sessionStorage.removeItem(SESSION_KEY);
  }

  function requireSession() {
    const session = getSession();
    if (!session || !session.email || !session.token || !session.loginSessionId) {
      window.location.href = "/login";
      return null;
    }
    return session;
  }

  function createLoginSessionId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    const randomPart = window.crypto && window.crypto.getRandomValues
      ? Array.from(window.crypto.getRandomValues(new Uint32Array(2)), (value) => value.toString(36)).join("")
      : Math.random().toString(36).slice(2);
    return `${Date.now().toString(36)}_${randomPart}`;
  }

  function getStateKey(key) {
    const session = getSession();
    if (!session || !session.loginSessionId) return null;
    return `${STATE_PREFIX}${session.loginSessionId}_${key}`;
  }

  function clearCurrentSessionState() {
    try {
      const keys = [];
      for (let index = 0; index < sessionStorage.length; index += 1) {
        const key = sessionStorage.key(index);
        if (key && key.startsWith(STATE_PREFIX)) keys.push(key);
      }
      keys.forEach((key) => sessionStorage.removeItem(key));
    } catch {
      // Ignore storage cleanup errors; auth cleanup should still continue.
    }
  }

  function clearLegacyPersistentState() {
    try {
      localStorage.removeItem(SESSION_KEY);
      const keys = [];
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (key && key.startsWith(STATE_PREFIX)) keys.push(key);
      }
      keys.forEach((key) => localStorage.removeItem(key));
    } catch {
      // Ignore unavailable localStorage, for example in strict privacy modes.
    }
  }

  const LANG_KEY = "primelab_lang_v3";

  const translations = {
    vi: {
      nav_overview: "Tổng quan",
      nav_prime_check: "Kiểm tra số nguyên tố",
      nav_prime_search: "Tìm kiếm số nguyên tố",
      nav_rsa_keygen: "Tạo khóa RSA",
      nav_rsa_crypto: "Mã hóa / Giải mã RSA",
      nav_history: "Nhật ký kết quả",
      nav_downloads: "Tải xuống",
      logout: "Đăng xuất",
      login: "Đăng nhập",
      register: "Đăng ký",
      title_overview: "Chào mừng đến với PrimeLab",
      desc_overview: "Hệ thống quản lý và thực nghiệm mật mã học.",
      title_prime_check: "Kiểm tra số nguyên tố",
      desc_prime_check: "Kiểm tra nhanh tính nguyên tố bằng Miller-Rabin nhiều vòng.",
      title_prime_search: "Tìm kiếm số nguyên tố",
      desc_prime_search: "Tạo số nguyên tố lớn và kiểm tra ngay trong hệ thống.",
      title_rsa_keygen: "Khởi tạo khóa RSA",
      desc_rsa_keygen: "Sinh bộ tham số khóa RSA (p, q, n, e, d).",
      title_rsa_crypto: "Mã hóa / Giải mã RSA",
      desc_rsa_crypto: "Thực nghiệm các phép toán mật mã RSA chuyên sâu.",
      title_history: "Nhật ký kết quả",
      desc_history: "Lịch sử chi tiết các lần thực nghiệm.",
      title_downloads: "Tải xuống dữ liệu",
      desc_downloads: "Trích xuất kết quả thực nghiệm từ hệ thống.",
      "hero-title": "Công cụ Kiểm tra và Khởi tạo Số nguyên tố trên Web",
      "hero-desc": "PrimeLab cung cấp giải pháp toàn diện hỗ trợ sàng số nguyên tố nhỏ, thuật toán kiểm tra Miller-Rabin xác suất và khởi tạo số nguyên tố BigInt trực tiếp trên trình duyệt. Tích hợp công cụ tạo khóa và xử lý mật mã RSA chuyên nghiệp.",
      card_prime_check_desc: "Xác định tính nguyên tố của số lớn bằng thuật toán Miller-Rabin với cấu hình linh hoạt.",
      card_prime_search_desc: "Tạo và kiểm tra số nguyên tố lớn cho các bài demo mật mã.",
      card_rsa_keygen_desc: "Khởi tạo bộ tham số khóa RSA đầy đủ phục vụ nhu cầu mô phỏng và nghiên cứu mật mã.",
      card_rsa_crypto_desc: "Thực hiện các thao tác mã hóa và giải mã dữ liệu dựa trên nguyên lý toán học của hệ mật RSA.",
      card_history_desc: "Quản lý và truy xuất lịch sử các hoạt động kiểm tra, tìm kiếm và tác vụ mật mã.",
      card_downloads_desc: "Xuất và lưu trữ kết quả tìm kiếm, các bộ khóa RSA và nhật ký thực nghiệm.",
      pipeline_title: "Quy trình xử lý PrimeLab",
      pipeline_desc: "Hệ thống xử lý trực tiếp bằng JavaScript BigInt và crypto.randomBytes, đảm bảo tính độc lập và bảo mật cao.",
    },
    en: {
      nav_overview: "Overview",
      nav_prime_check: "Prime Check",
      nav_prime_search: "Prime Search",
      nav_rsa_keygen: "RSA Keygen",
      nav_rsa_crypto: "RSA Crypto",
      nav_history: "History Log",
      nav_downloads: "Downloads",
      logout: "Logout",
      login: "Login",
      register: "Register",
      title_overview: "Welcome to PrimeLab",
      desc_overview: "Cryptography management and experimental system.",
      title_prime_check: "Prime Check",
      desc_prime_check: "Quick primality checks with multi-round Miller-Rabin.",
      title_prime_search: "Prime Search",
      desc_prime_search: "Generate large primes and verify them in the system.",
      title_rsa_keygen: "RSA Key Generation",
      desc_rsa_keygen: "Generate RSA key pairs (p, q, n, e, d).",
      title_rsa_crypto: "RSA Encryption / Decryption",
      desc_rsa_crypto: "Perform advanced RSA cryptographic operations.",
      title_history: "History Log",
      desc_history: "Detailed history of cryptography experiments.",
      title_downloads: "Data Downloads",
      desc_downloads: "Export experimental results from the system.",
      "hero-title": "High-Performance Primality Testing & Generation for Web",
      "hero-desc": "PrimeLab provides a comprehensive suite for small prime sieving, Miller-Rabin probabilistic testing, and BigInt candidate generation directly in the browser. Integrated with professional RSA key generation and cryptographic processing.",
      card_prime_check_desc: "Determine the primality of large numbers using Miller-Rabin with flexible configurations.",
      card_prime_search_desc: "Generate and verify large primes for cryptography demos.",
      card_rsa_keygen_desc: "Initialize complete RSA key parameters for simulation and cryptographic research.",
      card_rsa_crypto_desc: "Perform data encryption and decryption based on RSA mathematical principles.",
      card_history_desc: "Manage and retrieve the history of primality tests, searches, and crypto tasks.",
      card_downloads_desc: "Export and store search results, RSA key sets, and experimental logs.",
      pipeline_title: "PrimeLab Processing Pipeline",
      pipeline_desc: "Direct processing using JavaScript BigInt and crypto.randomBytes, ensuring independence and high security.",
    }
  };

  function getLang() {
    return localStorage.getItem(LANG_KEY) || "vi";
  }

  function setLang(lang) {
    localStorage.setItem(LANG_KEY, lang);
    applyTranslations();
  }

  function applyTranslations() {
    const lang = getLang();
    document.documentElement.lang = lang;
    
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.dataset.i18n;
      const text = translations[lang][key];
      if (text) {
        el.textContent = text;
      }
    });

    const toggleBtn = document.getElementById("lang-toggle");
    if (toggleBtn) {
      toggleBtn.textContent = lang === "vi" ? "VI/EN" : "EN/VI";
    }
  }

  function initShell(activePath) {
    const session = requireSession();
    if (!session) return;

    const userNode = document.querySelector("[data-session-user]");
    if (userNode) userNode.textContent = session.fullName || session.email;

    applyTranslations();

    document.querySelectorAll("[data-nav]").forEach((link) => {
      link.classList.toggle("active", link.getAttribute("href") === activePath);
    });

    const logoutButton = document.querySelector("[data-logout]");
    if (logoutButton) {
      logoutButton.addEventListener("click", () => {
        clearSession();
        window.location.href = "/login";
      });
    }

    const toggleBtn = document.getElementById("lang-toggle");
    if (toggleBtn) {
      toggleBtn.addEventListener("click", () => {
        setLang(getLang() === "vi" ? "en" : "vi");
      });
    }

    initChatbotWidget();
  }

  function initChatbotWidget() {
    if (document.querySelector("[data-chatbot-root]") || document.querySelector("[data-chatbot-loader]")) {
      return;
    }

    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = "/css/chatbot.css";
    document.head.appendChild(stylesheet);

    const script = document.createElement("script");
    script.src = "/js/chatbot.js";
    script.defer = true;
    script.dataset.chatbotLoader = "true";
    document.body.appendChild(script);
  }

  function bindCopyButtons(root = document) {
    root.querySelectorAll("[data-copy-target]").forEach((button) => {
      button.addEventListener("click", async () => {
        const target = document.querySelector(button.dataset.copyTarget);
        if (!target) return;
        await copyToClipboard(target.value || target.textContent);
        const originalText = button.textContent;
        button.textContent = "Đã sao chép";
        setTimeout(() => {
          button.textContent = originalText;
        }, 900);
      });
    });
  }

  // Helper to safely format link downloads with token if needed (for images etc)
  // For file downloads where we redirect, we need to pass token in URL or handle via fetch.
  // Since we use window.location.href for downloads currently, we might need a workaround.
  // The easiest is to use fetch and blob.
  async function downloadFileWithAuth(url, filename) {
    const headers = {};
    const session = getSession();
    if (session && session.token) {
      headers["Authorization"] = `Bearer ${session.token}`;
    }

    const response = await fetch(url, { headers });
    if (!response.ok) {
      const contentType = response.headers.get("Content-Type") || "";
      const payload = contentType.includes("application/json")
        ? await response.json().catch(() => ({}))
        : {};

      if (response.status === 401) {
        clearSession();
        window.location.href = "/login";
      }

      throw new Error(payload.error || `Download failed with status ${response.status}`);
    }
    
    const blob = await response.blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function saveState(key, data) {
    const stateKey = getStateKey(key);
    if (!stateKey) return;
    sessionStorage.setItem(stateKey, JSON.stringify(data));
  }

  function loadState(key) {
    try {
      const stateKey = getStateKey(key);
      if (!stateKey) return null;
      const data = sessionStorage.getItem(stateKey);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  }

  window.PrimeLab = {
    SESSION_KEY,
    apiPost,
    apiGet,
    apiDelete,
    bindCopyButtons,
    clearSession,
    copyToClipboard,
    formatJson,
    formatObjectAsKeyValue,
    getSession,
    initShell,
    requireSession,
    setSession,
    showError,
    showLoading,
    getLang,
    initChatbotWidget,
    setLang,
    applyTranslations,
    downloadFileWithAuth,
    saveState,
    loadState
  };
})();
