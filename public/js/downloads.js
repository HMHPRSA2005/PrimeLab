(function () {
  PrimeLab.initShell("/downloads");

  document.querySelectorAll('.download-card a').forEach(link => {
    link.addEventListener('click', async (e) => {
      e.preventDefault();
      const url = link.getAttribute('href');
      const filename = url.split('/').pop() + '.txt'; // Extract a default filename
      const originalText = link.textContent;
      try {
        link.textContent = "Đang tải...";
        link.style.pointerEvents = "none";
        await PrimeLab.downloadFileWithAuth(url, filename);
        link.textContent = "Đã tải xong";
        setTimeout(() => {
          link.textContent = originalText;
          link.style.pointerEvents = "auto";
        }, 2000);
      } catch (err) {
        alert("Lỗi tải xuống: " + err.message);
        link.textContent = "Lỗi!";
        setTimeout(() => {
          link.textContent = originalText;
          link.style.pointerEvents = "auto";
        }, 2000);
      }
    });
  });
})();
