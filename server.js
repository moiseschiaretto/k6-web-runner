const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { parseCurl } = require('./src/utils/parseCurl');
const { generateK6Script } = require('./src/k6-runner');

// Resolve o binário do k6 — tenta PATH, depois locais comuns do Homebrew/Linux
function resolveK6Binary() {
    const candidates = ['k6', '/opt/homebrew/bin/k6', '/usr/local/bin/k6', '/usr/bin/k6'];
    for (const bin of candidates) {
        try {
            require('child_process').execFileSync(bin, ['version'], { stdio: 'pipe' });
            return bin;
        } catch { /* tenta próximo */ }
    }
    throw new Error('k6 não encontrado. Instale com: https://grafana.com/docs/k6/latest/set-up/install-k6/');
}

const K6_BIN = resolveK6Binary();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(cors({ origin: false }));

app.use(rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    message: 'Limite de requisições excedido. Tente novamente em 1 minuto.',
}));

// ─── Execução do k6 (SSE — streaming de terminal em tempo real) ───────────
app.post('/run-test', async (req, res) => {
    try {
        const {
            urls,
            vus,
            rampUp,
            duration,
            statusValidation,
            responseTimeLimit,
            disableResponseValidation,
            authToken,
        } = req.body || {};

        if (!urls || !Array.isArray(urls) || urls.length === 0) {
            return res.status(400).json({ error: 'Nenhum endpoint informado' });
        }

        const parsedEndpoints = urls.map((u) => parseCurl(u));
        const script = generateK6Script(parsedEndpoints, {
            vus,
            rampUp,
            duration,
            statusValidation,
            responseTimeLimit,
            disableResponseValidation,
            peak: req.body.peak || false,
            authToken: authToken || null,
        });

        // Escreve o script em arquivo temporário para evitar problemas de
        // injeção de tokens longos (JWT) via stdin em ambientes restritivos
        const tmpScript = path.join(os.tmpdir(), `k6-run-${Date.now()}.js`);
        fs.writeFileSync(tmpScript, script);

        const k6 = spawn(K6_BIN, ['run', tmpScript], { stdio: ['ignore', 'pipe', 'pipe'] });

        res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            'X-Accel-Buffering': 'no',
            Connection: 'keep-alive',
        });

        const send = (text) => res.write(`data: ${text.replace(/\r?\n/g, '\n')}\n\n`);

        k6.stdout.on('data', (chunk) => send(chunk.toString()));
        k6.stderr.on('data', (chunk) => send(chunk.toString()));

        k6.on('close', (code) => {
            fs.unlink(tmpScript, () => {});
            send(`[K6] Execução finalizada com código ${code}`);
            res.end();
        });

        k6.on('error', (err) => {
            fs.unlink(tmpScript, () => {});
            send(`[K6] Erro ao iniciar: ${err.message}`);
            res.end();
        });

    } catch (err) {
        console.error(err);
        if (!res.headersSent) {
            return res.status(500).json({ error: 'Erro ao executar teste' });
        }
        res.end();
    }
});

app.listen(PORT, () => console.log(`✅ K6 Web Runner rodando em http://localhost:${PORT}`));
