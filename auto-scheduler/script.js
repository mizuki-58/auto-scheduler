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

  // --- Data store keys ---
  const TASKS_KEY = 'autoSchedulerTasks';
  const SETTINGS_KEY = 'autoSchedulerSettings';
  const SCHEDULE_KEY = 'autoSchedulerSchedule';

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
      return { date: iso, start: '07:00', end: '23:00', buffer: 5 };
    } catch (e) {
      console.error('Error loading settings', e);
      return { date: '', start: '07:00', end: '23:00', buffer: 5 };
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
    if (view === 'today') {
      viewToday.classList.remove('hidden');
      navTodayBtn.classList.add('active');
    } else if (view === 'tasks') {
      viewTasks.classList.remove('hidden');
      navTasksBtn.classList.add('active');
    } else if (view === 'settings') {
      viewSettings.classList.remove('hidden');
      navSettingsBtn.classList.add('active');
    }
  }

  // Render tasks list
  function renderTasks() {
    const tasks = loadTasks();
    tasksListEl.innerHTML = '';
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
    saveSettings({ date, start, end, buffer });
    alert('設定を保存しました');
  });

  // Navigation button events
  navTodayBtn.addEventListener('click', () => showView('today'));
  navTasksBtn.addEventListener('click', () => showView('tasks'));
  navSettingsBtn.addEventListener('click', () => showView('settings'));

  // Schedule generation algorithm
  function generateSchedule() {
    const settings = loadSettings();
    const tasks = loadTasks();
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
            blocks.push({ title: t.title, start: blockStart, end: blockEnd });
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
          newBlocks.push({ title: t.title, start: blockStart, end: blockEnd });
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
    blocks.forEach((blk) => {
      const div = document.createElement('div');
      div.className = 'time-slot task';
      const topPercent = ((blk.start - startDay) / total) * 100;
      const heightPercent = ((blk.end - blk.start) / total) * 100;
      div.style.top = `${topPercent}%`;
      div.style.height = `${heightPercent}%`;
      div.innerHTML = `<strong>${blk.title}</strong><br>${minutesToTimeStr(blk.start)} - ${minutesToTimeStr(blk.end)}`;
      scheduleList.appendChild(div);
    });
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

  // Initial render
  (function init() {
    // Load settings into form
    const settings = loadSettings();
    settingDateInput.value = settings.date;
    settingStartInput.value = settings.start;
    settingEndInput.value = settings.end;
    settingBufferInput.value = settings.buffer;
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