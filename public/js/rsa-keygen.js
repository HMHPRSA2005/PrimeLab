(function () {
  PrimeLab.initShell("/rsa-keygen");

  const form = document.getElementById("rsa-keygen-form");
  const errorBox = document.querySelector("[data-error]");
  const resultSection = document.getElementById("result-section");
  const fieldList = document.getElementById("key-fields");
  const submitButton = form?.querySelector("button[type='submit']");

  if (!form) return;

  // Load saved state
  const savedState = PrimeLab.loadState("rsa-keygen");
  if (savedState) {
    if (savedState.inputs) {
      Object.entries(savedState.inputs).forEach(([name, value]) => {
        const input = form.elements[name];
        if (input) input.value = value;
      });
    }
    if (savedState.keyPair) {
      renderKeyPair(savedState.keyPair, false);
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    PrimeLab.showError(errorBox, "");
    resultSection.classList.add("hidden");

    const data = new FormData(form);
    const inputs = Object.fromEntries(data.entries());
    const publicExponent = String(data.get("publicExponent") || "").trim();
    if (!/^(0x[0-9a-f]+|\d+)$/i.test(publicExponent)) {
      PrimeLab.showError(errorBox, "Số mũ công khai e phải là số hệ 10 hoặc 0x...");
      return;
    }

    PrimeLab.showLoading(submitButton, true, "Đang tạo khóa...");

    try {
      const response = await PrimeLab.apiPost("/api/rsa/keygen", {
        primeBits: Number(data.get("primeBits")),
        rounds: Number(data.get("rounds")),
        publicExponent,
      });
      renderKeyPair(response.keyPair);
      PrimeLab.saveState("rsa-keygen", { inputs, keyPair: response.keyPair });
    } catch (error) {
      PrimeLab.showError(errorBox, error.message);
    } finally {
      PrimeLab.showLoading(submitButton, false);
    }
  });

  function renderKeyPair(keyPair, shouldScroll = true) {
    const displayValue = (value) => value ?? "-";
    const summary = [
      `Độ dài bit của p và q = ${displayValue(keyPair.primeBits || form.elements.primeBits?.value)}`,
      `Độ dài bit của n = ${displayValue(keyPair.modulusBits || String(keyPair.n || "").length)}`,
      `Số lần thử = ${displayValue(keyPair.attempts || 1)}`,
    ].join("\n");

    const fields = [
      ["Tóm tắt", summary],
      ["Tham số RSA", [
        `p = ${displayValue(keyPair.p)}`,
        `q = ${displayValue(keyPair.q)}`,
        `n = ${displayValue(keyPair.n)}`,
        `phi(n) = ${displayValue(keyPair.phiN)}`,
        `e = ${displayValue(keyPair.e)}`,
        `d = ${displayValue(keyPair.d)}`,
      ].join("\n")],
      ["Số nguyên tố p, q", `p = ${displayValue(keyPair.p)}\nq = ${displayValue(keyPair.q)}`],
      ["n và phi(n)", [
        `n = ${displayValue(keyPair.n)}`,
        `phi(n) = ${displayValue(keyPair.phiN)}`,
      ].join("\n")],
      ["Số mũ e, d", [
        `e = ${displayValue(keyPair.e)}`,
        `d = ${displayValue(keyPair.d)}`,
        `d = e^-1 mod phi(n)`,
      ].join("\n")],
      ["Khóa công khai (n, e)", `(${displayValue(keyPair.n)}, ${displayValue(keyPair.e)})`],
      ["Khóa mật d", `d = ${displayValue(keyPair.d)}`],
    ];

    fieldList.innerHTML = fields.map(([name, value], index) => `
      <div class="card">
        <div class="copy-row">
          <p class="eyebrow">${name}</p>
          <button class="secondary-btn" data-copy-target="#key-field-${index}" type="button">Sao chép</button>
        </div>
        <textarea id="key-field-${index}" class="code-area" readonly>${value}</textarea>
      </div>
    `).join("");

    resultSection.classList.remove("hidden");
    PrimeLab.bindCopyButtons(resultSection);

    if (shouldScroll) {
      resultSection.scrollIntoView({ behavior: "smooth" });
    }
  }
})();
