(() => {
  if (window.__maxDownloaderInstalled) return;
  window.__maxDownloaderInstalled = true;
  let phase = "seekStart";
  let stableBoundaryPasses = 0;
  let lastBoundaryDate = null;

  const parseDate = text => {
    const m = String(text).match(/\b(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})\b/);
    if (!m) return null;
    return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  };
  const fileNameIn = text => {
    const lines = String(text).split(/[\n\r]+/).map(s => s.trim()).filter(Boolean);
    return lines.find(s => /\.(xlsx?|docx?|pdf|zip|rar|7z|csv|pptx?|jpe?g|png)$/i.test(s)) ||
      lines.find(s => /Заявка\b/i.test(s)) || null;
  };
  function findScroller() {
    const controls = [...document.querySelectorAll("a,button,[role=button]")].filter(el =>
      /скачать|download/i.test(`${el.innerText || ""} ${el.getAttribute("aria-label") || ""} ${el.title || ""}`)
    );
    const candidates = new Map();
    for (const control of controls) {
      let node = control.parentElement;
      for (let depth = 0; node && depth < 12; depth++, node = node.parentElement) {
        const style = getComputedStyle(node);
        if (node.scrollHeight > node.clientHeight + 80 && /(auto|scroll)/.test(style.overflowY)) {
          const rect = node.getBoundingClientRect();
          const score = (rect.left > innerWidth * 0.25 ? 1000 : 0) + node.clientHeight + Math.min(node.clientWidth, 1200) / 4;
          const previous = candidates.get(node) || { count: 0, score };
          candidates.set(node, { count: previous.count + 1, score: Math.max(previous.score, score) });
        }
      }
    }
    const selected = [...candidates.entries()].sort((a, b) =>
      (b[1].count * 10000 + b[1].score) - (a[1].count * 10000 + a[1].score)
    )[0]?.[0];
    return selected || document.scrollingElement;
  }

  function requestOlderMessages(scroller) {
    const oldTop = scroller.scrollTop;
    scroller.scrollTop = 0;
    scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    if (Math.abs(oldTop) < 2) {
      scroller.scrollTop = 1;
      scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
      scroller.scrollTop = 0;
      scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    }
  }
  function collect() {
    const controls = [...document.querySelectorAll("a,button,[role=button]")];
    const entries = [];
    for (const control of controls) {
      const label = `${control.innerText || ""} ${control.getAttribute("aria-label") || ""} ${control.title || ""}`;
      if (!/скачать|download/i.test(label)) continue;
      let card = control.parentElement;
      for (let i = 0; i < 7 && card.parentElement; i++) {
        const text = card.innerText || "";
        const name = fileNameIn(text);
        const date = parseDate(text);
        if (name && date) {
          let identity = null;
          let node = card;
          for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
            identity = node.getAttribute("data-message-id") || node.getAttribute("data-id");
            if (identity) break;
          }
          entries.push({ control, card, text, name, date, identity });
          break;
        }
        card = card.parentElement;
      }
    }
    const unique = new Map();
    for (const e of entries) {
      const key = e.identity ? `${e.date}|${e.identity}|${e.name}` : `${e.date}|${e.name}`;
      if (!unique.has(key)) unique.set(key, e);
    }
    return [...unique.values()].sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name, "ru"));
  }

  function itemKey(item) {
    return item.identity ? `${item.date}|${item.identity}|${item.name}` : `${item.date}|${item.name}`;
  }

  browser.runtime.onMessage.addListener(message => {
    if (message.type === "CLICK_ITEM") {
      const item = collect().find(entry => itemKey(entry) === message.key);
      if (!item) return Promise.resolve({ error: "Карточка файла исчезла до нажатия; обновите чат и продолжите." });
      try {
        item.control.click();
        return Promise.resolve({ ok: true });
      } catch (error) {
        return Promise.resolve({ error: error.message || "Не удалось нажать кнопку скачивания MAX." });
      }
    }
    if (message.type === "ADVANCE") {
      const scroller = findScroller();
      scroller.scrollTop = Math.min(scroller.scrollTop + Math.max(150, scroller.clientHeight * 0.65), scroller.scrollHeight);
      return Promise.resolve({ ok: true });
    }
    if (message.type !== "NEXT_ITEM") return;
    const items = collect();
    const from = message.from;
    const to = message.to;
    const filtered = items.filter(i => i.date >= from && i.date <= to);
    const excludedWord = String(message.exclude || "ЗАЛ").toLocaleLowerCase("ru");
    const dates = items.map(i => i.date).sort();
    const earliest = dates[0];
    const latest = dates.at(-1);
    const scroller = findScroller();

    // Reloads usually return MAX to the latest messages. Seek older history until
    // the requested start date is visible, then traverse toward newer messages.
    if (phase === "seekStart" && earliest && earliest > from) {
      if (earliest !== lastBoundaryDate) { lastBoundaryDate = earliest; stableBoundaryPasses = 0; }
      requestOlderMessages(scroller);
      stableBoundaryPasses++;
      if (stableBoundaryPasses < 20) return new Promise(resolve => setTimeout(() => resolve({ retry: true }), 1800));
      return Promise.resolve({ error: `Не удалось найти начало периода ${from} в истории чата. Остановка, чтобы не пропустить файлы.` });
    } else if (earliest && earliest <= from) {
      phase = "forward";
      stableBoundaryPasses = 0;
      lastBoundaryDate = null;
    }

    for (const item of filtered) {
      const key = itemKey(item);
      if (message.processed?.[key] || message.excluded?.[key] || message.failed?.[key]) continue;
      const anchor = item.control.closest("a[href]");
      const url = anchor?.href || item.control.getAttribute("href") || item.control.dataset?.url || null;
      return Promise.resolve({ key, date: item.date, name: item.name, url, excluded: item.name.toLocaleLowerCase("ru").includes(excludedWord) });
    }
    if (scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 30) {
      scroller.scrollTop = Math.min(scroller.scrollTop + Math.max(200, scroller.clientHeight * 0.7), scroller.scrollHeight);
      return new Promise(resolve => setTimeout(() => resolve({ retry: true }), 1800));
    }
    if (latest && latest < to && stableBoundaryPasses < 4) {
      stableBoundaryPasses++;
      return new Promise(resolve => setTimeout(() => resolve({ retry: true }), 1800));
    }
    return Promise.resolve({ done: true });
  });
})();

