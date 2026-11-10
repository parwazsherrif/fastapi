const state = {
  students: [],
  page: 1,
  pageSize: 6,
  editingId: null,
};

const elements = {
  rows: document.querySelector("#student-rows"),
  search: document.querySelector("#search-input"),
  course: document.querySelector("#course-filter"),
  sort: document.querySelector("#sort-select"),
  dialog: document.querySelector("#student-dialog"),
  form: document.querySelector("#student-form"),
  error: document.querySelector("#form-error"),
  save: document.querySelector("#save-button"),
};

const gradeFor = (marks) => {
  if (marks >= 90) return "A+";
  if (marks >= 80) return "A";
  if (marks >= 70) return "B";
  if (marks >= 55) return "C";
  return "F";
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function initials(name) {
  return String(name || "?").trim().split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase();
}

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      ...options,
      headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
    });
  } catch {
    throw new Error("Couldn’t reach the API. Check that the FastAPI server is running.");
  }

  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    try {
      const body = await response.json();
      if (Array.isArray(body.detail)) {
        message = body.detail.map((issue) => {
          const field = issue.loc?.filter((part) => part !== "body").join(".");
          return field ? `${field}: ${issue.msg}` : issue.msg;
        }).join(" ");
      } else if (body.detail) {
        message = body.detail;
      }
    } catch {
      // Keep the HTTP status message when the response is not JSON.
    }
    throw new Error(message);
  }
  if (response.status === 204) return null;
  const contentType = response.headers.get("content-type") || "";
  return contentType.includes("application/json") ? response.json() : response.text();
}

function setConnection(online, message) {
  const status = document.querySelector("#connection-label");
  status.textContent = message;
  status.parentElement.classList.toggle("online", online);
  status.parentElement.classList.toggle("offline", !online);
}

async function loadStudents() {
  elements.rows.innerHTML = '<tr><td colspan="6"><div class="loading-state"><span class="loader"></span> Finding your students...</div></td></tr>';
  try {
    const firstPage = await request("/students?page=1&limit=99&sort_by=name&order=asc");
    const students = firstPage.students || [];
    for (let page = 2; students.length < firstPage.total_students; page += 1) {
      const nextPage = await request(`/students?page=${page}&limit=99&sort_by=name&order=asc`);
      if (!nextPage.students?.length) break;
      students.push(...nextPage.students);
    }
    state.students = students;
    setConnection(true, "Connected to your API");
    document.querySelector("#refresh-button").classList.remove("spinning");
    updateDashboard();
  } catch (error) {
    setConnection(false, "API connection unavailable");
    elements.rows.innerHTML = `<tr><td colspan="6"><div class="error-state">${escapeHtml(error.message)}<button type="button" data-action="retry">Try again</button></div></td></tr>`;
    document.querySelector("#stat-total").textContent = "—";
    document.querySelector("#nav-count").textContent = "—";
    document.querySelector("#roster-count").textContent = "—";
    document.querySelector("#pagination-summary").textContent = "Could not load student records";
  }
}

function updateDashboard() {
  const students = state.students;
  const count = students.length;
  const average = count ? students.reduce((sum, student) => sum + Number(student.marks || 0), 0) / count : 0;
  const courses = new Map();
  for (const student of students) {
    const course = (student.course || "Unassigned").trim() || "Unassigned";
    courses.set(course, (courses.get(course) || 0) + 1);
  }
  const highScores = students.filter((student) => Number(student.marks) >= 80).length;

  document.querySelector("#stat-total").textContent = count;
  document.querySelector("#nav-count").textContent = count;
  document.querySelector("#roster-count").textContent = count;
  document.querySelector("#stat-average").textContent = count ? Math.round(average) : "—";
  document.querySelector("#pulse-average").textContent = count ? Math.round(average) : "—";
  document.querySelector("#average-meter").style.width = `${count ? Math.min(average, 100) : 0}%`;
  document.querySelector("#stat-courses").textContent = courses.size;
  document.querySelector("#course-total").textContent = `${courses.size} ${courses.size === 1 ? "course" : "courses"}`;
  document.querySelector("#high-score-count").textContent = `${highScores} / ${count}`;
  document.querySelector("#high-score-percent").textContent = `${count ? Math.round((highScores / count) * 100) : 0}%`;
  document.querySelector("#high-score-meter").style.width = `${count ? (highScores / count) * 100 : 0}%`;

  const courseList = document.querySelector("#course-list");
  const courseEntries = [...courses.entries()].sort((a, b) => b[1] - a[1]);
  courseList.innerHTML = courseEntries.length
    ? courseEntries.slice(0, 4).map(([name, total]) => `
      <div class="course-item">
        <span class="course-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
        <span class="course-bar"><span style="width:${Math.max(8, (total / count) * 100)}%"></span></span>
        <span class="course-count">${total}</span>
      </div>`).join("")
    : '<div class="empty-inline">Course insights will show up when you have students.</div>';

  const courseSelect = elements.course;
  const selectedCourse = courseSelect.value;
  courseSelect.innerHTML = '<option value="">All courses</option>' + [...courses.keys()]
    .sort((a, b) => a.localeCompare(b))
    .map((course) => `<option value="${escapeHtml(course)}">${escapeHtml(course)}</option>`).join("");
  courseSelect.value = courses.has(selectedCourse) ? selectedCourse : "";
  renderStudents();
}

