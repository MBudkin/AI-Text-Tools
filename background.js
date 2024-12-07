// Функция для создания пунктов контекстного меню
function createContextMenuItems(menuItems) {
  chrome.contextMenus.removeAll(() => {
    // Добавляем в контекстное меню только те пункты, в промпте которых есть {{selectionText}}
    menuItems.forEach((item, index) => {
      if (item.prompt.includes("{{selectionText}}")) {
        chrome.contextMenus.create({
          id: `menu-item-${index}`,
          title: item.title,
          contexts: ["selection"] // Показывать только при выделенном тексте
        });
      }
    });

    // Добавляем пункт меню "Свой запрос..." для выделенного текста
    chrome.contextMenus.create({
      id: "custom-prompt",
      title: "Свой запрос...",
      contexts: ["selection"]
    });

    // Добавляем пункт меню "Спросить AI" при отсутствии выделенного текста
    chrome.contextMenus.create({
      id: "ask-ai",
      title: "Спросить AI",
      contexts: ["page", "editable"]
    });
  });
}

// При установке расширения
chrome.runtime.onInstalled.addListener(() => {
  // Проверяем, есть ли сохраненные пункты меню
  chrome.storage.sync.get("menuItems", (data) => {
    if (!data.menuItems || data.menuItems.length === 0) {
      // Если нет, инициализируем с дефолтными значениями
      const defaultMenuItems = [
        { title: "AI-ответ", prompt: 'Ответь на следующий текст: "{{selectionText}}"' },
        { title: "Пересказать кратко", prompt: 'Сделайте краткое резюме текста: "{{selectionText}}"' },
        { title: "Объяснить", prompt: 'Объясни текст простым языком: "{{selectionText}}"' },
        { title: "Перевести", prompt: 'Переведи текст: "{{selectionText}}"' },
        { title: "Сделать уникальным", prompt: 'Перепиши текст, сделав его уникальным: "{{selectionText}}"' }
      ];
      chrome.storage.sync.set({ menuItems: defaultMenuItems }, () => {
        createContextMenuItems(defaultMenuItems);
      });
    } else {
      createContextMenuItems(data.menuItems);
    }
  });
});

// Обработчик сообщений от других частей расширения
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "updateContextMenu") {
    chrome.storage.sync.get("menuItems", (data) => {
      createContextMenuItems(data.menuItems || []);
    });
    sendResponse({ status: "ok" });
  }
});

// Отображение индикатора загрузки
function showLoadingIndicator(tabId) {
  chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const existingIndicator = document.getElementById("ai-loading-indicator");
      if (!existingIndicator) {
        const indicator = document.createElement("div");
        indicator.id = "ai-loading-indicator";
        indicator.style.position = "fixed";
        indicator.style.top = "50%";
        indicator.style.left = "50%";
        indicator.style.transform = "translate(-50%, -50%)";
        indicator.style.backgroundColor = "rgba(220, 226, 226, 0.99)"; // Полупрозрачный тёмный фон
        indicator.style.border = "1px solid #ffffff"; // Белая рамка для контраста
        indicator.style.padding = "10px 20px";
        indicator.style.zIndex = 10000;
        indicator.style.fontFamily = "Arial, sans-serif";
        indicator.style.fontSize = "14px";
        indicator.style.color = "#151515"; // Белый текст
        indicator.style.textAlign = "center";
        indicator.style.minWidth = "200px";
        indicator.style.minHeight = "50px";
        indicator.style.boxSizing = "border-box";
        indicator.style.borderRadius = "8px"; // Закругленные углы

        // Кнопка закрытия (крестик)
        const closeButton = document.createElement("span");
        closeButton.innerHTML = "&times;";
        closeButton.style.position = "absolute";
        closeButton.style.top = "5px";
        closeButton.style.right = "10px";
        closeButton.style.cursor = "pointer";
        closeButton.style.fontSize = "20px";
        closeButton.style.color = "#151515";
        closeButton.addEventListener("click", () => {
          indicator.remove();
        });

        const text = document.createElement("div");
        text.innerText = "Обрабатывается запрос...";

        indicator.appendChild(closeButton);
        indicator.appendChild(text);

        document.body.appendChild(indicator);
      }
    }
  });
}

// Удаление индикатора загрузки
function removeLoadingIndicator(tabId) {
  chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const indicator = document.getElementById("ai-loading-indicator");
      if (indicator) {
        indicator.remove();
      }
    }
  });
}

