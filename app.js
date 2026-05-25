const state = {
  dataset: null,
  roundItems: [],
  selectedId: null,
  drag: null,
  score: 0,
  correct: 0,
  wrong: 0,
  timeLeft: 20,
  timerId: null,
  timedOut: false
};

const els = {
  score: document.querySelector("#score"),
  correct: document.querySelector("#correct"),
  wrong: document.querySelector("#wrong"),
  remaining: document.querySelector("#remaining"),
  timer: document.querySelector("#timer"),
  message: document.querySelector("#message"),
  mobileMessage: document.querySelector("#mobile-message"),
  roundSize: document.querySelector("#round-size"),
  newGame: document.querySelector("#new-game"),
  wasteList: document.querySelector("#waste-list"),
  binList: document.querySelector("#bin-list"),
  wasteTemplate: document.querySelector("#waste-template"),
  binTemplate: document.querySelector("#bin-template")
};

const categoryLabels = {
  "can": "กระป๋อง",
  "general west": "ขยะทั่วไป",
  "glass bottle": "ขวดแก้ว",
  "oganic west": "ขยะอินทรีย์",
  "organic west": "ขยะอินทรีย์",
  "opaque": "พลาสติกขุ่น",
  "plastic": "พลาสติกใส",
  "water ice": "น้ำ/น้ำแข็ง"
};

const audio = {
  context: null,
  master: null,
  musicGain: null,
  effectsGain: null,
  musicTimer: null,
  musicStep: 0
};

const musicNotes = [392, 494, 587, 494, 440, 523, 659, 523];

async function loadDataset() {
  const response = await fetch("dataset.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("dataset.json could not be loaded");
  }
  return response.json();
}

