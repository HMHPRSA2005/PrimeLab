(function () {
  PrimeLab.initShell("/history");

  const tableBody = document.getElementById("history-table-body");
  const filter = document.getElementById("action-filter");
  const detailPanel = document.getElementById("detail-panel");
  const detailOutput = document.getElementById("detail-output");
  const errorBox = document.querySelector("[data-error]");
  let records = [];

  loadHistory();

  filter.addEventListener("change", renderTable);

  async function loadHistory() {
    try {
      const data = await PrimeLab.apiGet("/api/history");
      records = data.records || [];
      fillFilter();
      renderTable();
    } catch (error) {
      PrimeLab.showError(errorBox, error.message);
    }
  }

  function fillFilter() {
    const actions = [...new Set(records.map((record) => record.action))].sort();
    filter.innerHTML = `<option value="">Tất cả thao tác</option>${actions
      .map((action) => `<option value="${escapeHTML(action)}">${escapeHTML(action)}</option>`)
      .join("")}`;
  }

  function escapeHTML(str) {
    return String(str || "").replace(/[&<>'"]/g, 
      tag => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
      }[tag] || tag)
    );
  }

  function renderTable() {
    const selectedAction = filter.value;
    const visibleRecords = selectedAction
      ? records.filter((record) => record.action === selectedAction)
      : records;

    const limit = 50;
    const recordsToShow = visibleRecords.slice(0, limit);

    tableBody.innerHTML = recordsToShow.map((record) => `
      <tr>
        <td>${escapeHTML(new Date(record.createdAt).toLocaleString("vi-VN"))}</td>
        <td><strong>${escapeHTML(record.action)}</strong></td>
        <td>${escapeHTML(record.status)}</td>
        <td>${escapeHTML(record.summary)}</td>
        <td>
          <button class="secondary-btn" data-detail="${escapeHTML(record.id)}" type="button">Chi tiết</button>
          <button class="danger-btn" data-delete="${escapeHTML(record.id)}" type="button">Xóa</button>
        </td>
      </tr>
    `).join("");

    tableBody.querySelectorAll("[data-detail]").forEach((button) => {
      button.addEventListener("click", () => {
        const id = button.dataset.detail;
        
        if (!detailPanel.classList.contains("hidden") && detailPanel.dataset.activeId === id) {
          detailPanel.classList.add("hidden");
          detailPanel.dataset.activeId = "";
          return;
        }

        const record = records.find((item) => item.id === id);
        const data = record.payload || record;
        
        detailOutput.textContent = PrimeLab.formatObjectAsKeyValue(data);
        detailPanel.classList.remove("hidden");
        detailPanel.dataset.activeId = id;
        PrimeLab.bindCopyButtons(detailPanel);
      });
    });

    tableBody.querySelectorAll("[data-delete]").forEach((button) => {
      button.addEventListener("click", async () => {
        await deleteRecord(button.dataset.delete);
      });
    });
  }

  async function deleteRecord(id) {
    try {
      await PrimeLab.apiDelete(`/api/history/${encodeURIComponent(id)}`);
      records = records.filter((record) => record.id !== id);
      renderTable();
      detailPanel.classList.add("hidden");
    } catch (error) {
      PrimeLab.showError(errorBox, error.message);
    }
  }
})();
