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

// Отображение индикатора загрузки с добавлением спинера
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
        indicator.style.padding = "20px 30px";
        indicator.style.zIndex = 10000;
        indicator.style.fontFamily = "Arial, sans-serif";
        indicator.style.fontSize = "16px";
        indicator.style.color = "#151515"; // Тёмный текст
        indicator.style.textAlign = "center";
        indicator.style.minWidth = "250px";
        indicator.style.minHeight = "60px";
        indicator.style.boxSizing = "border-box";
        indicator.style.borderRadius = "8px"; // Закругленные углы
        indicator.style.display = "flex";
        indicator.style.alignItems = "center";
        indicator.style.justifyContent = "center";

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

        // Создание спинера
        const spinner = document.createElement("div");
        spinner.style.border = "4px solid rgba(0, 0, 0, 0.1)";
        spinner.style.width = "24px";
        spinner.style.height = "24px";
        spinner.style.borderRadius = "50%";
        spinner.style.borderLeftColor = "#09f";
        spinner.style.animation = "spin 1s linear infinite";
        spinner.style.marginRight = "10px";

        // Добавление анимации спинера
        const spinnerStyle = document.createElement("style");
        spinnerStyle.innerHTML = `
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `;
        document.head.appendChild(spinnerStyle);

        const text = document.createElement("div");
        text.innerText = "Обрабатывается запрос...";

        indicator.appendChild(closeButton);
        indicator.appendChild(spinner);
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

// Отображение результата или ошибки с поддержкой Markdown
function displayModal(tabId, message, isError = false) {
  // Загружаем библиотеку Marked
  chrome.scripting.executeScript({
    target: { tabId },
    files: ['marked.min.js'],
  }, () => {
    // После загрузки Marked создаём модальное окно
    chrome.scripting.executeScript({
      target: { tabId },
      func: (content, isError) => {
        // Удаляем существующее модальное окно, если оно есть
        const existingModal = document.getElementById("ai-result-modal");
        if (existingModal) {
          existingModal.remove();
        }

        // Создаём модальное окно
        const modal = document.createElement("div");
        modal.id = "ai-result-modal";

        // Стили для модального окна
        modal.style.position = "fixed";
        modal.style.top = "50%";
        modal.style.left = "50%";
        modal.style.transform = "translate(-50%, -50%)";
        modal.style.backgroundColor = isError ? "rgba(255, 152, 152, 0.99)" : "rgba(220, 226, 226, 0.99)"; // Полупрозрачный красный для ошибок и светлый для обычных сообщений
        modal.style.border = "1px solid #ffffff"; // Белая рамка
        modal.style.padding = "20px";
        modal.style.zIndex = 10000;
        modal.style.maxWidth = "80%";
        modal.style.maxHeight = "80%";
        modal.style.overflow = "auto";
        modal.style.fontFamily = "Arial, sans-serif";
        modal.style.fontSize = "14px";
        modal.style.color = "#151515"; // Тёмный текст
        modal.style.borderRadius = "8px"; // Закругленные углы
        modal.style.boxShadow = "0 0 10px rgba(0, 0, 0, 0.5)"; // Тень для выделения

        // Создаём контейнер для содержимого
        const contentContainer = document.createElement("div");
        contentContainer.style.marginBottom = "20px";
        contentContainer.innerHTML = marked.parse(content); // Парсинг Markdown

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
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(content).then(() => {
              const originalText = copyButton.innerText;
              copyButton.innerText = "Скопировано";
              setTimeout(() => {
                copyButton.innerText = originalText;
              }, 1000);
            }).catch(err => {
              alert("Ошибка при копировании текста: " + err);
            });
          } else {
            // Резервный метод копирования
            try {
              const textarea = document.createElement("textarea");
              textarea.value = content;
              // Сделать textarea невидимой
              textarea.style.position = "fixed";
              textarea.style.top = "-9999px";
              document.body.appendChild(textarea);
              textarea.focus();
              textarea.select();
              const successful = document.execCommand('copy');
              document.body.removeChild(textarea);
              if (successful) {
                const originalText = copyButton.innerText;
                copyButton.innerText = "Скопировано";
                setTimeout(() => {
                  copyButton.innerText = originalText;
                }, 1000);
              } else {
                throw new Error("Не удалось скопировать текст.");
              }
            } catch (err) {
              alert("Ошибка при копировании текста: " + err);
            }
          }
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

        // Добавляем модальное окно в документ
        document.body.appendChild(modal);

        // Добавляем стили для Markdown-элементов
        const style = document.createElement("style");
        style.innerHTML = `
          #ai-result-modal h1, #ai-result-modal h2, #ai-result-modal h3 {
            color: #151515;
          }
          #ai-result-modal a {
            color: #1e90ff;
            text-decoration: none;
          }
          #ai-result-modal a:hover {
            text-decoration: underline;
          }
          #ai-result-modal pre {
            background-color: rgba(40, 40, 40, 1); /* Темный фон */
            color: #ffffff; /* Белый текст для контраста */
            padding: 10px;
            border-radius: 4px;
            overflow: auto;
          }
          #ai-result-modal code {
            background-color: rgba(40, 40, 40, 1); /* Темный фон */
            color: #ffffff; /* Белый текст для контраста */
            padding: 2px 4px;
            border-radius: 4px;
          }
          #ai-result-modal ul, #ai-result-modal ol {
            margin-left: 20px;
          }
        `;
        document.head.appendChild(style);
      },
      args: [message, isError]
    });
  });
}

