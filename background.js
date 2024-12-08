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

// Функция для добавления кнопки "Копировать" к каждому блоку кода
function addCopyButtons() {
  const codeBlocks = document.querySelectorAll("#ai-result-modal pre code");
  
  codeBlocks.forEach((codeBlock) => {
    // Проверяем, есть ли уже кнопка "Копировать"
    if (codeBlock.parentElement.querySelector(".copy-button")) return;
    
    // Создаем кнопку "Копировать"
    const copyButton = document.createElement("button");
    copyButton.innerText = "Копировать";
    copyButton.className = "copy-button";
    
    // Оборачиваем блок кода в контейнер с относительным позиционированием
    const codeContainer = codeBlock.parentElement;
    codeContainer.style.position = "relative";
    codeContainer.appendChild(copyButton);
    
    // Обработчик клика для копирования кода
    copyButton.addEventListener("click", () => {
      const codeText = codeBlock.innerText;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(codeText).then(() => {
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
          textarea.value = codeText;
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
  });
}

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
        const existingModal = document.getElementById("ai-result-modal-overlay");
        if (existingModal) {
          existingModal.remove();
        }

        // Создаём оверлей для модального окна
        const overlay = document.createElement("div");
        overlay.id = "ai-result-modal-overlay";

        // Стили для оверлея
        Object.assign(overlay.style, {
          position: "fixed",
          top: "0",
          left: "0",
          width: "100vw",
          height: "100vh",
          backgroundColor: "rgba(0, 0, 0, 0.5)",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          zIndex: 10000,
          overflow: "auto"
        });

        // Создаём модальное окно
        const modal = document.createElement("div");
        modal.id = "ai-result-modal";

        // Стили для модального окна
        Object.assign(modal.style, {
          backgroundColor: isError ? "rgba(255, 152, 152, 0.98)" : "rgba(220, 226, 226, 0.98)",
          border: "1px solid #ffffff",
          padding: "20px",
          maxWidth: "65vw",
          maxHeight: "80vh",
          overflow: "auto",
          fontFamily: "Arial, sans-serif",
          fontSize: "14px",
          color: "#151515",
          borderRadius: "8px",
          boxShadow: "0 0 10px rgba(0, 0, 0, 0.5)",
          position: "relative"
        });

        // Создаём контейнер для содержимого
        const contentContainer = document.createElement("div");
        contentContainer.style.marginBottom = "20px";
        contentContainer.innerHTML = marked.parse(content);

        // Кнопка "Копировать весь текст"
        const copyButton = document.createElement("button");
        copyButton.innerText = "Копировать весь текст";
        copyButton.style.padding = "5px 10px";
        copyButton.style.cursor = "pointer";
        copyButton.style.border = "none";
        copyButton.style.borderRadius = "4px";
        copyButton.style.backgroundColor = "#4CAF50";
        copyButton.style.color = "#ffffff";
        copyButton.addEventListener("click", () => {
          // Логика копирования всего текста
          const clone = contentContainer.cloneNode(true);
          const buttons = clone.querySelectorAll('.copy-button');
          buttons.forEach(btn => btn.remove());
          const textToCopy = clone.innerText;

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
              const successful = document.execCommand("copy");
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
        closeButton.style.padding = "5px 10px";
        closeButton.style.cursor = "pointer";
        closeButton.style.border = "none";
        closeButton.style.borderRadius = "4px";
        closeButton.style.backgroundColor = "#f44336";
        closeButton.style.color = "#ffffff";
        closeButton.addEventListener("click", () => overlay.remove());

        // Создаём контейнер для кнопок с Flexbox
        const buttonsContainer = document.createElement("div");
        buttonsContainer.style.display = "flex";
        buttonsContainer.style.justifyContent = "center"; // Центрирование кнопок
        buttonsContainer.style.gap = "10px"; // Расстояние между кнопками
        buttonsContainer.style.marginTop = "20px"; // Отступ сверху

        // Добавляем кнопки в контейнер
        buttonsContainer.appendChild(copyButton);
        buttonsContainer.appendChild(closeButton);

        // Добавляем содержимое и контейнер с кнопками в модальное окно
        modal.appendChild(contentContainer);
        modal.appendChild(buttonsContainer);

        // Добавляем модальное окно в оверлей
        overlay.appendChild(modal);

        // Добавляем оверлей в документ
        document.body.appendChild(overlay);

        // Добавляем стили для Markdown-элементов, таблиц и кнопок "Копировать"
        const style = document.createElement("style");
        style.innerHTML = `
          /* Заголовки */
          #ai-result-modal h1, #ai-result-modal h2, #ai-result-modal h3 {
            color: #151515;
          }
          /* Ссылки */
          #ai-result-modal a {
            color: #1e90ff;
            text-decoration: none;
          }
          #ai-result-modal a:hover {
            text-decoration: underline;
          }
          /* Таблицы */
          #ai-result-modal table {
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
          }
          #ai-result-modal th, #ai-result-modal td {
            border: 1px solid #000; /* Толщина 1px и чёрный цвет границы */
            padding: 10px; /* Увеличенные отступы */
            text-align: left;
          }
          #ai-result-modal th {
            background-color: #BDD7EE; /* Фон заголовка */
            font-weight: bold;
          }
          #ai-result-modal tr:nth-child(even) {
            background-color: #D9D9D9; /* Чередование чётных строк */
          }
          #ai-result-modal tr:nth-child(odd) {
            background-color: #F2F2F2; /* Чередование нечётных строк */
          }
          #ai-result-modal tr:hover {
            background-color: #FFF2CC; /* Эффект наведения */
          }
          /* Блоки кода */
          #ai-result-modal pre {
            background-color: rgba(40, 40, 40, 1);
            color: #ffffff;
            padding: 10px;
            border-radius: 4px;
            overflow: auto;
            position: relative;
            margin: 10px 0;
          }
          #ai-result-modal code {
            background-color: rgba(40, 40, 40, 1);
            color: #ffffff;
            padding: 2px 4px;
            border-radius: 4px;
          }
          /* Списки */
          #ai-result-modal ul, #ai-result-modal ol {
            margin-left: 20px;
          }
          /* Кнопки "Копировать" внутри блоков кода */
          .copy-button {
            position: absolute;
            top: 5px;
            right: 5px;
            padding: 5px 10px;
            font-size: 12px;
            cursor: pointer;
            background-color: #4CAF50;
            color: #ffffff;
            border: none;
            border-radius: 4px;
          }
        `;
        document.head.appendChild(style);

        // Добавляем кнопки "Копировать" к блокам кода
        addCopyButtons();
      },
      args: [message, isError]
    });
  });
}

