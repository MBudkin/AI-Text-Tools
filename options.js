let menuItems = [];

document.addEventListener("DOMContentLoaded", () => {
  // Загрузка настроек и пунктов меню
  chrome.storage.sync.get(["apiKey", "apiServer", "apiModel", "menuItems", "historyLimit"], (settings) => {
    document.getElementById("apiKey").value = settings.apiKey || "";
    document.getElementById("apiServer").value = settings.apiServer || "https://api.openai.com/v1";
    document.getElementById("apiModel").value = settings.apiModel || "gpt-4";
    
    menuItems = settings.menuItems || [];
    displayMenuItems();

    // Загрузка настройки historyLimit
    const historyLimitInput = document.getElementById("historyLimit");
    historyLimitInput.value = typeof settings.historyLimit === "number" ? settings.historyLimit : 20;
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

    const moveButtonsDiv = document.createElement("div");
    moveButtonsDiv.className = "move-buttons";

    const moveUpButton = document.createElement("button");
    moveUpButton.textContent = "▲";
    moveUpButton.title = "Переместить вверх";
    moveUpButton.disabled = index === 0; // Отключить кнопку, если первый элемент
    moveUpButton.addEventListener("click", () => {
      moveMenuItem(index, index - 1);
    });

    const moveDownButton = document.createElement("button");
    moveDownButton.textContent = "▼";
    moveDownButton.title = "Переместить вниз";
    moveDownButton.disabled = index === menuItems.length - 1; // Отключить кнопку, если последний элемент
    moveDownButton.addEventListener("click", () => {
      moveMenuItem(index, index + 1);
    });

    moveButtonsDiv.appendChild(moveUpButton);
    moveButtonsDiv.appendChild(moveDownButton);

    const deleteButton = document.createElement("button");
    deleteButton.textContent = "Удалить";
    deleteButton.addEventListener("click", () => {
      menuItems.splice(index, 1);
      displayMenuItems();
    });

    itemDiv.appendChild(titleInput);
    itemDiv.appendChild(promptInput);
    itemDiv.appendChild(moveButtonsDiv);
    itemDiv.appendChild(deleteButton);

    menuItemsContainer.appendChild(itemDiv);
  });
}

function moveMenuItem(fromIndex, toIndex) {
  if (toIndex < 0 || toIndex >= menuItems.length) return; // Проверка границ

  // Обмен элементов
  [menuItems[fromIndex], menuItems[toIndex]] = [menuItems[toIndex], menuItems[fromIndex]];
  
  displayMenuItems(); // Обновить отображение
}

document.getElementById("add-menu-item").addEventListener("click", () => {
  menuItems.push({ title: "Новый запрос", prompt: 'Ответь на следующий текст: "{{selectionText}}"' });
  displayMenuItems();
});

document.getElementById("save").addEventListener("click", () => {
  const apiKey = document.getElementById("apiKey").value;
  const apiServer = document.getElementById("apiServer").value;
  const apiModel = document.getElementById("apiModel").value;
  const historyLimit = parseInt(document.getElementById("historyLimit").value, 10);

  // Валидация значения historyLimit
  if (isNaN(historyLimit) || historyLimit < 0 || historyLimit > 1000) {
    alert("Пожалуйста, введите корректное число для количества записей в истории (0-1000).");
    return;
  }

  chrome.storage.sync.set({ 
    apiKey, 
    apiServer, 
    apiModel, 
    menuItems,
    historyLimit 
  }, () => {
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

// Добавляем обработчик для кнопки сохранения лимита истории
document.getElementById("saveHistoryLimit").addEventListener("click", () => {
  const apiKey = document.getElementById("apiKey").value;
  const apiServer = document.getElementById("apiServer").value;
  const apiModel = document.getElementById("apiModel").value;
  const historyLimit = parseInt(document.getElementById("historyLimit").value, 10);

  // Валидация значения historyLimit
  if (isNaN(historyLimit) || historyLimit < 0 || historyLimit > 1000) {
    alert("Пожалуйста, введите корректное число для количества записей в истории (0-1000).");
    return;
  }

  chrome.storage.sync.set({ 
    apiKey, 
    apiServer, 
    apiModel, 
    menuItems,
    historyLimit 
  }, () => {
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

// Функции экспорта и импорта остаются без изменений
// ...

// Функция для экспорта настроек
document.getElementById("export").addEventListener("click", () => {
  chrome.storage.sync.get(["apiKey", "apiServer", "apiModel", "menuItems", "historyLimit"], (settings) => {
    const dataStr = JSON.stringify(settings, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "ai_text_tools_settings.json";
    a.click();

    URL.revokeObjectURL(url);
  });
});

// Функция для импорта настроек
document.getElementById("import").addEventListener("click", () => {
  const fileInput = document.getElementById("import-file");
  const file = fileInput.files[0];

  if (!file) {
    alert("Пожалуйста, выберите файл для импорта.");
    return;
  }

  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const importedSettings = JSON.parse(event.target.result);
      
      // Валидация импортированных данных
      if (
        typeof importedSettings.apiKey !== "undefined" &&
        typeof importedSettings.apiServer !== "undefined" &&
        typeof importedSettings.apiModel !== "undefined" &&
        Array.isArray(importedSettings.menuItems) &&
        typeof importedSettings.historyLimit === "number" &&
        importedSettings.historyLimit >= 0 &&
        importedSettings.historyLimit <= 1000
      ) {
        chrome.storage.sync.set(importedSettings, () => { // Изменено на storage.sync
          // Отправляем сообщение в background.js для обновления контекстного меню
          chrome.runtime.sendMessage({ action: "updateContextMenu" }, (response) => {
            if (chrome.runtime.lastError) {
              console.error(chrome.runtime.lastError);
              alert("Произошла ошибка при обновлении контекстного меню.");
            } else {
              alert("Настройки успешно импортированы!");
              // Обновляем интерфейс
              document.getElementById("apiKey").value = importedSettings.apiKey || "";
              document.getElementById("apiServer").value = importedSettings.apiServer || "https://api.openai.com/v1";
              document.getElementById("apiModel").value = importedSettings.apiModel || "gpt-4";
              
              menuItems = importedSettings.menuItems || [];
              displayMenuItems();

              document.getElementById("historyLimit").value = importedSettings.historyLimit || 20;
            }
          });
        });
      } else {
        throw new Error("Файл содержит некорректные данные.");
      }
    } catch (error) {
      console.error("Ошибка при импорте настроек:", error);
      alert("Не удалось импортировать настройки: " + error.message);
    }
  };

  reader.onerror = () => {
    console.error("Ошибка чтения файла.");
    alert("Не удалось прочитать файл.");
  };

  reader.readAsText(file);
});