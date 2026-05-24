(function () {
  const form = document.querySelector("[data-auth-form]");
  const errorBox = document.querySelector("[data-error]");
  const submitButton = form?.querySelector("button[type='submit']");
  if (!form) return;

  PrimeLab.initChatbotWidget?.();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    PrimeLab.showError(errorBox, "");

    const data = new FormData(form);
    const mode = form.dataset.authForm;
    const email = String(data.get("email") || "").trim().toLowerCase();
    const password = String(data.get("password") || "");

    if (!email || !password) {
      PrimeLab.showError(errorBox, "Vui lòng nhập email và mật khẩu.");
      return;
    }

    if (mode === "register") {
      const fullName = String(data.get("fullName") || "").trim();
      const confirmPassword = String(data.get("confirmPassword") || "");
      if (!fullName) {
        PrimeLab.showError(errorBox, "Vui lòng nhập họ tên.");
        return;
      }
      if (password.length < 6) {
        PrimeLab.showError(errorBox, "Mật khẩu cần ít nhất 6 ký tự.");
        return;
      }
      if (password !== confirmPassword) {
        PrimeLab.showError(errorBox, "Mật khẩu xác nhận không trùng khớp.");
        return;
      }

      PrimeLab.showLoading(submitButton, true, "Đang đăng ký...");
      try {
        const payload = await PrimeLab.apiPost("/api/auth/register", { fullName, email, password });
        PrimeLab.setSession(payload.email, payload.fullName, payload.token);
        window.location.href = "/dashboard";
      } catch (err) {
        PrimeLab.showError(errorBox, err.message);
      } finally {
        PrimeLab.showLoading(submitButton, false);
      }
      return;
    }

    PrimeLab.showLoading(submitButton, true, "Đang đăng nhập...");
    try {
      const payload = await PrimeLab.apiPost("/api/auth/login", { email, password });
      PrimeLab.setSession(payload.email, payload.fullName, payload.token);
      window.location.href = "/dashboard";
    } catch (err) {
      PrimeLab.showError(errorBox, "Sai email hoặc mật khẩu.");
    } finally {
      PrimeLab.showLoading(submitButton, false);
    }
  });
})();
