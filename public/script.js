const terminal = document.getElementById('terminal');
const summaryBody = document.querySelector('#summaryTable tbody');
const runBtn = document.getElementById('runBtn');

function appendTerminal(text) {
  terminal.textContent += text;
  terminal.scrollTop = terminal.scrollHeight;
}

function parseResultLines(text, aggregates) {
  const lines = text.split('\n');
  for (const line of lines) {
    const idx = line.indexOf('RESULT:');
    if (idx === -1) continue;
    try {
      const jsonPart = line.slice(idx + 'RESULT:'.length);
      const jsonEnd = jsonPart.lastIndexOf('}');
      if (jsonEnd === -1) continue;
      const rawJson = jsonPart.slice(0, jsonEnd + 1).replace(/\\"/g, '"');
      const json = JSON.parse(rawJson);
      const key = `${json.method} ${json.endpoint}`;
      if (!aggregates.has(key)) {
        aggregates.set(key, { count: 0, totalDuration: 0, min: Infinity, max: -Infinity, errors: 0 });
      }
      const agg = aggregates.get(key);
      agg.count++;
      agg.totalDuration += json.duration;
      agg.min = Math.min(agg.min, json.duration);
      agg.max = Math.max(agg.max, json.duration);
      if (json.status >= 400 || json.status === 0) agg.errors++;
    } catch (_) { /* linha não é um RESULT válido, ignora */ }
  }
}

function renderSummary(aggregates) {
  summaryBody.innerHTML = '';
  for (const [key, agg] of aggregates.entries()) {
    const avg = agg.count ? (agg.totalDuration / agg.count) : 0;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${key}</td>
      <td>${agg.count}</td>
      <td>${avg.toFixed(2)}</td>
      <td>${isFinite(agg.min) ? agg.min.toFixed(2) : '-'}</td>
      <td>${isFinite(agg.max) ? agg.max.toFixed(2) : '-'}</td>
      <td>${agg.errors}</td>
    `;
    summaryBody.appendChild(tr);
  }
}

runBtn.addEventListener('click', async () => {
  const urlsRaw = document.getElementById('urls').value.trim();
  if (!urlsRaw) {
    alert('Informe ao menos um endpoint.');
    return;
  }

  const urls = urlsRaw.split('\n').map((l) => l.trim()).filter(Boolean);

  const body = {
    urls,
    vus: Number(document.getElementById('vus').value) || 1,
    rampUp: document.getElementById('rampUp').value || '10s',
    duration: document.getElementById('duration').value || '30s',
    statusValidation: document.getElementById('statusValidation').value,
    responseTimeLimit: Number(document.getElementById('responseTimeLimit').value) || 1000,
    peak: document.getElementById('peak').checked,
    authToken: document.getElementById('authToken').value || null,
  };

  terminal.textContent = '';
  summaryBody.innerHTML = '';
  runBtn.disabled = true;
  runBtn.textContent = '⏳ Rodando...';

  const aggregates = new Map();
  let renderTimer = null;
  const scheduleRender = () => {
    if (renderTimer) return;
    renderTimer = setTimeout(() => { renderSummary(aggregates); renderTimer = null; }, 400);
  };

  try {
    const response = await fetch('/run-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok || !response.body) {
      appendTerminal(`Erro: ${response.status} ${response.statusText}\n`);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      const clean = chunk.replace(/^data: /gm, '').replace(/\n\n/g, '\n');

      appendTerminal(clean);

      pending += clean;
      const lastNewline = pending.lastIndexOf('\n');
      if (lastNewline !== -1) {
        const completeLines = pending.slice(0, lastNewline);
        pending = pending.slice(lastNewline + 1);
        parseResultLines(completeLines, aggregates);
        scheduleRender();
      }
    }

    if (pending) parseResultLines(pending, aggregates);
  } catch (err) {
    appendTerminal(`\nErro de conexão: ${err.message}\n`);
  } finally {
    renderSummary(aggregates);
    runBtn.disabled = false;
    runBtn.textContent = '▶ Rodar teste de carga';
  }
});