function normalizeName(value) {
  return value.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function displayName(value) {
  return value.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function categoryDisplayName(value) {
  return categoryLabels[normalizeName(value)] || displayName(value);
}

function shuffle(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function buildRoundItems(dataset) {
  const allItems = dataset.categories.flatMap((category) =>
    category.items.map((item, index) => ({
      id: `${category.id}-${index}-${item.path}`,
      categoryId: category.id,
      categoryName: category.name,
      name: item.name,
      path: item.path,
      sorted: false
    }))
  );

  const roundSize = Number.parseInt(els.roundSize.value, 10);
  return shuffle(allItems).slice(0, Math.min(roundSize, allItems.length));
}

function ensureAudio() {
  if (audio.context) {
    if (audio.context.state === "suspended") {
      audio.context.resume();
    }
    return;
  }

  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;

  audio.context = new AudioContext();
  audio.master = audio.context.createGain();
  audio.musicGain = audio.context.createGain();
  audio.effectsGain = audio.context.createGain();

  audio.master.gain.value = 0.35;
  audio.musicGain.gain.value = 0.24;
  audio.effectsGain.gain.value = 0.62;

  audio.musicGain.connect(audio.master);
  audio.effectsGain.connect(audio.master);
  audio.master.connect(audio.context.destination);
}

function playTone(frequency, start, duration, gain, type = "sine", destination = audio.effectsGain) {
  if (!audio.context || !destination) return;

  const oscillator = audio.context.createOscillator();
  const envelope = audio.context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.exponentialRampToValueAtTime(gain, start + 0.025);
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  oscillator.connect(envelope);
  envelope.connect(destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.04);
}

function startMusic() {
  ensureAudio();
  if (!audio.context || audio.musicTimer) return;

  audio.musicStep = 0;
  audio.musicTimer = window.setInterval(() => {
    const now = audio.context.currentTime;
    const note = musicNotes[audio.musicStep % musicNotes.length];

    playTone(note, now, 0.18, 0.08, "triangle", audio.musicGain);
    if (audio.musicStep % 2 === 0) {
      playTone(note / 2, now, 0.22, 0.045, "sine", audio.musicGain);
    }
    audio.musicStep += 1;
  }, 260);
}

function stopMusic() {
  if (!audio.musicTimer) return;
  window.clearInterval(audio.musicTimer);
  audio.musicTimer = null;
}

function playThrowEffect(isCorrect) {
  ensureAudio();
  if (!audio.context) return;

  const now = audio.context.currentTime;
  if (isCorrect) {
    playTone(330, now, 0.08, 0.24, "square");
    playTone(660, now + 0.08, 0.12, 0.2, "triangle");
    playTone(990, now + 0.16, 0.14, 0.16, "sine");
  } else {
    playTone(880, now, 0.11, 0.28, "square");
    playTone(880, now + 0.16, 0.11, 0.26, "square");
    playTone(660, now + 0.32, 0.14, 0.22, "sawtooth");
  }
}

async function requestLandscapeMode() {
  if (!window.matchMedia("(max-width: 900px)").matches || !screen.orientation?.lock) {
    return;
  }

  try {
    await screen.orientation.lock("landscape");
  } catch (error) {
    // Some mobile browsers only allow orientation lock in fullscreen or installed apps.
  }
}

function setMessage(text, type = "neutral") {
  const messageEls = [els.message, els.mobileMessage].filter(Boolean);
  messageEls.forEach((messageEl) => {
    messageEl.textContent = text;
    messageEl.dataset.type = type;
  });

  const color =
    type === "correct" ? "var(--green-dark)" :
    type === "wrong" ? "var(--red)" :
    "var(--muted)";
  messageEls.forEach((messageEl) => {
    messageEl.style.color = color;
  });
}

function updateScoreboard() {
  const remaining = state.roundItems.filter((item) => !item.sorted).length;
  els.score.textContent = state.score;
  els.correct.textContent = state.correct;
  els.wrong.textContent = state.wrong;
  els.remaining.textContent = remaining;
  els.timer.textContent = state.timeLeft;

  if (remaining === 0 && state.roundItems.length > 0) {
    setMessage(`จบรอบแล้ว คะแนนรวม ${state.score} คะแนน`, "correct");
    stopTimer();
    stopMusic();
  }
}

function stopTimer() {
  if (!state.timerId) return;
  window.clearInterval(state.timerId);
  state.timerId = null;
}

function startTimer() {
  stopTimer();
  state.timeLeft = 20;
  state.timedOut = false;
  updateScoreboard();

  state.timerId = window.setInterval(() => {
    state.timeLeft = Math.max(0, state.timeLeft - 1);
    updateScoreboard();

    if (state.timeLeft === 0) {
      stopTimer();
      state.timedOut = true;
      state.selectedId = null;
      cleanupPointerDrag();
      renderWaste();
      setMessage(`หมดเวลา! คะแนนรวม ${state.score} คะแนน`, "wrong");
      stopMusic();
    }
  }, 1000);
}

function renderWaste() {
  els.wasteList.replaceChildren();

  state.roundItems.filter((item) => !item.sorted).forEach((item) => {
    const node = els.wasteTemplate.content.firstElementChild.cloneNode(true);
    const image = node.querySelector("img");
    const label = node.querySelector("span");

    node.dataset.id = item.id;
    node.dataset.categoryId = item.categoryId;
    node.classList.toggle("sorted", item.sorted);
    node.classList.toggle("selected", state.selectedId === item.id);
    node.draggable = !item.sorted && !state.timedOut;
    node.disabled = state.timedOut;
    image.src = item.path;
    image.alt = item.name;
    label.textContent = item.name;

    node.addEventListener("click", () => {
      if (item.sorted || state.timedOut) return;
      state.selectedId = state.selectedId === item.id ? null : item.id;
      renderWaste();
    });

    node.addEventListener("dragstart", (event) => {
      if (state.timedOut) {
        event.preventDefault();
        return;
      }
      event.dataTransfer.setData("text/plain", item.id);
      event.dataTransfer.effectAllowed = "move";
      state.selectedId = item.id;
      renderWaste();
    });

    node.addEventListener("pointerdown", (event) => {
      beginPointerDrag(event, item, node);
    });

    els.wasteList.append(node);
  });
}

function beginPointerDrag(event, item, node) {
  if (item.sorted || state.timedOut || event.button > 0) return;
  startMusic();
  requestLandscapeMode();

  const rect = node.getBoundingClientRect();
  const clone = node.cloneNode(true);
  clone.classList.add("dragging-copy");
  clone.style.width = `${rect.width}px`;
  clone.style.height = `${rect.height}px`;
  document.body.append(clone);

  state.selectedId = item.id;
  state.drag = {
    itemId: item.id,
    clone,
    source: node,
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top,
    activeBin: null,
    moved: false
  };

  node.classList.add("drag-source");
  node.setPointerCapture(event.pointerId);
  movePointerDrag(event);
  event.preventDefault();
}

function movePointerDrag(event) {
  if (!state.drag) return;

  const drag = state.drag;
  drag.moved = true;
  drag.clone.style.left = `${event.clientX - drag.offsetX}px`;
  drag.clone.style.top = `${event.clientY - drag.offsetY}px`;

  const bin = findBinAt(event.clientX, event.clientY);
  if (drag.activeBin && drag.activeBin !== bin) {
    drag.activeBin.classList.remove("drag-over");
  }
  if (bin) {
    bin.classList.add("drag-over");
  }
  drag.activeBin = bin;
}

function endPointerDrag(event) {
  if (!state.drag) return;

  const drag = state.drag;
  const bin = drag.activeBin || findBinAt(event.clientX, event.clientY);
  cleanupPointerDrag();

  if (bin) {
    sortedItemById(drag.itemId, bin.dataset.categoryId, bin);
  } else {
    setMessage("ปล่อยขยะลงบนถังนะ", "neutral");
    renderWaste();
  }
}

function cleanupPointerDrag() {
  if (!state.drag) return;

  state.drag.clone.remove();
  state.drag.source.classList.remove("drag-source");
  if (state.drag.activeBin) {
    state.drag.activeBin.classList.remove("drag-over");
  }
  state.drag = null;
}

function findBinAt(clientX, clientY) {
  const dragClone = state.drag?.clone;
  if (dragClone) {
    dragClone.style.display = "none";
  }
  const element = document.elementFromPoint(clientX, clientY);
  if (dragClone) {
    dragClone.style.display = "";
  }
  return element?.closest?.(".bin-card") || null;
}

function flashBin(bin, className) {
  bin.classList.add(className);
  window.setTimeout(() => bin.classList.remove(className), 450);
}

function sortedItemById(itemId, categoryId, binNode) {
  if (state.timedOut) return;

  const item = state.roundItems.find((entry) => entry.id === itemId);
  if (!item || item.sorted) return;

  if (item.categoryId === categoryId) {
    playThrowEffect(true);
    item.sorted = true;
    state.correct += 1;
    state.score += 10;
    state.selectedId = null;
    setMessage(`เยี่ยมเลย ถูกต้อง: ${categoryDisplayName(item.categoryName)}`, "correct");
    flashBin(binNode, "correct");
  } else {
    playThrowEffect(false);
    state.wrong += 1;
    state.score = Math.max(0, state.score - 3);
    setMessage(`ยังไม่ใช่นะ ขยะชิ้นนี้ควรไปที่ ${categoryDisplayName(item.categoryName)}`, "wrong");
    flashBin(binNode, "wrong");
  }

  renderWaste();
  updateScoreboard();
}

function renderBins() {
  els.binList.replaceChildren();

  state.dataset.categories.forEach((category) => {
    const node = els.binTemplate.content.firstElementChild.cloneNode(true);
    const image = node.querySelector("img");
    const label = node.querySelector("span");

    node.dataset.categoryId = category.id;
    image.src = category.binImage;
    image.alt = `ถัง${categoryDisplayName(category.name)}`;
    label.textContent = categoryDisplayName(category.name);

    node.addEventListener("click", () => {
      if (state.timedOut) return;

      if (!state.selectedId) {
        setMessage("เลือกขยะก่อน แล้วค่อยเลือกถัง", "neutral");
        return;
      }
      sortedItemById(state.selectedId, category.id, node);
    });

    node.addEventListener("dragover", (event) => {
      if (state.timedOut) return;
      event.preventDefault();
      node.classList.add("drag-over");
    });

    node.addEventListener("dragleave", () => {
      node.classList.remove("drag-over");
    });

    node.addEventListener("drop", (event) => {
      event.preventDefault();
      node.classList.remove("drag-over");
      if (state.timedOut) return;
      const itemId = event.dataTransfer.getData("text/plain");
      sortedItemById(itemId, category.id, node);
    });

    els.binList.append(node);
  });
}

function startNewGame() {
  stopTimer();
  cleanupPointerDrag();
  if (audio.context) {
    startMusic();
  }
  state.roundItems = buildRoundItems(state.dataset);
  state.selectedId = null;
  state.score = 0;
  state.correct = 0;
  state.wrong = 0;
  state.timeLeft = 20;
  state.timedOut = false;
  renderBins();
  renderWaste();
  updateScoreboard();
  startTimer();
  setMessage("ลากขยะไปใส่ถัง หรือแตะขยะแล้วแตะถังก็ได้");
}

function validateDataset(dataset) {
  if (!dataset || !Array.isArray(dataset.categories) || dataset.categories.length === 0) {
    throw new Error("ยังไม่มีข้อมูลประเภทถังใน dataset.json");
  }

  dataset.categories.forEach((category) => {
    category.id = normalizeName(category.name);
    category.items = Array.isArray(category.items) ? category.items : [];
  });
}

async function boot() {
  try {
    state.dataset = await loadDataset();
    validateDataset(state.dataset);
    startNewGame();
  } catch (error) {
    setMessage(error.message, "wrong");
    console.error(error);
  }
}

els.newGame.addEventListener("click", () => {
  startMusic();
  requestLandscapeMode();
  startNewGame();
});
els.roundSize.addEventListener("change", () => {
  startMusic();
  requestLandscapeMode();
  startNewGame();
});
document.addEventListener("pointermove", movePointerDrag);
document.addEventListener("pointerup", endPointerDrag);
document.addEventListener("pointercancel", cleanupPointerDrag);

boot();