function visibleStudents() {
  const search = elements.search.value.trim().toLowerCase();
  const course = elements.course.value.toLowerCase();
  const [sortKey, sortOrder] = elements.sort.value.split("-");
  return state.students.filter((student) => {
    const searchable = [student.id, student.name, student.email, student.course].join(" ").toLowerCase();
    return (!search || searchable.includes(search)) && (!course || student.course.toLowerCase() === course);
  }).sort((a, b) => {
    let comparison;
    if (sortKey === "marks" || sortKey === "age") {
      comparison = Number(a[sortKey]) - Number(b[sortKey]);
    } else {
      comparison = String(a.name || "").localeCompare(String(b.name || ""));
    }
    return sortOrder === "desc" ? -comparison : comparison;
  });
}

function renderStudents() {
  const filtered = visibleStudents();
  const pages = Math.max(1, Math.ceil(filtered.length / state.pageSize));
  state.page = Math.min(state.page, pages);
  const start = (state.page - 1) * state.pageSize;
  const current = filtered.slice(start, start + state.pageSize);

  if (!current.length) {
    const hasFilters = elements.search.value || elements.course.value;
    elements.rows.innerHTML = `<tr><td colspan="6"><div class="empty-state"><strong>${hasFilters ? "No matches this time." : "Your roster starts here."}</strong><span>${hasFilters ? "Try a different search or clear your filters." : "Add a student to see your class come together."}</span>${hasFilters ? "" : '<button type="button" data-action="add">Add your first student</button>'}</div></td></tr>`;
  } else {
    elements.rows.innerHTML = current.map((student, index) => {
      const marks = Number(student.marks) || 0;
      const grade = student.grade || gradeFor(marks);
      const gradeClass = grade === "F" ? "grade-f" : ["A", "A+"].includes(grade) ? "grade-a" : "";
      const tone = (start + index) % 4;
      return `<tr>
        <td><div class="student-cell"><span class="student-avatar tone-${tone}">${escapeHtml(initials(student.name))}</span><div><div class="student-name">${escapeHtml(student.name)}</div><div class="student-email">${escapeHtml(student.email)}</div></div></div></td>
        <td><span class="course-chip" title="${escapeHtml(student.course)}">${escapeHtml(student.course)}</span></td>
        <td>${escapeHtml(student.age)}</td>
        <td><div class="mark-cell"><span class="mark-number">${escapeHtml(marks)}%</span><span class="mark-track"><span class="${marks >= 80 ? "high" : marks < 55 ? "low" : ""}" style="width:${Math.max(0, Math.min(marks, 100))}%"></span></span></div></td>
        <td><span class="grade-chip ${gradeClass}">${escapeHtml(grade)}</span></td>
        <td><div class="row-actions">
          <button type="button" class="row-action" data-action="edit" data-id="${escapeHtml(student.id)}" aria-label="Edit ${escapeHtml(student.name)}" title="Edit student"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5 5 5M4 20l4.3-.9L19 8.4a2.1 2.1 0 0 0-3-3L5.3 16.1 4 20z"/></svg></button>
          <button type="button" class="row-action delete" data-action="delete" data-id="${escapeHtml(student.id)}" aria-label="Delete ${escapeHtml(student.name)}" title="Delete student"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg></button>
        </div></td>
      </tr>`;
    }).join("");
  }

  const showing = filtered.length ? `${start + 1}–${Math.min(start + state.pageSize, filtered.length)} of ${filtered.length} students` : "0 students";
  document.querySelector("#pagination-summary").textContent = showing;
  document.querySelector("#page-indicator").textContent = `${state.page} / ${pages}`;
  document.querySelector("#previous-page").disabled = state.page <= 1;
  document.querySelector("#next-page").disabled = state.page >= pages;
}

function showToast(message, isError = false) {
  const toast = document.createElement("div");
  toast.className = `toast${isError ? " error" : ""}`;
  toast.textContent = message;
  document.querySelector("#toast-region").append(toast);
  window.setTimeout(() => {
    toast.classList.add("leaving");
    window.setTimeout(() => toast.remove(), 220);
  }, 3200);
}

