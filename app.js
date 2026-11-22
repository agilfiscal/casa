/* Casa de Yann — site estático com edição via API do GitHub.
 * Leitura: qualquer pessoa (lê data.json do repositório).
 * Edição: só quem tem um token com permissão de escrita no repositório. */
(() => {
  "use strict";

  const DATA_PATH = "data.json";
  const LS = { token: "cdy_token", repo: "cdy_repo" };
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const money = (n) => brl.format(n || 0);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
    del: (k) => { try { localStorage.removeItem(k); } catch {} },
  };

  let data = null;        // cópia de trabalho
  let savedJSON = "";     // última versão salva
  let sha = null;         // sha do data.json no GitHub (necessário para salvar)
  let token = store.get(LS.token);
  let repo = store.get(LS.repo) || detectRepo();
  let editing = false;

  /* ---------- Repositório ---------- */
  function detectRepo() {
    const h = location.hostname;
    const m = h.match(/^([^.]+)\.github\.io$/i);
    if (!m) return null;
    const first = location.pathname.split("/").filter(Boolean)[0];
    return first && !first.includes(".") ? `${m[1]}/${first}` : `${m[1]}/${h}`;
  }

  function gh(path, opts = {}) {
    const headers = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(opts.headers || {}) };
    if (opts.auth !== false && token) headers.Authorization = `Bearer ${token}`;
    return fetch(`https://api.github.com${path}`, { ...opts, headers, cache: "no-store" });
  }

  const b64decode = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, "")), (c) => c.charCodeAt(0)));
  const b64encode = (str) => {
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  };

  async function fetchFromApi(useAuth) {
    const r = await gh(`/repos/${repo}/contents/${DATA_PATH}`, { auth: useAuth });
    if (!r.ok) throw Object.assign(new Error(`GitHub respondeu ${r.status}`), { status: r.status });
    const j = await r.json();
    return { json: JSON.parse(b64decode(j.content)), sha: j.sha };
  }

  async function load() {
    // 1) Editor: API autenticada (dados mais recentes + sha)
    // 2) Visitante: API pública (sempre atualizada) → fallback para o arquivo publicado no Pages
    if (repo) {
      try {
        const res = await fetchFromApi(!!token);
        sha = res.sha;
        return res.json;
      } catch (e) {
        if (token && (e.status === 401 || e.status === 403 || e.status === 404)) {
          toast("Seu token não funcionou. Entre novamente.");
          logout(false);
        }
      }
    }
    const r = await fetch(`${DATA_PATH}?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) throw new Error("Não foi possível carregar os dados.");
    return r.json();
  }

  async function save() {
    const btn = $("#saveBtn");
    btn.disabled = true; $("#saveMsg").textContent = "Salvando…";
    try {
      data.updatedAt = new Date().toISOString();
      const content = JSON.stringify(data, null, 1) + "\n";
      const r = await gh(`/repos/${repo}/contents/${DATA_PATH}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: `Atualiza lista (${new Date().toLocaleString("pt-BR")})`, content: b64encode(content), sha }),
      });
      if (r.status === 409 || r.status === 422) {
        throw new Error("Os dados foram alterados em outro lugar. Recarregue a página antes de salvar.");
      }
      if (!r.ok) throw new Error(`Erro ao salvar (GitHub ${r.status}). Verifique o token.`);
      const j = await r.json();
      sha = j.content.sha;
      savedJSON = JSON.stringify(data);
      toast("Salvo! Visitantes verão a mudança em instantes.");
      renderUpdated();
    } catch (e) {
      data.updatedAt = JSON.parse(savedJSON).updatedAt;
      toast(e.message, 6000);
    } finally {
      btn.disabled = false;
      syncDirty();
    }
  }

  /* ---------- Cálculos ---------- */
  const totEst = (i) => (+i.qty || 0) * (+i.estUnit || 0);
  const hasReal = (i) => i.realUnit !== null && i.realUnit !== "" && i.realUnit !== undefined;
  const totReal = (i) => (hasReal(i) ? (+i.qty || 0) * (+i.realUnit || 0) : null);
  const categories = () => [...new Set(data.items.map((i) => i.category))];

  function totals(items = data.items) {
    let est = 0, real = 0, proj = 0, bought = 0;
    for (const i of items) {
      const e = totEst(i), r = totReal(i);
      est += e; real += r || 0; proj += r ?? e; if (i.bought) bought++;
    }
    return { est, real, proj, bought, count: items.length };
  }

  /* ---------- Render: Resumo ---------- */
  function renderSummary() {
    const t = totals(), b = +data.budget || 0;
    $("#kBudget").textContent = money(b);
    $("#budgetInput").value = b;
    $("#kEst").textContent = money(t.est);
    const s1 = b - t.est;
    $("#kEstSaldo").innerHTML = `Saldo frente à estimativa: <b class="${s1 >= 0 ? "pos" : "neg"}">${money(s1)}</b>`;
    $("#kReal").textContent = money(t.real);
    const s2 = b - t.real;
    $("#kRealSaldo").innerHTML = `Saldo do orçamento: <b class="${s2 >= 0 ? "pos" : "neg"}">${money(s2)}</b>`;
    $("#kBought").textContent = `${t.bought} de ${t.count}`;
    $("#kBoughtBar").style.width = `${t.count ? (t.bought / t.count) * 100 : 0}%`;

    const max = Math.max(b, t.proj) || 1;
    const pend = Math.max(t.proj - t.real, 0);
    const over = Math.max(t.proj - b, 0);
    $("#budgetStack").innerHTML =
      `<span class="real" style="width:${(Math.min(t.real, b) / max) * 100}%"></span>` +
      `<span class="pend" style="width:${(Math.max(Math.min(t.proj, b) - t.real, 0) / max) * 100}%"></span>` +
      `<span style="flex:1"></span>` +
      (over ? `<span class="over" style="width:${(over / max) * 100}%"></span>` : "");
    $("#projNote").textContent = `Projeção final (real + pendente): ${money(t.real + pend)}` + (over ? ` — ${money(over)} acima do orçamento` : "");

    $("#catBody").innerHTML = categories().map((c) => {
      const items = data.items.filter((i) => i.category === c), ct = totals(items), d = ct.est - ct.real;
      return `<tr><td>${esc(c)}</td><td class="num">${money(ct.est)}</td><td class="num">${money(ct.real)}</td>
        <td class="num ${d < 0 ? "neg" : ""}">${money(d)}</td>
        <td class="hide-sm"><div class="bar" title="${ct.bought} de ${ct.count} comprados"><span style="width:${(ct.bought / ct.count) * 100}%"></span></div></td></tr>`;
    }).join("");
    $("#catFoot").innerHTML = `<tr><td>Total</td><td class="num">${money(t.est)}</td><td class="num">${money(t.real)}</td><td class="num">${money(t.est - t.real)}</td><td class="hide-sm"></td></tr>`;
  }

  /* ---------- Render: Lista ---------- */
  function filtered() {
    const q = $("#q").value.trim().toLowerCase(), c = $("#fCat").value, st = $("#fStatus").value;
    return data.items.filter((i) =>
      (!c || i.category === c) &&
      (!st || (st === "ok" ? i.bought : !i.bought)) &&
      (!q || `${i.name} ${i.notes} ${i.category}`.toLowerCase().includes(q)));
  }

  function cellsHTML(i) {
    const tr = totReal(i), diff = tr === null ? null : totEst(i) - tr;
    const numIn = (f, v) => `<input class="input num" type="number" min="0" step="0.01" inputmode="decimal" data-f="${f}" value="${v ?? ""}">`;
    const cell = (label, inner, cls = "") => `<div class="cell ${cls}"><span class="mlabel">${label}</span>${inner}</div>`;
    return `<div class="cells">` +
      cell("Qtd.", editing ? numIn("qty", i.qty).replace('step="0.01"', 'step="1"') : `<span class="num">${i.qty}</span>`, "num") +
      cell("Preço est. un.", editing ? numIn("estUnit", i.estUnit) : money(i.estUnit), "num") +
      cell("Preço real un.", editing ? numIn("realUnit", i.realUnit) : (hasReal(i) ? money(i.realUnit) : `<span class="muted">—</span>`), "num") +
      cell("Total est.", `<span data-c="te">${money(totEst(i))}</span>`, "num") +
      cell("Total real", `<span data-c="tr">${tr === null ? '<span class="muted">—</span>' : money(tr)}</span>` +
        `<div class="notes" data-c="df">${diff === null ? "" : `<span class="${diff < 0 ? "neg" : "pos"}">${diff < 0 ? "" : "+"}${money(diff)}</span>`}</div>`, "num") +
      `</div>`;
  }

  function rowHTML(i) {
    const main = editing
      ? `<input class="input" data-f="name" value="${esc(i.name)}" aria-label="Item">
         <input class="input notes-in" data-f="notes" value="${esc(i.notes)}" placeholder="Observações">
         <input class="input cat-in" data-f="category" value="${esc(i.category)}" list="catList" aria-label="Categoria">`
      : `<div class="name">${esc(i.name)}</div>${i.notes ? `<div class="notes">${esc(i.notes)}</div>` : ""}`;
    return `<div class="row ${i.bought ? "done" : ""}" data-id="${i.id}">
      <input type="checkbox" class="check" data-f="bought" ${i.bought ? "checked" : ""} ${editing ? "" : "disabled"} aria-label="Comprado">
      <div class="main">${main}</div>
      ${cellsHTML(i)}
      ${editing ? `<button class="btn icon ghost del" title="Excluir item" aria-label="Excluir item">✕</button>` : ""}
    </div>`;
  }

  function renderList() {
    const items = filtered();
    const cats = categories();
    $("#catList").innerHTML = cats.map((c) => `<option value="${esc(c)}">`).join("");
    const sel = $("#fCat"), cur = sel.value;
    sel.innerHTML = `<option value="">Todas as categorias</option>` + cats.map((c) => `<option ${c === cur ? "selected" : ""}>${esc(c)}</option>`).join("");
    if (!items.length) { $("#list").innerHTML = `<div class="group empty">Nenhum item encontrado.</div>`; return; }
    const head = `<div class="row head"><span></span><span>Item</span><span class="num">Qtd.</span><span class="num">Est. un.</span><span class="num">Real un.</span><span class="num">Total est.</span><span class="num">Total real</span>${editing ? "<span></span>" : ""}</div>`;
    $("#list").innerHTML = cats.filter((c) => items.some((i) => i.category === c)).map((c) => {
      const gi = items.filter((i) => i.category === c), t = totals(data.items.filter((i) => i.category === c));
      return `<div class="group"><div class="group-head"><h2>${esc(c)}</h2>
        <span class="muted small">${t.bought}/${t.count} comprados · est. ${money(t.est)} · real ${money(t.real)}</span></div>
        ${head}${gi.map(rowHTML).join("")}</div>`;
    }).join("");
  }

  function refreshRow(row, item) {
    row.classList.toggle("done", !!item.bought);
    const tr = totReal(item), diff = tr === null ? null : totEst(item) - tr;
    $('[data-c="te"]', row).textContent = money(totEst(item));
    $('[data-c="tr"]', row).innerHTML = tr === null ? '<span class="muted">—</span>' : money(tr);
    $('[data-c="df"]', row).innerHTML = diff === null ? "" : `<span class="${diff < 0 ? "neg" : "pos"}">${diff < 0 ? "" : "+"}${money(diff)}</span>`;
  }

  /* ---------- Render: Prioridades ---------- */
  function renderPrio() {
    $("#prio").innerHTML = data.priorities.map((g, gi) => `
      <div class="card" data-g="${gi}">
        <div class="step">Etapa ${gi + 1}</div>
        ${editing ? `<input class="input" data-pf="title" value="${esc(g.title)}">` : `<h2>${esc(g.title)}</h2>`}
        <ol>${g.items.map((p, pi) => `
          <li class="${p.done ? "done" : ""}" data-p="${pi}">
            <input type="checkbox" class="check" data-pf="done" ${p.done ? "checked" : ""} ${editing ? "" : "disabled"} aria-label="Concluído">
            ${editing ? `<input class="input" data-pf="text" value="${esc(p.text)}"><button class="btn icon ghost pdel" aria-label="Remover">✕</button>` : `<span class="t">${esc(p.text)}</span>`}
          </li>`).join("")}</ol>
        ${editing ? `<button class="btn ghost add padd">+ Adicionar</button>` : ""}
      </div>`).join("");
  }

  function renderUpdated() {
    $("#updated").textContent = data.updatedAt ? `Última atualização: ${new Date(data.updatedAt).toLocaleString("pt-BR")}` : "";
  }

  function renderAll() {
    $("#title").textContent = data.title || "Casa de Yann";
    $("#subtitle").textContent = data.subtitle || "";
    renderSummary(); renderList(); renderPrio(); renderUpdated(); syncDirty();
  }

  /* ---------- Estado de edição ---------- */
  function syncDirty() {
    const dirty = editing && JSON.stringify(data) !== savedJSON;
    $("#saveBar").hidden = !dirty;
    if (dirty && !$("#saveBtn").disabled) $("#saveMsg").textContent = "Alterações não salvas";
  }

  function setEditing(on) {
    editing = on;
    document.body.classList.toggle("editing", on);
    $("#modeBadge").textContent = on ? "Modo edição" : "Somente leitura";
    $("#modeBadge").classList.toggle("on", on);
    $("#loginBtn").hidden = on;
    $("#logoutBtn").hidden = !on;
    renderAll();
  }

  function logout(rerender = true) {
    token = null; store.del(LS.token);
    if (rerender) {
      if (JSON.stringify(data) !== savedJSON) data = JSON.parse(savedJSON);
      setEditing(false);
    }
  }

  /* ---------- Eventos ---------- */
  function onListInput(e) {
    const el = e.target, row = el.closest(".row[data-id]"), f = el.dataset.f;
    if (!row || !f || !editing) return;
    const item = data.items.find((i) => i.id === row.dataset.id);
    if (f === "bought") item.bought = el.checked;
    else if (["qty", "estUnit", "realUnit"].includes(f)) item[f] = el.value === "" ? (f === "realUnit" ? null : 0) : +el.value;
    else item[f] = el.value;
    refreshRow(row, item);
    renderSummary(); syncDirty();
  }

  function bind() {
    $$(".tab").forEach((t) => t.addEventListener("click", () => {
      $$(".tab").forEach((x) => x.classList.toggle("active", x === t));
      $$(".panel").forEach((p) => (p.hidden = p.id !== `tab-${t.dataset.tab}`));
      store.set("cdy_tab", t.dataset.tab);
    }));
    const lastTab = store.get("cdy_tab");
    if (lastTab) $(`.tab[data-tab="${lastTab}"]`)?.click();

    ["#q", "#fCat", "#fStatus"].forEach((s) => $(s).addEventListener("input", renderList));

    const list = $("#list");
    list.addEventListener("input", onListInput);
    list.addEventListener("change", (e) => { if (e.target.dataset.f === "category") { renderList(); renderSummary(); } });
    list.addEventListener("click", (e) => {
      const del = e.target.closest(".del"); if (!del) return;
      const id = del.closest(".row").dataset.id, item = data.items.find((i) => i.id === id);
      if (!confirm(`Excluir "${item.name}"?`)) return;
      data.items = data.items.filter((i) => i.id !== id);
      renderList(); renderSummary(); syncDirty();
    });

    $("#addItem").addEventListener("click", () => {
      const cat = $("#fCat").value || data.items.at(-1)?.category || "Outros";
      const id = "i" + Date.now().toString(36);
      data.items.push({ id, category: cat, name: "Novo item", qty: 1, estUnit: 0, realUnit: null, bought: false, notes: "" });
      $("#q").value = ""; $("#fStatus").value = "";
      renderList(); renderSummary(); syncDirty();
      const inp = $(`.row[data-id="${id}"] input[data-f="name"]`);
      inp?.scrollIntoView({ block: "center" }); inp?.select();
    });

    $("#budgetInput").addEventListener("input", (e) => { data.budget = +e.target.value || 0; renderSummary(); syncDirty(); });

    const prio = $("#prio");
    prio.addEventListener("input", (e) => {
      const el = e.target, f = el.dataset.pf; if (!f || !editing) return;
      const g = data.priorities[el.closest("[data-g]").dataset.g];
      if (f === "title") g.title = el.value;
      else {
        const li = el.closest("[data-p]"), p = g.items[li.dataset.p];
        if (f === "done") { p.done = el.checked; li.classList.toggle("done", el.checked); } else p.text = el.value;
      }
      syncDirty();
    });
    prio.addEventListener("click", (e) => {
      const card = e.target.closest("[data-g]"); if (!card) return;
      const g = data.priorities[card.dataset.g];
      if (e.target.closest(".padd")) { g.items.push({ text: "", done: false }); renderPrio(); $$("input[data-pf=text]", $(`[data-g="${card.dataset.g}"]`)).at(-1).focus(); syncDirty(); }
      if (e.target.closest(".pdel")) { g.items.splice(+e.target.closest("[data-p]").dataset.p, 1); renderPrio(); syncDirty(); }
    });

    $("#csvBtn").addEventListener("click", exportCSV);
    $("#saveBtn").addEventListener("click", save);
    $("#discardBtn").addEventListener("click", () => { if (confirm("Descartar alterações não salvas?")) { data = JSON.parse(savedJSON); renderAll(); } });
    $("#logoutBtn").addEventListener("click", () => {
      if (JSON.stringify(data) !== savedJSON && !confirm("Há alterações não salvas. Sair mesmo assim?")) return;
      logout();
    });

    const dlg = $("#loginDlg");
    $("#loginBtn").addEventListener("click", () => { $("#repoInput").value = repo || ""; $("#loginErr").hidden = true; dlg.showModal(); });
    $("#loginForm").addEventListener("submit", async (e) => {
      if (e.submitter?.value !== "ok") return;
      e.preventDefault();
      const err = $("#loginErr"), go = $("#loginGo");
      err.hidden = true; go.disabled = true;
      const r0 = $("#repoInput").value.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\/$/, "");
      const t0 = $("#tokenInput").value.trim();
      try {
        const prev = token; token = t0;
        const r = await gh(`/repos/${r0}`);
        if (!r.ok) { token = prev; throw new Error(r.status === 401 ? "Token inválido." : "Repositório não encontrado ou sem acesso."); }
        const info = await r.json();
        if (!info.permissions?.push) { token = prev; throw new Error("Este token não tem permissão de escrita no repositório."); }
        repo = r0;
        const res = await fetchFromApi(true);
        data = res.json; sha = res.sha; savedJSON = JSON.stringify(data);
        store.set(LS.token, token); store.set(LS.repo, repo);
        $("#tokenInput").value = "";
        dlg.close();
        setEditing(true);
        toast("Modo edição ativado.");
      } catch (ex) {
        err.textContent = ex.message; err.hidden = false;
      } finally { go.disabled = false; }
    });

    window.addEventListener("beforeunload", (e) => { if (editing && JSON.stringify(data) !== savedJSON) { e.preventDefault(); e.returnValue = ""; } });
  }

  function exportCSV() {
    const head = ["Categoria", "Item", "Quantidade", "Preço estimado unitário", "Preço real unitário", "Total estimado", "Total real", "Diferença", "Comprado?", "Observações"];
    const n = (v) => (v === null || v === undefined || v === "" ? "" : String(v).replace(".", ","));
    const rows = data.items.map((i) => {
      const tr = totReal(i);
      return [i.category, i.name, n(i.qty), n(i.estUnit), n(i.realUnit), n(totEst(i)), n(tr), n(tr === null ? null : totEst(i) - tr), i.bought ? "Sim" : "Não", i.notes];
    });
    const csv = "﻿" + [head, ...rows].map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })), download: "casa-de-yann.csv" });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  let toastTimer;
  function toast(msg, ms = 3000) {
    const t = $("#toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), ms);
  }

  /* ---------- Início ---------- */
  (async () => {
    bind();
    try {
      data = await load();
      savedJSON = JSON.stringify(data);
      $("#loading").hidden = true;
      setEditing(!!token && !!sha);
    } catch (e) {
      $("#loading").hidden = true;
      const er = $("#error"); er.textContent = e.message; er.hidden = false;
    }
  })();
})();
