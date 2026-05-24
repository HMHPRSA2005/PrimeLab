(function () {
  PrimeLab.initShell("/prime-check");

  const form = document.getElementById("prime-check-form");
  const errorBox = document.querySelector("[data-error]");
  const resultSection = document.getElementById("result-section");
  const resultMessage = document.getElementById("result-message");
  const submitButton = form?.querySelector("button[type='submit']");

  if (!form) return;

  // Load saved state
  const savedState = PrimeLab.loadState("prime-check");
  if (savedState) {
    if (savedState.inputs) {
      Object.entries(savedState.inputs).forEach(([name, value]) => {
        const input = form.elements[name];
        if (input) input.value = normalizeMethodValue(value);
      });
    }
    if (savedState.result) {
      renderResult(savedState.result, false);
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    PrimeLab.showError(errorBox, "");
    resultSection.classList.add("hidden");

    const data = new FormData(form);
    const inputs = Object.fromEntries(data.entries());
    const number = String(data.get("number") || "").trim();
    if (!number) {
      PrimeLab.showError(errorBox, "Vui lòng nhập số cần kiểm tra.");
      return;
    }

    const startedAt = performance.now();
    PrimeLab.showLoading(submitButton, true, "Đang kiểm tra...");

    try {
      const response = await PrimeLab.apiPost("/api/prime/check", {
        number,
        bits: Number(data.get("bits")),
        method: "auto",
        rounds: Number(data.get("rounds")),
      });
      const elapsedMs = Math.round(performance.now() - startedAt);
      const result = { ...response, elapsedMs };
      renderResult(result);
      PrimeLab.saveState("prime-check", { inputs, result });
    } catch (error) {
      PrimeLab.showError(errorBox, error.message);
    } finally {
      PrimeLab.showLoading(submitButton, false);
    }
  });

  function renderResult(result, shouldScroll = true) {
    const algorithmName = result.algorithm || result.method || "không rõ";
    const isPrimeResult = Boolean(result.isPrime || result.isProbablePrime);
    resultMessage.textContent = isPrimeResult
      ? `Số trên là số nguyên tố theo chuẩn kiểm tra ${algorithmName}.`
      : `Số trên không phải là số nguyên tố theo chuẩn kiểm tra ${algorithmName}.`;
    resultSection.classList.remove("hidden");

    if (shouldScroll) {
      resultSection.scrollIntoView({ behavior: "smooth" });
    }
  }

  function normalizeMethodValue(value) {
    if (value === "provable") return "pocklington";
    if (value === "probable" || value === "baillie_psw" || value === "miller_rabin" || value === "lucas_lehmer") return "auto";
    return value;
  }
})();
