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

  // Load saved state
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
      ["Phương pháp", result.method || result.selectedMethod || "auto"],
      ["Chứng chỉ", result.certificateType || "miller_rabin_witnesses"],
      ["Xác minh", result.verificationMode || result.certificateType || "không rõ"],
      ["Độ dài bit", result.bits],
      ["Số vòng yêu cầu", result.requestedRounds ?? result.rounds],
      ["Số vòng JS thực chạy", result.rounds],
      ["Số lần thử", result.attempts],
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
    if (value === "probable") return "miller_rabin";
    if (value === "native") return "hybrid";
    if (value === "provable") return "pocklington";
    if (value === "baillie_psw" || value === "lucas_lehmer") return "miller_rabin";
    return value;
  }

  function updateAlgorithmHint() {
    if (!algorithmHint) return;

    const bits = Number(form.elements.bits?.value || 0);
    const method = String(form.elements.method?.value || "auto");
    const isAuto = method === "auto";
    const isReferenceDemo = bits === 16384;
    const autoAlgorithm = bits <= 512
      ? "Nguyên tố có chứng chỉ"
      : isReferenceDemo
        ? "Demo prime rất lớn"
      : "Tìm prime nhanh";
    const methodLabels = {
      auto: autoAlgorithm,
      hybrid: autoAlgorithm,
      miller_rabin: "Miller-Rabin",
      pocklington: "Chứng chỉ Pocklington",
    };

    const details = isAuto
      ? "Auto sẽ chọn cách chạy phù hợp với độ dài bit bạn chọn."
      : method === "pocklington"
        ? "Phù hợp khi cần kết quả có chứng chỉ ở mức bit nhỏ."
        : method === "hybrid"
          ? "Ưu tiên tốc độ để demo các số lớn."
          : "Tự sinh và tự kiểm tra, phù hợp để trình bày thuật toán.";

    const displayDetails = getAdaptiveSearchDetails(bits, method, isAuto, details);

    algorithmHint.innerHTML = `
      <strong>Thuật toán sẽ dùng: ${methodLabels[method] || autoAlgorithm}</strong>
      <span>${displayDetails}</span>
    `;
  }

  function getAdaptiveSearchDetails(bits, method, isAuto, fallbackDetails) {
    if ((isAuto || method === "hybrid") && bits === 16384) {
      return "Chế độ này giữ thời gian chạy hợp lý cho phần demo 16384-bit.";
    }

    if ((isAuto || method === "hybrid") && bits === 8192) {
      return "Mức này phù hợp để demo tìm prime lớn mà vẫn chờ được.";
    }

    if (isAuto) {
      if (bits > 8192) {
        return "Auto sẽ ưu tiên thời gian chạy ổn định cho số rất lớn.";
      }
      if (bits > 4096) {
        return "Auto cân bằng giữa tốc độ và phần kiểm tra thuật toán.";
      }
      return fallbackDetails;
    }

    if (method === "hybrid") {
      if (bits > 8192) {
        return "Hybrid giúp phần demo số rất lớn không bị kéo quá lâu.";
      }
      return "Hybrid chạy nhanh hơn cho các số lớn.";
    }

    return fallbackDetails;
  }
})();
