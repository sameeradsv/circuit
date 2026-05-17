"use strict";
(() => {
  // src/behavioral-engine/completion-patterns.ts
  function recordCompletion(task, completedAt = Date.now()) {
    const rate = task.historicalCompletionRate;
    const updated = rate * 0.7 + 0.3;
    return {
      ...task,
      completed: true,
      historicalCompletionRate: Math.min(1, updated),
      updatedAt: completedAt
    };
  }
  function completionRateByTag(tasks2) {
    const stats = {};
    for (const task of tasks2) {
      if (!stats[task.tag])
        stats[task.tag] = { done: 0, total: 0 };
      stats[task.tag].total += 1;
      if (task.completed)
        stats[task.tag].done += 1;
    }
    return Object.fromEntries(
      Object.entries(stats).map(([tag, { done, total }]) => [
        tag,
        total === 0 ? 0 : done / total
      ])
    );
  }

  // src/behavioral-engine/execution-windows.ts
  function hourBucket(ts) {
    const h = new Date(ts).getHours();
    if (h < 12)
      return "morning";
    if (h < 17)
      return "afternoon";
    return "evening";
  }
  function inferPreferredWindows(tasks2) {
    const completed = tasks2.filter((t) => t.completed);
    const buckets = {};
    for (const task of completed) {
      const bucket = hourBucket(task.updatedAt);
      buckets[bucket] = (buckets[bucket] ?? 0) + 1;
    }
    const best = Object.entries(buckets).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    return tasks2.map(
      (t) => t.completed ? t : { ...t, preferredExecutionWindow: t.preferredExecutionWindow ?? best }
    );
  }
  function isInPreferredWindow(task, now = Date.now()) {
    if (!task.preferredExecutionWindow)
      return true;
    return hourBucket(now) === task.preferredExecutionWindow;
  }

  // src/behavioral-engine/procrastination.ts
  var STALE_MS = 3 * 24 * 60 * 60 * 1e3;
  function detectProcrastination(tasks2, now = Date.now()) {
    const insights = [];
    for (const task of tasks2) {
      if (task.completed)
        continue;
      const age = now - task.createdAt;
      const stale = age > STALE_MS && !task.completed;
      const skipped = task.skippedCount >= 2;
      if (stale) {
        insights.push({
          type: "procrastination",
          message: `"${task.text}" has been open for ${Math.floor(age / 864e5)} days \u2014 try a tiny step`,
          taskId: task.id
        });
      } else if (skipped) {
        insights.push({
          type: "procrastination",
          message: `"${task.text}" was skipped ${task.skippedCount} times`,
          taskId: task.id
        });
      }
    }
    return insights;
  }

  // src/behavioral-engine/recommendations.ts
  function adaptiveRecommendations(tasks2, mode) {
    const insights = [];
    const pending = tasks2.filter((t) => !t.completed);
    for (const task of pending) {
      if (!isInPreferredWindow(task) && task.preferredExecutionWindow) {
        insights.push({
          type: "window",
          message: `"${task.text}" is usually done in the ${task.preferredExecutionWindow}`,
          taskId: task.id
        });
      }
    }
    if (mode === "low") {
      const easy = pending.find((t) => t.effort === "low" || t.tinyStep);
      if (easy) {
        insights.push({
          type: "recommendation",
          message: `Low energy: start with "${easy.text}"`,
          taskId: easy.id
        });
      }
    }
    if (mode === "deep") {
      const deep = pending.find((t) => t.focusType === "deep");
      if (deep) {
        insights.push({
          type: "recommendation",
          message: `Deep work block: focus on "${deep.text}"`,
          taskId: deep.id
        });
      }
    }
    return insights.slice(0, 3);
  }

  // src/behavioral-engine/index.ts
  function analyzeBehavior(tasks2, mode) {
    const withWindows = inferPreferredWindows(tasks2);
    return [
      ...detectProcrastination(withWindows),
      ...adaptiveRecommendations(withWindows, mode)
    ];
  }

  // src/task-engine/schema.ts
  var EFFORT_LOAD = {
    low: 0.25,
    medium: 0.5,
    high: 0.8
  };
  var TAG_FOCUS = {
    general: "shallow",
    work: "deep",
    social: "shallow",
    later: "admin"
  };
  function createTaskId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }
  function inferTagFromText(text) {
    const lower = text.toLowerCase();
    if (/\b(meeting|email|report|review|code|develop|deploy|fix|bug|test|call|presentation)\b/.test(lower)) {
      return "work";
    }
    if (/\b(friend|family|birthday|party|dinner|lunch|visit|message)\b/.test(lower)) {
      return "social";
    }
    if (/\b(someday|maybe|later|eventually|consider|explore|research)\b/.test(lower)) {
      return "later";
    }
    return "general";
  }
  function inferEffortFromText(text) {
    const lower = text.toLowerCase();
    if (/\b(quick|simple|easy|small|5\s*min)\b/.test(lower))
      return "low";
    if (/\b(complex|difficult|major|large|project|big)\b/.test(lower))
      return "high";
    return "medium";
  }
  function createTask(text, overrides = {}) {
    const now = Date.now();
    const tag = overrides.tag ?? inferTagFromText(text);
    const effort = overrides.effort ?? inferEffortFromText(text);
    const load2 = EFFORT_LOAD[effort];
    return {
      id: createTaskId(),
      text: text.trim(),
      completed: false,
      tag,
      tinyStep: "",
      effort,
      createdAt: now,
      updatedAt: now,
      duration: effort === "low" ? 15 : effort === "high" ? 60 : 30,
      deadlineType: "none",
      timeSensitivity: tag === "work" ? 0.6 : 0.3,
      recurrence: null,
      scheduledAt: null,
      cognitiveLoad: load2,
      emotionalResistance: effort === "high" ? 0.6 : 0.3,
      activationEnergy: load2,
      recoveryCost: load2 * 0.5,
      focusType: TAG_FOCUS[tag],
      locationDependency: null,
      requiredResources: [],
      dependencies: [],
      importance: tag === "work" ? 0.7 : 0.4,
      urgency: 0.4,
      consequenceOfDelay: tag === "work" ? 0.5 : 0.2,
      momentumValue: 0.3,
      compoundBenefit: tag === "work" ? 0.5 : 0.2,
      identityAlignment: 0.4,
      historicalCompletionRate: 0.5,
      preferredExecutionWindow: null,
      delayPattern: null,
      taskDecompositionPotential: effort === "high" ? 0.8 : 0.3,
      energyToRewardRatio: effort === "low" ? 0.8 : 0.4,
      metadata: {},
      skippedCount: 0,
      lastSkippedAt: null,
      ...overrides
    };
  }
  function normalizeTask(raw) {
    if ("cognitiveLoad" in raw && typeof raw.cognitiveLoad === "number") {
      return { ...createTask(raw.text ?? ""), ...raw, updatedAt: raw.updatedAt ?? Date.now() };
    }
    const text = raw.text ?? "";
    const effort = ["low", "medium", "high"].includes(raw.effort ?? "") ? raw.effort : inferEffortFromText(text);
    const tag = ["general", "work", "social", "later"].includes(raw.tag ?? "") ? raw.tag : inferTagFromText(text);
    return createTask(text, {
      id: String(raw.id ?? createTaskId()),
      completed: Boolean(raw.completed),
      tag,
      effort,
      tinyStep: raw.tinyStep ?? "",
      createdAt: raw.createdAt ?? Date.now()
    });
  }

  // src/task-engine/validation.ts
  function clamp01(n, field, errors) {
    if (typeof n !== "number" || Number.isNaN(n) || n < 0 || n > 1) {
      errors.push(`${field} must be a number between 0 and 1`);
      return Math.min(1, Math.max(0, n || 0));
    }
    return n;
  }
  function validateTask(task) {
    const errors = [];
    if (!task.id || typeof task.id !== "string")
      errors.push("id is required");
    if (!task.text || task.text.trim().length < 1)
      errors.push("text is required");
    if (task.text.length > 500)
      errors.push("text must be at most 500 characters");
    const tags = ["general", "work", "social", "later"];
    if (!tags.includes(task.tag))
      errors.push("invalid tag");
    const efforts = ["low", "medium", "high"];
    if (!efforts.includes(task.effort))
      errors.push("invalid effort");
    if (task.duration < 1 || task.duration > 480)
      errors.push("duration must be 1\u2013480 minutes");
    clamp01(task.cognitiveLoad, "cognitiveLoad", errors);
    clamp01(task.importance, "importance", errors);
    clamp01(task.urgency, "urgency", errors);
    return { valid: errors.length === 0, errors };
  }
  function validateTasks(tasks2) {
    const errors = [];
    const ids = /* @__PURE__ */ new Set();
    for (const task of tasks2) {
      const result = validateTask(task);
      errors.push(...result.errors);
      if (ids.has(task.id))
        errors.push(`duplicate id: ${task.id}`);
      ids.add(task.id);
    }
    return { valid: errors.length === 0, errors };
  }

  // src/task-engine/persistence.ts
  var STORAGE_KEY = "circuit_tasks_v1";
  var LEGACY_KEY = "my_tasks_v2";
  var storageSuffix = "";
  function setTaskStorageNamespace(namespace) {
    storageSuffix = namespace;
  }
  function activeKey() {
    return STORAGE_KEY + storageSuffix;
  }
  function loadTasks() {
    const key = activeKey();
    const raw = localStorage.getItem(key) ?? (storageSuffix === "" ? localStorage.getItem(LEGACY_KEY) : null);
    if (!raw)
      return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed))
        return [];
      const tasks2 = parsed.map((item) => normalizeTask(item));
      const { valid } = validateTasks(tasks2);
      if (!valid)
        return tasks2.filter((t) => t.text.trim().length > 0);
      if (!localStorage.getItem(STORAGE_KEY) && localStorage.getItem(LEGACY_KEY)) {
        saveTasks(tasks2);
      }
      return tasks2;
    } catch {
      return [];
    }
  }
  function saveTasks(tasks2) {
    localStorage.setItem(activeKey(), JSON.stringify(tasks2));
  }

  // src/task-engine/filter.ts
  function filterTasks(tasks2, filter, mode = "normal") {
    let result = [...tasks2];
    switch (filter) {
      case "pending":
        result = result.filter((t) => !t.completed);
        break;
      case "completed":
        result = result.filter((t) => t.completed);
        break;
      case "today": {
        const today = startOfDay(Date.now());
        result = result.filter(
          (t) => !t.completed && (startOfDay(t.createdAt) === today || t.tag === "work" || t.scheduledAt !== null)
        );
        break;
      }
      case "scheduled":
        result = result.filter((t) => !t.completed && t.scheduledAt !== null);
        break;
      default:
        break;
    }
    return applyModeFilter(result, mode);
  }
  function applyModeFilter(tasks2, mode) {
    switch (mode) {
      case "low":
        return tasks2.filter((t) => !t.completed && (t.tinyStep.length > 0 || t.effort === "low"));
      case "deep":
        return tasks2.filter((t) => !t.completed && (t.tag === "work" || t.focusType === "deep"));
      case "social":
        return tasks2.filter((t) => t.tag !== "social" && !t.completed);
      default:
        return tasks2;
    }
  }
  function groupTasksByTag(tasks2) {
    return tasks2.reduce((groups, task) => {
      const key = task.tag;
      if (!groups[key])
        groups[key] = [];
      groups[key].push(task);
      return groups;
    }, {});
  }
  function startOfDay(ts) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  // src/ai-assistance/conversational.ts
  function parseConversationalInput(input2) {
    const trimmed = input2.trim();
    if (trimmed.length < 2)
      return null;
    let text = trimmed;
    let deadlineType;
    let duration;
    const urgent = /\b(urgent|asap|today|tonight)\b/i.test(text);
    const later = /\b(tomorrow|next week|someday)\b/i.test(text);
    if (urgent)
      deadlineType = "hard";
    if (later)
      deadlineType = "soft";
    const durMatch = text.match(/\b(\d+)\s*(min|minutes?|hr|hours?)\b/i);
    if (durMatch) {
      const n = parseInt(durMatch[1], 10);
      const unit = durMatch[2].toLowerCase();
      duration = unit.startsWith("h") ? n * 60 : n;
      text = text.replace(durMatch[0], "").trim();
    }
    text = text.replace(/^(add|create|remind me to|i need to)\s+/i, "").trim();
    if (text.length < 2)
      return null;
    return {
      text,
      tag: inferTagFromText(text),
      effort: inferEffortFromText(text),
      duration,
      deadlineType
    };
  }
  function taskFromConversationalInput(input2) {
    const parsed = parseConversationalInput(input2);
    if (!parsed)
      return null;
    return createTask(parsed.text, {
      tag: parsed.tag,
      effort: parsed.effort,
      duration: parsed.duration,
      deadlineType: parsed.deadlineType ?? "none",
      urgency: parsed.deadlineType === "hard" ? 0.9 : parsed.deadlineType === "soft" ? 0.5 : 0.4
    });
  }

  // src/ai-assistance/explanations.ts
  function explainSchedule(plan) {
    if (plan.ordered.length === 0)
      return "Nothing scheduled \u2014 add tasks or lower your load.";
    const lines = plan.ordered.slice(0, 5).map((s, i) => {
      const why = s.reasons.length ? ` (${s.reasons.join(", ")})` : "";
      return `${i + 1}. ${s.task.text}${why}`;
    });
    return `Plan: ${plan.workloadMinutes} min total.
${lines.join("\n")}`;
  }

  // src/scheduling-engine/scoring.ts
  function scoreTask(task, ctx) {
    if (task.completed) {
      return { task, score: -1, reasons: ["completed"] };
    }
    const reasons = [];
    let score = 0;
    const importanceUrgency = task.importance * 0.4 + task.urgency * 0.35 + task.consequenceOfDelay * 0.25;
    score += importanceUrgency * 40;
    if (importanceUrgency > 0.5)
      reasons.push("high priority");
    if (task.scheduledAt && task.scheduledAt <= ctx.now) {
      score += 25;
      reasons.push("scheduled for now");
    }
    const energyFit = modeEnergyFit(task, ctx.mode);
    score += energyFit * 20;
    if (energyFit > 0.7)
      reasons.push(`fits ${ctx.mode} mode`);
    if (task.tinyStep) {
      score += 10;
      reasons.push("has tiny step");
    }
    score += task.momentumValue * 15;
    if (task.momentumValue > 0.5)
      reasons.push("builds momentum");
    score -= task.cognitiveLoad * 10 * (ctx.mode === "low" ? 2 : 1);
    score -= task.emotionalResistance * 8;
    score -= task.skippedCount * 3;
    score += task.energyToRewardRatio * 12;
    if (task.duration <= ctx.availableMinutes) {
      score += 5;
    } else {
      score -= 15;
      reasons.push("may exceed available time");
    }
    return { task, score, reasons };
  }
  function modeEnergyFit(task, mode) {
    switch (mode) {
      case "low":
        return task.effort === "low" ? 1 : task.effort === "medium" ? 0.4 : 0.1;
      case "deep":
        return task.focusType === "deep" || task.tag === "work" ? 1 : 0.3;
      case "social":
        return task.tag !== "social" ? 0.8 : 0.2;
      default:
        return 0.7;
    }
  }
  function scoreTasks(tasks2, ctx) {
    return tasks2.filter((t) => !t.completed).map((t) => scoreTask(t, ctx)).sort((a, b) => b.score - a.score);
  }

  // src/scheduling-engine/conflicts.ts
  function resolveConflicts(scored) {
    const byWindow = /* @__PURE__ */ new Map();
    for (const item of scored) {
      const window2 = item.task.preferredExecutionWindow ?? "any";
      const existing = byWindow.get(window2);
      if (!existing || item.score > existing.score) {
        byWindow.set(window2, item);
      }
    }
    const winners = new Set([...byWindow.values()].map((s) => s.task.id));
    const resolved = [];
    const seen = /* @__PURE__ */ new Set();
    for (const item of scored) {
      if (seen.has(item.task.id))
        continue;
      const window2 = item.task.preferredExecutionWindow ?? "any";
      const winner = byWindow.get(window2);
      if (winner && winner.task.id !== item.task.id && item.task.scheduledAt && winner.task.scheduledAt) {
        const overlap = Math.abs(item.task.scheduledAt - winner.task.scheduledAt) < 30 * 60 * 1e3;
        if (overlap && item.score < winner.score)
          continue;
      }
      resolved.push(item);
      seen.add(item.task.id);
    }
    return resolved.length > 0 ? resolved : scored;
  }

  // src/scheduling-engine/workload.ts
  function balanceWorkload(scored, availableMinutes) {
    let total = 0;
    const kept = [];
    for (const item of scored) {
      if (total + item.task.duration <= availableMinutes) {
        kept.push(item);
        total += item.task.duration;
      } else if (kept.length === 0 && item.task.duration <= availableMinutes * 1.25) {
        kept.push(item);
        total += item.task.duration;
      }
    }
    return kept.length > 0 ? kept : scored.slice(0, 3);
  }

  // src/scheduling-engine/fragmentation.ts
  function reduceFragmentation(scored) {
    if (scored.length <= 1)
      return scored;
    const groups = /* @__PURE__ */ new Map();
    for (const item of scored) {
      const key = item.task.focusType;
      if (!groups.has(key))
        groups.set(key, []);
      groups.get(key).push(item);
    }
    const result = [];
    const sortedGroups = [...groups.entries()].sort(
      (a, b) => (b[1][0]?.score ?? 0) - (a[1][0]?.score ?? 0)
    );
    for (const [, items] of sortedGroups) {
      items.sort((a, b) => b.score - a.score);
      result.push(...items);
    }
    return result;
  }

  // src/scheduling-engine/heuristics.ts
  function buildSchedule(tasks2, ctx) {
    const scored = scoreTasks(tasks2, ctx);
    const resolved = resolveConflicts(scored);
    const balanced = balanceWorkload(resolved, ctx.availableMinutes);
    const ordered = reduceFragmentation(balanced);
    const workloadMinutes = ordered.reduce((sum, s) => sum + s.task.duration, 0);
    const top = ordered[0];
    const explanation = top ? `Start with "${top.task.text}" \u2014 ${top.reasons.join(", ") || "best fit for now"}` : "No pending tasks to schedule";
    return { ordered, explanation, workloadMinutes };
  }

  // src/ai-assistance/predictive.ts
  function forecastDay(tasks2, mode) {
    const ctx = {
      mode,
      now: Date.now(),
      availableMinutes: 240,
      completedToday: 0
    };
    const plan = buildSchedule(tasks2, ctx);
    const pendingMinutes = tasks2.filter((t) => !t.completed).reduce((s, t) => s + t.duration, 0);
    const fitCount = plan.ordered.filter((s) => s.score > 20).length;
    return {
      likelyCompleted: Math.min(fitCount, Math.ceil(240 / 30)),
      focusTask: plan.ordered[0]?.task.text ?? null,
      riskOfOverload: pendingMinutes > 360
    };
  }

  // src/recommendation-engine/index.ts
  function getRecommendations(tasks2, mode) {
    const ctx = {
      mode,
      now: Date.now(),
      availableMinutes: 240,
      completedToday: tasks2.filter(
        (t) => t.completed && t.updatedAt > startOfDay2(Date.now())
      ).length
    };
    const plan = buildSchedule(tasks2, ctx);
    const behavioral = analyzeBehavior(tasks2, mode);
    const recs = [];
    if (plan.ordered[0]) {
      recs.push({
        headline: plan.explanation,
        detail: plan.ordered.slice(0, 3).map((s) => s.task.text).join(" \u2192 "),
        taskId: plan.ordered[0].task.id
      });
    }
    for (const insight of behavioral) {
      recs.push({ headline: insight.message, detail: insight.type, taskId: insight.taskId });
    }
    return recs.slice(0, 4);
  }
  function startOfDay2(ts) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  // src/app/calendar.ts
  var selectedDate = startOfDay3(/* @__PURE__ */ new Date());
  var cachedTasks = [];
  var handlers = {
    onTaskClick: () => {
    },
    onDateChange: () => {
    }
  };
  function initCalendar(h) {
    handlers = h;
    document.getElementById("cal-prev")?.addEventListener("click", () => shiftDay(-1));
    document.getElementById("cal-next")?.addEventListener("click", () => shiftDay(1));
    document.getElementById("cal-today")?.addEventListener("click", () => {
      selectedDate = startOfDay3(/* @__PURE__ */ new Date());
      handlers.onDateChange(selectedDate);
      renderCalendarView(cachedTasks);
    });
  }
  function renderCalendarView(tasks2) {
    cachedTasks = tasks2;
    const label = document.getElementById("cal-label");
    const strip = document.getElementById("cal-week-strip");
    const dayView = document.getElementById("cal-day-view");
    if (!label || !strip || !dayView)
      return;
    const weekStart = startOfWeek(selectedDate);
    label.textContent = formatDayHeading(selectedDate);
    strip.innerHTML = Array.from({ length: 7 }, (_, i) => {
      const day = addDays(weekStart, i);
      const active = isSameDay(day, selectedDate);
      const count = tasksForDay(tasks2, day).length;
      return `<button type="button" class="cal-day-pill${active ? " active" : ""}" data-cal-day="${day.getTime()}">
      <span class="cal-pill-dow">${day.toLocaleDateString(void 0, { weekday: "short" })}</span>
      <span class="cal-pill-num">${day.getDate()}</span>
      ${count ? `<span class="cal-pill-count">${count}</span>` : ""}
    </button>`;
    }).join("");
    strip.querySelectorAll("[data-cal-day]").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedDate = startOfDay3(Number(btn.dataset.calDay));
        handlers.onDateChange(selectedDate);
        renderCalendarView(tasks2);
      });
    });
    const dayTasks = tasksForDay(tasks2, selectedDate);
    const isToday = isSameDay(selectedDate, /* @__PURE__ */ new Date());
    if (dayTasks.length === 0) {
      dayView.innerHTML = `<p class="cal-empty">${isToday ? "Nothing scheduled for today." : "No tasks on this day."}</p>`;
      return;
    }
    const timed = dayTasks.filter((t) => t.scheduledAt != null).sort((a, b) => (a.scheduledAt ?? 0) - (b.scheduledAt ?? 0));
    const untimed = dayTasks.filter((t) => t.scheduledAt == null);
    const blocks = [];
    if (timed.length) {
      blocks.push(
        `<div class="cal-block"><h3 class="cal-block-title">Scheduled</h3><ul class="cal-task-list">${timed.map((t) => taskRow(t)).join("")}</ul></div>`
      );
    }
    if (untimed.length) {
      blocks.push(
        `<div class="cal-block"><h3 class="cal-block-title">${isToday ? "Plan (no time set)" : "Unscheduled"}</h3><ul class="cal-task-list">${untimed.map((t) => taskRow(t)).join("")}</ul></div>`
      );
    }
    dayView.innerHTML = blocks.join("");
    dayView.querySelectorAll(".cal-task-row").forEach((row) => {
      row.addEventListener("click", () => {
        const id = row.dataset.taskId;
        if (id)
          handlers.onTaskClick(id);
      });
    });
  }
  function taskRow(task) {
    const time = task.scheduledAt != null ? new Date(task.scheduledAt).toLocaleTimeString(void 0, { hour: "numeric", minute: "2-digit" }) : "";
    return `<li class="cal-task-row${task.completed ? " completed" : ""}" data-task-id="${escapeAttr(task.id)}">
    ${time ? `<span class="cal-task-time">${escapeHtml(time)}</span>` : ""}
    <span class="cal-task-text">${escapeHtml(task.text)}</span>
    <span class="cal-task-meta">${task.duration}m \xB7 ${task.tag}</span>
  </li>`;
  }
  function tasksForDay(tasks2, day) {
    const start = startOfDay3(day.getTime()).getTime();
    const end = start + 864e5;
    const todayStart = startOfDay3(Date.now()).getTime();
    const isToday = start === todayStart;
    return tasks2.filter((t) => {
      if (t.scheduledAt != null) {
        const at = t.scheduledAt;
        return at >= start && at < end;
      }
      if (isToday && !t.completed)
        return true;
      if (t.completed && t.updatedAt >= start && t.updatedAt < end)
        return true;
      return false;
    });
  }
  function shiftDay(delta) {
    selectedDate = addDays(selectedDate, delta);
    handlers.onDateChange(selectedDate);
    renderCalendarView(cachedTasks);
  }
  function startOfDay3(input2) {
    const d = new Date(typeof input2 === "number" ? input2 : input2.getTime());
    d.setHours(0, 0, 0, 0);
    return d;
  }
  function startOfWeek(d) {
    const day = new Date(d);
    const dow = day.getDay();
    const diff = dow === 0 ? -6 : 1 - dow;
    day.setDate(day.getDate() + diff);
    return startOfDay3(day);
  }
  function addDays(d, n) {
    const next = new Date(d);
    next.setDate(next.getDate() + n);
    return startOfDay3(next);
  }
  function isSameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }
  function formatDayHeading(d) {
    return d.toLocaleDateString(void 0, { weekday: "long", month: "long", day: "numeric" });
  }
  function escapeHtml(s) {
    const el = document.createElement("div");
    el.textContent = s;
    return el.innerHTML;
  }
  function escapeAttr(s) {
    return s.replace(/"/g, "&quot;");
  }

  // src/analytics-engine/index.ts
  function computeAnalytics(tasks2) {
    const pending = tasks2.filter((t) => !t.completed);
    const completed = tasks2.filter((t) => t.completed);
    return {
      total: tasks2.length,
      pending: pending.length,
      completed: completed.length,
      completionRate: tasks2.length ? completed.length / tasks2.length : 0,
      byTag: completionRateByTag(tasks2),
      totalPendingMinutes: pending.reduce((s, t) => s + t.duration, 0),
      avgSkipCount: pending.length === 0 ? 0 : pending.reduce((s, t) => s + t.skippedCount, 0) / pending.length
    };
  }

  // src/app/dashboard.ts
  function buildDashboardState(tasks2, mode) {
    const ctx = {
      mode,
      now: Date.now(),
      availableMinutes: 240,
      completedToday: tasks2.filter(
        (t) => t.completed && t.updatedAt > startOfDay4(Date.now())
      ).length
    };
    return { tasks: tasks2, mode, plan: buildSchedule(tasks2, ctx), ctx };
  }
  function renderDashboard(state) {
    const { tasks: tasks2, mode, plan, ctx } = state;
    const analytics = computeAnalytics(tasks2);
    const forecast = forecastDay(tasks2, mode);
    const recs = getRecommendations(tasks2, mode);
    const behavioral = analyzeBehavior(tasks2, mode);
    renderBanner(recs, analytics);
    renderStats(analytics, plan);
    renderWorkloadBar(plan, ctx);
    renderSchedulePlan(plan);
    renderForecast(forecast);
    renderInsights(recs, behavioral);
  }
  function renderBanner(recs, analytics) {
    const banner = document.getElementById("snapshot-banner");
    if (!banner)
      return;
    banner.textContent = recs[0]?.headline ?? `${analytics.pending} pending / ~${analytics.totalPendingMinutes} min planned`;
  }
  function renderStats(analytics, plan) {
    const el = document.getElementById("stats-grid");
    if (!el)
      return;
    const completionPct = Math.round(analytics.completionRate * 100);
    el.innerHTML = [
      statCard(String(analytics.pending), "Pending"),
      statCard(String(analytics.completed), "Done"),
      statCard(`${plan.workloadMinutes}m`, "Planned"),
      statCard(`${completionPct}%`, "Complete")
    ].join("");
  }
  function renderWorkloadBar(plan, ctx) {
    const bar = document.getElementById("workload-bar");
    const label = document.getElementById("workload-label");
    if (!bar || !label)
      return;
    const pct = Math.min(100, Math.round(plan.workloadMinutes / ctx.availableMinutes * 100));
    document.body.setAttribute("data-workload", pct >= 100 ? "overload" : pct >= 70 ? "steady" : "open");
    const fill = bar.querySelector(".workload-fill");
    if (fill) {
      fill.style.width = `${pct}%`;
      fill.classList.toggle("overload", pct >= 100);
    }
    label.textContent = `${plan.workloadMinutes} / ${ctx.availableMinutes} min capacity`;
  }
  function renderSchedulePlan(plan) {
    const list2 = document.getElementById("schedule-list");
    const explain = document.getElementById("schedule-explain");
    if (!list2)
      return;
    if (plan.ordered.length === 0) {
      list2.innerHTML = '<li class="schedule-empty">Add tasks to generate a plan</li>';
    } else {
      list2.innerHTML = plan.ordered.slice(0, 6).map((s, i) => {
        const scoreW = Math.min(100, Math.max(8, Math.round(s.score)));
        const reasons = s.reasons.length ? s.reasons.join(", ") : "scheduled";
        return `<li class="schedule-item" data-task-id="${escapeAttr2(s.task.id)}">
          <span class="schedule-rank">#${i + 1}</span>
          <div class="schedule-item-body">
            <span class="schedule-item-text">${escapeHtml2(s.task.text)}</span>
            <span class="schedule-item-meta">${s.task.duration}m / ${s.task.effort} / ${escapeHtml2(reasons)}</span>
            <div class="score-bar" style="--score:${scoreW}%"><span></span></div>
          </div>
        </li>`;
      }).join("");
    }
    if (explain)
      explain.textContent = explainSchedule(plan);
  }
  function renderForecast(forecast) {
    const el = document.getElementById("forecast-panel");
    if (!el)
      return;
    const riskClass = forecast.riskOfOverload ? "forecast-warn" : "forecast-ok";
    const riskText = forecast.riskOfOverload ? "Overload risk" : "Capacity OK";
    const focus = forecast.focusTask ? escapeHtml2(forecast.focusTask) : "-";
    el.innerHTML = [
      `<div class="forecast-item"><strong>${forecast.likelyCompleted}</strong> tasks likely today</div>`,
      `<div class="forecast-item">Focus: <strong>${focus}</strong></div>`,
      `<div class="forecast-item"><span class="${riskClass}">${riskText}</span></div>`
    ].join("");
  }
  function renderInsights(recs, behavioral) {
    const el = document.getElementById("insight-panel");
    if (!el)
      return;
    const items = [];
    for (const r of recs.slice(0, 2)) {
      items.push(
        `<p class="insight-line insight-rec"><span class="insight-icon">*</span>${escapeHtml2(r.headline)}</p>`
      );
    }
    for (const b of behavioral.slice(0, 3)) {
      const cls = b.type === "procrastination" ? "insight-warn" : b.type === "recommendation" ? "insight-rec" : "insight-info";
      items.push(
        `<p class="insight-line ${cls}"><span class="insight-icon">${iconFor(b.type)}</span>${escapeHtml2(b.message)}</p>`
      );
    }
    el.innerHTML = items.join("") || '<p class="insight-line insight-info">Add tasks to get adaptive scheduling guidance.</p>';
  }
  function iconFor(type) {
    switch (type) {
      case "procrastination":
        return "!";
      case "window":
        return "~";
      case "completion":
        return "+";
      default:
        return ">";
    }
  }
  function statCard(value, label) {
    return `<div class="stat-card"><span class="stat-value">${value}</span><span class="stat-label">${label}</span></div>`;
  }
  function startOfDay4(ts) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  function escapeHtml2(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }
  function escapeAttr2(s) {
    return s.replace(/"/g, "&quot;");
  }

  // src/app/modes.ts
  var MODE_KEY = "circuit_mode";
  var MODE_NAMES = {
    normal: "Normal",
    deep: "Deep Work",
    low: "Low Energy",
    social: "Social Recovery"
  };
  var currentMode = "normal";
  var onModeChange = null;
  function getMode() {
    return currentMode;
  }
  function setMode(mode, notify = true) {
    currentMode = mode;
    localStorage.setItem(MODE_KEY, mode);
    document.querySelectorAll(".mode-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.mode === mode);
    });
    document.body.setAttribute("data-mode", mode);
    const pill = document.getElementById("mode-display");
    if (pill)
      pill.textContent = MODE_NAMES[mode] ?? mode;
    if (notify)
      onModeChange?.();
  }
  function initModes(onChange) {
    onModeChange = onChange;
    const saved = localStorage.getItem(MODE_KEY) || "normal";
    document.querySelectorAll(".mode-btn").forEach((btn) => {
      btn.addEventListener("click", () => setMode(btn.dataset.mode));
    });
    const pill = document.getElementById("mode-display");
    if (pill) {
      pill.addEventListener("click", () => {
        document.getElementById("mode-selector")?.classList.toggle("visible");
      });
    }
    setMode(saved, false);
  }

  // src/app/navigation.ts
  var PAGE_HASH = {
    home: "",
    add: "add",
    tasks: "tasks",
    calendar: "calendar"
  };
  var HASH_PAGE = {
    "": "home",
    home: "home",
    add: "add",
    tasks: "tasks",
    calendar: "calendar"
  };
  var currentPage = "home";
  var onPageChange = null;
  function getCurrentPage() {
    return currentPage;
  }
  function showPage(page, updateHash = true) {
    currentPage = page;
    document.querySelectorAll(".page").forEach((el) => {
      const active = el.dataset.page === page;
      el.hidden = !active;
      el.classList.toggle("page-active", active);
    });
    document.querySelectorAll("[data-nav]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.nav === page);
      btn.setAttribute("aria-current", btn.dataset.nav === page ? "page" : "false");
    });
    if (updateHash) {
      const hash2 = PAGE_HASH[page];
      const next = hash2 ? `#${hash2}` : window.location.pathname + window.location.search;
      if (hash2)
        history.replaceState(null, "", `#${hash2}`);
      else
        history.replaceState(null, "", next);
    }
    onPageChange?.(page);
  }
  function initNavigation(onChange) {
    onPageChange = onChange ?? null;
    document.querySelectorAll("[data-nav]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const page = btn.dataset.nav;
        if (page)
          showPage(page);
      });
    });
    window.addEventListener("hashchange", syncFromHash);
    syncFromHash();
  }
  function syncFromHash() {
    const key = window.location.hash.replace(/^#/, "").toLowerCase();
    const page = HASH_PAGE[key] ?? "home";
    showPage(page, false);
  }

  // src/app/import.ts
  function parseAndClassifyTasks(text) {
    const lines = text.split(/\r?\n/);
    const results = [];
    for (let line of lines) {
      line = line.trim();
      if (!line || line.length < 3)
        continue;
      line = line.replace(/^[-*•◦▪▫]\s*/, "");
      line = line.replace(/^\d+[.)\s]+/, "");
      line = line.replace(/^\[[ x]\]\s*/i, "");
      if (line.length < 3)
        continue;
      results.push({
        text: line,
        tag: inferTagFromText(line),
        effort: inferEffortFromText(line)
      });
    }
    return results;
  }
  function tasksFromImport(text) {
    return parseAndClassifyTasks(text).map(
      (row) => createTask(row.text, { tag: row.tag, effort: row.effort })
    );
  }

  // src/app/dimensions.ts
  var DIMENSION_SECTIONS = [
    {
      title: "Basics",
      fields: [
        {
          key: "tinyStep",
          label: "Tiny step",
          kind: "text",
          placeholder: "Open the file and do one edit"
        }
      ]
    },
    {
      title: "Time",
      fields: [
        { key: "duration", label: "Duration (min)", kind: "number", min: 5, max: 480, step: 5 },
        {
          key: "deadlineType",
          label: "Deadline",
          kind: "select",
          options: [
            { value: "none", label: "None" },
            { value: "soft", label: "Soft" },
            { value: "hard", label: "Hard" }
          ]
        },
        { key: "timeSensitivity", label: "Time sensitivity", kind: "range01" },
        { key: "scheduledAt", label: "Scheduled", kind: "datetime" },
        {
          key: "recurrence",
          label: "Recurrence",
          kind: "select",
          options: [
            { value: "", label: "None" },
            { value: "daily", label: "Daily" },
            { value: "weekly", label: "Weekly" },
            { value: "monthly", label: "Monthly" },
            { value: "weekdays", label: "Weekdays" }
          ]
        }
      ]
    },
    {
      title: "Cognitive / energy",
      fields: [
        {
          key: "effort",
          label: "Effort",
          kind: "select",
          options: [
            { value: "low", label: "Low" },
            { value: "medium", label: "Medium" },
            { value: "high", label: "High" }
          ]
        },
        {
          key: "focusType",
          label: "Focus",
          kind: "select",
          options: [
            { value: "deep", label: "Deep" },
            { value: "shallow", label: "Shallow" },
            { value: "admin", label: "Admin" },
            { value: "creative", label: "Creative" }
          ]
        },
        { key: "cognitiveLoad", label: "Cognitive load", kind: "range01" },
        { key: "emotionalResistance", label: "Emotional resistance", kind: "range01" },
        { key: "activationEnergy", label: "Activation energy", kind: "range01" },
        { key: "recoveryCost", label: "Recovery cost", kind: "range01" }
      ]
    },
    {
      title: "Context",
      fields: [
        {
          key: "locationDependency",
          label: "Location",
          kind: "text",
          placeholder: "home, office, out"
        },
        {
          key: "requiredResources",
          label: "Resources",
          kind: "list",
          placeholder: "laptop, keys (comma-separated)"
        },
        {
          key: "dependencies",
          label: "Dependencies",
          kind: "list",
          placeholder: "other task ids (comma-separated)"
        }
      ]
    },
    {
      title: "Priority / value",
      fields: [
        { key: "importance", label: "Importance", kind: "range01" },
        { key: "urgency", label: "Urgency", kind: "range01" },
        { key: "consequenceOfDelay", label: "Consequence of delay", kind: "range01" },
        { key: "momentumValue", label: "Momentum", kind: "range01" },
        { key: "compoundBenefit", label: "Compound benefit", kind: "range01" },
        { key: "identityAlignment", label: "Identity alignment", kind: "range01" }
      ]
    },
    {
      title: "Behavioral",
      fields: [
        { key: "historicalCompletionRate", label: "Completion rate", kind: "range01" },
        {
          key: "preferredExecutionWindow",
          label: "Best window",
          kind: "text",
          placeholder: "morning, afternoon, evening"
        },
        {
          key: "delayPattern",
          label: "Delay pattern",
          kind: "text",
          placeholder: "weekends, after 8pm"
        },
        { key: "taskDecompositionPotential", label: "Split potential", kind: "range01" },
        { key: "energyToRewardRatio", label: "Energy / reward", kind: "range01" }
      ]
    }
  ];
  function fieldId(prefix, key) {
    return `${prefix}-${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`;
  }
  function renderDimensionSections(prefix, task) {
    return DIMENSION_SECTIONS.map((section) => {
      const fields = section.fields.map((field) => {
        const id = fieldId(prefix, field.key);
        const value = task[field.key];
        let control = "";
        if (field.kind === "number") {
          control = `<input id="${id}" type="number" min="${field.min}" max="${field.max}" step="${field.step ?? 1}" value="${value ?? ""}" />`;
        } else if (field.kind === "range01") {
          const pct = Math.round((Number(value) || 0) * 100);
          control = `<input id="${id}" type="range" min="0" max="100" step="5" value="${pct}" data-scale="0.01" /><span class="range-value" data-for="${id}">${pct}%</span>`;
        } else if (field.kind === "select") {
          control = `<select id="${id}">${field.options.map(
            (opt) => `<option value="${escapeAttr3(opt.value)}"${String(value ?? "") === opt.value ? " selected" : ""}>${opt.label}</option>`
          ).join("")}</select>`;
        } else if (field.kind === "text") {
          control = `<input id="${id}" type="text" placeholder="${escapeAttr3(field.placeholder ?? "")}" value="${escapeAttr3(String(value ?? ""))}" />`;
        } else if (field.kind === "list") {
          const list2 = Array.isArray(value) ? value.join(", ") : "";
          control = `<input id="${id}" type="text" placeholder="${escapeAttr3(field.placeholder ?? "")}" value="${escapeAttr3(list2)}" />`;
        } else if (field.kind === "datetime") {
          const ts = typeof value === "number" ? value : null;
          control = `<input id="${id}" type="datetime-local" value="${ts ? toLocalInputValue(ts) : ""}" />`;
        }
        return `<label class="detail-row dimension-row"><span>${field.label}</span><span class="dimension-control">${control}</span></label>`;
      }).join("");
      return `<div class="dimension-section"><h3 class="dimension-section-title">${section.title}</h3>${fields}</div>`;
    }).join("");
  }
  function bindRangeLabels(root) {
    root.querySelectorAll('input[type="range"][data-scale]').forEach((input2) => {
      const label = root.querySelector(`[data-for="${input2.id}"]`);
      const sync = () => {
        if (label)
          label.textContent = `${input2.value}%`;
      };
      input2.addEventListener("input", sync);
      sync();
    });
  }
  function applyOverridesToForm(prefix, overrides) {
    for (const section of DIMENSION_SECTIONS) {
      for (const field of section.fields) {
        if (!(field.key in overrides))
          continue;
        const el = document.getElementById(fieldId(prefix, field.key));
        if (!el)
          continue;
        const value = overrides[field.key];
        if (field.kind === "range01") {
          el.value = String(Math.round((Number(value) || 0) * 100));
        } else if (field.kind === "list") {
          el.value = Array.isArray(value) ? value.join(", ") : "";
        } else if (field.kind === "datetime") {
          el.value = typeof value === "number" ? toLocalInputValue(value) : "";
        } else {
          el.value = String(value ?? "");
        }
      }
    }
    bindRangeLabels(document.getElementById("add-dimensions-root") ?? document);
  }
  function readDimensionOverrides(prefix, base) {
    const overrides = {};
    for (const section of DIMENSION_SECTIONS) {
      for (const field of section.fields) {
        const el = document.getElementById(fieldId(prefix, field.key));
        if (!el)
          continue;
        if (field.kind === "number") {
          const n = Number(el.value);
          overrides[field.key] = Number.isFinite(n) ? n : base[field.key];
        } else if (field.kind === "range01") {
          overrides[field.key] = clamp012(Number(el.value) / 100);
        } else if (field.kind === "select") {
          const raw = el.value;
          if (field.key === "recurrence") {
            overrides[field.key] = raw || null;
          } else {
            overrides[field.key] = raw;
          }
        } else if (field.kind === "text") {
          const raw = el.value.trim();
          overrides[field.key] = raw || null;
        } else if (field.kind === "list") {
          overrides[field.key] = parseList(el.value);
        } else if (field.kind === "datetime") {
          overrides[field.key] = el.value ? new Date(el.value).getTime() : null;
        }
      }
    }
    const effort = overrides.effort ?? base.effort;
    if (overrides.effort && !("duration" in overrides)) {
      overrides.duration = effort === "low" ? 15 : effort === "high" ? 60 : 30;
    }
    return overrides;
  }
  function mergeTaskDimensions(base, overrides) {
    const merged = { ...base, ...overrides, updatedAt: Date.now() };
    merged.duration = clamp(merged.duration, 5, 480);
    for (const key of [
      "cognitiveLoad",
      "emotionalResistance",
      "activationEnergy",
      "recoveryCost",
      "importance",
      "urgency",
      "consequenceOfDelay",
      "momentumValue",
      "compoundBenefit",
      "identityAlignment",
      "historicalCompletionRate",
      "taskDecompositionPotential",
      "energyToRewardRatio",
      "timeSensitivity"
    ]) {
      merged[key] = clamp012(merged[key]);
    }
    return merged;
  }
  function parseList(raw) {
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
  }
  function clamp012(n) {
    return Math.min(1, Math.max(0, n));
  }
  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }
  function toLocalInputValue(ts) {
    const d = new Date(ts);
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 6e4);
    return local.toISOString().slice(0, 16);
  }
  function escapeAttr3(s) {
    return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }

  // src/app/render.ts
  function renderTaskList(list2, tasks2, ctx, viewMode2) {
    list2.innerHTML = "";
    if (tasks2.length === 0)
      return;
    if (viewMode2 === "grouped") {
      const groups = groupTasksByTag(tasks2);
      for (const [tag, groupTasks] of Object.entries(groups)) {
        const header = document.createElement("li");
        header.className = "group-header";
        header.textContent = tag.charAt(0).toUpperCase() + tag.slice(1);
        list2.appendChild(header);
        for (const task of groupTasks)
          list2.appendChild(buildTaskItem(task, ctx));
      }
      return;
    }
    for (const task of tasks2)
      list2.appendChild(buildTaskItem(task, ctx));
  }
  function renderTaskDetailRows(task, scored) {
    const rows = renderDimensionSections("detail", task);
    const extras = [];
    if (task.skippedCount > 0) {
      extras.push(
        `<label class="detail-row"><span>Skipped</span><span>${task.skippedCount}</span></label>`
      );
    }
    if (scored) {
      extras.push(
        `<label class="detail-row"><span>Schedule score</span><span>${Math.round(scored.score)}</span></label>`
      );
      if (scored.reasons.length) {
        extras.push(
          `<label class="detail-row"><span>Why now</span><span>${scored.reasons.join(", ")}</span></label>`
        );
      }
    }
    return rows + extras.join("");
  }
  function bindTaskDetailForm(root) {
    bindRangeLabels(root);
  }
  function buildTaskItem(task, ctx) {
    const li = document.createElement("li");
    li.className = "task-item" + (task.completed ? " completed" : "");
    const rank = ctx.scheduleOrder.get(task.id);
    if (rank === 0 && !task.completed)
      li.classList.add("task-priority");
    if (task.skippedCount > 0 && !task.completed)
      li.classList.add("task-skipped");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = task.completed;
    checkbox.setAttribute("aria-label", "Mark task complete");
    checkbox.addEventListener("change", () => ctx.onToggle(task.id));
    const content = document.createElement("div");
    content.className = "task-content";
    const topRow = document.createElement("div");
    topRow.className = "task-top-row";
    if (rank !== void 0 && !task.completed) {
      const rankBadge = document.createElement("span");
      rankBadge.className = "rank-badge";
      rankBadge.textContent = "#" + (rank + 1);
      topRow.appendChild(rankBadge);
    }
    const text = document.createElement("span");
    text.className = "task-text";
    text.textContent = task.text;
    topRow.appendChild(text);
    content.appendChild(topRow);
    if (task.tinyStep) {
      const step = document.createElement("div");
      step.className = "tiny-step";
      step.textContent = "Next: " + task.tinyStep;
      content.appendChild(step);
    }
    const scored = ctx.scoreMap.get(task.id);
    if (scored && !task.completed) {
      const hint = document.createElement("div");
      hint.className = "schedule-hint";
      hint.textContent = scored.reasons.length ? scored.reasons.join(" / ") : "score " + Math.round(scored.score);
      content.appendChild(hint);
      content.appendChild(makeScoreBar(scored.score));
    }
    const chips = document.createElement("div");
    chips.className = "task-chips";
    appendChip(chips, task.tag);
    appendChip(chips, task.duration + "m");
    appendChip(chips, task.effort);
    appendChip(chips, task.focusType);
    if (task.preferredExecutionWindow)
      appendChip(chips, task.preferredExecutionWindow);
    if (task.recurrence)
      appendChip(chips, task.recurrence, "chip-recurring");
    if (task.skippedCount > 0)
      appendChip(chips, "skipped x" + task.skippedCount, "chip-warn");
    if (task.scheduledAt && !task.completed)
      appendChip(chips, formatScheduled(task.scheduledAt), "chip-scheduled");
    content.appendChild(chips);
    if (!task.completed)
      content.appendChild(makeLoadBar(task.cognitiveLoad));
    const actions = document.createElement("div");
    actions.className = "task-actions";
    if (!task.completed) {
      actions.appendChild(actionBtn("i", "View details", () => ctx.onDetails(task.id)));
      actions.appendChild(actionBtn("+", "Set tiny step", () => ctx.onTinyStep(task.id)));
      if (task.effort === "high" || task.taskDecompositionPotential >= 0.5) {
        actions.appendChild(actionBtn("/", "Split task", () => ctx.onSplit(task.id)));
      }
      actions.appendChild(actionBtn("~", "Skip", () => ctx.onSkip(task.id)));
    }
    actions.appendChild(actionBtn("x", "Delete task", () => ctx.onDelete(task.id), true));
    li.appendChild(checkbox);
    li.appendChild(content);
    li.appendChild(actions);
    return li;
  }
  function makeScoreBar(score) {
    const bar = document.createElement("div");
    bar.className = "score-bar task-score-bar";
    bar.style.setProperty("--score", Math.min(100, Math.max(5, Math.round(score))) + "%");
    bar.appendChild(document.createElement("span"));
    return bar;
  }
  function makeLoadBar(load2) {
    const row = document.createElement("div");
    row.className = "load-row";
    const label = document.createElement("span");
    label.className = "load-label";
    label.textContent = "load";
    const bar = document.createElement("div");
    bar.className = "load-bar";
    bar.style.setProperty("--load", Math.round(load2 * 100) + "%");
    bar.appendChild(document.createElement("span"));
    row.appendChild(label);
    row.appendChild(bar);
    return row;
  }
  function appendChip(parent, text, extra = "") {
    const el = document.createElement("span");
    el.className = "task-chip" + (extra ? " " + extra : "");
    el.textContent = text;
    parent.appendChild(el);
  }
  function actionBtn(label, title, onClick, del = false) {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.title = title;
    btn.setAttribute("aria-label", title);
    if (del)
      btn.classList.add("danger-action");
    btn.addEventListener("click", onClick);
    return btn;
  }
  function formatScheduled(ts) {
    const diff = ts - Date.now();
    if (diff < 0)
      return "due now";
    const mins = Math.round(diff / 6e4);
    if (mins < 60)
      return "in " + mins + "m";
    return "in " + Math.round(mins / 60) + "h";
  }

  // src/app/task-presets.ts
  var TASK_PRESETS = {
    chores: {
      id: "chores",
      label: "Chores",
      hint: "Low-friction home upkeep",
      placeholder: "Take out recycling",
      defaults: {
        tag: "general",
        effort: "low",
        duration: 20,
        deadlineType: "soft",
        timeSensitivity: 0.35,
        recurrence: "weekly",
        focusType: "shallow",
        cognitiveLoad: 0.22,
        emotionalResistance: 0.2,
        activationEnergy: 0.25,
        recoveryCost: 0.12,
        importance: 0.35,
        urgency: 0.3,
        consequenceOfDelay: 0.2,
        momentumValue: 0.45,
        compoundBenefit: 0.35,
        identityAlignment: 0.55,
        historicalCompletionRate: 0.65,
        preferredExecutionWindow: "afternoon",
        taskDecompositionPotential: 0.25,
        energyToRewardRatio: 0.75,
        locationDependency: "home"
      }
    },
    work: {
      id: "work",
      label: "Work",
      hint: "Focused professional work",
      placeholder: "Draft project update",
      defaults: {
        tag: "work",
        effort: "medium",
        duration: 45,
        deadlineType: "soft",
        timeSensitivity: 0.7,
        focusType: "deep",
        cognitiveLoad: 0.65,
        emotionalResistance: 0.4,
        activationEnergy: 0.6,
        recoveryCost: 0.35,
        importance: 0.8,
        urgency: 0.55,
        consequenceOfDelay: 0.65,
        momentumValue: 0.5,
        compoundBenefit: 0.6,
        identityAlignment: 0.7,
        historicalCompletionRate: 0.55,
        preferredExecutionWindow: "morning",
        taskDecompositionPotential: 0.55,
        energyToRewardRatio: 0.45
      }
    },
    social: {
      id: "social",
      label: "Social",
      hint: "Connection and outreach",
      placeholder: "Text Alex to plan dinner",
      defaults: {
        tag: "social",
        effort: "low",
        duration: 30,
        deadlineType: "soft",
        timeSensitivity: 0.45,
        focusType: "shallow",
        cognitiveLoad: 0.3,
        emotionalResistance: 0.45,
        activationEnergy: 0.35,
        recoveryCost: 0.2,
        importance: 0.55,
        urgency: 0.4,
        consequenceOfDelay: 0.25,
        momentumValue: 0.6,
        compoundBenefit: 0.4,
        identityAlignment: 0.75,
        historicalCompletionRate: 0.5,
        preferredExecutionWindow: "evening",
        taskDecompositionPotential: 0.2,
        energyToRewardRatio: 0.8
      }
    },
    adhoc: {
      id: "adhoc",
      label: "Ad hoc",
      hint: "Quick one-off errand",
      placeholder: "Pick up prescription",
      defaults: {
        tag: "general",
        effort: "low",
        duration: 15,
        deadlineType: "none",
        timeSensitivity: 0.5,
        focusType: "shallow",
        cognitiveLoad: 0.28,
        emotionalResistance: 0.25,
        activationEnergy: 0.3,
        recoveryCost: 0.15,
        importance: 0.4,
        urgency: 0.55,
        consequenceOfDelay: 0.35,
        momentumValue: 0.25,
        compoundBenefit: 0.2,
        identityAlignment: 0.35,
        historicalCompletionRate: 0.6,
        taskDecompositionPotential: 0.1,
        energyToRewardRatio: 0.7
      }
    },
    meetup: {
      id: "meetup",
      label: "Meetup",
      hint: "Time-bound social event",
      placeholder: "Coffee with Sam at 3pm",
      defaults: {
        tag: "social",
        effort: "low",
        duration: 60,
        deadlineType: "hard",
        timeSensitivity: 0.9,
        focusType: "shallow",
        cognitiveLoad: 0.25,
        emotionalResistance: 0.35,
        activationEnergy: 0.3,
        recoveryCost: 0.25,
        importance: 0.5,
        urgency: 0.75,
        consequenceOfDelay: 0.55,
        momentumValue: 0.4,
        compoundBenefit: 0.3,
        identityAlignment: 0.65,
        historicalCompletionRate: 0.7,
        preferredExecutionWindow: "afternoon",
        taskDecompositionPotential: 0.15,
        energyToRewardRatio: 0.65,
        locationDependency: "out"
      }
    }
  };
  var TASK_PRESET_IDS = Object.keys(TASK_PRESETS);

  // src/app/task-input.ts
  var activePreset = null;
  var onPresetTagChange = null;
  function initTaskInput(onTagChange) {
    onPresetTagChange = onTagChange ?? null;
    const presetRow = document.getElementById("preset-row");
    const dimensionsRoot = document.getElementById("add-dimensions-root");
    if (!presetRow || !dimensionsRoot)
      return;
    presetRow.innerHTML = TASK_PRESET_IDS.map((id) => {
      const preset = TASK_PRESETS[id];
      return `<button type="button" class="preset-btn" data-preset="${id}" title="${preset.hint}">${preset.label}</button>`;
    }).join("");
    const defaults = createTask("");
    dimensionsRoot.innerHTML = renderDimensionSections("add", defaults);
    bindRangeLabels(dimensionsRoot);
    presetRow.querySelectorAll(".preset-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.preset;
        applyPreset(id);
        presetRow.querySelectorAll(".preset-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
      });
    });
  }
  function applyPreset(id) {
    const preset = TASK_PRESETS[id];
    activePreset = id;
    const input2 = document.getElementById("task-input");
    if (input2 && !input2.value.trim()) {
      input2.placeholder = preset.placeholder;
    }
    const defaults = createTask("", preset.defaults);
    applyOverridesToForm("add", defaults);
    if (preset.defaults.tag)
      onPresetTagChange?.(preset.defaults.tag);
  }
  function buildTaskFromInput(text, tag) {
    const base = createTask(text, { tag });
    const overrides = readDimensionOverrides("add", base);
    return mergeTaskDimensions(base, { ...overrides, tag: overrides.tag ?? tag });
  }
  function resetTaskInput(tag) {
    const input2 = document.getElementById("task-input");
    if (input2) {
      input2.value = "";
      input2.placeholder = "Capture a task, deadline, or plan";
    }
    activePreset = null;
    document.querySelectorAll(".preset-btn").forEach((b) => b.classList.remove("active"));
    applyOverridesToForm("add", createTask("", { tag }));
    const tiny = document.getElementById(fieldId("add", "tinyStep"));
    if (tiny)
      tiny.value = "";
  }

  // src/app/auth.ts
  var USERS_KEY = "circuit_auth_users_v1";
  var SESSION_KEY = "circuit_session_v1";
  var LOCAL_USER = "__local__";
  function readUsers() {
    try {
      const raw = localStorage.getItem(USERS_KEY);
      if (!raw)
        return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  function writeUsers(users) {
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
  }
  function sanitizeUsername(username) {
    return username.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
  }
  function validateUsername(username) {
    const u = sanitizeUsername(username);
    if (u.length < 3)
      return "Username must be at least 3 characters.";
    if (u.length > 32)
      return "Username is too long.";
    return null;
  }
  function validatePasscode(passcode) {
    if (passcode.length < 4)
      return "Passcode must be at least 4 characters.";
    if (passcode.length > 64)
      return "Passcode is too long.";
    return null;
  }
  async function hashPasscode(passcode, salt) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      enc.encode(passcode),
      "PBKDF2",
      false,
      ["deriveBits"]
    );
    const bits = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength),
        iterations: 12e4,
        hash: "SHA-256"
      },
      keyMaterial,
      256
    );
    return btoa(String.fromCharCode(...new Uint8Array(bits)));
  }
  function randomSalt() {
    const salt = new Uint8Array(16);
    crypto.getRandomValues(salt);
    return salt;
  }
  function saltToB64(salt) {
    return btoa(String.fromCharCode(...salt));
  }
  function saltFromB64(salt) {
    const bin = atob(salt);
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  }
  function getSession() {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw)
      return null;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed?.username)
        return null;
      return parsed;
    } catch {
      return null;
    }
  }
  function storageNamespace(session) {
    if (!session || session.isLocal)
      return "";
    return `_${sanitizeUsername(session.username)}`;
  }
  function setSession(session) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }
  function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
  }
  async function registerAccount(username, passcode) {
    const userErr = validateUsername(username);
    if (userErr)
      throw new Error(userErr);
    const passErr = validatePasscode(passcode);
    if (passErr)
      throw new Error(passErr);
    const normalized = sanitizeUsername(username);
    const users = readUsers();
    if (users.some((u) => u.username === normalized)) {
      throw new Error("Username already exists.");
    }
    const salt = randomSalt();
    const passHash = await hashPasscode(passcode, salt);
    users.push({ username: normalized, salt: saltToB64(salt), passHash });
    writeUsers(users);
    setSession({ username: normalized, isLocal: false });
  }
  async function loginAccount(username, passcode) {
    const userErr = validateUsername(username);
    if (userErr)
      throw new Error(userErr);
    const passErr = validatePasscode(passcode);
    if (passErr)
      throw new Error(passErr);
    const normalized = sanitizeUsername(username);
    const user = readUsers().find((u) => u.username === normalized);
    if (!user)
      throw new Error("Account not found.");
    const hash2 = await hashPasscode(passcode, saltFromB64(user.salt));
    if (hash2 !== user.passHash)
      throw new Error("Incorrect passcode.");
    setSession({ username: normalized, isLocal: false });
  }
  function continueLocally() {
    setSession({ username: LOCAL_USER, isLocal: true });
  }
  function logout() {
    clearSession();
  }
  function initAuthUI(onReady) {
    const overlay = document.getElementById("auth-overlay");
    const usernameInput = document.getElementById("auth-username");
    const passcodeInput = document.getElementById("auth-passcode");
    const errorEl = document.getElementById("auth-error");
    const signInBtn = document.getElementById("auth-sign-in");
    const registerBtn = document.getElementById("auth-register");
    const localBtn = document.getElementById("auth-continue-local");
    const accountBtn = document.getElementById("account-btn");
    const accountLabel = document.getElementById("account-label");
    const signOutBtn = document.getElementById("auth-sign-out");
    const showError = (msg) => {
      if (errorEl) {
        errorEl.textContent = msg;
        errorEl.hidden = !msg;
      }
    };
    const hideOverlay = () => {
      overlay?.setAttribute("hidden", "");
    };
    const showOverlay = () => {
      overlay?.removeAttribute("hidden");
      usernameInput?.focus();
    };
    const updateAccountChip = (session) => {
      if (accountLabel) {
        accountLabel.textContent = session.isLocal ? "Local" : session.username;
      }
      if (accountBtn) {
        accountBtn.title = session.isLocal ? "Using this device only \u2014 sign in to sync" : `Signed in as ${session.username}`;
      }
    };
    const finish = (session) => {
      hideOverlay();
      updateAccountChip(session);
      onReady(session);
    };
    const existing = getSession();
    if (existing) {
      hideOverlay();
      updateAccountChip(existing);
      onReady(existing);
      return;
    }
    showOverlay();
    signInBtn?.addEventListener("click", async () => {
      showError("");
      try {
        await loginAccount(usernameInput?.value ?? "", passcodeInput?.value ?? "");
        finish(getSession());
      } catch (e) {
        showError(e instanceof Error ? e.message : "Sign in failed.");
      }
    });
    registerBtn?.addEventListener("click", async () => {
      showError("");
      try {
        await registerAccount(usernameInput?.value ?? "", passcodeInput?.value ?? "");
        finish(getSession());
      } catch (e) {
        showError(e instanceof Error ? e.message : "Could not create account.");
      }
    });
    localBtn?.addEventListener("click", () => {
      showError("");
      continueLocally();
      finish(getSession());
    });
    signOutBtn?.addEventListener("click", () => {
      logout();
      window.location.reload();
    });
    accountBtn?.addEventListener("click", () => {
      const session = getSession();
      if (session?.isLocal)
        showOverlay();
    });
  }

  // src/app/sync-bundle.ts
  var BUNDLE_VERSION = 1;
  function buildSyncBundle(tasks2) {
    const session = getSession();
    return {
      version: BUNDLE_VERSION,
      username: session?.isLocal ? "local" : session?.username ?? "unknown",
      exportedAt: Date.now(),
      tasks: tasks2
    };
  }
  function parseSyncBundle(raw) {
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== BUNDLE_VERSION || !Array.isArray(parsed.tasks)) {
      throw new Error("Invalid Circuit backup file.");
    }
    return parsed;
  }
  function downloadSyncBundle(tasks2) {
    const bundle = buildSyncBundle(tasks2);
    const blob = new Blob([JSON.stringify(bundle, null, 2)], {
      type: "application/json;charset=utf-8"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const stamp = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    link.href = url;
    link.download = `circuit-backup-${stamp}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  // src/app/themes.ts
  var THEMES = ["aurora", "sunset", "ocean", "dusk", "forest"];
  var THEME_KEY = "circuit_theme";
  var THEME_META = {
    aurora: { name: "Aurora", accent: "#7dd3fc", accent2: "#c084fc", text: "#e0f2fe", textMuted: "#bae6fd" },
    sunset: { name: "Sunset", accent: "#fb923c", accent2: "#f472b6", text: "#fff1f2", textMuted: "#fecdd3" },
    ocean: { name: "Ocean", accent: "#34d399", accent2: "#38bdf8", text: "#ecfdf5", textMuted: "#a7f3d0" },
    dusk: { name: "Dusk", accent: "#fbbf24", accent2: "#a78bfa", text: "#fdf4ff", textMuted: "#e9d5ff" },
    forest: { name: "Forest", accent: "#86efac", accent2: "#d97706", text: "#f0fdf4", textMuted: "#bbf7d0" }
  };
  function applyTheme(theme, save = true) {
    THEMES.forEach((t) => document.body.classList.remove(`theme-${t}`));
    document.body.classList.add(`theme-${theme}`);
    document.body.setAttribute("data-theme", theme);
    const meta = THEME_META[theme];
    const root = document.documentElement;
    root.style.setProperty("--accent", meta.accent);
    root.style.setProperty("--accent2", meta.accent2);
    root.style.setProperty("--accent-gradient", `linear-gradient(90deg, ${meta.accent}, ${meta.accent2})`);
    root.style.setProperty("--text", meta.text);
    root.style.setProperty("--text-muted", meta.textMuted);
    if (save)
      localStorage.setItem(THEME_KEY, theme);
  }
  function initTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    const theme = saved && THEMES.includes(saved) ? saved : THEMES[0];
    applyTheme(theme, false);
  }

  // src/app/toast.ts
  function showToast(message, durationMs = 2800) {
    let el = document.getElementById("toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "toast";
      el.setAttribute("role", "status");
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add("visible");
    window.setTimeout(() => el.classList.remove("visible"), durationMs);
  }

  // src/calendar-sync/index.ts
  function syncFromCalendar(existing, events) {
    const seen = new Set(
      existing.map((task) => task.metadata.calendarEventId).filter((id) => typeof id === "string")
    );
    const additions = [];
    let skipped = 0;
    for (const event of events) {
      if (seen.has(event.id)) {
        skipped += 1;
        continue;
      }
      seen.add(event.id);
      additions.push(
        createTask(event.title, {
          tag: "work",
          effort: minutesBetween(event.start, event.end) > 45 ? "high" : "medium",
          duration: Math.max(5, minutesBetween(event.start, event.end)),
          deadlineType: "hard",
          scheduledAt: event.start,
          focusType: "admin",
          metadata: {
            calendarEventId: event.id,
            calendarStart: event.start,
            calendarEnd: event.end,
            calendarSource: "ics-import"
          }
        })
      );
    }
    return {
      tasks: [...existing, ...additions],
      imported: additions.length,
      skipped
    };
  }
  function parseIcs(text) {
    const unfolded = text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
    const blocks = unfolded.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) ?? [];
    return blocks.map(parseEvent).filter((event) => Boolean(event));
  }
  function tasksToIcs(tasks2) {
    const now = formatIcsDate(Date.now());
    const events = tasks2.filter((task) => !task.completed && task.scheduledAt).map((task) => {
      const start = task.scheduledAt;
      const end = start + task.duration * 6e4;
      return [
        "BEGIN:VEVENT",
        `UID:${escapeIcsText(task.id)}@circuit.local`,
        `DTSTAMP:${now}`,
        `DTSTART:${formatIcsDate(start)}`,
        `DTEND:${formatIcsDate(end)}`,
        `SUMMARY:${escapeIcsText(task.text)}`,
        task.recurrence ? `RRULE:${recurrenceToRRule(task.recurrence)}` : "",
        "END:VEVENT"
      ].filter(Boolean).join("\r\n");
    });
    return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Circuit//Canopy Local Sync//EN", ...events, "END:VCALENDAR"].join("\r\n");
  }
  function parseEvent(block) {
    const uid = getField(block, "UID") ?? `ics-${hash(block)}`;
    const title = getField(block, "SUMMARY") ?? "Calendar event";
    const startRaw = getField(block, "DTSTART");
    const endRaw = getField(block, "DTEND");
    const start = startRaw ? parseIcsDate(startRaw) : null;
    const end = endRaw ? parseIcsDate(endRaw) : null;
    if (!start)
      return null;
    return {
      id: uid,
      title: unescapeIcsText(title),
      start,
      end: end && end > start ? end : start + 30 * 6e4
    };
  }
  function getField(block, name) {
    const line = block.split(/\r?\n/).find((candidate) => candidate.startsWith(`${name}:`) || candidate.startsWith(`${name};`));
    if (!line)
      return null;
    return line.slice(line.indexOf(":") + 1).trim();
  }
  function parseIcsDate(value) {
    const match = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/);
    if (!match)
      return null;
    const [, y, mo, d, h = "0", mi = "0", s = "0"] = match;
    const local = !value.endsWith("Z");
    const parts = [Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)];
    return local ? new Date(...parts).getTime() : Date.UTC(...parts);
  }
  function formatIcsDate(ts) {
    return new Date(ts).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  }
  function recurrenceToRRule(recurrence) {
    switch (recurrence) {
      case "daily":
        return "FREQ=DAILY";
      case "weekly":
        return "FREQ=WEEKLY";
      case "monthly":
        return "FREQ=MONTHLY";
      case "weekdays":
        return "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR";
      default:
        return recurrence.toUpperCase().startsWith("FREQ=") ? recurrence.toUpperCase() : `FREQ=${recurrence.toUpperCase()}`;
    }
  }
  function minutesBetween(start, end) {
    return Math.max(5, Math.round((end - start) / 6e4));
  }
  function escapeIcsText(text) {
    return text.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\n/g, "\\n");
  }
  function unescapeIcsText(text) {
    return text.replace(/\\n/g, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
  }
  function hash(text) {
    let value = 0;
    for (let i = 0; i < text.length; i += 1)
      value = value * 31 + text.charCodeAt(i) >>> 0;
    return value.toString(36);
  }

  // src/rescheduling-engine/adaptive.ts
  function adaptiveReschedule(tasks2, mode, now = Date.now()) {
    return tasks2.map((task) => {
      if (task.completed)
        return task;
      const delayMs = Math.min(task.skippedCount, 5) * 30 * 60 * 1e3;
      let scheduledAt = now + delayMs;
      if (mode === "low" && task.effort !== "low") {
        scheduledAt = now + 2 * 60 * 60 * 1e3;
      }
      if (mode === "deep" && task.focusType !== "deep") {
        scheduledAt = now + 4 * 60 * 60 * 1e3;
      }
      return { ...task, scheduledAt, updatedAt: now };
    });
  }

  // src/rescheduling-engine/overload.ts
  var MAX_DAILY_MINUTES = 360;
  function reduceOverload(tasks2, now = Date.now()) {
    const pending = tasks2.filter((t) => !t.completed);
    let total = pending.reduce((s, t) => s + t.duration, 0);
    const deferred = [];
    if (total <= MAX_DAILY_MINUTES)
      return { tasks: tasks2, deferred };
    const sorted = [...pending].sort(
      (a, b) => a.importance + a.urgency - (b.importance + b.urgency)
    );
    const updated = tasks2.map((t) => ({ ...t }));
    for (const low of sorted) {
      if (total <= MAX_DAILY_MINUTES)
        break;
      const idx = updated.findIndex((t) => t.id === low.id);
      if (idx === -1)
        continue;
      const task = updated[idx];
      if (task.scheduledAt && task.scheduledAt > now)
        continue;
      updated[idx] = {
        ...task,
        scheduledAt: now + 24 * 60 * 60 * 1e3,
        tag: task.tag === "work" ? "later" : task.tag,
        updatedAt: now
      };
      deferred.push(task.text);
      total -= task.duration;
    }
    return { tasks: updated, deferred };
  }

  // src/rescheduling-engine/momentum.ts
  function preserveMomentum(tasks2) {
    const recent = tasks2.filter((t) => t.completed && t.updatedAt > Date.now() - 2 * 60 * 60 * 1e3).sort((a, b) => b.updatedAt - a.updatedAt);
    if (recent.length === 0)
      return tasks2;
    const lastTag = recent[0].tag;
    return tasks2.map((t) => {
      if (t.completed || t.tag !== lastTag)
        return t;
      return {
        ...t,
        momentumValue: Math.min(1, t.momentumValue + 0.15),
        updatedAt: Date.now()
      };
    });
  }

  // src/rescheduling-engine/skip.ts
  function skipTask(task, now = Date.now()) {
    return {
      ...task,
      skippedCount: task.skippedCount + 1,
      lastSkippedAt: now,
      scheduledAt: now + 60 * 60 * 1e3,
      updatedAt: now
    };
  }

  // src/rescheduling-engine/splitting.ts
  function splitTask(task) {
    if (task.taskDecompositionPotential < 0.5 || task.effort !== "high") {
      return { parent: task, child: null };
    }
    const half = Math.ceil(task.duration / 2);
    const child = createTask(`${task.text} (part 2)`, {
      tag: task.tag,
      effort: "medium",
      duration: task.duration - half,
      dependencies: [task.id],
      importance: task.importance * 0.8
    });
    const parent = {
      ...task,
      duration: half,
      tinyStep: task.tinyStep || `First ${half} min only`,
      updatedAt: Date.now()
    };
    return { parent, child };
  }

  // src/rescheduling-engine/index.ts
  function rescheduleAll(tasks2, mode) {
    const changes = [];
    let next = preserveMomentum(tasks2);
    next = adaptiveReschedule(next, mode);
    const { tasks: balanced, deferred } = reduceOverload(next);
    if (deferred.length)
      changes.push(`Deferred ${deferred.length} task(s) to reduce overload`);
    return { tasks: balanced, changes };
  }
  function handleSkip(tasks2, taskId) {
    const changes = [];
    const next = tasks2.map((t) => {
      if (t.id !== taskId)
        return t;
      const skipped = skipTask(t);
      changes.push(`Skipped "${t.text}" \u2014 rescheduled +1h`);
      return skipped;
    });
    return { tasks: next, changes };
  }
  function handleSplit(tasks2, taskId) {
    const changes = [];
    const idx = tasks2.findIndex((t) => t.id === taskId);
    if (idx === -1)
      return { tasks: tasks2, changes };
    const { parent, child } = splitTask(tasks2[idx]);
    const next = [...tasks2];
    next[idx] = parent;
    if (child) {
      next.push(child);
      changes.push(`Split "${parent.text}" into two parts`);
    }
    return { tasks: next, changes };
  }

  // src/main.ts
  var tasks = [];
  var currentFilter = "all";
  var selectedTag = "general";
  var viewMode = "list";
  var scheduleOrder = /* @__PURE__ */ new Map();
  var lastPlan = null;
  var form = document.getElementById("task-form");
  var input = document.getElementById("task-input");
  var list = document.getElementById("task-list");
  var filterButtons = document.querySelectorAll(".filters button");
  var tagButtons = document.querySelectorAll(".tag-btn");
  function refreshSchedule() {
    lastPlan = buildDashboardState(tasks, getMode());
    scheduleOrder = new Map(lastPlan.plan.ordered.map((s, i) => [s.task.id, i]));
  }
  function persist() {
    saveTasks(tasks);
    refreshSchedule();
    if (lastPlan)
      renderDashboard(lastPlan);
    renderTasks();
    renderCalendarView(tasks);
  }
  function load() {
    tasks = loadTasks();
    tasks = rescheduleAll(tasks, getMode()).tasks;
    saveTasks(tasks);
    refreshSchedule();
    if (lastPlan)
      renderDashboard(lastPlan);
    renderTasks();
  }
  function scoreMap() {
    if (!lastPlan)
      return /* @__PURE__ */ new Map();
    return new Map(lastPlan.plan.ordered.map((s) => [s.task.id, s]));
  }
  function addTaskFromInput(text) {
    const conversational = taskFromConversationalInput(text);
    const task = conversational ?? buildTaskFromInput(text, selectedTag);
    if (conversational) {
      task.tag = selectedTag;
    }
    tasks.push(task);
    showToast(conversational ? "Parsed task with smart defaults" : "Task added");
    resetTaskInput(selectedTag);
    persist();
  }
  function toggleTask(id) {
    tasks = tasks.map((t) => {
      if (t.id !== id)
        return t;
      if (t.completed)
        return { ...t, completed: false, updatedAt: Date.now() };
      return recordCompletion(t);
    });
    tasks = rescheduleAll(tasks, getMode()).tasks;
    persist();
  }
  function deleteTask(id) {
    tasks = tasks.filter((t) => t.id !== id);
    showToast("Task removed");
    persist();
  }
  function skipTaskById(id) {
    const { tasks: next, changes } = handleSkip(tasks, id);
    tasks = next;
    showToast(changes[0] ?? "Task rescheduled");
    persist();
  }
  function splitTaskById(id) {
    const { tasks: next, changes } = handleSplit(tasks, id);
    tasks = next;
    showToast(changes[0] ?? "Task split");
    persist();
  }
  function setFilter(filter) {
    currentFilter = filter;
    filterButtons.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.filter === filter);
    });
    renderTasks();
  }
  function setTag(tag) {
    selectedTag = tag;
    tagButtons.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tag === tag);
    });
  }
  function visibleTasks() {
    const filtered = filterTasks(tasks, currentFilter, getMode());
    return [...filtered].sort((a, b) => {
      const ao = scheduleOrder.get(a.id) ?? 999;
      const bo = scheduleOrder.get(b.id) ?? 999;
      return ao - bo;
    });
  }
  function openTinyStepModal(taskId) {
    const task = tasks.find((t) => t.id === taskId);
    if (!task)
      return;
    const overlay = document.getElementById("nts-overlay");
    const taskName = document.getElementById("nts-task-name");
    const ntsInput = document.getElementById("nts-input");
    if (!overlay || !taskName || !ntsInput)
      return;
    taskName.textContent = task.text;
    ntsInput.value = task.tinyStep;
    overlay.removeAttribute("hidden");
    ntsInput.focus();
    const saveBtn = document.getElementById("nts-save");
    const cancelBtn = document.getElementById("nts-cancel");
    const save = () => {
      task.tinyStep = ntsInput.value.trim();
      task.updatedAt = Date.now();
      persist();
      overlay.setAttribute("hidden", "");
    };
    const cancel = () => overlay.setAttribute("hidden", "");
    if (saveBtn)
      saveBtn.onclick = save;
    if (cancelBtn)
      cancelBtn.onclick = cancel;
    overlay.onclick = (e) => {
      if (e.target === overlay)
        cancel();
    };
  }
  function openDetailModal(taskId) {
    const task = tasks.find((t) => t.id === taskId);
    if (!task)
      return;
    const overlay = document.getElementById("detail-overlay");
    const title = document.getElementById("detail-title");
    const rows = document.getElementById("detail-rows");
    if (!overlay || !title || !rows)
      return;
    title.textContent = task.text;
    rows.innerHTML = renderTaskDetailRows(task, scoreMap().get(task.id));
    bindTaskDetailForm(rows);
    overlay.removeAttribute("hidden");
    bindDetailModal(task.id, overlay);
    const close = () => overlay.setAttribute("hidden", "");
    document.getElementById("detail-close")?.addEventListener("click", close, { once: true });
    overlay.onclick = (e) => {
      if (e.target === overlay)
        close();
    };
  }
  function bindDetailModal(taskId, overlay) {
    const saveBtn = document.getElementById("detail-save");
    const close = () => overlay.setAttribute("hidden", "");
    if (!saveBtn)
      return;
    saveBtn.onclick = () => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task)
        return;
      const overrides = readDimensionOverrides("detail", task);
      const merged = mergeTaskDimensions(task, overrides);
      Object.assign(task, merged);
      showToast("Task details updated");
      persist();
      close();
    };
  }
  function renderTasks() {
    const visible = visibleTasks();
    const emptyMsgs = {
      all: "No tasks yet. Add one above!",
      pending: "All caught up! No pending tasks.",
      completed: "Nothing completed yet.",
      today: "Nothing urgent for today.",
      scheduled: "No scheduled tasks."
    };
    if (visible.length === 0) {
      list.innerHTML = "";
      const empty = document.createElement("li");
      empty.className = "empty-state";
      empty.textContent = emptyMsgs[currentFilter] ?? "No tasks here.";
      list.appendChild(empty);
      return;
    }
    renderTaskList(list, visible, {
      scoreMap: scoreMap(),
      scheduleOrder,
      onToggle: toggleTask,
      onDelete: deleteTask,
      onSkip: skipTaskById,
      onSplit: splitTaskById,
      onTinyStep: openTinyStepModal,
      onDetails: openDetailModal
    }, viewMode);
  }
  document.getElementById("schedule-list")?.addEventListener("click", (e) => {
    const item = e.target.closest(".schedule-item");
    if (!item)
      return;
    const id = item.dataset.taskId;
    if (id)
      openDetailModal(id);
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text)
      return;
    addTaskFromInput(text);
    input.focus();
    showPage("tasks");
  });
  filterButtons.forEach((btn) => {
    btn.addEventListener("click", () => setFilter(btn.dataset.filter));
  });
  tagButtons.forEach((btn) => {
    btn.addEventListener("click", () => setTag(btn.dataset.tag));
  });
  document.getElementById("view-list")?.addEventListener("click", () => {
    viewMode = "list";
    document.getElementById("view-list")?.classList.add("active");
    document.getElementById("view-grouped")?.classList.remove("active");
    renderTasks();
  });
  document.getElementById("view-grouped")?.addEventListener("click", () => {
    viewMode = "grouped";
    document.getElementById("view-grouped")?.classList.add("active");
    document.getElementById("view-list")?.classList.remove("active");
    renderTasks();
  });
  var fileInput = document.getElementById("file-input");
  var importBtn = document.querySelector(".import-btn");
  var importStatus = document.getElementById("import-status");
  if (fileInput && importBtn) {
    importBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      if (!file)
        return;
      if (importStatus) {
        importStatus.textContent = "Processing...";
        importStatus.style.display = "block";
      }
      try {
        const text = await file.text();
        const imported = tasksFromImport(text);
        tasks.push(...imported);
        showToast(`Imported ${imported.length} tasks`);
        persist();
        if (importStatus) {
          importStatus.textContent = `\u2705 Imported ${imported.length} tasks`;
          setTimeout(() => {
            importStatus.style.display = "none";
          }, 3e3);
        }
      } catch {
        if (importStatus)
          importStatus.textContent = "\u274C Error processing file";
      }
      fileInput.value = "";
    });
  }
  var calendarInput = document.getElementById("calendar-file-input");
  var calendarImport = document.getElementById("calendar-import");
  var calendarExport = document.getElementById("calendar-export");
  var calendarStatus = document.getElementById("calendar-sync-status");
  calendarImport?.addEventListener("click", () => calendarInput?.click());
  calendarInput?.addEventListener("change", async () => {
    const file = calendarInput.files?.[0];
    if (!file)
      return;
    try {
      const events = parseIcs(await file.text());
      const result = syncFromCalendar(tasks, events);
      tasks = result.tasks;
      showToast(`Imported ${result.imported} calendar tasks`);
      if (calendarStatus) {
        calendarStatus.textContent = `${result.imported} imported, ${result.skipped} skipped`;
      }
      persist();
    } catch {
      if (calendarStatus)
        calendarStatus.textContent = "Calendar import failed";
      showToast("Calendar import failed");
    }
    calendarInput.value = "";
  });
  calendarExport?.addEventListener("click", () => {
    const ics = tasksToIcs(tasks);
    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "circuit-plan.ics";
    link.click();
    URL.revokeObjectURL(url);
    if (calendarStatus)
      calendarStatus.textContent = "Exported scheduled tasks";
    showToast("Calendar file exported");
  });
  var bundleInput = document.getElementById("bundle-file-input");
  var bundleExport = document.getElementById("bundle-export");
  var bundleImport = document.getElementById("bundle-import");
  bundleExport?.addEventListener("click", () => {
    downloadSyncBundle(tasks);
    showToast("Account backup downloaded");
  });
  bundleImport?.addEventListener("click", () => bundleInput?.click());
  bundleInput?.addEventListener("change", async () => {
    const file = bundleInput.files?.[0];
    if (!file)
      return;
    try {
      const bundle = parseSyncBundle(await file.text());
      tasks = bundle.tasks;
      persist();
      showToast(`Restored ${bundle.tasks.length} tasks from backup`);
    } catch {
      showToast("Invalid backup file");
    }
    bundleInput.value = "";
  });
  function bootstrapApp() {
    initTheme();
    initTaskInput(setTag);
    load();
    initNavigation((page) => {
      if (page === "add") {
        input?.focus();
      }
    });
    initCalendar({
      onTaskClick: openDetailModal,
      onDateChange: () => renderCalendarView(tasks)
    });
    initModes(() => {
      tasks = rescheduleAll(tasks, getMode()).tasks;
      persist();
    });
    if (getCurrentPage() === "add") {
      input?.focus();
    }
  }
  initAuthUI((session) => {
    setTaskStorageNamespace(storageNamespace(session));
    bootstrapApp();
  });
})();