function initializeModal(tabId, isError = false) {
  chrome.scripting.executeScript({
    target: { tabId },
    files: ['marked.min.js'],
  }, () => {
    // После загрузки Marked создаём пустое модальное окно
    chrome.scripting.executeScript({
      target: { tabId },
      func: (isError) => {
        const existingModal = document.getElementById("ai-result-modal-overlay");
        if (existingModal) {
          existingModal.remove();
        }

        // Создаём оверлей для модального окна
        const overlay = document.createElement("div");
        overlay.id = "ai-result-modal-overlay";

        // Стили для оверлея
        Object.assign(overlay.style, {
          position: "fixed",
          top: "0",
          left: "0",
          width: "100vw",
          height: "100vh",
          backgroundColor: "rgba(0, 0, 0, 0.5)",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          zIndex: 10000,
          overflow: "auto"
        });

        // Создаём модальное окно
        const modal = document.createElement("div");
        modal.id = "ai-result-modal";

        // Стили для модального окна
        Object.assign(modal.style, {
          backgroundColor: isError ? "rgba(255, 152, 152, 0.98)" : "rgba(220, 226, 226, 0.98)",
          border: "1px solid #ffffff",
          padding: "20px",
          maxWidth: "65vw",
          maxHeight: "80vh",
          overflow: "auto",
          fontFamily: "Arial, sans-serif",
          fontSize: "14px",
          color: "#151515",
          borderRadius: "8px",
          boxShadow: "0 0 10px rgba(0, 0, 0, 0.5)",
          position: "relative"
        });

        // Создаём контейнер для содержимого
        const contentContainer = document.createElement("div");
        contentContainer.style.marginBottom = "20px";
        contentContainer.innerHTML = "<em>Ожидаем ответ...</em>";

        // Кнопка "Копировать весь текст"
        const copyButton = document.createElement("button");
        copyButton.innerText = "Копировать весь текст";
        copyButton.style.padding = "5px 10px";
        copyButton.style.cursor = "pointer";
        copyButton.style.border = "none";
        copyButton.style.borderRadius = "4px";
        copyButton.style.backgroundColor = "#4CAF50";
        copyButton.style.color = "#ffffff";
        copyButton.addEventListener("click", () => {
          // Логика копирования всего текста
          const clone = contentContainer.cloneNode(true);
          const buttons = clone.querySelectorAll('.copy-button');
          buttons.forEach(btn => btn.remove());
          const textToCopy = clone.innerText;

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
              const successful = document.execCommand("copy");
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
        closeButton.style.padding = "5px 10px";
        closeButton.style.cursor = "pointer";
        closeButton.style.border = "none";
        closeButton.style.borderRadius = "4px";
        closeButton.style.backgroundColor = "#f44336";
        closeButton.style.color = "#ffffff";
        closeButton.addEventListener("click", () => overlay.remove());

        // Создаём контейнер дл�� кнопок с Flexbox
        const buttonsContainer = document.createElement("div");
        buttonsContainer.style.display = "flex";
        buttonsContainer.style.justifyContent = "center"; // Центрирование кнопок
        buttonsContainer.style.gap = "10px"; // Расстояние между кнопками
        buttonsContainer.style.marginTop = "20px"; // Отступ сверху

        // Добавляем кнопки в контейнер
        buttonsContainer.appendChild(copyButton);
        buttonsContainer.appendChild(closeButton);

        // Добавляем содержимое и контейнер с кнопками в модальное окно
        modal.appendChild(contentContainer);
        modal.appendChild(buttonsContainer);

        // Добавляем модальное окно в оверлей
        overlay.appendChild(modal);

        // Добавляем оверлей в документ
        document.body.appendChild(overlay);

        // Добавляем стили для Markdown-элементов, таблиц и кнопок "Копировать"
        const style = document.createElement("style");
        style.innerHTML = `
          /* Заголовки */
          #ai-result-modal h1, #ai-result-modal h2, #ai-result-modal h3 {
            color: #151515;
          }
          /* Ссылки */
          #ai-result-modal a {
            color: #1e90ff;
            text-decoration: none;
          }
          #ai-result-modal a:hover {
            text-decoration: underline;
          }
          /* Таблицы */
          #ai-result-modal table {
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
          }
          #ai-result-modal th, #ai-result-modal td {
            border: 1px solid #000; /* Толщина 1px и чёрный цвет границы */
            padding: 10px; /* Увеличенные отступы */
            text-align: left;
          }
          #ai-result-modal th {
            background-color: #BDD7EE; /* Фон заголовка */
            font-weight: bold;
          }
          #ai-result-modal tr:nth-child(even) {
            background-color: #D9D9D9; /* Чередование чётных строк */
          }
          #ai-result-modal tr:nth-child(odd) {
            background-color: #F2F2F2; /* Чередование нечётных строк */
          }
          #ai-result-modal tr:hover {
            background-color: #FFF2CC; /* Эффект наведения */
          }
          /* Блоки кода */
          #ai-result-modal pre {
            background-color: rgba(40, 40, 40, 1);
            color: #ffffff;
            padding: 10px;
            border-radius: 4px;
            overflow: auto;
            position: relative;
            margin: 10px 0;
          }
          #ai-result-modal code {
            background-color: rgba(40, 40, 40, 1);
            color: #ffffff;
            padding: 2px 4px;
            border-radius: 4px;
          }
          /* Списки */
          #ai-result-modal ul, #ai-result-modal ol {
            margin-left: 20px;
          }
          /* Кнопки "Копировать" внутри блоков кода */
          .copy-button {
            position: absolute;
            top: 5px;
            right: 5px;
            padding: 5px 10px;
            font-size: 12px;
            cursor: pointer;
            background-color: #4CAF50;
            color: #ffffff;
            border: none;
            border-radius: 4px;
          }
        `;
        document.head.appendChild(style);

        // Добавляем кнопки "Копировать" к блокам кода
        addCopyButtons();
      },
      args: [isError]
    });
  });
}

// Обновленная функция updateModalContent с использованием Flexbox и исправленными стилями
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
        
        // Добавляем кнопки "Копировать" к новым блокам кода
        const codeBlocks = contentContainer.querySelectorAll("pre code");
        codeBlocks.forEach((codeBlock) => {
          // Проверяем, есть ли уже кнопка "Копировать"
          if (codeBlock.parentElement.querySelector(".copy-button")) return;
          
          // Создаем кнопку "Копировать"
          const copyButton = document.createElement("button");
          copyButton.innerText = "Копировать";
          copyButton.className = "copy-button";
          
          // Оборачиваем блок кода в контейнер с относительным позиционированием
          const codeContainer = codeBlock.parentElement;
          codeContainer.style.position = "relative";
          codeContainer.appendChild(copyButton);
          
          // Обработчик клика для копирования кода
          copyButton.addEventListener("click", () => {
            const codeText = codeBlock.innerText;
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(codeText).then(() => {
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
                textarea.value = codeText;
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
        });
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

// Функция для добавления записи в историю запросов с учётом настраиваемого количества записей
function addToHistory(query, response) {
  // Сначала проверяем historyLimit
  chrome.storage.sync.get(['historyLimit'], (data) => { // Изменено на storage.sync
    const historyLimit = typeof data.historyLimit === 'number' ? data.historyLimit : 20;
    
    // Если historyLimit равен 0, не сохраняем историю
    if (historyLimit === 0) {
      // Очищаем существующую историю
      chrome.storage.local.remove('history', () => {
        console.log('История очищена, так как historyLimit = 0');
      });
      return;
    }

    const timestamp = new Date();
    const entry = {
      date: timestamp.toLocaleDateString(),
      time: timestamp.toLocaleTimeString(),
      query: query,
      response: response
    };

    // Получаем текущую историю
    chrome.storage.local.get(['history'], (data) => {
      let history = data.history || [];

      // Добавляем новую запись в начало массива
      history.unshift(entry);

      // Оставляем только последние historyLimit записей
      if (history.length > historyLimit) {
        history = history.slice(0, historyLimit);
      }

      // Сохраняем обновленную историю
      chrome.storage.local.set({ history }, () => {
        console.log(`История обновлена. Сохранено ${history.length} записей из ${historyLimit} возможных.`);
      });
    });
  });
}

// Обновлённая функция processPrompt с добавленным вызовом addToHistory
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
      let buffer = ""; // Буфер для накопления данных

      while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        if (value) {
          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk; // Накопление данных в буфер

          let lines = buffer.split('\n');
          buffer = lines.pop(); // Оставляем неполную строку в буфере

          for (const line of lines) {
            const trimmedLine = line.trim();
            if (trimmedLine.startsWith('data: ')) {
              const jsonStr = trimmedLine.slice('data: '.length).trim();
              if (jsonStr === '[DONE]') {
                done = true;
                break;
              }
              if (jsonStr) { // Проверка, что строка не пуста
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
                  // Можно добавить дополнительную логику для восстановления или пропуска
                }
              }
            }
          }
        }
      }

      // Обработка оставшегося буфера, если необходимо
      if (buffer) {
        const trimmedLine = buffer.trim();
        if (trimmedLine.startsWith('data: ')) {
          const jsonStr = trimmedLine.slice('data: '.length).trim();
          if (jsonStr && jsonStr !== '[DONE]') {
            try {
              const json = JSON.parse(jsonStr);
              const delta = json.choices?.[0]?.delta?.content;
              if (delta) {
                accumulatedText += delta;
                updateModalContent(tabId, accumulatedText);
              }
            } catch (err) {
              console.error("Ошибка парсинга оставшейся строки стрима:", err);
            }
          }
        }
      }

      // Добавляем запись в историю после успешного получения ответа
      addToHistory(prompt, accumulatedText);
    })
    .catch(error => {
      console.error("Ошибка обработки запроса:", error);
      // Если возникла ошибка – инициализируем окно ошибки
      initializeModal(tabId, true);
      updateModalContent(tabId, `Произошла ошибка: ${error.message}`);
    });
  // Удаляем вызов removeLoadingIndicator из блока finally
}

// Остальной код background.js остается без изменений

// Обработчик нажатия на значок расширения
chrome.action.onClicked.addListener(async (tab) => {
  try {
    // Получаем активную вкладку, если tab не определён
    if (!tab) {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      tab = activeTab;
      if (!tab) {
        throw new Error("Не удалось определить активную вкладку.");
      }
    }

    // Получаем настройки из хранилища
    chrome.storage.sync.get(["apiKey", "apiServer", "apiModel"], async (settings) => {
      const { apiKey, apiServer = "https://api.openai.com/v1", apiModel = "gpt-4" } = settings;

      if (!apiKey) {
        displayModal(tab.id, "API-ключ не задан в настройках.", true);
        return;
      }

      // Проверяем наличие выделенного текста
      const selectionResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => window.getSelection().toString()
      });
      const selectedText = selectionResults[0]?.result || "";

      if (selectedText) {
        // Если есть выделенный текст – логика "Свой запрос..."
        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              const userPrompt = prompt("Введите ваш запрос для выделенного текста:");
              return userPrompt;
            },
          });
          const userPrompt = results[0].result;
          if (userPrompt) {
            let prompt = `${userPrompt}: "{{selectionText}}"`;
            prompt = prompt.replace(/{{selectionText}}/g, selectedText);

            processPrompt(tab.id, apiServer, apiKey, apiModel, prompt);
          }
        } catch (error) {
          console.error("Ошибка при получении пользовательского запроса:", error);
          displayModal(tab.id, "Не удалось получить пользовательский запрос.", true);
        }
      } else {
        // Если выделенного текста нет – логика "Спросить AI"
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
          }
        } catch (error) {
          console.error("Ошибка при получении пользовательского запроса:", error);
          displayModal(tab.id, "Не удалось получить пользовательский запрос.", true);
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