// Инициализация модального окна без содержимого для стриминга
function initializeModal(tabId, isError = false) {
  chrome.scripting.executeScript({
    target: { tabId },
    files: ['marked.min.js'],
  }, () => {
    // После загрузки Marked создаём пустое модальное окно
    chrome.scripting.executeScript({
      target: { tabId },
      func: (isError) => {
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
        modal.style.backgroundColor = isError ? "rgba(255, 152, 152, 0.99)" : "rgba(220, 226, 226, 0.99)";
        modal.style.border = "1px solid #ffffff";
        modal.style.padding = "20px";
        modal.style.zIndex = 10000;
        modal.style.maxWidth = "80%";
        modal.style.maxHeight = "80%";
        modal.style.overflow = "auto";
        modal.style.fontFamily = "Arial, sans-serif";
        modal.style.fontSize = "14px";
        modal.style.color = "#151515";
        modal.style.borderRadius = "8px";
        modal.style.boxShadow = "0 0 10px rgba(0, 0, 0, 0.5)";

        // Создаём контейнер для содержимого
        const contentContainer = document.createElement("div");
        contentContainer.style.marginBottom = "20px";
        contentContainer.innerHTML = "<em>Ожидаем ответ...</em>";

        // Кнопка "Копировать"
        const copyButton = document.createElement("button");
        copyButton.innerText = "Копировать";
        copyButton.style.display = "inline-block";
        copyButton.style.marginRight = "10px";
        copyButton.style.padding = "5px 10px";
        copyButton.style.cursor = "pointer";
        copyButton.style.border = "none";
        copyButton.style.borderRadius = "4px";
        copyButton.style.backgroundColor = "#4CAF50";
        copyButton.style.color = "#ffffff";
        copyButton.addEventListener("click", () => {
          const textToCopy = contentContainer.innerText;
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(textToCopy).then(() => {
              const originalText = copyButton.innerText;
              copyButton.innerText = "Скопировано";
              setTimeout(() => {
                copyButton.innerText = originalText;
              }, 1000);
            }).catch(err => {
              alert("Ошибка при копировании текста: " + err);
            });
          } else {
            try {
              const textarea = document.createElement("textarea");
              textarea.value = textToCopy;
              textarea.style.position = "fixed";
              textarea.style.top = "-9999px";
              document.body.appendChild(textarea);
              textarea.focus();
              textarea.select();
              const successful = document.execCommand('copy');
              document.body.removeChild(textarea);
              if (successful) {
                const originalText = copyButton.innerText;
                copyButton.innerText = "Скопировано";
                setTimeout(() => {
                  copyButton.innerText = originalText;
                }, 1000);
              } else {
                throw new Error("Не удалось скопировать текст.");
              }
            } catch (err) {
              alert("Ошибка при копировании текста: " + err);
            }
          }
        });

        // Кнопка "Закрыть"
        const closeButton = document.createElement("button");
        closeButton.innerText = "Закрыть";
        closeButton.style.display = "inline-block";
        closeButton.style.padding = "5px 10px";
        closeButton.style.cursor = "pointer";
        closeButton.style.border = "none";
        closeButton.style.borderRadius = "4px";
        closeButton.style.backgroundColor = "#f44336";
        closeButton.style.color = "#ffffff";
        closeButton.addEventListener("click", () => modal.remove());

        modal.appendChild(contentContainer);
        modal.appendChild(copyButton);
        modal.appendChild(closeButton);

        document.body.appendChild(modal);

        // Добавляем стили для Markdown-элементов
        const style = document.createElement("style");
        style.innerHTML = `
          #ai-result-modal h1, #ai-result-modal h2, #ai-result-modal h3 {
            color: #151515;
          }
          #ai-result-modal a {
            color: #1e90ff;
            text-decoration: none;
          }
          #ai-result-modal a:hover {
            text-decoration: underline;
          }
          #ai-result-modal pre {
            background-color: rgba(40, 40, 40, 1);
            color: #ffffff;
            padding: 10px;
            border-radius: 4px;
            overflow: auto;
          }
          #ai-result-modal code {
            background-color: rgba(40, 40, 40, 1);
            color: #ffffff;
            padding: 2px 4px;
            border-radius: 4px;
          }
          #ai-result-modal ul, #ai-result-modal ol {
            margin-left: 20px;
          }
        `;
        document.head.appendChild(style);
      },
      args: [isError]
    });
  });
}

