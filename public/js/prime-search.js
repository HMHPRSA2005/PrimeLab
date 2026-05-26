(function () {
  PrimeLab.initShell("/prime-search");

  const form = document.getElementById("prime-search-form");
  const errorBox = document.querySelector("[data-error]");
  const resultSection = document.getElementById("result-section");
  const resultMetrics = document.getElementById("result-metrics");
  const primeDec = document.getElementById("prime-dec");
  const primeHex = document.getElementById("prime-hex");
  const primeCertificate = document.getElementById("prime-certificate");
  const certificateRow = document.getElementById("certificate-row");
  const algorithmHint = document.getElementById("algorithm-hint");
  const submitButton = form?.querySelector("button[type='submit']");

  if (!form) return;

  const savedState = PrimeLab.loadState("prime-search");
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

  updateAlgorithmHint();
  form.elements.bits?.addEventListener("change", updateAlgorithmHint);
  form.elements.method?.addEventListener("change", updateAlgorithmHint);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    PrimeLab.showError(errorBox, "");
    resultSection.classList.add("hidden");

    const data = new FormData(form);
    const inputs = Object.fromEntries(data.entries());
    const maxAttempts = Number(data.get("maxAttempts"));

    if (!Number.isInteger(maxAttempts) || maxAttempts < 0) {
      PrimeLab.showError(errorBox, "Số lần thử tối đa phải là số nguyên không âm.");
      return;
    }

    PrimeLab.showLoading(submitButton, true, "Đang tìm...");

    try {
      const response = await PrimeLab.apiPost("/api/prime/search", {
        bits: Number(data.get("bits")),
        method: String(data.get("method") || "auto"),
        rounds: Number(data.get("rounds")),
        maxAttempts,
      });

      renderResult(response.result);
      PrimeLab.saveState("prime-search", { inputs, result: response.result });
    } catch (error) {
      PrimeLab.showError(errorBox, error.message);
    } finally {
      PrimeLab.showLoading(submitButton, false);
    }
  });

  function renderResult(result, shouldScroll = true) {
    resultMetrics.innerHTML = [
      ["Kết quả", result.primality === "proven" ? "đã chứng minh nguyên tố" : "nguyên tố xác suất"],
      ["Thuật toán", result.algorithm || result.method || "không rõ"],
      ["Phương pháp", result.proofMethod || result.method || result.selectedMethod || "auto"],
      ["Chứng chỉ", result.certificateType || "miller_rabin_witnesses"],
      ["Độ dài bit", result.bits],
      ["Số vòng yêu cầu", result.requestedRounds ?? result.rounds],
      ["Số vòng thực chạy", result.rounds],
      ["Số lần thử", result.attempts],
      ...(result.parallelWorkers ? [
        ["Worker song song", result.parallelWorkers],
        ["Attempts worker thang", result.winnerAttempts],
      ] : []),
      ["Độ sâu chứng chỉ", result.certificateDepth || 0],
      ["Thời gian", `${Math.round(Number(result.elapsedSeconds) * 1000)} ms`],
    ].map(([label, value]) => `
      <div class="metric">
        <span>${label}</span>
        <strong>${value}</strong>
      </div>
    `).join("");

    primeDec.value = result.primeDec;
    primeHex.value = result.primeHex;

    if (result.certificate) {
      certificateRow.classList.remove("hidden");
      primeCertificate.classList.remove("hidden");
      primeCertificate.value = JSON.stringify(result.certificate, null, 2);
    } else {
      certificateRow.classList.add("hidden");
      primeCertificate.classList.add("hidden");
      primeCertificate.value = "";
    }

    resultSection.classList.remove("hidden");
    PrimeLab.bindCopyButtons(resultSection);

    if (shouldScroll) {
      resultSection.scrollIntoView({ behavior: "smooth" });
    }
  }

  function normalizeMethodValue(value) {
    if (value === "pocklington" || value === "auto") return value;
    return "miller-rabin";
  }

  function updateAlgorithmHint() {
    if (!algorithmHint) return;

    const bits = Number(form.elements.bits?.value || 0);
    const method = normalizeMethodValue(form.elements.method?.value || "auto");
    const autoAlgorithm = bits <= 512 ? "Pocklington có chứng chỉ" : "Miller-Rabin";
    const methodLabels = {
      auto: autoAlgorithm,
      pocklington: "Pocklington có chứng chỉ",
      "miller-rabin": "Miller-Rabin",
    };

    algorithmHint.innerHTML = `
      <strong>Thuật toán sẽ dùng: ${methodLabels[method] || autoAlgorithm}</strong>
      <span>${getSearchDetails(bits, method)}</span>
    `;
  }

  function getSearchDetails(bits, method) {
    if (method === "auto") {
      return "Hệ thống sẽ tự động chọn Pocklington cho những số từ 512 bit đổ lại; với số lớn hơn sẽ chuyển sang Miller-Rabin để chạy nhanh hơn.";
    }

    if (method === "pocklington" && bits > 512) {
      return "Pocklington vẫn chạy được với mức bit này, nhưng thời gian trả lời có thể lâu hơn rõ rệt vì hệ thống phải tạo chứng chỉ nguyên tố.";
    }

    if (method === "pocklington") {
      return "Với các số từ 512 bit đổ lại, Pocklington thường chạy nhanh và cho kết quả proven/certified, tức là chắc chắn hơn kiểm tra xác suất.";
    }

    return "Miller-Rabin phù hợp khi cần tìm số lớn nhanh; kết quả là probable prime với số vòng kiểm tra mặc định là 50.";
  }
})();
