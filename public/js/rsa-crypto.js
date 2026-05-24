(function () {
  PrimeLab.initShell("/rsa-crypto");

  const errorBox = document.querySelector("[data-error]");
  const resultSection = document.getElementById("result-section");
  const resultOutput = document.getElementById("crypto-result");

  // Load last session state
  const pageState = PrimeLab.loadState("rsa-crypto") || {
    activeTab: "#encrypt-panel",
    lastFormId: null,
    lastInputs: {},
    lastResult: null
  };

  // Populate UI from state
  if (pageState.activeTab) {
    const tabBtn = document.querySelector(`[data-tab="${pageState.activeTab}"]`);
    if (tabBtn) {
      document.querySelectorAll("[data-tab]").forEach(i => i.classList.remove("active"));
      document.querySelectorAll("[data-tab-panel]").forEach(p => p.classList.remove("active"));
      tabBtn.classList.add("active");
      document.querySelector(pageState.activeTab).classList.add("active");
    }
  }

  if (pageState.lastFormId && pageState.lastInputs) {
    const form = document.getElementById(pageState.lastFormId);
    if (form) {
      Object.entries(pageState.lastInputs).forEach(([name, value]) => {
        if (form.elements[name]) form.elements[name].value = value;
      });
    }
  }

  if (pageState.lastResult) {
    renderResult(pageState.lastResult, false);
  }

  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-tab]").forEach((item) => item.classList.remove("active"));
      document.querySelectorAll("[data-tab-panel]").forEach((panel) => panel.classList.remove("active"));
      button.classList.add("active");
      document.querySelector(button.dataset.tab).classList.add("active");
      PrimeLab.showError(errorBox, "");
      resultSection.classList.add("hidden");
      
      // Save only the active tab change
      pageState.activeTab = button.dataset.tab;
      PrimeLab.saveState("rsa-crypto", pageState);
    });
  });

  bindCryptoForm("encrypt-form", "/api/rsa/encrypt", (data) => ({
    message: String(data.get("message") || "").trim(),
    n: String(data.get("n") || "").trim(),
    e: String(data.get("e") || "").trim(),
  }));

  bindCryptoForm("decrypt-form", "/api/rsa/decrypt", (data) => ({
    cipherNumber: String(data.get("cipherNumber") || "").trim(),
    n: String(data.get("n") || "").trim(),
    d: String(data.get("d") || "").trim(),
  }), "m");

  bindCryptoForm("sign-form", "/api/rsa/sign", (data) => ({
    hashAlgorithm: String(data.get("hashAlgorithm") || "").trim(),
    message: String(data.get("message") || ""),
    n: String(data.get("n") || "").trim(),
    d: String(data.get("d") || "").trim(),
  }), "s");

  bindCryptoForm("verify-form", "/api/rsa/verify", (data) => ({
    hashAlgorithm: String(data.get("hashAlgorithm") || "").trim(),
    message: String(data.get("message") || ""),
    signatureNumber: String(data.get("signatureNumber") || "").trim(),
    n: String(data.get("n") || "").trim(),
    e: String(data.get("e") || "").trim(),
  }), "valid");

  bindCryptoForm("mod-inverse-form", "/api/rsa/mod-inverse", (data) => ({
    e: String(data.get("e") || "").trim(),
    n: String(data.get("n") || "").trim(),
  }), "d");

  function renderResult(text, shouldScroll = true) {
    resultOutput.textContent = text;
    resultSection.classList.remove("hidden");
    PrimeLab.bindCopyButtons(resultSection);
    if (shouldScroll) {
      resultSection.scrollIntoView({ behavior: "smooth" });
    }
  }

  function bindCryptoForm(formId, url, buildPayload, resultLabel = "c") {
    const form = document.getElementById(formId);
    if (!form) return;

    const submitButton = form.querySelector("button[type='submit']");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      PrimeLab.showError(errorBox, "");
      resultSection.classList.add("hidden");

      const formData = new FormData(form);
      const payload = buildPayload(formData);
      if (Object.values(payload).some((value) => !value)) {
        PrimeLab.showError(errorBox, "Vui lòng nhập đầy đủ các trường.");
        return;
      }

      PrimeLab.showLoading(submitButton, true, "Đang xử lý...");

      try {
        const response = await PrimeLab.apiPost(url, payload);
        let outputText = "";
        
        if (formId === "mod-inverse-form") {
          outputText = [
            `Phân tích n và tính d:`,
            `p = ${response.p}`,
            `q = ${response.q}`,
            `n = ${response.n}`,
            `phi(n) = ${response.phiN}`,
            `e = ${response.e}`,
            `d = ${response.d}`,
            `Khóa công khai (n, e) = (${response.n}, ${response.e})`,
            `Khóa mật d = ${response.d}`
          ].join("\n");
        } else if (formId === "sign-form") {
          outputText = [
            `hash = ${response.digestHex}`,
            `chữ ký s = ${response.signatureNumber}`
          ].join("\n");
        } else if (formId === "verify-form") {
          outputText = [
            `hợp lệ = ${response.valid ? "có" : "không"}`,
            `hash = ${response.digestHex}`,
          ].join("\n");
        } else {
          let value;
          if (formId === "encrypt-form") {
            value = response.cipherNumber;
          } else if (formId === "decrypt-form") {
            value = response.messageNumber;
          } else {
            value = response.cipherNumber || response.messageNumber || response.d || response;
          }

          const displayValue = typeof value === "object" 
            ? PrimeLab.formatObjectAsKeyValue(value) 
            : value;
          outputText = `${resultLabel} = ${displayValue}`;
        }
        
        renderResult(outputText);

        // Update and save state only on success
        pageState.lastFormId = formId;
        pageState.lastInputs = Object.fromEntries(formData.entries());
        pageState.lastResult = outputText;
        PrimeLab.saveState("rsa-crypto", pageState);
      } catch (error) {
        PrimeLab.showError(errorBox, error.message);
      } finally {
        PrimeLab.showLoading(submitButton, false);
      }
    });
  }
})();
