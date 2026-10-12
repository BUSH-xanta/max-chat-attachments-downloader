const fields = ["from", "to", "folder", "delay", "every", "cooldown", "exclude"];
const defaults = { from: "", to: "", folder: "MAX", delay: 3, every: 30, cooldown: 5, exclude: "ЗАЛ" };

async function load() {
  const { settings = defaults, runState } = await browser.storage.local.get(["settings", "runState"]);
  for (const id of fields) document.getElementById(id).value = settings[id] ?? defaults[id];
  if (runState?.running) document.getElementById("status").textContent = runState.cooldownUntil
    ? `Cooldown до ${new Date(runState.cooldownUntil).toLocaleTimeString()}`
    : `В работе. Успешно: ${runState.successCount || 0}; ошибок: ${runState.failures?.length || 0}`;
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
  document.getElementById("status").textContent = result?.error || "Запуск принят.";
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

