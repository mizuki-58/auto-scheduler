/* AutoScheduler (PWA) - production-friendly single-file logic
   - LocalStorage persistence
   - Auto scheduling (simple heuristic) with optional lunch block
   - Drag to adjust blocks in 5-min steps (within day range)
   - Mark done / delete
   - Export .ics
*/

(() => {
  "use strict";

  // ---------- Utilities ----------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const uid = () =>
    Math.random().toString(36).slice(2, 10) + "-" + Date.now().toString(36);

  const pad2 = (n) => String(n).padStart(2, "0");

  const parseTimeToMin = (hhmm) => {
    if (!hhmm) return null;
    const [h, m] = hhmm.split(":").map((v) => parseInt(v, 10));
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    return h * 60 + m;
  };

  const minToHHMM = (min) => `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const formatJPDate = (d) => {
    const y = d.getFullYear();
    const m = pad2(d.getMonth() + 1);
    const da = pad2(d.getDate());
    return `${y}-${m}-${da}`;
  };

  const toLocalDate = (yyyy_mm_dd) => {
    const [y, m, d] = yyyy_mm_dd.split("-").map((v) => parseInt(v, 10));
    return new Date(y, m - 1, d, 0, 0, 0, 0);
  };

  const combineDateTime = (yyyy_mm_dd, hhmm) => {
    if (!yyyy_mm_dd) return null;
    const base = toLocalDate(yyyy_mm_dd);
    if (!hhmm) return new Date(base.getFullYear(), base.getMonth(), base.getDate(), 23, 59, 0, 0);
    const t = parseTimeToMin(hhmm);
    if (t == null) return null;
    return new Date(base.getFullYear(), base.getMonth(), base.getDate(), Math.floor(t / 60), t % 60, 0, 0);
  };

  const toast = (msg) => {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  };

  const downloadTextFile = (filename, content, mime = "text/plain") => {
    const blob = new Blob([content], { type: `${mime};charset=utf-8` });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 0);
  };

  // ICS helpers (floating local time)
  const icsEscape = (s) => (s || "").replace(/[\\,;]/g, "\\$&").replace(/\n/g, "\\n");
  const icsDT = (d) =>
    `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}T${pad2(d.getHours())}${pad2(d.getMinutes())}00`;

  // ---------- Storage ----------
  const KEY = "autoscheduler.v1";
  const loadState = () => {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };
  const saveState = () => {
    localStorage.setItem(KEY, JSON.stringify(state));
  };

  // ---------- State ----------
  const today = new Date();
  const defaultState = {
    settings: {
      date: formatJPDate(today),
      dayStart: "07:00",
      dayEnd: "23:00",
      buffer: 5,
      strategy: "due", // due | priority
      lunch: "none", // none or "12:00-13:00"
    },
    tasks: [],
    scheduleByDate: {}, // { 'YYYY-MM-DD': [ {id,startMin,endMin,done} ... ] }
  };

  const state = Object.assign({}, defaultState, loadState() || {});
  state.settings = Object.assign({}, defaultState.settings, state.settings || {});
  state.tasks = Array.isArray(state.tasks) ? state.tasks : [];
  state.scheduleByDate = state.scheduleByDate && typeof state.scheduleByDate === "object" ? state.scheduleByDate : {};

  // Migrate: ensure fields
  state.tasks.forEach((t) => {
    t.id ||= uid();
    t.title ||= "Untitled";
    t.duration ||= 30;
    t.priority ||= "中";
    t.split ||= "可";
    t.deadlineDate ||= "";
    t.deadlineTime ||= "";
    t.createdAt ||= Date.now();
    t.done ||= false;
  });

  // ---------- DOM refs ----------
  const els = {
    title: $("#appbar-title"),
    generate: $("#generate-btn"),
    export: $("#export-btn"),
    clearToday: $("#clear-today-btn"),

    viewToday: $("#view-today"),
    viewTasks: $("#view-tasks"),
    viewSettings: $("#view-settings"),

    navToday: $("#nav-today"),
    navTasks: $("#nav-tasks"),
    navSettings: $("#nav-settings"),

    axis: $("#timeline-axis"),
    scheduleList: $("#schedule-list"),
    unplaced: $("#unplaced-container"),

    addTaskToggle: $("#add-task-toggle"),
    importDemo: $("#import-demo-btn"),
    taskForm: $("#task-form"),
    cancelTaskForm: $("#cancel-task-form"),
    taskTitle: $("#task-title"),
    taskDuration: $("#task-duration"),
    taskDeadlineDate: $("#task-deadline-date"),
    taskDeadlineTime: $("#task-deadline-time"),
    taskPriority: $("#task-priority"),
    taskSplit: $("#task-split"),
    tasksList: $("#tasks-list"),

    settingsForm: $("#settings-form"),
    settingDate: $("#setting-date"),
    settingStart: $("#setting-start"),
    settingEnd: $("#setting-end"),
    settingBuffer: $("#setting-buffer"),
    settingStrategy: $("#setting-strategy"),
    settingLunch: $("#setting-lunch"),
    resetBtn: $("#reset-btn"),
  };

  // ---------- Navigation ----------
  const setActiveTab = (tab) => {
    // tab: "today"|"tasks"|"settings"
    els.viewToday.classList.toggle("hidden", tab !== "today");
    els.viewTasks.classList.toggle("hidden", tab !== "tasks");
    els.viewSettings.classList.toggle("hidden", tab !== "settings");

    els.navToday.classList.toggle("active", tab === "today");
    els.navTasks.classList.toggle("active", tab === "tasks");
    els.navSettings.classList.toggle("active", tab === "settings");

    els.title.textContent = tab === "today" ? "今日の時間割" : tab === "tasks" ? "タスク" : "設定";
  };

  // ---------- Scheduling ----------
  const priorityScore = (p) => (p === "高" ? 3 : p === "中" ? 2 : 1);

  const getDayRange = () => {
    const startMin = parseTimeToMin(state.settings.dayStart) ?? 420;
    const endMin = parseTimeToMin(state.settings.dayEnd) ?? 1380;
    const buffer = Number(state.settings.buffer) || 0;
    return { startMin, endMin, buffer };
  };

  const getLunchBlock = () => {
    if (!state.settings.lunch || state.settings.lunch === "none") return null;
    const [a, b] = state.settings.lunch.split("-");
    const s = parseTimeToMin(a);
    const e = parseTimeToMin(b);
    if (s == null || e == null || e <= s) return null;
    return { startMin: s, endMin: e };
  };

  // Return tasks that are not done and not fully scheduled for the date
  const tasksToSchedule = (dateKey) => {
    const scheduled = state.scheduleByDate[dateKey] || [];
    const scheduledIds = new Set(scheduled.map((b) => b.taskId));
    // We'll allow rescheduling existing blocks; but generation overwrites.
    // So we take all undone tasks.
    return state.tasks.filter((t) => !t.done);
  };

  const sortTasks = (arr) => {
    const strategy = state.settings.strategy || "due";
    const withKey = arr.map((t) => {
      const dl = combineDateTime(t.deadlineDate, t.deadlineTime);
      const dlMs = dl ? dl.getTime() : Number.POSITIVE_INFINITY;
      return { t, dlMs };
    });

    if (strategy === "priority") {
      withKey.sort((a, b) => {
        const ps = priorityScore(b.t.priority) - priorityScore(a.t.priority);
        if (ps !== 0) return ps;
        if (a.dlMs !== b.dlMs) return a.dlMs - b.dlMs;
        return a.t.createdAt - b.t.createdAt;
      });
    } else {
      withKey.sort((a, b) => {
        if (a.dlMs !== b.dlMs) return a.dlMs - b.dlMs;
        const ps = priorityScore(b.t.priority) - priorityScore(a.t.priority);
        if (ps !== 0) return ps;
        return a.t.createdAt - b.t.createdAt;
      });
    }
    return withKey.map((x) => x.t);
  };

  // Find next slot that fits duration from cursor, considering lunch block and existing blocks
  const buildSchedule = (dateKey) => {
    const { startMin, endMin, buffer } = getDayRange();
    const lunch = getLunchBlock();

    const dayBlocks = [];
    // add lunch as fixed block
    if (lunch) {
      dayBlocks.push({
        id: "lunch",
        taskId: "lunch",
        title: "休憩",
        startMin: lunch.startMin,
        endMin: lunch.endMin,
        fixed: true,
        done: false,
        priority: "中",
        split: "不可",
        deadline: null,
      });
    }

    const tasks = sortTasks(tasksToSchedule(dateKey));

    // helper: check overlap with existing blocks
    const overlaps = (s, e) =>
      dayBlocks.some((b) => !(e <= b.startMin || s >= b.endMin));

    const insertBlock = (blk) => {
      dayBlocks.push(blk);
      dayBlocks.sort((a, b) => a.startMin - b.startMin);
    };

    const findGap = (duration) => {
      // scan timeline for first gap
      const minDur = duration;
      // create sorted list of blocks
      const blocks = [...dayBlocks].sort((a, b) => a.startMin - b.startMin);
      let cur = startMin;
      for (const b of blocks) {
        if (cur + minDur <= b.startMin) return { s: cur, e: cur + minDur };
        cur = Math.max(cur, b.endMin + buffer);
      }
      if (cur + minDur <= endMin) return { s: cur, e: cur + minDur };
      return null;
    };

    const unplaced = [];

    for (const t of tasks) {
      const dur = Math.max(5, Math.round(Number(t.duration) / 5) * 5);
      const canSplit = t.split !== "不可";

      if (!canSplit) {
        const gap = findGap(dur);
        if (!gap) {
          unplaced.push(t);
          continue;
        }
        insertBlock({
          id: uid(),
          taskId: t.id,
          title: t.title,
          startMin: gap.s,
          endMin: gap.e,
          fixed: false,
          done: false,
          priority: t.priority,
          split: t.split,
          deadline: combineDateTime(t.deadlineDate, t.deadlineTime),
        });
        continue;
      }

      // split allowed: try to place in chunks if not enough continuous time
      let remaining = dur;
      // choose chunk size: 60/45/30 depending on remaining
      while (remaining > 0) {
        const chunk = remaining >= 60 ? 60 : remaining >= 45 ? 45 : remaining >= 30 ? 30 : remaining;
        const gap = findGap(chunk);
        if (!gap) break;
        insertBlock({
          id: uid(),
          taskId: t.id,
          title: t.title + (dur !== chunk ? "（分割）" : ""),
          startMin: gap.s,
          endMin: gap.e,
          fixed: false,
          done: false,
          priority: t.priority,
          split: t.split,
          deadline: combineDateTime(t.deadlineDate, t.deadlineTime),
        });
        remaining -= chunk;
        // add buffer already handled by scanning (endMin + buffer)
      }
      if (remaining > 0) unplaced.push({ ...t, _remaining: remaining });
    }

    // Persist schedule for date (excluding lunch fixed block? keep it)
    state.scheduleByDate[dateKey] = dayBlocks.map((b) => ({
      id: b.id,
      taskId: b.taskId,
      title: b.title,
      startMin: b.startMin,
      endMin: b.endMin,
      fixed: !!b.fixed,
      done: !!b.done,
    }));
    saveState();
    return { placed: state.scheduleByDate[dateKey], unplaced };
  };

  // ---------- Rendering ----------
  const renderAxis = () => {
    const { startMin, endMin } = getDayRange();
    const total = endMin - startMin;
    // labels every hour
    const labels = [];
    for (let m = startMin; m <= endMin; m += 60) labels.push(minToHHMM(m));
    els.axis.innerHTML = labels.map((t) => `<span style="margin-right:14px">${t}</span>`).join("");
  };

  const blockTopPx = (min, startMin, endMin) => {
    const totalMin = endMin - startMin;
    const h = Math.max(420, els.scheduleList.clientHeight || 540); // fallback
    // Use a fixed scale: 1 min -> 2 px (cap)
    // We'll map to 2px/min but clamp overall
    const pxPerMin = 2;
    return (min - startMin) * pxPerMin;
  };

  const blockHeightPx = (durMin) => Math.max(44, durMin * 2);

  const getScheduleForDate = (dateKey) => (state.scheduleByDate[dateKey] || []).slice().sort((a,b)=>a.startMin-b.startMin);

  const taskById = (id) => state.tasks.find((t) => t.id === id);

  const renderTasks = () => {
    els.tasksList.innerHTML = "";
    if (state.tasks.length === 0) {
      const li = document.createElement("li");
      li.className = "task-item";
      li.innerHTML = `<div class="task-main"><div class="task-title">タスクがありません</div><div class="task-meta">「＋追加」から作成できます。</div></div>`;
      els.tasksList.appendChild(li);
      return;
    }

    const sorted = [...state.tasks].sort((a, b) => (a.done === b.done ? (b.createdAt - a.createdAt) : (a.done ? 1 : -1)));
    for (const t of sorted) {
      const deadline = combineDateTime(t.deadlineDate, t.deadlineTime);
      const dlStr = deadline ? `${formatJPDate(deadline)} ${pad2(deadline.getHours())}:${pad2(deadline.getMinutes())}` : "なし";
      const li = document.createElement("li");
      li.className = "task-item";
      li.innerHTML = `
        <div class="task-main">
          <div class="task-title">${escapeHTML(t.title)}${t.done ? "（完了）" : ""}</div>
          <div class="task-meta">
            <span class="badge ${t.priority === "高" ? "high" : t.priority === "低" ? "low" : ""}">優先:${escapeHTML(t.priority)}</span>
            <span class="badge">時間:${escapeHTML(String(t.duration))}m</span>
            <span class="badge ${t.split === "不可" ? "splitno" : ""}">分割:${escapeHTML(t.split)}</span>
            <span class="badge">締切:${escapeHTML(dlStr)}</span>
          </div>
        </div>
        <div class="task-actions">
          <button class="icon-btn" title="編集" data-act="edit" data-id="${t.id}">✎</button>
          <button class="icon-btn" title="完了/戻す" data-act="toggleDone" data-id="${t.id}">${t.done ? "↩" : "✓"}</button>
          <button class="icon-btn danger" title="削除" data-act="del" data-id="${t.id}">🗑</button>
        </div>
      `;
      els.tasksList.appendChild(li);
    }
  };

  const statusClass = (task, startMin, endMin, dateKey) => {
    const t = taskById(task.taskId);
    const now = new Date();
    const isToday = dateKey === formatJPDate(now);
    const deadline = t ? combineDateTime(t.deadlineDate, t.deadlineTime) : null;

    if (task.done) return "done";
    if (!deadline) return "";
    const blockEnd = toBlockDate(dateKey, task.endMin);
    if (blockEnd > deadline) return "overdue";
    // warn if within 2h of deadline and not done
    const diffMin = Math.floor((deadline.getTime() - blockEnd.getTime()) / 60000);
    if (diffMin <= 120) return "warn";
    return "";
  };

  const toBlockDate = (dateKey, minutesFromMidnight) => {
    const d = toLocalDate(dateKey);
    const h = Math.floor(minutesFromMidnight / 60);
    const m = minutesFromMidnight % 60;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0, 0);
  };

  const renderToday = () => {
    const dateKey = state.settings.date;
    renderAxis();

    const { startMin, endMin } = getDayRange();
    const placed = getScheduleForDate(dateKey);

    // set min height based on range
    const pxPerMin = 2;
    els.scheduleList.style.minHeight = `${Math.max(420, (endMin - startMin) * pxPerMin + 40)}px`;

    els.scheduleList.innerHTML = "";
    for (const b of placed) {
      const t = b.taskId === "lunch" ? null : taskById(b.taskId);
      const dl = t ? combineDateTime(t.deadlineDate, t.deadlineTime) : null;
      const dlStr = dl ? `${formatJPDate(dl)} ${pad2(dl.getHours())}:${pad2(dl.getMinutes())}` : "なし";
      const cls = statusClass(b, startMin, endMin, dateKey);

      const block = document.createElement("div");
      block.className = `block ${cls}`;
      block.dataset.id = b.id;
      block.dataset.taskId = b.taskId;
      block.style.top = `${(b.startMin - startMin) * pxPerMin}px`;
      block.style.height = `${Math.max(44, (b.endMin - b.startMin) * pxPerMin)}px`;

      const title = b.taskId === "lunch" ? "休憩" : (t ? t.title : b.title);
      block.innerHTML = `
        <div class="block-head">
          <div style="min-width:0">
            <div class="block-title">${escapeHTML(title)}</div>
            <div class="block-sub">
              <span class="chip">${escapeHTML(minToHHMM(b.startMin))}–${escapeHTML(minToHHMM(b.endMin))}</span>
              ${b.taskId === "lunch" ? `<span class="chip">固定</span>` : `<span class="chip">優先:${escapeHTML(t?.priority || "中")}</span>
              <span class="chip">締切:${escapeHTML(dlStr)}</span>`}
            </div>
          </div>
          <div class="block-time">${escapeHTML(minToHHMM(b.endMin - b.startMin))}h</div>
        </div>
        ${b.taskId !== "lunch" ? `
        <div class="block-actions">
          <button class="mini" data-act="done" data-bid="${b.id}">${b.done ? "未完了" : "完了"}</button>
          <button class="mini danger" data-act="remove" data-bid="${b.id}">外す</button>
        </div>` : ""}
      `;

      // Drag handling (only movable if not fixed)
      if (!b.fixed && b.taskId !== "lunch") {
        enableDrag(block, dateKey);
      } else {
        block.style.cursor = "default";
      }

      els.scheduleList.appendChild(block);
    }

    // unplaced summary
    const unplacedTasks = computeUnplaced(dateKey);
    renderUnplaced(unplacedTasks);

    // ensure events attached for mini buttons
    els.scheduleList.querySelectorAll("button[data-act]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const act = btn.dataset.act;
        const bid = btn.dataset.bid;
        if (act === "done") toggleBlockDone(dateKey, bid);
        if (act === "remove") removeBlock(dateKey, bid);
      });
    });
  };

  const computeUnplaced = (dateKey) => {
    // Determine tasks that have no scheduled blocks on dateKey (except lunch)
    const placed = getScheduleForDate(dateKey).filter((b) => b.taskId !== "lunch");
    const counts = new Map();
    placed.forEach((b) => counts.set(b.taskId, (counts.get(b.taskId) || 0) + (b.endMin - b.startMin)));
    const unplaced = [];
    for (const t of state.tasks) {
      if (t.done) continue;
      const placedMin = counts.get(t.id) || 0;
      const need = Math.max(0, Math.round(Number(t.duration) / 5) * 5 - placedMin);
      if (need > 0) unplaced.push({ t, need });
    }
    return unplaced;
  };

  const renderUnplaced = (unplaced) => {
    if (!unplaced || unplaced.length === 0) {
      els.unplaced.innerHTML = `<h3>未配置：なし 🎉</h3><div class="hint">すべて配置できています。</div>`;
      return;
    }
    els.unplaced.innerHTML = `<h3>未配置（${unplaced.length}件）</h3>` + unplaced.map(({t, need}) => {
      const dl = combineDateTime(t.deadlineDate, t.deadlineTime);
      const dlStr = dl ? `${formatJPDate(dl)} ${pad2(dl.getHours())}:${pad2(dl.getMinutes())}` : "なし";
      return `<div class="item">
        <div style="min-width:0">
          <div style="font-weight:900">${escapeHTML(t.title)}</div>
          <div class="meta">残り:${need}m / 優先:${escapeHTML(t.priority)} / 締切:${escapeHTML(dlStr)}</div>
        </div>
        <button class="pill ghost" data-act="gotoTasks">タスク</button>
      </div>`;
    }).join("");

    els.unplaced.querySelectorAll('button[data-act="gotoTasks"]').forEach((b) => {
      b.addEventListener("click", () => setActiveTab("tasks"));
    });
  };

  const escapeHTML = (s) => String(s).replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));

  // ---------- Drag (5-min step) ----------
  let drag = null;

  const enableDrag = (el, dateKey) => {
    const bid = el.dataset.id;

    const onPointerDown = (ev) => {
      ev.preventDefault();
      const blocks = getScheduleForDate(dateKey);
      const b = blocks.find((x) => x.id === bid);
      if (!b) return;

      const { startMin, endMin } = getDayRange();
      const pxPerMin = 2;

      drag = {
        bid,
        dateKey,
        startY: ev.clientY,
        origStart: b.startMin,
        dur: b.endMin - b.startMin,
        startMin,
        endMin,
        pxPerMin,
      };

      el.setPointerCapture(ev.pointerId);
    };

    const onPointerMove = (ev) => {
      if (!drag || drag.bid !== bid) return;
      const dy = ev.clientY - drag.startY;
      const deltaMin = Math.round(dy / (drag.pxPerMin * 5)) * 5; // 5-min snap
      const newStart = clamp(drag.origStart + deltaMin, drag.startMin, drag.endMin - drag.dur);
      const newEnd = newStart + drag.dur;
      // update style immediately
      el.style.top = `${(newStart - drag.startMin) * drag.pxPerMin}px`;
      el.dataset.previewStart = String(newStart);
      el.dataset.previewEnd = String(newEnd);
    };

    const onPointerUp = (ev) => {
      if (!drag || drag.bid !== bid) return;
      const s = Number(el.dataset.previewStart);
      const e2 = Number(el.dataset.previewEnd);
      // apply if valid and no overlap
      if (!Number.isNaN(s) && !Number.isNaN(e2)) {
        moveBlock(dateKey, bid, s, e2);
      }
      el.dataset.previewStart = "";
      el.dataset.previewEnd = "";
      drag = null;
    };

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerUp);
  };

  const hasOverlap = (dateKey, bid, s, e) => {
    const blocks = getScheduleForDate(dateKey);
    return blocks.some((b) => b.id !== bid && !(e <= b.startMin || s >= b.endMin));
  };

  const moveBlock = (dateKey, bid, s, e) => {
    const blocks = getScheduleForDate(dateKey);
    const idx = blocks.findIndex((b) => b.id === bid);
    if (idx < 0) return;
    const b = blocks[idx];
    if (b.fixed) return;

    if (hasOverlap(dateKey, bid, s, e)) {
      toast("重なりがあるので移動できません");
      renderToday();
      return;
    }

    b.startMin = s;
    b.endMin = e;
    // Save back
    state.scheduleByDate[dateKey] = blocks.sort((a,b)=>a.startMin-b.startMin);
    saveState();
    renderToday();
  };

  const toggleBlockDone = (dateKey, bid) => {
    const blocks = getScheduleForDate(dateKey);
    const b = blocks.find((x) => x.id === bid);
    if (!b) return;
    b.done = !b.done;
    state.scheduleByDate[dateKey] = blocks;
    // if all blocks for a task are done, mark task done
    if (b.taskId && b.taskId !== "lunch") {
      const related = blocks.filter((x) => x.taskId === b.taskId);
      const allDone = related.length > 0 && related.every((x) => x.done);
      const t = taskById(b.taskId);
      if (t) t.done = allDone;
    }
    saveState();
    renderTasks();
    renderToday();
  };

  const removeBlock = (dateKey, bid) => {
    const blocks = getScheduleForDate(dateKey);
    const b = blocks.find((x) => x.id === bid);
    if (!b || b.fixed) return;
    state.scheduleByDate[dateKey] = blocks.filter((x) => x.id !== bid);
    saveState();
    renderToday();
  };

  // ---------- Actions ----------
  const openTaskForm = (show) => {
    els.taskForm.classList.toggle("hidden", !show);
    if (show) {
      els.taskTitle.focus();
    } else {
      els.taskForm.reset();
      els.taskDeadlineDate.value = "";
      els.taskDeadlineTime.value = "";
      els.taskPriority.value = "中";
      els.taskSplit.value = "可";
    }
  };

  const addTask = (t) => {
    state.tasks.unshift(t);
    saveState();
    renderTasks();
    toast("タスクを保存しました");
  };

  const deleteTask = (id) => {
    state.tasks = state.tasks.filter((t) => t.id !== id);
    // remove scheduled blocks on all dates
    for (const k of Object.keys(state.scheduleByDate)) {
      state.scheduleByDate[k] = (state.scheduleByDate[k] || []).filter((b) => b.taskId !== id);
    }
    saveState();
    renderTasks();
    renderToday();
  };

  const editTask = (id) => {
    const t = taskById(id);
    if (!t) return;
    openTaskForm(true);
    els.taskTitle.value = t.title;
    els.taskDuration.value = t.duration;
    els.taskDeadlineDate.value = t.deadlineDate || "";
    els.taskDeadlineTime.value = t.deadlineTime || "";
    els.taskPriority.value = t.priority || "中";
    els.taskSplit.value = t.split || "可";

    // On submit, overwrite
    els.taskForm.dataset.editing = id;
    toast("編集モード");
  };

  const toggleTaskDone = (id) => {
    const t = taskById(id);
    if (!t) return;
    t.done = !t.done;
    // reflect blocks: mark all blocks done if task done, else mark undone
    for (const k of Object.keys(state.scheduleByDate)) {
      for (const b of state.scheduleByDate[k] || []) {
        if (b.taskId === id) b.done = t.done;
      }
    }
    saveState();
    renderTasks();
    renderToday();
  };

  const clearToday = () => {
    const dateKey = state.settings.date;
    const keepLunch = (state.scheduleByDate[dateKey] || []).filter((b) => b.taskId === "lunch");
    state.scheduleByDate[dateKey] = keepLunch;
    saveState();
    renderToday();
    toast("今日の配置をクリアしました");
  };

  const generate = () => {
    const dateKey = state.settings.date;
    const { placed, unplaced } = buildSchedule(dateKey);
    renderToday();
    toast(unplaced.length === 0 ? "作成完了" : `作成完了（未配置 ${unplaced.length}件）`);
  };

  const exportICS = () => {
    const dateKey = state.settings.date;
    const blocks = getScheduleForDate(dateKey).filter((b) => b.taskId !== "lunch");
    if (blocks.length === 0) {
      toast("出力する予定がありません");
      return;
    }
    const calName = "AutoScheduler";
    const dtStamp = icsDT(new Date());
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//AutoScheduler//JP",
      "CALSCALE:GREGORIAN",
      `X-WR-CALNAME:${icsEscape(calName)}`,
    ];

    for (const b of blocks) {
      const t = taskById(b.taskId);
      const title = t ? t.title : b.title;
      const start = toBlockDate(dateKey, b.startMin);
      const end = toBlockDate(dateKey, b.endMin);
      lines.push("BEGIN:VEVENT");
      lines.push(`UID:${icsEscape(b.id)}@autoscheduler`);
      lines.push(`DTSTAMP:${dtStamp}`);
      lines.push(`DTSTART:${icsDT(start)}`);
      lines.push(`DTEND:${icsDT(end)}`);
      lines.push(`SUMMARY:${icsEscape(title)}`);
      lines.push("END:VEVENT");
    }

    lines.push("END:VCALENDAR");
    const content = lines.join("\r\n") + "\r\n";
    downloadTextFile(`autoscheduler_${dateKey}.ics`, content, "text/calendar");
    toast(".ics を出力しました");
  };

  const importDemo = () => {
    const dateKey = state.settings.date;
    const base = toLocalDate(dateKey);
    const plusDays = (n) => {
      const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + n, 23, 59, 0, 0);
      return formatJPDate(d);
    };
    const demo = [
      { title: "研究打合せの準備", duration: 60, priority: "高", split: "不可", deadlineDate: plusDays(0), deadlineTime: "12:00" },
      { title: "発表スライド作成", duration: 120, priority: "高", split: "可", deadlineDate: plusDays(1), deadlineTime: "18:00" },
      { title: "買い物", duration: 30, priority: "低", split: "可", deadlineDate: "", deadlineTime: "" },
      { title: "メール返信", duration: 25, priority: "中", split: "可", deadlineDate: plusDays(0), deadlineTime: "20:00" },
    ];
    for (const d of demo) {
      addTask({
        id: uid(),
        title: d.title,
        duration: d.duration,
        priority: d.priority,
        split: d.split,
        deadlineDate: d.deadlineDate || "",
        deadlineTime: d.deadlineTime || "",
        createdAt: Date.now(),
        done: false,
      });
    }
    toast("デモタスクを追加しました");
  };

  const resetAll = () => {
    if (!confirm("全データを初期化します。よろしいですか？")) return;
    localStorage.removeItem(KEY);
    location.reload();
  };

  // ---------- Event wiring ----------
  const wire = () => {
    // Nav
    els.navToday.addEventListener("click", () => setActiveTab("today"));
    els.navTasks.addEventListener("click", () => setActiveTab("tasks"));
    els.navSettings.addEventListener("click", () => setActiveTab("settings"));

    // Task form toggle
    els.addTaskToggle.addEventListener("click", () => openTaskForm(els.taskForm.classList.contains("hidden")));
    els.cancelTaskForm.addEventListener("click", () => {
      els.taskForm.dataset.editing = "";
      openTaskForm(false);
    });

    els.importDemo.addEventListener("click", importDemo);

    els.taskForm.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const title = els.taskTitle.value.trim();
      const duration = Number(els.taskDuration.value);
      if (!title) return toast("タスク名を入力してください");
      if (!duration || duration < 5) return toast("所要時間（分）を正しく入力してください");

      const t = {
        id: uid(),
        title,
        duration: Math.round(duration / 5) * 5,
        deadlineDate: els.taskDeadlineDate.value || "",
        deadlineTime: els.taskDeadlineTime.value || "",
        priority: els.taskPriority.value || "中",
        split: els.taskSplit.value || "可",
        createdAt: Date.now(),
        done: false,
      };

      const editing = els.taskForm.dataset.editing;
      if (editing) {
        const old = taskById(editing);
        if (old) {
          old.title = t.title;
          old.duration = t.duration;
          old.deadlineDate = t.deadlineDate;
          old.deadlineTime = t.deadlineTime;
          old.priority = t.priority;
          old.split = t.split;
          old.done = false;
          // also update blocks' displayed title in schedule store
          for (const k of Object.keys(state.scheduleByDate)) {
            for (const b of state.scheduleByDate[k] || []) {
              if (b.taskId === old.id) b.title = old.title;
            }
          }
          saveState();
          renderTasks();
          renderToday();
          toast("更新しました");
        }
        els.taskForm.dataset.editing = "";
        openTaskForm(false);
        return;
      }

      addTask(t);
      openTaskForm(false);
    });

    // Task list actions
    els.tasksList.addEventListener("click", (ev) => {
      const btn = ev.target.closest("button[data-act]");
      if (!btn) return;
      const act = btn.dataset.act;
      const id = btn.dataset.id;
      if (!id) return;

      if (act === "del") deleteTask(id);
      if (act === "edit") editTask(id);
      if (act === "toggleDone") toggleTaskDone(id);
    });

    // Settings
    els.settingsForm.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const d = els.settingDate.value || formatJPDate(new Date());
      const start = els.settingStart.value || "07:00";
      const end = els.settingEnd.value || "23:00";
      const buf = Number(els.settingBuffer.value || 0);
      const strategy = els.settingStrategy.value || "due";
      const lunch = els.settingLunch.value || "none";

      const sMin = parseTimeToMin(start);
      const eMin = parseTimeToMin(end);
      if (sMin == null || eMin == null || eMin - sMin < 60) {
        toast("開始/終了時間が不正です（最低1時間）");
        return;
      }

      state.settings.date = d;
      state.settings.dayStart = start;
      state.settings.dayEnd = end;
      state.settings.buffer = clamp(buf, 0, 60);
      state.settings.strategy = strategy;
      state.settings.lunch = lunch;

      saveState();
      renderToday();
      toast("設定を保存しました");
      setActiveTab("today");
    });

    els.resetBtn.addEventListener("click", resetAll);

    // Generate / export / clear
    els.generate.addEventListener("click", generate);
    els.export.addEventListener("click", exportICS);
    els.clearToday.addEventListener("click", clearToday);
  };

  const initSettingsUI = () => {
    els.settingDate.value = state.settings.date;
    els.settingStart.value = state.settings.dayStart;
    els.settingEnd.value = state.settings.dayEnd;
    els.settingBuffer.value = String(state.settings.buffer);
    els.settingStrategy.value = state.settings.strategy;
    els.settingLunch.value = state.settings.lunch;

    // default task deadline date = today
    els.taskDeadlineDate.value = state.settings.date;
  };

  // ---------- PWA registration ----------
  const registerSW = async () => {
    if (!("serviceWorker" in navigator)) return;
    try {
      await navigator.serviceWorker.register("./service-worker.js");
    } catch {
      // ignore
    }
  };

  // ---------- Boot ----------
  const boot = () => {
    initSettingsUI();
    wire();
    renderTasks();
    renderToday();
    registerSW();

    // Open today by default
    setActiveTab("today");
  };

  document.addEventListener("DOMContentLoaded", boot);
})();
