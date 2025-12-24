/*
  script.js
  This file handles the core logic of the Auto Scheduler PWA. It manages navigation between
  sections, persists tasks and settings to localStorage, generates a daily schedule based on
  user‑defined tasks and day settings, and renders the resulting timeline. It also offers
  basic editing and deletion of tasks as well as exporting the generated schedule to an
  iCalendar (.ics) file. The algorithm prioritizes tasks by priority (高 > 中 > 低) and
  deadline, placing them into available time slots between the day’s start and end times.
*/

document.addEventListener('DOMContentLoaded', () => {
  // --- Element references ---
  const navTodayBtn = document.getElementById('nav-today');
  const navTasksBtn = document.getElementById('nav-tasks');
  const navSettingsBtn = document.getElementById('nav-settings');

  const viewToday = document.getElementById('view-today');
  const viewTasks = document.getElementById('view-tasks');
  const viewSettings = document.getElementById('view-settings');

  const generateBtn = document.getElementById('generate-btn');
  const scheduleList = document.getElementById('schedule-list');
  const unplacedContainer = document.getElementById('unplaced-container');
  const exportBtn = document.getElementById('export-btn');

  const addTaskToggle = document.getElementById('add-task-toggle');
  const taskForm = document.getElementById('task-form');
  const taskTitleInput = document.getElementById('task-title');
  const taskDurationInput = document.getElementById('task-duration');
  const taskDeadlineDateInput = document.getElementById('task-deadline-date');
  const taskDeadlineTimeInput = document.getElementById('task-deadline-time');
  const taskPriorityInput = document.getElementById('task-priority');
  const taskSplitInput = document.getElementById('task-split');
  const cancelTaskFormBtn = document.getElementById('cancel-task-form');
  const tasksListEl = document.getElementById('tasks-list');

  const settingsForm = document.getElementById('settings-form');
  const settingDateInput = document.getElementById('setting-date');
  const settingStartInput = document.getElementById('setting-start');
  const settingEndInput = document.getElementById('setting-end');
  const settingBufferInput = document.getElementById('setting-buffer');

  // Google integration UI
  const googleAuthBtn = document.getElementById('google-auth-btn');
  const googleSyncBtn = document.getElementById('google-sync-btn');
  const googleAuthBtn2 = document.getElementById('google-auth-btn-2');
  const googleSyncBtn2 = document.getElementById('google-sync-btn-2');
  const googleSignoutBtn = document.getElementById('google-signout-btn');
  const googleStatusEl = document.getElementById('google-status');
  const googleDefaultDurationInput = document.getElementById('setting-google-default-duration');

  // --- Data store keys ---
  const TASKS_KEY = 'autoSchedulerTasks';
  const SETTINGS_KEY = 'autoSchedulerSettings';
  const SCHEDULE_KEY = 'autoSchedulerSchedule';
  const GOOGLE_CACHE_KEY = 'autoSchedulerGoogleCache';

  // Google OAuth (Calendar + Tasks read-only)
  const GOOGLE_CLIENT_ID = '1035671869320-p1koljl7ikchr3a4cs4dusa6gik6vuv5.apps.googleusercontent.com';
  const GOOGLE_SCOPES = [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/tasks.readonly'
  ].join(' ');
  let googleTokenClient = null;
  let googleAccessToken = null;
  let googleTokenExpiresAt = 0;

  // --- Helper functions ---
  function loadTasks() {
    try {
      const raw = localStorage.getItem(TASKS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.error('Error loading tasks', e);
      return [];
    }
  }

  function saveTasks(tasks) {
    localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) return JSON.parse(raw);
      // defaults: date = today, start 07:00, end 23:00, buffer 5
      const today = new Date();
      const iso = today.toISOString().split('T')[0];
      return { date: iso, start: '07:00', end: '23:00', buffer: 5, googleDefaultDuration: 30 };
    } catch (e) {
      console.error('Error loading settings', e);
      return { date: '', start: '07:00', end: '23:00', buffer: 5, googleDefaultDuration: 30 };
    }
  }

  function saveSettings(settings) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  function saveSchedule(schedule) {
    localStorage.setItem(SCHEDULE_KEY, JSON.stringify(schedule));
  }

  function loadSchedule() {
    const raw = localStorage.getItem(SCHEDULE_KEY);
    return raw ? JSON.parse(raw) : null;
  }

  function loadGoogleCache() {
    try {
      const raw = localStorage.getItem(GOOGLE_CACHE_KEY);
      if (!raw) return { eventsByDate: {}, tasksByDate: {}, lastSync: 0 };
      const obj = JSON.parse(raw);
      return {
        eventsByDate: obj.eventsByDate || {},
        tasksByDate: obj.tasksByDate || {},
        lastSync: obj.lastSync || 0
      };
    } catch (e) {
      console.error('Error loading Google cache', e);
      return { eventsByDate: {}, tasksByDate: {}, lastSync: 0 };
    }
  }

  function saveGoogleCache(cache) {
    localStorage.setItem(GOOGLE_CACHE_KEY, JSON.stringify(cache));
  }

  function isGoogleSignedIn() {
    return !!googleAccessToken && Date.now() < googleTokenExpiresAt;
  }

  function setGoogleUiState() {
    const signedIn = isGoogleSignedIn();
    if (googleStatusEl) googleStatusEl.textContent = signedIn ? 'ログイン中' : '未ログイン';
    if (googleSyncBtn) googleSyncBtn.disabled = !signedIn;
    if (googleSyncBtn2) googleSyncBtn2.disabled = !signedIn;
    if (googleSignoutBtn) googleSignoutBtn.disabled = !signedIn;
    // Auth button text
    if (googleAuthBtn2) googleAuthBtn2.textContent = signedIn ? '再ログイン' : 'ログイン';
  }

  function waitForGoogleIdentity(maxWaitMs = 5000) {
    const start = Date.now();
    return new Promise((resolve, reject) => {
      const tick = () => {
        if (window.google && window.google.accounts && window.google.accounts.oauth2) {
          resolve();
          return;
        }
        if (Date.now() - start > maxWaitMs) {
          reject(new Error('Google Identity Services が読み込めませんでした。ネットワークを確認してください。'));
          return;
        }
        setTimeout(tick, 60);
      };
      tick();
    });
  }

  async function initGoogleAuth() {
    try {
      await waitForGoogleIdentity();
      googleTokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: GOOGLE_SCOPES,
        callback: (resp) => {
          if (resp && resp.access_token) {
            googleAccessToken = resp.access_token;
            // expires_in is seconds
            const expMs = (Number(resp.expires_in) || 3600) * 1000;
            googleTokenExpiresAt = Date.now() + expMs - 30_000; // 30s safety
            setGoogleUiState();
            alert('Googleにログインしました。\n「Googleから同期」を押すと予定とToDoを読み込みます。');
          }
        }
      });
      setGoogleUiState();
    } catch (e) {
      console.warn(e);
      if (googleStatusEl) googleStatusEl.textContent = '未ログイン（GIS読込失敗）';
    }
  }

  function googleSignIn(interactive = true) {
    if (!googleTokenClient) {
      alert('Google認証の初期化に失敗しました。ページを再読み込みしてください。');
      return;
    }
    googleTokenClient.requestAccessToken({ prompt: interactive ? 'consent' : '' });
  }

  function googleSignOut() {
    googleAccessToken = null;
    googleTokenExpiresAt = 0;
    setGoogleUiState();
  }

  async function googleApiFetch(url) {
    if (!isGoogleSignedIn()) throw new Error('Googleにログインしてください。');
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${googleAccessToken}`
      }
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Google API error (${res.status}): ${txt}`);
    }
    return res.json();
  }

  function toRfc3339(dateIso, timeStr) {
    // local time ISO -> RFC3339 with timezone offset
    const d = new Date(`${dateIso}T${timeStr}:00`);
    return d.toISOString();
  }

  function parseDurationFromText(text) {
    if (!text) return null;
    const s = String(text);
    // Examples: "30m", "45分", "1h", "1.5h", "⏱60"
    let m = s.match(/(?:⏱\s*)?(\d{1,4})\s*(?:min|m|分)\b/i);
    if (m) return Number(m[1]);
    m = s.match(/(\d+(?:\.\d+)?)\s*h\b/i);
    if (m) return Math.round(Number(m[1]) * 60);
    return null;
  }

  async function syncFromGoogle() {
    const settings = loadSettings();
    const dateIso = settings.date;
    if (!dateIso) {
      alert('設定の「対象日」を先に選んでください。');
      return;
    }
    try {
      // 1) Calendar events
      const timeMin = toRfc3339(dateIso, settings.start || '07:00');
      const timeMax = toRfc3339(dateIso, settings.end || '23:00');
      const calUrl = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
      calUrl.searchParams.set('timeMin', timeMin);
      calUrl.searchParams.set('timeMax', timeMax);
      calUrl.searchParams.set('singleEvents', 'true');
      calUrl.searchParams.set('orderBy', 'startTime');
      calUrl.searchParams.set('maxResults', '2500');

      const calJson = await googleApiFetch(calUrl.toString());
      const events = (calJson.items || [])
        .filter(ev => ev && ev.start && ev.end)
        .map(ev => {
          const title = ev.summary || '(予定)';
          const start = ev.start.dateTime || (ev.start.date ? `${ev.start.date}T00:00:00` : null);
          const end = ev.end.dateTime || (ev.end.date ? `${ev.end.date}T00:00:00` : null);
          if (!start || !end) return null;
          const st = new Date(start);
          const en = new Date(end);
          return {
            id: ev.id,
            title,
            startMin: st.getHours() * 60 + st.getMinutes(),
            endMin: en.getHours() * 60 + en.getMinutes(),
            htmlLink: ev.htmlLink || ''
          };
        })
        .filter(Boolean)
        .filter(e => e.endMin > e.startMin);

      // 2) Tasks (Google ToDo)
      const defaultDuration = Math.max(5, Number(googleDefaultDurationInput?.value || 30));
      let taskLists = [];
      try {
        const listsJson = await googleApiFetch('https://tasks.googleapis.com/tasks/v1/users/@me/lists');
        taskLists = listsJson.items || [];
      } catch (e) {
        // Some accounts might need the "tasklists" endpoint
        const listsJson = await googleApiFetch('https://tasks.googleapis.com/tasks/v1/users/@me/lists');
        taskLists = listsJson.items || [];
      }

      const allTasks = [];
      for (const tl of taskLists) {
        const listId = tl.id;
        if (!listId) continue;
        const tUrl = new URL(`https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(listId)}/tasks`);
        tUrl.searchParams.set('showCompleted', 'false');
        tUrl.searchParams.set('showHidden', 'false');
        tUrl.searchParams.set('maxResults', '100');
        const tJson = await googleApiFetch(tUrl.toString());
        for (const t of (tJson.items || [])) {
          if (!t || !t.title) continue;
          if (t.status === 'completed') continue;
          // due is RFC3339
          let dueDate = null;
          let dueTime = null;
          if (t.due) {
            const due = new Date(t.due);
            // Only keep tasks due on the target date (local)
            const localIso = new Date(due.getTime() - due.getTimezoneOffset() * 60000).toISOString().split('T')[0];
            if (localIso !== dateIso) continue;
            dueDate = dateIso;
            dueTime = minutesToTimeStr(due.getHours() * 60 + due.getMinutes());
          }
          const dur = parseDurationFromText(t.notes) || parseDurationFromText(t.title) || defaultDuration;
          allTasks.push({
            id: `G_${t.id}`,
            title: String(t.title),
            duration: Math.max(5, Math.round(dur / 5) * 5),
            deadlineDate: dueDate,
            deadlineTime: dueTime,
            priority: '中',
            split: '可',
            source: 'google',
            listTitle: tl.title || ''
          });
        }
      }

      const cache = loadGoogleCache();
      cache.eventsByDate[dateIso] = events;
      cache.tasksByDate[dateIso] = allTasks;
      cache.lastSync = Date.now();
      saveGoogleCache(cache);

      alert(`Googleから同期しました。\n予定: ${events.length}件\nToDo: ${allTasks.length}件`);
    } catch (e) {
      console.error(e);
      alert(`Google同期に失敗しました。\n${e.message || e}`);
    }
  }

  // Convert time string 'HH:MM' to minutes since midnight
  function timeStrToMinutes(str) {
    const [hh, mm] = str.split(':').map(Number);
    return hh * 60 + mm;
  }

  // Convert minutes since midnight to time string 'HH:MM'
  function minutesToTimeStr(mins) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  // Format Date object to iCal date/time (YYYYMMDDTHHMMSS)
  function dateToICS(d) {
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    const s = String(d.getSeconds()).padStart(2, '0');
    return `${y}${mo}${da}T${h}${m}${s}`;
  }

  // Navigation handler
  function showView(view) {
    viewToday.classList.add('hidden');
    viewTasks.classList.add('hidden');
    viewSettings.classList.add('hidden');
    navTodayBtn.classList.remove('active');
    navTasksBtn.classList.remove('active');
    navSettingsBtn.classList.remove('active');
    const appbarTitle = document.getElementById('appbar-title');
    const appbarActions = document.querySelector('.appbar-actions');
    if (view === 'today') {
      viewToday.classList.remove('hidden');
      navTodayBtn.classList.add('active');
      if (appbarTitle) appbarTitle.textContent = '今日の時間割';
      if (appbarActions) appbarActions.classList.remove('hidden');
    } else if (view === 'tasks') {
      viewTasks.classList.remove('hidden');
      navTasksBtn.classList.add('active');
      if (appbarTitle) appbarTitle.textContent = 'タスク';
      if (appbarActions) appbarActions.classList.add('hidden');
    } else if (view === 'settings') {
      viewSettings.classList.remove('hidden');
      navSettingsBtn.classList.add('active');
      if (appbarTitle) appbarTitle.textContent = '設定';
      if (appbarActions) appbarActions.classList.add('hidden');
    }
  }

  // Render tasks list
  function renderTasks() {
    const tasks = loadTasks();
    const settings = loadSettings();
    const googleCache = loadGoogleCache();
    const googleTasks = (googleCache.tasksByDate[settings.date] || []);

    tasksListEl.innerHTML = '';

    // Local tasks (editable)
    tasks.forEach((task) => {
      const li = document.createElement('li');
      li.className = 'task-item';
      li.dataset.id = task.id;
      const title = document.createElement('div');
      title.textContent = `${task.title} (${task.duration}分)`;
      const btnGroup = document.createElement('div');
      const editBtn = document.createElement('button');
      editBtn.className = 'edit-btn';
      editBtn.textContent = '編集';
      editBtn.addEventListener('click', () => editTask(task.id));
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'delete-btn';
      deleteBtn.textContent = '削除';
      deleteBtn.addEventListener('click', () => deleteTask(task.id));
      btnGroup.appendChild(editBtn);
      btnGroup.appendChild(deleteBtn);
      li.appendChild(title);
      li.appendChild(btnGroup);
      tasksListEl.appendChild(li);
    });

    // Google tasks (read-only)
    if (googleTasks.length) {
      const sep = document.createElement('li');
      sep.className = 'task-sep';
      sep.textContent = `Google ToDo（同期: ${googleTasks.length}件 / 対象日）`;
      tasksListEl.appendChild(sep);

      googleTasks.forEach((t) => {
        const li = document.createElement('li');
        li.className = 'task-item google';
        const title = document.createElement('div');
        const suffix = t.listTitle ? ` / ${t.listTitle}` : '';
        title.textContent = `${t.title}${suffix} (${t.duration}分)`;
        const btnGroup = document.createElement('div');
        const lock = document.createElement('span');
        lock.className = 'task-lock';
        lock.textContent = '同期';
        btnGroup.appendChild(lock);
        li.appendChild(title);
        li.appendChild(btnGroup);
        tasksListEl.appendChild(li);
      });
    }
  }

  // Open form to edit existing task
  function editTask(id) {
    const tasks = loadTasks();
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    // Populate form
    taskTitleInput.value = task.title;
    taskDurationInput.value = task.duration;
    taskDeadlineDateInput.value = task.deadlineDate || '';
    taskDeadlineTimeInput.value = task.deadlineTime || '';
    taskPriorityInput.value = task.priority;
    taskSplitInput.value = task.split;
    // Remove the task to re-add on submit
    deleteTask(id);
    showTaskForm(true);
  }

  // Delete task by id
  function deleteTask(id) {
    const tasks = loadTasks();
    const newTasks = tasks.filter((t) => t.id !== id);
    saveTasks(newTasks);
    renderTasks();
  }

  // Toggle task form visibility
  function showTaskForm(show) {
    if (show) {
      taskForm.classList.remove('hidden');
      addTaskToggle.classList.add('hidden');
    } else {
      taskForm.classList.add('hidden');
      addTaskToggle.classList.remove('hidden');
      // Clear form
      taskTitleInput.value = '';
      taskDurationInput.value = '';
      taskDeadlineDateInput.value = '';
      taskDeadlineTimeInput.value = '';
      taskPriorityInput.value = '中';
      taskSplitInput.value = '可';
    }
  }

  // Generate a unique ID for tasks
  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  }

  // Validate and add task
  taskForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = taskTitleInput.value.trim();
    const duration = parseInt(taskDurationInput.value, 10);
    const deadlineDate = taskDeadlineDateInput.value ? taskDeadlineDateInput.value : null;
    const deadlineTime = taskDeadlineTimeInput.value ? taskDeadlineTimeInput.value : null;
    const priority = taskPriorityInput.value;
    const split = taskSplitInput.value;
    if (!title || !duration || duration <= 0) {
      alert('タスク名と所要時間を正しく入力してください。');
      return;
    }
    const tasks = loadTasks();
    tasks.push({ id: generateId(), title, duration, deadlineDate, deadlineTime, priority, split, status: '未着手' });
    saveTasks(tasks);
    renderTasks();
    showTaskForm(false);
  });

  cancelTaskFormBtn.addEventListener('click', () => {
    showTaskForm(false);
  });

  addTaskToggle.addEventListener('click', () => {
    showTaskForm(true);
  });

  // Settings form
  settingsForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const date = settingDateInput.value || loadSettings().date;
    const start = settingStartInput.value;
    const end = settingEndInput.value;
    const buffer = parseInt(settingBufferInput.value, 10) || 0;
    const googleDefaultDuration = Math.max(5, Number(googleDefaultDurationInput?.value || 30));
    saveSettings({ date, start, end, buffer, googleDefaultDuration });
    alert('設定を保存しました');
  });

  // Navigation button events
  navTodayBtn.addEventListener('click', () => showView('today'));
  navTasksBtn.addEventListener('click', () => showView('tasks'));
  navSettingsBtn.addEventListener('click', () => showView('settings'));

  // Schedule generation algorithm
  function generateSchedule() {
    const settings = loadSettings();
    const localTasks = loadTasks();
    const googleCache = loadGoogleCache();
    const googleTasks = (googleCache.tasksByDate[settings.date] || []);
    const tasks = [...localTasks, ...googleTasks];
    const startDay = timeStrToMinutes(settings.start);
    const endDay = timeStrToMinutes(settings.end);
    const bufferMin = Number(settings.buffer) || 0;
    if (endDay <= startDay) {
      alert('1日の終了時間は開始時間より後に設定してください。');
      return;
    }
    // Sort tasks: priority (高=3, 中=2, 低=1) then deadline ascending
    const priorityMap = { '高': 3, '中': 2, '低': 1 };
    const sortedTasks = tasks.slice().sort((a, b) => {
      const prDiff = priorityMap[b.priority] - priorityMap[a.priority];
      if (prDiff !== 0) return prDiff;
      // Compare deadlines: tasks with earlier deadlines first; null deadlines last
      const aDue = a.deadlineDate ? new Date(`${a.deadlineDate}T${a.deadlineTime || '23:59'}`) : null;
      const bDue = b.deadlineDate ? new Date(`${b.deadlineDate}T${b.deadlineTime || '23:59'}`) : null;
      if (aDue && bDue) return aDue - bDue;
      if (aDue && !bDue) return -1;
      if (!aDue && bDue) return 1;
      return 0;
    });
    // Initialize free intervals as a list of objects {start, end}
    let freeIntervals = [ { start: startDay, end: endDay } ];
    const blocks = [];
    const unplaced = [];

    // Reserve Google Calendar events as busy (予定) and render them
    const googleEvents = (googleCache.eventsByDate[settings.date] || []);
    for (const ev of googleEvents) {
      const busy = {
        start: Math.max(startDay, Number(ev.startMin)),
        end: Math.min(endDay, Number(ev.endMin))
      };
      if (!Number.isFinite(busy.start) || !Number.isFinite(busy.end)) continue;
      if (busy.end <= busy.start) continue;
      freeIntervals = subtractBusy(freeIntervals, busy);
      blocks.push({
        id: `E_${ev.id || generateId()}`,
        title: ev.title || '(予定)',
        start: busy.start,
        end: busy.end,
        kind: '予定'
      });
    }
    // Helper to subtract busy interval from free intervals
    function subtractBusy(free, busy) {
      const result = [];
      for (const iv of free) {
        // no overlap
        if (busy.end <= iv.start || busy.start >= iv.end) {
          result.push({ ...iv });
        } else {
          // overlap: left side
          if (busy.start > iv.start) {
            result.push({ start: iv.start, end: busy.start });
          }
          // right side
          if (busy.end < iv.end) {
            result.push({ start: busy.end, end: iv.end });
          }
        }
      }
      // Sort by start time
      return result.sort((a, b) => a.start - b.start);
    }

    // Allocate tasks
    for (const t of sortedTasks) {
      let remaining = t.duration;
      let allocated = false;
      // For unsplittable tasks, we need one block of full duration
      if (t.split === '不可') {
        for (let i = 0; i < freeIntervals.length; i++) {
          const iv = freeIntervals[i];
          const available = iv.end - iv.start;
          if (available >= remaining) {
            const blockStart = iv.start;
            const blockEnd = iv.start + remaining;
            const kind = (t.source === 'google') ? 'ToDo' : 'タスク';
            const title = (t.source === 'google' && t.listTitle) ? `${t.title}（${t.listTitle}）` : t.title;
            blocks.push({ id: generateId(), title, start: blockStart, end: blockEnd, kind });
            // remove used interval plus buffer
            const busy = { start: blockStart, end: blockEnd + bufferMin };
            freeIntervals = subtractBusy(freeIntervals, busy);
            allocated = true;
            break;
          }
        }
        if (!allocated) {
          unplaced.push({ title: t.title, remaining: remaining });
        }
      } else {
        // Splittable tasks can be divided across free intervals
        let usedAny = false;
        let newBlocks = [];
        for (let i = 0; i < freeIntervals.length && remaining > 0; i++) {
          const iv = freeIntervals[i];
          const available = iv.end - iv.start;
          if (available <= 0) continue;
          const use = Math.min(available, remaining);
          const blockStart = iv.start;
          const blockEnd = iv.start + use;
          const kind = (t.source === 'google') ? 'ToDo' : 'タスク';
          const title = (t.source === 'google' && t.listTitle) ? `${t.title}（${t.listTitle}）` : t.title;
          newBlocks.push({ id: generateId(), title, start: blockStart, end: blockEnd, kind });
          const busy = { start: blockStart, end: blockEnd + bufferMin };
          freeIntervals = subtractBusy(freeIntervals, busy);
          remaining -= use;
          usedAny = true;
          // Reset i because freeIntervals mutated
          i = -1;
        }
        if (remaining > 0) {
          // Could not allocate full duration; record unplaced remainder
          unplaced.push({ title: t.title, remaining: remaining });
        }
        if (usedAny) {
          // Append newly allocated blocks for this task
          for (const b of newBlocks) {
            blocks.push(b);
          }
        }
      }
    }
    // Save schedule to localStorage for later use (e.g., export)
    saveSchedule({ blocks, unplaced, settings });
    // Render schedule
    renderSchedule(blocks, unplaced, settings);
  }

  // Render schedule on the timeline
  function renderSchedule(blocks, unplaced, settings) {
    // Clear previous
    scheduleList.innerHTML = '';
    unplacedContainer.innerHTML = '';
    const startDay = timeStrToMinutes(settings.start);
    const endDay = timeStrToMinutes(settings.end);
    const total = endDay - startDay;
    // Create timeline relative container height (using CSS absolute positioning)
    blocks.sort((a, b) => a.start - b.start);

    // Keep a working copy for drag operations
    const state = {
      settings,
      blocks: blocks.map(b => ({ ...b })),
    };

    const snap = 5; // minutes
    const pxPerMin = scheduleList.clientHeight / Math.max(1, total);

    function blocksOverlap(a, b) {
      return Math.max(a.start, b.start) < Math.min(a.end, b.end);
    }

    function withinDay(b) {
      return b.start >= startDay && b.end <= endDay && b.end > b.start;
    }

    function persist() {
      const cur = loadSchedule() || {};
      saveSchedule({
        ...cur,
        blocks: state.blocks,
        unplaced,
        settings,
      });
    }

    function renderOne(blk) {
      const div = document.createElement('div');
      div.className = 'time-slot task';
      div.dataset.id = blk.id;
      const topPercent = ((blk.start - startDay) / total) * 100;
      const heightPercent = ((blk.end - blk.start) / total) * 100;
      div.style.top = `${topPercent}%`;
      div.style.height = `${heightPercent}%`;
      div.innerHTML = `<div class="slot-title">${escapeHtml_(blk.title)}</div>
        <div class="slot-time">${minutesToTimeStr(blk.start)} - ${minutesToTimeStr(blk.end)}</div>`;

      // Drag to move (snap 5min), with overlap protection
      let dragging = false;
      let startY = 0;
      let origStart = 0;
      let origEnd = 0;

      const onPointerMove = (ev) => {
        if (!dragging) return;
        ev.preventDefault();
        const dy = ev.clientY - startY;
        const deltaMinRaw = dy / Math.max(1, pxPerMin);
        const deltaMin = Math.round(deltaMinRaw / snap) * snap;
        const duration = origEnd - origStart;
        let nextStart = origStart + deltaMin;
        let nextEnd = nextStart + duration;

        // Clamp to day
        if (nextStart < startDay) {
          nextStart = startDay;
          nextEnd = startDay + duration;
        }
        if (nextEnd > endDay) {
          nextEnd = endDay;
          nextStart = endDay - duration;
        }

        // Apply tentative
        blk.start = nextStart;
        blk.end = nextEnd;
        const topPercent2 = ((blk.start - startDay) / total) * 100;
        div.style.top = `${topPercent2}%`;
        div.querySelector('.slot-time').textContent = `${minutesToTimeStr(blk.start)} - ${minutesToTimeStr(blk.end)}`;
      };

      const onPointerUp = (ev) => {
        if (!dragging) return;
        dragging = false;
        div.classList.remove('dragging');
        div.releasePointerCapture(ev.pointerId);

        // Validate (no overlap)
        const me = blk;
        const ok1 = withinDay(me);
        const ok2 = !state.blocks.some(other => other.id !== me.id && blocksOverlap(me, other));
        if (!ok1 || !ok2) {
          // revert
          me.start = origStart;
          me.end = origEnd;
          const topPercent2 = ((me.start - startDay) / total) * 100;
          div.style.top = `${topPercent2}%`;
          div.querySelector('.slot-time').textContent = `${minutesToTimeStr(me.start)} - ${minutesToTimeStr(me.end)}`;
          // small feedback
          div.classList.add('shake');
          setTimeout(() => div.classList.remove('shake'), 260);
        } else {
          // persist and re-render ordering
          persist();
        }

        window.removeEventListener('pointermove', onPointerMove, { capture: true });
        window.removeEventListener('pointerup', onPointerUp, { capture: true });
        window.removeEventListener('pointercancel', onPointerUp, { capture: true });
      };

      div.addEventListener('pointerdown', (ev) => {
        // Ignore accidental scroll: only primary pointer
        if (ev.button !== 0) return;
        dragging = true;
        startY = ev.clientY;
        origStart = blk.start;
        origEnd = blk.end;
        div.classList.add('dragging');
        div.setPointerCapture(ev.pointerId);
        window.addEventListener('pointermove', onPointerMove, { passive: false, capture: true });
        window.addEventListener('pointerup', onPointerUp, { passive: false, capture: true });
        window.addEventListener('pointercancel', onPointerUp, { passive: false, capture: true });
      });

      scheduleList.appendChild(div);
    }

    // Render all blocks
    state.blocks.forEach(renderOne);
    
    // Unplaced tasks
    if (unplaced.length > 0) {
      const heading = document.createElement('h3');
      heading.textContent = '未配置タスク';
      unplacedContainer.appendChild(heading);
      unplaced.forEach((u) => {
        const div = document.createElement('div');
        div.className = 'time-slot unplaced';
        div.innerHTML = `<strong>${u.title}</strong>（残り${u.remaining}分）`;
        unplacedContainer.appendChild(div);
      });
    }
  }

  function escapeHtml_(s) {
    return String(s)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  // Export schedule to iCal file
  function exportSchedule() {
    const schedule = loadSchedule();
    if (!schedule) {
      alert('先に今日の時間割を作成してください。');
      return;
    }
    const { blocks, settings } = schedule;
    const eventLines = [];
    const todayDate = settings.date || new Date().toISOString().split('T')[0];
    // timezone offset for local; we won't adjust to UTC because this is local schedule
    blocks.forEach((blk, idx) => {
      const dateParts = todayDate.split('-');
      const year = parseInt(dateParts[0], 10);
      const month = parseInt(dateParts[1], 10) - 1;
      const day = parseInt(dateParts[2], 10);
      const startMinutes = blk.start;
      const endMinutes = blk.end;
      const startDate = new Date(year, month, day, Math.floor(startMinutes / 60), startMinutes % 60);
      const endDate = new Date(year, month, day, Math.floor(endMinutes / 60), endMinutes % 60);
      eventLines.push('BEGIN:VEVENT');
      eventLines.push(`UID:${blk.title}-${idx}@autoscheduler`);
      eventLines.push(`DTSTAMP:${dateToICS(new Date())}`);
      eventLines.push(`DTSTART:${dateToICS(startDate)}`);
      eventLines.push(`DTEND:${dateToICS(endDate)}`);
      eventLines.push(`SUMMARY:${blk.title}`);
      eventLines.push('END:VEVENT');
    });
    const icsContent = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//AutoScheduler//JP//EN',
      ...eventLines,
      'END:VCALENDAR'
    ].join('\r\n');
    const blob = new Blob([icsContent], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'schedule.ics';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  // Event listeners
  generateBtn.addEventListener('click', generateSchedule);
  exportBtn.addEventListener('click', exportSchedule);

  // Google integration buttons
  if (googleAuthBtn) googleAuthBtn.addEventListener('click', () => {
    if (isGoogleSignedIn()) {
      showView('settings');
    } else {
      googleSignIn(true);
    }
  });
  if (googleAuthBtn2) googleAuthBtn2.addEventListener('click', () => googleSignIn(true));
  if (googleSignoutBtn) googleSignoutBtn.addEventListener('click', () => googleSignOut());
  if (googleSyncBtn) googleSyncBtn.addEventListener('click', () => syncFromGoogle());
  if (googleSyncBtn2) googleSyncBtn2.addEventListener('click', () => syncFromGoogle());

  // Initial render
  (function init() {
    // Load settings into form
    const settings = loadSettings();
    settingDateInput.value = settings.date;
    settingStartInput.value = settings.start;
    settingEndInput.value = settings.end;
    settingBufferInput.value = settings.buffer;
    if (googleDefaultDurationInput) googleDefaultDurationInput.value = settings.googleDefaultDuration || 30;

    initGoogleAuth();
    setGoogleUiState();
    renderTasks();
    // Show today view by default
    showView('today');
    // Try to load previous schedule
    const existing = loadSchedule();
    if (existing) {
      renderSchedule(existing.blocks, existing.unplaced, existing.settings);
    }
  })();
});

// Register the service worker to enable offline support. This code runs
// outside of the DOMContentLoaded handler so that it executes as soon as
// the browser has finished loading the window. If service workers are
// supported in the current browser, the registration attempts to register
// the service-worker.js file located in the same directory. Any errors are
// logged to the console for debugging purposes.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('service-worker.js')
      .catch((err) => {
        console.error('Service Worker registration failed:', err);
      });
  });
}