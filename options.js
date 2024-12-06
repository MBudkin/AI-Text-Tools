let menuItems = [];

document.addEventListener("DOMContentLoaded", () => {
  // Загрузка настроек и пунктов меню
  chrome.storage.sync.get(["apiKey", "apiServer", "apiModel", "menuItems"], (settings) => {
    document.getElementById("apiKey").value = settings.apiKey || "";
    document.getElementById("apiServer").value = settings.apiServer || "https://api.openai.com/v1";
    document.getElementById("apiModel").value = settings.apiModel || "gpt-4";
    
    menuItems = settings.menuItems || [];
    displayMenuItems();
  });
});

function displayMenuItems() {
  const menuItemsContainer = document.getElementById("menu-items");
  menuItemsContainer.innerHTML = ""; // Очистка существующих пунктов

  menuItems.forEach((item, index) => {
    const itemDiv = document.createElement("div");
    itemDiv.className = "menu-item";

    const titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.placeholder = "Название пункта меню";
    titleInput.value = item.title;
    titleInput.addEventListener("input", () => {
      item.title = titleInput.value;
    });

    const promptInput = document.createElement("textarea");
    promptInput.placeholder = "Промпт для этого пункта меню";
    promptInput.value = item.prompt;
    promptInput.rows = 2;
    promptInput.addEventListener("input", () => {
      item.prompt = promptInput.value;
    });

    const deleteButton = document.createElement("button");
    deleteButton.textContent = "Удалить";
    deleteButton.addEventListener("click", () => {
      menuItems.splice(index, 1);
      displayMenuItems();
    });

    itemDiv.appendChild(titleInput);
    itemDiv.appendChild(promptInput);
    itemDiv.appendChild(deleteButton);

    menuItemsContainer.appendChild(itemDiv);
  });
}

document.getElementById("add-menu-item").addEventListener("click", () => {
  menuItems.push({ title: "Новый запрос", prompt: 'Ответь на следующий текст: "{{selectionText}}"' });
  displayMenuItems();
});

document.getElementById("save").addEventListener("click", () => {
  const apiKey = document.getElementById("apiKey").value;
  const apiServer = document.getElementById("apiServer").value;
  const apiModel = document.getElementById("apiModel").value;

  chrome.storage.sync.set({ apiKey, apiServer, apiModel, menuItems }, () => {
    // Отправляем сообщение в background.js для обновления контекстного меню
    chrome.runtime.sendMessage({ action: "updateContextMenu" }, (response) => {
      if (chrome.runtime.lastError) {
        console.error(chrome.runtime.lastError);
      } else {
        alert("Настройки сохранены!");
      }
    });
  });
});