function openForm(student = null) {
  state.editingId = student?.id ?? null;
  elements.form.reset();
  elements.error.textContent = "";
  const idInput = elements.form.elements.id;
  idInput.disabled = Boolean(student);
  idInput.required = !student;
  document.querySelector("#dialog-title").textContent = student ? "Edit student" : "Add a student";
  document.querySelector("#dialog-kicker").textContent = student ? "UPDATE RECORD" : "NEW RECORD";
  document.querySelector("#dialog-description").textContent = student ? "Make a change and keep the details up to date." : "A few details and you’re all set.";
  document.querySelector("#id-field").hidden = Boolean(student);
  const submitText = student ? "Save changes" : "Save student";
  elements.save.innerHTML = `${submitText} <span>↗</span>`;
  if (student) {
    for (const [key, value] of Object.entries(student)) {
      const input = elements.form.elements.namedItem(key);
      if (input) input.value = value ?? "";
    }
  }
  elements.dialog.showModal();
  (student ? elements.form.elements.name : elements.form.elements.id).focus();
}

function closeForm() {
  if (elements.dialog.open) elements.dialog.close();
}

async function submitForm(event) {
  event.preventDefault();
  if (!elements.form.reportValidity()) return;

  const formData = new FormData(elements.form);
  const fields = ["name", "age", "course", "marks", "email"];
  const payload = Object.fromEntries(fields
    .filter((key) => formData.get(key) !== "")
    .map((key) => [key, ["age", "marks"].includes(key) ? Number(formData.get(key)) : String(formData.get(key)).trim()]));
  const editingId = state.editingId;
  if (!editingId) payload.id = String(formData.get("id")).trim();
  elements.error.textContent = "";
  elements.save.disabled = true;
  elements.save.textContent = editingId ? "Saving..." : "Adding...";

  try {
    await request(editingId ? `/updatestudent/${encodeURIComponent(editingId)}` : "/create", {
      method: editingId ? "PUT" : "POST",
      body: JSON.stringify(payload),
    });
    closeForm();
    await loadStudents();
    showToast(editingId ? "Student details updated." : "Student added to your roster.");
  } catch (error) {
    elements.error.textContent = error.message;
  } finally {
    elements.save.disabled = false;
    elements.save.innerHTML = `${editingId ? "Save changes" : "Save student"} <span>↗</span>`;
  }
}

async function deleteStudent(id) {
  const student = state.students.find((record) => record.id === id);
  if (!student || !window.confirm(`Remove ${student.name} from your student records? This can’t be undone.`)) return;
  try {
    await request(`/delete/${encodeURIComponent(id)}`, { method: "DELETE" });
    await loadStudents();
    showToast("Student removed from your roster.");
  } catch (error) {
    showToast(error.message, true);
  }
}

function setDate() {
  document.querySelector("#today-label").textContent = new Intl.DateTimeFormat(undefined, {
    weekday: "short", month: "short", day: "numeric",
  }).format(new Date());
}

document.querySelector("#add-student-button").addEventListener("click", () => openForm());
document.querySelector("#close-dialog").addEventListener("click", closeForm);
document.querySelector("#cancel-dialog").addEventListener("click", closeForm);
elements.form.addEventListener("submit", submitForm);
elements.search.addEventListener("input", () => { state.page = 1; renderStudents(); });
elements.course.addEventListener("change", () => { state.page = 1; renderStudents(); });
elements.sort.addEventListener("change", () => { state.page = 1; renderStudents(); });
document.querySelector("#previous-page").addEventListener("click", () => { state.page -= 1; renderStudents(); });
document.querySelector("#next-page").addEventListener("click", () => { state.page += 1; renderStudents(); });
document.querySelector("#clear-filters").addEventListener("click", () => {
  elements.search.value = "";
  elements.course.value = "";
  elements.sort.value = "name-asc";
  state.page = 1;
  renderStudents();
});
document.querySelector("#refresh-button").addEventListener("click", (event) => {
  event.currentTarget.classList.add("spinning");
  loadStudents();
});
elements.rows.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  if (button.dataset.action === "retry") loadStudents();
  if (button.dataset.action === "add") openForm();
  if (button.dataset.action === "edit") {
    const student = state.students.find((record) => record.id === button.dataset.id);
    if (student) openForm(student);
  }
  if (button.dataset.action === "delete") deleteStudent(button.dataset.id);
});
elements.dialog.addEventListener("click", (event) => {
  if (event.target === elements.dialog) closeForm();
});
document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    elements.search.focus();
  }
});

setDate();
loadStudents();
