const fields = ["from", "to", "folder", "delay", "every", "cooldown", "exclude"];
const defaults = { from: "", to: "", folder: "MAX", delay: 3, every: 30, cooldown: 5, exclude: "ЗАЛ" };

async function updateStatus() {
  const { runState } = await browser.storage.local.get("runState");
  const status = document.getElementById("status");
  if (!runState) { status.textContent = "Откройте чат MAX с вложениями."; return; }
  if (runState.fatalError) { status.textContent = `Остановка: ${runState.fatalError}`; return; }
  if (runState.cooldownUntil && Date.now() < runState.cooldownUntil) {
    status.textContent = `Cooldown до ${new Date(runState.cooldownUntil).toLocaleTimeString()}. Успешно: ${runState.successCount || 0}; ошибок: ${runState.failures?.length || 0}`;
    return;
  }
  if (runState.running) {
    const item = runState.currentItem ? `Скачивает: ${runState.currentItem.name}` : "Ищет вложения в чате…";
    status.textContent = `${item} Успешно: ${runState.successCount || 0}; пропущено: ${runState.skipped || 0}; ошибок: ${runState.failures?.length || 0}`;
    return;
  }
  if (runState.finishedAt) {
    status.textContent = `Готово. Успешно: ${runState.successCount || 0}; пропущено: ${runState.skipped || 0}; ошибок: ${runState.failures?.length || 0}`;
    return;
  }
  status.textContent = "Остановлено. Прогресс сохранён.";
}

async function load() {
  const { settings = defaults } = await browser.storage.local.get(["settings"]);
  for (const id of fields) document.getElementById(id).value = settings[id] ?? defaults[id];
  await updateStatus();
}

async function saveSettings() {
  const settings = Object.fromEntries(fields.map(id => [id, document.getElementById(id).value]));
  settings.delay = Number(settings.delay);
  settings.every = Number(settings.every);
  settings.cooldown = Number(settings.cooldown);
  await browser.storage.local.set({ settings });
  return settings;
}

document.getElementById("start").addEventListener("click", async () => {
  const settings = await saveSettings();
  if (!settings.from || !settings.to || settings.from > settings.to) {
    document.getElementById("status").textContent = "Укажите корректный диапазон дат.";
    return;
  }
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  const result = await browser.runtime.sendMessage({ type: "START", tabId: tab.id, settings });
  document.getElementById("status").textContent = result?.error || "Запуск принят; проверяю состояние…";
  await updateStatus();
});

document.getElementById("stop").addEventListener("click", async () => {
  await browser.runtime.sendMessage({ type: "STOP" });
  document.getElementById("status").textContent = "Остановлено. Прогресс сохранён.";
});

document.getElementById("export").addEventListener("click", async () => {
  const { runState = {} } = await browser.storage.local.get("runState");
  const blob = new Blob([JSON.stringify(runState, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  await browser.downloads.download({ url, filename: "MAX/run-log.json", conflictAction: "uniquify", saveAs: false });
  setTimeout(() => URL.revokeObjectURL(url), 60000);
});

load();
setInterval(updateStatus, 1000);