// Функция для обновления содержимого модального окна по мере поступления данных
function updateModalContent(tabId, newContent) {
  chrome.scripting.executeScript({
    target: { tabId },
    func: (newContent) => {
      const modal = document.getElementById("ai-result-modal");
      if (!modal) return;
      const contentContainer = modal.querySelector("div");
      if (contentContainer) {
        // Используем marked для парсинга Markdown
        contentContainer.innerHTML = marked.parse(newContent);
      }
    },
    args: [newContent]
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

// Обновленная функция processPrompt с поддержкой стриминга и удалением спиннера при первом чанке
function processPrompt(tabId, apiServer, apiKey, apiModel, prompt) {
  showLoadingIndicator(tabId); // Показать индикатор

  // Включаем режим стриминга
  const requestBody = {
    model: apiModel,
    messages: [{ role: "user", content: prompt }],
    stream: true
  };

  fetch(`${apiServer}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify(requestBody)
  })
    .then(response => {
      if (!response.ok) {
        return response.text().then(errorText => {
          throw new Error(`Ошибка API: ${response.status} ${response.statusText}. ${errorText}`);
        });
      }
      // Инициализируем пустое модальное окно для стриминга
      initializeModal(tabId, false);
      return response.body;
    })
    .then(async (body) => {
      if (!body) {
        throw new Error("Нет тела ответа.");
      }

      const reader = body.getReader();
      const decoder = new TextDecoder('utf-8');
      let done = false;
      let accumulatedText = '';
      let isFirstChunk = true; // Флаг для первого чанка

      while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        if (value) {
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const jsonStr = line.slice('data: '.length).trim();
              if (jsonStr === '[DONE]') {
                done = true;
                break;
              }
              try {
                const json = JSON.parse(jsonStr);
                const delta = json.choices?.[0]?.delta?.content;
                if (delta) {
                  accumulatedText += delta;
                  updateModalContent(tabId, accumulatedText);
                  
                  if (isFirstChunk) {
                    removeLoadingIndicator(tabId); // Удалить спиннер при первом чанке
                    isFirstChunk = false;
                  }
                }
              } catch (err) {
                console.error("Ошибка парсинга строки стрима:", err);
              }
            }
          }
        }
      }
    })
    .catch(error => {
      console.error("Ошибка обработки запроса:", error);
      // Если возникла ошибка – инициализируем окно ошибки
      initializeModal(tabId, true);
      updateModalContent(tabId, `Произошла ошибка: ${error.message}`);
    });
    // Удаляем вызов removeLoadingIndicator из блока finally
}
