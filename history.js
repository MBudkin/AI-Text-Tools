document.addEventListener("DOMContentLoaded", () => {
  loadHistory();

  document.getElementById("clear-button").addEventListener("click", () => {
    if (confirm("Вы уверены, что хотите очистить историю запросов?")) {
      chrome.storage.local.set({ history: [] }, () => { // Очищаем только историю
        loadHistory();
        alert("История запросов очищена.");
      });
    }
  });
});

function loadHistory() {
  chrome.storage.local.get(['history'], (data) => { // Получаем только историю
    const history = data.history || [];
    
    chrome.storage.sync.get(['historyLimit'], (settings) => { // Получаем historyLimit из storage.sync
      const historyLimit = typeof settings.historyLimit === 'number' ? settings.historyLimit : 20; // По умолчанию 20
      const tableBody = document.getElementById("history-table-body");
      tableBody.innerHTML = ""; // Очистка таблицы

      if (historyLimit === 0) {
        const row = document.createElement("tr");
        const cell = document.createElement("td");
        cell.colSpan = 5;
        cell.textContent = "История отключена.";
        cell.style.textAlign = "center";
        row.appendChild(cell);
        tableBody.appendChild(row);
        return;
      }

      if (history.length === 0) {
        const row = document.createElement("tr");
        const cell = document.createElement("td");
        cell.colSpan = 5;
        cell.textContent = "История пуста.";
        cell.style.textAlign = "center";
        row.appendChild(cell);
        tableBody.appendChild(row);
        return;
      }

      history.forEach(entry => {
        const row = document.createElement("tr");

        const dateCell = document.createElement("td");
        dateCell.textContent = entry.date;
        row.appendChild(dateCell);

        const timeCell = document.createElement("td");
        timeCell.textContent = entry.time;
        row.appendChild(timeCell);

        const modelCell = document.createElement("td");
        modelCell.textContent = entry.model || "";
        row.appendChild(modelCell);

        const queryCell = document.createElement("td");
        const queryPre = document.createElement("pre");
        queryPre.textContent = entry.query;
        queryCell.appendChild(queryPre);
        row.appendChild(queryCell);

        const responseCell = document.createElement("td");
        const responsePre = document.createElement("pre");
        responsePre.textContent = entry.response;
        responseCell.appendChild(responsePre);
        row.appendChild(responseCell);

        tableBody.appendChild(row);
      });
    });
  });
}