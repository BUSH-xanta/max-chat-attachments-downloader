const api = typeof browser !== "undefined" ? browser : chrome;
const DEFAULTS = { folder: "MAX", delay: 3, every: 30, cooldown: 5, exclude: "ЗАЛ" };
let worker = null;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const cleanFolder = value => String(value || "MAX").replace(/[\\/:*?"<>|]/g, "_").replace(/^\.+|\.+$/g, "").slice(0, 80) || "MAX";

async function getState() {
  const { runState } = await api.storage.local.get("runState");
  return runState || { running: false, successCount: 0, failures: [], processed: {}, excluded: {}, failed: {}, skipped: 0 };
}
async function putState(s) { await api.storage.local.set({ runState: s }); }
function keyOf(item) { return item.key || `${item.date}|${item.name}`; }

async function send(tabId, payload) {
  try { return await api.tabs.sendMessage(tabId, payload); }
  catch { return null; }
}

async function downloadDirect(item, settings) {
  if (!item.url || !/^https?:/i.test(item.url)) return { error: "Нет прямой ссылки на файл; требуется загрузка кнопкой сайта." };
  const name = String(item.name || "attachment").replace(/[\\/:*?"<>|]/g, "_");
  const id = await api.downloads.download({
    url: item.url,
    filename: `${cleanFolder(settings.folder)}/${name}`,
    conflictAction: "uniquify",
    saveAs: false
  });
  return await new Promise(resolve => {
    const timeout = setTimeout(() => { api.downloads.onChanged.removeListener(listener); resolve({ error: "Тайм-аут ожидания загрузки" }); }, 120000);
    const listener = delta => {
      if (delta.id !== id) return;
      if (delta.state?.current === "complete") { clearTimeout(timeout); api.downloads.onChanged.removeListener(listener); resolve({ ok: true }); }
      if (delta.state?.current === "interrupted") { clearTimeout(timeout); api.downloads.onChanged.removeListener(listener); resolve({ error: delta.error?.current || "Загрузка прервана" }); }
    };
    api.downloads.onChanged.addListener(listener);
    api.downloads.search({ id }).then(items => {
      if (items[0]?.state === "complete") { clearTimeout(timeout); api.downloads.onChanged.removeListener(listener); resolve({ ok: true }); }
    });
  });
}

async function run(tabId, settings) {
  if (worker) return;
  worker = true;
  let state = await getState();
  const tab = await api.tabs.get(tabId).catch(() => null);
  const scope = tab?.url || String(tabId);
  if (state.scope && state.scope !== scope) state = { running: false, successCount: 0, failures: [], processed: {}, excluded: {}, failed: {}, skipped: 0 };
  state.running = true;
  state.tabId = tabId;
  state.scope = scope;
  state.settings = settings;
  await putState(state);
  try {
    while ((state = await getState()).running) {
      if (state.cooldownUntil && Date.now() < state.cooldownUntil) {
        await sleep(Math.min(5000, state.cooldownUntil - Date.now()));
        continue;
      }
      if (state.cooldownUntil) {
        state.cooldownUntil = null;
        await putState(state);
        try { await api.tabs.reload(tabId); } catch { state.running = false; await putState(state); break; }
        await sleep(5000);
      }
      const candidate = await send(tabId, { type: "NEXT_ITEM", from: settings.from, to: settings.to, processed: state.processed, excluded: state.excluded, failed: state.failed, exclude: settings.exclude });
      if (!candidate || candidate.done) {
        if (!candidate) { await sleep(3000); continue; }
        state.running = false;
        state.finishedAt = Date.now();
        await putState(state);
        break;
      }
      if (candidate.retry) { await sleep(2000); continue; }
      if (candidate.error) {
        state.running = false;
        state.fatalError = candidate.error;
        await putState(state);
        break;
      }
      const key = keyOf(candidate);
      if (candidate.excluded) {
        state.excluded[key] = { name: candidate.name, date: candidate.date };
        state.skipped = (state.skipped || 0) + 1;
        await putState(state);
        await send(tabId, { type: "ADVANCE" });
        continue;
      }
      const result = await downloadDirect(candidate, settings);
      if (result.ok) {
        state.processed[key] = { name: candidate.name, date: candidate.date, savedAt: Date.now() };
        state.successCount = (state.successCount || 0) + 1;
      } else {
        state.failures = state.failures || [];
        state.failures.push({ name: candidate.name, date: candidate.date, reason: result.error, at: Date.now() });
        state.failed = state.failed || {};
        state.failed[key] = { name: candidate.name, date: candidate.date, reason: result.error };
      }
      await putState(state);
      await send(tabId, { type: "ADVANCE" });
      if (state.successCount > 0 && state.successCount % Math.max(1, Number(settings.every) || 30) === 0) {
        state.cooldownUntil = Date.now() + Math.max(1, Number(settings.cooldown) || 5) * 60000;
        await putState(state);
      } else {
        await sleep(Math.max(1, Number(settings.delay) || 3) * 1000);
      }
    }
  } finally { worker = null; }
}

api.runtime.onMessage.addListener((message, sender) => {
  if (message.type === "START") {
    return run(message.tabId, { ...DEFAULTS, ...message.settings }).then(() => ({ ok: true }), error => ({ error: error.message }));
  }
  if (message.type === "STOP") return getState().then(async state => { state.running = false; await putState(state); return { ok: true }; });
  if (message.type === "STATUS") return getState();
  if (message.type === "EXPORT_LOG") return getState().then(state => ({ state }));
});

api.alarms?.onAlarm.addListener(alarm => { if (alarm.name === "resume") getState().then(s => s.running && run(s.tabId, s.settings)); });