// Отображение результата или ошибки
function displayModal(tabId, message, isError = false) {
  chrome.scripting.executeScript({
    target: { tabId },
    func: (content, isError) => {
      const existingModal = document.getElementById("ai-result-modal");
      if (existingModal) {
        existingModal.remove();
      }

      const modal = document.createElement("div");
      modal.id = "ai-result-modal";

      // Стили для модального окна
      modal.style.position = "fixed";
      modal.style.top = "50%";
      modal.style.left = "50%";
      modal.style.transform = "translate(-50%, -50%)";
      modal.style.backgroundColor = isError ? "rgba(255, 152, 152, 0.99)" : "rgba(220, 226, 226, 0.99)"; // Полупрозрачный красный для ошибок и тёмный для обычных сообщений
      modal.style.border = "1px solid #ffffff"; // Белая рамка
      modal.style.padding = "20px";
      modal.style.zIndex = 10000;
      modal.style.maxWidth = "80%";
      modal.style.maxHeight = "80%";
      modal.style.overflow = "auto";
      modal.style.fontFamily = "Arial, sans-serif";
      modal.style.fontSize = "14px";
      modal.style.color = "#151515"; // Белый текст
      modal.style.borderRadius = "8px"; // Закругленные углы
      modal.style.boxShadow = "0 0 10px rgba(0, 0, 0, 0.5)"; // Тень для выделения

      // Создаем контейнер для содержимого
      const contentContainer = document.createElement("div");
      contentContainer.style.marginBottom = "20px";
      contentContainer.innerText = content;

      // Кнопка "Копировать"
      const copyButton = document.createElement("button");
      copyButton.innerText = "Копировать";
      copyButton.style.display = "inline-block";
      copyButton.style.marginRight = "10px";
      copyButton.style.padding = "5px 10px";
      copyButton.style.cursor = "pointer";
      copyButton.style.border = "none";
      copyButton.style.borderRadius = "4px";
      copyButton.style.backgroundColor = "#4CAF50"; // Зеленая кнопка
      copyButton.style.color = "#ffffff";
      copyButton.addEventListener("click", () => {
        navigator.clipboard.writeText(content).then(() => {
          const originalText = copyButton.innerText;
          copyButton.innerText = "Скопировано";
          setTimeout(() => {
            copyButton.innerText = originalText;
          }, 1000);
        }).catch(err => {
          alert("Ошибка при копировании текста: " + err);
        });
      });

      // Кнопка "Закрыть"
      const closeButton = document.createElement("button");
      closeButton.innerText = "Закрыть";
      closeButton.style.display = "inline-block";
      closeButton.style.padding = "5px 10px";
      closeButton.style.cursor = "pointer";
      closeButton.style.border = "none";
      closeButton.style.borderRadius = "4px";
      closeButton.style.backgroundColor = "#f44336"; // Красная кнопка
      closeButton.style.color = "#ffffff";
      closeButton.addEventListener("click", () => modal.remove());

      // Добавляем содержимое и кнопки в модальное окно
      modal.appendChild(contentContainer);
      modal.appendChild(copyButton);
      modal.appendChild(closeButton);

      document.body.appendChild(modal);
    },
    args: [message, isError]
  });
}

// Обработчик кликов на пункты меню
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    // Проверяем, определён ли tab
    if (!tab) {
      // Получаем активную вкладку
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      tab = activeTab;
      if (!tab) {
        throw new Error("Не удалось определить активную вкладку.");
      }
    }

    chrome.storage.sync.get(["apiKey", "apiServer", "apiModel", "menuItems"], async (settings) => {
      const { apiKey, apiServer = "https://api.openai.com/v1", apiModel = "gpt-4", menuItems } = settings;

      if (!apiKey) {
        displayModal(tab.id, "API-ключ не задан в настройках.", true);
        return;
      }

      if (info.menuItemId === "custom-prompt" && info.selectionText) {
        // Обработка пользовательского запроса с выделенным текстом
        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              const userPrompt = prompt("Введите ваш запрос:");
              return userPrompt;
            },
          });
          const userPrompt = results[0].result;
          if (userPrompt) {
            let prompt = `${userPrompt}: "{{selectionText}}"`;
            prompt = prompt.replace(/{{selectionText}}/g, info.selectionText);

            processPrompt(tab.id, apiServer, apiKey, apiModel, prompt);
          } else {
            displayModal(tab.id, "Запрос не введен.", true);
          }
        } catch (error) {
          console.error("Ошибка при получении пользовательского запроса:", error);
          displayModal(tab.id, "Не удалось получить пользовательский запрос.", true);
        }
      } else if (info.menuItemId === "ask-ai") {
        // Обработка запроса без выделенного текста
        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              const userPrompt = prompt("Введите ваш запрос:");
              return userPrompt;
            },
          });
          const userPrompt = results[0].result;
          if (userPrompt) {
            let prompt = userPrompt;

            processPrompt(tab.id, apiServer, apiKey, apiModel, prompt);
          } else {
            displayModal(tab.id, "Запрос не введен.", true);
          }
        } catch (error) {
          console.error("Ошибка при получении пользовательского запроса:", error);
          displayModal(tab.id, "Не удалось получить пользовательский запрос.", true);
        }
      } else if (info.menuItemId && info.selectionText) {
        // Поиск выбранного пункта меню
        const menuItem = menuItems.find((item, index) => `menu-item-${index}` === info.menuItemId);
        if (menuItem) {
          let prompt = menuItem.prompt;
          prompt = prompt.replace(/{{selectionText}}/g, info.selectionText);
          processPrompt(tab.id, apiServer, apiKey, apiModel, prompt);
        }
      }
    });
  } catch (error) {
    console.error("Ошибка обработки запроса:", error);
    if (tab && tab.id) {
      displayModal(tab.id, `Произошла ошибка: ${error.message}`, true);
    }
  }
});

// Функция для обработки промпта и вызова API
function processPrompt(tabId, apiServer, apiKey, apiModel, prompt) {
  showLoadingIndicator(tabId); // Показать индикатор
  fetch(`${apiServer}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: apiModel,
      messages: [{ role: "user", content: prompt }]
    })
  })
  .then(response => {
    if (!response.ok) {
      return response.text().then(errorText => {
        throw new Error(`Ошибка API: ${response.status} ${response.statusText}. ${errorText}`);
      });
    }
    return response.json();
  })
  .then(data => {
    const resultText = data.choices?.[0]?.message?.content || "Ответ не получен.";
    displayModal(tabId, resultText); // Показать результат
  })
  .catch(error => {
    console.error("Ошибка обработки запроса:", error);
    displayModal(tabId, `Произошла ошибка: ${error.message}`, true); // Показать ошибку
  })
  .finally(() => {
    removeLoadingIndicator(tabId); // Удалить индикатор
  });
}
